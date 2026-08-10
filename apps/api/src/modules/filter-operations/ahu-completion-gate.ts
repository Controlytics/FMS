import { prisma } from '../../lib/prisma.js';
import * as executor from '@digilog/shared';
import { loadLocalContext } from './local-context.js';
import type { RequestContext } from '../../types/context.js';
import { AppError } from '../../lib/errors.js';

export type AhuCompletionMode = 'NONE' | 'POPUP' | 'INTERLOCK';

/**
 * Operator's runtime filter-set choice for one AHU-completion submission.
 * Picked live in the pre-popup chooser (2026-07-03). Semantics:
 *   'ALL'   — every filter under the AHU counts (legacy behavior).
 *   'SET_A' — Set A + UNCLASSIFIED filters count; Set B ignored.
 *   'SET_B' — Set B + UNCLASSIFIED filters count; Set A ignored.
 * "Unclassified" = filterDetails.filterSet is null OR the filter has no
 * FilterDetails row at all. Unclassified filters always count (user decision
 * 2026-07-03) — only the OPPOSITE named set is excluded.
 */
export type FilterSetChoice = 'ALL' | 'SET_A' | 'SET_B';

export async function getAhuCompletionMode(): Promise<AhuCompletionMode> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'ahu-completion-process' } });
  const m = (cfg?.configValue as { mode?: string } | null)?.mode;
  return m === 'INTERLOCK' || m === 'POPUP' ? m : 'NONE';
}

/**
 * Prisma `where` fragment scoping the AHU roster to the operator's set choice.
 * Returns `{}` for 'ALL' / undefined (no scoping). For 'SET_A' / 'SET_B',
 * matches the chosen set PLUS unclassified filters (null set, or no
 * FilterDetails row) and excludes only the opposite named set.
 *
 * Note: `filterDetails.filterSet: { not: 'SET_B' }` alone would NOT do — Prisma
 * `not` on a nullable column skips NULL rows, and it wouldn't cover filters with
 * no FilterDetails row. The explicit OR keeps both unclassified cases in.
 */
function filterSetWhere(set?: FilterSetChoice) {
  if (set !== 'SET_A' && set !== 'SET_B') return {};
  return {
    OR: [
      { filterDetails: { is: null } },        // no FilterDetails row → unclassified
      { filterDetails: { filterSet: null } }, // explicit null set → unclassified
      { filterDetails: { filterSet: set } },  // the chosen named set
    ],
  };
}

export type CountedFilter = {
  id: string;
  name: string;
  currentCycleId: string | null;
  currentLifecycleState: string | null;
};

/**
 * Walk the pipeline graph and return the stateKey of the last STAGE node —
 * the one whose only forward-reachable non-CHECKLIST successor is END
 * (hasEndNext === true AND reachableStages.length === 0).
 * Returns null if the profile has no such stage (e.g. empty graph).
 */
export function computeFinalStageKey(profile: { nodes: any[]; edges: any[] }): string | null {
  for (const node of profile.nodes) {
    if (node.nodeType !== 'STAGE' || !node.stateKey) continue;
    const r = executor.findReachable(node.id, profile.nodes, profile.edges);
    if (r.hasEndNext && r.reachableStages.length === 0) return node.stateKey as string;
  }
  return null;
}

/**
 * The set of stage keys at which a sibling counts as READY for the AHU's final
 * step — the final STAGE itself plus every DIRECT predecessor of it.
 *
 * 2026-08-10 — why predecessors are included (operator-specified rule):
 * "all filters reached Storage In, then only should filters be submitted at
 * Storage Out". Requiring siblings to be AT the final stage is unsatisfiable in
 * practice: the gate now runs BEFORE the advance commits (dialog-first, see
 * `73c532c`), so at gate time every scanned filter is still parked at the
 * predecessor. Under the old rule reaching Storage Out required already being at
 * Storage Out, so INTERLOCK could never be satisfied for a whole AHU and POPUP
 * always warned. Readiness therefore means "staged and waiting to take the final
 * step", which is what the operator's rule describes.
 *
 * This is NOT a loosening of the compliance gate: a filter still mid-wash or
 * mid-dry, or one that never started a cycle, is still not ready and still
 * blocks. Only the threshold moved from an unreachable state to the real one.
 *
 * Computed PER FILTER from that filter's own frozen cycle profile — an AHU can
 * legitimately mix profiles (AHU-027 runs 5 filters on `Require` and 1 on
 * `DRYIN`), and a single global threshold would silently mis-judge the odd one.
 */
