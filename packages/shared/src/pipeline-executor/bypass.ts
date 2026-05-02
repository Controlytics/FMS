/**
 * Bypass justification + reachability guards (Phase 8.4c scaffold).
 *
 * Phase 8.5 fills these in by extracting the pure portions of the
 * `bypass()` route in filter-operations.service.ts (lines ~1548-1600) +
 * the `BypassStageAction` emission inside the tape generator
 * (tape-generator.ts:312-331).
 */
import type { LocalContext, GuardResult } from './types.js';

/**
 * Asserts the cycle's profile permits bypass (`flowMode === 'BYPASS_ENABLED'`).
 * Returns `{ ok: false, code: 'BYPASS_NOT_ALLOWED' }` when the profile is
 * STRICT or another non-bypass mode.
 */
export function assertBypassAllowed(_ctx: LocalContext): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/bypass.assertBypassAllowed — Phase 8.5',
  );
}

/**
 * Asserts that `targetStateKey` is a legal bypass target — i.e. it is a
 * STAGE node in the pipeline (not necessarily reachable forward) and not
 * the cycle's current state. Mirrors the validation in
 * filter-operations.service.ts:1548-1556 and the generator's M1
 * "full pipeline-stage set, excluding current state" rule.
 */
export function assertCanBypassTo(
  _ctx: LocalContext,
  _targetStateKey: string,
): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/bypass.assertCanBypassTo — Phase 8.5',
  );
}

/**
 * Asserts that the operator-supplied justification is at least
 * `minLength` characters (see `BypassStageAction.requiresJustification`).
 * Default minLength = 10 chars per existing route logic.
 */
export function assertBypassJustification(
  _ctx: LocalContext,
  _justification: string,
  _minLength?: number,
): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/bypass.assertBypassJustification — Phase 8.5',
  );
}
