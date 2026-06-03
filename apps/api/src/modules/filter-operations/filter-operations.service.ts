/**
 * Filter Operations Service — Core operations: cycle management, stage advancement, bypass.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  getFilter,
  getFilterHomeBlock,
  validateBlockChange,
  getProfilePipeline,
  getCleaningReasons,
} from './filter-resolver.js';
import { getProfileOrderedStages } from './stage-rules.js';
import { terminateCycleImpl } from './cycle-write/terminate-cycle.js';
import { bypassImpl } from './cycle-write/bypass.js';
import { submitChecklistImpl } from './cycle-write/submit-checklist.js';
import { advanceImpl } from './cycle-write/advance.js';
import { startCycleImpl } from './cycle-write/start-cycle.js';
import { getCurrentStateImpl, getBatchStatesImpl } from './current-state.js';

// Note: the legacy local `assertTapeVersionFresh` was removed in Phase 8.5
// Commit 4. All four write methods now go through the shared
// `executor.assertTapeVersionFresh(ctx, submitted)` guard. The legacy local
// `computeChecksum`, `prettyStageLabel`, `collectChecklistsAfterStage`, and
// `resolveChecklistQuestions` helpers (plus the small per-cycle helpers
// `getFilter` / `getNextStageKeys` / `extractBlocks` / `resolveFilterProfile`)
// were extracted into ./helpers.ts and ./filter-resolver.ts. The 4 write
// methods + getCurrentState + getBatchStates were extracted into
// ./cycle-write/*.ts and ./current-state.ts. This file is now the
// orchestrator class — public surface preserved for routes + tests.

export class FilterOperationsService {
  // Public surface preserved: routes call service.getFilterHomeBlock(),
  // service.validateBlockChange(), service.getCleaningReasons(). The
  // implementations live in ./filter-resolver.ts; class methods are thin
  // forwards.
  async getFilterHomeBlock(filterId: string) {
    return getFilterHomeBlock(filterId);
  }

  async validateBlockChange(filterId: string, cleaningAreaId: string | undefined, ctx: RequestContext) {
    return validateBlockChange(filterId, cleaningAreaId, ctx);
  }

  // NOTE: kept as a class method (rather than calling the free function from
  // ./filter-resolver.ts directly) because get-current-state.test.ts monkey-
  // patches it via `(service as any).getProfilePipeline = vi.fn(...)` to
  // verify the L2 cycle-pinned-profile invariant. Removing the indirection
  // would silently bypass the spy.
  protected async getProfilePipeline(profileId: string, requireActive: boolean = false) {
    return getProfilePipeline(profileId, requireActive);
  }

  /**
   * Batch: get current-state for all active filters in the user's org.
   * Returns { states: { [filterId]: stateObject } } for offline caching.
   */
  async getBatchStates(ctx: RequestContext, cleaningAreaId?: string) {
    return getBatchStatesImpl(this, ctx, cleaningAreaId);
  }

  async getCurrentState(ctx: RequestContext, filterId: string, cleaningAreaId?: string) {
    return getCurrentStateImpl(this, ctx, filterId, cleaningAreaId);
  }


  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async submitChecklist(ctx: RequestContext, filterId: string, data: any) {
    return submitChecklistImpl(this, ctx, filterId, data);
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async startCycle(ctx: RequestContext, filterId: string, data: any) {
    return startCycleImpl(this, ctx, filterId, data);
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async advance(ctx: RequestContext, filterId: string, data: any) {
    return advanceImpl(this, ctx, filterId, data);
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async bypass(ctx: RequestContext, filterId: string, data: any) {
    return bypassImpl(this, ctx, filterId, data);
  }

  /** @param query - Validated by Fastify JSON schema before reaching this method */
  async getEvents(ctx: RequestContext, query: any) {
    // Verify filterId belongs to user's org if provided
    if (query.filterId) {
      await getFilter(query.filterId, ctx);
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

  /**
   * Manual status-change log for the "Manual Status Updates" tab on the
   * Cleaning Cycles page. Returns STATE_TRANSITION events that were recorded by
   * a manual "Edit Filter Status" action (cycleId IS NULL + attributes.manual =
   * true), enriched with filter + performer names. These are NOT cleaning
   * cycles — per the 21 CFR decision we never fabricate a cycle row — but they
   * carry the exact who/when/from→to so the change is visible alongside cycles.
   */
  async getManualStatusChanges(ctx: RequestContext, query: any) {
    if (query.filterId) {
      await getFilter(query.filterId, ctx);
    }
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = {
      eventType: 'STATE_TRANSITION',
      cycleId: null,
      attributes: { path: ['manual'], equals: true },
    };
    if (query.filterId) where.filterId = query.filterId;
    if (query.from || query.to) {
      where.performedAt = {};
      if (query.from) where.performedAt.gte = new Date(query.from);
      if (query.to) where.performedAt.lte = new Date(query.to);
    }

    const [data, total] = await Promise.all([
      prisma.filterEvent.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { performedAt: 'desc' } }),
      prisma.filterEvent.count({ where }),
    ]);

    const filterIds = [...new Set(data.map((e) => e.filterId))];
    const performerIds = [...new Set(data.map((e) => e.performedBy).filter(Boolean))] as string[];
    const [filters, performers] = await Promise.all([
      filterIds.length ? prisma.assetInstance.findMany({ where: { id: { in: filterIds } }, select: { id: true, name: true } }) : [],
      performerIds.length ? prisma.user.findMany({ where: { id: { in: performerIds } }, select: { id: true, username: true, fullName: true } }) : [],
    ]);
    const fmap = new Map(filters.map((f) => [f.id, f.name]));
    const umap = new Map(performers.map((u) => [u.id, { fullName: u.fullName || u.username, username: u.username }]));

    const enriched = data.map((e) => {
      const u = e.performedBy ? umap.get(e.performedBy) : null;
      return {
        ...e,
        filterName: fmap.get(e.filterId) ?? null,
        performedByName: u?.fullName ?? null,
        performedByUsername: u?.username ?? null,
      };
    });
    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getDashboardStats(_ctx: RequestContext) {
    // May 16 H20 fix (2026-05-20): 7 independent queries now run in parallel
    // via Promise.all instead of sequentially. Dashboard load drops from
    // ~7× single-query time to ~1× (limited by the slowest of the seven).
    // Each query is independent — no shared state, no ordering dependency.
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const startOfToday = new Date(new Date().toISOString().slice(0, 10));

    const [stageCountsRaw, statusCountsRaw, dailyRaw, monthlyRaw, totalFilters, activeCycles, completedToday] =
      await Promise.all([
        prisma.filterDetails.groupBy({
          by: ['currentLifecycleState'],
          where: { currentLifecycleState: { not: null }, assetInstance: { isActive: true } },
          _count: true,
        }),
        prisma.cleaningCycle.groupBy({ by: ['status'], _count: true }),
        prisma.$queryRawUnsafe<any[]>(`
          SELECT DATE(started_at) as day, COUNT(*)::int as count
          FROM cleaning_cycles
          WHERE started_at >= $1
          GROUP BY DATE(started_at) ORDER BY day
        `, thirtyDaysAgo),
        prisma.$queryRawUnsafe<any[]>(`
          SELECT TO_CHAR(started_at, 'YYYY-MM') as month, COUNT(*)::int as count
          FROM cleaning_cycles
          WHERE started_at >= $1
          GROUP BY TO_CHAR(started_at, 'YYYY-MM') ORDER BY month
        `, twelveMonthsAgo),
        prisma.assetInstance.count({
          where: { isActive: true, template: { templateKind: 'FILTER' } },
        }),
        prisma.cleaningCycle.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.cleaningCycle.count({
          where: { status: 'COMPLETED', completedAt: { gte: startOfToday } },
        }),
      ]);

    const stageCounts: Record<string, number> = {};
    for (const row of stageCountsRaw) {
      if (row.currentLifecycleState) stageCounts[row.currentLifecycleState] = row._count;
    }
    const statusCounts: Record<string, number> = {};
    for (const row of statusCountsRaw) statusCounts[row.status] = row._count;
    const dailyCycles = dailyRaw.map((r: any) => ({ day: r.day, count: r.count }));
    const monthlyCycles = monthlyRaw.map((r: any) => ({ month: r.month, count: r.count }));

    return { stageCounts, statusCounts, dailyCycles, monthlyCycles, totalFilters, activeCycles, completedToday };
  }

  /** @param query - Validated by Fastify JSON schema before reaching this method */
  async getCycles(ctx: RequestContext, query: any) {
    // Verify filterId belongs to user's org if provided
    if (query.filterId) {
      await getFilter(query.filterId, ctx);
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

    // filterSet moved to FilterDetails (Step 6) — include + flatten via the helper.
    const allAssetsRaw = allAssetIds.length > 0 ? await prisma.assetInstance.findMany({
      where: { id: { in: allAssetIds } },
      select: { id: true, name: true, filterDetails: { select: { filterSet: true } } },
    }) : [];
    const allAssets = allAssetsRaw.map(a => ({ id: a.id, name: a.name, filterSet: a.filterDetails?.filterSet ?? null }));
    const assetMap = new Map(allAssets.map(a => [a.id, a]));

    // Resolve performedBy UUIDs to user display names
    const allPerformerIds = [...new Set(
      data.flatMap((c: any) => (c.events ?? []).map((e: any) => e.performedBy).filter(Boolean)),
    )] as string[];
    const performers = allPerformerIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: allPerformerIds } },
      select: { id: true, username: true, fullName: true },
    }) : [];
    // 2026-05-21: expose both fullName and username so the FE can choose which
    // to render. Mobile cycle view uses the username (operator login id) per
    // operator request; desktop continues to show fullName.
    const userMap = new Map(performers.map(u => [u.id, { fullName: u.fullName || u.username, username: u.username }]));

    // P2 (2026-06-03): resolve each cycle's profile stage set so the Cleaning
    // Cycles view can show "NA" for stages the profile doesn't configure (vs "-"
    // for an in-profile stage not yet reached). Batched by distinct profileId.
    const distinctProfileIds = [...new Set(data.map((c: any) => c.profileId).filter(Boolean))] as string[];
    const profileStageMap = new Map<string, string[]>();
    await Promise.all(distinctProfileIds.map(async (pid) => {
      profileStageMap.set(pid, await getProfileOrderedStages(pid));
    }));

    const enriched = data.map(c => ({
      ...c,
      filterName: assetMap.get(c.filterId)?.name ?? null,
      filterSet: assetMap.get(c.filterId)?.filterSet ?? null,
      cleaningAreaName: c.cleaningAreaId ? (assetMap.get(c.cleaningAreaId)?.name ?? null) : null,
      profileStages: c.profileId ? (profileStageMap.get(c.profileId) ?? []) : [],
      ...((c as any).events ? {
        events: (c as any).events.map((e: any) => {
          const u = e.performedBy ? userMap.get(e.performedBy) : null;
          return {
            ...e,
            performedByName: u?.fullName ?? null,
            performedByUsername: u?.username ?? null,
          };
        }),
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
      await getFilter(cycle.filterId, ctx);
    }

    // Enrich with filter name and AHU (parent) name (filterSet on FilterDetails — Step 6).
    const filterRaw = await prisma.assetInstance.findUnique({
      where: { id: cycle.filterId },
      select: { id: true, name: true, parentId: true, filterDetails: { select: { filterSet: true } } },
    });
    const filter = filterRaw ? { id: filterRaw.id, name: filterRaw.name, parentId: filterRaw.parentId, filterSet: filterRaw.filterDetails?.filterSet ?? null } : null;
    const ahu = filter?.parentId ? await prisma.assetInstance.findUnique({
      where: { id: filter.parentId },
      select: { name: true },
    }) : null;

    // Resolve performedBy UUIDs to user names
    // 2026-05-21: also expose username (operator login id) — mobile cycle view
    // renders that instead of fullName per operator request.
    const performerIds = [...new Set(cycle.events.map(e => e.performedBy).filter(Boolean) as string[])];
    const users = performerIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: performerIds } },
      select: { id: true, username: true, fullName: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, { fullName: u.fullName || u.username, username: u.username }]));

    // Resolve checklist question IDs to question text.
    // Phase A.1: prefer the per-event questionsSnapshot (frozen at submit time)
    // when present; fall back to ChecklistProfileVersion lookup via the cycle's
    // pinned versions; last resort fall back to live ChecklistQuestion (for
    // legacy events written before snapshots existed).
    const questionMap = new Map<string, string>();
    const cyclePins = (cycle.checklistVersionPins ?? null) as Record<string, number> | null;

    // First pass: harvest text from per-event snapshots.
    for (const e of cycle.events) {
      if (e.eventType !== 'CHECKLIST_COMPLETED') continue;
      const attrs = (e.attributes as any) ?? {};
      const checklists = Array.isArray(attrs.checklists) ? attrs.checklists : null;
      if (checklists) {
        for (const cl of checklists) {
          for (const q of (cl.questionsSnapshot ?? [])) {
            if (q?.id && q?.question) questionMap.set(q.id, q.question);
          }
        }
      }
    }

    // Second pass: anything still unresolved, try the ChecklistProfileVersion
    // table via the cycle's pinned versions.
    const allAnswerKeys = cycle.events
      .filter(e => e.eventType === 'CHECKLIST_COMPLETED' && (e.attributes as any)?.answers)
      .flatMap(e => Object.keys((e.attributes as any).answers));
    const unresolvedQuestionIds = [...new Set(allAnswerKeys)].filter(qId => !questionMap.has(qId));
    if (unresolvedQuestionIds.length > 0 && cyclePins && Object.keys(cyclePins).length > 0) {
      const versionRows = await prisma.checklistProfileVersion.findMany({
        where: { OR: Object.entries(cyclePins).map(([profileId, versionNumber]) => ({ profileId, versionNumber })) },
      });
      for (const v of versionRows) {
        const snap = (v.snapshot as any) ?? {};
        for (const q of (snap.questions ?? [])) {
          if (q?.id && q?.question) questionMap.set(q.id, q.question);
        }
      }
    }

    // Third pass: live fallback for fully-legacy cycles.
    const stillUnresolved = [...new Set(allAnswerKeys)].filter(qId => !questionMap.has(qId));
    if (stillUnresolved.length > 0) {
      const liveQs = await prisma.checklistQuestion.findMany({
        where: { id: { in: stillUnresolved } },
        select: { id: true, question: true },
      });
      for (const q of liveQs) questionMap.set(q.id, q.question);
    }

    const enrichedEvents = cycle.events.map(e => {
      const u = e.performedBy ? userMap[e.performedBy] : null;
      const enriched: any = {
        ...e,
        performedByName: u?.fullName ?? null,
        performedByUsername: u?.username ?? null,
      };
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

  async terminateCycle(ctx: RequestContext, filterId: string, data: { justification: string; clientOpId?: string; tapeVersion?: number }) {
    return terminateCycleImpl(this, ctx, filterId, data);
  }

  /**
   * Retire a filter — sets status to Retired, terminates active cycle, creates audit log.
   */
  async retire(ctx: RequestContext, filterId: string, remarks: string) {
    const filter = await getFilter(filterId, ctx);

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

      // Save original parentId in customAttributes so unretire can restore it.
      // currentLifecycleState + currentCycleId moved to FilterDetails (Step 6).
      const existingCustom = (filter as any).customAttributes ?? {};
      await tx.assetInstance.update({
        where: { id: filterId },
        data: {
          status: 'Retired',
          isActive: false,
          parentId: null,
          customAttributes: { ...existingCustom, _preRetireParentId: filter.parentId },
        },
      });
      await tx.filterDetails.upsert({
        where: { assetInstanceId: filterId },
        update: { currentLifecycleState: 'RETIRED', currentCycleId: null },
        create: { assetInstanceId: filterId, currentLifecycleState: 'RETIRED', currentCycleId: null },
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

    // Snapshot the old filter's FilterDetails BEFORE retire() clears them.
    // We need filterSet + filterProfileId to copy onto the replacement.
    const oldDetails = await prisma.filterDetails.findUnique({
      where: { assetInstanceId: filterId },
      select: { filterSet: true, filterProfileId: true },
    });

    // Retire old filter first
    await this.retire(ctx, filterId, remarks);

    // Create replacement filter + relationships in a transaction (rollback on failure).
    // FilterDetails (filterSet, filterProfileId) live in the sidecar (Step 6).
    let newFilter: any;
    let movedTagCount = 0;
    try {
      newFilter = await prisma.$transaction(async (tx) => {
        const created = await tx.assetInstance.create({
          data: {
            name: newName,
            templateId: instance.templateId,
            templateVersion: instance.templateVersion,
            parentId: instance.parentId,
            attributes: instance.attributes ?? {},
            status: 'Active',
            isActive: true,
            createdBy: ctx.userId ?? ctx.userSub,
          },
        });

        // Eager FilterDetails for the new filter, copying old filterSet + filterProfileId.
        await tx.filterDetails.create({
          data: {
            assetInstanceId: created.id,
            filterSet: oldDetails?.filterSet ?? null,
            filterProfileId: oldDetails?.filterProfileId ?? null,
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

        // Carry the physical tag(s) over to the replacement filter. A swapped
        // filter keeps the SAME RFID/QR tag — only the filter ID changes. Since
        // identifier_value is globally unique we MOVE the rows (re-point assetId)
        // rather than copy. retire() above never touches identifiers, so they're
        // still attached to the old filter at this point and re-point cleanly.
        const moved = await tx.assetIdentifier.updateMany({
          where: { assetId: filterId },
          data: { assetId: created.id, updatedBy: ctx.userId ?? ctx.userSub ?? null },
        });
        movedTagCount = moved.count;

        return created;
      });
    } catch (err) {
      // Re-activate the retired filter if replacement creation fails
      // (currentLifecycleState moved to FilterDetails — Step 6).
      await prisma.assetInstance.update({
        where: { id: filterId },
        data: { status: 'Active', isActive: true },
      });
      await prisma.filterDetails.update({
        where: { assetInstanceId: filterId },
        data: { currentLifecycleState: null },
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
        identifiersMoved: movedTagCount,
        remarks,
      },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return {
      success: true,
      oldFilterId: filterId,
      newFilterId: newFilter.id,
      newFilterName: newName,
      identifiersMoved: movedTagCount,
    };
  }

  /**
   * Get all retired filters.
   */
  async getRetirements(_ctx: RequestContext) {
    // filterSet moved to FilterDetails (Step 6) — include + flatten.
    const retirementsRaw = await prisma.assetInstance.findMany({
      where: { status: 'Retired', isActive: false },
      select: {
        id: true, name: true, updatedAt: true, attributes: true,
        parentId: true, customAttributes: true,
        filterDetails: { select: { filterSet: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000, // defensive cap — preserves the array contract, bounds memory (audit perf)
    });
    const retirements = retirementsRaw.map((r: any) => ({
      ...r,
      filterSet: r.filterDetails?.filterSet ?? null,
    }));

    // Resolve original parent names for display
    const parentIds = retirements
      .map((r: any) => (r.customAttributes as any)?._preRetireParentId)
      .filter(Boolean) as string[];
    const parents = parentIds.length > 0
      ? await prisma.assetInstance.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
      : [];
    const parentMap = new Map(parents.map(p => [p.id, p.name]));

    // Retirement remarks + performer live in the FILTER_RETIRED audit (the asset
    // row doesn't store them). Join the latest FILTER_RETIRED record per filter.
    const retiredIds = retirements.map((r: any) => r.id);
    const retireAudits = retiredIds.length > 0
      ? await prisma.auditTrail.findMany({
          where: { action: 'FILTER_RETIRED', targetId: { in: retiredIds } },
          select: { targetId: true, afterValue: true, timestamp: true, userName: true, userId: true },
          orderBy: { timestamp: 'desc' },
        })
      : [];
    const retireByFilter = new Map<string, { remarks: string | null; retiredBy: string | null; retiredAt: Date }>();
    for (const a of retireAudits) {
      if (!a.targetId || retireByFilter.has(a.targetId)) continue; // desc order → first seen is the most recent
      const v = (a.afterValue as any) ?? {};
      retireByFilter.set(a.targetId, {
        remarks: v.remarks ?? null,
        retiredBy: a.userName ?? a.userId ?? null,
        retiredAt: a.timestamp,
      });
    }

    return retirements.map((r: any) => {
      const preRetireParentId = (r.customAttributes as any)?._preRetireParentId ?? null;
      const audit = retireByFilter.get(r.id);
      return {
        id: r.id, name: r.name, updatedAt: r.updatedAt,
        attributes: r.attributes, filterSet: r.filterSet, parentId: r.parentId,
        preRetireParentId,
        preRetireParentName: preRetireParentId ? parentMap.get(preRetireParentId) ?? null : null,
        remarks: audit?.remarks ?? null,
        retiredBy: audit?.retiredBy ?? null,
        retiredAt: audit?.retiredAt ?? r.updatedAt,
      };
    });
  }

  /**
   * Get replacement history from audit trail.
   *
   * Visibility rule (matches `/api/audit` intent but corrects the
   * SUPER_ADMIN-hides-from-self bug):
   *   - SUPER_ADMIN viewer → sees ALL replacements including their own.
   *     (No row to hide from the highest privilege.)
   *   - Lower roles → SUPER_ADMIN-performed replacements hidden, mirroring
   *     the audit-trail leak-prevention policy (audit/routes.ts:73, :200).
   *
   * Bug history: until 2026-05-16 this endpoint applied the SUPER_ADMIN
   * exclusion unconditionally, which made every SUPER_ADMIN replacement
   * invisible to SUPER_ADMIN viewers themselves — the most common operator
   * since `superadmin` is the default login.
   */
  async getReplacements(ctx: RequestContext) {
    const isSuperAdmin = ctx.userRole === 'SUPER_ADMIN';
    const records = await prisma.auditTrail.findMany({
      where: {
        action: 'FILTER_REPLACED',
        ...(isSuperAdmin
          ? {}
          : { OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }] }),
      },
      select: { id: true, userId: true, userName: true, timestamp: true, afterValue: true },
      orderBy: { timestamp: 'desc' },
      take: 5000, // defensive cap — preserves the array contract, bounds memory (audit perf)
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

    return mapped;
  }

  async getCleaningReasons(profileId?: string) {
    return getCleaningReasons(profileId);
  }
}
