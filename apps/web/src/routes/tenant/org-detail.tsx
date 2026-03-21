import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import { api } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';

interface OrgInfo { id: string; name: string; slug: string; description?: string; userCount: number; entityCount: number; }
interface User { id: string; username: string; fullName: string; email: string; department?: string; role: string; status: string; lastLogin?: string; }
interface Entity { id: string; name: string; status: string; templateId: string; template: { name: string }; source?: string; }
interface Template { id: string; name: string; category: string; instanceCount: number; assignmentId?: string; }

function UsersTab({ orgId }: { orgId: string }) {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: '', fullName: '', email: '', password: '', role: 'OPERATOR', department: '' });
  const { data, mutate } = useSWR<{ data: User[]; total: number }>(`/api/tenant/organizations/${orgId}/users?limit=50${search ? `&search=${search}` : ''}`);

  const addUser = async () => {
    try {
      await api.post(`/api/tenant/organizations/${orgId}/users`, form);
      setShowAdd(false);
      setForm({ username: '', fullName: '', email: '', password: '', role: 'OPERATOR', department: '' });
      mutate();
    } catch (e: any) { alert(e.message || 'Failed to create user'); }
  };

  const toggleStatus = async (userId: string, current: string) => {
    await api.put(`/api/tenant/organizations/${orgId}/users/${userId}`, { status: current === 'ENABLED' ? 'DISABLED' : 'ENABLED' });
    mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <input type="text" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} className="px-3 py-2 border rounded-lg w-64" />
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">Add User</button>
      </div>

      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Add User to Organization</h3>
          <div className="grid grid-cols-3 gap-3">
            <input placeholder="Username (min 6 chars)" value={form.username} onChange={e => setForm({...form, username: e.target.value.toUpperCase()})} className="px-3 py-2 border rounded text-sm" />
            <input placeholder="Full Name" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} className="px-3 py-2 border rounded text-sm" />
            <input placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="px-3 py-2 border rounded text-sm" />
            <input placeholder="Password (min 8 chars)" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="px-3 py-2 border rounded text-sm" />
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="px-3 py-2 border rounded text-sm">
              <option value="ORG_ADMIN">Org Admin</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="OPERATOR">Operator</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <input placeholder="Department" value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="px-3 py-2 border rounded text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={addUser} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">Create</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className="px-4 py-2 text-left">User</th><th className="px-4 py-2 text-left">Role</th>
          <th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-left">Last Login</th>
          <th className="px-4 py-2 text-center">Actions</th>
        </tr></thead>
        <tbody className="divide-y">
          {data?.data.map(u => (
            <tr key={u.id} className="hover:bg-gray-50">
              <td className="px-4 py-2"><div className="font-medium">{u.fullName}</div><div className="text-xs text-gray-400">{u.username} &middot; {u.email}</div></td>
              <td className="px-4 py-2"><span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">{u.role}</span></td>
              <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${u.status === 'ENABLED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{u.status}</span></td>
              <td className="px-4 py-2 text-xs text-gray-500">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never'}</td>
              <td className="px-4 py-2 text-center">
                <button onClick={() => toggleStatus(u.id, u.status)} className="px-2 py-1 text-xs border rounded hover:bg-gray-100">
                  {u.status === 'ENABLED' ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>
          ))}
          {data?.data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No users in this organization</td></tr>}
        </tbody>
      </table>
      {data && <div className="text-sm text-gray-500">Total: {data.total} users</div>}
    </div>
  );
}

