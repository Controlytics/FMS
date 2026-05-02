/**
 * Offline filter-state cache helpers — Phase 8.6 part 2.
 *
 * Centralizes the post-advance cache rewrite that the mobile + desktop
 * filter-operations pages used to do via local `updateOfflineState` /
 * `updateCachedStateAfterAdvance` helpers (now deleted). One implementation,
 * two callers, no drift.
 *
 * ── What this does ────────────────────────────────────────────────────────
 *
 * After a queued offline advance (or a cycle-start that didn't reach the
 * server), the local `filter-state-{filterId}` cache must be rewritten so
 * the next gate decision sees the new lifecycle state. The rewrite needs:
 *
 *   1. The filter row's `currentLifecycleState` updated in IDB
 *      (`updateFilterStateLocally`) — the `loadLocalContextFromCache` loader
 *      reads this when the cache row is missing the field.
 *   2. A fresh `pendingChecklist[]` computed from the profile graph —
 *      CHECKLIST nodes that fire AFTER the new stage, with their `questions`
 *      resolved against the cached `checklist-profiles` store. Without this,
 *      the loader would synthesize a CHECKLIST_COMPLETED event next read
 *      (its "operator submitted offline" footprint), and the executor would
 *      skip the gate — a 21 CFR violation.
 *   3. A fresh `nextAllowedStages[]` (legacy mirror) and `actions[]` (tape
 *      mirror) so that subsequent gate sites don't have to recompute.
 *   4. `currentState` rewritten on the cache row, and `currentCycle` either
 *      preserved or cleared on cycle completion.
 *
 * ── Why we cache the legacy mirrors AND the tape ──────────────────────────
 *
 * Most gate sites in the FE pages now consume `actions[]` via
 * `getCurrentActions()` (Phase 8.6 part 2 commit 1). But:
 *
 *   - Some legacy components still read `pendingChecklist` directly (the
 *     ChecklistDialog payload format hasn't been unified yet — that's 8.7
 *     territory).
 *   - The `local-context.ts` loader's checklist-completed synthesis depends
 *     on `cachedState.pendingChecklist.length > 0` as the "no synthesis"
 *     signal.
 *
 * So we keep both legacy mirror fields (`nextAllowedStages`, `pendingChecklist`)
 * AND the tape (`actions`, `tapeVersion`) in cache until 8.7 retires the
 * legacy ones.
 */
import {
  collectChecklistsAfterStage,
  computeNextActions,
  findReachable,
} from '@digilog/shared';
import {
  cacheData,
  clearOfflineCycleId,
  getCachedData,
  updateFilterStateLocally,
  OFFLINE_TTL_MS,
} from './offline-store';
import { loadLocalContextFromCache } from './local-context';

interface CachedFilterState {
  currentState?: string | null;
  currentCycle?: any;
  nextAllowedStages?: string[];
  pendingChecklist?: any[];
  pipelineStages?: any[];
  pipelineGraph?: { stages?: any[]; connections?: any[] } | null;
  stageLookup?: Record<string, any> | null;
  equipmentGroup?: any;
  isPmDue?: boolean;
  pmReasonKey?: string | null;
  homeBlock?: { id: string; name: string } | null;
  blockChangeStatus?: string | null;
  actions?: any[] | null;
  tapeVersion?: number | null;
}

/**
 * Build the legacy `pendingChecklist[]` shape from CHECKLIST nodes after the
 * given stage. Resolves each profile against the cached `checklist-profiles`
 * store (populated by sync). Skips profiles that aren't cached or are
 * inactive — same conservative behaviour as the deleted local helper.
 *
 * Empty array → no checklist gate → caller writes `pendingChecklist: []` and
 * `loadLocalContextFromCache` will not synthesize a CHECKLIST_COMPLETED event
 * (it only fires when the profile actually has CHECKLIST nodes after the
 * stage, so empty here is consistent with "no gate").
 */
