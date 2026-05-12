import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { apiClient, api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { useReauth } from '@/hooks/use-reauth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReauthDialog } from '@/components/reauth-dialog';
import { cn } from '@/lib/cn';

import type {
  RuleChain,
  RuleNode,
  RuleNodeConnection,
  NodeType,
  DebugEvent,
  CustomNodeData,
} from './editor/types';
import { getCategoryColor, DEFAULT_POSITION } from './editor/constants';
import { chainToFlow } from './editor/chain-to-flow';
import { CustomRuleNode } from './editor/components/CustomRuleNode';
import { PaletteNode } from './editor/components/PaletteNode';
import { NodeConfigPanel } from './editor/components/NodeConfigPanel';
import { AddNodeDialog } from './editor/dialogs/AddNodeDialog';
import { AddConnectionDialog } from './editor/dialogs/AddConnectionDialog';

// ---------------------------------------------------------------------------
// Main editor page
// ---------------------------------------------------------------------------

const NODE_TYPES: NodeTypes = { customRuleNode: CustomRuleNode };

export function RuleChainEditorPage() {
  const { id: chainId } = useParams<{ id: string }>();
  const { toast } = useToast();
  // NodeConfigPanel calls useDatetimeFormat itself; SWR de-dupes the
  // /api/config/datetime/current request. We keep this call here so the
  // editor page warm-starts the cache before the panel mounts and so the
  // hook's revalidation cycle is anchored to the page lifetime even when
  // no node is selected. formatTime is intentionally unused at this level.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { formatTime: _formatTime } = useDatetimeFormat();
  const reauth = useReauth();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const {
    data: chain,
    isLoading: chainLoading,
    mutate: mutateChain,
  } = useSWR<RuleChain>(chainId ? `/api/rule-chains/${chainId}` : null);

  const { data: nodeTypesRaw, isLoading: nodeTypesLoading } = useSWR<NodeType[]>(
    '/api/rule-chains/node-types',
  );

  const {
    data: debugEventsRaw,
    isLoading: debugLoading,
    mutate: mutateDebug,
  } = useSWR<DebugEvent[]>(chainId ? `/api/rule-chains/${chainId}/debug` : null, {
    refreshInterval: 3000,
  });

  const nodeTypes = nodeTypesRaw ?? [];
  const debugEvents = debugEventsRaw ?? [];

  // Map for fast lookup
  const nodeTypesMap = useMemo(() => {
    const map = new Map<string, NodeType>();
    nodeTypes.forEach((nt) => map.set(nt.type, nt));
    return map;
  }, [nodeTypes]);

  // Group node types by category for the palette
  const nodeTypesByCategory = useMemo(() => {
    const groups: Record<string, NodeType[]> = {};
    nodeTypes.forEach((nt) => {
      if (!groups[nt.category]) groups[nt.category] = [];
      groups[nt.category].push(nt);
    });
    return groups;
  }, [nodeTypes]);

  // ---------------------------------------------------------------------------
  // React Flow state
  // ---------------------------------------------------------------------------

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Selected node / edge id (from flow canvas)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Sync chain data -> React Flow
  useEffect(() => {
    if (chain && !chainLoading) {
      const { nodes, edges } = chainToFlow(chain, nodeTypesMap, selectedNodeId);
      setRfNodes(nodes);
      setRfEdges(edges);
    }
  }, [chain, nodeTypesMap]);

  // Update selected indicator without full re-render
  useEffect(() => {
    setRfNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, selected: n.id === selectedNodeId },
      })),
    );
  }, [selectedNodeId]);

  // Highlight selected edge
  useEffect(() => {
    setRfEdges((eds) =>
      eds.map((e) => ({
        ...e,
        style: e.id === selectedEdgeId
          ? { stroke: '#ef4444', strokeWidth: 2.5 }
          : { stroke: '#64748b', strokeWidth: 1.5 },
        animated: e.id === selectedEdgeId,
      })),
    );
  }, [selectedEdgeId]);

  // ---------------------------------------------------------------------------
  // Local chain metadata state (name, active)
  // ---------------------------------------------------------------------------

  const [localName, setLocalName] = useState('');
  const [localActive, setLocalActive] = useState(false);
  const [firstNodeId, setFirstNodeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    if (chain) {
      setLocalName(chain.name);
      setLocalActive(chain.isActive);
      setFirstNodeId(chain.firstRuleNodeId ?? null);
    }
  }, [chain]);

  // ---------------------------------------------------------------------------
  // Palette sidebar collapse
  // ---------------------------------------------------------------------------

  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  // ---------------------------------------------------------------------------
  // Drop handling (drag from palette onto canvas)
  // ---------------------------------------------------------------------------

  const [pendingDrop, setPendingDrop] = useState<{
    position: { x: number; y: number };
    nodeType: string;
  } | null>(null);

  const onDragStart = useCallback((event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType.type);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!reactFlowWrapper.current || !reactFlowInstance) return;

      const nodeTypeStr = event.dataTransfer.getData('application/reactflow');
      if (!nodeTypeStr) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      setPendingDrop({ position, nodeType: nodeTypeStr });
      setShowAddNodeDialog(true);
    },
    [reactFlowInstance],
  );

  // ---------------------------------------------------------------------------
  // Add node dialog
  // ---------------------------------------------------------------------------

  const [showAddNodeDialog, setShowAddNodeDialog] = useState(false);
  const [dropPosition, setDropPosition] = useState(DEFAULT_POSITION);

  useEffect(() => {
    if (pendingDrop) {
      setDropPosition(pendingDrop.position);
    }
  }, [pendingDrop]);

  const handleNodeAdded = useCallback(
    (newNode: RuleNode) => {
      const nt = nodeTypesMap.get(newNode.type);
      const category = nt?.category ?? 'FLOW';
      const rfNode: Node = {
        id: newNode.id,
        type: 'customRuleNode',
        position: { x: newNode.positionX, y: newNode.positionY },
        data: {
          label: newNode.name,
          nodeType: newNode.type,
          category,
          debugEnabled: newNode.debugEnabled,
          isFirst: false,
          selected: false,
        } satisfies CustomNodeData,
      };
      setRfNodes((nds) => [...nds, rfNode]);
      setPendingDrop(null);
      // Also refresh chain to get updated node list
      mutateChain();
    },
    [nodeTypesMap, mutateChain],
  );

  // ---------------------------------------------------------------------------
  // Connection dialog
  // ---------------------------------------------------------------------------

  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);

  const onConnect = useCallback((connection: Connection) => {
    setPendingConnection(connection);
    setShowConnectionDialog(true);
  }, []);

  const handleConnectionAdded = useCallback(
    (conn: RuleNodeConnection) => {
      const edge: Edge = {
        id: conn.id,
        source: conn.fromNodeId,
        target: conn.toNodeId,
        label: conn.label,
        type: 'smoothstep',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' },
        style: { stroke: '#64748b', strokeWidth: 1.5 },
        labelStyle: { fill: '#475569', fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
        labelBgPadding: [4, 6] as [number, number],
        labelBgBorderRadius: 4,
      };
      setRfEdges((eds) => addEdge(edge, eds));
      setPendingConnection(null);
      mutateChain();
    },
    [mutateChain],
  );

  // ---------------------------------------------------------------------------
  // Node selection
  // ---------------------------------------------------------------------------

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);

  const handleDeleteSelectedEdge = useCallback(async () => {
    if (!selectedEdgeId || !chainId) return;
    try {
      await apiClient.delete(`/api/rule-chains/${chainId}/connections/${selectedEdgeId}`);
      toast.info('Connection Removed', 'Edge has been deleted.');
      setSelectedEdgeId(null);
      mutateChain();
    } catch (err: any) {
      toast.error('Delete Failed', err?.message || 'Failed to delete connection.');
    }
  }, [selectedEdgeId, chainId, mutateChain, toast]);

  // ---------------------------------------------------------------------------
  // Node position save (after drag)
  // ---------------------------------------------------------------------------

  const onNodeDragStop = useCallback(
    async (_event: React.MouseEvent, node: Node) => {
      if (!chainId) return;
      // Find current backend node data
      const backendNode = chain?.nodes.find((n) => n.id === node.id);
      if (!backendNode) return;

      try {
        await apiClient.put(`/api/rule-chains/${chainId}/nodes/${node.id}`, {
          name: backendNode.name,
          configuration: backendNode.configuration,
          debugEnabled: backendNode.debugEnabled,
          positionX: Math.round(node.position.x),
          positionY: Math.round(node.position.y),
        });
      } catch {
        // Silently ignore position save failures
      }
    },
    [chainId, chain],
  );

  // ---------------------------------------------------------------------------
  // Edge deletion
  // ---------------------------------------------------------------------------

  const onEdgesDelete = useCallback(
    async (deletedEdges: Edge[]) => {
      for (const edge of deletedEdges) {
        try {
          await apiClient.delete(`/api/rule-chains/${chainId}/connections/${edge.id}`);
          toast.info('Connection Removed', 'Edge has been deleted.');
        } catch (err: any) {
          toast.error('Delete Failed', err?.message || 'Failed to delete connection.');
        }
      }
      mutateChain();
    },
    [chainId, mutateChain, toast],
  );

  // ---------------------------------------------------------------------------
  // Node config panel — selected node data
  // ---------------------------------------------------------------------------

  const selectedNode = useMemo(
    () => chain?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [chain, selectedNodeId],
  );

  const selectedNodeTypeDef = useMemo(
    () => (selectedNode ? (nodeTypesMap.get(selectedNode.type) ?? null) : null),
    [selectedNode, nodeTypesMap],
  );

  const handleNodeUpdated = useCallback(
    (updated: RuleNode) => {
      // Update local React Flow node
      setRfNodes((nds) =>
        nds.map((n) => {
          if (n.id !== updated.id) return n;
          const nt = nodeTypesMap.get(updated.type);
          const category = nt?.category ?? 'FLOW';
          return {
            ...n,
            data: {
              ...n.data,
              label: updated.name,
              category,
              debugEnabled: updated.debugEnabled,
            },
          };
        }),
      );
      mutateChain();
    },
    [nodeTypesMap, mutateChain],
  );

  const handleNodeDeleted = useCallback(
    (nodeId: string) => {
      setRfNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setRfEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      mutateChain();
    },
    [mutateChain],
  );

  const handleSetFirst = useCallback(
    async (nodeId: string) => {
      if (!chainId) return;
      try {
        await apiClient.put(`/api/rule-chains/${chainId}`, {
          name: localName,
          firstRuleNodeId: nodeId,
        });
        setFirstNodeId(nodeId);
        setRfNodes((nds) =>
          nds.map((n) => ({
            ...n,
            data: { ...n.data, isFirst: n.id === nodeId },
          })),
        );
        toast.success('First Node Set', 'Entry point updated.');
      } catch (err: any) {
        toast.error('Failed', err?.message || 'Could not update first node.');
      }
    },
    [chainId, localName, toast],
  );

  // ---------------------------------------------------------------------------
  // Save chain (full snapshot)
  // ---------------------------------------------------------------------------

  const [saving, setSaving] = useState(false);

  const doSave = useCallback(
    async (password?: string) => {
      if (!chainId || !chain) return;
      setSaving(true);

      // Build position lookup from current React Flow state
      const posMap = new Map(rfNodes.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));

      // Build full nodes array: backend data + updated positions from canvas
      const nodes = chain.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        configuration: n.configuration,
        positionX: posMap.get(n.id)?.x ?? n.positionX,
        positionY: posMap.get(n.id)?.y ?? n.positionY,
      }));

      // Build connections from backend state
      const connections = chain.connections.map((c) => ({
        fromNodeId: c.fromNodeId,
        toNodeId: c.toNodeId,
        label: c.label,
      }));

      const payload = {
        nodes,
        connections,
        firstRuleNodeId: firstNodeId,
      };

      try {
        const result = await (password
          ? apiClient.postWithReauth<{ version: number }>(`/api/rule-chains/${chainId}/save`, payload, password)
          : apiClient.post<{ version: number }>(`/api/rule-chains/${chainId}/save`, payload));

        toast.success('Chain Saved', `Saved as version ${result.version ?? '—'}.`);
        mutateChain();
      } finally {
        setSaving(false);
      }
    },
    // doSave body reads chainId/chain/firstNodeId/rfNodes/mutateChain/toast
    // only; localName + localActive are intentionally omitted to avoid
    // identity churn (and re-running handleSave's deps) on every keystroke
    // in the name field or active toggle.
    [chainId, chain, firstNodeId, rfNodes, mutateChain, toast],
  );

  const handleSave = useCallback(async () => {
    await reauth.execute('UPDATE_RULE_CHAIN', doSave, {
      onError: (err: any) => {
        toast.error('Save Failed', err?.message || 'Failed to save rule chain.');
      },
    });
  }, [reauth, doSave, toast]);

  // ---------------------------------------------------------------------------
  // Toggle active
  // ---------------------------------------------------------------------------

  // Audit 2026-05-04 fix (web-routes review C5): toggle-active and name-save
  // were PUT-ing /api/rule-chains/:id without reauth, while handleSave above
  // already wraps the same endpoint in reauth.execute('UPDATE_RULE_CHAIN').
  // Mirror the wrap so all three paths are equally challenged.
  const handleToggleActive = useCallback(async () => {
    if (!chainId) return;
    const newActive = !localActive;
    await reauth.execute(
      'UPDATE_RULE_CHAIN',
      async (password?: string) => {
        const body = { name: localName, isActive: newActive };
        if (password) await api.putWithReauth(`/api/rule-chains/${chainId}`, body, password);
        else await apiClient.put(`/api/rule-chains/${chainId}`, body);
      },
      {
        onSuccess: () => {
          setLocalActive(newActive);
          toast.success(
            newActive ? 'Chain Activated' : 'Chain Deactivated',
            `Rule chain is now ${newActive ? 'active' : 'inactive'}.`,
          );
          mutateChain();
        },
        onError: (err: any) => toast.error('Toggle Failed', err?.message || 'Failed to update status.'),
      },
    );
  }, [chainId, localActive, localName, mutateChain, toast, reauth]);

  // ---------------------------------------------------------------------------
  // Name edit save
  // ---------------------------------------------------------------------------

  const handleNameSave = useCallback(async () => {
    if (!chainId || !localName.trim()) return;
    await reauth.execute(
      'UPDATE_RULE_CHAIN',
      async (password?: string) => {
        const body = { name: localName.trim() };
        if (password) await api.putWithReauth(`/api/rule-chains/${chainId}`, body, password);
        else await apiClient.put(`/api/rule-chains/${chainId}`, body);
      },
      {
        onSuccess: () => {
          setEditingName(false);
          mutateChain();
          toast.success('Name Updated', 'Rule chain name has been saved.');
        },
        onError: (err: any) => toast.error('Failed', err?.message || 'Could not update name.'),
      },
    );
  }, [chainId, localName, mutateChain, toast, reauth]);

  // ---------------------------------------------------------------------------
  // Clear debug events
  // ---------------------------------------------------------------------------

  const handleClearDebug = useCallback(async () => {
    if (!chainId) return;
    try {
      await apiClient.delete(`/api/rule-chains/${chainId}/debug`);
      mutateDebug([]);
      toast.info('Debug Cleared', 'All debug events have been removed.');
    } catch (err: any) {
      toast.error('Failed', err?.message || 'Could not clear debug events.');
    }
  }, [chainId, mutateDebug, toast]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (chainLoading || nodeTypesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <svg className="w-8 h-8 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-500">Loading rule chain editor...</p>
        </div>
      </div>
    );
  }

  if (!chain) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <div className="p-4 rounded-2xl bg-red-50 inline-block">
            <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-slate-700 font-semibold">Rule chain not found</p>
          <Link to="/rule-chains" className="text-sm text-blue-600 hover:underline">
            Back to Rule Chains
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full animate-fade-in" style={{ height: 'calc(100vh - 112px)' }}>
      {/* ===== HEADER BAR ===== */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200/60 shadow-sm">
        {/* Left: breadcrumb + name */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Icon */}
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-md shadow-cyan-500/20 flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <Link
              to="/rule-chains"
              className="text-slate-500 hover:text-slate-700 font-medium transition-colors flex-shrink-0"
            >
              Rule Chains
            </Link>
            <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>

            {/* Editable name */}
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  onBlur={handleNameSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleNameSave();
                    if (e.key === 'Escape') {
                      setLocalName(chain.name);
                      setEditingName(false);
                    }
                  }}
                  autoFocus
                  className="font-semibold text-slate-800 bg-slate-50 border-b-2 border-blue-500 outline-none px-1 min-w-[120px] max-w-[240px]"
                />
                <button
                  onClick={handleNameSave}
                  className="text-emerald-600 hover:text-emerald-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  onClick={() => { setLocalName(chain.name); setEditingName(false); }}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="font-semibold text-slate-800 hover:text-blue-600 transition-colors flex items-center gap-1.5 group truncate max-w-[200px]"
                title="Click to edit name"
              >
                <span className="truncate">{localName}</span>
                <svg className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge variant="default" className="text-[10px] font-bold">v{chain.currentVersion}</Badge>
            {chain.isRoot && <Badge variant="warning" className="text-[10px]">Root</Badge>}
            {chain.isSystem && <Badge variant="secondary" className="text-[10px]">System</Badge>}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Debug events indicator */}
          {debugEvents.length > 0 && (
            <button
              onClick={handleClearDebug}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold hover:bg-orange-100 transition-colors"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              {debugEvents.length} debug event{debugEvents.length !== 1 ? 's' : ''}
              <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          {/* Active toggle */}
          <button
            onClick={handleToggleActive}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-200',
              localActive
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100',
            )}
          >
            <div className={cn('w-1.5 h-1.5 rounded-full', localActive ? 'bg-emerald-500' : 'bg-slate-400')} />
            {localActive ? 'Active' : 'Inactive'}
          </button>

          {/* Add node button */}
          <Button
            onClick={() => {
              setDropPosition(DEFAULT_POSITION);
              setPendingDrop(null);
              setShowAddNodeDialog(true);
            }}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Node
          </Button>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={saving}
            size="sm"
            className="gap-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/20"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                Save Chain
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ===== MAIN AREA ===== */}
      <div className="flex flex-1 overflow-hidden">

        {/* ===== LEFT: NODE PALETTE ===== */}
        <div
          className={cn(
            'flex-shrink-0 bg-white border-r border-slate-200/60 flex flex-col transition-all duration-200 overflow-hidden',
            paletteCollapsed ? 'w-10' : 'w-60',
          )}
        >
          {/* Palette header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100 flex-shrink-0">
            {!paletteCollapsed && (
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Node Palette</span>
            )}
            <button
              onClick={() => setPaletteCollapsed(!paletteCollapsed)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-auto"
              title={paletteCollapsed ? 'Expand palette' : 'Collapse palette'}
            >
              <svg
                className={cn('w-4 h-4 transition-transform', paletteCollapsed ? 'rotate-180' : '')}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Palette node list */}
          {!paletteCollapsed && (
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {Object.entries(nodeTypesByCategory).map(([category, types]) => {
                const colors = getCategoryColor(category);
                return (
                  <div key={category}>
                    <div className="flex items-center gap-1.5 mb-1.5 px-1">
                      <div className={cn('w-2 h-2 rounded-full flex-shrink-0', colors.dot)} />
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{category}</span>
                    </div>
                    <div className="space-y-1">
                      {types.map((nt) => (
                        <PaletteNode key={nt.type} nodeType={nt} onDragStart={onDragStart} />
                      ))}
                    </div>
                  </div>
                );
              })}

              {nodeTypes.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-xs text-slate-400">No node types available</p>
                </div>
              )}
            </div>
          )}

          {/* Collapsed: show dot indicators per category */}
          {paletteCollapsed && (
            <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1.5">
              {Object.entries(nodeTypesByCategory).map(([category]) => {
                const colors = getCategoryColor(category);
                return (
                  <div
                    key={category}
                    title={category}
                    className={cn('w-4 h-4 rounded-full', colors.dot)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ===== CENTER: CANVAS ===== */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onEdgeClick={onEdgeClick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeDragStop={onNodeDragStop}
            onEdgesDelete={onEdgesDelete}
            onInit={setReactFlowInstance}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            selectionKeyCode="Shift"
            className="bg-slate-50"
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#64748b' },
              style: { stroke: '#64748b', strokeWidth: 1.5 },
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="#cbd5e1"
            />
            <Controls className="shadow-lg rounded-xl overflow-hidden" />
            <MiniMap
              nodeColor={(n) => {
                const cat = n.data?.category as string | undefined;
                const colMap: Record<string, string> = {
                  INPUT: '#2563eb',
                  FILTER: '#f59e0b',
                  ENRICHMENT: '#059669',
                  TRANSFORM: '#7c3aed',
                  ACTION: '#dc2626',
                  EXTERNAL: '#0891b2',
                  FLOW: '#475569',
                };
                return colMap[cat ?? ''] ?? '#94a3b8';
              }}
              maskColor="rgba(248, 250, 252, 0.7)"
              className="!rounded-xl shadow-lg overflow-hidden border border-slate-200"
            />

            {/* Floating edge delete button */}
            {selectedEdgeId && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 10,
                }}
              >
                <button
                  onClick={handleDeleteSelectedEdge}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium shadow-lg hover:bg-red-600 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Connection
                </button>
              </div>
            )}

            {/* Empty state panel */}
            {rfNodes.length === 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                  textAlign: 'center',
                }}
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="p-5 rounded-2xl bg-white border-2 border-dashed border-slate-300">
                    <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-500">Empty Canvas</p>
                    <p className="text-xs text-slate-400 mt-0.5">Drag nodes from the left palette or click Add Node</p>
                  </div>
                </div>
              </div>
            )}
          </ReactFlow>
        </div>

        {/* ===== RIGHT: NODE CONFIG PANEL ===== */}
        <div className="flex-shrink-0 w-72 bg-white border-l border-slate-200/60 flex flex-col overflow-hidden">
          <NodeConfigPanel
            node={selectedNode}
            nodeTypeDef={selectedNodeTypeDef}
            chainId={chainId!}
            onClose={() => setSelectedNodeId(null)}
            onNodeUpdated={handleNodeUpdated}
            onNodeDeleted={handleNodeDeleted}
            isFirst={selectedNodeId !== null && selectedNodeId === firstNodeId}
            onSetFirst={handleSetFirst}
            debugEvents={debugEvents}
            debugLoading={debugLoading}
          />
        </div>
      </div>

      {/* ===== DIALOGS ===== */}

      {/* Add node dialog */}
      <AddNodeDialog
        open={showAddNodeDialog}
        onClose={() => { setShowAddNodeDialog(false); setPendingDrop(null); }}
        chainId={chainId!}
        nodeTypes={nodeTypes}
        dropPosition={dropPosition}
        prefillType={pendingDrop?.nodeType}
        onNodeAdded={handleNodeAdded}
      />

      {/* Connection label dialog */}
      <AddConnectionDialog
        open={showConnectionDialog}
        onClose={() => { setShowConnectionDialog(false); setPendingConnection(null); }}
        chainId={chainId!}
        connection={pendingConnection}
        nodeTypesMap={nodeTypesMap}
        nodes={rfNodes}
        onConnectionAdded={handleConnectionAdded}
      />

      {/* Re-auth dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Save Rule Chain"
      />
    </div>
  );
}
