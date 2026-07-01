import { prisma } from '../../lib/prisma.js';
import * as executor from '@digilog/shared';

export type AhuCompletionMode = 'NONE' | 'POPUP' | 'INTERLOCK';

export async function getAhuCompletionMode(): Promise<AhuCompletionMode> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'ahu-completion-process' } });
  const m = (cfg?.configValue as { mode?: string } | null)?.mode;
  return m === 'INTERLOCK' || m === 'POPUP' ? m : 'NONE';
}

export type CountedFilter = {
  id: string;
  name: string;
  currentCycleId: string | null;
  currentLifecycleState: string | null;
};

/**
 * Walk the pipeline graph and return the stateKey of the last STAGE node —
 * the one whose only forward-reachable non-CHECKLIST successor is END
 * (hasEndNext === true AND reachableStages.length === 0).
 * Returns null if the profile has no such stage (e.g. empty graph).
 */
export function computeFinalStageKey(profile: { nodes: any[]; edges: any[] }): string | null {
  for (const node of profile.nodes) {
    if (node.nodeType !== 'STAGE' || !node.stateKey) continue;
    const r = executor.findReachable(node.id, profile.nodes, profile.edges);
    if (r.hasEndNext && r.reachableStages.length === 0) return node.stateKey as string;
  }
  return null;
}

/**
 * True when a filter has reached (or passed through) its final cleaning stage:
 *  - Active cycle (currentCycleId != null): filter is currently parked at the
 *    final stage identified in finalStageByFilter for this filter.
 *  - No cycle (currentCycleId == null): lifecycle state is
 *    CLEANING_CYCLE_COMPLETED (cycle auto-completed on the last advance).
 * Everything else — no cycle started, mid-cycle at a non-final stage — is false.
 */
export function reachedFinal(f: CountedFilter, finalStageByFilter: Map<string, string | null>): boolean {
  if (f.currentCycleId != null) {
    const finalKey = finalStageByFilter.get(f.id);
    return !!finalKey && f.currentLifecycleState === finalKey;
  }
  return f.currentLifecycleState === 'CLEANING_CYCLE_COMPLETED';
}
