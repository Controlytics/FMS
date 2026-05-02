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
 * `ActionRenderer` — Phase 8.1 dispatch component for the decision tape.
 *
 * Takes a single `Action` (one entry from `ActionTape.actions`) plus an
 * `onSubmit` callback. The renderer:
 *   1. Switches on `action.type` to render the right child stub component.
 *   2. Owns `loading` state for the in-flight submit; passes `disabled` to
 *      the child while the parent's promise hasn't resolved.
 *   3. Honors a caller-provided `disabled` prop (e.g. when the cycle is
 *      blocked by another action elsewhere in the tape).
 *
 * Phase 8.2 will swap each stub for a fully-featured component (dialogs,
 * forms, validation rendering) — but the dispatch shape stays the same.
 *
 * For `<ActionTapeRenderer />` (rendering the WHOLE tape with a single
 * loading-lock across actions), use the convenience wrapper at the bottom
 * of this file.
 */
export interface ActionRendererProps {
  action: Action;
  /**
   * Caller's submit handler. Returns a promise so the renderer can flip the
   * `loading` state on/off automatically. The action shape passed to the
   * caller is the SAME shape the server emits — no translation.
   */
  onSubmit: (action: Action) => Promise<void> | void;
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

  const handleClick = async () => {
    if (isDisabled) return;
    setLoading(true);
    try {
      await onSubmit(action);
    } finally {
      setLoading(false);
    }
  };

  switch (action.type) {
    case 'ADVANCE_TO_STAGE':
      return (
        <AdvanceToStageButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
    case 'SUBMIT_CHECKLIST':
      return (
        <SubmitChecklistButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
    case 'SUBMIT_DRYER_READINGS':
      return (
        <SubmitDryerReadingsButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
    case 'SET_DRYER_DURATION':
      return (
        <SetDryerDurationButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
    case 'BYPASS_STAGE':
      return (
        <BypassStageButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
    case 'TERMINATE_CYCLE':
      return (
        <TerminateCycleButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
    case 'COMPLETE_CYCLE':
      return (
        <CompleteCycleButton
          action={action}
          disabled={isDisabled}
          loading={loading}
          onClick={handleClick}
        />
      );
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
 * are disabled. Phase 8.2 may want this for the operator surface.
 */
export interface ActionTapeRendererProps {
  actions: Action[];
  onSubmit: (action: Action) => Promise<void> | void;
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

  const handleSubmit = async (action: Action) => {
    const key = actionKey(action);
    if (busyKey) return;
    setBusyKey(key);
    try {
      await onSubmit(action);
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
