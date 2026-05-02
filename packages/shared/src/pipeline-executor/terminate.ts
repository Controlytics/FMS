/**
 * Terminate-cycle justification + state guards (Phase 8.4c scaffold).
 *
 * Phase 8.5 fills these in by extracting the pure portions of the
 * `terminate()` route in filter-operations.service.ts (the cycle-status +
 * justification checks; the audit-event write stays in the service).
 */
import type { LocalContext, GuardResult } from './types.js';

/**
 * Asserts the cycle is in a state where TERMINATE is permitted —
 * `status === 'IN_PROGRESS'`. Returns
 * `{ ok: false, code: 'CYCLE_NOT_IN_PROGRESS' }` for completed / already
 * terminated cycles.
 */
export function assertTerminateAllowed(_ctx: LocalContext): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/terminate.assertTerminateAllowed — Phase 8.5',
  );
}

/**
 * Asserts that the operator-supplied termination reason is at least
 * `minLength` characters (matches `TerminateCycleAction.requiresJustification`,
 * default 10).
 */
export function assertTerminateJustification(
  _ctx: LocalContext,
  _justification: string,
  _minLength?: number,
): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/terminate.assertTerminateJustification — Phase 8.5',
  );
}