export function computeReadyStageKeys(profile: { nodes: any[]; edges: any[] }): Set<string> {
  const finalKey = computeFinalStageKey(profile);
  const ready = new Set<string>();
  if (!finalKey) return ready;
  ready.add(finalKey);
  for (const node of profile.nodes) {
    if (node.nodeType !== 'STAGE' || !node.stateKey || node.stateKey === finalKey) continue;
    // findReachable walks THROUGH checklist nodes, so `S → CHECKLIST → FINAL`
    // counts as a direct predecessor — correct, since the checklist is part of
    // leaving S, not a stage a filter can park at.
    const r = executor.findReachable(node.id, profile.nodes, profile.edges);
    if (r.reachableStages.includes(finalKey)) ready.add(node.stateKey as string);
  }
  return ready;
}

/**
 * True when a filter is READY for its AHU's final cleaning step:
 *  - Active cycle: parked at the final stage OR at a direct predecessor of it
 *    (see computeReadyStageKeys — this is the "all at Storage In" rule).
 *  - No cycle: lifecycle state is CLEANING_CYCLE_COMPLETED (the cycle already
 *    finished, so the filter is past the final step entirely).
 * Everything else — never started, or mid-cycle at an earlier stage — is false
 * and blocks/warns exactly as before.
 *
 * Renamed from `reachedFinal` 2026-08-10: "reached final" now describes only one
 * of the two accepted states and was the source of the confusion this rule
 * change resolves.
 */
export function isReadyForFinalStage(f: CountedFilter, readyStagesByFilter: Map<string, Set<string>>): boolean {
  if (f.currentCycleId != null) {
    const ready = readyStagesByFilter.get(f.id);
    return !!ready && !!f.currentLifecycleState && ready.has(f.currentLifecycleState);
  }
  return f.currentLifecycleState === 'CLEANING_CYCLE_COMPLETED';
}

// ─── Minimal synthetic RequestContext ─────────────────────────────────────────
// loadLocalContext only reads ctx to populate the unused `user` slice of
// LocalContext.  computeAhuCompletionStatus is a read-only helper; no real
// session is in flight.  Using SUPER_ADMIN avoids permission short-circuits
// inside loadLocalContext if any are added in future.
const SYSTEM_CTX: RequestContext = {
  userId: 'system',
  userSub: 'system',
  userRole: 'SUPER_ADMIN',
  ipAddress: '127.0.0.1',
  sessionId: 'system',
};

/**
 * Walk one level up the parent chain of `filterId` and return the parent's id
 * if that parent has templateKind === 'AHU'.  Returns null if the filter has no
 * parent or if the immediate parent is not an AHU.
 */
export async function resolveAhuId(filterId: string): Promise<string | null> {
  const self = await prisma.assetInstance.findUnique({
    where: { id: filterId },
    select: { parentId: true },
  });
  if (!self?.parentId) return null;
  const parent = await prisma.assetInstance.findUnique({
    where: { id: self.parentId },
    select: { id: true, template: { select: { templateKind: true } } },
  });
  return parent?.template?.templateKind === 'AHU' ? parent.id : null;
}

/**
 * Load all active, non-retired child FILTERS of the given AHU (design D3).
 *
 * "Cleanable" = the child is a filter (templateKind 'FILTER'). It does NOT
 * require FilterDetails.filterProfileId — that direct binding is optional and
 * in practice unused: `resolveFilterProfile()` resolves a filter's cleaning
 * profile from a config-based rule (cleaning-profile-assignment) or a default
 * fallback (first ACTIVE profile), per the 2026-05-25 decision that
 * filter_profile_id must NOT be required for a cycle to start. Gating on
 * `filterProfileId != null` (the original predicate) excluded EVERY filter in
 * any deployment that uses config/default resolution — i.e. all of them — so
 * the AHU never had siblings to count and INTERLOCK/POPUP silently no-op'd.
 * Idle / never-started filters are intentionally included (D4): they haven't
 * reached final, so they must block completion of their siblings.
 */
