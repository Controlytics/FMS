import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  PENDING: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  APPROVED: { label: 'Approved', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Rejected', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  EXPIRED: { label: 'Used', bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-400' },
};

export function ApprovalsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDate, formatTime } = useDatetimeFormat();
  const [filter, setFilter] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [processComment, setProcessComment] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const isApprover = user?.permissions?.includes('BLOCK_CHANGE_APPROVE');
  const swrKey = `/api/block-change-requests?page=${page}&limit=20&status=${filter}${!isApprover ? '&mine=true' : ''}`;
  const { data, isLoading } = useSWR(swrKey);
  const { data: pendingData } = useSWR(isApprover ? '/api/block-change-requests/pending-count' : null);

  const handleProcess = async (id: string, action: 'approve' | 'reject') => {
    setProcessingId(id);
    try {
      await apiClient.post(`/api/block-change-requests/${id}/${action}`, { comment: processComment || undefined });
      mutate(swrKey);
      if (isApprover) mutate('/api/block-change-requests/pending-count');
      setProcessComment('');
      toast.success(`Request ${action === 'approve' ? 'approved' : 'rejected'}`);
    } catch (e: any) {
      toast.error('Error', e.message || `Failed to ${action}`);
    }
    setProcessingId(null);
  };

  const requests = data?.data ?? [];
  const pendingCount = pendingData?.count ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/25">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Approvals</h1>
            <p className="text-sm text-slate-500">
              {isApprover ? 'Review and process block change requests' : 'Track your block change requests'}
            </p>
          </div>
        </div>
        {isApprover && pendingCount > 0 && (
          <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm font-semibold">
            {pendingCount} pending request{pendingCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-cyan-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg shadow-cyan-500/20">
          <div className="text-2xl font-bold">{data?.total ?? 0}</div>
          <div className="text-cyan-100 text-sm font-medium">Total Requests</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">{pendingCount}</div>
              <div className="text-xs text-slate-400">Pending</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">
                {requests.filter((r: any) => r.status === 'APPROVED').length}
              </div>
              <div className="text-xs text-slate-400">Approved</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">
                {requests.filter((r: any) => r.status === 'REJECTED').length}
              </div>
              <div className="text-xs text-slate-400">Rejected</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[
          { key: 'PENDING', label: 'Pending' },
          { key: 'APPROVED', label: 'Approved' },
          { key: 'REJECTED', label: 'Rejected' },
          { key: 'ALL', label: 'All' },
        ].map(f => (
          <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === f.key
              ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Requests List */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <p className="text-slate-500 font-medium">No {filter !== 'ALL' ? filter.toLowerCase() : ''} requests</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r: any) => {
            const sc = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.PENDING;
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                <div className={`h-1 ${r.status === 'PENDING' ? 'bg-gradient-to-r from-amber-400 to-orange-400' : r.status === 'APPROVED' ? 'bg-gradient-to-r from-emerald-400 to-green-500' : r.status === 'REJECTED' ? 'bg-gradient-to-r from-red-400 to-rose-500' : 'bg-gradient-to-r from-slate-300 to-slate-400'}`} />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-base font-bold text-slate-800">{r.filterName}</h3>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${sc.bg} ${sc.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {sc.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-700">{r.fromBlockName}</span>
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                          <span className="font-medium text-cyan-700">{r.toBlockName}</span>
                        </div>
                      </div>
                      {r.reason && <p className="text-sm text-slate-400 mt-2">Reason: {r.reason}</p>}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                        <span>By: {r.requestedByName}</span>
                        <span>{formatDate(new Date(r.createdAt))} {formatTime(new Date(r.createdAt))}</span>
                        {r.processedByName && <span>Processed by: {r.processedByName}</span>}
                        {r.processedComment && <span>Comment: {r.processedComment}</span>}
                      </div>
                    </div>

                    {/* Actions for approver */}
                    {isApprover && r.status === 'PENDING' && (
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <input
                          className="w-40 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-cyan-400 outline-none"
                          placeholder="Comment (optional)"
                          value={processingId === r.id ? processComment : ''}
                          onChange={e => { setProcessingId(r.id); setProcessComment(e.target.value); }}
                        />
                        <button onClick={() => handleProcess(r.id, 'approve')}
                          disabled={processingId === r.id && processComment === '...'}
                          className="px-4 py-1.5 bg-emerald-500 text-white text-xs font-semibold rounded-lg hover:bg-emerald-600 transition-colors">
                          Approve
                        </button>
                        <button onClick={() => handleProcess(r.id, 'reject')}
                          className="px-4 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition-colors">
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            Previous
          </button>
          <span className="text-sm text-slate-500">{page} / {data?.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(data?.totalPages ?? 1, p + 1))} disabled={page === (data?.totalPages ?? 1)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
