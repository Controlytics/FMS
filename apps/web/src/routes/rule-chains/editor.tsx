import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
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
import Editor from '@monaco-editor/react';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReauthDialog } from '@/components/reauth-dialog';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RuleChain {
  id: string;
  name: string;
  description?: string;
  isRoot: boolean;
  isSystem: boolean;
  firstRuleNodeId?: string;
  currentVersion: number;
  isActive: boolean;
  nodes: RuleNode[];
  connections: RuleNodeConnection[];
}

interface RuleNode {
  id: string;
  ruleChainId: string;
  type: string;
  name: string;
  configuration: Record<string, any>;
  debugEnabled: boolean;
  positionX: number;
  positionY: number;
}

interface RuleNodeConnection {
  id: string;
  ruleChainId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
}

interface NodeType {
  type: string;
  name: string;
  category: string;
  description: string;
  configSchema?: Record<string, any>;
  outputs: string[];
}

interface DebugEvent {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  inputMsg: any;
  outputMsg: any;
  output: string;
  durationMs: number;
  timestamp: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Category colours
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; dot: string; light: string }> = {
  INPUT:       { bg: 'bg-blue-600',   border: 'border-blue-400',   text: 'text-blue-100',   dot: 'bg-blue-400',   light: 'bg-blue-50 border-blue-200' },
  FILTER:      { bg: 'bg-amber-500',  border: 'border-amber-400',  text: 'text-amber-100',  dot: 'bg-amber-400',  light: 'bg-amber-50 border-amber-200' },
  ENRICHMENT:  { bg: 'bg-emerald-600',border: 'border-emerald-400',text: 'text-emerald-100',dot: 'bg-emerald-400',light: 'bg-emerald-50 border-emerald-200' },
  TRANSFORM:   { bg: 'bg-purple-600', border: 'border-purple-400', text: 'text-purple-100', dot: 'bg-purple-400', light: 'bg-purple-50 border-purple-200' },
  ACTION:      { bg: 'bg-red-600',    border: 'border-red-400',    text: 'text-red-100',    dot: 'bg-red-400',    light: 'bg-red-50 border-red-200' },
  EXTERNAL:    { bg: 'bg-cyan-600',   border: 'border-cyan-400',   text: 'text-cyan-100',   dot: 'bg-cyan-400',   light: 'bg-cyan-50 border-cyan-200' },
  FLOW:        { bg: 'bg-slate-600',  border: 'border-slate-400',  text: 'text-slate-100',  dot: 'bg-slate-400',  light: 'bg-slate-50 border-slate-200' },
};

const getCategoryColor = (category: string) =>
  CATEGORY_COLORS[category] ?? CATEGORY_COLORS['FLOW'];

// ---------------------------------------------------------------------------
// Category icons (SVG paths)
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, string> = {
  INPUT:      'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  FILTER:     'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
  ENRICHMENT: 'M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z',
  TRANSFORM:  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  ACTION:     'M13 10V3L4 14h7v7l9-11h-7z',
  EXTERNAL:   'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
  FLOW:       'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
};

const getCategoryIcon = (category: string) =>
  CATEGORY_ICONS[category] ?? CATEGORY_ICONS['FLOW'];

// ---------------------------------------------------------------------------
// Script node types (show Monaco editor)
// ---------------------------------------------------------------------------

const SCRIPT_NODE_TYPES = new Set([
  'script-filter',
  'script-transform',
  'script-enrichment',
  'js-filter',
  'js-transform',
  'custom-script',
]);

// ---------------------------------------------------------------------------
// Custom React Flow node component
// ---------------------------------------------------------------------------

interface CustomNodeData {
  label: string;
  nodeType: string;
  category: string;
  debugEnabled: boolean;
  isFirst: boolean;
  selected: boolean;
}

