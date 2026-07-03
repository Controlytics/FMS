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

/**
 * 2026-07-02: batch variant — one completion-status block per distinct AHU in a
 * submission batch. Powers the multi-AHU carousel. Non-fatal: returns no AHUs on
 * NONE / INTERLOCK-offline / any error (the server 422 still guards INTERLOCK on
 * submit).
 */
export async function checkAhuCompletionBatch(
  mode: 'NONE' | 'POPUP' | 'INTERLOCK',
  filterIds: string[],
  online: boolean,
  /** Operator's runtime filter-set choice; omitted / 'ALL' = every filter. */
  set?: 'ALL' | 'SET_A' | 'SET_B',
): Promise<{ ahus: AhuBatchCard[] }> {
  if (mode === 'NONE' || filterIds.length === 0) return { ahus: [] };
  if (mode === 'INTERLOCK' && !online) return { ahus: [] };
  try {
    const res = await apiClient.post<{ ahus: AhuBatchCard[] }>(
      '/api/filters/ahu-completion-status/batch',
      { filterIds, ...(set && set !== 'ALL' ? { set } : {}) },
    );
    return { ahus: res?.ahus ?? [] };
  } catch {
    return { ahus: [] };
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
  } catch {
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
