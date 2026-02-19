import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { api } from '@/lib/api-client';
import { useReauth } from '@/hooks/use-reauth';
import { FORWARD_RELATIONSHIP_TYPES } from '@digilog/shared';

interface TemplateData {
  id: string;
  name: string;
  icon: string;
}

interface LinkingRule {
  id: string;
  sourceTemplateId: string;
  targetTemplateId: string;
  allowedRelationships: string[];
  scope: string;
  scopeValue: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  sourceTemplate: { id: string; name: string };
  targetTemplate: { id: string; name: string };
}

interface RoleData {
  id: string;
  name: string;
  displayName: string;
}

const SCOPE_LABELS: Record<string, string> = {
  GLOBAL: 'Global',
  ROLE: 'Per Role',
  USER: 'Per User',
};

const SCOPE_COLORS: Record<string, string> = {
  GLOBAL: 'bg-blue-100 text-blue-700',
  ROLE: 'bg-purple-100 text-purple-700',
  USER: 'bg-amber-100 text-amber-700',
};

const REL_COLORS: Record<string, string> = {
  CONTAINS: 'bg-emerald-100 text-emerald-700',
  CONNECTED_TO: 'bg-blue-100 text-blue-700',
  FEEDS: 'bg-cyan-100 text-cyan-700',
  DEPENDS_ON: 'bg-orange-100 text-orange-700',
  BACKS_UP: 'bg-purple-100 text-purple-700',
  MONITORS: 'bg-pink-100 text-pink-700',
  CUSTOM: 'bg-slate-100 text-slate-700',
};

