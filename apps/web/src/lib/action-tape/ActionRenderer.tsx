import { useState } from 'react';
import type { Action } from './types.js';
import { AdvanceToStageButton } from './components/AdvanceToStageButton.js';
import { SubmitChecklistButton } from './components/SubmitChecklistButton.js';
import { SubmitDryerReadingsButton } from './components/SubmitDryerReadingsButton.js';
import { SetDryerDurationButton } from './components/SetDryerDurationButton.js';
import { BypassStageButton } from './components/BypassStageButton.js';
import { TerminateCycleButton } from './components/TerminateCycleButton.js';
import { CompleteCycleButton } from './components/CompleteCycleButton.js';

/**
 * Phase 8.2 payload shape — one per action type. Renderers call
 * `onSubmit(payload)`; the dispatcher wraps with the action context and
 * forwards `(action, payload)` to the caller.
 *
 * The shapes mirror what the corresponding server route accepts so the
 * Phase 8.4 cutover can plug a single dispatcher into all six existing
 * routes (POST /advance, /submit-checklist, /bypass, /terminate, /complete).
 */
export type ActionPayload =
  | { type: 'ADVANCE_TO_STAGE'; targetState: string; readings?: Record<string, number> }
  // Note: `answers` is keyed by questionId and only contains questions the
  // operator actually answered. Mirrors the existing `POST /:id/submit-checklist`
  // contract (filter-operations.service.ts:870-882) where required-question
  // enforcement runs server-side and unexpected keys are rejected outright —
  // unanswered optional questions MUST be omitted, not sent as 'N/A'.
  | { type: 'SUBMIT_CHECKLIST'; checklistProfileId: string; versionPin: number; afterStage: string; answers: Record<string, string>; remarks?: Record<string, string> }
  | { type: 'SUBMIT_DRYER_READINGS'; readings: Record<string, number> }
  | { type: 'SET_DRYER_DURATION'; targetState: 'DRY_IN'; minMinutes: number; maxMinutes: number }
  | { type: 'BYPASS_STAGE'; targetState: string; justification: string }
  | { type: 'TERMINATE_CYCLE'; justification: string }
  | { type: 'COMPLETE_CYCLE' };

/**
 * `ActionRenderer` — Phase 8.2 dispatch component for the decision tape.
 *
 * Phase 8.2 contract change (vs 8.1):
 *   - Children receive `onSubmit(payload: ActionPayload)` instead of `onClick()`.
 *   - The dispatcher wraps each child's `onSubmit` to call the caller's
 *     `onSubmit(action, payload)` and to flip `loading` while the parent
 *     promise is pending.
 *   - For renderers with no UI gate (COMPLETE_CYCLE, ADVANCE without
 *     instrument readings), the child calls `onSubmit({})` directly from
 *     its click handler — single-click submit, no dialog.
 *   - For dialog-bearing renderers (BYPASS, TERMINATE, SUBMIT_CHECKLIST,
 *     SUBMIT_DRYER_READINGS, SET_DRYER_DURATION, ADVANCE_TO_STAGE-with-
 *     readings), the child opens a dialog on click and only fires onSubmit
 *     after the operator submits the dialog form.
 *
 * The exhaustiveness guard (`_exhaustive: never`) still proves that any new
 * action kind added to the union requires a renderer here.
 *
 * For `<ActionTapeRenderer />` (rendering the WHOLE tape with a single
 * loading-lock across actions), use the convenience wrapper at the bottom
 * of this file.
 */
export interface ActionRendererProps {
  action: Action;
  /**
   * Caller's submit handler. Returns a promise so the renderer can flip the
   * `loading` state on/off automatically. Receives both the original action
   * (so the caller knows which route to call) and the renderer-built payload
   * (so the caller doesn't have to re-derive any of the dialog fields).
   */
  onSubmit: (action: Action, payload: ActionPayload) => Promise<void> | void;
  /**
   * Externally-controlled disabled state. When true, the action button is
   * disabled regardless of in-flight state (e.g. another action elsewhere
   * in the tape is currently submitting).
   */
  disabled?: boolean;
}

export function ActionRenderer({ action, onSubmit, disabled }: ActionRendererProps) {
  const [loading, setLoading] = useState(false);
  const isDisabled = !!disabled || loading;

  /** Wraps the child's onSubmit so the dispatcher owns the loading flag. */
  const dispatch = async (payload: ActionPayload) => {
    if (isDisabled) return;
    setLoading(true);
    try {
      await onSubmit(action, payload);
    } finally {
      setLoading(false);
    }
  };

  switch (action.type) {
    case 'ADVANCE_TO_STAGE':
      return <AdvanceToStageButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    case 'SUBMIT_CHECKLIST':
      return <SubmitChecklistButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    case 'SUBMIT_DRYER_READINGS':
      return <SubmitDryerReadingsButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    case 'SET_DRYER_DURATION':
      return <SetDryerDurationButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    case 'BYPASS_STAGE':
      return <BypassStageButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    case 'TERMINATE_CYCLE':
      return <TerminateCycleButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    case 'COMPLETE_CYCLE':
      return <CompleteCycleButton action={action} disabled={isDisabled} loading={loading} onSubmit={dispatch} />;
    default: {
      // Exhaustiveness guard — if a new action kind is added to the union but
      // not wired here, the typechecker fails. At runtime we render nothing
      // (the server tape is the source of truth; an unknown kind is a bug).
      const _exhaustive: never = action;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Convenience wrapper that renders the WHOLE `actions` list with a shared
 * loading-lock across every button — when one action is in flight, the others
 * are disabled. Phase 8.4 cutover may want this for the operator surface.
 */
export interface ActionTapeRendererProps {
  actions: Action[];
  onSubmit: (action: Action, payload: ActionPayload) => Promise<void> | void;
  /** Externally-controlled disabled (e.g. tape is stale; refetching). */
  disabled?: boolean;
  /** Optional empty-state ReactNode when `actions` is `[]`. */
  emptyState?: React.ReactNode;
}

export function ActionTapeRenderer({ actions, onSubmit, disabled, emptyState }: ActionTapeRendererProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  if (actions.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  const handleSubmit = async (action: Action, payload: ActionPayload) => {
    const key = actionKey(action);
    if (busyKey) return;
    setBusyKey(key);
    try {
      await onSubmit(action, payload);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map(action => {
        const key = actionKey(action);
        const isBusyHere = busyKey === key;
        const isOtherBusy = !!busyKey && !isBusyHere;
        return (
          <ActionRenderer
            key={key}
            action={action}
            onSubmit={handleSubmit}
            disabled={!!disabled || isOtherBusy}
          />
        );
      })}
    </div>
  );
}

/**
 * Stable per-action key for React reconciliation. Includes `type` plus the
 * params that disambiguate two same-type actions (e.g. two `ADVANCE_TO_STAGE`
 * for different `targetState`).
 */
function actionKey(action: Action): string {
  switch (action.type) {
    case 'ADVANCE_TO_STAGE':
    case 'BYPASS_STAGE':
      return `${action.type}:${action.params.targetState}`;
    case 'SUBMIT_CHECKLIST':
      return `${action.type}:${action.params.checklistProfileId}@${action.params.versionPin}:${action.params.afterStage}`;
    case 'SUBMIT_DRYER_READINGS':
      return `${action.type}:${action.params.instrumentIds.join(',')}`;
    case 'SET_DRYER_DURATION':
      return `${action.type}:${action.params.targetState}`;
    case 'TERMINATE_CYCLE':
    case 'COMPLETE_CYCLE':
      return action.type;
  }
}
