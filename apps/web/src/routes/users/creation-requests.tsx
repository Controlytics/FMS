import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { useToast } from '@/hooks/use-toast';
import {
  ApproveDialog, RejectDialog, TempPasswordDialog,
  type CreationRequest,
} from './creation-request-dialogs';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-100 text-red-700 border-red-200',
};

export function CreationRequestsPage() {
  const { formatDateTime } = useDatetimeFormat();
  const { toast } = useToast();
  const reauth = useReauth();

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<CreationRequest | null>(null);

  // Dialogs
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [approvedRequestId, setApprovedRequestId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 300ms search debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const queryParams = new URLSearchParams();
  if (statusFilter) queryParams.set('status', statusFilter);
  if (debouncedSearch) queryParams.set('search', debouncedSearch);
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

  const { data: res, mutate } = useSWR<{ data: CreationRequest[] }>(
    `/api/user-requests${queryString}`
  );
  const { data: pendingData } = useSWR<{ count: number }>('/api/user-requests/pending/count');

  const requests = res?.data ?? [];
  const pendingCount = pendingData?.count ?? 0;

  const handleApprove = (req: CreationRequest) => {
    setSelectedRequest(req);
    setShowApproveDialog(true);
  };

  const confirmApprove = async () => {
    if (!selectedRequest) return;
    setIsProcessing(true);
    await reauth.execute('APPROVE_USER_REQUEST', async (password?: string) => {
      const result = password
        ? await apiClient.postWithReauth<{ tempPassword: string }>(
            `/api/user-requests/${selectedRequest.id}/approve`, {}, password
          )
        : await apiClient.post<{ tempPassword: string }>(
            `/api/user-requests/${selectedRequest.id}/approve`, {}
          );
      setShowApproveDialog(false);
      setTempPassword(result.tempPassword);
      setApprovedRequestId(selectedRequest.id);
      setShowPasswordDialog(true);
      setShowTempPassword(false);
      toast.success(`User ${selectedRequest.requestedUserId} created successfully`);
      mutate();
    }, {
      onError: (err: any) => {
        toast.error(err.message || 'Failed to approve request');
      },
    });
    setIsProcessing(false);
  };

  const handleReject = (req: CreationRequest) => {
    setSelectedRequest(req);
    setRejectionReason('');
    setShowRejectDialog(true);
  };

  const confirmReject = async () => {
    if (!selectedRequest || !rejectionReason.trim()) return;
    setIsProcessing(true);
    await reauth.execute('REJECT_USER_REQUEST', async (password?: string) => {
      const body = { rejectionReason: rejectionReason.trim() };
      if (password) {
        await apiClient.postWithReauth(
          `/api/user-requests/${selectedRequest.id}/reject`, body, password
        );
      } else {
        await apiClient.post(`/api/user-requests/${selectedRequest.id}/reject`, body);
      }
      setShowRejectDialog(false);
      toast.success('Request rejected');
      mutate();
    }, {
      onError: (err: any) => {
        toast.error(err.message || 'Failed to reject request');
      },
    });
    setIsProcessing(false);
  };

  const handlePasswordViewed = async () => {
    if (approvedRequestId) {
      try {
        await apiClient.post(`/api/user-requests/${approvedRequestId}/password-viewed`, {});
      } catch { /* best effort */ }
    }
    setShowPasswordDialog(false);
    setTempPassword('');
    setApprovedRequestId('');
    mutate();
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(tempPassword);
    toast.success('Password copied to clipboard');
  };

  const pendingRequests = requests.filter(r => r.status === 'PENDING');
  const processedRequests = requests.filter(r => r.status !== 'PENDING');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">User Creation Requests</h1>
            <p className="text-sm text-slate-500">Review and process account creation requests</p>
          </div>
          {pendingCount > 0 && (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-sm px-3 py-1">
              {pendingCount} pending
            </Badge>
          )}
        </div>
        <Link to="/users">
          <Button variant="outline" className="rounded-xl">Back to Users</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, ID, or email..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-10 px-4 text-sm rounded-xl border-2 border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-72"
        />
        <div className="flex gap-1.5">
          {['', 'PENDING', 'APPROVED', 'REJECTED'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                statusFilter === s
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-700">Pending Requests</h2>
          {pendingRequests.map(req => (
            <div key={req.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-slate-800">{req.fullName}</h3>
                    <Badge className={STATUS_BADGE.PENDING}>{req.status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-slate-600">
                    <div><span className="font-medium text-slate-500">User ID:</span> {req.requestedUserId}</div>
                    <div><span className="font-medium text-slate-500">Email:</span> {req.email}</div>
                    <div><span className="font-medium text-slate-500">Role:</span> {req.roleName}</div>
                    <div><span className="font-medium text-slate-500">Department:</span> {req.department || '\u2014'}</div>
                    <div><span className="font-medium text-slate-500">Requested:</span> {formatDateTime(req.requestedAt)}</div>
                    {req.ipAddress && (
                      <div><span className="font-medium text-slate-500">IP:</span> {req.ipAddress}</div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    onClick={() => handleApprove(req)}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                  >
                    Approve
                  </Button>
                  <Button
                    onClick={() => handleReject(req)}
                    variant="outline"
                    className="rounded-xl text-red-600 border-red-200 hover:bg-red-50 text-sm"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Processed Requests */}
      {processedRequests.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-700">Request History</h2>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">User ID</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Role</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Reviewed By</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Reviewed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processedRequests.map(req => (
                  <tr key={req.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-slate-800">{req.fullName}</p>
                        <p className="text-xs text-slate-500">{req.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{req.requestedUserId}</td>
                    <td className="px-4 py-3 text-slate-700">{req.roleName}</td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_BADGE[req.status] || ''}>{req.status}</Badge>
                      {req.rejectionReason && (
                        <p className="text-xs text-red-500 mt-1 max-w-48 truncate" title={req.rejectionReason}>
                          {req.rejectionReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{req.reviewerFullName || req.reviewedBy || '\u2014'}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{req.reviewedAt ? formatDateTime(req.reviewedAt) : '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {requests.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="font-semibold">No requests found</p>
          <p className="text-sm mt-1">User creation requests will appear here</p>
        </div>
      )}

      {/* Dialogs */}
      <ApproveDialog
        open={showApproveDialog}
        request={selectedRequest}
        isProcessing={isProcessing}
        onConfirm={confirmApprove}
        onCancel={() => setShowApproveDialog(false)}
      />

      <RejectDialog
        open={showRejectDialog}
        request={selectedRequest}
        rejectionReason={rejectionReason}
        onReasonChange={setRejectionReason}
        isProcessing={isProcessing}
        onConfirm={confirmReject}
        onCancel={() => setShowRejectDialog(false)}
      />

      <TempPasswordDialog
        open={showPasswordDialog}
        tempPassword={tempPassword}
        showPassword={showTempPassword}
        onToggleShow={() => setShowTempPassword(!showTempPassword)}
        onCopy={copyPassword}
        onDone={handlePasswordViewed}
      />

      <ReauthDialog
        open={reauth.isOpen}
        onCancel={reauth.cancel}
        onConfirm={reauth.confirm}
        password={reauth.password}
        onPasswordChange={reauth.setPassword}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
      />
    </div>
  );
}