export function TemplateLinkingRulesPage() {
  const { data: rules, isLoading: rulesLoading } = useSWR<LinkingRule[]>('/api/assets/linking-rules');
  const { data: templatesRes } = useSWR<{ data: TemplateData[] }>('/api/assets/templates');
  const { data: rolesData } = useSWR<RoleData[]>('/api/roles/active');
  const reauth = useReauth();

  const templates = useMemo(() => templatesRes?.data ?? [], [templatesRes]);
  const roles = useMemo(() => rolesData ?? [], [rolesData]);

  const [showDialog, setShowDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<LinkingRule | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LinkingRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [sourceTemplateId, setSourceTemplateId] = useState('');
  const [targetTemplateId, setTargetTemplateId] = useState('');
  const [allowedRelationships, setAllowedRelationships] = useState<string[]>([]);
  const [scope, setScope] = useState('GLOBAL');
  const [scopeValue, setScopeValue] = useState('');

  const resetForm = () => {
    setSourceTemplateId('');
    setTargetTemplateId('');
    setAllowedRelationships([]);
    setScope('GLOBAL');
    setScopeValue('');
    setError('');
    setEditingRule(null);
  };

  const openCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEdit = (rule: LinkingRule) => {
    setEditingRule(rule);
    setSourceTemplateId(rule.sourceTemplateId);
    setTargetTemplateId(rule.targetTemplateId);
    setAllowedRelationships([...rule.allowedRelationships]);
    setScope(rule.scope);
    setScopeValue(rule.scopeValue ?? '');
    setShowDialog(true);
  };

  const toggleRelType = (type: string) => {
    setAllowedRelationships(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleSave = async () => {
    if (!sourceTemplateId || !targetTemplateId) {
      setError('Source and Target templates are required');
      return;
    }
    if (allowedRelationships.length === 0) {
      setError('Select at least one relationship type');
      return;
    }
    if ((scope === 'ROLE' || scope === 'USER') && !scopeValue) {
      setError(`${scope === 'ROLE' ? 'Role' : 'User'} is required for ${SCOPE_LABELS[scope]} scope`);
      return;
    }

    setSaving(true);
    setError('');

    const body = {
      sourceTemplateId,
      targetTemplateId,
      allowedRelationships,
      scope,
      ...(scope !== 'GLOBAL' && { scopeValue }),
    };

    try {
      if (editingRule) {
        await reauth.execute('UPDATE_TEMPLATE_LINKING_RULE', async () => {
          await api.put(`/api/assets/linking-rules/${editingRule.id}`, body);
        });
      } else {
        await reauth.execute('CREATE_TEMPLATE_LINKING_RULE', async () => {
          await api.post('/api/assets/linking-rules', body);
        });
      }
      mutate('/api/assets/linking-rules');
      setShowDialog(false);
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await reauth.execute('DELETE_TEMPLATE_LINKING_RULE', async () => {
        await api.delete(`/api/assets/linking-rules/${deleteTarget.id}`);
      });
      mutate('/api/assets/linking-rules');
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/config" className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg shadow-emerald-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Template Linking Rules</h1>
            <p className="text-sm text-slate-500">Define which template types can be linked together and with which relationship types</p>
          </div>
        </div>
        <Button onClick={openCreate} className="bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Rule
        </Button>
      </div>

      {/* Info banner */}
      <div className="bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl border border-emerald-200 p-4">
        <p className="text-sm text-emerald-800">
          Linking rules restrict which relationship types can be used between different template types.
          If no rule exists for a template pair, all relationship types are allowed (backwards compatible).
          Rules with higher scope priority override lower ones: User &gt; Role &gt; Global.
        </p>
      </div>

      {/* Rules Table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl overflow-hidden">
        {rulesLoading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : !rules || rules.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <p className="text-slate-500 font-medium">No linking rules configured</p>
            <p className="text-sm text-slate-400 mt-1">All relationship types are currently allowed between all templates</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Source Template</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider"></th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Target Template</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Allowed Relationships</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Scope</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-800">{rule.sourceTemplate.name}</span>
                    </td>
                    <td className="px-3 py-4 text-center">
                      <svg className="w-5 h-5 text-slate-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-800">{rule.targetTemplate.name}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {rule.allowedRelationships.map((rel) => (
                          <Badge key={rel} className={`text-xs ${REL_COLORS[rel] ?? 'bg-slate-100 text-slate-700'}`}>
                            {rel.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={`text-xs ${SCOPE_COLORS[rule.scope] ?? ''}`}>
                        {SCOPE_LABELS[rule.scope] ?? rule.scope}
                      </Badge>
                      {rule.scopeValue && (
                        <span className="text-xs text-slate-500 ml-1">({rule.scopeValue})</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(rule)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors" title="Edit">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => { setDeleteTarget(rule); setShowDeleteDialog(true); }}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onClose={() => { setShowDialog(false); resetForm(); }} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editingRule ? 'Edit Linking Rule' : 'Create Linking Rule'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>
          )}

          {/* Source Template */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Source Template</label>
            <select
              value={sourceTemplateId}
              onChange={(e) => setSourceTemplateId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="">Select template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Target Template */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Template</label>
            <select
              value={targetTemplateId}
              onChange={(e) => setTargetTemplateId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="">Select template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Allowed Relationship Types */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Allowed Relationship Types</label>
            <div className="grid grid-cols-2 gap-2">
              {(FORWARD_RELATIONSHIP_TYPES as readonly string[]).map((type) => (
                <label
                  key={type}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                    allowedRelationships.includes(type)
                      ? 'bg-emerald-50 border-emerald-300 border'
                      : 'bg-white border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={allowedRelationships.includes(type)}
                    onChange={() => toggleRelType(type)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                    allowedRelationships.includes(type)
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'border-slate-300'
                  }`}>
                    {allowedRelationships.includes(type) && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-slate-700">{type.replace(/_/g, ' ')}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Scope</label>
            <select
              value={scope}
              onChange={(e) => { setScope(e.target.value); setScopeValue(''); }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="GLOBAL">Global (applies to all users)</option>
              <option value="ROLE">Per Role (applies to specific role)</option>
              <option value="USER">Per User (applies to specific user)</option>
            </select>
          </div>

          {/* Scope Value */}
          {scope === 'ROLE' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">Select role...</option>
                {roles.map((r) => (
                  <option key={r.name} value={r.name}>{r.displayName}</option>
                ))}
              </select>
            </div>
          )}

          {scope === 'USER' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">User ID</label>
              <Input
                value={scopeValue}
                onChange={(e) => setScopeValue(e.target.value)}
                placeholder="Enter user ID..."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowDialog(false); resetForm(); }}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-emerald-500 to-green-600 text-white"
          >
            {saving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onClose={() => { setShowDeleteDialog(false); setDeleteTarget(null); }}>
        <DialogHeader>
          <DialogTitle>Delete Linking Rule</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-600">
          Are you sure you want to delete the linking rule between{' '}
          <strong>{deleteTarget?.sourceTemplate.name}</strong> and{' '}
          <strong>{deleteTarget?.targetTemplate.name}</strong>?
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Existing relationships created under this rule will not be affected. Only future link attempts will be unrestricted.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteTarget(null); }}>Cancel</Button>
          <Button onClick={handleDelete} disabled={saving} className="bg-red-500 hover:bg-red-600 text-white">
            {saving ? 'Deleting...' : 'Delete Rule'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
