/**
 * Decision-tape FE types — convenience re-export from `@digilog/shared`.
 *
 * Phase 8.1 lifted the source-of-truth into `packages/shared/src/types/
 * action-tape.ts` so the server tape generator and the FE renderer consume
 * the SAME types. Call sites are free to import directly from `@digilog/shared`,
 * but this barrel keeps action-tape imports co-located with the renderer code
 * for readability.
 */
export type {
  Action,
  ActionKind,
  ActionTape,
  AdvanceToStageAction,
  BypassStageAction,
  CompleteCycleAction,
  OperatingRangeMap,
  SetDryerDurationAction,
  SubmitChecklistAction,
  SubmitDryerReadingsAction,
  TapeQuestion,
  TerminateCycleAction,
} from '@digilog/shared';
