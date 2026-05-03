import { useState, useEffect } from 'react';
import { type Connection, type Node } from 'reactflow';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RuleNodeConnection, NodeType } from '../types';

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

export function AddConnectionDialog({
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