export async function loadCountedFilters(ahuId: string, set?: FilterSetChoice): Promise<CountedFilter[]> {
  const rows = await prisma.assetInstance.findMany({
    where: {
      parentId: ahuId,
      isActive: true,
      status: { not: 'Retired' },
      template: { templateKind: 'FILTER' },
      ...filterSetWhere(set),
    },
    select: {
      id: true,
      name: true,
      filterDetails: {
        select: { currentCycleId: true, currentLifecycleState: true },
      },
    },
  });
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    currentCycleId: r.filterDetails?.currentCycleId ?? null,
    currentLifecycleState: r.filterDetails?.currentLifecycleState ?? null,
  }));
}

/**
 * Determine whether all sibling filters of the AHU (excluding the filter
 * currently being advanced) have reached their final cleaning stage or
 * completed their cycle.
 *
 * @param ahuId           — Parent AHU to scan.
 * @param excludeFilterId — The filter being advanced (excluded from count).
 */
export async function computeAhuCompletionStatus(
  ahuId: string,
  excludeFilterId: string,
  set?: FilterSetChoice,
): Promise<{
  allAtFinal: boolean;
  pending: { id: string; name: string; stage: string }[];
  ahuName: string;
  filters: { id: string; name: string; stage: string; done: boolean }[];
}> {
  const all = await loadCountedFilters(ahuId, set);

  // Build the ready-stage SET for EVERY filter that has an active cycle (was
  // just the siblings — now the full roster so `done` is correct for the row
  // the operator is currently on, too). Per filter, not one global threshold:
  // an AHU may mix cleaning profiles, and each cycle pins its own. Resolved via
  // the frozen cycle.profileId, so a null FilterDetails.filterProfileId is safe.
  const readyStagesByFilter = new Map<string, Set<string>>();
  for (const f of all) {
    if (!f.currentCycleId) continue;
    const loaded = await loadLocalContext(f.id, SYSTEM_CTX);
    readyStagesByFilter.set(f.id, computeReadyStageKeys(loaded.ctx.profile));
  }

  // Full roster (INCLUDING the filter being cleaned) with a done flag — powers
  // the dialog's "all filters under this AHU + status" list.
  const filters = all.map(f => ({
    id: f.id,
    name: f.name,
    stage: f.currentLifecycleState ?? 'Not started',
    done: isReadyForFinalStage(f, readyStagesByFilter),
  }));

  // Block decision still EXCLUDES the current filter (it's the one completing).
  const pending = all
    .filter(f => f.id !== excludeFilterId && !isReadyForFinalStage(f, readyStagesByFilter))
    .map(f => ({ id: f.id, name: f.name, stage: f.currentLifecycleState ?? 'Not started' }));

  const ahu = await prisma.assetInstance.findUnique({ where: { id: ahuId }, select: { name: true } });

  return { allAtFinal: pending.length === 0, pending, ahuName: ahu?.name ?? '', filters };
}

/**
 * 2026-07-02: batch variant. Given the filter ids in a submission batch, resolve
 * each filter's AHU, then return one completion-status block per DISTINCT AHU.
 * Powers the multi-AHU carousel dialog. Pending AHUs (allAtFinal=false) are
 * returned first, then alphabetical by name.
 *
 * Uses computeAhuCompletionStatus(ahuId, '') — exclude NONE.
 *
 * 2026-08-10: the original justification for excluding nothing ("a filter at its
 * terminal checklist is already reachedFinal") stopped being true when the gate
 * moved pre-advance — at that point every co-batched filter is still at the
 * PREDECESSOR stage. The call is still correct, for a different reason: under
 * the ready-stage rule the predecessor counts as ready, so co-batched siblings
 * still never false-block each other, and excluding nothing is what lets the
 * dialog show the operator the AHU's complete roster.
 */
