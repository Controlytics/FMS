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
export async function checkAhuCompletion(
  mode: 'NONE' | 'POPUP' | 'INTERLOCK',
  ahuId: string | null,
  filterId: string,
  online: boolean,
): Promise<{ block: boolean; pending: { id: string; name: string; stage: string }[] }> {
  if (mode === 'NONE' || !ahuId) return { block: false, pending: [] };
  if (mode === 'INTERLOCK' && !online) return { block: false, pending: [] };

  const res = await apiClient.get<{
    allAtFinal: boolean;
    pending: { id: string; name: string; stage: string }[];
  }>(`/api/filters/ahu/${ahuId}/completion-status?exclude=${filterId}`);

  const pending = res?.pending ?? [];
  // INTERLOCK: hard block when siblings are pending.
  // POPUP: warn only (block=false → caller shows Continue/Cancel).
  return { block: mode === 'INTERLOCK' && pending.length > 0, pending };
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
