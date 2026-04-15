import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';

const TYPE_CFG: Record<string, { label: string; bg: string; text: string; border: string; icon: string }> = {
  CREATE_USER: { label: 'Create User', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: '+' },
  MODIFY_USER: { label: 'Modify User', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: '~' },
  UNLOCK: { label: 'Unlock Account', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: '!' },
  FORGOT_PASSWORD: { label: 'Forgot Password', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', icon: '?' },
};

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  PENDING: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-400 animate-pulse' },
  APPROVED: { label: 'Approved', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-400' },
  REJECTED: { label: 'Rejected', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-400' },
};

export function AdminRequestsPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canApprove = isSuperAdmin || perms.includes('USER_CREATE');
  const { formatDateTime } = useDatetimeFormat();
  const { toast } = useToast();
  const reauth = useReauth();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [adminRemarks, setAdminRemarks] = useState('');
  const [processing, setProcessing] = useState(false);

  const queryParam = statusFilter ? `?status=${statusFilter}` : '';
  const { data, isLoading } = useSWR(`/api/admin-requests${queryParam}`, { refreshInterval: 15000 });
  const requests = data?.data ?? [];
  const pendingCount = data?.pendingCount ?? 0;

  const handleProcess = (action: 'approve' | 'reject') => {
    if (!selectedRequest) return;
    setProcessing(true);
    reauth.execute(
      'CREATE_USER',
      async (password?: string) => {
        const body = { action, adminRemarks: adminRemarks.trim() };
        if (password) {
          await api.postWithReauth(`/api/admin-requests/${selectedRequest.id}/process`, body, password);
        } else {
          await api.post(`/api/admin-requests/${selectedRequest.id}/process`, body);
        }
      },
      {
        onSuccess: () => {
          toast.success(
            action === 'approve' ? 'Request Approved' : 'Request Rejected',
            `${TYPE_CFG[selectedRequest.requestType]?.label} request has been ${action === 'approve' ? 'approved' : 'rejected'}.`,
          );
          setSelectedRequest(null);
          setAdminRemarks('');
          mutate(`/api/admin-requests${queryParam}`);
        },
        onError: (err: any) => {
          toast.error('Action Failed', err.message ?? 'Something went wrong');
          setProcessing(false);
        },
      },
    );
  };

  const timeAgo = (date: string) => {
    const ms = Date.now() - new Date(date).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const renderRequestDetails = (req: any) => {
    const rd = req.requestData ?? {};
    const fields: [string, string][] = [];
    switch (req.requestType) {
      case 'CREATE_USER':
        fields.push(['Full Name', rd.fullName], ['Email', rd.email], ['Department', rd.department || '-'], ['Requested Role', rd.requestedRole]);
        break;
      case 'MODIFY_USER':
        fields.push(['Username', rd.username], ['Modify Field', rd.modifyField], ['New Value', rd.newValue]);
        break;
      case 'UNLOCK':
      case 'FORGOT_PASSWORD':
        fields.push(['Username', rd.username]);
        break;
      default:
        return <pre className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3">{JSON.stringify(rd, null, 2)}</pre>;
    }
    return (
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([label, value]) => (
          <div key={label} className="space-y-0.5">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">{label}</div>
            <div className="text-[13px] font-medium text-slate-800">{value}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600 to-teal-700 shadow-lg shadow-cyan-600/10">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">Admin Requests</h1>
              <p className="text-[13px] text-slate-400 mt-0.5">
                {pendingCount > 0 ? (
                  <><span className="text-amber-600 font-semibold">{pendingCount} pending</span> request{pendingCount !== 1 ? 's' : ''} awaiting review</>
                ) : 'All requests have been processed'}
              </p>
            </div>
          </div>
        </div>

        {/* Status pills */}
        <div className="flex gap-2">
          {[
            { key: '', label: 'All', count: requests.length },
            ...Object.entries(STATUS_CFG).map(([key, cfg]) => ({
              key,
              label: cfg.label,
              count: requests.filter((r: any) => r.status === key).length,
              dot: cfg.dot,
            })),
          ].map(s => (
            <button key={s.key} onClick={() => setStatusFilter(s.key)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === s.key ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}>
              {'dot' in s && s.dot && <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === s.key ? 'bg-white' : s.dot}`} />}
              {s.label}
              {s.count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusFilter === s.key ? 'bg-white/20' : 'bg-slate-200'}`}>{s.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading requests...</span>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-slate-400 font-medium text-[14px]">No requests found</span>
            <span className="text-[13px] text-slate-300">Requests will appear when users submit them</span>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Requester', 'Type', 'Status', 'Submitted', 'Time', ''].map((h, i) => (
                  <th key={i} className="text-left px-5 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {requests.map((req: any) => {
                const tc = TYPE_CFG[req.requestType] ?? { label: req.requestType, bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: '?' };
                const sc = STATUS_CFG[req.status] ?? { label: req.status, bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
                const isPending = req.status === 'PENDING';

                return (
                  <tr key={req.id} className={`hover:bg-cyan-50/30 transition-colors group cursor-pointer ${isPending ? 'bg-amber-50/20' : ''}`}
                    onClick={() => { setSelectedRequest(req); setAdminRemarks(''); setProcessing(false); }}>
                    <td className="px-5 py-3.5">
                      <div className="text-[13px] font-semibold text-slate-800">{req.requesterName}</div>
                      {req.requesterEmployeeId && <div className="text-[11px] text-slate-400 mt-0.5">{req.requesterEmployeeId}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-bold ${tc.bg} ${tc.text} ${tc.border}`}>
                        {tc.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-bold ${sc.bg} ${sc.text} ${sc.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{formatDateTime(req.requestedAt)}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-400">{timeAgo(req.requestedAt)}</td>
                    <td className="px-5 py-3.5">
                      <span className="text-[12px] font-semibold text-cyan-600 opacity-60 group-hover:opacity-100 transition-opacity">
                        View
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Slide-over panel */}
      {selectedRequest && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={() => setSelectedRequest(null)} />
          <div className="fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200">
            {/* Panel header */}
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${TYPE_CFG[selectedRequest.requestType]?.bg ?? 'bg-slate-50'} ${TYPE_CFG[selectedRequest.requestType]?.text ?? 'text-slate-600'}`}>
                    {TYPE_CFG[selectedRequest.requestType]?.icon ?? '?'}
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-slate-800">
                      {TYPE_CFG[selectedRequest.requestType]?.label ?? selectedRequest.requestType}
                    </h3>
                    <p className="text-[11px] text-slate-400">{timeAgo(selectedRequest.requestedAt)}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedRequest(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Status badge */}
              <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-bold ${STATUS_CFG[selectedRequest.status]?.bg ?? ''} ${STATUS_CFG[selectedRequest.status]?.text ?? ''} ${STATUS_CFG[selectedRequest.status]?.border ?? ''}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CFG[selectedRequest.status]?.dot ?? ''}`} />
                {STATUS_CFG[selectedRequest.status]?.label ?? selectedRequest.status}
              </span>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Requester */}
              <div>
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Requester</h4>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600 font-bold text-sm">
                    {(selectedRequest.requesterName ?? '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800">{selectedRequest.requesterName}</div>
                    {selectedRequest.requesterEmployeeId && <div className="text-[11px] text-slate-400">{selectedRequest.requesterEmployeeId}</div>}
                    {selectedRequest.requesterEmail && <div className="text-[11px] text-slate-400">{selectedRequest.requesterEmail}</div>}
                  </div>
                </div>
              </div>

              {/* Request data */}
              <div>
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Details</h4>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  {renderRequestDetails(selectedRequest)}
                </div>
              </div>

              {/* Timestamps */}
              <div>
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Timeline</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-[13px]">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-slate-500">Submitted</span>
                    <span className="text-slate-700 font-medium ml-auto tabular-nums">{formatDateTime(selectedRequest.requestedAt)}</span>
                  </div>
                  {selectedRequest.processedAt && (
                    <div className="flex items-center gap-3 text-[13px]">
                      <div className={`w-2 h-2 rounded-full ${selectedRequest.status === 'APPROVED' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="text-slate-500">{selectedRequest.status === 'APPROVED' ? 'Approved' : 'Rejected'}</span>
                      <span className="text-slate-700 font-medium ml-auto tabular-nums">{formatDateTime(selectedRequest.processedAt)}</span>
                    </div>
                  )}
                  {selectedRequest.processedBy && (
                    <div className="flex items-center gap-3 text-[13px]">
                      <div className="w-2 h-2 rounded-full bg-slate-300" />
                      <span className="text-slate-500">Processed by</span>
                      <span className="text-slate-700 font-medium ml-auto">{selectedRequest.processedBy}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Requester remarks */}
              {selectedRequest.remarks && (
                <div>
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Requester's Reason</h4>
                  <p className="text-[13px] text-slate-600 p-3 rounded-xl bg-slate-50 border border-slate-100 italic">{selectedRequest.remarks}</p>
                </div>
              )}

              {/* Admin remarks (processed) */}
              {selectedRequest.adminRemarks && (
                <div>
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Admin Notes</h4>
                  <p className="text-[13px] text-slate-600 p-3 rounded-xl bg-slate-50 border border-slate-100">{selectedRequest.adminRemarks}</p>
                </div>
              )}

              {/* Admin response textarea */}
              {canApprove && selectedRequest.status === 'PENDING' && (
                <div>
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Your Response <span className="text-red-500">*</span></h4>
                  <textarea
                    value={adminRemarks}
                    onChange={e => setAdminRemarks(e.target.value)}
                    placeholder="Enter notes about your decision (required)..."
                    rows={3}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-[13px] text-slate-700 resize-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-white"
                  />
                </div>
              )}
            </div>

            {/* Footer actions */}
            {canApprove && selectedRequest.status === 'PENDING' && (
              <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center gap-3">
                <button onClick={() => handleProcess('reject')} disabled={processing || !adminRemarks.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 shadow-sm">
                  {processing ? 'Processing...' : 'Reject'}
                </button>
                <button onClick={() => handleProcess('approve')} disabled={processing || !adminRemarks.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm">
                  {processing ? 'Processing...' : 'Approve'}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Process Request"
      />
    </div>
  );
}
