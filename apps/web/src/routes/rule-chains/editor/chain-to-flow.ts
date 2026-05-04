import { MarkerType, type Node, type Edge } from 'reactflow';
import type { RuleChain, NodeType, CustomNodeData } from './types';

// ---------------------------------------------------------------------------
// Helper: map backend data -> React Flow nodes/edges
// ---------------------------------------------------------------------------

export function chainToFlow(
  chain: RuleChain,
  nodeTypesMap: Map<string, NodeType>,
  selectedNodeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = chain.nodes.map((n) => {
    const nt = nodeTypesMap.get(n.type);
    const category = nt?.category ?? 'FLOW';
    return {
      id: n.id,
      type: 'customRuleNode',
      position: { x: n.positionX, y: n.positionY },
      data: {
        label: n.name,
        nodeType: n.type,
        category,
        debugEnabled: n.debugEnabled,
        isFirst: chain.firstRuleNodeId === n.id,
        selected: n.id === selectedNodeId,
      } satisfies CustomNodeData,
    };
  });

  const edges: Edge[] = chain.connections.map((c) => ({
    id: c.id,
    source: c.fromNodeId,
    target: c.toNodeId,
    label: c.label,
    type: 'smoothstep',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' },
    style: { stroke: '#64748b', strokeWidth: 1.5 },
    labelStyle: { fill: '#475569', fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
    labelBgPadding: [4, 6] as [number, number],
    labelBgBorderRadius: 4,
  }));

  return { nodes, edges };
}
