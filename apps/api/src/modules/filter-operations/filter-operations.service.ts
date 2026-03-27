/**
 * Filter Operations Service — Core operations: cycle management, stage advancement, bypass.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { createHash } from 'node:crypto';
import { sanitizeStrings } from '../../lib/sanitize.js';

function computeChecksum(data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * Walk the pipeline from a given stage and collect CHECKLIST nodes
 * that sit between it and the next STAGE/END node.
 */
function collectChecklistsAfterStage(
  stage: any,
  allStages: any[],
  connections: any[],
): any[] {
  const checklists: any[] = [];
  const visited = new Set<string>();

  function walk(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const outConns = connections.filter((c: any) => c.fromStageId === nodeId);
    for (const conn of outConns) {
      const next = allStages.find((s: any) => s.id === conn.toStageId);
      if (!next) continue;
      if (next.nodeType === 'CHECKLIST') {
        checklists.push(next);
        walk(next.id);
      }
    }
  }

  walk(stage.id);
  return checklists;
}

/**
 * Resolve checklist questions for CHECKLIST pipeline nodes.
 */
async function resolveChecklistQuestions(checklistNodes: any[]): Promise<any[]> {
  const result: any[] = [];
  for (const node of checklistNodes) {
    const config = node.configuration as any;
    const checklistProfileId = config?.checklistProfileId;
    if (!checklistProfileId) continue;

    const profile = await prisma.checklistProfile.findUnique({
      where: { id: checklistProfileId },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!profile) continue;

    result.push({
      pipelineNodeId: node.id,
      checklistProfileId: profile.id,
      checklistProfileName: profile.name,
      questions: profile.questions.map((q: any) => ({
        id: q.id,
        question: q.question,
        questionType: q.questionType,
        required: q.required,
        section: q.section,
        description: q.description,
        options: q.options,
        validation: q.validation,
        sortOrder: q.sortOrder,
      })),
    });
  }
  return result;
}

function orgWhere(ctx: RequestContext) {
  if (ctx.scope === 'GLOBAL') return {};
  return { organizationId: ctx.organizationId };
}

export class FilterOperationsService {
  private async getFilter(filterId: string, ctx: RequestContext) {
    const filter = await prisma.assetInstance.findFirst({
      where: { id: filterId, ...orgWhere(ctx) },
      select: { id: true, name: true, filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true, organizationId: true },
    });
    if (!filter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
    return filter as { id: string; name: string | null; filterProfileId: string | null; currentLifecycleState: string | null; currentCycleId: string | null; filterSet: string | null; organizationId: string | null };
  }

  private async getProfilePipeline(filterProfileId: string) {
    const fp = await prisma.filterProfile.findUnique({ where: { id: filterProfileId } });
    if (!fp) return null;
    const cp = await prisma.filterCleaningProfile.findUnique({
      where: { id: fp.cleaningProfileId },
      include: { stages: { orderBy: { sortOrder: 'asc' } }, connections: true },
    });
    return cp;
  }

  async getCurrentState(ctx: RequestContext, filterId: string) {
    const filter = await this.getFilter(filterId, ctx);

    let currentCycle = null;
    if (filter.currentCycleId) {
      currentCycle = await prisma.cleaningCycle.findUnique({ where: { id: filter.currentCycleId } });
    }

    let profile = null;
    let nextAllowedStages: string[] = [];
    let nextBlocks: any[] = [];
    let pendingChecklist: any[] = [];

    const cp = filter.filterProfileId ? await this.getProfilePipeline(filter.filterProfileId) : null;

    if (cp) {
          profile = { name: cp.name, flowMode: cp.flowMode };

          if (currentCycle && filter.currentLifecycleState) {
            const currentStage = cp.stages.find(s => s.stateKey === filter.currentLifecycleState);
            if (currentStage) {
              // Check for CHECKLIST nodes directly after current stage
              const checklistNodes = collectChecklistsAfterStage(currentStage, cp.stages, cp.connections);

              if (checklistNodes.length > 0) {
                // Check if checklists have already been answered for this stage in this cycle
                const answeredEvent = await prisma.filterEvent.findFirst({
                  where: {
                    filterId,
                    cycleId: currentCycle.id,
                    eventType: 'CHECKLIST_COMPLETED',
                    attributes: { path: ['afterStage'], equals: filter.currentLifecycleState },
                  },
                });

                if (!answeredEvent) {
                  // Checklists pending — resolve questions and return them
                  pendingChecklist = await resolveChecklistQuestions(checklistNodes);
                  // Don't show next stages until checklist is done
                  nextAllowedStages = [];
                } else {
                  // Checklists done — walk past checklist nodes to find next STAGE nodes
                  const reachableFromChecklists = new Set<string>();
                  for (const cl of checklistNodes) {
                    const outConns = cp.connections.filter((c: any) => c.fromStageId === cl.id);
                    outConns.forEach((c: any) => reachableFromChecklists.add(c.toStageId));
                  }
                  const nextStages = cp.stages.filter(s => reachableFromChecklists.has(s.id));
                  nextAllowedStages = nextStages.filter(s => s.nodeType === 'STAGE').map(s => s.stateKey!).filter(Boolean);
                  nextBlocks = nextStages.filter(s => s.nodeType !== 'STAGE' && s.nodeType !== 'END' && s.nodeType !== 'START' && s.nodeType !== 'CHECKLIST').map(s => ({
                    nodeType: s.nodeType,
                    configuration: s.configuration,
                  }));
                }
              } else {
                // No checklist — normal flow
                const outConns = cp.connections.filter(c => c.fromStageId === currentStage.id);
                const nextStageIds = outConns.map(c => c.toStageId);
                const nextStages = cp.stages.filter(s => nextStageIds.includes(s.id));
                nextAllowedStages = nextStages.filter(s => s.nodeType === 'STAGE').map(s => s.stateKey!).filter(Boolean);
                nextBlocks = nextStages.filter(s => s.nodeType !== 'STAGE' && s.nodeType !== 'END' && s.nodeType !== 'START' && s.nodeType !== 'CHECKLIST').map(s => ({
                  nodeType: s.nodeType,
                  configuration: s.configuration,
                }));
              }
            }
          } else if (currentCycle && !filter.currentLifecycleState) {
            const startNode = cp.stages.find(s => s.nodeType === 'START');
            if (startNode) {
              const outConns = cp.connections.filter(c => c.fromStageId === startNode.id);
              const nextStageIds = outConns.map(c => c.toStageId);
              const nextStages = cp.stages.filter(s => nextStageIds.includes(s.id));
              nextAllowedStages = nextStages.filter(s => s.nodeType === 'STAGE').map(s => s.stateKey!).filter(Boolean);
            }
          } else {
            const startNode = cp.stages.find(s => s.nodeType === 'START');
            if (startNode) {
              const outConns = cp.connections.filter(c => c.fromStageId === startNode.id);
              const nextStageIds = outConns.map(c => c.toStageId);
              const nextStages = cp.stages.filter(s => nextStageIds.includes(s.id));
              nextAllowedStages = nextStages.filter(s => s.nodeType === 'STAGE').map(s => s.stateKey!).filter(Boolean);
            }
          }
    }

    const totalCycles = await prisma.cleaningCycle.count({ where: { filterId } });

    const pipelineStages = cp
      ? cp.stages.filter(s => s.nodeType === "STAGE").map(s => ({ stateKey: s.stateKey, nodeType: s.nodeType, sortOrder: s.sortOrder, configuration: s.configuration }))
      : [];

    return {
      filterId: filter.id,
      filterName: filter.name,
      currentState: filter.currentLifecycleState,
      currentCycle,
      nextAllowedStages,
      nextBlocks,
      pendingChecklist,
      pipelineStages,
      profile,
      filterSet: filter.filterSet,
      totalCycles,
    };
  }

  async submitChecklist(ctx: RequestContext, filterId: string, data: any) {
    const { answers } = data;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    const cycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (!cycle) throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');

    // Record CHECKLIST_COMPLETED event
    const eventData = {
      filterId,
      cycleId: cycle.id,
      eventType: 'CHECKLIST_COMPLETED' as const,
      performedBy: ctx.userSub,
      attributes: {
        afterStage: filter.currentLifecycleState,
        answers,
      },
      remarks: `Checklist completed after ${filter.currentLifecycleState}`,
    };
    const checksum = computeChecksum(eventData);

    await prisma.filterEvent.create({
      data: {
        ...eventData,
        checksum,
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CHECKLIST_COMPLETED',
      targetType: 'filter', targetId: filterId,
      afterValue: { stage: filter.currentLifecycleState, answerCount: Object.keys(answers ?? {}).length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  async startCycle(ctx: RequestContext, filterId: string, data: any) {
    const { cleaningReasonKey, cleaningAreaId } = data;
    const cleaningJustification = typeof data.cleaningJustification === "string" ? data.cleaningJustification.replace(/</g, "&lt;").replace(/>/g, "&gt;") : data.cleaningJustification;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.filterProfileId) throw new AppError(400, 'NO_PROFILE', 'Filter has no assigned profile');

    if (filter.currentCycleId) {
      const activeCycle = await prisma.cleaningCycle.findFirst({
        where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
      });
      if (activeCycle) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
    }

    const reasons = await this.getCleaningReasons(filter.filterProfileId);
    if (!cleaningReasonKey) {
      throw new AppError(400, 'REASON_REQUIRED', 'Cleaning reason is required');
    }
    const reason = reasons.find((r: any) => r.key === cleaningReasonKey);
    if (!reason) throw new AppError(400, 'INVALID_REASON', `Invalid cleaning reason: ${cleaningReasonKey}`);
    if (reason.requiresJustification && (!cleaningJustification || cleaningJustification.length < 10)) {
      throw new AppError(400, 'JUSTIFICATION_REQUIRED', 'Justification required (min 10 characters) for this cleaning reason');
    }

    const org = filter.organizationId
      ? await prisma.organization.findUnique({ where: { id: filter.organizationId }, select: { slug: true } })
      : null;
    const orgSlug = (org?.slug ?? 'ORG').toUpperCase().slice(0, 10);

    const prevCycleCount = await prisma.cleaningCycle.count({ where: { filterId } });
    const seq = prevCycleCount + 1;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cycleCode = `CC-${orgSlug}-${filter.name?.replace(/\s+/g, '').slice(0, 10) ?? filterId.slice(0, 8)}-${String(seq).padStart(3, '0')}-${dateStr}`;

    const fp = await prisma.filterProfile.findUnique({ where: { id: filter.filterProfileId } });
    const cp = fp ? await prisma.filterCleaningProfile.findUnique({ where: { id: fp.cleaningProfileId } }) : null;

    // Use transaction to prevent race conditions on double-start
    const cycle = await prisma["$transaction"](async (tx) => {
      // Re-check inside transaction
      const recheck = await tx.assetInstance.findUnique({ where: { id: filterId }, select: { currentCycleId: true } });
      if (recheck?.currentCycleId) {
        const active = await tx.cleaningCycle.findFirst({ where: { id: recheck.currentCycleId, status: 'IN_PROGRESS' } });
        if (active) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
      }

      const newCycle = await tx.cleaningCycle.create({
        data: {
          cycleCode, filterId, ahuId: null,
          profileId: filter.filterProfileId!,
          profileVersion: cp?.version ?? 1,
          sequenceNumber: seq, cleaningReasonKey,
          cleaningReasonLabel: reason.name,
          cleaningJustification: cleaningJustification ?? null,
          cleaningAreaId: cleaningAreaId ?? null,
        },
      });

      await tx.filterEvent.create({
        data: {
          filterId, cycleId: newCycle.id, eventType: 'CYCLE_STARTED',
          performedBy: ctx.userSub, cleaningAreaId: cleaningAreaId ?? null,
          attributes: { cleaningReasonKey, cleaningReasonLabel: reason.name },
          remarks: cleaningJustification ?? null,
          checksum: computeChecksum({ filterId, cycleId: newCycle.id, eventType: 'CYCLE_STARTED', performedBy: ctx.userSub }),
          ipAddress: ctx.ipAddress, telemetrySnapshot: {},
        },
      });

      await tx.assetInstance.update({
        where: { id: filterId },
        data: { currentCycleId: newCycle.id },
      });

      return newCycle;
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CYCLE_STARTED',
      targetType: 'cleaning_cycle', targetId: cycle.id,
      afterValue: { cycleCode, cleaningReasonKey, filterId },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return cycle;
  }

  async advance(ctx: RequestContext, filterId: string, data: any) {
    const { targetState, parameters, equipmentId, cleaningAreaId } = data;
    const remarks = typeof data.remarks === "string" ? data.remarks.replace(/</g, "&lt;").replace(/>/g, "&gt;") : data.remarks;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    const cycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (!cycle) throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');

    const cp = await this.getProfilePipeline(filter.filterProfileId!);
    if (!cp) throw new AppError(500, 'NO_PROFILE', 'Pipeline profile not found');

    // #12: Enforce checklist completion before allowing advance
    const currentState = filter.currentLifecycleState;
    if (currentState) {
      const currentStageForCL = cp.stages.find(s => s.stateKey === currentState);
      if (currentStageForCL) {
        const pendingCLs = collectChecklistsAfterStage(currentStageForCL, cp.stages, cp.connections)
          .filter(n => n.configuration?.checklistProfileId);
        if (pendingCLs.length > 0) {
          const answered = await prisma.filterEvent.findFirst({
            where: { filterId, cycleId: cycle.id, eventType: 'CHECKLIST_COMPLETED', attributes: { path: ['afterStage'], equals: currentState } },
          });
          if (!answered) {
            throw new AppError(400, 'CHECKLIST_PENDING', `Please complete the checklist before advancing from ${currentState.replace(/_/g, ' ')}`);
          }
        }
      }
    }

    let currentStage = currentState
      ? cp.stages.find(s => s.stateKey === currentState)
      : cp.stages.find(s => s.nodeType === 'START');

    if (!currentStage) {
      currentStage = cp.stages.find(s => s.nodeType === 'START');
    }

    if (currentStage) {
      // Walk from current stage: skip over CHECKLIST nodes to find reachable STAGE nodes
      const reachableStages: string[] = [];
      const visited = new Set<string>();
      let hasEndNext = false;

      function findReachableStages(nodeId: string) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const outConns = cp!.connections.filter(c => c.fromStageId === nodeId);
        for (const conn of outConns) {
          const next = cp!.stages.find(s => s.id === conn.toStageId);
          if (!next) continue;
          if (next.nodeType === 'STAGE' && next.stateKey) {
            reachableStages.push(next.stateKey);
          } else if (next.nodeType === 'END') {
            hasEndNext = true;
          } else if (next.nodeType === 'CHECKLIST') {
            findReachableStages(next.id);
          }
        }
      }

      findReachableStages(currentStage.id);

      if (reachableStages.length === 0 && hasEndNext) {
        throw new AppError(400, 'CYCLE_COMPLETE', 'Cleaning cycle is complete. No more stages.');
      }
      if (!reachableStages.includes(targetState) && cp.flowMode !== 'BYPASS_ENABLED') {
        throw new AppError(400, 'OUT_OF_SEQUENCE', `Cannot move to ${targetState} from ${currentState ?? 'START'}. Next allowed: ${reachableStages.join(', ')}`);
      }
    }

    const targetStage = cp.stages.find(s => s.stateKey === targetState);
    if (!targetStage) throw new AppError(400, 'INVALID_TARGET', `Invalid target state: ${targetState}`);

    const paramBlocks = cp.stages.filter(s => s.nodeType === 'PARAM_CAPTURE');
    for (const block of paramBlocks) {
      const config = block.configuration as any;
      if (config?.parameters) {
        for (const param of config.parameters) {
          if (param.required && parameters && !parameters[param.key]) {
            throw new AppError(400, 'PARAM_REQUIRED', `Required parameter missing: ${param.label}`);
          }
          if (parameters?.[param.key]) {
            const val = parameters[param.key].value;
            if (param.min !== undefined && val < param.min) {
              throw new AppError(400, 'PARAM_OUT_OF_RANGE', `${param.label} below minimum (${param.min})`);
            }
            if (param.max !== undefined && val > param.max) {
              throw new AppError(400, 'PARAM_OUT_OF_RANGE', `${param.label} above maximum (${param.max})`);
            }
          }
        }
      }
    }

    const fromState = filter.currentLifecycleState;

    const eventData = {
      filterId, cycleId: cycle.id, eventType: 'STATE_TRANSITION' as const,
      fromState, toState: targetState,
      performedBy: ctx.userSub,
      cleaningAreaId: cleaningAreaId ?? null,
      equipmentId: equipmentId ?? null,
      attributes: parameters ?? {},
      remarks: remarks ?? null,
    };
    const checksum = computeChecksum(eventData);

    await prisma.filterEvent.create({
      data: {
        ...eventData,
        checksum,
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
      },
    });

    await prisma.assetInstance.update({
      where: { id: filterId },
      data: { currentLifecycleState: targetState },
    });

    // Check if target stage leads to END (walking through any CHECKLIST nodes)
    let leadsToEnd = false;
    let hasMoreStages = false;
    const checkedIds = new Set<string>();

    function checkEnd(stageId: string) {
      if (checkedIds.has(stageId)) return;
      checkedIds.add(stageId);
      const outConns = cp!.connections.filter(c => c.fromStageId === stageId);
      for (const conn of outConns) {
        const next = cp!.stages.find(s => s.id === conn.toStageId);
        if (!next) continue;
        if (next.nodeType === 'END') leadsToEnd = true;
        else if (next.nodeType === 'STAGE') hasMoreStages = true;
        else if (next.nodeType === 'CHECKLIST') checkEnd(next.id);
      }
    }
    checkEnd(targetStage.id);

    if (leadsToEnd && !hasMoreStages) {
      await prisma.cleaningCycle.update({
        where: { id: cycle.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await prisma.assetInstance.update({
        where: { id: filterId },
        data: { currentCycleId: null, currentLifecycleState: null },
      });

      const completeEvent = {
        filterId, cycleId: cycle.id, eventType: 'CYCLE_COMPLETED' as const,
        performedBy: ctx.userSub, attributes: { sequenceNumber: cycle.sequenceNumber },
      };
      await prisma.filterEvent.create({
        data: {
          ...completeEvent,
          checksum: computeChecksum(completeEvent),
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'STATE_TRANSITION',
      targetType: 'filter', targetId: filterId,
      beforeValue: { state: fromState },
      afterValue: { state: targetState },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  async bypass(ctx: RequestContext, filterId: string, data: any) {
    const { targetState, parameters } = data;
    const justification = typeof data.justification === "string" ? data.justification.replace(/</g, "&lt;").replace(/>/g, "&gt;") : data.justification;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle — start a cycle before bypassing');

    const cp = filter.filterProfileId ? await this.getProfilePipeline(filter.filterProfileId) : null;
    if (!cp || cp.flowMode !== 'BYPASS_ENABLED') {
      throw new AppError(403, 'BYPASS_FORBIDDEN', 'Profile flow mode is STRICT — bypass not allowed');
    }

    // Validate target state exists in pipeline
    const validStates = cp.stages.filter(s => s.nodeType === 'STAGE' && s.stateKey).map(s => s.stateKey);
    if (!validStates.includes(targetState)) {
      throw new AppError(400, 'INVALID_TARGET', `Invalid target state: ${targetState}. Valid: ${validStates.join(', ')}`);
    }

    if (!justification || justification.length < 10) {
      throw new AppError(400, 'JUSTIFICATION_REQUIRED', 'Bypass justification required (min 10 characters)');
    }

    const fromState = filter.currentLifecycleState;

    const eventData = {
      filterId, cycleId: filter.currentCycleId ?? undefined,
      eventType: 'BYPASS_DEVIATION' as const,
      fromState, toState: targetState,
      performedBy: ctx.userSub,
      attributes: parameters ?? {},
      deviationDetails: { type: 'BYPASS', fromState, toState: targetState, justification },
      remarks: justification,
    };
    const checksum = computeChecksum(eventData);

    await prisma.filterEvent.create({
      data: {
        ...eventData,
        checksum,
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
      },
    });

    await prisma.assetInstance.update({
      where: { id: filterId },
      data: { currentLifecycleState: targetState },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'BYPASS_DEVIATION',
      targetType: 'filter', targetId: filterId,
      beforeValue: { state: fromState },
      afterValue: { state: targetState, justification },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  async getEvents(ctx: RequestContext, query: any) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = {};
    if (query.filterId) where.filterId = query.filterId;
    if (query.cycleId) where.cycleId = query.cycleId;
    if (query.eventType) where.eventType = query.eventType;
    if (query.from || query.to) {
      where.performedAt = {};
      if (query.from) where.performedAt.gte = new Date(query.from);
      if (query.to) where.performedAt.lte = new Date(query.to);
    }

    const [data, total] = await Promise.all([
      prisma.filterEvent.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { performedAt: 'desc' },
      }),
      prisma.filterEvent.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getCycles(ctx: RequestContext, query: any) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = {};
    if (query.filterId) where.filterId = query.filterId;
    if (query.ahuId) where.ahuId = query.ahuId;
    if (query.status) where.status = query.status;
    if (query.cleaningReasonKey) where.cleaningReasonKey = query.cleaningReasonKey;
    if (query.from || query.to) {
      where.startedAt = {};
      if (query.from) where.startedAt.gte = new Date(query.from);
      if (query.to) where.startedAt.lte = new Date(query.to);
    }

    const includeEvents = query.includeEvents === 'true' || query.includeEvents === true;
    const [data, total] = await Promise.all([
      prisma.cleaningCycle.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { startedAt: 'desc' },
        ...(includeEvents ? { include: { events: { orderBy: { performedAt: 'asc' as const } } } } : {}),
      }),
      prisma.cleaningCycle.count({ where }),
    ]);

    // Enrich with filter names
    const filterIds = [...new Set(data.map(c => c.filterId))];
    const filters = filterIds.length > 0 ? await prisma.assetInstance.findMany({
      where: { id: { in: filterIds } },
      select: { id: true, name: true, filterSet: true },
    }) : [];
    const filterMap = Object.fromEntries(filters.map(f => [f.id, f]));

    const enriched = data.map(c => ({
      ...c,
      filterName: filterMap[c.filterId]?.name ?? null,
      filterSet: filterMap[c.filterId]?.filterSet ?? null,
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getCycleById(ctx: RequestContext, id: string) {
    const cycle = await prisma.cleaningCycle.findUnique({
      where: { id },
      include: { events: { orderBy: { performedAt: 'asc' } } },
    });
    if (!cycle) throw new AppError(404, 'NOT_FOUND', 'Cleaning cycle not found');

    // Enrich with filter name
    const filter = await prisma.assetInstance.findUnique({
      where: { id: cycle.filterId },
      select: { id: true, name: true, filterSet: true },
    });

    // Resolve performedBy UUIDs to user names
    const performerIds = [...new Set(cycle.events.map(e => e.performedBy).filter(Boolean) as string[])];
    const users = performerIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: performerIds } },
      select: { id: true, username: true, fullName: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.fullName || u.username]));

    const enrichedEvents = cycle.events.map(e => ({
      ...e,
      performedByName: e.performedBy ? userMap[e.performedBy] ?? null : null,
    }));

    return {
      ...cycle,
      events: enrichedEvents,
      filterName: filter?.name ?? null,
      filterSet: filter?.filterSet ?? null,
    };
  }

  async getCleaningReasons(profileId?: string) {
    if (profileId) {
      const fp = await prisma.filterProfile.findUnique({ where: { id: profileId } });
      if (fp) {
        const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: fp.cleaningProfileId } });
        if (cp?.cleaningReasons) return cp.cleaningReasons as any[];
      }
    }
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
    return (cfg?.configValue as any[]) ?? [];
  }
}
