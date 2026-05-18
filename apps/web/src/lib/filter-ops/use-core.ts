/**
 * useFilterOperationsCore — Days 1–3 of the D1/D2/D4 dialog-state refactor.
 *
 * See `tasks/D1-D2-D4-DIALOG-STATE-REFACTOR-ENGAGEMENT.md` for the full plan.
 *
 * Day 1 scope (landed 2026-05-17, commit `98b6b6c`): smallest vertical proving
 * the architecture — `advance` + `submitChecklist`. Both wrap `executeOrQueue`
 * and dispatch dialog transitions through `reduceDialogState`. After every
 * cycle write, the resolved action tape decides whether the checklist dialog
 * should open next; dispatch is the SOLE setter so the imperative
 * setChecklistDialog clobber-races from the page files cannot recur.
 *
 * Day 3 scope (this file): full handler surface required for both pages —
 * `advance` (extended args), `startAndAdvance`, `submitChecklist` (extended
 * with offline cache-row clear). Pages are migrated onto this hook in Days
 * 3b–3f (mobile) and Day 4 (desktop). The hook owns:
 *   - executeOrQueue invocation with the full payload
 *   - on-queue cache-row recompute via `recomputeAndCacheFilterState`
 *   - post-op checklist dialog resolution + dispatch (single decision site)
 *   - batch continuation queue walking (D1 fix)
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
import { recomputeAndCacheFilterState, appendChecklistCompletion } from '@/lib/offline-cache';
import { cacheData, getCachedData, OFFLINE_TTL_MS } from '@/lib/offline-store';

/**
 * Advance args — accepts the full payload the page constructs.
 *
 * Maps 1:1 onto `executeOrQueue('advance', ...)`'s payload (which is then
 * forwarded to `/api/filters/:id/advance` online or queued offline). All
 * fields except `filterId` / `filterName` / `targetState` are optional, the
 * hook strips undefined keys before sending so the server schema validator
 * sees a clean payload.
 *
 * `equipmentGroupId` + `instrumentReadings` are the equipment-dialog payload
 * for WASH_IN / DRY_OUT / STORAGE_IN. `dryerAction` + `dryerDurationMinutes`
 * are the DRY_IN payload (SET_DURATION on the dryer dialog, SUBMIT_READINGS
 * on the equipment dialog when DRY_IN's temp is recorded).
 *
 * `batchRemainder` is the desktop multi-scan continuation queue — when set
 * and this filter's advance produces no checklist gate, the hook walks the
 * remainder looking for one. D1 batch fix.
 */
export interface AdvanceArgs {
  filterId: string;
  filterName: string;
  targetState: string;
  cleaningAreaId?: string | null;
  equipmentGroupId?: string;
  instrumentReadings?: Record<string, number>;
  dryerAction?: 'SET_DURATION' | 'SUBMIT_READINGS';
  dryerDurationMinutes?: number;
  remarks?: string;
  batchRemainder?: PendingChecklistBatchItem[];
  /** Reauth password forwarded to executeOrQueue's online path. Pages wrap
   *  this call in reauth.execute() and forward the password the operator
   *  enters. Never persisted to IDB. */
  password?: string;
}

/**
 * Start-cycle compound op args.
 *
 * The cycle-start flow is a compound `executeOrQueue('start-and-advance', ...)`
 * call: the server first POSTs start-cycle (reauth-gated for ADMIN role),
 * then POSTs advance on the same filter. Offline, both halves enqueue
 * atomically. The hook calls `recomputeAndCacheFilterState(...,
 * cycleStarted=true)` when queued so the cache row reflects the new
 * lifecycle state + open cycle.
 */