function EntitiesTab({ orgId }: { orgId: string }) {
  const [showAssign, setShowAssign] = useState(false);
  const { data, mutate } = useSWR<{ data: Entity[]; total: number }>(`/api/tenant/organizations/${orgId}/entities`);
  const { data: allEntities } = useSWR<{ data: Entity[] }>(showAssign ? '/api/assets/instances?limit=200' : null);

  const assignEntity = async (entityId: string) => {
    try {
      await api.post(`/api/tenant/organizations/${orgId}/entities`, { entityId });
      mutate();
    } catch (e: any) { alert(e.message || 'Failed'); }
  };

  const unassign = async (entityId: string) => {
    await api.delete(`/api/tenant/organizations/${orgId}/entities/${entityId}`);
    mutate();
  };

  const assignedIds = new Set(data?.data.map(e => e.id) || []);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">{data?.total || 0} entities assigned</span>
        <button onClick={() => setShowAssign(!showAssign)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
          {showAssign ? 'Done' : 'Assign Entity'}
        </button>
      </div>

      {showAssign && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold mb-2">Available Entities</h3>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {allEntities?.data.filter(e => !assignedIds.has(e.id)).map(e => (
              <div key={e.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                <span className="text-sm">{e.name} <span className="text-gray-400">({e.template?.name})</span></span>
                <button onClick={() => assignEntity(e.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">Assign</button>
              </div>
            ))}
            {allEntities?.data.filter(e => !assignedIds.has(e.id)).length === 0 && <p className="text-sm text-gray-400">No unassigned entities available</p>}
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className="px-4 py-2 text-left">Entity</th><th className="px-4 py-2 text-left">Template</th>
          <th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-left">Source</th>
          <th className="px-4 py-2 text-center">Actions</th>
        </tr></thead>
        <tbody className="divide-y">
          {data?.data.map(e => (
            <tr key={e.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 font-medium">{e.name}</td>
              <td className="px-4 py-2 text-gray-600">{e.template?.name}</td>
              <td className="px-4 py-2"><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{e.status}</span></td>
              <td className="px-4 py-2"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{e.source}</span></td>
              <td className="px-4 py-2 text-center">
                <button onClick={() => unassign(e.id)} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">Remove</button>
              </td>
            </tr>
          ))}
          {data?.data.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No entities assigned</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesTab({ orgId }: { orgId: string }) {
  const [showAssign, setShowAssign] = useState(false);
  const { data, mutate } = useSWR<{ data: Template[]; total: number }>(`/api/tenant/organizations/${orgId}/templates`);
  const { data: allTemplates } = useSWR<{ data: Template[] }>(showAssign ? '/api/assets/templates?limit=200' : null);

  const assignTemplate = async (templateId: string) => {
    try {
      await api.post(`/api/tenant/organizations/${orgId}/templates`, { templateId });
      mutate();
    } catch (e: any) { alert(e.message || 'Failed'); }
  };

  const unassign = async (templateId: string) => {
    await api.delete(`/api/tenant/organizations/${orgId}/templates/${templateId}`);
    mutate();
  };

  const assignedIds = new Set(data?.data.map(t => t.id) || []);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-500">{data?.total || 0} templates assigned</span>
        <button onClick={() => setShowAssign(!showAssign)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
          {showAssign ? 'Done' : 'Assign Template'}
        </button>
      </div>

      {showAssign && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold mb-2">Available Templates</h3>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {allTemplates?.data.filter(t => !assignedIds.has(t.id)).map(t => (
              <div key={t.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                <span className="text-sm">{t.name} <span className="text-gray-400">({t.category})</span></span>
                <button onClick={() => assignTemplate(t.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">Assign</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className="px-4 py-2 text-left">Template</th><th className="px-4 py-2 text-left">Category</th>
          <th className="px-4 py-2 text-center">Instances</th><th className="px-4 py-2 text-center">Actions</th>
        </tr></thead>
        <tbody className="divide-y">
          {data?.data.map(t => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 font-medium">{t.name}</td>
              <td className="px-4 py-2 text-gray-600">{t.category}</td>
              <td className="px-4 py-2 text-center">{t.instanceCount}</td>
              <td className="px-4 py-2 text-center">
                <button onClick={() => unassign(t.id)} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50">Remove</button>
              </td>
            </tr>
          ))}
          {data?.data.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No templates assigned</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function UserAssignmentsTab({ orgId }: { orgId: string }) {
  const [selectedUser, setSelectedUser] = useState('');
  const [showAssignEntity, setShowAssignEntity] = useState(false);
  const [showAssignTemplate, setShowAssignTemplate] = useState(false);
  const { data: users } = useSWR<{ data: User[] }>(`/api/tenant/organizations/${orgId}/users?limit=100`);
  const { data: userEntities, mutate } = useSWR(selectedUser ? `/api/tenant/organizations/${orgId}/users/${selectedUser}/entities` : null);
  const { data: visibleEntities } = useSWR(selectedUser ? `/api/tenant/organizations/${orgId}/users/${selectedUser}/visible-entities` : null);
  const { data: allEntities } = useSWR<{ data: Entity[] }>(showAssignEntity ? '/api/assets/instances?limit=200' : null);
  const { data: allTemplates } = useSWR<{ data: Template[] }>(showAssignTemplate ? '/api/assets/templates?limit=200' : null);

  const assignEntity = async (entityId: string) => {
    await api.post(`/api/tenant/organizations/${orgId}/users/${selectedUser}/entities`, { entityId });
    mutate();
  };

  const assignTemplate = async (templateId: string) => {
    await api.post(`/api/tenant/organizations/${orgId}/users/${selectedUser}/templates`, { templateId });
    mutate();
  };

  const removeAssignment = async (assignmentId: string) => {
    await api.delete(`/api/tenant/organizations/${orgId}/users/${selectedUser}/entities/${assignmentId}`);
    mutate();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium">Select User:</label>
        <select value={selectedUser} onChange={e => { setSelectedUser(e.target.value); setShowAssignEntity(false); setShowAssignTemplate(false); }} className="px-3 py-2 border rounded-lg w-64">
          <option value="">-- Choose a user --</option>
          {users?.data.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>)}
        </select>
      </div>

      {selectedUser && (
        <>
          <div className="flex gap-2">
            <button onClick={() => { setShowAssignEntity(!showAssignEntity); setShowAssignTemplate(false); }} className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">
              {showAssignEntity ? 'Done' : 'Assign Entity'}
            </button>
            <button onClick={() => { setShowAssignTemplate(!showAssignTemplate); setShowAssignEntity(false); }} className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700">
              {showAssignTemplate ? 'Done' : 'Assign Template'}
            </button>
          </div>

          {showAssignEntity && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2">Assign Entity to User</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {allEntities?.data.map(e => (
                  <div key={e.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                    <span className="text-sm">{e.name}</span>
                    <button onClick={() => assignEntity(e.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded">Assign</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showAssignTemplate && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2">Assign Template to User</h3>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {allTemplates?.data.map(t => (
                  <div key={t.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                    <span className="text-sm">{t.name} ({t.category})</span>
                    <button onClick={() => assignTemplate(t.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded">Assign</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="font-semibold mb-2">Individually Assigned</h3>
            <div className="space-y-1">
              {userEntities?.entities?.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                  <span className="text-sm">{e.name} <span className="text-gray-400">({e.template?.name}) [{e.source}]</span></span>
                </div>
              ))}
              {(!userEntities?.entities || userEntities.entities.length === 0) && <p className="text-sm text-gray-400">No individual assignments</p>}
            </div>
          </div>

          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-green-800">All Visible Entities (org + template + individual)</h3>
            <div className="space-y-1">
              {(visibleEntities as any)?.data?.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                  <span className="text-sm">{e.name} <span className="text-gray-400">({e.template?.name})</span></span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    e.source === 'org_entity' ? 'bg-blue-100 text-blue-700' :
                    e.source === 'org_template' ? 'bg-purple-100 text-purple-700' :
                    e.source === 'user_entity' ? 'bg-orange-100 text-orange-700' :
                    e.source === 'user_template' ? 'bg-pink-100 text-pink-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>{e.source}</span>
                </div>
              ))}
              {(!(visibleEntities as any)?.data || (visibleEntities as any)?.data?.length === 0) && <p className="text-sm text-gray-400">No entities visible</p>}
            </div>
            <div className="mt-2 text-xs text-green-600">Total: {(visibleEntities as any)?.total || 0} entities</div>
          </div>
        </>
      )}
    </div>
  );
}

export default function OrgDetailPage() {
  const { id: orgId } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'users' | 'entities' | 'templates' | 'assignments'>('users');
  const { data: org } = useSWR<OrgInfo>(orgId ? `/api/tenant/organizations/${orgId}` : null);

  if (!orgId) return <div className="p-6">Invalid organization</div>;

  const tabs = [
    { key: 'users' as const, label: 'Users', count: org?.userCount },
    { key: 'entities' as const, label: 'Entities', count: org?.entityCount },
    { key: 'templates' as const, label: 'Templates' },
    { key: 'assignments' as const, label: 'User Assignments' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/tenant/organizations" className="text-indigo-600 hover:text-indigo-800">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{org?.name || 'Loading...'}</h1>
          <p className="text-gray-500">{org?.description || org?.slug}</p>
        </div>
        <div className="ml-auto flex gap-4 text-sm">
          <div className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg">{org?.userCount || 0} Users</div>
          <div className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg">{org?.entityCount || 0} Entities</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-0">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label} {t.count !== undefined && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-white border rounded-lg p-6">
        {tab === 'users' && <UsersTab orgId={orgId} />}
        {tab === 'entities' && <EntitiesTab orgId={orgId} />}
        {tab === 'templates' && <TemplatesTab orgId={orgId} />}
        {tab === 'assignments' && <UserAssignmentsTab orgId={orgId} />}
      </div>
    </div>
  );
}
