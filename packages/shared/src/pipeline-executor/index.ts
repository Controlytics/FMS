/**
 * @digilog/shared/pipeline-executor — public surface (Phase 8.4c scaffold).
 *
 * The shared executor — pure, runtime-agnostic guard functions consumed by
 * both `apps/api` (server transitions) and `apps/web` (FE / offline replay).
 * Phase 8.5 fills in the bodies; this barrel pre-wires the public surface
 * so 8.5 implementer can focus on guard logic, not module wiring.
 *
 * Re-exports follow the existing shared-package convention: explicit named
 * exports rather than `export *` for types so the public surface stays
 * inspectable from `packages/shared/src/index.ts`.
 */

// ── Types ────────────────────────────────────────────────────────────────
export type {
  GuardResult,
  ValidationFailure,
  ValidationResult,
  ProfileNode,
  ProfileEdge,
  ChecklistQuestion,
  StageInfo,
  ProfileSlice,
  CycleSlice,
  FilterEventSlice,
  FilterParent,
  FilterSlice,
  EquipmentGroupSlice,
  ChecklistProfileSlice,
  AssetTemplateSlice,
} from './types.js';

export type { LocalContext } from './context.js';

// ── Context loaders (stubs in 8.4c, real impls move to apps/* in 8.5) ────
export { loadLocalContext, loadLocalContextFromCache } from './context.js';

// ── Guards ───────────────────────────────────────────────────────────────
export { assertCanTransition, getReachableStages, leadsToEnd } from './transitions.js';
export {
  assertNoPendingChecklist,
  getPendingChecklistProfileIds,
  validateChecklistAnswers,
} from './checklist.js';
export {
  assertValidDryerDuration,
  assertDryerHalfTimeElapsed,
  validateInstrumentReadings,
} from './dryer.js';
export {
  assertBypassAllowed,
  assertCanBypassTo,
  assertBypassJustification,
} from './bypass.js';
export { assertTerminateAllowed, assertTerminateJustification } from './terminate.js';
export { computeNextActions } from './actions.js';