function CustomRuleNode({ data }: { data: CustomNodeData }) {
  const colors = getCategoryColor(data.category);
  const iconPath = getCategoryIcon(data.category);

  return (
    <div
      className={cn(
        'rounded-xl border-2 shadow-lg min-w-[160px] max-w-[220px] overflow-hidden transition-all duration-150',
        data.selected
          ? `${colors.border} shadow-xl ring-2 ring-offset-1`
          : 'border-slate-200',
        data.debugEnabled && 'ring-2 ring-orange-400 ring-offset-1',
      )}
      style={{ background: 'white' }}
    >
      {/* Header */}
      <div className={cn('flex items-center gap-2 px-3 py-2', colors.bg)}>
        <svg
          className={cn('w-3.5 h-3.5 flex-shrink-0', colors.text)}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
        </svg>
        <span className={cn('text-xs font-semibold truncate flex-1', colors.text)}>
          {data.category}
        </span>
        {data.isFirst && (
          <span className="text-[9px] font-bold bg-white/30 text-white rounded px-1 py-0.5 flex-shrink-0">
            FIRST
          </span>
        )}
        {data.debugEnabled && (
          <div className="w-2 h-2 rounded-full bg-orange-300 animate-pulse flex-shrink-0" title="Debug active" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs font-semibold text-slate-800 truncate">{data.label}</p>
        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{data.nodeType}</p>
      </div>

      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:!bg-blue-500 !-left-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:!bg-green-500 !-right-1.5"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: map backend data -> React Flow nodes/edges
// ---------------------------------------------------------------------------

function chainToFlow(
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
      // Store backend data so we can retrieve it
      // @ts-ignore — ReactFlow allows arbitrary extras on Node
      _backendData: n,
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

// ---------------------------------------------------------------------------
// Node palette item (draggable)
// ---------------------------------------------------------------------------

function PaletteNode({
  nodeType,
  onDragStart,
}: {
  nodeType: NodeType;
  onDragStart: (event: React.DragEvent, nodeType: NodeType) => void;
}) {
  const colors = getCategoryColor(nodeType.category);
  const iconPath = getCategoryIcon(nodeType.category);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, nodeType)}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing',
        'hover:shadow-md transition-all duration-150 select-none group',
        colors.light,
      )}
      title={nodeType.description}
    >
      <div className={cn('p-1 rounded flex-shrink-0', colors.bg)}>
        <svg className={cn('w-3 h-3', colors.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-700 truncate">{nodeType.name}</p>
        <p className="text-[10px] text-slate-400 truncate">{nodeType.type}</p>
      </div>
      <svg className="w-3 h-3 text-slate-300 group-hover:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node config panel
// ---------------------------------------------------------------------------

interface NodeConfigPanelProps {
  node: RuleNode | null;
  nodeTypeDef: NodeType | null;
  chainId: string;
  onClose: () => void;
  onNodeUpdated: (updated: RuleNode) => void;
  onNodeDeleted: (nodeId: string) => void;
  isFirst: boolean;
  onSetFirst: (nodeId: string) => void;
  debugEvents: DebugEvent[];
  debugLoading: boolean;
}

function NodeConfigPanel({
  node,
  nodeTypeDef,
  chainId,
  onClose,
  onNodeUpdated,
  onNodeDeleted,
  isFirst,
  onSetFirst,
  debugEvents,
  debugLoading,
}: NodeConfigPanelProps) {
  const { toast } = useToast();
  const [localName, setLocalName] = useState('');
  const [localConfig, setLocalConfig] = useState<Record<string, any>>({});
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [configTab, setConfigTab] = useState<'config' | 'debug'>('config');
  const [scriptValue, setScriptValue] = useState('');

  // Determine if this node type uses a script editor
  const isScriptNode = node ? SCRIPT_NODE_TYPES.has(node.type) : false;

  // Sync state when node changes
  useEffect(() => {
    if (node) {
      setLocalName(node.name);
      setLocalConfig(node.configuration ?? {});
      setDebugEnabled(node.debugEnabled);
      if (isScriptNode) {
        setScriptValue(node.configuration?.script ?? '// Write your script here\n\nfunction filter(msg, metadata, msgType) {\n  return true;\n}\n');
      }
    }
  }, [node?.id, isScriptNode]);

  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="p-4 rounded-2xl bg-slate-100 mb-4">
          <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-600">No node selected</p>
        <p className="text-xs text-slate-400 mt-1">Click a node on the canvas to configure it</p>
      </div>
    );
  }

  const handleSave = async () => {
    if (!localName.trim()) {
      toast.error('Validation Error', 'Node name is required.');
      return;
    }
    setSaving(true);
    try {
      const configToSave = isScriptNode
        ? { ...localConfig, script: scriptValue }
        : localConfig;

      const result = await apiClient.put<RuleNode>(
        `/api/rule-chains/${chainId}/nodes/${node.id}`,
        {
          name: localName.trim(),
          configuration: configToSave,
          debugEnabled,
        },
      );
      onNodeUpdated(result);
      toast.success('Node Updated', `"${localName.trim()}" has been saved.`);
    } catch (err: any) {
      toast.error('Save Failed', err?.message || 'Failed to update node.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.delete(`/api/rule-chains/${chainId}/nodes/${node.id}`);
      onNodeDeleted(node.id);
      toast.success('Node Deleted', `"${node.name}" has been removed.`);
    } catch (err: any) {
      toast.error('Delete Failed', err?.message || 'Failed to delete node.');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const updateConfigField = (key: string, value: any) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  const colors = nodeTypeDef ? getCategoryColor(nodeTypeDef.category) : getCategoryColor('FLOW');

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('p-1.5 rounded-lg flex-shrink-0', colors.bg)}>
            <svg className={cn('w-3.5 h-3.5', colors.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={nodeTypeDef ? getCategoryIcon(nodeTypeDef.category) : getCategoryIcon('FLOW')} />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{node.name}</p>
            <p className="text-[10px] text-slate-400">{node.type}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 flex-shrink-0">
        <button
          onClick={() => setConfigTab('config')}
          className={cn(
            'flex-1 py-2 text-xs font-semibold transition-colors',
            configTab === 'config'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          Configuration
        </button>
        <button
          onClick={() => setConfigTab('debug')}
          className={cn(
            'flex-1 py-2 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5',
            configTab === 'debug'
              ? 'text-orange-600 border-b-2 border-orange-600'
              : 'text-slate-500 hover:text-slate-700',
          )}
        >
          Debug
          {debugEvents.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px]">
              {debugEvents.length}
            </span>
          )}
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {configTab === 'config' ? (
          <div className="p-4 space-y-4">
            {/* Name */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1.5">Node Name *</label>
              <Input
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                placeholder="Enter node name"
                className="h-9 text-sm"
              />
            </div>

            {/* Category badge */}
            {nodeTypeDef && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Category:</span>
                <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-md', colors.bg, colors.text)}>
                  {nodeTypeDef.category}
                </span>
              </div>
            )}

            {/* Description */}
            {nodeTypeDef?.description && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs text-slate-600">{nodeTypeDef.description}</p>
              </div>
            )}

            {/* Debug toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-orange-50 border border-orange-100">
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', debugEnabled ? 'bg-orange-400 animate-pulse' : 'bg-slate-300')} />
                <span className="text-xs font-semibold text-slate-700">Debug Mode</span>
              </div>
              <button
                onClick={() => setDebugEnabled(!debugEnabled)}
                className={cn(
                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                  debugEnabled ? 'bg-orange-500' : 'bg-slate-200',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                    debugEnabled ? 'translate-x-4' : 'translate-x-1',
                  )}
                />
              </button>
            </div>

            {/* First node toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`first-${node.id}`}
                checked={isFirst}
                onChange={() => onSetFirst(node.id)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor={`first-${node.id}`} className="text-xs font-medium text-slate-600">
                Mark as first node (entry point)
              </label>
            </div>

            {/* Script editor */}
            {isScriptNode ? (
              <div>
                <label className="text-xs font-semibold text-slate-600 block mb-1.5">Script (JavaScript)</label>
                <div className="rounded-xl border-2 border-slate-200 overflow-hidden">
                  <Editor
                    height="240px"
                    defaultLanguage="javascript"
                    value={scriptValue}
                    onChange={(val) => setScriptValue(val ?? '')}
                    theme="vs-light"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      tabSize: 2,
                      automaticLayout: true,
                      padding: { top: 8, bottom: 8 },
                    }}
                  />
                </div>
              </div>
            ) : (
              /* Generic config fields from schema or JSON fallback */
              <>
                {nodeTypeDef?.configSchema && Object.keys(nodeTypeDef.configSchema).length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-slate-600">Configuration Fields</p>
                    {Object.entries(nodeTypeDef.configSchema).map(([key, schemaDef]) => {
                      const fieldDef = schemaDef as any;
                      const fieldType = fieldDef?.type ?? 'string';
                      const label = fieldDef?.label ?? key;
                      const description = fieldDef?.description;

                      if (fieldType === 'boolean') {
                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-medium text-slate-600">{label}</label>
                              <button
                                onClick={() => updateConfigField(key, !localConfig[key])}
                                className={cn(
                                  'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                                  localConfig[key] ? 'bg-blue-500' : 'bg-slate-200',
                                )}
                              >
                                <span
                                  className={cn(
                                    'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                                    localConfig[key] ? 'translate-x-4' : 'translate-x-1',
                                  )}
                                />
                              </button>
                            </div>
                            {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
                          </div>
                        );
                      }

                      if (fieldType === 'select' && Array.isArray(fieldDef?.options)) {
                        return (
                          <div key={key}>
                            <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                            <select
                              value={localConfig[key] ?? ''}
                              onChange={(e) => updateConfigField(key, e.target.value)}
                              className="flex h-9 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition-all"
                            >
                              <option value="">Select...</option>
                              {fieldDef.options.map((opt: string) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                            {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
                          </div>
                        );
                      }

                      if (fieldType === 'number') {
                        return (
                          <div key={key}>
                            <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                            <Input
                              type="number"
                              value={localConfig[key] ?? ''}
                              onChange={(e) => updateConfigField(key, Number(e.target.value))}
                              className="h-9 text-sm"
                              placeholder={fieldDef?.placeholder ?? `Enter ${label.toLowerCase()}`}
                            />
                            {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
                          </div>
                        );
                      }

                      if (fieldType === 'textarea') {
                        return (
                          <div key={key}>
                            <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                            <textarea
                              value={typeof localConfig[key] === 'string' ? localConfig[key] : ''}
                              onChange={(e) => updateConfigField(key, e.target.value)}
                              rows={3}
                              placeholder={fieldDef?.placeholder ?? `Enter ${label.toLowerCase()}`}
                              className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-all resize-none"
                            />
                            {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
                          </div>
                        );
                      }

                      // Default: text
                      return (
                        <div key={key}>
                          <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
                          <Input
                            value={typeof localConfig[key] === 'string' ? localConfig[key] : ''}
                            onChange={(e) => updateConfigField(key, e.target.value)}
                            className="h-9 text-sm"
                            placeholder={fieldDef?.placeholder ?? `Enter ${label.toLowerCase()}`}
                          />
                          {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* JSON fallback for unknown config */
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1.5">
                      Configuration (JSON)
                    </label>
                    <textarea
                      value={JSON.stringify(localConfig, null, 2)}
                      onChange={(e) => {
                        try {
                          setLocalConfig(JSON.parse(e.target.value));
                        } catch {
                          /* ignore parse errors while typing */
                        }
                      }}
                      rows={8}
                      spellCheck={false}
                      className="flex w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 transition-all resize-none"
                    />
                  </div>
                )}
              </>
            )}

            {/* Expected outputs */}
            {nodeTypeDef?.outputs && nodeTypeDef.outputs.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1.5">Output Labels</p>
                <div className="flex flex-wrap gap-1.5">
                  {nodeTypeDef.outputs.map((out) => (
                    <span key={out} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                      {out}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Debug tab */
          <div className="p-4 space-y-3">
            {!debugEnabled && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs text-amber-700">Enable debug mode above then save to capture events.</p>
              </div>
            )}
            {debugLoading ? (
              <div className="flex items-center justify-center py-8">
                <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : debugEvents.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs text-slate-500">No debug events yet</p>
              </div>
            ) : (
              debugEvents
                .filter((ev) => ev.nodeId === node.id)
                .slice(0, 20)
                .map((ev) => (
                  <div
                    key={ev.id}
                    className={cn(
                      'rounded-lg border p-3 space-y-2',
                      ev.error ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'text-[10px] font-bold px-1.5 py-0.5 rounded',
                            ev.error ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700',
                          )}
                        >
                          {ev.output}
                        </span>
                        <span className="text-[10px] text-slate-400">{ev.durationMs}ms</span>
                      </div>
                      <span className="text-[9px] text-slate-400">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {ev.error && (
                      <p className="text-[10px] text-red-600 font-mono break-all">{ev.error}</p>
                    )}
                    <details className="text-[10px]">
                      <summary className="text-slate-500 cursor-pointer select-none">Input / Output</summary>
                      <div className="mt-1 space-y-1">
                        <div>
                          <span className="text-slate-400 font-semibold">IN: </span>
                          <span className="font-mono text-slate-600 break-all">
                            {JSON.stringify(ev.inputMsg).slice(0, 200)}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 font-semibold">OUT: </span>
                          <span className="font-mono text-slate-600 break-all">
                            {JSON.stringify(ev.outputMsg).slice(0, 200)}
                          </span>
                        </div>
                      </div>
                    </details>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex-shrink-0 border-t border-slate-100 p-3 space-y-2">
        <Button
          onClick={handleSave}
          disabled={saving}
          size="sm"
          className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
        >
          {saving ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save Node
            </>
          )}
        </Button>

        {!showDeleteConfirm ? (
          <Button
            onClick={() => setShowDeleteConfirm(true)}
            variant="ghost"
            size="sm"
            className="w-full text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Node
          </Button>
        ) : (
          <div className="space-y-1">
            <p className="text-[10px] text-red-600 text-center font-semibold">Confirm deletion?</p>
            <div className="flex gap-1.5">
              <Button
                onClick={() => setShowDeleteConfirm(false)}
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                disabled={deleting}
                size="sm"
                className="flex-1 text-xs bg-red-600 hover:bg-red-700 text-white"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Node Dialog
// ---------------------------------------------------------------------------

interface AddNodeDialogProps {
  open: boolean;
  onClose: () => void;
  chainId: string;
  nodeTypes: NodeType[];
  dropPosition: { x: number; y: number };
  prefillType?: string;
  onNodeAdded: (node: RuleNode) => void;
}

function AddNodeDialog({
  open,
  onClose,
  chainId,
  nodeTypes,
  dropPosition,
  prefillType,
  onNodeAdded,
}: AddNodeDialogProps) {
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedType(prefillType ?? '');
      const nt = nodeTypes.find((t) => t.type === prefillType);
      setNodeName(nt ? nt.name : '');
    }
  }, [open, prefillType, nodeTypes]);

  if (!open) return null;

  const handleAdd = async () => {
    if (!selectedType) {
      toast.error('Validation Error', 'Please select a node type.');
      return;
    }
    if (!nodeName.trim()) {
      toast.error('Validation Error', 'Node name is required.');
      return;
    }
    setAdding(true);
    try {
      const result = await apiClient.post<RuleNode>(`/api/rule-chains/${chainId}/nodes`, {
        type: selectedType,
        name: nodeName.trim(),
        configuration: {},
        debugEnabled: false,
        positionX: Math.round(dropPosition.x),
        positionY: Math.round(dropPosition.y),
      });
      onNodeAdded(result);
      onClose();
      toast.success('Node Added', `"${nodeName.trim()}" has been added to the canvas.`);
    } catch (err: any) {
      toast.error('Failed to Add Node', err?.message || 'Could not add node.');
    } finally {
      setAdding(false);
    }
  };

  const groupedTypes = nodeTypes.reduce<Record<string, NodeType[]>>((acc, nt) => {
    if (!acc[nt.category]) acc[nt.category] = [];
    acc[nt.category].push(nt);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 z-50 shadow-2xl border border-slate-200/60 animate-fade-in max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-xl bg-cyan-100 text-cyan-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-800">Add Node</h2>
        </div>

        <div className="space-y-4">
          {/* Node type select */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Node Type *</label>
            <select
              value={selectedType}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedType(val);
                const nt = nodeTypes.find((t) => t.type === val);
                if (nt) setNodeName(nt.name);
              }}
              className="flex h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 hover:border-slate-300 transition-all"
            >
              <option value="">Select a node type...</option>
              {Object.entries(groupedTypes).map(([category, types]) => (
                <optgroup key={category} label={category}>
                  {types.map((nt) => (
                    <option key={nt.type} value={nt.type}>{nt.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Node Name *</label>
            <Input
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
              placeholder="Enter node name"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>

          {/* Description of selected type */}
          {selectedType && (() => {
            const nt = nodeTypes.find((t) => t.type === selectedType);
            return nt?.description ? (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs text-slate-600">{nt.description}</p>
                {nt.outputs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {nt.outputs.map((o) => (
                      <span key={o} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{o}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : null;
          })()}
        </div>

        <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleAdd}
            disabled={adding || !selectedType || !nodeName.trim()}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"
          >
            {adding ? 'Adding...' : 'Add Node'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Connection Dialog
// ---------------------------------------------------------------------------

interface AddConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  chainId: string;
  connection: Connection | null;
  nodeTypesMap: Map<string, NodeType>;
  nodes: Node[];
  onConnectionAdded: (conn: RuleNodeConnection) => void;
}

function AddConnectionDialog({
  open,
  onClose,
  chainId,
  connection,
  nodeTypesMap,
  nodes,
  onConnectionAdded,
}: AddConnectionDialogProps) {
  const { toast } = useToast();
  const [label, setLabel] = useState('Success');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setLabel('Success');
  }, [open]);

  if (!open || !connection) return null;

  const fromNode = nodes.find((n) => n.id === connection.source);
  const toNode = nodes.find((n) => n.id === connection.target);
  const fromType = fromNode?.data?.nodeType as string | undefined;
  const nt = fromType ? nodeTypesMap.get(fromType) : undefined;
  const outputOptions = nt?.outputs && nt.outputs.length > 0 ? nt.outputs : ['Success', 'Failure', 'True', 'False'];

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await apiClient.post<RuleNodeConnection>(`/api/rule-chains/${chainId}/connections`, {
        fromNodeId: connection.source,
        toNodeId: connection.target,
        label: label.trim() || 'Success',
      });
      onConnectionAdded(result);
      onClose();
      toast.success('Connection Created', `Edge "${label}" has been created.`);
    } catch (err: any) {
      toast.error('Connection Failed', err?.message || 'Failed to create connection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 z-50 shadow-2xl border border-slate-200/60 animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-800">Create Connection</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="font-semibold text-slate-800 truncate max-w-[100px]">{fromNode?.data?.label}</span>
            <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <span className="font-semibold text-slate-800 truncate max-w-[100px]">{toNode?.data?.label}</span>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Connection Label *</label>
            <select
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 hover:border-slate-300 transition-all"
            >
              {outputOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
              <option value="Custom">Custom...</option>
            </select>
          </div>

          {label === 'Custom' && (
            <Input
              value=""
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Enter custom label"
              autoFocus
            />
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !label}
            className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
          >
            {saving ? 'Creating...' : 'Create Connection'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor page
// ---------------------------------------------------------------------------

const NODE_TYPES: NodeTypes = { customRuleNode: CustomRuleNode };

// Stagger the default node layout on canvas if no position set
const DEFAULT_POSITION = { x: 200, y: 100 };

export function RuleChainEditorPage() {
  const { id: chainId } = useParams<{ id: string }>();
  const { toast } = useToast();
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

  // Selected node id (from flow canvas)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  const handleCanvasClick = useCallback(() => {
    // Open add node dialog at centre when clicking empty canvas (double-click)
  }, []);

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
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

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
      if (!chainId) return;
      setSaving(true);

      // Collect current node positions from React Flow
      const nodeUpdates = rfNodes.map((n) => ({
        id: n.id,
        positionX: Math.round(n.position.x),
        positionY: Math.round(n.position.y),
      }));

      const payload: any = {
        name: localName,
        isActive: localActive,
        firstRuleNodeId: firstNodeId,
        nodePositions: nodeUpdates,
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
    [chainId, localName, localActive, firstNodeId, rfNodes, mutateChain, toast],
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

  const handleToggleActive = useCallback(async () => {
    if (!chainId) return;
    const newActive = !localActive;
    try {
      await apiClient.put(`/api/rule-chains/${chainId}`, {
        name: localName,
        isActive: newActive,
      });
      setLocalActive(newActive);
      toast.success(
        newActive ? 'Chain Activated' : 'Chain Deactivated',
        `Rule chain is now ${newActive ? 'active' : 'inactive'}.`,
      );
      mutateChain();
    } catch (err: any) {
      toast.error('Toggle Failed', err?.message || 'Failed to update status.');
    }
  }, [chainId, localActive, localName, mutateChain, toast]);

  // ---------------------------------------------------------------------------
  // Name edit save
  // ---------------------------------------------------------------------------

  const handleNameSave = useCallback(async () => {
    if (!chainId || !localName.trim()) return;
    try {
      await apiClient.put(`/api/rule-chains/${chainId}`, { name: localName.trim() });
      setEditingName(false);
      mutateChain();
      toast.success('Name Updated', 'Rule chain name has been saved.');
    } catch (err: any) {
      toast.error('Failed', err?.message || 'Could not update name.');
    }
  }, [chainId, localName, mutateChain, toast]);

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
