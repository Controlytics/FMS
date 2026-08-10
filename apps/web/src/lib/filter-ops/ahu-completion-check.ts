import { apiClient } from '../api-client';

/**
 * Pre-flight AHU completion check.
 *
 * Calls GET /api/filters/ahu/:ahuId/completion-status?exclude=<filterId>
 * and returns whether the submission should be blocked and the list of
 * sibling filters that have not yet reached their final cleaning stage.
 *
 * Short-circuits (no network call) when:
 *  - mode is 'NONE' (feature disabled)
 *  - ahuId is null / not known (filter is not under an AHU)
 *  - mode is 'INTERLOCK' and the device is offline (D2 best-effort decision:
 *    allow offline replay; server enforces when it reconnects)
 *
 * Failures are non-fatal — callers should catch and proceed with submission.
 */
export interface AhuFilterRow { id: string; name: string; stage: string; done: boolean }

export interface AhuCompletionResult {
  /** INTERLOCK + siblings pending → hard block (don't open the checklist). */
  block: boolean;
  /** POPUP + siblings pending → warn (caller shows Continue/Cancel). */
  warn: boolean;
  ahuName: string;
  /** All filters under the AHU (incl. the one being cleaned), with status. */
  filters: AhuFilterRow[];
  /** Just the not-yet-final siblings (excludes the current filter). */
  pending: { id: string; name: string; stage: string }[];
}

export async function checkAhuCompletion(
  mode: 'NONE' | 'POPUP' | 'INTERLOCK',
  ahuId: string | null,
  filterId: string,
  online: boolean,
): Promise<AhuCompletionResult> {
  const empty: AhuCompletionResult = { block: false, warn: false, ahuName: '', filters: [], pending: [] };
  if (mode === 'NONE' || !ahuId) return empty;
  if (mode === 'INTERLOCK' && !online) return empty;

  const res = await apiClient.get<{
    allAtFinal: boolean;
    ahuName?: string;
    pending: { id: string; name: string; stage: string }[];
    filters?: AhuFilterRow[];
  }>(`/api/filters/ahu/${ahuId}/completion-status?exclude=${filterId}`);

  const pending = res?.pending ?? [];
  return {
    block: mode === 'INTERLOCK' && pending.length > 0,
    warn: mode === 'POPUP' && pending.length > 0,
    ahuName: res?.ahuName ?? '',
    filters: res?.filters ?? [],
    pending,
  };
}

export interface AhuBatchCard {
  ahuId: string;
  ahuName: string;
  allAtFinal: boolean;
  filters: AhuFilterRow[];
}

export interface AhuBatchStatus {
  ahus: AhuBatchCard[];
  /**
   * True when the completion-status call ERRORED (network / server / auth),
   * as opposed to legitimately returning no pending AHUs. The caller must
   * distinguish these: an empty `ahus` from a *failed* check must not be read
   * as "all siblings done" — for INTERLOCK that would silently defeat the gate.
   */
  failed: boolean;
}

/**
 * 2026-07-02: batch variant — one completion-status block per distinct AHU in a
 * submission batch. Powers the multi-AHU carousel.
 *
 * Returns `{ ahus: [], failed: false }` for the legitimate no-check cases
 * (NONE / INTERLOCK-offline). On an actual error it LOGS and returns
 * `failed: true` so the caller can fail-safe rather than silently proceed
 * (2026-07-09 QA fix — previously any error was swallowed to `{ ahus: [] }`,
 * indistinguishable from "no siblings pending"). The server 422
 * (`assertAhuInterlockSatisfied`) remains the backstop for INTERLOCK.
 */
