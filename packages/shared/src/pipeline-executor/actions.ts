/**
 * Tape-generator entry point (Phase 8.5).
 *
 * Phase 8.5 Commit 2 will move the body of
 * `apps/api/src/modules/filter-operations/tape/tape-generator.ts` here so
 * server + FE share the same action-emission logic. Until then the body
 * lives in the apps/api file and this stub throws — the Commit 1 guard
 * extraction does not depend on this function being implemented.
 */
import type { ActionTape } from '../types/action-tape.js';
import type { LocalContext } from './types.js';

/**
 * Pure-function tape generator over a LocalContext snapshot. Returns
 * `{ state, actions, tapeVersion }`.
 */
export function computeNextActions(_ctx: LocalContext): ActionTape {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/actions.computeNextActions — Phase 8.5 Commit 2',
  );
}

/**
 * Single source of truth for the tapeVersion formula.
 *
 * `profileVersion * 1_000_000 + filterEventCount` — matches Phase 8.4 M3 cap.
 * filterEventCount is scoped to a single CleaningCycle (not the filter's
 * lifetime); the 1e6 multiplier is the per-cycle event cap.
 */
export function computeTapeVersion(
  profileVersion: number,
  filterEventCount: number,
): number {
  return (profileVersion ?? 0) * 1_000_000 + (filterEventCount ?? 0);
}
