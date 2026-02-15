import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { FORWARD_RELATIONSHIP_TYPES, RELATIONSHIP_TYPES, type RelationshipType } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface LinkDialogProps {
  open: boolean;
  onClose: () => void;
  prefilledSourceId?: string;
}

export function LinkDialog({ open, onClose, prefilledSourceId }: LinkDialogProps) {
  const [sourceSearch, setSourceSearch] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [sourceId, setSourceId] = useState(prefilledSourceId ?? '');
  const [targetId, setTargetId] = useState('');
  const [type, setType] = useState<string>('CONTAINS');
  const [customLabel, setCustomLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: allNodes } = useSWR(open ? '/api/hierarchy/tree?limit=500' : null);
  const nodes = (allNodes?.data ?? allNodes ?? []) as Array<{ id: string; name: string; nodeType: string; status: string }>;

  const filteredSources = nodes.filter(n =>
    n.status !== 'decommissioned' &&
    n.name.toLowerCase().includes(sourceSearch.toLowerCase())
  );
  const filteredTargets = nodes.filter(n =>
    n.status !== 'decommissioned' &&
    n.id !== sourceId &&
    n.name.toLowerCase().includes(targetSearch.toLowerCase())
  );

  const selectedSource = nodes.find(n => n.id === sourceId);
  const selectedTarget = nodes.find(n => n.id === targetId);
  const relType = RELATIONSHIP_TYPES[type as RelationshipType];
  const inverseType = relType?.inverse ?? type;

  const handleSubmit = async () => {
    setError('');
    if (!sourceId || !targetId) {
      setError('Please select both source and target assets');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/api/hierarchy/links', {
        sourceId, targetId, type,
        customLabel: customLabel || undefined,
        notes: notes || undefined,
      });
      // Invalidate SWR caches for both nodes
      mutate(`/api/hierarchy/${sourceId}/links`);
      mutate(`/api/hierarchy/${targetId}/links`);
      mutate((key: string) => typeof key === 'string' && key.startsWith('/api/hierarchy'), undefined, { revalidate: true });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create relationship');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setSourceId(prefilledSourceId ?? '');
    setTargetId('');
    setType('CONTAINS');
    setCustomLabel('');
    setNotes('');
    setError('');
    setSourceSearch('');
    setTargetSearch('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Link Assets</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {/* Source picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Source Asset</label>
          {selectedSource ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selectedSource.nodeType}</Badge>
              <span className="font-medium">{selectedSource.name}</span>
              {!prefilledSourceId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSourceId('')}>Change</Button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <Input placeholder="Search assets..." value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} />
              <div className="max-h-32 overflow-y-auto rounded border border-border">
                {filteredSources.slice(0, 20).map(n => (
                  <button key={n.id} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50"
                    onClick={() => { setSourceId(n.id); setSourceSearch(''); }}>
                    <Badge variant="outline" className="text-xs">{n.nodeType}</Badge>
                    {n.name}
                  </button>
                ))}
                {filteredSources.length === 0 && <p className="p-2 text-xs text-muted-foreground">No assets found</p>}
              </div>
            </div>
          )}
        </div>

        {/* Relationship type */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Relationship Type</label>
          <Select value={type} onChange={e => setType(e.target.value)}>
            {FORWARD_RELATIONSHIP_TYPES.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')} — {RELATIONSHIP_TYPES[t].description}</option>
            ))}
          </Select>
          {type === 'CUSTOM' && (
            <Input placeholder="Custom label (optional)" value={customLabel} onChange={e => setCustomLabel(e.target.value)} />
          )}
        </div>

        {/* Target picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Asset</label>
          {selectedTarget ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selectedTarget.nodeType}</Badge>
              <span className="font-medium">{selectedTarget.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTargetId('')}>Change</Button>
            </div>
          ) : (
            <div className="space-y-1">
              <Input placeholder="Search assets..." value={targetSearch} onChange={e => setTargetSearch(e.target.value)} />
              <div className="max-h-32 overflow-y-auto rounded border border-border">
                {filteredTargets.slice(0, 20).map(n => (
                  <button key={n.id} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50"
                    onClick={() => { setTargetId(n.id); setTargetSearch(''); }}>
                    <Badge variant="outline" className="text-xs">{n.nodeType}</Badge>
                    {n.name}
                  </button>
                ))}
                {filteredTargets.length === 0 && <p className="p-2 text-xs text-muted-foreground">No assets found</p>}
              </div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Notes (optional)</label>
          <Input placeholder="Reason or description for this relationship" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {/* Preview */}
        {selectedSource && selectedTarget && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
            <p className="font-medium">Preview:</p>
            <p>{selectedSource.name} <Badge variant="default" className="mx-1">{type.replace(/_/g, ' ')}</Badge> {selectedTarget.name}</p>
            <p>{selectedTarget.name} <Badge variant="secondary" className="mx-1">{inverseType.replace(/_/g, ' ')}</Badge> {selectedSource.name}</p>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting || !sourceId || !targetId}>
          {submitting ? 'Creating...' : 'Create Relationship'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
