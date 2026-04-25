/**
 * Pipeline graph helpers — shared by offline validation (offline-store.ts)
 * and route pages so next-stage computation + checklist gating follows the
 * same rules the backend uses in filter-operations.service.ts.
 *
 * A cached filter-state carries `pipelineGraph: { stages, connections, flowMode }`.
 * - stages: [{ id, stateKey, nodeType: 'START'|'STAGE'|'CHECKLIST'|'END', ... }]
 * - connections: [{ fromStageId, toStageId }]
 */

type Stage = {
  id: string;
  stateKey?: string | null;
  nodeType: string;
};
type Connection = { fromStageId: string; toStageId: string };
type Graph = { stages: Stage[]; connections: Connection[] } | null | undefined;

/**
 * Returns the list of reachable STAGE.stateKey values from the current state.
 * CHECKLIST nodes are traversed through (not returned) to mirror the backend's
 * behaviour in filter-operations.service.ts (getNextStageKeys + collectChecklistsAfterStage).
 */
export function computeNextStagesFromGraph(
  graph: Graph,
  currentStateKey: string | null | undefined,
): string[] {
  if (!graph?.stages || !graph?.connections) return [];
  const { stages, connections } = graph;
  const current = currentStateKey
    ? stages.find((s) => s.stateKey === currentStateKey)
    : stages.find((s) => s.nodeType === 'START');
  if (!current) return [];

  const reached: string[] = [];
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const c of connections.filter((c) => c.fromStageId === id)) {
      const next = stages.find((s) => s.id === c.toStageId);
      if (!next) continue;
      if (next.nodeType === 'STAGE' && next.stateKey) {
        reached.push(next.stateKey);
      } else if (next.nodeType === 'CHECKLIST') {
        walk(next.id);
      }
      // END is ignored — caller treats empty reachable + hasEndNext specially
    }
  };
  walk(current.id);
  return reached;
}

/**
 * True iff a CHECKLIST node sits immediately after the current stage.
 * Matches backend's collectChecklistsAfterStage gate in advance().
 */
export function hasChecklistAfter(
  graph: Graph,
  currentStateKey: string | null | undefined,
): boolean {
  if (!graph?.stages || !graph?.connections) return false;
  const { stages, connections } = graph;
  const current = currentStateKey
    ? stages.find((s) => s.stateKey === currentStateKey)
    : stages.find((s) => s.nodeType === 'START');
  if (!current) return false;
  return connections
    .filter((c) => c.fromStageId === current.id)
    .some((c) => stages.find((s) => s.id === c.toStageId)?.nodeType === 'CHECKLIST');
}
