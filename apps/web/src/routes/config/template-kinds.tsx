import { useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

type TemplateKind = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  templateCount: number;
};

/**
 * Configuration page for the Template Kinds lookup table. Admins can add
 * new kinds (PUMP, VALVE, COMPRESSOR, etc.) without a code migration.
 *
 * The 6 system kinds (BLOCK / AREA / AHU / FILTER / EQUIPMENT / OTHER) are
 * shown with a lock icon — their `code` cannot be renamed and they cannot
 * be deleted because Filter Management / Cleaning Operations / Mobile pages
 * route by those codes. Their `label` / `description` / `sortOrder` /
 * `isActive` ARE editable.
 *
 * Kinds in use (templateCount > 0) cannot be deleted; the operator must
 * reassign affected templates first.
 */
export default function TemplateKindsConfigPage() {
  const { data: kinds, mutate, isLoading } = useSWR<TemplateKind[]>('/api/template-kinds');

  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newSort, setNewSort] = useState(100);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editSort, setEditSort] = useState(0);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  function resetCreateForm() {
    setShowCreate(false);
    setNewCode('');
    setNewLabel('');
    setNewDesc('');
    setNewSort(100);
    setCreateError(null);
  }

  function openEditRow(kind: TemplateKind) {
    setEditingCode(kind.code);
    setEditLabel(kind.label);
    setEditDesc(kind.description ?? '');
    setEditSort(kind.sortOrder);
    setEditError(null);
  }

  function cancelEditRow() {
    setEditingCode(null);
    setEditError(null);
  }

  async function saveEditRow(kind: TemplateKind) {
    setEditError(null);
    if (!editLabel.trim()) {
      setEditError('Label is required.');
      return;
    }
    setEditSubmitting(true);
    try {
      await apiClient.put(`/api/template-kinds/${kind.code}`, {
        label: editLabel.trim(),
        description: editDesc.trim() || null,
        sortOrder: editSort,
      });
      await mutate();
      cancelEditRow();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleCreate() {
    setCreateError(null);
    if (!/^[A-Z][A-Z0-9_]*$/.test(newCode)) {
      setCreateError('Code must be UPPER_SNAKE_CASE (letters, digits, underscores).');
      return;
    }
    if (!newLabel.trim()) {
      setCreateError('Label is required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/api/template-kinds', {
        code: newCode,
        label: newLabel.trim(),
        description: newDesc.trim() || undefined,
        sortOrder: newSort,
        isActive: true,
      });
      await mutate();
      resetCreateForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create template kind';
      setCreateError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(kind: TemplateKind) {
    if (kind.isSystem) return;
    if (kind.templateCount > 0) {
      alert(`Cannot delete "${kind.code}" — ${kind.templateCount} template(s) reference it. Reassign those templates first.`);
      return;
    }
    if (!confirm(`Delete template kind "${kind.code}"?`)) return;
    try {
      await apiClient.delete(`/api/template-kinds/${kind.code}`);
      await mutate();
    } catch (err) {
      console.error('[template-kinds] delete failed:', err);
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleToggleActive(kind: TemplateKind) {
    try {
      await apiClient.put(`/api/template-kinds/${kind.code}`, { isActive: !kind.isActive });
      await mutate();
    } catch (err) {
      console.error('[template-kinds] toggle failed:', err);
    }
  }


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Template Kinds</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Canonical entity-template families. The system kinds (BLOCK / AREA / AHU / FILTER / EQUIPMENT / OTHER) drive the Filter Management,
            Cleaning Operations, and Mobile pages — their codes cannot be renamed and they cannot be deleted.
            Add new kinds (e.g. PUMP, VALVE) to categorize custom templates.
          </p>
        </div>
        {!showCreate && (
          <Button onClick={() => setShowCreate(true)}>+ New Kind</Button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <h2 className="font-semibold text-slate-800">New Template Kind</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Code <span className="text-xs text-slate-500">(UPPER_SNAKE_CASE, immutable)</span>
              </label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. PUMP" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Label</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Pump" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</label>
              <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="e.g. Centrifugal / positive-displacement pumps" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sort Order</label>
              <Input type="number" value={newSort} onChange={(e) => setNewSort(parseInt(e.target.value, 10) || 0)} />
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
            <Button variant="outline" onClick={resetCreateForm}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading kinds…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-center">Sort</TableHead>
              <TableHead className="text-center">Templates</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-center">Type</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(kinds ?? []).map((k) => {
              const isEditing = editingCode === k.code;
              if (isEditing) {
                return (
                  <TableRow key={k.id} className="bg-slate-50">
                    <TableCell className="font-mono text-sm text-slate-500" title="Code is immutable">
                      {k.code}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder="Label"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Description (optional)"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        value={editSort}
                        onChange={(e) => setEditSort(parseInt(e.target.value, 10) || 0)}
                        className="w-20 text-center"
                      />
                    </TableCell>
                    <TableCell className="text-center">{k.templateCount}</TableCell>
                    <TableCell className="text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${k.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {k.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {k.isSystem
                        ? <Badge variant="secondary" className="text-xs">🔒 System</Badge>
                        : <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">Custom</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" onClick={() => saveEditRow(k)} disabled={editSubmitting}>
                          {editSubmitting ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEditRow} disabled={editSubmitting}>
                          Cancel
                        </Button>
                      </div>
                      {editError && <p className="text-xs text-red-600 mt-1 text-right">{editError}</p>}
                    </TableCell>
                  </TableRow>
                );
              }
              return (
                <TableRow key={k.id}>
                  <TableCell className="font-mono text-sm">{k.code}</TableCell>
                  <TableCell>{k.label}</TableCell>
                  <TableCell className="text-slate-600 text-sm">{k.description ?? '—'}</TableCell>
                  <TableCell className="text-center">{k.sortOrder}</TableCell>
                  <TableCell className="text-center">{k.templateCount}</TableCell>
                  <TableCell className="text-center">
                    <button
                      onClick={() => handleToggleActive(k)}
                      className={`text-xs px-2 py-0.5 rounded-full ${k.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {k.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </TableCell>
                  <TableCell className="text-center">
                    {k.isSystem
                      ? <Badge variant="secondary" className="text-xs" title="System kind — code cannot be renamed and the row cannot be deleted">🔒 System</Badge>
                      : <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">Custom</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEditRow(k)} title="Edit label / description / sort">Edit</Button>
                    {!k.isSystem && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 ml-1"
                        onClick={() => handleDelete(k)}
                        disabled={k.templateCount > 0}
                        title={k.templateCount > 0 ? `${k.templateCount} template(s) use this kind` : 'Delete kind'}
                      >
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