export interface StartAndAdvanceArgs {
  filterId: string;
  filterName: string;
  cyclePayload: Record<string, any>;
  advancePayload: Record<string, any>;
  targetState: string;
  cleaningAreaId?: string | null;
  password?: string;
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
  dialogState: DialogState;
  dispatch: (event: DialogEvent) => void;
  advance: (args: AdvanceArgs) => Promise<{ executed: boolean; result?: any }>;
  startAndAdvance: (args: StartAndAdvanceArgs) => Promise<{ executed: boolean; result?: any }>;
  submitChecklist: (args: SubmitChecklistArgs) => Promise<{ executed: boolean }>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

// Errors that MUST propagate to the page-level catch so the page can handle
// them with structured UI (reauth dialog, block-change modal, etc.).
// BLOCK_CHANGE_REQUIRED: page catches it and dispatches open_block_change.
// REAUTH_REQUIRED / REAUTH_FAILED: reauth.execute() wrapper needs to surface
//   the inline "Incorrect password" message and let the operator retry.
// OFFLINE_CACHE_RECOMPUTE_FAILED: page-level error state for the operator.
const PROPAGATED_ERROR_CODES = new Set([
  'REAUTH_REQUIRED',
  'REAUTH_FAILED',
  'OFFLINE_CACHE_RECOMPUTE_FAILED',
  'BLOCK_CHANGE_REQUIRED',
]);

function isReauthOrRecompute(e: unknown): boolean {
  const err = e as { error?: string; code?: string };
  const code = err?.error ?? err?.code;
  return typeof code === 'string' && PROPAGATED_ERROR_CODES.has(code);
}

/**
 * Build the advance payload that executeOrQueue forwards to /advance. Drops
 * undefined keys so the server schema validator doesn't see e.g.
 * `dryerAction: undefined`. The default remarks string matches what
 * mobile-operations.tsx and filter-operations.tsx emit today.
 */
function buildAdvancePayload(args: AdvanceArgs): Record<string, any> {
  const payload: Record<string, any> = {
    targetState: args.targetState,
  };
  if (args.cleaningAreaId !== undefined) payload.cleaningAreaId = args.cleaningAreaId;
  if (args.equipmentGroupId !== undefined) payload.equipmentGroupId = args.equipmentGroupId;
  if (args.instrumentReadings !== undefined) payload.instrumentReadings = args.instrumentReadings;
  if (args.dryerAction !== undefined) payload.dryerAction = args.dryerAction;
  if (args.dryerDurationMinutes !== undefined) payload.dryerDurationMinutes = args.dryerDurationMinutes;
  payload.remarks = args.remarks ?? `${args.targetState} - ${args.filterName}`;
  return payload;
}

/**
 * Resolve the post-advance checklist dialog and dispatch it. Centralizes the
 * decision: this filter has a gate → open dialog with batchRemainder; this
 * filter is clean but batch has more → walk the queue; nothing pending →
 * stay idle.
 *
 * Returns the dispatched event (or null if no dialog opened) so callers can
 * differentiate "gate opened" from "advance completed cleanly".
 */
async function resolveAndDispatchChecklist(
  filterId: string,
  filterName: string,
  serverActions: unknown[] | null | undefined,
  batchRemainder: PendingChecklistBatchItem[] | undefined,
  dispatch: (event: DialogEvent) => void,
): Promise<'opened' | 'opened_from_batch' | 'none'> {
  const dialogChecklists = await resolvePendingChecklistDialog(
    filterId,
    serverActions as any,
  );
  if (dialogChecklists) {
    dispatch({
      type: 'open_checklist',
      filterId,
      filterName,
      checklists: dialogChecklists,
      remainingBatch: batchRemainder,
    });
    return 'opened';
  }
  if (batchRemainder && batchRemainder.length > 0) {
    const next = await findNextPendingChecklist(
      batchRemainder,
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
      return 'opened_from_batch';
    }
  }
  return 'none';
}

export function useFilterOperationsCore(): UseFilterOperationsCoreResult {
  const { executeOrQueue } = useOffline();
  const [dialogState, dispatch] = useReducer(reduceDialogState, { kind: 'none' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  /**
   * advance — single-filter advance with full payload support.
   *
   * Online: executeOrQueue POSTs /advance, returns `result.actions[]` when
   * the server emits the tape. The resolver consumes that to decide the
   * dialog.
   *
   * Offline: executeOrQueue queues the op and we MUST rewrite the cache row
   * via recomputeAndCacheFilterState — without that the next gate decision
   * reads stale `nextAllowedStages` and the operator advances past a
   * required checklist (21 CFR violation). The resolver then reads the
   * locally-recomputed tape.
   *
   * Throws on REAUTH and OFFLINE_CACHE_RECOMPUTE_FAILED so the page's
   * reauth.execute() / catch block can present a structured error.
   */
  const advance = useCallback(
    async (args: AdvanceArgs): Promise<{ executed: boolean; result?: any }> => {
      setIsLoading(true);
      setError(null);
      try {
        const payload = buildAdvancePayload(args);
        const { executed, result } = await executeOrQueue(
          'advance',
          args.filterId,
          args.filterName,
          payload,
          args.targetState,
          args.password,
        );

        if (!executed) {
          await recomputeAndCacheFilterState(
            args.filterId,
            args.targetState,
            false,
            args.cleaningAreaId ?? null,
          );
        }

        await resolveAndDispatchChecklist(
          args.filterId,
          args.filterName,
          executed ? (result as { actions?: unknown[] } | undefined)?.actions ?? null : null,
          args.batchRemainder,
          dispatch,
        );

        return { executed, result };
      } catch (e: unknown) {
        if (isReauthOrRecompute(e)) throw e;
        const err = e as { message?: string };
        setError(err?.message ?? 'Advance failed');
        return { executed: false };
      } finally {
        setIsLoading(false);
      }
    },
    [executeOrQueue],
  );

  /**
   * startAndAdvance — compound start-cycle + advance.
   *
   * The cycle-start flow used by the reason / equipment / PM-auto branches.
   * executeOrQueue('start-and-advance') handles both halves: online it posts
   * /start-cycle then /advance with the fresh tapeVersion; offline it queues
   * both operations atomically.
   *
   * On queue, recomputeAndCacheFilterState(...,cycleStarted=true) creates
   * the cycle stub on the cache row so subsequent offline scans see a
   * cycle-in-progress.
   */
  const startAndAdvance = useCallback(
    async (args: StartAndAdvanceArgs): Promise<{ executed: boolean; result?: any }> => {
      setIsLoading(true);
      setError(null);
      try {
        const { executed, result } = await executeOrQueue(
          'start-and-advance',
          args.filterId,
          args.filterName,
          { cyclePayload: args.cyclePayload, advancePayload: args.advancePayload } as any,
          args.targetState,
          args.password,
        );

        if (!executed) {
          await recomputeAndCacheFilterState(
            args.filterId,
            args.targetState,
            true,
            args.cleaningAreaId ?? null,
          );
        }

        await resolveAndDispatchChecklist(
          args.filterId,
          args.filterName,
          executed ? (result as { actions?: unknown[] } | undefined)?.actions ?? null : null,
          args.batchRemainder,
          dispatch,
        );

        return { executed, result };
      } catch (e: unknown) {
        if (isReauthOrRecompute(e)) throw e;
        const err = e as { message?: string };
        setError(err?.message ?? 'Start-and-advance failed');
        return { executed: false };
      } finally {
        setIsLoading(false);
      }
    },
    [executeOrQueue],
  );

  /**
   * submitChecklist — submit answers, walk batch continuation queue.
   *
   * Offline-parity contract: when queued, we MUST clear `pendingChecklist[]`
   * on the cache row and re-derive `nextAllowedStages` + `actions[]` from
   * the tape. Without this, the next gate decision still sees the pending
   * checklist and refuses to advance. See mobile-operations.tsx:1397-1415
   * (pre-migration) for the legacy inline implementation this replaces.
   *
   * The D1 batch fix: pre-fix the loop took only the first remainingBatch
   * item and dropped subsequent filters silently. We pop the next pending
   * checklist by walking the queue via findNextPendingChecklist, which
   * skips filters with no checklist gate (those advance through cleanly).
   */
  const submitChecklist = useCallback(
    async (args: SubmitChecklistArgs): Promise<{ executed: boolean }> => {
      setIsLoading(true);
      setError(null);

      // Snapshot the profiles whose completion we'll log post-submit. Read
      // from dialogState BEFORE we dispatch close (close wipes the data).
      // afterStage + cycleId come from the cached filter-state row — the
      // hook doesn't have them in args, and the page would have to construct
      // them itself otherwise. Reading from cache keeps the contract minimal.
      const profilesAwaitingLog =
        dialogState.kind === 'awaiting_checklist'
          ? (dialogState.checklists as Array<{ checklistProfileId: string }>)
          : [];

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

        // Explicit checklist-completion log — Tier 1 of local-context.ts
        // synthesizeEvents (Day 2 helper). Populated on EVERY submit (online
        // or offline). Idempotent on (cycleId, checklistProfileId, afterStage)
        // so re-firing on retry is safe. Without this the synthesizer falls
        // through to Tier 2 (the legacy pendingChecklist === [] implicit
        // signal), which Day 5 wants to retire.
        try {
          const cs = await getCachedData<{
            currentState?: string | null;
            currentCycle?: { id?: string | null } | null;
          }>(`filter-state-${args.filterId}`);
          const afterStage = cs?.currentState ?? null;
          const cycleId = cs?.currentCycle?.id ?? null;
          if (afterStage) {
            const completedAt = new Date().toISOString();
            for (const p of profilesAwaitingLog) {
              if (!p.checklistProfileId) continue;
              await appendChecklistCompletion(args.filterId, {
                checklistProfileId: p.checklistProfileId,
                afterStage,
                completedAt,
                cycleId,
              });
            }
          }
        } catch {
          /* idempotent log is best-effort — Tier 2 fallback remains for
             legacy cache rows that pre-date this wiring */
        }

        if (!executed) {
          // Offline-parity cache rewrite — clear pendingChecklist and
          // re-derive nextAllowedStages + actions from the tape. Errors
          // here are swallowed (legacy behaviour at
          // mobile-operations.tsx:1397-1415 pre-migration) so a transient
          // IDB failure doesn't trip OFFLINE_CACHE_RECOMPUTE_FAILED.
          try {
            const cs = await getCachedData<any>(`filter-state-${args.filterId}`) ?? {};
            const clearedRow = { ...cs, pendingChecklist: [] };
            await cacheData(`filter-state-${args.filterId}`, clearedRow, OFFLINE_TTL_MS);
            const tape = await getCurrentActions(args.filterId, null);
            const newAllowed = tape
              .filter((a) => a.type === 'ADVANCE_TO_STAGE' || a.type === 'SET_DRYER_DURATION')
              .map((a) => (a as { params: { targetState: string } }).params.targetState);
            await cacheData(
              `filter-state-${args.filterId}`,
              { ...clearedRow, nextAllowedStages: newAllowed, actions: tape },
              OFFLINE_TTL_MS,
            );
          } catch {
            /* see jsdoc — intentionally swallowed to match legacy behaviour */
          }
        }

        const remainingBatch =
          dialogState.kind === 'awaiting_checklist'
            ? (dialogState.remainingBatch ?? [])
            : [];

        if (remainingBatch.length === 0) {
          dispatch({ type: 'close' });
        } else {
          const next = await findNextPendingChecklist(
            remainingBatch,
            resolvePendingChecklistDialog,
          );
          if (next) {
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
        if (isReauthOrRecompute(e)) throw e;
        const err = e as { message?: string };
        setError(err?.message ?? 'Checklist submission failed');
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
    startAndAdvance,
    submitChecklist,
    isLoading,
    error,
    clearError,
  };
}

export type { DialogState, DialogEvent } from './dialog-state';
