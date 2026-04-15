import { useParams, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useState } from 'react';

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
  PENDING_SIGNATURE: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Signature' },
  SIGNED: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Signed' },
  REJECTED: { bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected' },
  EXPIRED: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Expired' },
};

export function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const reauth = useReauth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canSign = isSuperAdmin || perms.includes('REPORT_SIGN');
  const canExport = isSuperAdmin || perms.includes('REPORT_EXPORT');

  const swrKey = id ? `/api/reports/${id}` : null;
  const { data: report, isLoading } = useSWR(swrKey);

  const [showSignDialog, setShowSignDialog] = useState(false);
  const [signerRole, setSignerRole] = useState('');
  const [meaning, setMeaning] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleSign = () => {
    if (!signerRole) return;
    reauth.execute('SIGN_REPORT', async (password?: string) => {
      try {
        const body = { signerRole, meaning };
        if (password) await apiClient.postWithReauth(`/api/reports/${id}/sign`, body, password);
        else await apiClient.post(`/api/reports/${id}/sign`, body);
        mutate(swrKey);
        setShowSignDialog(false);
        setSignerRole('');
        setMeaning('');
        toast.success('Report signed');
      } catch (err: any) {
        toast.error('Sign failed', err.message || 'Could not sign report');
        throw err;
      }
    });
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    reauth.execute('REJECT_REPORT', async (password?: string) => {
      try {
        const body = { reason: rejectReason };
        if (password) await apiClient.postWithReauth(`/api/reports/${id}/reject`, body, password);
        else await apiClient.post(`/api/reports/${id}/reject`, body);
        mutate(swrKey);
        setShowRejectDialog(false);
        setRejectReason('');
        toast.success('Report rejected');
      } catch (err: any) {
        toast.error('Reject failed', err.message || 'Could not reject report');
        throw err;
      }
    });
  };

  const downloadPdf = async () => {
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token_backup');
      const res = await fetch(`/api/reports/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(report?.name ?? 'report').replace(/[^a-zA-Z0-9-_ ]/g, '')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Download failed', err.message);
    }
  };

  if (isLoading || !report) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const badge = STATUS_BADGES[report.status] ?? STATUS_BADGES.DRAFT;
  const canSignOrReject = canSign && (report.status === 'DRAFT' || report.status === 'PENDING_SIGNATURE');
  const token = sessionStorage.getItem('token') || localStorage.getItem('token_backup');
  const previewUrl = `/api/reports/${id}/preview`;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/reports')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{report.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${badge.bg} ${badge.text}`}>{badge.label}</span>
              <span className="text-xs text-slate-400">Template: {report.template?.name} &middot; v{report.templateVersion}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canSignOrReject && (
            <>
              <button onClick={() => setShowSignDialog(true)}
                className="px-4 py-2 text-sm font-semibold text-white rounded-xl shadow-md"
                style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                Sign Report
              </button>
              <button onClick={() => setShowRejectDialog(true)}
                className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-xl">
                Reject
              </button>
            </>
          )}
          {canExport && (
            <button onClick={downloadPdf} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-xl">
              Download PDF
            </button>
          )}
        </div>
      </div>

      {/* PDF Preview */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm" style={{ height: 'calc(100vh - 280px)' }}>
        <iframe src={`${previewUrl}?token=${token}`} className="w-full h-full" title="Report Preview" />
      </div>

      {/* Signatures */}
      {report.signatures?.length > 0 && (
        <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Signatures</h3>
          <div className="space-y-2">
            {report.signatures.map((sig: any) => (
              <div key={sig.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-800">{sig.signerLabel}</div>
                  <div className="text-xs text-slate-500">{sig.user?.fullName ?? sig.user?.username} &middot; {new Date(sig.signedAt).toLocaleString()}</div>
                </div>
                <div className="text-xs text-slate-400 italic">"{sig.meaning}"</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sign Dialog */}
      {showSignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSignDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Sign Report</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Signer Role</label>
                <input value={signerRole} onChange={e => setSignerRole(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none" placeholder="e.g. operator, reviewer, approver" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Signature Meaning</label>
                <textarea value={meaning} onChange={e => setMeaning(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none resize-none" rows={3}
                  placeholder="I have reviewed and approve this report" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowSignDialog(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
              <button onClick={handleSign} disabled={!signerRole}
                className="px-5 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50 shadow-md"
                style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                Sign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Dialog */}
      {showRejectDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRejectDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Reject Report</h2>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason for rejection</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none resize-none" rows={3}
                placeholder="Explain why this report is being rejected..." />
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowRejectDialog(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
              <button onClick={handleReject} disabled={!rejectReason.trim()}
                className="px-5 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl disabled:opacity-50 shadow-md">
                Reject
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
