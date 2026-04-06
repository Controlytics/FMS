import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api-client';

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  CREATE_USER: { label: 'Create User', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  MODIFY_USER: { label: 'Modify User', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  UNLOCK: { label: 'Unlock Account', color: 'bg-red-50 text-red-700 border-red-200' },
  FORGOT_PASSWORD: { label: 'Forgot Password', color: 'bg-purple-50 text-purple-700 border-purple-200' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'Approved', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED: { label: 'Rejected', color: 'bg-red-50 text-red-700 border-red-200' },
};

export function AdminRequestsPage() {
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
            `${TYPE_LABELS[selectedRequest.requestType]?.label} request has been ${action === 'approve' ? 'approved' : 'rejected'}.`,
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

  const renderRequestDetails = (req: any) => {
    const rd = req.requestData ?? {};
    switch (req.requestType) {
      case 'CREATE_USER':
        return (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-400">Full Name:</span> <span className="font-medium text-slate-700">{rd.fullName}</span></div>
            <div><span className="text-slate-400">Email:</span> <span className="font-medium text-slate-700">{rd.email}</span></div>
            <div><span className="text-slate-400">Department:</span> <span className="font-medium text-slate-700">{rd.department || '-'}</span></div>
            <div><span className="text-slate-400">Requested Role:</span> <span className="font-medium text-slate-700">{rd.requestedRole}</span></div>
          </div>
        );
      case 'MODIFY_USER':
        return (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-400">Username:</span> <span className="font-medium text-slate-700">{rd.username}</span></div>
            <div><span className="text-slate-400">Modify:</span> <span className="font-medium text-slate-700">{rd.modifyField}</span></div>
            <div className="col-span-2"><span className="text-slate-400">New Value:</span> <span className="font-medium text-slate-700">{rd.newValue}</span></div>
          </div>
        );
      case 'UNLOCK':
        return (
          <div className="text-sm">
            <span className="text-slate-400">Username:</span> <span className="font-medium text-slate-700">{rd.username}</span>
          </div>
        );
      case 'FORGOT_PASSWORD':
        return (
          <div className="text-sm">
            <span className="text-slate-400">Username:</span> <span className="font-medium text-slate-700">{rd.username}</span>
          </div>
        );
      default:
        return <pre className="text-xs text-slate-500">{JSON.stringify(rd, null, 2)}</pre>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 shadow-lg shadow-indigo-600/20">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Admin Requests</h1>
            <p className="text-sm text-slate-500">
              {pendingCount > 0 ? `${pendingCount} pending request(s)` : 'No pending requests'}
            </p>
          </div>
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500">
          <option value="">All Requests</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400">Loading requests...</p>
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <svg className="w-10 h-10 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-slate-500 font-medium">No requests found</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Requester</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((req: any) => {
                  const typeInfo = TYPE_LABELS[req.requestType] ?? { label: req.requestType, color: 'bg-slate-100 text-slate-500 border-slate-300' };
                  const statusInfo = STATUS_LABELS[req.status] ?? { label: req.status, color: 'bg-slate-100 text-slate-500 border-slate-300' };
                  return (
                    <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-slate-700">{req.requesterName}</p>
                          {req.requesterEmployeeId && <p className="text-xs text-slate-400">{req.requesterEmployeeId}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${typeInfo.color}`}>{typeInfo.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">{formatDateTime(req.requestedAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setSelectedRequest(req); setAdminRemarks(''); setProcessing(false); }}
                          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail / Process Panel */}
      {selectedRequest && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedRequest(null)} />
          <div className="fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Request Details</h3>
              <button onClick={() => setSelectedRequest(null)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Requester Info */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Requester</h4>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                  <p className="text-sm font-medium text-slate-700">{selectedRequest.requesterName}</p>
                  {selectedRequest.requesterEmployeeId && <p className="text-xs text-slate-500">Employee ID: {selectedRequest.requesterEmployeeId}</p>}
                  {selectedRequest.requesterEmail && <p className="text-xs text-slate-500">Email: {selectedRequest.requesterEmail}</p>}
                </div>
              </div>

              {/* Request Type & Status */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Type</h4>
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${TYPE_LABELS[selectedRequest.requestType]?.color ?? ''}`}>
                    {TYPE_LABELS[selectedRequest.requestType]?.label ?? selectedRequest.requestType}
                  </span>
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Status</h4>
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_LABELS[selectedRequest.status]?.color ?? ''}`}>
                    {STATUS_LABELS[selectedRequest.status]?.label ?? selectedRequest.status}
                  </span>
                </div>
              </div>

              {/* Request Data */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Request Details</h4>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  {renderRequestDetails(selectedRequest)}
                </div>
              </div>

              {/* Requester Remarks */}
              {selectedRequest.remarks && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Reason</h4>
                  <p className="text-sm text-slate-600 p-3 rounded-lg bg-slate-50 border border-slate-200">{selectedRequest.remarks}</p>
                </div>
              )}

              {/* Admin Remarks (if already processed) */}
              {selectedRequest.adminRemarks && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Admin Notes</h4>
                  <p className="text-sm text-slate-600 p-3 rounded-lg bg-slate-50 border border-slate-200">{selectedRequest.adminRemarks}</p>
                </div>
              )}

              {/* Process Actions (only if PENDING) */}
              {selectedRequest.status === 'PENDING' && (
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Admin Response</h4>
                  <textarea
                    value={adminRemarks}
                    onChange={e => setAdminRemarks(e.target.value)}
                    placeholder="Enter notes about your decision..."
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              )}
            </div>

            {/* Footer with Approve/Reject buttons */}
            {selectedRequest.status === 'PENDING' && (
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
                <button
                  onClick={() => handleProcess('reject')}
                  disabled={processing}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? 'Processing...' : 'Reject'}
                </button>
                <button
                  onClick={() => handleProcess('approve')}
                  disabled={processing}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? 'Processing...' : 'Approve'}
                </button>
              </div>
            )}

            {/* Processed info */}
            {selectedRequest.status !== 'PENDING' && (
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
                <p className="text-xs text-slate-400">
                  Processed {selectedRequest.processedAt ? `on ${formatDateTime(selectedRequest.processedAt)}` : ''} {selectedRequest.processedBy ? `by ${selectedRequest.processedBy}` : ''}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Reauth Dialog */}
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