export async function checkAhuCompletionBatch(
  mode: 'NONE' | 'POPUP' | 'INTERLOCK',
  filterIds: string[],
  online: boolean,
  /** Operator's runtime filter-set choice; omitted / 'ALL' = every filter. */
  set?: 'ALL' | 'SET_A' | 'SET_B',
): Promise<AhuBatchStatus> {
  if (mode === 'NONE' || filterIds.length === 0) return { ahus: [], failed: false };
  if (mode === 'INTERLOCK' && !online) return { ahus: [], failed: false };
  try {
    const res = await apiClient.post<{ ahus: AhuBatchCard[] }>(
      '/api/filters/ahu-completion-status/batch',
      { filterIds, ...(set && set !== 'ALL' ? { set } : {}) },
    );
    return { ahus: res?.ahus ?? [], failed: false };
  } catch (e) {
    console.error('[ahu-completion] batch completion-status check failed', e);
    return { ahus: [], failed: true };
  }
}

/**
 * 2026-07-03: does this submission batch span BOTH Set A and Set B filters?
 * Drives whether the A/B/All chooser is shown at all — when an AHU has no A/B
 * split the choice is meaningless, so the caller proceeds as ALL. Non-fatal:
 * returns false on NONE / offline / any error (skip chooser → ALL, the
 * legacy-safe default).
 */
export async function checkAhuHasBothSets(
  mode: 'NONE' | 'POPUP' | 'INTERLOCK',
  filterIds: string[],
  online: boolean,
): Promise<boolean> {
  if (mode === 'NONE' || filterIds.length === 0 || !online) return false;
  try {
    const res = await apiClient.post<{ hasBothSets: boolean }>(
      '/api/filters/ahu-set-availability',
      { filterIds },
    );
    return res?.hasBothSets === true;
  } catch (e) {
    // Fail-safe: `false` skips the A/B chooser → the completion check proceeds
    // as ALL, the STRICTER requirement (every filter must be at final), so a
    // failure here can't loosen the gate. Log it rather than swallow silently.
    console.error('[ahu-completion] set-availability check failed; defaulting to ALL', e);
    return false;
  }
}

/**
 * Is the filter's CURRENT stage the terminal (completing) stage — i.e. would
 * submitting its checklist finish the cycle?
 *
 * The POPUP AHU pre-flight must fire ONLY on the terminal checklist submit, not
 * on every intermediate checklist. A stage is terminal iff its `stageLookup`
 * entry leads to END *and* has no further stages:
 *
 *   - `leadsToEnd === true`   — an END node is reachable from this stage, AND
 *   - `nextStages.length === 0` — no further STAGE node follows.
 *
 * Both conditions are required: a branching stage can reach END yet still have
 * another stage on a different branch, so `leadsToEnd` alone is insufficient.
 *
 * `currentState` is the filter's current lifecycle stateKey; `stageLookup` is
 * the server-computed per-stage table (see current-state.ts `buildStageLookup`
 * / the inline builder). Both come from the cached `filter-state-{id}` row.
 * Returns false when either is missing (conservative — no popup without data).
 */
export function isTerminalChecklist(
  currentState: string | null | undefined,
  stageLookup:
    | Record<string, { nextStages?: string[]; leadsToEnd?: boolean }>
    | null
    | undefined,
): boolean {
  if (!currentState || !stageLookup) return false;
  const entry = stageLookup[currentState];
  if (!entry) return false;
  return entry.leadsToEnd === true && (entry.nextStages?.length ?? 0) === 0;
}

/**
 * 2026-08-10: would advancing INTO `targetState` complete the cycle *without*
 * opening a checklist first?
 *
 * The AHU completion pre-flight was originally wired only to the terminal
 * CHECKLIST open (`isTerminalChecklist` above), on the assumption that every
 * pipeline ends `… → FINAL STAGE → CHECKLIST → END`. Pipelines that end
 * `… → FINAL STAGE → END` auto-complete inside `advance()` with no checklist,
 * so the gate was never reached and POPUP/INTERLOCK silently did nothing —
 * the reported "no popup at Storage Out". This predicate covers that path.
 *
 * It is the exact COMPLEMENT of `isTerminalChecklist` for the same stage:
 *   - both require `leadsToEnd && nextStages.length === 0` (the stage completes
 *     the cycle), and
 *   - this one additionally requires NO pending checklist after the stage,
 *     which is precisely the case `isTerminalChecklist` handles.
 * So for any given stage at most one of the two fires — a pipeline that ends
 * with a checklist keeps warning once, at checklist-open, exactly as before.
 *
 * Note the asymmetry in argument: `isTerminalChecklist` tests the filter's
 * CURRENT state (the checklist is already open for it), whereas this tests the
 * stage being advanced INTO, because the warning has to appear before the
 * advance that completes the cycle — after it there is nothing left to cancel.
 *
 * Known residual gap (unchanged by this fix): `pendingChecklistProfileIds` is
 * built from the CHECKLIST node's `checklistProfileId` without checking that
 * the referenced profile is still `isActive`. A pipeline pointing at a
 * deactivated checklist auto-completes on advance, yet reads here as "has a
 * checklist" so neither path warns. Every checklist profile in this deployment
 * is active; fixing it properly means the server marking the node non-gating in
 * `buildStageLookup` (see `findProfilesWithoutFinalChecklist`, which already
 * applies the `isActive` predicate).
 */
