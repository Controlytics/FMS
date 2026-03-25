/**
 * Filter Operations Service — Core operations: cycle management, stage advancement, bypass.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { createHash } from 'node:crypto';

function computeChecksum(data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export class FilterOperationsService {
  async getCurrentState(ctx: RequestContext, filterId: string) {
    const filter = await prisma.assetInstance.findUnique({
      where: { id: filterId },
      select: {
        id: true, name: true, filterProfileId: true,
        currentLifecycleState: true, currentCycleId: true, filterSet: true,
      },
    });
    if (!filter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');

    let currentCycle = null;
    if (filter.currentCycleId) {
      currentCycle = await prisma.cleaningCycle.findUnique({ where: { id: filter.currentCycleId } });
    }

    let profile = null;
    let nextAllowedStages: string[] = [];
    let nextBlocks: any[] = [];

    if (filter.filterProfileId) {
      const fp = await prisma.filterProfile.findUnique({ where: { id: filter.filterProfileId } });
      if (fp) {
        const cp = await prisma.filterCleaningProfile.findUnique({
          where: { id: fp.cleaningProfileId },
          include: { stages: { orderBy: { sortOrder: 'asc' } }, connections: true },
        });
        if (cp) {
          profile = { name: cp.name, flowMode: cp.flowMode };
          // Find next stages from current state
          if (filter.currentLifecycleState && currentCycle) {
            const currentStage = cp.stages.find(s => s.stateKey === filter.currentLifecycleState);
            if (currentStage) {
              const outConns = cp.connections.filter(c => c.fromStageId === currentStage.id);
              const nextStageIds = outConns.map(c => c.toStageId);
              const nextStages = cp.stages.filter(s => nextStageIds.includes(s.id));
              nextAllowedStages = nextStages.filter(s => s.nodeType === 'STAGE').map(s => s.stateKey!).filter(Boolean);
              nextBlocks = nextStages.filter(s => s.nodeType !== 'STAGE' && s.nodeType !== 'END').map(s => ({
                nodeType: s.nodeType,
                configuration: s.configuration,
              }));
            }
          }
        }
      }
    }

    const totalCycles = await prisma.cleaningCycle.count({ where: { filterId } });

    // Fetch full pipeline stages
    let pipelineStages: any[] = [];
    if (filter.filterProfileId) {
      const fpx = await prisma.filterProfile.findUnique({ where: { id: filter.filterProfileId } });
      if (fpx) {
        const cpx = await prisma.filterCleaningProfile.findUnique({
          where: { id: fpx.cleaningProfileId },
          include: { stages: { orderBy: { sortOrder: "asc" } } },
        });
        if (cpx) {
          pipelineStages = cpx.stages
            .filter(s => s.nodeType === "STAGE")
            .map(s => ({ stateKey: s.stateKey, nodeType: s.nodeType, sortOrder: s.sortOrder, configuration: s.configuration }));
        }
      }
    }

    return {
      filterId: filter.id,
      filterName: filter.name,
      currentState: filter.currentLifecycleState,
      currentCycle,
      nextAllowedStages,
      nextBlocks,
      pipelineStages,
      profile,
      filterSet: filter.filterSet,
      totalCycles,
    };
  }

  async startCycle(ctx: RequestContext, filterId: string, data: any) {
    const { cleaningReasonKey, cleaningJustification, cleaningAreaId } = data;

    const filter = await prisma.assetInstance.findUnique({
      where: { id: filterId },
      select: { id: true, name: true, filterProfileId: true, currentCycleId: true, organizationId: true },
    });
    if (!filter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
    if (!filter.filterProfileId) throw new AppError(400, 'NO_PROFILE', 'Filter has no assigned profile');

    // Check no active cycle
    if (filter.currentCycleId) {
      const activeCycle = await prisma.cleaningCycle.findFirst({
        where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
      });
      if (activeCycle) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
    }

    // Get cleaning reasons
    const reasons = await this.getCleaningReasons(filter.filterProfileId);
    if (!cleaningReasonKey) {
      throw new AppError(400, 'REASON_REQUIRED', 'Cleaning reason is required');
    }
    const reason = reasons.find((r: any) => r.key === cleaningReasonKey);
    if (!reason) throw new AppError(400, 'INVALID_REASON', `Invalid cleaning reason: ${cleaningReasonKey}`);
    if (reason.requiresJustification && (!cleaningJustification || cleaningJustification.length < 10)) {
      throw new AppError(400, 'JUSTIFICATION_REQUIRED', 'Justification required (min 10 characters) for this cleaning reason');
    }

    // Get org slug for cycle code
    const org = filter.organizationId
      ? await prisma.organization.findUnique({ where: { id: filter.organizationId }, select: { slug: true } })
      : null;
    const orgSlug = (org?.slug ?? 'ORG').toUpperCase().slice(0, 10);

    // Get next sequence number
    const prevCycleCount = await prisma.cleaningCycle.count({ where: { filterId } });
    const seq = prevCycleCount + 1;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cycleCode = `CC-${orgSlug}-${filter.name?.replace(/\s+/g, '').slice(0, 10) ?? filterId.slice(0, 8)}-${String(seq).padStart(3, '0')}-${dateStr}`;

    // Get profile version
    const fp = await prisma.filterProfile.findUnique({ where: { id: filter.filterProfileId } });
    const cp = fp ? await prisma.filterCleaningProfile.findUnique({ where: { id: fp.cleaningProfileId } }) : null;

    const cycle = await prisma.cleaningCycle.create({
      data: {
        cycleCode,
        filterId,
        ahuId: null,
        profileId: filter.filterProfileId,
        profileVersion: cp?.version ?? 1,
        sequenceNumber: seq,
        cleaningReasonKey,
        cleaningReasonLabel: reason.name,
        cleaningJustification: cleaningJustification ?? null,
        cleaningAreaId: cleaningAreaId ?? null,
      },
    });

    // Create CYCLE_STARTED event
    const eventData = {
      filterId, cycleId: cycle.id, eventType: 'CYCLE_STARTED' as const,
      performedBy: ctx.userSub, cleaningAreaId: cleaningAreaId ?? null,
      attributes: { cleaningReasonKey, cleaningReasonLabel: reason.name },
      remarks: cleaningJustification ?? null,
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

    // Update filter
    await prisma.assetInstance.update({
      where: { id: filterId },
      data: { currentCycleId: cycle.id },
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
    const { targetState, parameters, equipmentId, cleaningAreaId, remarks } = data;

    const filter = await prisma.assetInstance.findUnique({
      where: { id: filterId },
      select: { id: true, filterProfileId: true, currentLifecycleState: true, currentCycleId: true },
    });
    if (!filter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    const cycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (!cycle) throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');

    // Get pipeline
    const fp = await prisma.filterProfile.findUnique({ where: { id: filter.filterProfileId! } });
    const cp = fp ? await prisma.filterCleaningProfile.findUnique({
      where: { id: fp.cleaningProfileId },
      include: { stages: { orderBy: { sortOrder: 'asc' } }, connections: true },
    }) : null;
    if (!cp) throw new AppError(500, 'NO_PROFILE', 'Pipeline profile not found');

    // Validate target state
    const targetStage = cp.stages.find(s => s.stateKey === targetState || (s.nodeType === 'END' && targetState === 'END'));
    if (!targetStage) throw new AppError(400, 'INVALID_TARGET', `Invalid target state: ${targetState}`);

    // Validate parameter capture if required
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

    // Create state transition event
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

    // Check if target is END — complete cycle
    if (targetStage.nodeType === 'END') {
      await prisma.cleaningCycle.update({
        where: { id: cycle.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await prisma.assetInstance.update({
        where: { id: filterId },
        data: { currentLifecycleState: 'READY_FOR_USE', currentCycleId: null },
      });

      // Create CYCLE_COMPLETED event
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
    } else {
      await prisma.assetInstance.update({
        where: { id: filterId },
        data: { currentLifecycleState: targetState },
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
    const { targetState, justification, parameters } = data;

    const filter = await prisma.assetInstance.findUnique({
      where: { id: filterId },
      select: { id: true, filterProfileId: true, currentLifecycleState: true, currentCycleId: true },
    });
    if (!filter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');

    // Check flow mode
    const fp = filter.filterProfileId ? await prisma.filterProfile.findUnique({ where: { id: filter.filterProfileId } }) : null;
    const cp = fp ? await prisma.filterCleaningProfile.findUnique({ where: { id: fp.cleaningProfileId } }) : null;
    if (cp?.flowMode !== 'BYPASS_ENABLED') {
      throw new AppError(403, 'BYPASS_FORBIDDEN', 'Profile flow mode is STRICT — bypass not allowed');
    }

    if (!justification || justification.length < 10) {
      throw new AppError(400, 'JUSTIFICATION_REQUIRED', 'Bypass justification required (min 10 characters)');
    }

    const fromState = filter.currentLifecycleState;

    // Create bypass deviation event
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

    const [data, total] = await Promise.all([
      prisma.cleaningCycle.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { startedAt: 'desc' },
      }),
      prisma.cleaningCycle.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getCycleById(ctx: RequestContext, id: string) {
    const cycle = await prisma.cleaningCycle.findUnique({
      where: { id },
      include: { events: { orderBy: { performedAt: 'asc' } } },
    });
    if (!cycle) throw new AppError(404, 'NOT_FOUND', 'Cleaning cycle not found');
    return cycle;
  }

  async getCleaningReasons(profileId?: string) {
    // Check profile-specific reasons first
    if (profileId) {
      const fp = await prisma.filterProfile.findUnique({ where: { id: profileId } });
      if (fp) {
        const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: fp.cleaningProfileId } });
        if (cp?.cleaningReasons) return cp.cleaningReasons as any[];
      }
    }
    // Fall back to global
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
    return (cfg?.configValue as any[]) ?? [];
  }
}
