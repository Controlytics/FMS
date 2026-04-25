/**
 * Filter Operations Service — Core operations: cycle management, stage advancement, bypass.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { createHash } from 'node:crypto';
import { sanitizeStrings } from '../../lib/sanitize.js';
import { orgScope } from '../../lib/org-scope.js';

function computeChecksum(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(canonical).digest('hex');
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
  // Batch: collect all profile IDs, query once
  const profileIds = [...new Set(
    checklistNodes.map(n => (n.configuration as any)?.checklistProfileId).filter(Boolean),
  )];
  if (profileIds.length === 0) return [];

  const profiles = await prisma.checklistProfile.findMany({
    where: { id: { in: profileIds }, isActive: true },
    include: { questions: { orderBy: { sortOrder: 'asc' } } },
  });
  const profileMap = new Map(profiles.map(p => [p.id, p]));

  const result: any[] = [];
  for (const node of checklistNodes) {
    const checklistProfileId = (node.configuration as any)?.checklistProfileId;
    const profile = checklistProfileId ? profileMap.get(checklistProfileId) : undefined;
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

function orgWhere(ctx: RequestContext) { return orgScope(ctx); }

export class FilterOperationsService {
  private async getFilter(filterId: string, ctx: RequestContext) {
    const filter = await prisma.assetInstance.findFirst({
      where: { id: filterId, ...orgWhere(ctx) },
      select: { id: true, name: true, filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true, organizationId: true },
    });
    if (!filter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
    return filter as { id: string; name: string | null; filterProfileId: string | null; currentLifecycleState: string | null; currentCycleId: string | null; filterSet: string | null; organizationId: string | null };
  }

  async getFilterHomeBlock(filterId: string): Promise<{ blockId: string; blockName: string } | null> {
    let currentId: string | null = filterId;
    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const inst: { id: string; name: string; parentId: string | null; template: { name: string } | null } | null = await prisma.assetInstance.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, parentId: true, template: { select: { name: true } } },
      });
      if (!inst) break;
      if (inst.template?.name === 'Block') {
        return { blockId: inst.id, blockName: inst.name };
      }
      currentId = inst.parentId;
    }
    return null;
  }

  async validateBlockChange(filterId: string, cleaningAreaId: string | undefined, ctx: RequestContext) {
    if (!cleaningAreaId) return;
    const homeBlock = await this.getFilterHomeBlock(filterId);
    if (!homeBlock) return;
    if (homeBlock.blockId === cleaningAreaId) return;

    const { blockChangeService } = await import('../block-change-requests/block-change.service.js');
    const hasApproval = await blockChangeService.hasApproval(filterId, cleaningAreaId);
    if (!hasApproval) {
      const targetBlock = await prisma.assetInstance.findUnique({
        where: { id: cleaningAreaId },
        select: { name: true },
      });
      throw new AppError(409, 'BLOCK_CHANGE_REQUIRED',
        `Filter belongs to ${homeBlock.blockName}. Request approval to clean in ${targetBlock?.name ?? 'another block'}.`,
        {
          filterId,
          homeBlockId: homeBlock.blockId,
          homeBlockName: homeBlock.blockName,
          requestedBlockId: cleaningAreaId,
          requestedBlockName: targetBlock?.name ?? '',
        }
      );
    }
    await blockChangeService.consumeApproval(filterId, cleaningAreaId);
  }

  private getNextStageKeys(fromNodeId: string, stages: any[], connections: any[]): string[] {
    const outConns = connections.filter((c: any) => c.fromStageId === fromNodeId);
    const nextStageIds = outConns.map((c: any) => c.toStageId);
    const nextStages = stages.filter((s: any) => nextStageIds.includes(s.id));
    return nextStages.filter((s: any) => s.nodeType === 'STAGE').map((s: any) => s.stateKey!).filter(Boolean);
  }

  private extractBlocks(stages: any[]): { nodeType: string; configuration: any }[] {
    return stages.filter((s: any) => !['STAGE', 'END', 'START', 'CHECKLIST'].includes(s.nodeType))
      .map((s: any) => ({ nodeType: s.nodeType, configuration: s.configuration }));
  }

  private async resolveFilterProfile(filter: { id: string; filterProfileId: string | null; filterSet: string | null; name: string | null }): Promise<string | null> {
    // 1. Direct assignment takes priority
    if (filter.filterProfileId) return filter.filterProfileId;

    // 2. Check config-based assignment
    const configRow = await prisma.systemConfig.findUnique({ where: { configKey: 'cleaning-profile-assignment' } });
    const config = configRow?.configValue as { mode: string; rules: Array<{ matchValue: string; profileId: string }> } | null;
    if (!config || !config.rules || config.rules.length === 0) return null;

    // 3. Get filter's attributes and ancestors for matching
    const instance = await prisma.assetInstance.findUnique({
      where: { id: filter.id },
      select: { attributes: true, parentId: true },
    });
    const attrs = (instance?.attributes as Record<string, any>) ?? {};

    switch (config.mode) {
      case 'BY_FILTER_SIZE': {
        const filterSize = attrs.filterSize ?? '';
        const rule = config.rules.find(r => r.matchValue === filterSize);
        return rule?.profileId ?? null;
      }
      case 'BY_FILTER_SET': {
        const rule = config.rules.find(r => r.matchValue === filter.filterSet);
        return rule?.profileId ?? null;
      }
      case 'BY_AHU': {
        // Filter's parent is typically AHU
        if (instance?.parentId) {
          const rule = config.rules.find(r => r.matchValue === instance.parentId);
          return rule?.profileId ?? null;
        }
        return null;
      }
      case 'BY_BLOCK': {
        // Walk up: Filter -> AHU -> ... -> Block
        let currentId = instance?.parentId;
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          const rule = config.rules.find(r => r.matchValue === currentId);
          if (rule) return rule.profileId;
          const parent = await prisma.assetInstance.findUnique({ where: { id: currentId }, select: { parentId: true } });
          currentId = parent?.parentId ?? null;
        }
        return null;
      }
      case 'BY_ENTITY': {
        const rule = config.rules.find(r => r.matchValue === filter.id);
        return rule?.profileId ?? null;
      }
      default:
        return null;
    }
  }

  private async getProfilePipeline(profileId: string, requireActive: boolean = false) {
    // Try as FilterProfile first (has cleaningProfileId reference)
    const fp = await prisma.filterProfile.findUnique({ where: { id: profileId } });
    const cleaningProfileId = fp ? fp.cleaningProfileId : profileId;

    // Try as CleaningProfile directly (from config-based assignment)
    const cp = await prisma.filterCleaningProfile.findUnique({
      where: { id: cleaningProfileId },
      include: { stages: { orderBy: { sortOrder: 'asc' } }, connections: true },
    });

    // If profile is disabled (not ACTIVE), block operations that require it
    if (cp && requireActive && cp.status !== 'ACTIVE') {
      return null;
    }

    return cp;
  }

  /**
   * Batch: get current-state for all active filters in the user's org.
   * Returns { states: { [filterId]: stateObject } } for offline caching.
   */
  async getBatchStates(ctx: RequestContext, cleaningAreaId?: string) {
    const orgWhere = ctx.organizationId ? { organizationId: ctx.organizationId } : {};
    const filters = await prisma.assetInstance.findMany({
      where: {
        ...orgWhere,
        isActive: true,
        status: { not: 'Retired' },
        template: { name: 'Filter' },
      },
      select: { id: true },
    });

    const states: Record<string, any> = {};
    for (const f of filters) {
      try {
        states[f.id] = await this.getCurrentState(ctx, f.id, cleaningAreaId);
      } catch {
        // Skip filters that error (e.g., no profile assigned)
      }
    }
    return { states, cachedAt: new Date().toISOString() };
  }

  async getCurrentState(ctx: RequestContext, filterId: string, cleaningAreaId?: string) {
    const filter = await this.getFilter(filterId, ctx);

    let currentCycle = null;
    if (filter.currentCycleId) {
      currentCycle = await prisma.cleaningCycle.findUnique({ where: { id: filter.currentCycleId } });
    }

    // Pre-compute block-change state so the mobile UI can show the request
    // popup BEFORE asking for a wash-in reason, not as a background error
    // after submission. This is purely informational — validateBlockChange()
    // remains the authoritative enforcement point inside startCycle.
    const homeBlockRaw = await this.getFilterHomeBlock(filterId);
    const homeBlock = homeBlockRaw ? { id: homeBlockRaw.blockId, name: homeBlockRaw.blockName } : null;
    let blockChangeStatus: 'MATCH' | 'APPROVED' | 'REQUIRED' | null = null;
    if (!filter.currentCycleId && cleaningAreaId && homeBlock) {
      if (homeBlock.id === cleaningAreaId) {
        blockChangeStatus = 'MATCH';
      } else {
        const { blockChangeService } = await import('../block-change-requests/block-change.service.js');
        const approved = await blockChangeService.hasApproval(filterId, cleaningAreaId);
        blockChangeStatus = approved ? 'APPROVED' : 'REQUIRED';
      }
    }

    // PM auto-reason check: if this filter's AHU currently has a PM schedule
    // entry whose tolerance window contains `now`, the mobile/desktop UI can
    // skip the wash-in reason dialog and auto-fill "PM" as the cleaning reason.
    // Pure read — no writes. Only computed for new cycles (skipping when a
    // cycle is already in progress).
    let isPmDue = false;
    let pmReasonKey: string | null = null;
    if (!filter.currentCycleId) {
      const filterRow = await prisma.assetInstance.findUnique({
        where: { id: filterId },
        select: { parentId: true },
      });
      if (filterRow?.parentId) {
        const now = new Date();
        const dueEntry = await prisma.pmScheduleEntry.findFirst({
          where: {
            schedule: { entityId: filterRow.parentId, status: 'ACTIVE' },
            windowStart: { lte: now },
            windowEnd: { gte: now },
          },
          orderBy: { plannedDate: 'asc' },
          select: { id: true },
        });
        if (dueEntry) {
          isPmDue = true;
          // Look up the configured PM reason — must be active, and match
          // either key === 'PM' (exact), or name === 'PM', case-insensitive.
          const reasonsCfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
          const raw = reasonsCfg?.configValue as any;
          const reasons: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.value) ? raw.value : []);
          const pmReason = reasons.find(r =>
            r && r.isActive !== false && (
              (typeof r.key === 'string' && r.key.toUpperCase() === 'PM') ||
              (typeof r.name === 'string' && r.name.toUpperCase() === 'PM')
            )
          );
          if (pmReason?.key) pmReasonKey = pmReason.key;
        }
      }
    }

    let profile = null;
    let nextAllowedStages: string[] = [];
    let nextBlocks: any[] = [];
    let pendingChecklist: any[] = [];

    const resolvedProfileId = await this.resolveFilterProfile(filter);
    const cp = resolvedProfileId ? await this.getProfilePipeline(resolvedProfileId, false) : null; // getCurrentState shows pipeline even if disabled

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
                    attributes: { path: ['afterStage'], equals: filter.currentLifecycleState ?? undefined },
                  },
                });

                if (!answeredEvent) {
                  // Checklists pending — resolve questions (skips inactive profiles)
                  pendingChecklist = await resolveChecklistQuestions(checklistNodes);
                  if (pendingChecklist.length > 0) {
                    // Active checklists pending — block until completed
                    nextAllowedStages = [];
                  } else {
                    // All checklist profiles disabled — skip checklists, show next stages
                    for (const cl of checklistNodes) {
                      nextAllowedStages.push(...this.getNextStageKeys(cl.id, cp.stages, cp.connections));
                    }
                    nextBlocks = this.extractBlocks(cp.stages.filter(s => nextAllowedStages.some(key => cp.stages.find(st => st.stateKey === key)?.id === s.id)));
                  }
                } else {
                  // Checklists done — walk past checklist nodes to find next STAGE nodes
                  for (const cl of checklistNodes) {
                    nextAllowedStages.push(...this.getNextStageKeys(cl.id, cp.stages, cp.connections));
                  }
                  const reachableFromChecklists = new Set<string>();
                  for (const cl of checklistNodes) {
                    const outConns = cp.connections.filter((c: any) => c.fromStageId === cl.id);
                    outConns.forEach((c: any) => reachableFromChecklists.add(c.toStageId));
                  }
                  const nextStages = cp.stages.filter(s => reachableFromChecklists.has(s.id));
                  nextBlocks = this.extractBlocks(nextStages);
                }
              } else {
                // No checklist — normal flow
                nextAllowedStages = this.getNextStageKeys(currentStage.id, cp.stages, cp.connections);
                const outConns = cp.connections.filter(c => c.fromStageId === currentStage.id);
                const nextStageIds = outConns.map(c => c.toStageId);
                const nextStages = cp.stages.filter(s => nextStageIds.includes(s.id));
                nextBlocks = this.extractBlocks(nextStages);
              }
            }
          } else {
            const startNode = cp.stages.find(s => s.nodeType === 'START');
            if (startNode) {
              nextAllowedStages = this.getNextStageKeys(startNode.id, cp.stages, cp.connections);
            }
          }
    }

    const totalCycles = await prisma.cleaningCycle.count({ where: { filterId } });

    const pipelineStages = cp
      ? cp.stages.filter(s => s.nodeType === "STAGE").map(s => ({ stateKey: s.stateKey, nodeType: s.nodeType, sortOrder: s.sortOrder, configuration: s.configuration }))
      : [];

    // Full pipeline graph for offline nextAllowedStages computation
    const pipelineGraph = cp
      ? {
          stages: cp.stages.map(s => ({ id: s.id, stateKey: s.stateKey, nodeType: s.nodeType, sortOrder: s.sortOrder, configuration: s.configuration })),
          connections: cp.connections.map(c => ({ fromStageId: c.fromStageId, toStageId: c.toStageId })),
          flowMode: cp.flowMode,
        }
      : null;

    // Include equipment group info if cycle has one selected
    let equipmentGroup = null;
    if (currentCycle?.equipmentGroupId) {
      equipmentGroup = await prisma.equipmentGroup.findUnique({
        where: { id: currentCycle.equipmentGroupId },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
    }
    // Fallback: if cycle has no equipment group but has a cleaning area (block),
    // return the first active equipment group for that block so the UI can surface
    // instrument operating ranges (e.g. dryer temperature dropdown).
    if (!equipmentGroup && currentCycle?.cleaningAreaId) {
      equipmentGroup = await prisma.equipmentGroup.findFirst({
        where: { blockId: currentCycle.cleaningAreaId, isActive: true },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    // If no equipment group resolved but block is known, return all active groups
    // for that block so the frontend can offer a selector (or auto-pick the only one).
    let blockEquipmentGroups: any[] = [];
    if (!equipmentGroup && currentCycle?.cleaningAreaId) {
      blockEquipmentGroups = await prisma.equipmentGroup.findMany({
        where: { blockId: currentCycle.cleaningAreaId, isActive: true },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    return {
      filterId: filter.id,
      filterName: filter.name,
      currentState: filter.currentLifecycleState,
      currentCycle,
      nextAllowedStages,
      nextBlocks,
      pendingChecklist,
      pipelineStages,
      pipelineGraph,
      profile,
      filterSet: filter.filterSet,
      totalCycles,
      equipmentGroup,
      blockEquipmentGroups,
      homeBlock,
      blockChangeStatus,
      isPmDue,
      pmReasonKey,
    };
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async submitChecklist(ctx: RequestContext, filterId: string, data: any) {
    const { answers } = data;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    const cycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (!cycle) throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');

    // Validate answers against checklist profile questions
    if (answers && typeof answers === 'object') {
      // Get the pipeline to find checklist nodes for the current stage
      const resolvedProfileId = await this.resolveFilterProfile(filter);
      const cp = resolvedProfileId ? await this.getProfilePipeline(resolvedProfileId) : null;
      if (cp) {
        const currentStage = cp.stages.find(s => s.stateKey === filter.currentLifecycleState);
        if (currentStage) {
          const checklistNodes = collectChecklistsAfterStage(currentStage, cp.stages, cp.connections);
          const resolvedChecklists = await resolveChecklistQuestions(checklistNodes);
          // Collect all valid question IDs and required question IDs
          const validQuestionIds = new Set<string>();
          const requiredQuestionIds = new Set<string>();
          for (const cl of resolvedChecklists) {
            for (const q of cl.questions) {
              validQuestionIds.add(q.id);
              if (q.required) requiredQuestionIds.add(q.id);
            }
          }
          // Check required questions have answers
          for (const qId of requiredQuestionIds) {
            if (answers[qId] === undefined || answers[qId] === null || answers[qId] === '') {
              throw new AppError(400, 'VALIDATION_ERROR', `Required checklist question not answered: ${qId}`);
            }
          }
          // Warn about extra answers for non-existent questions
          const answerKeys = Object.keys(answers);
          const extraKeys = answerKeys.filter(k => !validQuestionIds.has(k));
          if (extraKeys.length > 0) {
            console.warn(`[submitChecklist] Extra answers for non-existent questions: ${extraKeys.join(', ')}`);
          }
        }
      }
    }

    // Record CHECKLIST_COMPLETED event inside a transaction with duplicate check
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

    await prisma.$transaction(async (tx) => {
      // Check for duplicate submission
      const existing = await tx.filterEvent.findFirst({
        where: {
          filterId,
          cycleId: cycle.id,
          eventType: 'CHECKLIST_COMPLETED',
          attributes: { path: ['afterStage'], equals: filter.currentLifecycleState ?? undefined },
        },
      });
      if (existing) throw new AppError(409, 'ALREADY_SUBMITTED', 'Checklist already submitted for this stage');

      await tx.filterEvent.create({
        data: {
          ...eventData,
          checksum,
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CHECKLIST_COMPLETED',
      targetType: 'filter', targetId: filterId,
      afterValue: { stage: filter.currentLifecycleState, answerCount: Object.keys(answers ?? {}).length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async startCycle(ctx: RequestContext, filterId: string, data: any) {
    const { cleaningReasonKey, cleaningAreaId, equipmentGroupId } = data;
    // offlinePerformedAt: original timestamp from when the user performed the action offline
    const offlineTime = data.offlinePerformedAt ? new Date(data.offlinePerformedAt) : undefined;
    const cleaningJustification = typeof data.cleaningJustification === "string" ? data.cleaningJustification.replace(/</g, "&lt;").replace(/>/g, "&gt;") : data.cleaningJustification;

    const filter = await this.getFilter(filterId, ctx);
    const resolvedProfileIdForCycle = await this.resolveFilterProfile(filter);
    if (!resolvedProfileIdForCycle) throw new AppError(400, 'NO_PROFILE', 'Filter has no assigned profile');

    if (filter.currentCycleId) {
      const activeCycle = await prisma.cleaningCycle.findFirst({
        where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
      });
      if (activeCycle) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
    }

    // Validate block change (must be before cycle creation)
    await this.validateBlockChange(filterId, cleaningAreaId, ctx);

    const reasons = await this.getCleaningReasons(resolvedProfileIdForCycle);
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
    // Include filter.id suffix to guarantee uniqueness across filters
    // that share a truncated name prefix (e.g. PRE-A-AHU-01..07 all
    // collapse to "PRE-A-AHU-" when sliced at 10 chars).
    const nameSafe = (filter.name?.replace(/\s+/g, '').slice(0, 20)) ?? filterId.slice(0, 8);
    const idSuffix = filterId.replace(/-/g, '').slice(0, 4);
    const cycleCode = `CC-${orgSlug}-${nameSafe}-${idSuffix}-${String(seq).padStart(3, '0')}-${dateStr}`;

    // Resolve to cleaning profile — could be a FilterProfile ID or a CleaningProfile ID directly
    const fp = await prisma.filterProfile.findUnique({ where: { id: resolvedProfileIdForCycle } });
    const cleaningProfileIdForCycle = fp ? fp.cleaningProfileId : resolvedProfileIdForCycle;
    const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: cleaningProfileIdForCycle } });
    if (cp && cp.status !== 'ACTIVE') {
      throw new AppError(400, 'PROFILE_DISABLED', `Cleaning profile "${cp.name}" is disabled. Contact admin to activate it.`);
    }

    // Use transaction to prevent race conditions on double-start
    const cycle = await prisma["$transaction"](async (tx) => {
      // Re-check inside transaction
      const recheck = await tx.assetInstance.findUnique({ where: { id: filterId }, select: { currentCycleId: true } });
      if (recheck?.currentCycleId) {
        const active = await tx.cleaningCycle.findFirst({ where: { id: recheck.currentCycleId, status: 'IN_PROGRESS' } });
        if (active) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
      }

      // Validate equipment group if provided
      if (equipmentGroupId) {
        const eqGroup = await tx.equipmentGroup.findFirst({
          where: { id: equipmentGroupId, isActive: true },
        });
        if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found or inactive');
      }

      const newCycle = await tx.cleaningCycle.create({
        data: {
          cycleCode, filterId, ahuId: null,
          profileId: resolvedProfileIdForCycle,
          profileVersion: cp?.version ?? 1,
          sequenceNumber: seq, cleaningReasonKey,
          cleaningReasonLabel: reason.name,
          cleaningJustification: cleaningJustification ?? null,
          cleaningAreaId: cleaningAreaId ?? null,
          equipmentGroupId: equipmentGroupId ?? null,
          ...(offlineTime && { startedAt: offlineTime }),
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
          ...(offlineTime && { performedAt: offlineTime }),
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

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async advance(ctx: RequestContext, filterId: string, data: any) {
    const { targetState, parameters, equipmentId, cleaningAreaId, instrumentReadings, equipmentGroupId, dryerAction, dryerDurationMinutes } = data;
    const offlineTime = data.offlinePerformedAt ? new Date(data.offlinePerformedAt) : undefined;
    const remarks = typeof data.remarks === "string" ? data.remarks.replace(/</g, "&lt;").replace(/>/g, "&gt;") : data.remarks;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    const cycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (!cycle) throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');

    const resolvedProfileIdForAdvance = await this.resolveFilterProfile(filter);
    if (!resolvedProfileIdForAdvance) throw new AppError(400, 'NO_PROFILE', 'Filter has no assigned profile');
    const cp = await this.getProfilePipeline(resolvedProfileIdForAdvance, true);
    if (!cp) throw new AppError(400, 'PROFILE_DISABLED', 'Cleaning profile is disabled or not found. Contact admin to activate it.');

    // #12: Enforce checklist completion before allowing advance (only for active checklist profiles)
    const currentState = filter.currentLifecycleState;
    if (currentState) {
      const currentStageForCL = cp.stages.find(s => s.stateKey === currentState);
      if (currentStageForCL) {
        const pendingCLNodes = collectChecklistsAfterStage(currentStageForCL, cp.stages, cp.connections)
          .filter(n => n.configuration?.checklistProfileId);

        // Only enforce checklists whose profiles are still active (batch query)
        const clProfileIds = [...new Set(pendingCLNodes.map(n => (n.configuration as any).checklistProfileId).filter(Boolean))];
        const activeProfiles = clProfileIds.length > 0
          ? await prisma.checklistProfile.findMany({ where: { id: { in: clProfileIds }, isActive: true }, select: { id: true } })
          : [];
        const activeProfileIds = new Set(activeProfiles.map(p => p.id));
        const activeCLNodes = pendingCLNodes.filter(n => activeProfileIds.has((n.configuration as any).checklistProfileId));

        if (activeCLNodes.length > 0) {
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
      // SUBMIT_READINGS with targetState=DRY_IN stays at DRY_IN (records temp without advancing)
      const isDryerReadingsInPlace = dryerAction === 'SUBMIT_READINGS' && targetState === 'DRY_IN';
      if (!reachableStages.includes(targetState) && cp.flowMode !== 'BYPASS_ENABLED' && !isDryerReadingsInPlace) {
        throw new AppError(400, 'OUT_OF_SEQUENCE', `Cannot move to ${targetState} from ${currentState ?? 'START'}. Next allowed: ${reachableStages.join(', ')}`);
      }
    }

    const targetStage = cp.stages.find(s => s.stateKey === targetState);
    if (!targetStage) throw new AppError(400, 'INVALID_TARGET', `Invalid target state: ${targetState}`);

    const paramBlocks = cp.stages.filter(s => s.nodeType === 'PARAM_CAPTURE');
    for (const block of paramBlocks) {
      const config = block.configuration as any; // Prisma Json type
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

    // Validate equipment group if provided at WASH_IN and not yet set (write deferred to transaction)
    if (equipmentGroupId && !cycle.equipmentGroupId) {
      const eqGroup = await prisma.equipmentGroup.findFirst({
        where: { id: equipmentGroupId, isActive: true },
      });
      if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found or inactive');
    }

    // Dryer SET_DURATION: must be advancing INTO DRY_IN, no readings expected
    if (dryerAction === 'SET_DURATION') {
      if (targetState !== 'DRY_IN') throw new AppError(400, 'INVALID_DRYER_ACTION', 'SET_DURATION only valid for DRY_IN');
      if (!dryerDurationMinutes || dryerDurationMinutes < 1) throw new AppError(400, 'INVALID_DURATION', 'dryerDurationMinutes required');
    }

    // Dryer SUBMIT_READINGS: validate half-time elapsed
    if (dryerAction === 'SUBMIT_READINGS') {
      if (filter.currentLifecycleState !== 'DRY_IN') throw new AppError(400, 'NOT_IN_DRY_IN', 'Filter is not in DRY_IN');
      if (!cycle.dryerStartedAt || !cycle.dryerDurationMinutes) {
        throw new AppError(400, 'DRYER_NOT_STARTED', 'Dryer duration not set');
      }
      const halfMs = (cycle.dryerDurationMinutes * 60_000) / 2;
      const elapsedMs = Date.now() - new Date(cycle.dryerStartedAt).getTime();
      if (elapsedMs < halfMs) {
        const remainingMin = Math.ceil((halfMs - elapsedMs) / 60_000);
        throw new AppError(400, 'DRYER_NOT_READY', `Dryer still running. Wait ${remainingMin} more minute(s).`);
      }
    }

    // Guard: leaving DRY_IN requires the dryer to have run at least half its duration
    if (filter.currentLifecycleState === 'DRY_IN' && targetState !== 'DRY_IN') {
      if (cycle.dryerStartedAt && cycle.dryerDurationMinutes) {
        const halfMs = (cycle.dryerDurationMinutes * 60_000) / 2;
        const elapsedMs = Date.now() - new Date(cycle.dryerStartedAt).getTime();
        if (elapsedMs < halfMs) {
          const remainingMin = Math.ceil((halfMs - elapsedMs) / 60_000);
          throw new AppError(400, 'DRYER_NOT_READY', `Dryer still running. Wait ${remainingMin} more minute(s) before leaving DRY_IN.`);
        }
      }
    }

    // Validate instrument readings if provided
    let validatedReadings: any = null;
    if (instrumentReadings && typeof instrumentReadings === 'object' && Object.keys(instrumentReadings).length > 0) {
      let cycleGroupId = equipmentGroupId ?? cycle.equipmentGroupId;
      // Auto-resolve: if no group on cycle but block is known, pick the block's active group
      if (!cycleGroupId && cycle.cleaningAreaId) {
        const blockGroups = await prisma.equipmentGroup.findMany({
          where: { blockId: cycle.cleaningAreaId, isActive: true },
          select: { id: true },
        });
        if (blockGroups.length === 1) {
          cycleGroupId = blockGroups[0].id;
          // Persist on cycle so future requests don't need to re-resolve
          await prisma.cleaningCycle.update({ where: { id: cycle.id }, data: { equipmentGroupId: cycleGroupId } });
        } else if (blockGroups.length > 1) {
          throw new AppError(400, 'MULTIPLE_EQUIPMENT_GROUPS', 'Multiple equipment groups found for this block. Please select one.');
        }
      }
      if (!cycleGroupId) throw new AppError(400, 'NO_EQUIPMENT_GROUP', 'Equipment group must be selected before submitting readings');

      const eqGroup = await prisma.equipmentGroup.findUnique({
        where: { id: cycleGroupId },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found');

      // Filter instruments for the target stage (or DRY_IN when submitting dryer readings)
      const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
      const stageInstruments = eqGroup.instruments.filter(i => i.stageKey === readingsStageKey);

      validatedReadings = [];
      for (const inst of stageInstruments) {
        const reading = instrumentReadings[inst.id];
        if (reading === undefined || reading === null) {
          throw new AppError(400, 'READING_REQUIRED', `Reading required for ${inst.description} (${inst.instrumentId})`);
        }
        const val = Number(reading);
        if (isNaN(val)) {
          throw new AppError(400, 'INVALID_READING', `Invalid reading value for ${inst.description}`);
        }
        if (val < inst.operatingMin || val > inst.operatingMax) {
          throw new AppError(400, 'READING_OUT_OF_RANGE', `${inst.description} reading ${val} is outside operating range (${inst.operatingMin}–${inst.operatingMax})`);
        }
        validatedReadings.push({
          instrumentId: inst.id,
          instrumentCode: inst.instrumentId,
          description: inst.description,
          value: val,
          uom: inst.uom,
        });
      }
    }

    const eventAttributes = {
      ...(parameters ?? {}),
      ...(validatedReadings ? { instrumentReadings: validatedReadings } : {}),
    };

    const eventData = {
      filterId, cycleId: cycle.id, eventType: 'STATE_TRANSITION' as const,
      fromState, toState: targetState,
      performedBy: ctx.userSub,
      cleaningAreaId: cleaningAreaId ?? null,
      equipmentId: equipmentId ?? null,
      attributes: eventAttributes,
      remarks: remarks ?? null,
    };
    const checksum = computeChecksum(eventData);

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

    // Wrap all writes in a single transaction
    await prisma.$transaction(async (tx) => {
      // Re-validate state inside transaction to prevent race conditions
      const lockedFilter = await tx.assetInstance.findFirst({
        where: { id: filterId },
        select: { currentLifecycleState: true, currentCycleId: true },
      });
      if (lockedFilter?.currentLifecycleState !== currentState) {
        throw new AppError(409, 'STATE_CHANGED', 'Filter state was modified by another user. Please refresh and try again.');
      }
      if (lockedFilter?.currentCycleId !== cycle.id) {
        throw new AppError(409, 'CYCLE_CHANGED', 'Cleaning cycle changed. Please refresh and try again.');
      }

      // Update equipment group if provided and not yet set
      if (equipmentGroupId && !cycle.equipmentGroupId) {
        await tx.cleaningCycle.update({
          where: { id: cycle.id },
          data: { equipmentGroupId },
        });
      }

      // Dryer SET_DURATION: persist duration + start time, emit DRYER_STARTED event
      if (dryerAction === 'SET_DURATION') {
        const startedAt = new Date();
        await tx.cleaningCycle.update({
          where: { id: cycle.id },
          data: { dryerDurationMinutes, dryerStartedAt: startedAt },
        });
        const dryerEvent = {
          filterId, cycleId: cycle.id, eventType: 'STATE_TRANSITION' as const,
          fromState: filter.currentLifecycleState, toState: targetState,
          performedBy: ctx.userSub,
          attributes: { dryerDurationMinutes, dryerStartedAt: startedAt.toISOString(), action: 'DRYER_STARTED' },
          remarks: `Dryer started for ${dryerDurationMinutes} minute(s)`,
        };
        await tx.filterEvent.create({
          data: {
            ...dryerEvent,
            checksum: computeChecksum(dryerEvent),
            ipAddress: ctx.ipAddress,
            telemetrySnapshot: {},
          },
        });
      }

      await tx.filterEvent.create({
        data: {
          ...eventData,
          checksum,
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
          ...(offlineTime && { performedAt: offlineTime }),
        },
      });

      // Mark dryer readings as submitted (DRY_IN stays, user advances to DRY_OUT later)
      if (dryerAction === 'SUBMIT_READINGS') {
        await tx.cleaningCycle.update({
          where: { id: cycle.id },
          data: { dryerReadingsSubmitted: true },
        });
      }

      await tx.assetInstance.update({
        where: { id: filterId },
        data: { currentLifecycleState: targetState },
      });

      if (leadsToEnd && !hasMoreStages) {
        await tx.cleaningCycle.update({
          where: { id: cycle.id },
          data: { status: 'COMPLETED', completedAt: offlineTime ?? new Date() },
        });
        await tx.assetInstance.update({
          where: { id: filterId },
          data: { currentCycleId: null, currentLifecycleState: null },
        });

        const completeEvent = {
          filterId, cycleId: cycle.id, eventType: 'CYCLE_COMPLETED' as const,
          performedBy: ctx.userSub, attributes: { sequenceNumber: cycle.sequenceNumber },
        };
        await tx.filterEvent.create({
          data: {
            ...completeEvent,
            checksum: computeChecksum(completeEvent),
            ipAddress: ctx.ipAddress,
            telemetrySnapshot: {},
          },
        });
      }
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'STATE_TRANSITION',
      targetType: 'filter', targetId: filterId,
      beforeValue: { state: fromState },
      afterValue: { state: targetState },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async bypass(ctx: RequestContext, filterId: string, data: any) {
    const { targetState, parameters } = data;
    const justification = typeof data.justification === "string" ? data.justification.replace(/</g, "&lt;").replace(/>/g, "&gt;") : data.justification;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle — start a cycle before bypassing');

    const resolvedProfileIdForBypass = await this.resolveFilterProfile(filter);
    const cp = resolvedProfileIdForBypass ? await this.getProfilePipeline(resolvedProfileIdForBypass, true) : null;
    if (!cp) {
      throw new AppError(400, 'PROFILE_DISABLED', 'Cleaning profile is disabled or not found.');
    }
    if (cp.flowMode !== 'BYPASS_ENABLED') {
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

    await prisma.$transaction(async (tx) => {
      // Re-validate state inside transaction to prevent race conditions
      const lockedFilter = await tx.assetInstance.findFirst({
        where: { id: filterId },
        select: { currentLifecycleState: true, currentCycleId: true },
      });
      if (lockedFilter?.currentLifecycleState !== filter.currentLifecycleState) {
        throw new AppError(409, 'STATE_CHANGED', 'Filter state was modified by another user. Please refresh and try again.');
      }

      await tx.filterEvent.create({
        data: {
          ...eventData,
          checksum,
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });

      await tx.assetInstance.update({
        where: { id: filterId },
        data: { currentLifecycleState: targetState },
      });
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

  /** @param query - Validated by Fastify JSON schema before reaching this method */
  async getEvents(ctx: RequestContext, query: any) {
    // Verify filterId belongs to user's org if provided
    if (query.filterId) {
      await this.getFilter(query.filterId, ctx);
    }

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

  async getDashboardStats(ctx: RequestContext) {
    const orgWhere = ctx.organizationId ? { filter: { organizationId: ctx.organizationId } } : {};

    // 1. Filters by current lifecycle stage
    const stageCountsRaw = await prisma.assetInstance.groupBy({
      by: ['currentLifecycleState'],
      where: { isActive: true, currentLifecycleState: { not: null }, ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}) },
      _count: true,
    });
    const stageCounts: Record<string, number> = {};
    for (const row of stageCountsRaw) {
      if (row.currentLifecycleState) stageCounts[row.currentLifecycleState] = row._count;
    }

    // Org-scoped filter IDs for cycle queries (prevents cross-tenant data leak)
    const orgFilterIds = ctx.organizationId
      ? (await prisma.assetInstance.findMany({
          where: { organizationId: ctx.organizationId, template: { name: 'Filter' } },
          select: { id: true },
        })).map(f => f.id)
      : null;
    const cycleOrgWhere = orgFilterIds ? { filterId: { in: orgFilterIds } } : {};

    // 2. Cycle status breakdown
    const statusCountsRaw = await prisma.cleaningCycle.groupBy({
      by: ['status'],
      where: cycleOrgWhere,
      _count: true,
    });
    const statusCounts: Record<string, number> = {};
    for (const row of statusCountsRaw) statusCounts[row.status] = row._count;

    // 3. Daily cycle counts (last 30 days)
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyRaw: any[] = orgFilterIds
      ? await prisma.$queryRawUnsafe(`
          SELECT DATE(started_at) as day, COUNT(*)::int as count
          FROM cleaning_cycles
          WHERE started_at >= $1 AND filter_id = ANY($2::uuid[])
          GROUP BY DATE(started_at) ORDER BY day
        `, thirtyDaysAgo, orgFilterIds)
      : await prisma.$queryRawUnsafe(`
          SELECT DATE(started_at) as day, COUNT(*)::int as count
          FROM cleaning_cycles
          WHERE started_at >= $1
          GROUP BY DATE(started_at) ORDER BY day
        `, thirtyDaysAgo);
    const dailyCycles = dailyRaw.map(r => ({ day: r.day, count: r.count }));

    // 4. Monthly cycle counts (last 12 months)
    const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const monthlyRaw: any[] = orgFilterIds
      ? await prisma.$queryRawUnsafe(`
          SELECT TO_CHAR(started_at, 'YYYY-MM') as month, COUNT(*)::int as count
          FROM cleaning_cycles
          WHERE started_at >= $1 AND filter_id = ANY($2::uuid[])
          GROUP BY TO_CHAR(started_at, 'YYYY-MM') ORDER BY month
        `, twelveMonthsAgo, orgFilterIds)
      : await prisma.$queryRawUnsafe(`
          SELECT TO_CHAR(started_at, 'YYYY-MM') as month, COUNT(*)::int as count
          FROM cleaning_cycles
          WHERE started_at >= $1
          GROUP BY TO_CHAR(started_at, 'YYYY-MM') ORDER BY month
        `, twelveMonthsAgo);
    const monthlyCycles = monthlyRaw.map(r => ({ month: r.month, count: r.count }));

    // 5. Total filters + active cycles
    const totalFilters = await prisma.assetInstance.count({
      where: { isActive: true, ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}), template: { name: 'Filter' } },
    });
    const activeCycles = await prisma.cleaningCycle.count({ where: { status: 'IN_PROGRESS', ...cycleOrgWhere } });
    const completedToday = await prisma.cleaningCycle.count({
      where: { status: 'COMPLETED', completedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) }, ...cycleOrgWhere },
    });

    return { stageCounts, statusCounts, dailyCycles, monthlyCycles, totalFilters, activeCycles, completedToday };
  }

  /** @param query - Validated by Fastify JSON schema before reaching this method */
  async getCycles(ctx: RequestContext, query: any) {
    // Verify filterId belongs to user's org if provided
    if (query.filterId) {
      await this.getFilter(query.filterId, ctx);
    }

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

    // Enrich with filter + cleaning area names in a single query
    const allAssetIds = [...new Set([
      ...data.map((c: any) => c.filterId),
      ...data.map((c: any) => c.cleaningAreaId).filter(Boolean) as string[],
    ])];

    const allAssets = allAssetIds.length > 0 ? await prisma.assetInstance.findMany({
      where: { id: { in: allAssetIds } },
      select: { id: true, name: true, filterSet: true },
    }) : [];
    const assetMap = new Map(allAssets.map(a => [a.id, a]));

    // Resolve performedBy UUIDs to user display names
    const allPerformerIds = [...new Set(
      data.flatMap((c: any) => (c.events ?? []).map((e: any) => e.performedBy).filter(Boolean)),
    )] as string[];
    const performers = allPerformerIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: allPerformerIds } },
      select: { id: true, username: true, fullName: true },
    }) : [];
    const userMap = new Map(performers.map(u => [u.id, u.fullName || u.username]));

    const enriched = data.map(c => ({
      ...c,
      filterName: assetMap.get(c.filterId)?.name ?? null,
      filterSet: assetMap.get(c.filterId)?.filterSet ?? null,
      cleaningAreaName: c.cleaningAreaId ? (assetMap.get(c.cleaningAreaId)?.name ?? null) : null,
      ...((c as any).events ? {
        events: (c as any).events.map((e: any) => ({
          ...e,
          performedByName: e.performedBy ? userMap.get(e.performedBy) ?? null : null,
        })),
      } : {}),
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getCycleById(ctx: RequestContext, id: string) {
    const cycle = await prisma.cleaningCycle.findUnique({
      where: { id },
      include: { events: { orderBy: { performedAt: 'asc' } } },
    });
    if (!cycle) throw new AppError(404, 'NOT_FOUND', 'Cleaning cycle not found');

    // Verify the cycle's filter belongs to user's org
    if (cycle.filterId) {
      await this.getFilter(cycle.filterId, ctx);
    }

    // Enrich with filter name and AHU (parent) name
    const filter = await prisma.assetInstance.findUnique({
      where: { id: cycle.filterId },
      select: { id: true, name: true, filterSet: true, parentId: true },
    });
    const ahu = filter?.parentId ? await prisma.assetInstance.findUnique({
      where: { id: filter.parentId },
      select: { name: true },
    }) : null;

    // Resolve performedBy UUIDs to user names
    const performerIds = [...new Set(cycle.events.map(e => e.performedBy).filter(Boolean) as string[])];
    const users = performerIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: performerIds } },
      select: { id: true, username: true, fullName: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.fullName || u.username]));

    // Resolve checklist question IDs to question text
    const allQuestionIds = cycle.events
      .filter(e => e.eventType === 'CHECKLIST_COMPLETED' && (e.attributes as any)?.answers)
      .flatMap(e => Object.keys((e.attributes as any).answers));
    const uniqueQuestionIds = [...new Set(allQuestionIds)];
    const questions = uniqueQuestionIds.length > 0 ? await prisma.checklistQuestion.findMany({
      where: { id: { in: uniqueQuestionIds } },
      select: { id: true, question: true },
    }) : [];
    const questionMap = new Map(questions.map(q => [q.id, q.question]));

    const enrichedEvents = cycle.events.map(e => {
      const enriched: any = { ...e, performedByName: e.performedBy ? userMap[e.performedBy] ?? null : null };
      if (e.eventType === 'CHECKLIST_COMPLETED' && (e.attributes as any)?.answers) {
        const answers = (e.attributes as any).answers;
        enriched.enrichedAnswers = Object.entries(answers).map(([qId, answer]) => ({
          questionId: qId,
          question: questionMap.get(qId) ?? qId,
          answer,
        }));
      }
      return enriched;
    });

    // Resolve cleaning area name
    const area = cycle.cleaningAreaId ? await prisma.assetInstance.findUnique({
      where: { id: cycle.cleaningAreaId },
      select: { name: true },
    }) : null;

    return {
      ...cycle,
      events: enrichedEvents,
      filterName: filter?.name ?? null,
      filterSet: filter?.filterSet ?? null,
      ahuName: ahu?.name ?? null,
      cleaningAreaName: area?.name ?? null,
    };
  }

  async terminateCycle(ctx: RequestContext, filterId: string, data: { justification: string }) {
    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    const justification = typeof data.justification === 'string' ? data.justification.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    if (!justification || justification.length < 10) {
      throw new AppError(400, 'JUSTIFICATION_REQUIRED', 'Justification required (min 10 characters)');
    }

    await prisma.$transaction(async (tx) => {
      await tx.cleaningCycle.update({
        where: { id: filter.currentCycleId! },
        data: { status: 'TERMINATED', completedAt: new Date() },
      });
      await tx.assetInstance.update({
        where: { id: filterId },
        data: { currentCycleId: null, currentLifecycleState: null },
      });
      const eventData = {
        filterId, cycleId: filter.currentCycleId!, eventType: 'CYCLE_TERMINATED' as const,
        performedBy: ctx.userSub, attributes: { justification },
        remarks: justification,
      };
      await tx.filterEvent.create({
        data: { ...eventData, checksum: computeChecksum(eventData), ipAddress: ctx.ipAddress, telemetrySnapshot: {} },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CYCLE_TERMINATED',
      targetType: 'filter', targetId: filterId,
      afterValue: { cycleId: filter.currentCycleId, justification },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  /**
   * Retire a filter — sets status to Retired, terminates active cycle, creates audit log.
   */
  async retire(ctx: RequestContext, filterId: string, remarks: string) {
    const filter = await this.getFilter(filterId, ctx);

    // Already retired?
    if (filter.currentLifecycleState === 'RETIRED') {
      throw new AppError(400, 'ALREADY_RETIRED', 'Filter is already retired');
    }

    // Retire the filter, terminate cycle, and remove from tree — all in one transaction
    await prisma.$transaction(async (tx) => {
      // Terminate active cycle if any
      if (filter.currentCycleId) {
        await tx.cleaningCycle.updateMany({
          where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
          data: { status: 'TERMINATED', completedAt: new Date() },
        });
      }

      // Save original parentId in customAttributes so unretire can restore it
      const existingCustom = (filter as any).customAttributes ?? {};
      await tx.assetInstance.update({
        where: { id: filterId },
        data: {
          status: 'Retired',
          currentLifecycleState: 'RETIRED',
          currentCycleId: null,
          isActive: false,
          parentId: null,
          customAttributes: { ...existingCustom, _preRetireParentId: filter.parentId },
        },
      });

      // Remove all relationships (CONTAINS/CONTAINED_IN) so retired filter disappears from tree
      await tx.assetRelationship.deleteMany({
        where: { OR: [{ sourceAssetId: filterId }, { targetAssetId: filterId }] },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'FILTER_RETIRED',
      targetType: 'filter', targetId: filterId,
      afterValue: { remarks, filterName: filter.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  /**
   * Replace a filter — retires old filter, creates new one with incremented suffix.
   */
  async replace(ctx: RequestContext, filterId: string, remarks: string) {
    const instance = await prisma.assetInstance.findFirst({
      where: { id: filterId },
    });
    if (!instance) throw new AppError(404, 'NOT_FOUND', 'Filter not found');

    // Calculate new name: increment suffix
    const oldName = instance.name;
    const match = oldName.match(/-(\d+)$/);
    let newName: string;
    if (match) {
      const num = parseInt(match[1]) + 1;
      newName = oldName.replace(/-\d+$/, '-' + String(num).padStart(2, '0'));
    } else {
      newName = oldName + '-01';
    }

    // Retire old filter first
    await this.retire(ctx, filterId, remarks);

    // Create replacement filter + relationships in a transaction (rollback on failure)
    let newFilter: any;
    try {
      newFilter = await prisma.$transaction(async (tx) => {
        const created = await tx.assetInstance.create({
          data: {
            name: newName,
            templateId: instance.templateId,
            templateVersion: instance.templateVersion,
            parentId: instance.parentId,
            filterSet: instance.filterSet,
            filterProfileId: instance.filterProfileId,
            attributes: instance.attributes ?? {},
            organizationId: instance.organizationId,
            status: 'Active',
            isActive: true,
            createdBy: ctx.userId ?? ctx.userSub,
          },
        });

        // Create relationships with parent (same as old filter)
        if (instance.parentId) {
          await tx.assetRelationship.create({
            data: {
              sourceAssetId: instance.parentId,
              targetAssetId: created.id,
              relationshipType: 'CONTAINS',
              createdBy: ctx.userId ?? ctx.userSub,
            },
          });
          await tx.assetRelationship.create({
            data: {
              sourceAssetId: created.id,
              targetAssetId: instance.parentId,
              relationshipType: 'CONTAINED_IN',
              createdBy: ctx.userId ?? ctx.userSub,
            },
          });
        }

        return created;
      });
    } catch (err) {
      // Re-activate the retired filter if replacement creation fails
      await prisma.assetInstance.update({
        where: { id: filterId },
        data: { status: 'Active', currentLifecycleState: null, isActive: true },
      });
      throw err;
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'FILTER_REPLACED',
      targetType: 'filter', targetId: filterId,
      afterValue: {
        oldFilterId: filterId,
        oldFilterName: oldName,
        newFilterId: newFilter.id,
        newFilterName: newName,
        remarks,
      },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return {
      success: true,
      oldFilterId: filterId,
      newFilterId: newFilter.id,
      newFilterName: newName,
    };
  }

  /**
   * Get all retired filters.
   */
  async getRetirements(ctx: RequestContext) {
    const retirements = await prisma.assetInstance.findMany({
      where: { status: 'Retired', isActive: false, ...orgWhere(ctx) },
      select: {
        id: true, name: true, updatedAt: true, attributes: true,
        filterSet: true, parentId: true, customAttributes: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Resolve original parent names for display
    const parentIds = retirements
      .map((r: any) => (r.customAttributes as any)?._preRetireParentId)
      .filter(Boolean) as string[];
    const parents = parentIds.length > 0
      ? await prisma.assetInstance.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
      : [];
    const parentMap = new Map(parents.map(p => [p.id, p.name]));

    return retirements.map((r: any) => {
      const preRetireParentId = (r.customAttributes as any)?._preRetireParentId ?? null;
      return {
        id: r.id, name: r.name, updatedAt: r.updatedAt,
        attributes: r.attributes, filterSet: r.filterSet, parentId: r.parentId,
        preRetireParentId,
        preRetireParentName: preRetireParentId ? parentMap.get(preRetireParentId) ?? null : null,
      };
    });
  }

  /**
   * Get replacement history from audit trail.
   */
  async getReplacements(ctx: RequestContext) {
    const records = await prisma.auditTrail.findMany({
      where: { action: 'FILTER_REPLACED' },
      select: { id: true, userId: true, userName: true, timestamp: true, afterValue: true },
      orderBy: { timestamp: 'desc' },
    });

    const mapped = records.map(r => {
      const val = r.afterValue as any ?? {};
      return {
        id: r.id,
        oldFilterId: val.oldFilterId ?? null,
        oldFilterName: val.oldFilterName ?? null,
        newFilterId: val.newFilterId ?? null,
        newFilterName: val.newFilterName ?? null,
        remarks: val.remarks ?? null,
        replacedAt: r.timestamp,
        performedBy: r.userName ?? r.userId,
      };
    });

    // Org-scope: only return replacements where the filter belongs to user's org
    const orgFilter = orgWhere(ctx);
    if (orgFilter.organizationId) {
      const filterIds = [...new Set(mapped.map(r => r.oldFilterId).filter(Boolean) as string[])];
      const orgFilters = filterIds.length > 0 ? await prisma.assetInstance.findMany({
        where: { id: { in: filterIds }, organizationId: orgFilter.organizationId },
        select: { id: true },
      }) : [];
      const orgFilterIdSet = new Set(orgFilters.map(f => f.id));
      return mapped.filter(r => !r.oldFilterId || orgFilterIdSet.has(r.oldFilterId));
    }

    return mapped;
  }

  async getCleaningReasons(profileId?: string) {
    if (profileId) {
      // Try as FilterProfile first, then as CleaningProfile directly
      const fp = await prisma.filterProfile.findUnique({ where: { id: profileId } });
      const cpId = fp ? fp.cleaningProfileId : profileId;
      const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: cpId } });
      if (cp?.cleaningReasons) return cp.cleaningReasons as any[];
    }
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
    const val = cfg?.configValue as any;
    return Array.isArray(val) ? val : (val?.value ?? []);
  }
}
