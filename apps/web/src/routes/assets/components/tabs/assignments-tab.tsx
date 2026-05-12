import { useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { PERMISSIONS } from '@digilog/shared';

type AssigneeType = 'USER' | 'ROLE';

type Assignment = {
  id: string;
  entityId: string;
  assigneeType: AssigneeType;
  userId?: string | null;
  roleValue?: string | null;
  permissions: { view?: boolean; control?: boolean; configure?: boolean } | null;
  createdAt: string;
  assigneeName: string;
};

type UserOption = { id: string; fullName: string; username: string };
type RoleOption = { value: string; label: string };

export function AssignmentsTab({ entityId }: { entityId: string }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canAssign = isSuperAdmin || perms.includes(PERMISSIONS.ENTITY_ASSIGN);

  const { data: assignments, isLoading, mutate } = useSWR<Assignment[]>(`/api/entity-assignments/${entityId}`);

  // Users cap is 100 in shared/schemas/users.ts (DoS guard restored in commit b2c3b37).
  // Real deployments are well under that; use the cap to avoid tripping it.
  const { data: usersData } = useSWR<{ data: UserOption[] }>(canAssign ? '/api/users?limit=100' : null);
  const { data: rolesData } = useSWR<RoleOption[] | { data: RoleOption[] }>(canAssign ? '/api/roles' : null);

  const users = usersData?.data ?? [];
  const rolesRaw = Array.isArray(rolesData) ? rolesData : rolesData?.data ?? [];
  const roles: RoleOption[] = (rolesRaw as Array<RoleOption | { value?: string; label?: string; name?: string }>).map((r) => ({
    value: (r as RoleOption).value ?? (r as { name?: string }).name ?? '',
    label: (r as RoleOption).label ?? (r as { name?: string }).name ?? (r as RoleOption).value ?? '',
  })).filter((r) => r.value);

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<AssigneeType>('USER');
  const [formUser, setFormUser] = useState('');
  const [formRole, setFormRole] = useState('');
  const [permView, setPermView] = useState(true);
  const [permControl, setPermControl] = useState(false);
  const [permConfigure, setPermConfigure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setFormType('USER');
    setFormUser('');
    setFormRole('');
    setPermView(true);
    setPermControl(false);
    setPermConfigure(false);
    setError(null);
    setShowForm(false);
  }

  async function handleCreate() {
    setError(null);
    const body: Record<string, unknown> = {
      entityId,
      assigneeType: formType,
      permissions: { view: permView, control: permControl, configure: permConfigure },
    };
    if (formType === 'USER') {
      if (!formUser) { setError('Pick a user'); return; }
      body.userId = formUser;
    } else {
      if (!formRole) { setError('Pick a role'); return; }
      body.roleValue = formRole;
    }
    setSubmitting(true);
    try {
      await apiClient.post('/api/entity-assignments', body);
      await mutate();
      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create assignment';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this assignment?')) return;
    try {
      await apiClient.delete(`/api/entity-assignments/${id}`);
      await mutate();
    } catch (err) {
      console.error('[entity-assignments] delete failed:', err);
    }
  }

  const list = assignments ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">Entity Assignments</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Control which users or roles have access to this entity.
            Operators only see entities they (or their role) are assigned to.
          </p>
        </div>
        {canAssign && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>+ Assign</Button>
        )}
      </div>

      {showForm && (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex gap-3 items-center">
            <label className="text-sm text-slate-600">Assignee type</label>
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value as AssigneeType)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="USER">User</option>
              <option value="ROLE">Role</option>
            </select>
          </div>

          {formType === 'USER' && (
            <select
              value={formUser}
              onChange={(e) => setFormUser(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">— select user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>
              ))}
            </select>
          )}
          {formType === 'ROLE' && (
            <select
              value={formRole}
              onChange={(e) => setFormRole(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">— select role —</option>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          )}

          <div className="flex gap-4 items-center text-sm">
            <span className="text-slate-600">Permissions:</span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={permView} onChange={(e) => setPermView(e.target.checked)} />
              <span>view</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={permControl} onChange={(e) => setPermControl(e.target.checked)} />
              <span>control</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={permConfigure} onChange={(e) => setPermConfigure(e.target.checked)} />
              <span>configure</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Assigning…' : 'Save'}
            </Button>
            <Button size="sm" variant="outline" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading assignments…</p>
      ) : list.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No assignments yet. {canAssign ? 'Click + Assign to grant access.' : 'Ask an admin to grant access.'}
        </div>
      ) : (
        <div className="rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Assignee</th>
                <th className="px-3 py-2 text-left">Permissions</th>
                <th className="px-3 py-2 text-left">Assigned</th>
                {canAssign && <th className="px-3 py-2 w-20"></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const p = a.permissions ?? {};
                const grants: string[] = [];
                if (p.view) grants.push('view');
                if (p.control) grants.push('control');
                if (p.configure) grants.push('configure');
                return (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-xs">{a.assigneeType}</Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-800">{a.assigneeName}</td>
                    <td className="px-3 py-2 text-slate-600">{grants.length === 0 ? '—' : grants.join(', ')}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(a.createdAt).toLocaleString()}</td>
                    {canAssign && (
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDelete(a.id)}>
                          Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
