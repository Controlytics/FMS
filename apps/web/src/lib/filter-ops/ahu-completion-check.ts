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