export function isCompletingAdvance(
  targetState: string | null | undefined,
  stageLookup:
    | Record<string, { nextStages?: string[]; leadsToEnd?: boolean; pendingChecklistProfileIds?: string[] }>
    | null
    | undefined,
): boolean {
  if (!targetState || !stageLookup) return false;
  const entry = stageLookup[targetState];
  if (!entry) return false;
  return (
    entry.leadsToEnd === true &&
    (entry.nextStages?.length ?? 0) === 0 &&
    (entry.pendingChecklistProfileIds?.length ?? 0) === 0
  );
}

/**
 * 2026-08-10: the DIALOG-FIRST counterpart of `isCompletingAdvance`.
 *
 * Would advancing INTO `targetState` complete the cycle *via* a mandatory
 * checklist that opens BEFORE anything is written?
 *
 * Why this exists — the regression it repairs:
 * `isTerminalChecklist` tests the filter's CURRENT state and was the only hook
 * the AHU pre-flight had for checklist-ending pipelines. That was correct while
 * the checklist dialog opened AFTER the advance committed: by then
 * `currentState` WAS the terminal stage. The dialog-first refactor (2026-07-16,
 * commits f8df2f4 / f6576bc / 81ad66b) inverted that order — the advance is
 * parked and the dialog opens first — so at gate time the filter is still at the
 * PREVIOUS stage (e.g. `STORAGE_IN`, whose entry has `leadsToEnd: false` and a
 * non-empty `nextStages`). `isTerminalChecklist` therefore returned false and
 * the POPUP/INTERLOCK pre-flight silently stopped firing at Storage Out on every
 * pipeline that ends `… → FINAL STAGE → CHECKLIST → END`.
 *
 * The three predicates partition the space, so at most ONE fires per submit:
 *   - `isTerminalChecklist(current)`   — filter is ALREADY parked at the terminal
 *     stage with its checklist pending (no advance in flight).
 *   - `isCompletingAdvance(target)`    — final target, NO checklist after it.
 *   - this one (`target`)              — final target, checklist after it.
 * The last two are exact complements on `pendingChecklistProfileIds`, which is
 * what keeps a Require-profile batch from popping the dialog twice in one submit.
 *
 * Carries the same residual gap as `isCompletingAdvance`: a CHECKLIST node
 * pointing at a DEACTIVATED profile still counts as "has a checklist" here while
 * `advance()` auto-completes past it, so such a pipeline reads as this case but
 * behaves as the other. Every checklist profile in this deployment is active.
 */
export function isTerminalTargetWithChecklist(
  targetState: string | null | undefined,
  stageLookup:
    | Record<string, { nextStages?: string[]; leadsToEnd?: boolean; pendingChecklistProfileIds?: string[] }>
    | null
    | undefined,
): boolean {
  if (!targetState || !stageLookup) return false;
  const entry = stageLookup[targetState];
  if (!entry) return false;
  return (
    entry.leadsToEnd === true &&
    (entry.nextStages?.length ?? 0) === 0 &&
    (entry.pendingChecklistProfileIds?.length ?? 0) > 0
  );
}
