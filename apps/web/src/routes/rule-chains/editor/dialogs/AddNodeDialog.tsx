import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RuleNode, NodeType } from '../types';
import { RuleChainSelectField } from '../components/RuleChainSelectField';

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

export function AddNodeDialog({
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
  const [initialConfig, setInitialConfig] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedType(prefillType ?? '');
      const nt = nodeTypes.find((t) => t.type === prefillType);
      setNodeName(nt ? nt.name : '');
      setInitialConfig({});
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
        configuration: initialConfig,
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
                setInitialConfig({});
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

          {/* Config schema fields for selected type */}
          {selectedType && (() => {
            const nt = nodeTypes.find((t) => t.type === selectedType);
            if (!nt?.configSchema || Object.keys(nt.configSchema).length === 0) return null;
            return Object.entries(nt.configSchema).map(([key, schemaDef]) => {
              const fieldDef = schemaDef as any;
              const fieldType = fieldDef?.type ?? 'string';
              if (fieldType === 'rule-chain-select') {
                return (
                  <RuleChainSelectField
                    key={key}
                    fieldKey={key}
                    label={fieldDef?.label ?? key}
                    description={fieldDef?.description}
                    value={(initialConfig[key] as string) ?? ''}
                    onChange={(val) => setInitialConfig((prev) => ({ ...prev, [key]: val }))}
                    currentChainId={chainId}
                  />
                );
              }
              return null;
            });
          })()}

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
