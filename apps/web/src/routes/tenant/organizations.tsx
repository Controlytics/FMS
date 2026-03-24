import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useSWR from "swr";
import { api } from "../../lib/api-client";
import { useAuth } from "../../hooks/use-auth";

interface Org {
  id: string; name: string; slug: string; description?: string;
  isActive: boolean; userCount: number; entityCount: number;
  createdAt: string;
}

export default function OrganizationsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; userCount: number } | null>(null);
  const [editOrg, setEditOrg] = useState<{ id: string; name: string; slug: string; description: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const navigate = useNavigate();

  const { data, mutate } = useSWR<{ data: Org[]; total: number }>(
    `/api/organizations?page=1&limit=100${search ? `&search=${search}` : ""}`
  );

  const createOrg = async () => {
    try {
      await api.post("/api/organizations", form);
      setShowCreate(false);
      setForm({ name: "", slug: "", description: "" });
      mutate();
    } catch (e: any) { alert(e.message || "Failed to create organization"); }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/api/organizations/${id}`, { isActive: !isActive });
    mutate();
  };

  const deleteOrg = async (id: string, permanent: boolean) => {
    try {
      if (permanent) {
        await api.delete(`/api/organizations/${id}?permanent=true`);
      } else {
        await api.delete(`/api/organizations/${id}`);
      }
      setDeleteConfirm(null);
      mutate();
    } catch (e: any) { alert(e.message || "Failed to delete"); }
  };

  const updateOrg = async () => {
    if (!editOrg) return;
    try {
      await api.put(`/api/organizations/${editOrg.id}`, { name: editOrg.name, description: editOrg.description });
      setEditOrg(null);
      mutate();
    } catch (e: any) { alert(e.message || "Failed to update"); }
  };

  const allowed = ["SUPER_ADMIN", "ADMIN"].includes(user?.role || "");
  if (!allowed) return <div className="p-6">Access denied</div>;

  const filteredOrgs = data?.data?.filter(o => {
    if (statusFilter === "active") return o.isActive;
    if (statusFilter === "inactive") return !o.isActive;
    return true;
  }) || [];

  const activeCount = data?.data?.filter(o => o.isActive).length || 0;
  const inactiveCount = data?.data?.filter(o => !o.isActive).length || 0;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Organizations</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage organizations and their access</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25 transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
          Create Organization
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{data?.total || 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-100"><svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-emerald-200/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Active</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{activeCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50"><svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-red-200/60 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-red-600 uppercase tracking-wider">Inactive</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{inactiveCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-red-50"><svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg></div>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input type="text" placeholder="Search organizations..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400" />
        </div>
        <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden">
          {(["all", "active", "inactive"] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${statusFilter === f ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-100">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-800">New Organization</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input placeholder="Organization name" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Slug <span className="text-red-500">*</span></label>
              <input placeholder="url-safe-slug" value={form.slug} onChange={e => setForm({...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")})}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <input placeholder="Brief description (optional)" value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowCreate(false)} className="px-5 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
            <button onClick={createOrg} disabled={!form.name || !form.slug}
              className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm">Create</button>
          </div>
        </div>
      )}

      {/* Organizations Table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-slate-50 to-slate-100/50 border-b border-slate-200/60">
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Organization</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Users</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Entities</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrgs.map(o => (
              <tr key={o.id} className="hover:bg-slate-50/50 cursor-pointer transition-colors" onClick={() => navigate(`/organizations/${o.id}`)}>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm ${o.isActive ? "bg-gradient-to-br from-indigo-500 to-purple-600" : "bg-gradient-to-br from-slate-400 to-slate-500"}`}>
                      {o.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">{o.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{o.slug}{o.description ? ` \u2014 ${o.description}` : ""}</div>
                    </div>
                  </div>
                </td>
                {isSuperAdmin && (
                  <td className="px-5 py-4">
                    <span className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">{o.tenant?.name || "N/A"}</span>
                  </td>
                )}
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-700 text-sm font-semibold">{o.userCount}</span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold">{o.entityCount}</span>
                </td>
                <td className="px-5 py-4 text-center">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${o.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${o.isActive ? "bg-emerald-500" : "bg-red-500"}`}></span>
                    {o.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-5 py-4 text-center" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-center gap-1.5">
                    <button onClick={() => toggleActive(o.id, o.isActive)} title={o.isActive ? "Deactivate" : "Activate"}
                      className={`p-2 rounded-lg transition-colors ${o.isActive ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"}`}>
                      {o.isActive ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      )}
                    </button>
                    <button onClick={() => setEditOrg({ id: o.id, name: o.name, slug: o.slug, description: o.description || "" })} title="Edit"
                      className="p-2 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => setDeleteConfirm({ id: o.id, name: o.name, userCount: o.userCount })} title="Delete"
                      className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredOrgs.length === 0 && (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
            <p className="text-slate-500 font-medium">No organizations found</p>
            <p className="text-sm text-slate-400 mt-1">Try adjusting your search or filter</p>
          </div>
        )}
        {data && filteredOrgs.length > 0 && (
          <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 text-sm text-slate-500">
            Showing {filteredOrgs.length} of {data.total} organizations
          </div>
        )}
      </div>

      {/* Edit Organization Dialog */}
      {editOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setEditOrg(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5 mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-blue-100">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Edit Organization</h3>
                <p className="text-sm text-slate-500">Update organization details</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Name</label>
                <input value={editOrg.name} onChange={e => setEditOrg({...editOrg, name: e.target.value})}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Slug</label>
                <input value={editOrg.slug} disabled
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50 text-slate-500 font-mono" />
                <p className="text-xs text-slate-400 mt-1">Slug cannot be changed after creation</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
                <input value={editOrg.description} onChange={e => setEditOrg({...editOrg, description: e.target.value})} placeholder="Brief description (optional)"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditOrg(null)} className="px-5 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
              <button onClick={updateOrg} disabled={!editOrg.name}
                className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 shadow-sm">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-red-100">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Delete Organization</h3>
                <p className="text-sm text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-sm text-slate-700">Are you sure you want to delete <span className="font-semibold">{deleteConfirm.name}</span>?</p>
              {deleteConfirm.userCount > 0 && (
                <p className="text-sm text-amber-700 mt-2 flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  This organization has {deleteConfirm.userCount} user(s). They will be unassigned and available for reassignment.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
              <button onClick={() => deleteOrg(deleteConfirm.id, true)}
                className="px-4 py-2.5 text-sm font-medium bg-red-600 text-white rounded-xl hover:bg-red-700 shadow-sm">Delete Organization</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
