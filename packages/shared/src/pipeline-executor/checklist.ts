/**
 * Checklist-validation guards (Phase 8.4c scaffold).
 *
 * Phase 8.5 fills these in by extracting the pure portions of:
 *   - `collectChecklistsAfterStage()` (filter-operations.service.ts:31-55)
 *   - the pending-checklist gate inside `advance()` (line 1064-1075)
 *   - `submitChecklist()` answer-shape validation (lines 832-980 ish)
 *
 * Server-side answer persistence (event row + checksum) stays in the
 * service layer — the executor only validates the answer shape against
 * the pinned ChecklistProfile.
 */
import type {
  LocalContext,
  GuardResult,
  ValidationResult,
} from './types.js';

/**
 * Checks whether the cycle's current stage has a pending CHECKLIST node
 * downstream that has NOT yet been answered (no `CHECKLIST_COMPLETED`
 * event with `attributes.afterStage === currentState`).
 *
 * When `{ ok: false }`, the operator MUST submit answers before any
 * advance / bypass is permitted. Mirrors the gate in advance():1064-1075.
 */
export function assertNoPendingChecklist(_ctx: LocalContext): GuardResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/checklist.assertNoPendingChecklist — Phase 8.5',
  );
}

/**
 * Returns the IDs of CHECKLIST profiles that are pending after the cycle's
 * current stage. Empty array when no checklist gate exists or all gates
 * have been satisfied for this stage.
 */
export function getPendingChecklistProfileIds(_ctx: LocalContext): string[] {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/checklist.getPendingChecklistProfileIds — Phase 8.5',
  );
}

/**
 * Validates that a submitted answer set covers every required question on
 * the pinned checklist profile and that each answer has a value of the
 * right `questionType`. Returns per-field failures so the FE can highlight
 * the offending inputs.
 */
export function validateChecklistAnswers(
  _ctx: LocalContext,
  _answers: Record<string, unknown>,
): ValidationResult {
  throw new Error(
    'NOT_IMPLEMENTED — pipeline-executor/checklist.validateChecklistAnswers — Phase 8.5',
  );
}
