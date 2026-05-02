/**
 * Filter Operations Service — Core operations: cycle management, stage advancement, bypass.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { createHash } from 'node:crypto';
import { sanitizeStrings } from '../../lib/sanitize.js';
import { findExistingByClientOpId } from '../../lib/idempotency.js';
import { upsertFilterDetails, clearFilterCycle } from '../../lib/filter-details.js';

function computeChecksum(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/** Pretty-print a stateKey like "WASH_IN" → "Wash In" for operator-facing error messages. */
function prettyStageLabel(stateKey: string | null | undefined): string {
  if (!stateKey) return 'this stage';
  return stateKey
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
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
 *
 * Phase A.1: when `versionPins` is provided (cycle's pinned-version map), we
 * resolve questions through the immutable ChecklistProfileVersion snapshot
 * for that exact version. Edits to the live profile after the cycle started
 * have NO effect on the questions the operator sees. When `versionPins` is
 * not provided (legacy cycles started before this column existed, or
 * out-of-cycle preview), we fall back to live profile resolution.
 */
async function resolveChecklistQuestions(
  checklistNodes: any[],
  versionPins?: Record<string, number> | null,
): Promise<any[]> {
  const profileIds = [...new Set(
    checklistNodes.map(n => (n.configuration as any)?.checklistProfileId).filter(Boolean),
  )];
  if (profileIds.length === 0) return [];

  // Resolve from pinned versions where pinned, live profile otherwise.
  type ResolvedProfile = { id: string; name: string; version: number; questions: any[] };
  const resolved = new Map<string, ResolvedProfile>();

  // 1. Pinned-version resolution: load each pin from ChecklistProfileVersion.
  const pinnedIds: string[] = [];
  if (versionPins) {
    for (const id of profileIds) {
      if (typeof versionPins[id] === 'number') pinnedIds.push(id);
    }
  }
  if (pinnedIds.length > 0) {
    const versions = await prisma.checklistProfileVersion.findMany({
      where: {
        OR: pinnedIds.map(id => ({ profileId: id, versionNumber: versionPins![id] })),
      },
    });
    for (const v of versions) {
      const snap = (v.snapshot as any) ?? {};
      resolved.set(v.profileId, {
        id: v.profileId,
        name: snap.name ?? '(unnamed)',
        version: v.versionNumber,
        questions: Array.isArray(snap.questions) ? snap.questions : [],
      });
    }
  }

  // 2. Live fallback for any unresolved IDs (legacy cycles, out-of-cycle previews).
  const unresolvedIds = profileIds.filter(id => !resolved.has(id));
  if (unresolvedIds.length > 0) {
    const profiles = await prisma.checklistProfile.findMany({
      where: { id: { in: unresolvedIds } },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    for (const p of profiles) {
      resolved.set(p.id, {
        id: p.id,
        name: p.name,
        version: p.version,
        questions: p.questions,
      });
    }
  }

  const result: any[] = [];
  for (const node of checklistNodes) {
    const checklistProfileId = (node.configuration as any)?.checklistProfileId;
    const profile = checklistProfileId ? resolved.get(checklistProfileId) : undefined;
    if (!profile) continue;

    result.push({
      pipelineNodeId: node.id,
      checklistProfileId: profile.id,
      checklistProfileName: profile.name,
      profileVersion: profile.version,
      questions: profile.questions.map((q: any) => ({
        id: q.id,
        question: q.question,
        questionType: q.questionType,
        required: q.required,
        section: q.section ?? null,
        description: q.description ?? null,
        options: q.options ?? [],
        validation: q.validation ?? {},
        sortOrder: q.sortOrder,
      })),
    });
  }
  return result;
}

export class FilterOperationsService {
  private async getFilter(filterId: string, _ctx: RequestContext) {
    // parentId is required by retire() to snapshot the original tree position
    // into customAttributes._preRetireParentId so unretire can restore it.
    // Filter cycle state lives on FilterDetails (Step 6) — include + flatten so
    // the rest of this service keeps reading filter.{filterProfileId, currentLifecycleState, currentCycleId, filterSet} unchanged.
    const inst = await prisma.assetInstance.findFirst({
      where: { id: filterId },
      select: {
        id: true, name: true, parentId: true,
        filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
      },
    });
    if (!inst) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
    return {
      id: inst.id,
      name: inst.name ?? null,
      parentId: inst.parentId ?? null,
      filterProfileId: inst.filterDetails?.filterProfileId ?? null,
      currentLifecycleState: inst.filterDetails?.currentLifecycleState ?? null,
      currentCycleId: inst.filterDetails?.currentCycleId ?? null,
      filterSet: (inst.filterDetails?.filterSet ?? null) as string | null,
    };
  }

  async getFilterHomeBlock(filterId: string): Promise<{ blockId: string; blockName: string } | null> {
    let currentId: string | null = filterId;
    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const inst: { id: string; name: string; parentId: string | null; template: { templateKind: string } | null } | null = await prisma.assetInstance.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, parentId: true, template: { select: { templateKind: true } } },
      });
      if (!inst) break;
      if (inst.template?.templateKind === 'BLOCK') {
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
    const filters = await prisma.assetInstance.findMany({
      where: {
        isActive: true,
        status: { not: 'Retired' },
        template: { templateKind: 'FILTER' },
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

    // L2 (2026-05-02): when an in-progress cycle exists, render the pipeline
    // from the CYCLE's pinned profileId (FilterCleaningProfile.id, set at cycle
    // start and immutable post-A.2 rowful versioning). NOT from the live
    // FilterProfile binding — that may have been reassigned mid-cycle (via
    // admin block-assignment config edit) and produces a visual mismatch
    // between the rendered stages and what advance() actually enforces.
    //
    // The existing profileSyncWarning at :~553-577 detects the mismatch and
    // tells the operator to TERMINATE_AND_RESTART; with L2 the operator's
    // displayed pipeline now matches what they're actually being held to,
    // so the warning becomes "rules changed; terminate to use the new ones"
    // rather than "your view is wrong."
    //
    // Pre-cycle path (no currentCycle): use the live binding so the operator
    // sees what they'd start a cycle against.
    const resolvedProfileId = await this.resolveFilterProfile(filter);
    const pinnedCycleProfileId = currentCycle?.profileId ?? null;
    const profileIdForRender = pinnedCycleProfileId ?? resolvedProfileId;
    const cp = profileIdForRender ? await this.getProfilePipeline(profileIdForRender, false) : null; // getCurrentState shows pipeline even if disabled

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
                  // Checklists pending — resolve via cycle's pinned versions (Phase A.1).
                  // currentCycle is in scope here.
                  const pins = (currentCycle?.checklistVersionPins ?? null) as Record<string, number> | null;
                  pendingChecklist = await resolveChecklistQuestions(checklistNodes, pins);
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

    // Include equipment group info if cycle has one selected.
    //
    // L1 (2026-05-02): when the cycle pinned a version (cycle.equipmentGroupVersionPin
    // is set, P1), return the FROZEN SNAPSHOT from EquipmentGroupVersion instead of
    // the live row. Closes the operator-visible drift surface where the FE rendered
    // dropdowns from live operating ranges but server validation in advance() rejected
    // against the pinned ranges. Field shape preserved so the existing tablet/web
    // (and the deployed APK) consume the response unchanged.
    //
    // Resolution order, mirroring the canonical lazy-first-version logic from
    // advance() reading-validation (~:1101-1175):
    //   1. Pin set + snapshot row exists  -> reconstruct from snapshot.
    //   2. Pin set + snapshot row missing  -> fall back to live row IFF live.version === pin
    //      (the lazy first-version case — live row IS v1 until the first edit creates
    //      its archive). Mismatch is logged but not thrown here (this is a read
    //      endpoint; advance() is where the 409 GROUP_VERSION_MISSING fires).
    //   3. Pin null (legacy cycle started pre-P1) -> live row.
    //   4. No cycle group at all -> block-fallback below (unchanged).
    let equipmentGroup: any = null;
    if (currentCycle?.equipmentGroupId) {
      const pin = currentCycle.equipmentGroupVersionPin;
      if (pin !== null && pin !== undefined) {
        const versionRow = await prisma.equipmentGroupVersion.findUnique({
          where: { groupId_versionNumber: { groupId: currentCycle.equipmentGroupId, versionNumber: pin } },
        });
        if (versionRow) {
          const snap = versionRow.snapshot as { name?: string; blockId?: string; isActive?: boolean; instruments?: any[] };
          equipmentGroup = {
            id: currentCycle.equipmentGroupId,
            name: snap.name ?? null,
            blockId: snap.blockId ?? null,
            isActive: snap.isActive ?? true,
            version: pin,
            instruments: (snap.instruments ?? []).slice().sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
          };
        } else {
          // Lazy first-version: snapshot only exists after the first admin edit.
          // Live row IS the pinned version when versions match.
          const liveGroup = await prisma.equipmentGroup.findUnique({
            where: { id: currentCycle.equipmentGroupId },
            include: { instruments: { orderBy: { sortOrder: 'asc' } } },
          });
          if (liveGroup && liveGroup.version === pin) {
            equipmentGroup = liveGroup;
          } else {
            // Pin and live diverge but no snapshot row exists. Should be impossible
            // given the snapshot-then-bump invariant; log + return live so the UI
            // doesn't break. advance() will throw 409 GROUP_VERSION_MISSING when
            // the operator attempts to submit readings.
            console.warn(
              `[getCurrentState] equipmentGroupVersionPin=${pin} but neither snapshot row exists nor does live.version match for group ${currentCycle.equipmentGroupId} (cycle ${currentCycle.id}). Returning live row.`,
            );
            equipmentGroup = liveGroup;
          }
        }
      } else {
        // Legacy cycle (pre-P1, pin never written). Live row is correct here —
        // documented drift gap, kept only for backwards compatibility.
        equipmentGroup = await prisma.equipmentGroup.findUnique({
          where: { id: currentCycle.equipmentGroupId },
          include: { instruments: { orderBy: { sortOrder: 'asc' } } },
        });
      }
    }
    // Fallback: if cycle has no equipment group but has a cleaning area (block),
    // return the first active equipment group for that block so the UI can surface
    // instrument operating ranges (e.g. dryer temperature dropdown). No cycle pin
    // applies here — the cycle hasn't bound a group yet.
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

    // B.7 — Per-stage lookup table the offline client uses without reconstructing
    // server logic. For every STAGE node in the pipeline, pre-compute:
    //   - nextStages: array of stateKey strings reachable next
    //   - pendingChecklistProfileIds: ids of CHECKLIST nodes that fire after this
    //     stage (client uses cached checklist-profiles to render questions offline)
    //   - leadsToEnd: true if no more stages follow
    // The client just looks this up after each successful offline advance instead
    // of walking the graph itself (which has historically drifted from server).
    const stageLookup: Record<string, { nextStages: string[]; pendingChecklistProfileIds: string[]; leadsToEnd: boolean }> = {};
    if (cp) {
      for (const s of cp.stages) {
        if (s.nodeType !== 'STAGE' || !s.stateKey) continue;
        const checklistNodes = collectChecklistsAfterStage(s, cp.stages, cp.connections);
        const nextSet = new Set<string>();
        let leadsToEnd = false;
        const collectStagesPast = (nodeId: string, visited: Set<string>) => {
          if (visited.has(nodeId)) return;
          visited.add(nodeId);
          const outConns = cp!.connections.filter((c: any) => c.fromStageId === nodeId);
          for (const conn of outConns) {
            const next = cp!.stages.find((n: any) => n.id === conn.toStageId);
            if (!next) continue;
            if (next.nodeType === 'STAGE' && next.stateKey) nextSet.add(next.stateKey);
            else if (next.nodeType === 'END') leadsToEnd = true;
            else if (next.nodeType === 'CHECKLIST') collectStagesPast(next.id, visited);
          }
        };
        collectStagesPast(s.id, new Set());
        stageLookup[s.stateKey] = {
          nextStages: [...nextSet],
          pendingChecklistProfileIds: checklistNodes.map((n: any) => (n.configuration as any)?.checklistProfileId).filter(Boolean),
          leadsToEnd,
        };
      }
    }

    // Stale-profile detection: if the in-progress cycle is bound to a profile
    // that no longer matches what the live block-assignment config says,
    // surface a warning so the operator can terminate-and-restart on the
    // current profile instead of silently continuing on the wrong pipeline.
    // L3 (2026-05-02): advisory warning when admin has edited the cycle's pinned
    // EquipmentGroup. Read-only — actual readings still validate against the
    // pinned snapshot (P1 + L1). Useful for transparency: operator sees that
    // the live config has moved on and can decide whether to terminate-and-
    // restart on the new operating ranges, or finish the cycle on the pinned
    // ones. Symmetric to profileSyncWarning but for the equipment group, not
    // the cleaning recipe.
    let equipmentGroupSyncWarning: { groupId: string; pinnedVersion: number; liveVersion: number; recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART' } | null = null;
    if (currentCycle?.equipmentGroupId && currentCycle.equipmentGroupVersionPin !== null && currentCycle.equipmentGroupVersionPin !== undefined) {
      const liveGroup = await prisma.equipmentGroup.findUnique({
        where: { id: currentCycle.equipmentGroupId },
        select: { version: true },
      });
      if (liveGroup && liveGroup.version > currentCycle.equipmentGroupVersionPin) {
        equipmentGroupSyncWarning = {
          groupId: currentCycle.equipmentGroupId,
          pinnedVersion: currentCycle.equipmentGroupVersionPin,
          liveVersion: liveGroup.version,
          recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART',
        };
      }
    }

    let profileSyncWarning: { cycleProfileId: string; cycleProfileName: string | null; expectedProfileId: string; expectedProfileName: string | null; recommendation: 'TERMINATE_AND_RESTART' } | null = null;
    if (currentCycle && resolvedProfileId) {
      const cycleProfileId: string = currentCycle.profileId;
      // resolvedProfileId is what the live config + filter assignment resolves to
      // (FilterProfile id OR CleaningProfile id directly). Normalize both sides.
      const normalize = async (id: string): Promise<string> => {
        const fp = await prisma.filterProfile.findUnique({ where: { id }, select: { cleaningProfileId: true } });
        return fp ? fp.cleaningProfileId : id;
      };
      const liveCpId = await normalize(resolvedProfileId);
      const cycleCpId = await normalize(cycleProfileId);
      if (liveCpId !== cycleCpId) {
        const [liveCp, cycleCp] = await Promise.all([
          prisma.filterCleaningProfile.findUnique({ where: { id: liveCpId }, select: { name: true } }),
          prisma.filterCleaningProfile.findUnique({ where: { id: cycleCpId }, select: { name: true } }),
        ]);
        profileSyncWarning = {
          cycleProfileId: cycleCpId,
          cycleProfileName: cycleCp?.name ?? null,
          expectedProfileId: liveCpId,
          expectedProfileName: liveCp?.name ?? null,
          recommendation: 'TERMINATE_AND_RESTART',
        };
      }
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
      profileSyncWarning,
      equipmentGroupSyncWarning, // L3 (2026-05-02)
      stageLookup,
    };
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async submitChecklist(ctx: RequestContext, filterId: string, data: any) {
    const { answers } = data;
    const clientOpId: string | null = data.clientOpId ?? null;
    // Honor offlinePerformedAt as the regulatory timestamp (operator's actual answer time).
    // Without this, every offline-replayed checklist records the server-receive time,
    // breaking 21 CFR Part 11 audit fidelity for offline operations.
    const offlineTime: Date | undefined = data.offlinePerformedAt ? new Date(data.offlinePerformedAt) : undefined;
    // Optional version pin from the offline cache — server compares to live profile
    // versions to detect schema drift between cache and current state.
    const expectedProfileVersions: Record<string, number> | null = data.expectedProfileVersions ?? null;

    const filter = await this.getFilter(filterId, ctx);
    if (!filter.currentCycleId) throw new AppError(400, 'NO_CYCLE', 'No active cleaning cycle');

    // Cycle-scoped clientOpId dedup: a replay with the same opId for the same cycle
    // is a no-op success (returns current state); the same opId across different
    // cycles cannot collide.
    if (clientOpId && await findExistingByClientOpId(filterId, clientOpId, filter.currentCycleId)) {
      return this.getCurrentState(ctx, filterId);
    }

    const cycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (!cycle) throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');

    // Resolve checklist nodes for the current stage. Required for: validation,
    // schema-drift detection, and the per-profile snapshot we persist on the event.
    // Phase A.1: resolve through the cycle's pinned versions, so the questions
    // the operator answered against are byte-identical to the questions we
    // validate here, regardless of any admin edits during the cycle.
    const cyclePins = ((cycle as any).checklistVersionPins ?? null) as Record<string, number> | null;
    const resolvedProfileId = await this.resolveFilterProfile(filter);
    const cp = resolvedProfileId ? await this.getProfilePipeline(resolvedProfileId) : null;
    let resolvedChecklists: any[] = [];
    if (cp && filter.currentLifecycleState) {
      const currentStage = cp.stages.find(s => s.stateKey === filter.currentLifecycleState);
      if (currentStage) {
        const checklistNodes = collectChecklistsAfterStage(currentStage, cp.stages, cp.connections);
        resolvedChecklists = await resolveChecklistQuestions(checklistNodes, cyclePins);
      }
    }

    // Schema-drift check: the offline tablet sends `expectedProfileVersions` as a map
    // of profileId → version it cached. If the live profile version is newer, the cache
    // is stale and the operator may have answered against questions that no longer exist
    // (or missed required questions added later). Reject with a structured payload so
    // the client can surface "checklist updated since you cached it — please re-review".
    if (expectedProfileVersions && resolvedChecklists.length > 0) {
      const drift: Array<{ profileId: string; expected: number; current: number }> = [];
      for (const cl of resolvedChecklists) {
        const expected = expectedProfileVersions[cl.checklistProfileId];
        const current = (cl.profileVersion ?? 1) as number;
        if (expected !== undefined && expected !== current) {
          drift.push({ profileId: cl.checklistProfileId, expected, current });
        }
      }
      if (drift.length > 0) {
        const err = new AppError(409, 'SCHEMA_DRIFT', 'Checklist profile changed since this submission was prepared. Please reload and re-answer.');
        (err as any).details = { drift };
        throw err;
      }
    }

    // Validation: required questions answered, extras rejected.
    const validQuestionIds = new Set<string>();
    const requiredQuestionIds = new Set<string>();
    for (const cl of resolvedChecklists) {
      for (const q of cl.questions) {
        validQuestionIds.add(q.id);
        if (q.required) requiredQuestionIds.add(q.id);
      }
    }
    if (answers && typeof answers === 'object') {
      for (const qId of requiredQuestionIds) {
        if (answers[qId] === undefined || answers[qId] === null || answers[qId] === '') {
          throw new AppError(400, 'VALIDATION_ERROR', `Required checklist question not answered: ${qId}`);
        }
      }
      // Reject extras (was console.warn before). They would be hash-bound and audit-immutable.
      const answerKeys = Object.keys(answers);
      const extraKeys = answerKeys.filter(k => !validQuestionIds.has(k));
      if (extraKeys.length > 0) {
        throw new AppError(400, 'INVALID_QUESTIONS', `Unexpected answer keys (not in any active checklist for this stage): ${extraKeys.join(', ')}`);
      }
    }

    // Build per-profile snapshot so audit replay is deterministic without re-walking
    // the pipeline graph or hitting the (possibly-edited-since) ChecklistProfile rows.
    const checklistsSnapshot = resolvedChecklists.map((cl: any) => {
      const profileQuestionIds = new Set(cl.questions.map((q: any) => q.id));
      const perProfileAnswers: Record<string, any> = {};
      if (answers && typeof answers === 'object') {
        for (const [qId, val] of Object.entries(answers)) {
          if (profileQuestionIds.has(qId)) perProfileAnswers[qId] = val;
        }
      }
      return {
        pipelineNodeId: cl.pipelineNodeId,
        checklistProfileId: cl.checklistProfileId,
        checklistProfileName: cl.checklistProfileName,
        profileVersion: cl.profileVersion ?? 1,
        questionsSnapshot: cl.questions.map((q: any) => ({
          id: q.id,
          question: q.question,
          questionType: q.questionType,
          required: q.required,
          options: q.options,
        })),
        answers: perProfileAnswers,
      };
    });

    // Record CHECKLIST_COMPLETED event. Attributes shape:
    //   { afterStage, answers (flat merged — backward compat for cycle-history reader),
    //     checklists[] (per-profile snapshot — A6), clientOpId (A2), offlinePerformedAt (A1) }
    const eventData = {
      filterId,
      cycleId: cycle.id,
      eventType: 'CHECKLIST_COMPLETED' as const,
      performedBy: ctx.userSub,
      attributes: {
        afterStage: filter.currentLifecycleState,
        answers,
        checklists: checklistsSnapshot,
        ...(clientOpId ? { clientOpId } : {}),
        ...(offlineTime ? { offlinePerformedAt: offlineTime.toISOString() } : {}),
      },
      remarks: `Checklist completed after ${filter.currentLifecycleState}`,
    };
    const checksum = computeChecksum(eventData);

    await prisma.$transaction(async (tx) => {
      // Phase 5b.4: SELECT FOR UPDATE on FilterDetails to serialize submitChecklist
      // against concurrent advance/bypass on the same filter.
      await tx.$queryRaw`
        SELECT 1 FROM filter_details WHERE asset_instance_id = ${filterId}::uuid FOR UPDATE
      `;

      // Check for duplicate submission (same stage, same cycle).
      const existing = await tx.filterEvent.findFirst({
        where: {
          filterId,
          cycleId: cycle.id,
          eventType: 'CHECKLIST_COMPLETED',
          attributes: { path: ['afterStage'], equals: filter.currentLifecycleState ?? undefined },
        },
      });
      if (existing) throw new AppError(409, 'ALREADY_SUBMITTED', `Checklist already submitted for ${prettyStageLabel(filter.currentLifecycleState)}`);

      await tx.filterEvent.create({
        data: {
          ...eventData,
          checksum,
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
          // Operator's true answer time when offline; otherwise default(now()).
          ...(offlineTime ? { performedAt: offlineTime } : {}),
        },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CHECKLIST_COMPLETED',
      targetType: 'filter', targetId: filterId,
      afterValue: { stage: filter.currentLifecycleState, answerCount: Object.keys(answers ?? {}).length, profileCount: checklistsSnapshot.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getCurrentState(ctx, filterId);
  }

  /** @param data - Validated by Fastify JSON schema before reaching this method */
  async startCycle(ctx: RequestContext, filterId: string, data: any) {
    const { cleaningReasonKey, cleaningAreaId, equipmentGroupId } = data;
    // offlinePerformedAt: original timestamp from when the user performed the action offline
    const offlineTime = data.offlinePerformedAt ? new Date(data.offlinePerformedAt) : undefined;
    // Idempotent replay: if this clientOpId was already processed, return current state
    // instead of creating a duplicate cycle.
    const clientOpId: string | null = data.clientOpId ?? null;
    if (clientOpId && await findExistingByClientOpId(filterId, clientOpId)) {
      return this.getCurrentState(ctx, filterId);
    }
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

    const prevCycleCount = await prisma.cleaningCycle.count({ where: { filterId } });
    const seq = prevCycleCount + 1;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cycleCode = `CC-${filter.name?.replace(/\s+/g, '').slice(0, 10) ?? filterId.slice(0, 8)}-${String(seq).padStart(3, '0')}-${dateStr}`;

    // Resolve to cleaning profile — could be a FilterProfile ID or a CleaningProfile ID directly
    const fp = await prisma.filterProfile.findUnique({ where: { id: resolvedProfileIdForCycle } });
    const cleaningProfileIdForCycle = fp ? fp.cleaningProfileId : resolvedProfileIdForCycle;
    const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: cleaningProfileIdForCycle } });
    if (cp && cp.status !== 'ACTIVE') {
      throw new AppError(400, 'PROFILE_DISABLED', `Cleaning profile "${cp.name}" is disabled. Contact admin to activate it.`);
    }

    // Phase A.1: snapshot the version of every ChecklistProfile referenced by
    // this pipeline at cycle start. From now on, this cycle resolves checklist
    // questions through these pinned versions — admin edits to a profile mid-cycle
    // will NOT change the questions or required-flags the operator sees.
    const pipelineForPins = await this.getProfilePipeline(resolvedProfileIdForCycle, false);
    const checklistProfileIdsInPipeline: string[] = pipelineForPins
      ? [...new Set(
          pipelineForPins.stages
            .filter((s: any) => s.nodeType === 'CHECKLIST')
            .map((s: any) => s.configuration?.checklistProfileId)
            .filter(Boolean) as string[],
        )]
      : [];
    const checklistVersionPins: Record<string, number> = {};
    if (checklistProfileIdsInPipeline.length > 0) {
      const profilesForPins = await prisma.checklistProfile.findMany({
        where: { id: { in: checklistProfileIdsInPipeline } },
        select: { id: true, version: true },
      });
      for (const p of profilesForPins) {
        checklistVersionPins[p.id] = p.version;
      }
    }

    // Use transaction to prevent race conditions on double-start
    const cycle = await prisma["$transaction"](async (tx) => {
      // Re-check inside transaction (currentCycleId now lives on FilterDetails — Step 6)
      const recheckFD = await tx.filterDetails.findUnique({ where: { assetInstanceId: filterId }, select: { currentCycleId: true } });
      if (recheckFD?.currentCycleId) {
        const active = await tx.cleaningCycle.findFirst({ where: { id: recheckFD.currentCycleId, status: 'IN_PROGRESS' } });
        if (active) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
      }

      // Validate equipment group if provided. P1 (2026-05-02): also capture the
      // group's current version so the cycle pins it at start. Reading validation
      // later reads operating-range from the pinned EquipmentGroupVersion
      // snapshot, NOT the live group, so admin edits to ranges mid-cycle don't
      // reach the in-flight cycle.
      let equipmentGroupVersionPin: number | null = null;
      if (equipmentGroupId) {
        const eqGroup = await tx.equipmentGroup.findFirst({
          where: { id: equipmentGroupId, isActive: true },
          select: { id: true, version: true },
        });
        if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found or inactive');
        equipmentGroupVersionPin = eqGroup.version;
      }

      const newCycle = await tx.cleaningCycle.create({
        data: {
          cycleCode, filterId, ahuId: null,
          // Pre-existing latent bug caught during P1 verification (2026-05-02):
          // cleaning_cycles.profile_id FKs to filter_cleaning_profiles.id, NOT
          // filter_profiles.id. resolveFilterProfile() can return either depending
          // on whether the filter has a FilterDetails.filter_profile_id binding
          // (returns FilterProfile id) or only a config-based rule (which
          // *might* return a CleaningProfile id directly). Storing the
          // FilterProfile id here triggers the FK violation. cleaningProfileIdForCycle
          // (computed at line 820) already resolves to the CleaningProfile id in both
          // cases — use that. Latent until now because no FilterDetails-bound cycle
          // had ever been started in this DB.
          profileId: cleaningProfileIdForCycle,
          profileVersion: cp?.version ?? 1,
          checklistVersionPins: checklistVersionPins as any,
          sequenceNumber: seq, cleaningReasonKey,
          cleaningReasonLabel: reason.name,
          cleaningJustification: cleaningJustification ?? null,
          cleaningAreaId: cleaningAreaId ?? null,
          equipmentGroupId: equipmentGroupId ?? null,
          equipmentGroupVersionPin, // P1: null when no group bound at start
          ...(offlineTime && { startedAt: offlineTime }),
        },
      });

      await tx.filterEvent.create({
        data: {
          filterId, cycleId: newCycle.id, eventType: 'CYCLE_STARTED',
          performedBy: ctx.userSub, cleaningAreaId: cleaningAreaId ?? null,
          attributes: { cleaningReasonKey, cleaningReasonLabel: reason.name, ...(clientOpId ? { clientOpId } : {}) },
          remarks: cleaningJustification ?? null,
          checksum: computeChecksum({ filterId, cycleId: newCycle.id, eventType: 'CYCLE_STARTED', performedBy: ctx.userSub }),
          ipAddress: ctx.ipAddress, telemetrySnapshot: {},
          ...(offlineTime && { performedAt: offlineTime }),
        },
      });

      // currentCycleId moved to FilterDetails (Step 6).
      await tx.filterDetails.upsert({
        where: { assetInstanceId: filterId },
        update: { currentCycleId: newCycle.id },
        create: { assetInstanceId: filterId, currentCycleId: newCycle.id },
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
    // Idempotent replay: same clientOpId == same logical operation. Return current
    // state instead of double-applying.
    const clientOpId: string | null = data.clientOpId ?? null;
    if (clientOpId && await findExistingByClientOpId(filterId, clientOpId)) {
      return this.getCurrentState(ctx, filterId);
    }

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

    // Enforce checklist completion before allowing advance.
    // A5: gates are FROZEN at cycle start. We do NOT filter by `isActive` — soft-deleting
    // a profile mid-cycle no longer silently lifts the gate. The cycle keeps using the
    // pipeline graph it was started with; the gate either was always there or wasn't.
    // (To stop enforcing a gate mid-cycle, an operator must terminate the cycle.)
    const currentState = filter.currentLifecycleState;
    if (currentState) {
      const currentStageForCL = cp.stages.find(s => s.stateKey === currentState);
      if (currentStageForCL) {
        const pendingCLNodes = collectChecklistsAfterStage(currentStageForCL, cp.stages, cp.connections)
          .filter(n => n.configuration?.checklistProfileId);

        if (pendingCLNodes.length > 0) {
          const answered = await prisma.filterEvent.findFirst({
            where: { filterId, cycleId: cycle.id, eventType: 'CHECKLIST_COMPLETED', attributes: { path: ['afterStage'], equals: currentState } },
          });
          if (!answered) {
            throw new AppError(400, 'CHECKLIST_PENDING', `Please complete the checklist before advancing from ${prettyStageLabel(currentState)}`);
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
      // Dryer actions (SET_DURATION, SUBMIT_READINGS) with targetState=DRY_IN stay at DRY_IN
      const isDryerInPlace = !!dryerAction && targetState === 'DRY_IN' && filter.currentLifecycleState === 'DRY_IN';
      if (!reachableStages.includes(targetState) && cp.flowMode !== 'BYPASS_ENABLED' && !isDryerInPlace) {
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

    // Dryer SUBMIT_READINGS: validate half-time elapsed (skip for offline replay — time already validated client-side)
    if (dryerAction === 'SUBMIT_READINGS') {
      if (filter.currentLifecycleState !== 'DRY_IN') throw new AppError(400, 'NOT_IN_DRY_IN', 'Filter is not in DRY_IN');
      if (!cycle.dryerStartedAt || !cycle.dryerDurationMinutes) {
        throw new AppError(400, 'DRYER_NOT_STARTED', 'Dryer duration not set');
      }
      if (!offlineTime) {
        const halfMs = (cycle.dryerDurationMinutes * 60_000) / 2;
        const elapsedMs = Date.now() - new Date(cycle.dryerStartedAt).getTime();
        if (elapsedMs < halfMs) {
          const remainingMin = Math.ceil((halfMs - elapsedMs) / 60_000);
          throw new AppError(400, 'DRYER_NOT_READY', `Dryer still running. Wait ${remainingMin} more minute(s).`);
        }
      }
    }

    // Guard: leaving DRY_IN requires the dryer to have run at least half its duration (skip for offline replay)
    if (filter.currentLifecycleState === 'DRY_IN' && targetState !== 'DRY_IN' && !offlineTime) {
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
      // Track the version pin for this cycle. Three sources, in priority:
      //   1. cycle.equipmentGroupVersionPin (already set at start-cycle / earlier auto-bind) — P1.
      //   2. Live group version when we lazy-bind here for the first time — P1 stamps it on persist.
      //   3. null fallback for legacy cycles whose group was bound before P1 shipped → use live row.
      let cycleVersionPin: number | null = cycle.equipmentGroupVersionPin ?? null;

      // Auto-resolve: if no group on cycle but block is known, pick the block's active group
      if (!cycleGroupId && cycle.cleaningAreaId) {
        const blockGroups = await prisma.equipmentGroup.findMany({
          where: { blockId: cycle.cleaningAreaId, isActive: true },
          select: { id: true, version: true },
        });
        if (blockGroups.length === 1) {
          cycleGroupId = blockGroups[0].id;
          cycleVersionPin = blockGroups[0].version; // P1: pin at lazy-bind moment
          // Persist on cycle so future requests don't need to re-resolve
          await prisma.cleaningCycle.update({
            where: { id: cycle.id },
            data: { equipmentGroupId: cycleGroupId, equipmentGroupVersionPin: cycleVersionPin },
          });
        } else if (blockGroups.length > 1) {
          throw new AppError(400, 'MULTIPLE_EQUIPMENT_GROUPS', 'Multiple equipment groups found for this block. Please select one.');
        }
      }
      if (!cycleGroupId) throw new AppError(400, 'NO_EQUIPMENT_GROUP', 'Equipment group must be selected before submitting readings');

      // P1 (2026-05-02): if the cycle has a version pin, validate readings against
      // the frozen EquipmentGroupVersion snapshot. Otherwise fall back to the live
      // group row (legacy cycles started before P1, or cycles whose group was
      // never auto-bound). Validation must be byte-correct against whichever
      // ranges were in effect when the cycle started — that's the audit-replay
      // contract. The fallback path is a strict drift gap, kept ONLY for
      // backwards compatibility with pre-P1 cycles.
      let stageInstruments: any[];
      if (cycleVersionPin !== null) {
        const versionRow = await prisma.equipmentGroupVersion.findUnique({
          where: { groupId_versionNumber: { groupId: cycleGroupId, versionNumber: cycleVersionPin } },
        });
        if (versionRow) {
          const snap = versionRow.snapshot as { instruments: any[] };
          const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
          stageInstruments = (snap.instruments ?? [])
            .filter((i: any) => i.stageKey === readingsStageKey)
            .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        } else {
          // Pin set but no version row for it — this means the pin is for the
          // CURRENT live row (snapshot rows only get written when the row is
          // about to change). Fall through to the live-row read below.
          const eqGroup = await prisma.equipmentGroup.findUnique({
            where: { id: cycleGroupId },
            include: { instruments: { orderBy: { sortOrder: 'asc' } } },
          });
          if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found');
          if (eqGroup.version !== cycleVersionPin) {
            throw new AppError(409, 'GROUP_VERSION_MISSING', `Equipment group version ${cycleVersionPin} pinned by this cycle is missing from the version sidecar; live group is at v${eqGroup.version}. Investigate before submitting readings.`);
          }
          const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
          stageInstruments = eqGroup.instruments.filter(i => i.stageKey === readingsStageKey);
        }
      } else {
        // Legacy fallback (pre-P1 cycle): live row, with the historical drift
        // gap. Documented in CHANGELOG / DECISIONS.
        const eqGroup = await prisma.equipmentGroup.findUnique({
          where: { id: cycleGroupId },
          include: { instruments: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found');
        const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
        stageInstruments = eqGroup.instruments.filter(i => i.stageKey === readingsStageKey);
      }

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
          leastCount: inst.leastCount,
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

    // Wrap all writes in a single transaction with row-level lock (Phase 5b.4).
    await prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the FilterDetails row blocks any concurrent
      // advance/bypass on this filter until this transaction commits. Closes
      // the read-then-write race where two operators on two devices could both
      // pass the state check and both write STAGE_TRANSITIONED.
      const lockedRows = await tx.$queryRaw<Array<{ current_lifecycle_state: string | null; current_cycle_id: string | null }>>`
        SELECT current_lifecycle_state, current_cycle_id
        FROM filter_details
        WHERE asset_instance_id = ${filterId}::uuid
        FOR UPDATE
      `;
      const lockedFD = lockedRows[0];
      if (lockedFD?.current_lifecycle_state !== currentState) {
        throw new AppError(409, 'STATE_CHANGED', 'Filter state was modified by another user. Please refresh and try again.');
      }
      if (lockedFD?.current_cycle_id !== cycle.id) {
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

      // currentLifecycleState moved to FilterDetails (Step 6).
      await tx.filterDetails.update({
        where: { assetInstanceId: filterId },
        data: { currentLifecycleState: targetState },
      });

      if (leadsToEnd && !hasMoreStages) {
        await tx.cleaningCycle.update({
          where: { id: cycle.id },
          data: { status: 'COMPLETED', completedAt: offlineTime ?? new Date() },
        });
        // currentCycleId + currentLifecycleState moved to FilterDetails (Step 6).
        await tx.filterDetails.update({
          where: { assetInstanceId: filterId },
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
    const clientOpId: string | null = data.clientOpId ?? null;
    if (clientOpId && await findExistingByClientOpId(filterId, clientOpId)) {
      return this.getCurrentState(ctx, filterId);
    }

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
      // Phase 5b.4: SELECT FOR UPDATE row lock — prevents concurrent bypass
      // and concurrent advance from interleaving on the same filter.
      const lockedRows = await tx.$queryRaw<Array<{ current_lifecycle_state: string | null }>>`
        SELECT current_lifecycle_state
        FROM filter_details
        WHERE asset_instance_id = ${filterId}::uuid
        FOR UPDATE
      `;
      const lockedFD = lockedRows[0];
      if (lockedFD?.current_lifecycle_state !== filter.currentLifecycleState) {
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

      // currentLifecycleState moved to FilterDetails (Step 6).
      await tx.filterDetails.update({
        where: { assetInstanceId: filterId },
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

  async getDashboardStats(_ctx: RequestContext) {
    // 1. Filters by current lifecycle stage (FilterDetails — Step 6).
    // Joining through assetInstance lets us preserve the isActive filter on
    // the asset row even though state lives on the sidecar.
    const stageCountsRaw = await prisma.filterDetails.groupBy({
      by: ['currentLifecycleState'],
      where: {
        currentLifecycleState: { not: null },
        assetInstance: { isActive: true },
      },
      _count: true,
    });
    const stageCounts: Record<string, number> = {};
    for (const row of stageCountsRaw) {
      if (row.currentLifecycleState) stageCounts[row.currentLifecycleState] = row._count;
    }

    // 2. Cycle status breakdown
    const statusCountsRaw = await prisma.cleaningCycle.groupBy({
      by: ['status'],
      _count: true,
    });
    const statusCounts: Record<string, number> = {};
    for (const row of statusCountsRaw) statusCounts[row.status] = row._count;

    // 3. Daily cycle counts (last 30 days)
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyRaw: any[] = await prisma.$queryRawUnsafe(`
      SELECT DATE(started_at) as day, COUNT(*)::int as count
      FROM cleaning_cycles
      WHERE started_at >= $1
      GROUP BY DATE(started_at) ORDER BY day
    `, thirtyDaysAgo);
    const dailyCycles = dailyRaw.map(r => ({ day: r.day, count: r.count }));

    // 4. Monthly cycle counts (last 12 months)
    const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const monthlyRaw: any[] = await prisma.$queryRawUnsafe(`
      SELECT TO_CHAR(started_at, 'YYYY-MM') as month, COUNT(*)::int as count
      FROM cleaning_cycles
      WHERE started_at >= $1
      GROUP BY TO_CHAR(started_at, 'YYYY-MM') ORDER BY month
    `, twelveMonthsAgo);
    const monthlyCycles = monthlyRaw.map(r => ({ month: r.month, count: r.count }));

    // 5. Total filters + active cycles
    const totalFilters = await prisma.assetInstance.count({
      where: { isActive: true, template: { templateKind: 'FILTER' } },
    });
    const activeCycles = await prisma.cleaningCycle.count({ where: { status: 'IN_PROGRESS' } });
    const completedToday = await prisma.cleaningCycle.count({
      where: { status: 'COMPLETED', completedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
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
    const performerIds = [...new Set(cycle.events.map(e => e.performedBy).filter(Boolean) as string[])];
    const users = performerIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: performerIds } },
      select: { id: true, username: true, fullName: true },
    }) : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.fullName || u.username]));

    // Resolve checklist question IDs to question text.
    // Phase A.1: prefer the per-event questionsSnapshot (frozen at submit time)
    // when present; fall back to ChecklistProfileVersion lookup via the cycle's
    // pinned versions; last resort fall back to live ChecklistQuestion (for
    // legacy events written before snapshots existed).
    const questionMap = new Map<string, string>();
    const cyclePins = ((cycle as any).checklistVersionPins ?? null) as Record<string, number> | null;

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

  async terminateCycle(ctx: RequestContext, filterId: string, data: { justification: string; clientOpId?: string }) {
    const clientOpId: string | null = data.clientOpId ?? null;
    if (clientOpId && await findExistingByClientOpId(filterId, clientOpId)) {
      return this.getCurrentState(ctx, filterId);
    }
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
      // currentCycleId + currentLifecycleState moved to FilterDetails (Step 6).
      await tx.filterDetails.update({
        where: { assetInstanceId: filterId },
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
  async getReplacements(_ctx: RequestContext) {
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
