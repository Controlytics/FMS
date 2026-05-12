import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { getCategoryColor, getCategoryIcon, SCRIPT_NODE_TYPES } from '../constants';
import type { RuleNode, NodeType, DebugEvent } from '../types';
import { RuleChainSelectField } from './RuleChainSelectField';

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

export function NodeConfigPanel({
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
  const { formatTime } = useDatetimeFormat();
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

                      if (fieldType === 'rule-chain-select') {
                        return (
                          <RuleChainSelectField
                            key={key}
                            label={label}
                            description={description}
                            value={(localConfig[key] as string) ?? ''}
                            onChange={(val) => updateConfigField(key, val)}
                            currentChainId={chainId}
                          />
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
                        {formatTime(ev.timestamp)}
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
