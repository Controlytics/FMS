import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import useSWR from 'swr';
import { api } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { UserListPage } from '../users/list';

interface OrgInfo { id: string; name: string; slug: string; description?: string; userCount: number; entityCount: number; }
interface User { id: string; username: string; fullName: string; email: string; department?: string; role: string; status: string; lastLogin?: string; }
interface Entity { id: string; name: string; status: string; templateId: string; template: { name: string }; source?: string; }
interface Template { id: string; name: string; category: string; instanceCount: number; assignmentId?: string; }

function UsersTab({ orgId }: { orgId: string }) {
  return <UserListPage orgId={orgId} />;
}

function EntitiesTab({ orgId }: { orgId: string }) {
  const [showAssign, setShowAssign] = useState(false);
  const [search, setSearch] = useState('');
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
  const availableEntities = allEntities?.data.filter(e => !assignedIds.has(e.id)).filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase())) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Assigned Entities</h3>
            <p className="text-sm text-slate-500">{data?.total || 0} entities linked to this organization</p>
          </div>
        </div>
        <button onClick={() => setShowAssign(!showAssign)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-sm ${showAssign ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 shadow-emerald-500/25'}`}>
          {showAssign ? (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Done</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>Assign Entity</>
          )}
        </button>
      </div>

      {showAssign && (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 overflow-hidden">
          <div className="px-5 py-4 border-b border-emerald-200/60">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-emerald-900">Available Entities</h4>
              <span className="text-xs text-emerald-600 bg-emerald-100 px-2.5 py-1 rounded-full">{availableEntities.length} available</span>
            </div>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" placeholder="Search entities..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-3 space-y-1.5">
            {availableEntities.map(e => (
              <div key={e.id} className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-slate-100 hover:border-emerald-200 hover:shadow-sm transition-all">
                <div><span className="text-sm font-medium text-slate-800">{e.name}</span><span className="text-xs text-slate-400 ml-2">{e.template?.name}</span></div>
                <button onClick={() => assignEntity(e.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>Assign
                </button>
              </div>
            ))}
            {availableEntities.length === 0 && (
              <div className="text-center py-8">
                <svg className="w-10 h-10 text-emerald-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-emerald-600">All entities have been assigned</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/60 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-slate-50 to-slate-100/50">
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Entity</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Template</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Source</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.data.map(e => (
              <tr key={e.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                    </div>
                    <span className="font-medium text-slate-800">{e.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-slate-600">{e.template?.name}</td>
                <td className="px-5 py-3.5 text-center"><span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>{e.status}</span></td>
                <td className="px-5 py-3.5 text-center"><span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">{e.source || 'direct'}</span></td>
                <td className="px-5 py-3.5 text-center">
                  <button onClick={() => unassign(e.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!data?.data || data.data.length === 0) && (
          <div className="text-center py-16 bg-slate-50/30">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
            <p className="text-slate-500 font-medium">No entities assigned</p>
            <p className="text-sm text-slate-400 mt-1">Click "Assign Entity" to link entities to this organization</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplatesTab({ orgId }: { orgId: string }) {
  const [showAssign, setShowAssign] = useState(false);
  const [search, setSearch] = useState('');
  const { data, mutate } = useSWR<{ data: Template[]; total: number }>(`/api/tenant/organizations/${orgId}/templates`);
  const { data: allTemplates } = useSWR<{ data: Template[] }>(showAssign ? '/api/assets/templates?limit=200' : null);

  const assignTemplate = async (templateId: string) => {
    try { await api.post(`/api/tenant/organizations/${orgId}/templates`, { templateId }); mutate(); } catch (e: any) { alert(e.message || 'Failed'); }
  };
  const unassign = async (templateId: string) => { await api.delete(`/api/tenant/organizations/${orgId}/templates/${templateId}`); mutate(); };

  const assignedIds = new Set(data?.data.map(t => t.id) || []);
  const availableTemplates = allTemplates?.data.filter(t => !assignedIds.has(t.id)).filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase())) || [];

  const groupedTemplates: Record<string, Template[]> = {};
  data?.data.forEach(t => { if (!groupedTemplates[t.category]) groupedTemplates[t.category] = []; groupedTemplates[t.category].push(t); });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Assigned Templates</h3>
            <p className="text-sm text-slate-500">{data?.total || 0} templates linked to this organization</p>
          </div>
        </div>
        <button onClick={() => setShowAssign(!showAssign)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-sm ${showAssign ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 shadow-violet-500/25'}`}>
          {showAssign ? (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Done</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>Assign Template</>
          )}
        </button>
      </div>

      {showAssign && (
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 overflow-hidden">
          <div className="px-5 py-4 border-b border-violet-200/60">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-violet-900">Available Templates</h4>
              <span className="text-xs text-violet-600 bg-violet-100 px-2.5 py-1 rounded-full">{availableTemplates.length} available</span>
            </div>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-violet-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-3 space-y-1.5">
            {availableTemplates.map(t => (
              <div key={t.id} className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-slate-100 hover:border-violet-200 hover:shadow-sm transition-all">
                <div><span className="text-sm font-medium text-slate-800">{t.name}</span><span className="ml-2 px-2 py-0.5 bg-violet-50 text-violet-600 rounded text-xs">{t.category}</span></div>
                <button onClick={() => assignTemplate(t.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>Assign
                </button>
              </div>
            ))}
            {availableTemplates.length === 0 && (
              <div className="text-center py-8">
                <svg className="w-10 h-10 text-violet-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-sm text-violet-600">All templates have been assigned</p>
              </div>
            )}
          </div>
        </div>
      )}

      {data?.data && data.data.length > 0 ? (
        <div className="space-y-5">
          {Object.entries(groupedTemplates).map(([category, templates]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-3 py-1 bg-violet-100 text-violet-700 rounded-full text-xs font-semibold uppercase tracking-wider">{category}</span>
                <div className="flex-1 h-px bg-slate-200"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {templates.map(t => (
                  <div key={t.id} className="group relative bg-white rounded-xl border border-slate-200/60 p-4 hover:border-violet-200 hover:shadow-md transition-all duration-200">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
                          <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" /></svg>
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{t.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{t.instanceCount} instance{t.instanceCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <button onClick={() => unassign(t.id)} className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="Remove">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
          <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" /></svg>
          <p className="text-slate-500 font-medium">No templates assigned</p>
          <p className="text-sm text-slate-400 mt-1">Click "Assign Template" to link templates to this organization</p>
        </div>
      )}
    </div>
  );
}

function UserAssignmentsTab({ orgId }: { orgId: string }) {
  const [selectedUser, setSelectedUser] = useState('');
  const [showAssignEntity, setShowAssignEntity] = useState(false);
  const [showAssignTemplate, setShowAssignTemplate] = useState(false);
  const [entitySearch, setEntitySearch] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const { data: users } = useSWR<{ data: User[] }>(`/api/tenant/organizations/${orgId}/users?limit=100`);
  const { data: userEntities, mutate } = useSWR(selectedUser ? `/api/tenant/organizations/${orgId}/users/${selectedUser}/entities` : null);
  const { data: visibleEntities } = useSWR(selectedUser ? `/api/tenant/organizations/${orgId}/users/${selectedUser}/visible-entities` : null);
  const { data: allEntities } = useSWR<{ data: Entity[] }>(showAssignEntity ? '/api/assets/instances?limit=200' : null);
  const { data: allTemplates } = useSWR<{ data: Template[] }>(showAssignTemplate ? '/api/assets/templates?limit=200' : null);

  const selectedUserData = users?.data.find(u => u.id === selectedUser);

  const assignEntity = async (entityId: string) => { await api.post(`/api/tenant/organizations/${orgId}/users/${selectedUser}/entities`, { entityId }); mutate(); };
  const assignTemplate = async (templateId: string) => { await api.post(`/api/tenant/organizations/${orgId}/users/${selectedUser}/templates`, { templateId }); mutate(); };
  const removeAssignment = async (assignmentId: string) => { await api.delete(`/api/tenant/organizations/${orgId}/users/${selectedUser}/entities/${assignmentId}`); mutate(); };

  const sourceColors: Record<string, { bg: string; text: string; dot: string; label: string }> = {
    org_entity: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Org Entity' },
    org_template: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500', label: 'Org Template' },
    user_entity: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'User Entity' },
    user_template: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500', label: 'User Template' },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">User-Level Assignments</h3>
          <p className="text-sm text-slate-500">Assign entities and templates to individual users</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-gradient-to-r from-slate-50 to-white p-5">
        <label className="block text-sm font-semibold text-slate-700 mb-2">Select a User</label>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          <select value={selectedUser} onChange={e => { setSelectedUser(e.target.value); setShowAssignEntity(false); setShowAssignTemplate(false); }}
            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400">
            <option value="">-- Choose a user to manage assignments --</option>
            {users?.data.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.username}) - {u.role}</option>)}
          </select>
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>

      {selectedUser && selectedUserData && (
        <>
          <div className="rounded-2xl border border-slate-200/60 bg-white p-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-amber-700 font-bold text-lg">{selectedUserData.fullName.charAt(0)}</div>
                <div>
                  <h4 className="font-semibold text-slate-800">{selectedUserData.fullName}</h4>
                  <p className="text-sm text-slate-500">{selectedUserData.username} &middot; {selectedUserData.email}</p>
                </div>
                <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-semibold">{selectedUserData.role}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowAssignEntity(!showAssignEntity); setShowAssignTemplate(false); }}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${showAssignEntity ? 'bg-slate-100 text-slate-700' : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/25'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                  {showAssignEntity ? 'Close' : 'Assign Entity'}
                </button>
                <button onClick={() => { setShowAssignTemplate(!showAssignTemplate); setShowAssignEntity(false); }}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${showAssignTemplate ? 'bg-slate-100 text-slate-700' : 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-sm shadow-violet-500/25'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" /></svg>
                  {showAssignTemplate ? 'Close' : 'Assign Template'}
                </button>
              </div>
            </div>
          </div>

          {showAssignEntity && (
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-200/60">
                <h4 className="font-semibold text-emerald-900 mb-3">Assign Entity to User</h4>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input type="text" placeholder="Search entities..." value={entitySearch} onChange={e => setEntitySearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-emerald-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto p-3 space-y-1.5">
                {allEntities?.data.filter(e => !entitySearch || e.name.toLowerCase().includes(entitySearch.toLowerCase())).map(e => (
                  <div key={e.id} className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-slate-100 hover:border-emerald-200 transition-all">
                    <span className="text-sm font-medium text-slate-800">{e.name}</span>
                    <button onClick={() => assignEntity(e.id)} className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">Assign</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showAssignTemplate && (
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 overflow-hidden">
              <div className="px-5 py-4 border-b border-violet-200/60">
                <h4 className="font-semibold text-violet-900 mb-3">Assign Template to User</h4>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input type="text" placeholder="Search templates..." value={templateSearch} onChange={e => setTemplateSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-violet-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto p-3 space-y-1.5">
                {allTemplates?.data.filter(t => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).map(t => (
                  <div key={t.id} className="flex items-center justify-between bg-white px-4 py-3 rounded-xl border border-slate-100 hover:border-violet-200 transition-all">
                    <div><span className="text-sm font-medium text-slate-800">{t.name}</span><span className="ml-2 px-2 py-0.5 bg-violet-50 text-violet-600 rounded text-xs">{t.category}</span></div>
                    <button onClick={() => assignTemplate(t.id)} className="px-3 py-1.5 text-xs font-medium bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100">Assign</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200/60 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
              <h4 className="font-semibold text-slate-800">Individual Assignments</h4>
              <p className="text-xs text-slate-500 mt-0.5">Entities and templates assigned directly to this user</p>
            </div>
            <div className="p-4">
              {userEntities?.entities && userEntities.entities.length > 0 ? (
                <div className="space-y-2">
                  {userEntities.entities.map((e: any) => (
                    <div key={e.id} className="flex items-center justify-between bg-slate-50 px-4 py-3 rounded-xl hover:bg-slate-100 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                        </div>
                        <div><span className="text-sm font-medium text-slate-800">{e.name}</span><span className="text-xs text-slate-400 ml-2">{e.template?.name}</span></div>
                      </div>
                      <span className="px-2.5 py-1 bg-amber-50 text-amber-600 rounded-full text-xs font-medium">{e.source}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-6">No individual assignments for this user</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/60 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-emerald-900">Complete Entity Access</h4>
                  <p className="text-xs text-emerald-600 mt-0.5">All entities visible to this user (organization + template + individual)</p>
                </div>
                <span className="px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-full text-sm font-semibold">{(visibleEntities as any)?.total || 0} total</span>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {(visibleEntities as any)?.data?.map((e: any) => {
                const s = sourceColors[e.source] || { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400', label: e.source };
                return (
                  <div key={e.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                        <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                      </div>
                      <div><span className="text-sm font-medium text-slate-800">{e.name}</span><span className="text-xs text-slate-400 ml-2">{e.template?.name}</span></div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${s.bg} ${s.text} rounded-full text-xs font-medium`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`}></span>{s.label}
                    </span>
                  </div>
                );
              })}
              {(!(visibleEntities as any)?.data || (visibleEntities as any)?.data?.length === 0) && (
                <div className="text-center py-10">
                  <svg className="w-10 h-10 text-slate-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  <p className="text-sm text-slate-400">No entities visible to this user</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!selectedUser && (
        <div className="text-center py-16 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
          <svg className="w-14 h-14 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <p className="text-slate-500 font-medium">Select a user to manage assignments</p>
          <p className="text-sm text-slate-400 mt-1">Choose a user from the dropdown above to view and manage their entity access</p>
        </div>
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
    { key: 'users' as const, label: 'Users', count: org?.userCount, icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg> },
    { key: 'entities' as const, label: 'Entities', count: org?.entityCount, icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg> },
    { key: 'templates' as const, label: 'Templates', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" /></svg> },
    { key: 'assignments' as const, label: 'User Assignments', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to="/tenant/organizations" className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <div className="flex items-center gap-4 flex-1">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">{org?.name || 'Loading...'}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{org?.description || org?.slug}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl">
            <div className="text-xs text-blue-500 font-medium">Users</div>
            <div className="text-lg font-bold text-blue-700">{org?.userCount || 0}</div>
          </div>
          <div className="px-4 py-2.5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/60 rounded-xl">
            <div className="text-xs text-emerald-500 font-medium">Entities</div>
            <div className="text-lg font-bold text-emerald-700">{org?.entityCount || 0}</div>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all duration-200 ${tab === t.key ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'}`}>
              {t.icon}
              {t.label}
              {t.count !== undefined && (
                <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-semibold ${tab === t.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6">
        {tab === 'users' && <UsersTab orgId={orgId} />}
        {tab === 'entities' && <EntitiesTab orgId={orgId} />}
        {tab === 'templates' && <TemplatesTab orgId={orgId} />}
        {tab === 'assignments' && <UserAssignmentsTab orgId={orgId} />}
      </div>
    </div>
  );
}
