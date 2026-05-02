/**
 * Stage-reachability guards (Phase 8.4c scaffold).
 *
 * Phase 8.5 fills these in by extracting the pure portions of the
 * stage-transition logic currently in
 * `apps/api/src/modules/filter-operations/filter-operations.service.ts`
 * (advance() route) — see scout audit § "transitions".
 */
import type { LocalContext, GuardResult } from './types.js';

/**
 * Asserts that the cycle's current state can legally transition to
 * `targetStateKey` via a forward (non-bypass) advance.
 *
 * Mirrors `findReachable()` walk + the targetState membership check in
 * `advance()` (filter-operations.service.ts:1086-1109).
 */
export function assertCanTransition(
  _ctx: LocalContext,
  _targetStateKey: string,
): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/transitions.assertCanTransition — Phase 8.5',
  );
}

/**
 * Returns the list of stateKeys reachable from the cycle's current state by
 * walking forward through the pipeline graph (skipping CHECKLIST nodes).
 *
 * Pure read of `ctx.profile.nodes` + `ctx.profile.edges`. Server today
 * builds the equivalent in `getCurrentState()` and exposes it as
 * `nextAllowedStages` + `stageLookup`.
 */
export function getReachableStages(_ctx: LocalContext): string[] {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/transitions.getReachableStages — Phase 8.5',
  );
}

/**
 * Returns true when the next non-CHECKLIST node forward from the cycle's
 * current state is the END node (i.e. completing this stage completes the
 * cycle). Used to emit COMPLETE_CYCLE.
 */
export function leadsToEnd(_ctx: LocalContext): boolean {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/transitions.leadsToEnd — Phase 8.5',
  );
}
