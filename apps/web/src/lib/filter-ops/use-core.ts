/**
 * useFilterOperationsCore — Day 1 of the D1/D2/D4 dialog-state refactor.
 *
 * See `tasks/D1-D2-D4-DIALOG-STATE-REFACTOR-ENGAGEMENT.md` for the full plan.
 *
 * Day 1 scope: the smallest vertical that proves the architecture —
 * `advance` + `submitChecklist`. Both wrap `executeOrQueue` and dispatch
 * dialog transitions through `reduceDialogState`. After every cycle write,
 * the resolved action tape decides whether the checklist dialog should
 * open next; dispatch is the SOLE setter so the imperative
 * setChecklistDialog clobber-races from the page files cannot recur.
 *
 * Day 2+ will extend this with start-cycle/reason/equipment/dryer/block-change
 * handlers + the batch path. Pages are NOT migrated this phase — they keep
 * their own state today and will be lifted onto this hook in Day 3/4.
 *
 * IMPORTANT (deep-review fix D6 contract): handlers never swallow REAUTH
 * errors. The wrapped `executeOrQueue` will throw raw REAUTH_REQUIRED /
 * REAUTH_FAILED (api-client.ts:67); the caller's reauth.execute() wrapper
 * is responsible for displaying the dialog. This hook treats REAUTH as
 * "not my problem — propagate".
 */
import { useReducer, useState, useCallback } from 'react';
import { useOffline } from '../../hooks/use-offline';
import {
  reduceDialogState,
  type DialogState,
  type DialogEvent,
} from './dialog-state';
import { resolvePendingChecklistDialog } from './resolve-pending-checklist';
import { findNextPendingChecklist, type PendingChecklistBatchItem } from './next-pending-checklist';
import { getCurrentActions } from '@/lib/action-tape';

export interface AdvanceArgs {
  filterId: string;
  filterName: string;
  targetState: string;
  cleaningAreaId?: string;
  remarks?: string;
  /** When the operator queues a batch of filters, pass them all so
   *  the checklist dialog can walk them in sequence (D1 batch fix). */
  batchRemainder?: PendingChecklistBatchItem[];
}

export interface SubmitChecklistArgs {
  filterId: string;
  filterName: string;
  answers: Record<string, unknown>;
  expectedProfileVersions?: Record<string, number>;
  password?: string;
}