export async function computeAhuBatchStatus(
  filterIds: string[],
  set?: FilterSetChoice,
): Promise<{
  ahus: {
    ahuId: string;
    ahuName: string;
    allAtFinal: boolean;
    filters: { id: string; name: string; stage: string; done: boolean }[];
  }[];
}> {
  // Resolve each filter → its AHU (skip filters with no AHU parent). Distinct.
  const ahuIds = new Set<string>();
  for (const fid of filterIds) {
    const ahuId = await resolveAhuId(fid);
    if (ahuId) ahuIds.add(ahuId);
  }

  const ahus = [];
  for (const ahuId of ahuIds) {
    const { ahuName, allAtFinal, filters } = await computeAhuCompletionStatus(ahuId, '', set);
    ahus.push({ ahuId, ahuName, allAtFinal, filters });
  }

  // Pending AHUs first, then by name.
  ahus.sort((a, b) => {
    if (a.allAtFinal !== b.allAtFinal) return a.allAtFinal ? 1 : -1;
    return a.ahuName.localeCompare(b.ahuName);
  });

  return { ahus };
}

/**
 * 2026-07-03: does the given submission batch actually span BOTH a Set A and a
 * Set B filter (across all AHUs it touches)? Drives whether the frontend shows
 * the A/B/All chooser at all — when an AHU has no A/B split (all unclassified,
 * or a single set), the three choices collapse to the same roster, so the
 * chooser is meaningless and we proceed as ALL. Evaluated across the whole
 * batch (the choice is global), so an all-Set-A AHU batched with an all-Set-B
 * AHU still surfaces the chooser.
 */
export async function computeAhuSetAvailability(
  filterIds: string[],
): Promise<{ hasBothSets: boolean }> {
  const ahuIds = new Set<string>();
  for (const fid of filterIds) {
    const ahuId = await resolveAhuId(fid);
    if (ahuId) ahuIds.add(ahuId);
  }
  let hasA = false;
  let hasB = false;
  for (const ahuId of ahuIds) {
    const rows = await prisma.assetInstance.findMany({
      where: { parentId: ahuId, isActive: true, status: { not: 'Retired' }, template: { templateKind: 'FILTER' } },
      select: { filterDetails: { select: { filterSet: true } } },
    });
    for (const r of rows) {
      if (r.filterDetails?.filterSet === 'SET_A') hasA = true;
      else if (r.filterDetails?.filterSet === 'SET_B') hasB = true;
    }
    if (hasA && hasB) break;
  }
  return { hasBothSets: hasA && hasB };
}

/**
 * Task 8: Returns all ACTIVE cleaning profiles where ANY final STAGE's forward
 * path to END does NOT pass through a CHECKLIST node that is actively gating.
 * These profiles cannot be fully enforced by INTERLOCK mode — the `advance()`
 * path auto-completes the unguarded branch without ever hitting
 * `submit-checklist` (§11.1).
 *
 * Design notes:
 * - `findReachable` walks THROUGH CHECKLIST nodes (hasEndNext alone cannot
 *   distinguish S2→END from S2→CHECKLIST→END).  We use
 *   `collectChecklistsAfterStage` on each final STAGE to check for intervening
 *   CHECKLIST nodes.
 * - A CHECKLIST node is "gating" — i.e. it defers auto-completion — ONLY when:
 *     (a) it has a non-null `checklistProfileId` in its `configuration`, AND
 *     (b) the referenced ChecklistProfile has `isActive: true`.
 *   This mirrors the predicate used by `advance()` to set
 *   `hasPendingChecklistAfterTarget` (cycle-write/advance.ts, ~lines 360-370).
 *   Keep these in sync: if that predicate changes, update the check here too.
 * - A profile is unenforceable if ANY of its final STAGEs reaches END without
 *   a GATING CHECKLIST (not just ALL of them).  A branching pipeline (diamond)
 *   with one enforceable path and one unenforceable path is still unenforceable
 *   overall — the unguarded branch silently completes the cycle.  Therefore the
 *   loop breaks on the first unenforceable final stage it finds, not the first
 *   enforceable one.
 * - The ChecklistProfile.isActive lookup is batched (one query across all
 *   profiles) to avoid N+1 queries.
 */
export async function findProfilesWithoutFinalChecklist(): Promise<
  { id: string; name: string }[]
