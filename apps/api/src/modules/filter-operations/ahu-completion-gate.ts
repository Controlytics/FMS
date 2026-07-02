import { prisma } from '../../lib/prisma.js';
import * as executor from '@digilog/shared';
import { loadLocalContext } from './local-context.js';
import type { RequestContext } from '../../types/context.js';
import { AppError } from '../../lib/errors.js';

export type AhuCompletionMode = 'NONE' | 'POPUP' | 'INTERLOCK';

export async function getAhuCompletionMode(): Promise<AhuCompletionMode> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'ahu-completion-process' } });
  const m = (cfg?.configValue as { mode?: string } | null)?.mode;
  return m === 'INTERLOCK' || m === 'POPUP' ? m : 'NONE';
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
 * True when a filter has reached (or passed through) its final cleaning stage:
 *  - Active cycle (currentCycleId != null): filter is currently parked at the
 *    final stage identified in finalStageByFilter for this filter.
 *  - No cycle (currentCycleId == null): lifecycle state is
 *    CLEANING_CYCLE_COMPLETED (cycle auto-completed on the last advance).
 * Everything else — no cycle started, mid-cycle at a non-final stage — is false.
 */
export function reachedFinal(f: CountedFilter, finalStageByFilter: Map<string, string | null>): boolean {
  if (f.currentCycleId != null) {
    const finalKey = finalStageByFilter.get(f.id);
    return !!finalKey && f.currentLifecycleState === finalKey;
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
 * Load all active, non-retired, cleanable child filters of the given AHU.
 * "Cleanable" means the child has a FilterDetails row with a filterProfileId
 * set — instances without a profile are not eligible for cleaning cycles and
 * should not count toward AHU completion.
 */
export async function loadCountedFilters(ahuId: string): Promise<CountedFilter[]> {
  const rows = await prisma.assetInstance.findMany({
    where: {
      parentId: ahuId,
      isActive: true,
      status: { not: 'Retired' },
      filterDetails: { filterProfileId: { not: null } },
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
): Promise<{ allAtFinal: boolean; pending: { id: string; name: string; stage: string }[] }> {
  const others = (await loadCountedFilters(ahuId)).filter(f => f.id !== excludeFilterId);

  // Build the final-stage key for each sibling that has an active cycle.
  // loadLocalContext is called once per active-cycle sibling (N-small).
  const finalStageByFilter = new Map<string, string | null>();
  for (const f of others) {
    if (!f.currentCycleId) continue;
    const loaded = await loadLocalContext(f.id, SYSTEM_CTX);
    finalStageByFilter.set(f.id, computeFinalStageKey(loaded.ctx.profile));
  }

  const pending = others
    .filter(f => !reachedFinal(f, finalStageByFilter))
    .map(f => ({ id: f.id, name: f.name, stage: f.currentLifecycleState ?? 'Not started' }));

  return { allAtFinal: pending.length === 0, pending };
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
}): Promise<void> {
  if (params.isOfflineReplay) return;
  if ((await getAhuCompletionMode()) !== 'INTERLOCK') return;

  const ahuId = await resolveAhuId(params.filterId);
  if (!ahuId) return; // not under an AHU → don't gate

  const { allAtFinal, pending } = await computeAhuCompletionStatus(ahuId, params.filterId);
  if (!allAtFinal) {
    throw new AppError(
      422,
      'AHU_INTERLOCK_PENDING',
      'All filters belonging to this AHU must reach their final cleaning stage before submission.',
      { pendingFilters: pending },
    );
  }
}
