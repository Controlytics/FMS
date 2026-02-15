import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface AttributesTabProps {
  nodeId: string;
  node: any;
  canEdit: boolean;
}

export function AttributesTab({ nodeId, node, canEdit }: AttributesTabProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const attributes = (node.attributes ?? {}) as Record<string, unknown>;
  const entries = Object.entries(attributes);

  const startEdit = (key: string, value: unknown) => {
    setEditingKey(key);
    setEditValue(String(value ?? ''));
    setReason('');
  };

  const saveEdit = async () => {
    if (!editingKey || !reason.trim()) return;
    setSaving(true);
    try {
      await apiClient.put(`/api/hierarchy/${nodeId}`, {
        attributes: { [editingKey]: editValue },
        reason,
      });
      mutate(`/api/hierarchy/${nodeId}`);
      setEditingKey(null);
    } catch {
      // error handling
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {entries.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Attribute</TableHead>
              <TableHead>Value</TableHead>
              {canEdit && <TableHead className="w-24">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([key, val]) => (
              <TableRow key={key}>
                <TableCell className="font-medium">{key}</TableCell>
                <TableCell>
                  {editingKey === key ? (
                    <div className="flex gap-2">
                      <Input value={editValue} onChange={e => setEditValue(e.target.value)} className="h-8" />
                      <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason *" className="h-8" />
                      <Button size="sm" onClick={saveEdit} disabled={saving || !reason.trim()}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>X</Button>
                    </div>
                  ) : (
                    String(val ?? '—')
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell>
                    {editingKey !== key && (
                      <Button variant="ghost" size="sm" onClick={() => startEdit(key, val)}>Edit</Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No attributes defined for this asset.</p>
      )}
    </div>
  );
}