> {
  const profiles = await prisma.filterCleaningProfile.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, stages: true, connections: true },
  });

  // ── Pass 1: collect every checklistProfileId referenced by a post-final-stage
  //    CHECKLIST node across ALL active profiles.  Batching the isActive lookup
  //    here avoids N+1 DB round-trips.
  const allReferencedCpIds = new Set<string>();
  for (const profile of profiles) {
    const nodes = profile.stages as any[];
    const edges = profile.connections as any[];
    for (const node of nodes) {
      if (node.nodeType !== 'STAGE' || !node.stateKey) continue;
      const r = executor.findReachable(node.id, nodes, edges);
      if (r.hasEndNext && r.reachableStages.length === 0) {
        for (const pn of executor.collectChecklistsAfterStage(node, nodes, edges)) {
          const cpId = (pn.configuration as any)?.checklistProfileId as string | undefined;
          if (cpId) allReferencedCpIds.add(cpId);
        }
      }
    }
  }

  // ── Batch isActive check.  Only IDs that exist AND have isActive:true count
  //    as gating — mirrors advance.ts's ChecklistProfile.findMany({isActive:true}).
  const activeChecklistIds = new Set<string>();
  if (allReferencedCpIds.size > 0) {
    const active = await prisma.checklistProfile.findMany({
      where: { id: { in: [...allReferencedCpIds] }, isActive: true },
      select: { id: true },
    });
    for (const row of active) activeChecklistIds.add(row.id);
  }

  // ── Pass 2: classify each profile.
  const result: { id: string; name: string }[] = [];

  for (const profile of profiles) {
    // Cast to the ProfileNode / ProfileEdge shapes expected by the shared helpers.
    const nodes = profile.stages as Parameters<typeof executor.findReachable>[1];
    const edges = profile.connections as Parameters<typeof executor.findReachable>[2];

    let unenforceable = false;

    for (const node of nodes) {
      if (node.nodeType !== 'STAGE' || !node.stateKey) continue;
      const r = executor.findReachable(node.id, nodes, edges);
      if (r.hasEndNext && r.reachableStages.length === 0) {
        // Final STAGE identified — check whether an ACTIVE-GATING CHECKLIST
        // precedes END.  A node is gating only when checklistProfileId is
        // non-null AND the referenced profile is isActive:true (see note above).
        const postNodes = executor.collectChecklistsAfterStage(node, nodes, edges);
        const hasGatingChecklist = postNodes.some(pn => {
          const cpId = (pn.configuration as any)?.checklistProfileId as string | undefined;
          return !!cpId && activeChecklistIds.has(cpId);
        });
        if (!hasGatingChecklist) {
          unenforceable = true;
          break; // One unenforceable final stage is enough to flag the profile.
        }
      }
    }

    if (unenforceable) {
      result.push({ id: profile.id, name: profile.name });
    }
  }

  return result;
}

/**
 * Gate: block a filter from submitting its final-stage advance when the AHU
 * interlock mode is INTERLOCK and one or more sibling filters have not yet
 * reached their final cleaning stage.
 *
 * Mirrors assertStageApprovedToLeave (stage-interlock.ts) — same AppError
 * class, same details-shape pattern — but with status 422 and code
 * AHU_INTERLOCK_PENDING.
 *
 * Short-circuits (no-op) when:
 *  - isOfflineReplay is true (best-effort offline; D2 decision)
 *  - mode is not INTERLOCK
 *  - the filter has no AHU parent
 */
export async function assertAhuInterlockSatisfied(params: {
  filterId: string;
  isOfflineReplay: boolean;
  set?: FilterSetChoice;
}): Promise<void> {
  if (params.isOfflineReplay) return;
  if ((await getAhuCompletionMode()) !== 'INTERLOCK') return;

  const ahuId = await resolveAhuId(params.filterId);
  if (!ahuId) return; // not under an AHU → don't gate

  const { allAtFinal, pending, ahuName, filters } = await computeAhuCompletionStatus(ahuId, params.filterId, params.set);
  if (!allAtFinal) {
    throw new AppError(
      422,
      'AHU_INTERLOCK_PENDING',
      // 2026-08-10: wording follows the rule, which is now "every sibling is
      // staged and waiting for the final step" — not "already at it", a state
      // no cycle could reach.
      'All filters belonging to this AHU must be ready for the final cleaning stage before submission.',
      // ahuName + full roster mirror the completion-status endpoint so the
      // client's safety-net dialog (if the state changed between the pre-check
      // and submit) renders the same rich list.
      { pendingFilters: pending, ahuName, filters, currentFilterId: params.filterId },
    );
  }
}
