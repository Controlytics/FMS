import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

const STATUS_BADGES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  DRAFT: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400', label: 'Draft' },
  PENDING_SIGNATURE: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Pending Signature' },
  SIGNED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Signed' },
  REJECTED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Rejected' },
  EXPIRED: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', label: 'Expired' },
};

export function ReportListPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const reauth = useReauth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canGenerate = isSuperAdmin || perms.includes('REPORT_GENERATE');
  const canDelete = isSuperAdmin || perms.includes('REPORT_DELETE');
  const canExport = isSuperAdmin || perms.includes('REPORT_EXPORT');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const swrKey = `/api/reports?page=${page}&limit=20${status ? `&status=${status}` : ''}`;
  const { data, isLoading } = useSWR(swrKey);
  const reports = data?.data ?? [];

  const handleDelete = (id: string) => {
    reauth.execute('DELETE_REPORT', async (password?: string) => {
      try {
        if (password) await apiClient.deleteWithReauth(`/api/reports/${id}`, password);
        else await apiClient.delete(`/api/reports/${id}`);
        mutate(swrKey);
        setDeleteConfirm(null);
        toast.success('Report deleted');
      } catch (err: any) {
        toast.error('Error', err.message || 'Failed to delete');
        throw err;
      }
    });
  };

  const downloadPdf = async (id: string, name: string) => {
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token_backup');
      const res = await fetch(`/api/reports/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Download failed', err.message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Generated Reports</h1>
          <p className="text-sm text-slate-500 mt-1">View and manage generated report instances</p>
        </div>
        {canGenerate && (
          <button onClick={() => navigate('/reports/generate')}
            className="px-5 py-2.5 text-white rounded-xl transition-all text-sm font-semibold shadow-lg flex items-center gap-2"
            style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Generate Report
          </button>
        )}
      </div>

      {/* Status Filters */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {[
          { key: '', label: 'All' },
          { key: 'DRAFT', label: 'Draft' },
          { key: 'PENDING_SIGNATURE', label: 'Pending' },
          { key: 'SIGNED', label: 'Signed' },
          { key: 'REJECTED', label: 'Rejected' },
        ].map(s => (
          <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${status === s.key ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            style={status === s.key ? { color: 'var(--theme-primary)' } : undefined}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-slate-500 font-medium">No reports found</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Report Name</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Template</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Generated By</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="text-right px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {reports.map((r: any) => {
                const badge = STATUS_BADGES[r.status] ?? STATUS_BADGES.DRAFT;
                return (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer" onClick={() => navigate(`/reports/${r.id}`)}>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-800 text-sm">{r.name}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{r.template?.name ?? '-'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${badge.bg} ${badge.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">{r.generator?.fullName ?? r.generator?.username ?? '-'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500">{new Date(r.generatedAt).toLocaleDateString()}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        {canExport && (
                          <button onClick={() => downloadPdf(r.id, r.name)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Download PDF">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => setDeleteConfirm(r.id)}
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
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            Previous
          </button>
          <span className="text-sm text-slate-500">Page {page} of {data?.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(data?.totalPages ?? 1, p + 1))} disabled={page === (data?.totalPages ?? 1)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            Next
          </button>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Report?</h3>
              <p className="text-sm text-slate-500">This will permanently delete the report and its PDF.</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-5 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl shadow-md">Delete</button>
            </div>
          </div>
        </div>
      )}

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} />
    </div>
  );
}