async function buildPendingChecklistFromProfile(
  graph: { stages?: any[]; connections?: any[] } | null | undefined,
  stageLookup: Record<string, any> | null | undefined,
  newStage: string,
): Promise<any[]> {
  // Collect CHECKLIST profile-ids that fire after `newStage`. Prefer the
  // server-computed stageLookup (B.7 — authoritative) when present, else
  // walk the cached profile graph via the shared executor.
  let profileIds: string[] = [];
  const lookupHit = stageLookup?.[newStage]?.pendingChecklistProfileIds;
  if (Array.isArray(lookupHit)) {
    profileIds = lookupHit;
  } else if (graph?.stages && graph?.connections) {
    const stageNode = graph.stages.find((s: any) => s.stateKey === newStage);
    if (!stageNode) return [];
    const checklistNodes = collectChecklistsAfterStage(
      stageNode,
      graph.stages,
      graph.connections,
    );
    profileIds = checklistNodes
      .map((n) => (n.configuration as { checklistProfileId?: string })?.checklistProfileId)
      .filter((id): id is string => Boolean(id));
  } else {
    return [];
  }

  if (profileIds.length === 0) return [];

  const cachedProfiles = (await getCachedData<any[]>('checklist-profiles')) ?? [];
  const result: any[] = [];
  for (const profileId of profileIds) {
    const profile = cachedProfiles.find(
      (p: any) => p.id === profileId && p.isActive !== false,
    );
    if (!profile) continue;
    if (!Array.isArray(profile.questions) || profile.questions.length === 0) {
      // Stale cache — surface for operator awareness rather than a silent skip
      console.warn('[offline-cache] checklist profile cached without questions', profileId);
    }
    result.push({
      pipelineNodeId: `${newStage}-${profileId}`,
      checklistProfileId: profileId,
      checklistProfileName: profile.name,
      profileVersion: profile.version,
      questions: (profile.questions ?? []).slice().sort(
        (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      ),
    });
  }
  return result;
}

/**
 * Compute reachable advance targets from `newStage` via the shared executor's
 * `findReachable` walker. Mirrors the server's `nextAllowedStages` derivation.
 *
 * Returns an empty array when:
 *   - the cache has no graph data,
 *   - or `newStage` does not appear in the graph (cycle-complete fallback).
 */
function computeNextAllowed(
  graph: { stages?: any[]; connections?: any[] } | null | undefined,
  newStage: string,
): string[] {
  if (!graph?.stages || !graph?.connections) return [];
  const currentNode = graph.stages.find((s: any) => s.stateKey === newStage);
  if (!currentNode) return [];
  return findReachable(currentNode.id, graph.stages, graph.connections).reachableStages;
}

/**
 * Linear-pipeline fallback for cycles whose graph data wasn't cached but the
 * legacy `pipelineStages[]` array is. Returns the next stage in sortOrder.
 */
function computeNextAllowedLinear(
  pipelineStages: any[] | undefined,
  newStage: string,
): string[] {
  const pipeline = (pipelineStages ?? [])
    .filter((s: any) => s.stateKey)
    .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const idx = pipeline.findIndex((s: any) => s.stateKey === newStage);
  return idx >= 0 && idx < pipeline.length - 1 ? [pipeline[idx + 1].stateKey] : [];
}

/**
 * Recompute and persist the `filter-state-{filterId}` cache after an offline
 * advance. Single source of truth — replaces both `updateOfflineState`
 * (mobile) and `updateCachedStateAfterAdvance` (desktop).
 *
 * Sequence:
 *   1. `updateFilterStateLocally` — mutates the IDB filter row's lifecycle
 *      state. Cycle-completion case clears the row's lifecycle state to ''.
 *   2. Read existing cache row (the cycle-side fields we need to preserve).
 *   3. Compute the new `pendingChecklist[]` via profile graph walk +
 *      checklist-profiles cache lookup.
 *   4. Compute the new `nextAllowedStages[]` (graph fallback to linear
 *      pipeline if no graph). When pendingChecklist is non-empty, the
 *      checklist gate blocks advancement → nextAllowedStages = [].
 *   5. Determine `cycleComplete` (no advance targets, no pending checklist,
 *      not a fresh cycle-start, AND we have authoritative pipeline data).
 *   6. Write the cache row with all derived fields. Also re-runs
 *      `computeNextActions` over the freshly-loaded LocalContext to populate
 *      `actions` + `tapeVersion` (the tape-native fields). When 8.7 retires
 *      the legacy mirror fields, only this final tape write will remain.
 *   7. Clear `currentCycleId` from the IDB filter row when the cycle just
 *      completed, so the next scan starts a fresh cycle.
 */
export async function recomputeAndCacheFilterState(
  filterId: string,
  newStage: string,
  cycleStarted: boolean,
  blockId?: string | null,
): Promise<void> {
  try {
    await updateFilterStateLocally(filterId, newStage, cycleStarted);

    const cachedState = (await getCachedData<CachedFilterState>(
      `filter-state-${filterId}`,
    )) ?? {};
    const graph = cachedState.pipelineGraph;
    const stageLookup = cachedState.stageLookup;

    // 21 CFR compliance — never skip required checklists offline. Computed
    // BEFORE writing the cache row so the loader's CHECKLIST_COMPLETED
    // synthesis stays correct (synthesis only fires when pendingChecklist=[]).
    const pendingChecklist = await buildPendingChecklistFromProfile(
      graph,
      stageLookup,
      newStage,
    );

    // Reachable advance targets — graph wins, linear pipeline fallback.
    let nextAllowed: string[] = [];
    let hasGraphData = false;
    if (pendingChecklist.length > 0) {
      // Checklist gate blocks until answered.
      nextAllowed = [];
      hasGraphData = !!graph;
    } else if (graph?.stages && graph?.connections) {
      nextAllowed = computeNextAllowed(graph, newStage);
      hasGraphData = true;
    }
    if (!hasGraphData) {
      nextAllowed = computeNextAllowedLinear(cachedState.pipelineStages, newStage);
      hasGraphData = (cachedState.pipelineStages?.length ?? 0) > 0;
    }

    const cycleComplete =
      hasGraphData &&
      nextAllowed.length === 0 &&
      pendingChecklist.length === 0 &&
      !cycleStarted;

    // Mid-write: stamp the cache with the new lifecycle state, the new
    // legacy mirrors, and a placeholder for actions[]. The executor read
    // below picks these up via loadLocalContextFromCache.
    const updatedCacheRow: CachedFilterState = {
      ...cachedState,
      currentState: cycleComplete ? null : newStage,
      nextAllowedStages: cycleComplete ? [] : nextAllowed,
      pendingChecklist,
      currentCycle: cycleComplete
        ? null
        : (cachedState.currentCycle ??
            (cycleStarted
              ? {
                  id: `offline-${Date.now()}`,
                  status: 'IN_PROGRESS',
                  cleaningAreaId: blockId ?? null,
                }
              : null)),
    };
    await cacheData(`filter-state-${filterId}`, updatedCacheRow, OFFLINE_TTL_MS);

    // Re-run the executor over the just-written cache so the tape-native
    // fields (`actions`, `tapeVersion`) end up on the row too. This is the
    // path 8.7 will keep when the legacy mirror fields are retired.
    if (!cycleComplete) {
      try {
        const ctx = await loadLocalContextFromCache(filterId);
        const tape = computeNextActions(ctx);
        await cacheData(
          `filter-state-${filterId}`,
          { ...updatedCacheRow, actions: tape.actions, tapeVersion: tape.tapeVersion },
          OFFLINE_TTL_MS,
        );
      } catch {
        /* tape recompute is best-effort — gate sites fall back to
           getCurrentActions which re-runs the executor on demand */
      }
    }

    if (cycleComplete) {
      await clearOfflineCycleId(filterId);
    }
  } catch {
    /* swallow — same behaviour as the deleted local helpers */
  }
}
