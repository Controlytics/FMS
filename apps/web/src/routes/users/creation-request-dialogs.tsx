import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface CreationRequest {
  id: string;
  requestedUserId: string;
  fullName: string;
  department: string | null;
  email: string;
  roleName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerFullName: string | null;
  rejectionReason: string | null;
  isPasswordViewed: boolean;
  ipAddress: string | null;
}

/* ── Approve Confirmation Dialog ─────────────────────────────── */

interface ApproveDialogProps {
  open: boolean;
  request: CreationRequest | null;
  isProcessing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApproveDialog({ open, request, isProcessing, onConfirm, onCancel }: ApproveDialogProps) {
  return (
    <Dialog open={open} onClose={() => !isProcessing && onCancel()} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Approve User Creation Request</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          This will create a new user account with a temporary password.
        </p>
        {request && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-sm">
            <div><span className="font-medium text-slate-500">Name:</span> {request.fullName}</div>
            <div><span className="font-medium text-slate-500">User ID:</span> {request.requestedUserId}</div>
            <div><span className="font-medium text-slate-500">Email:</span> {request.email}</div>
            <div><span className="font-medium text-slate-500">Role:</span> {request.roleName}</div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={isProcessing}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isProcessing ? 'Processing...' : 'Approve & Create User'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Reject Dialog ───────────────────────────────────────────── */

interface RejectDialogProps {
  open: boolean;
  request: CreationRequest | null;
  rejectionReason: string;
  onReasonChange: (reason: string) => void;
  isProcessing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RejectDialog({
  open, request, rejectionReason, onReasonChange,
  isProcessing, onConfirm, onCancel,
}: RejectDialogProps) {
  return (
    <Dialog open={open} onClose={() => !isProcessing && onCancel()} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Reject User Creation Request</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {request && (
          <p className="text-sm text-slate-600">
            Reject the account request from <span className="font-semibold">{request.fullName}</span> ({request.requestedUserId}).
          </p>
        )}
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={rejectionReason}
            onChange={e => onReasonChange(e.target.value)}
            placeholder="Enter the reason for rejection..."
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-xl border-2 border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={isProcessing || !rejectionReason.trim()}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {isProcessing ? 'Processing...' : 'Reject Request'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Temporary Password Display Dialog ───────────────────────── */

interface TempPasswordDialogProps {
  open: boolean;
  tempPassword: string;
  showPassword: boolean;
  onToggleShow: () => void;
  onCopy: () => void;
  onDone: () => void;
}

export function TempPasswordDialog({
  open, tempPassword, showPassword, onToggleShow, onCopy, onDone,
}: TempPasswordDialogProps) {
  return (
    <Dialog open={open} onClose={() => {}} className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          User Created Successfully
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
          <div className="flex gap-2">
            <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-amber-800">
              <p className="font-semibold">Important: Copy this password now!</p>
              <p className="mt-1">This temporary password will only be shown once and cannot be retrieved again.</p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">Temporary Password</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-11 px-4 flex items-center bg-slate-100 border-2 border-slate-200 rounded-xl font-mono text-sm">
              {showPassword ? tempPassword : '\u2022'.repeat(16)}
            </div>
            <button
              type="button"
              onClick={onToggleShow}
              className="h-11 w-11 flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-50 transition-colors"
              title={showPassword ? 'Hide' : 'Show'}
            >
              {showPassword ? (
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.05 6.05m3.828 3.828L6.05 6.05M6.05 6.05L3 3m3.05 3.05a9.95 9.95 0 016.95-2.9c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={onCopy}
              className="h-11 w-11 flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-50 transition-colors"
              title="Copy password"
            >
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={onDone}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          I've Copied the Password
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export type { CreationRequest };
