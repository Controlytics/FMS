import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

interface ReportTemplate {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  currentVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse {
  data: ReportTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_BADGES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Active' },
  DRAFT: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Draft' },
  ARCHIVED: { bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-400', label: 'Archived' },
};

export function ReportTemplateListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canCreate = isSuperAdmin || perms.includes('REPORT_TEMPLATE_CREATE');
  const canUpdate = isSuperAdmin || perms.includes('REPORT_TEMPLATE_UPDATE');
  const canDelete = isSuperAdmin || perms.includes('REPORT_TEMPLATE_DELETE');
  const reauth = useReauth();

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const swrKey = `/api/report-templates?page=${page}&limit=20${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const { data, isLoading } = useSWR<PaginatedResponse>(swrKey);

  const templates = data?.data ?? [];

  const toggleStatus = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    reauth.execute('UPDATE_REPORT_TEMPLATE', async (password?: string) => {
      try {
        if (password) await apiClient.patchWithReauth(`/api/report-templates/${id}/toggle-status`, {}, password);
        else await apiClient.patch(`/api/report-templates/${id}/toggle-status`, {});
        mutate(swrKey);
        toast.success('Status updated');
      } catch (err: any) {
        toast.error('Error', err.message || 'Failed to toggle status');
        throw err;
      }
    });
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    reauth.execute('CREATE_REPORT_TEMPLATE', async (password?: string) => {
      setCreating(true);
      try {
        const defaultConfig = {
          pageSettings: { size: 'A4', orientation: 'portrait', margins: { top: 20, right: 15, bottom: 20, left: 15 } },
          header: { enabled: true, height: 80, elements: [] },
          footer: { enabled: true, height: 40, elements: [] },
          entitySlots: [],
          sections: [],
          signatureConfig: { required: false, meaning: '', signers: [] },
        };
        if (password) await apiClient.postWithReauth('/api/report-templates', { name: newName.trim(), description: newDescription.trim() || undefined, config: defaultConfig }, password);
        else await apiClient.post('/api/report-templates', { name: newName.trim(), description: newDescription.trim() || undefined, config: defaultConfig });
        mutate(swrKey);
        setShowCreateDialog(false);
        setNewName('');
        setNewDescription('');
        toast.success('Template created');
      } catch (err: any) {
        toast.error('Error', err.message || 'Failed to create template');
        throw err;
      } finally {
        setCreating(false);
      }
    });
  };

  const handleDelete = (id: string) => {
    reauth.execute('DELETE_REPORT_TEMPLATE', async (password?: string) => {
      try {
        if (password) await apiClient.deleteWithReauth(`/api/report-templates/${id}`, password);
        else await apiClient.delete(`/api/report-templates/${id}`);
        mutate(swrKey);
        setDeleteConfirm(null);
        toast.success('Template deleted');
      } catch (err: any) {
        toast.error('Error', err.message || 'Failed to delete template');
        throw err;
      }
    });
  };

  const handleDuplicate = (id: string, originalName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const dupName = `${originalName} (Copy)`;
    reauth.execute('CREATE_REPORT_TEMPLATE', async (password?: string) => {
      try {
        if (password) await apiClient.postWithReauth(`/api/report-templates/${id}/duplicate`, { name: dupName }, password);
        else await apiClient.post(`/api/report-templates/${id}/duplicate`, { name: dupName });
        mutate(swrKey);
        toast.success('Template duplicated');
      } catch (err: any) {
        toast.error('Error', err.message || 'Failed to duplicate template');
        throw err;
      }
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Report Templates</h1>
          <p className="text-sm text-slate-500 mt-1">Design reusable report layouts with variable tags and formatting</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreateDialog(true)}
            className="px-5 py-2.5 text-white rounded-xl transition-all text-sm font-semibold shadow-lg flex items-center gap-2"
            style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Template
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-4 text-white shadow-lg" style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
          <div className="text-2xl font-bold">{data?.total ?? 0}</div>
          <div className="text-white/80 text-sm font-medium">Total Templates</div>
        </div>
        {(['ACTIVE', 'DRAFT', 'ARCHIVED'] as const).map(s => {
          const badge = STATUS_BADGES[s];
          return (
            <div key={s} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${badge.bg} flex items-center justify-center`}>
                  <span className={`w-3 h-3 rounded-full ${badge.dot}`} />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-800">
                    {templates.filter(t => !status ? t.status === s : true).length}
                  </div>
                  <div className="text-xs text-slate-400">{badge.label}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'color-mix(in srgb, var(--theme-primary) 20%, transparent)' } as React.CSSProperties}
            onFocus={e => e.currentTarget.style.borderColor = 'var(--theme-primary-light)'}
            onBlur={e => e.currentTarget.style.borderColor = ''}
            placeholder="Search templates..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[
            { key: '', label: 'All' },
            { key: 'ACTIVE', label: 'Active' },
            { key: 'DRAFT', label: 'Draft' },
            { key: 'ARCHIVED', label: 'Archived' },
          ].map(s => (
            <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${status === s.key
                ? 'bg-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700'}`}
              style={status === s.key ? { color: 'var(--theme-primary)' } : undefined}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <p className="text-slate-500 font-medium">{search ? 'No templates match your search' : 'No report templates yet'}</p>
          {canCreate && !search && (
            <button onClick={() => setShowCreateDialog(true)} className="mt-3 text-sm font-medium" style={{ color: 'var(--theme-primary)' }}>
              Create your first template
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Version</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created By</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Updated</th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {templates.map(t => {
                const badge = STATUS_BADGES[t.status] ?? STATUS_BADGES.DRAFT;
                return (
                  <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-800 text-sm">{t.name}</div>
                      {t.description && <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{t.description}</div>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${badge.bg} ${badge.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-slate-600">v{t.currentVersion}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-slate-600">{t.createdBy}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-sm text-slate-500">{new Date(t.updatedAt).toLocaleDateString()}</span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Toggle status */}
                        {canUpdate && t.status !== 'DRAFT' && (
                          <button onClick={(e) => toggleStatus(t.id, e)}
                            className={`relative w-10 h-5.5 rounded-full transition-colors duration-200 ${t.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300'}`}
                            title={t.status === 'ACTIVE' ? 'Archive' : 'Activate'}>
                            <span className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow-md transition-transform duration-200 ${t.status === 'ACTIVE' ? 'translate-x-4.5' : 'translate-x-0'}`} />
                          </button>
                        )}
                        {/* Edit */}
                        {canUpdate && (
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/report-templates/${t.id}/edit`); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Edit">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                        )}
                        {/* Duplicate */}
                        {canCreate && (
                          <button onClick={(e) => handleDuplicate(t.id, t.name, e)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Duplicate">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          </button>
                        )}
                        {/* Delete */}
                        {canDelete && (
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(t.id); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Previous
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(data?.totalPages ?? 1, 5) }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${page === p ? 'text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                style={page === p ? { backgroundColor: 'var(--theme-primary)' } : undefined}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={() => setPage(p => Math.min(data?.totalPages ?? 1, p + 1))} disabled={page === (data?.totalPages ?? 1)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Next
          </button>
        </div>
      )}

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Create Report Template</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Template Name</label>
                <input className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2"
                  style={{ '--tw-ring-color': 'color-mix(in srgb, var(--theme-primary) 20%, transparent)' } as React.CSSProperties}
                  placeholder="e.g. Monthly Filter Report" value={newName} onChange={e => setNewName(e.target.value)}
                  autoFocus onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</label>
                <textarea className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 resize-none"
                  style={{ '--tw-ring-color': 'color-mix(in srgb, var(--theme-primary) 20%, transparent)' } as React.CSSProperties}
                  rows={3} placeholder="What is this report template for?" value={newDescription} onChange={e => setNewDescription(e.target.value)} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowCreateDialog(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim() || creating}
                className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-50 shadow-md"
                style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Template?</h3>
              <p className="text-sm text-slate-500">This will permanently delete the template and all its versions. This action cannot be undone.</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="px-5 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors shadow-md">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} />
    </div>
  );
}
