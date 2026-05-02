/**
 * Tape-generator entry point (Phase 8.4c scaffold).
 *
 * Phase 8.5 will move the existing tape generator body
 * (`apps/api/src/modules/filter-operations/tape/tape-generator.ts`) into
 * this file, rewriting it to consume `LocalContext` instead of the
 * bespoke `TapeInput`. The output type stays `ActionTape` from
 * `@digilog/shared/types/action-tape` so 8.0/8.1/8.2 callers (FE
 * renderers, parity tests) keep working unchanged.
 *
 * Once 8.5 lands:
 *   - `apps/api/src/modules/filter-operations/tape/tape-generator.ts`
 *     becomes a thin shim that builds a LocalContext and calls
 *     `computeNextActions()`.
 *   - FE `mobile-operations.tsx` builds its LocalContext from the IDB
 *     cache and calls `computeNextActions()` directly — no server roundtrip
 *     needed for action computation.
 */
import type { ActionTape } from '../types/action-tape.js';
import type { LocalContext } from './types.js';

/**
 * Pure-function tape generator over a LocalContext snapshot.
 *
 * Determinism contract: for fixed `(ctx)`, output `actions[]` order +
 * content + `tapeVersion` is stable. Mirrors the existing tape generator's
 * contract.
 */
export function computeNextActions(_ctx: LocalContext): ActionTape {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/actions.computeNextActions — Phase 8.5',
  );
}