export interface UseFilterOperationsCoreResult {
  /** The sole source of truth for "which dialog is open". */
  dialogState: DialogState;
  /** Direct dispatch for JSX close-button handlers etc. */
  dispatch: (event: DialogEvent) => void;
  /** Wrapped cycle-advance. Resolves the next dialog from the action tape. */
  advance: (args: AdvanceArgs) => Promise<{ executed: boolean }>;
  /** Wrapped checklist submission. Walks `dialogState.remainingBatch`
   *  to pop the next pending checklist (D1 fix); closes when none remain. */
  submitChecklist: (args: SubmitChecklistArgs) => Promise<{ executed: boolean }>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Build the core hook. The hook is intentionally headless — it owns state +
 * handlers but renders nothing. Page components compose it with their own
 * JSX for the scan input, queue display, dialogs, etc.
 *
 * The handlers re-throw on REAUTH errors (per D6 contract) so the caller's
 * reauth.execute() wrapper can manage the password dialog. The hook itself
 * is unaware of reauth — keeping concerns separated.
 */
export function useFilterOperationsCore(): UseFilterOperationsCoreResult {
  const { executeOrQueue } = useOffline();
  const [dialogState, dispatch] = useReducer(reduceDialogState, { kind: 'none' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  /**
   * advance — call executeOrQueue, then resolve the action tape to decide
   * if the checklist dialog should now open. Single decision site so the
   * D1 "six call sites" pattern cannot recur within this hook.
   */
  const advance = useCallback(
    async (args: AdvanceArgs): Promise<{ executed: boolean }> => {
      setIsLoading(true);
      setError(null);
      try {
        const { executed, result } = await executeOrQueue(
          'advance',
          args.filterId,
          args.filterName,
          {
            targetState: args.targetState,
            cleaningAreaId: args.cleaningAreaId,
            remarks: args.remarks ?? `${args.targetState} - ${args.filterName}`,
          },
          args.targetState,
        );

        // Resolve the post-advance action tape. Online: server may have
        // returned actions[] inline. Offline (queued): local executor reads
        // the just-rewritten cache row. resolvePendingChecklistDialog
        // returns null when no checklist gate is active.
        const dialogChecklists = await resolvePendingChecklistDialog(
          args.filterId,
          (result as { actions?: unknown[] } | undefined)?.actions as any,
        );

        if (dialogChecklists) {
          dispatch({
            type: 'open_checklist',
            filterId: args.filterId,
            filterName: args.filterName,
            checklists: dialogChecklists,
            remainingBatch: args.batchRemainder,
          });
        } else if (args.batchRemainder && args.batchRemainder.length > 0) {
          // No dialog for THIS filter, but the batch may have others with
          // pending checklists. Walk the remainder and pop the first hit.
          const next = await findNextPendingChecklist(
            args.batchRemainder,
            resolvePendingChecklistDialog,
          );
          if (next) {
            dispatch({
              type: 'open_checklist',
              filterId: next.item.filterId,
              filterName: next.item.filterName,
              checklists: next.checklists,
              remainingBatch: next.remaining,
            });
          }
        }

        return { executed };
      } catch (e: unknown) {
        // D6 contract: REAUTH and OFFLINE_CACHE_RECOMPUTE_FAILED must
        // propagate so the caller's reauth.execute() / error UI can handle
        // them appropriately. Generic errors surface in this hook's error
        // state so the page can render them.
        const err = e as { error?: string; code?: string; message?: string };
        const errCode = err.error ?? err.code;
        if (
          errCode === 'REAUTH_REQUIRED' ||
          errCode === 'REAUTH_FAILED' ||
          errCode === 'OFFLINE_CACHE_RECOMPUTE_FAILED'
        ) {
          throw e;
        }
        setError(err.message ?? 'Advance failed');
        return { executed: false };
      } finally {
        setIsLoading(false);
      }
    },
    [executeOrQueue],
  );

  /**
   * submitChecklist — submit answers, then walk the batch continuation
   * queue (the D1 root cause: pre-fix the loop took only the first item
   * and dropped the rest). After successful submit, pop the next pending
   * checklist from `dialogState.remainingBatch`; close the dialog if none
   * remain.
   */
  const submitChecklist = useCallback(
    async (args: SubmitChecklistArgs): Promise<{ executed: boolean }> => {
      setIsLoading(true);
      setError(null);
      try {
        const { executed } = await executeOrQueue(
          'submit-checklist',
          args.filterId,
          args.filterName,
          {
            answers: args.answers,
            expectedProfileVersions: args.expectedProfileVersions ?? {},
          },
          undefined,
          args.password,
        );

        // Snapshot the remainingBatch BEFORE we dispatch — the close
        // transition would wipe it otherwise.
        const remainingBatch =
          dialogState.kind === 'awaiting_checklist'
            ? (dialogState.remainingBatch ?? [])
            : [];

        if (remainingBatch.length === 0) {
          dispatch({ type: 'close' });
        } else {
          // Walk the queue for the next filter still needing a checklist.
          const next = await findNextPendingChecklist(
            remainingBatch,
            resolvePendingChecklistDialog,
          );
          if (next) {
            // Close first to satisfy the "close before re-open" transition
            // contract in reduceDialogState. The reducer otherwise throws
            // on checklist → checklist (D4 invariant).
            dispatch({ type: 'close' });
            dispatch({
              type: 'open_checklist',
              filterId: next.item.filterId,
              filterName: next.item.filterName,
              checklists: next.checklists,
              remainingBatch: next.remaining,
            });
          } else {
            dispatch({ type: 'close' });
          }
        }

        return { executed };
      } catch (e: unknown) {
        const err = e as { error?: string; code?: string; message?: string };
        const errCode = err.error ?? err.code;
        if (
          errCode === 'REAUTH_REQUIRED' ||
          errCode === 'REAUTH_FAILED' ||
          errCode === 'OFFLINE_CACHE_RECOMPUTE_FAILED'
        ) {
          throw e;
        }
        setError(err.message ?? 'Checklist submission failed');
        return { executed: false };
      } finally {
        setIsLoading(false);
      }
    },
    [executeOrQueue, dialogState],
  );

  return {
    dialogState,
    dispatch,
    advance,
    submitChecklist,
    isLoading,
    error,
    clearError,
  };
}

// Re-export so callers can `import { useFilterOperationsCore, DialogState } from '@/lib/filter-ops'`
export type { DialogState, DialogEvent } from './dialog-state';
