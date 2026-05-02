/**
 * Dryer duration + readings guards (Phase 8.4c scaffold).
 *
 * Phase 8.5 fills these in by extracting the pure portions of the DRY_IN
 * specials in `advance()` (filter-operations.service.ts:1156-1187, the
 * SET_DURATION + half-time-elapsed + readings flow) plus the operating-range
 * validation in submit-readings.
 */
import type {
  LocalContext,
  GuardResult,
  ValidationResult,
} from './types.js';

/**
 * Asserts that `minutes` is a valid dryer duration (within profile-allowed
 * min/max and matches the SET_DRYER_DURATION action's params bounds — see
 * `SetDryerDurationAction` in action-tape.ts).
 */
export function assertValidDryerDuration(
  _ctx: LocalContext,
  _minutes: number,
): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/dryer.assertValidDryerDuration — Phase 8.5',
  );
}

/**
 * Asserts that the dryer half-time has elapsed for the current cycle —
 * i.e. operator may now submit readings. Mirrors the half-elapsed check
 * in advance():1162-1187.
 *
 * Returns `{ ok: false, code: 'DRYER_HALF_TIME_NOT_ELAPSED', ... }` when
 * the operator is trying to submit too early; `{ ok: true }` otherwise.
 */
export function assertDryerHalfTimeElapsed(_ctx: LocalContext): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/dryer.assertDryerHalfTimeElapsed — Phase 8.5',
  );
}

/**
 * Validates instrument readings against the pinned EquipmentGroup's
 * operating ranges. Returns per-instrument failures (out-of-range, missing
 * value, wrong dtype) so the FE can highlight bad cells.
 */
export function validateInstrumentReadings(
  _ctx: LocalContext,
  _readings: Record<string, number>,
): ValidationResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/dryer.validateInstrumentReadings — Phase 8.5',
  );
}
