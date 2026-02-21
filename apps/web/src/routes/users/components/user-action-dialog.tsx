import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface ActionDialogData {
  type: string;
  userId: string;
  username: string;
  fullName?: string;
}

interface UserActionDialogProps {
  actionDialog: ActionDialogData | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function UserActionDialog({ actionDialog, onClose, onConfirm }: UserActionDialogProps) {
  return (
    <Dialog open={!!actionDialog} onClose={onClose}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${
            actionDialog?.type === 'delete' ? 'bg-red-100' :
            actionDialog?.type === 'disable' ? 'bg-red-100' : 'bg-emerald-100'
          }`}>
            <svg className={`w-5 h-5 ${
              actionDialog?.type === 'delete' ? 'text-red-600' :
              actionDialog?.type === 'disable' ? 'text-red-600' : 'text-emerald-600'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {actionDialog?.type === 'enable' && (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
              {actionDialog?.type === 'disable' && (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              )}
              {actionDialog?.type === 'delete' && (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              )}
            </svg>
          </div>
          {actionDialog?.type === 'enable' ? 'Enable' :
           actionDialog?.type === 'delete' ? 'Delete' : 'Disable'} User
        </DialogTitle>
      </DialogHeader>
      <div className="py-4">
        <p className="text-slate-600">
          Are you sure you want to {actionDialog?.type} user <strong className="text-slate-800">{actionDialog?.fullName || actionDialog?.username}</strong>?
        </p>
        {actionDialog?.type === 'disable' && (
          <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-red-700">
              This will terminate all active sessions for this user. They will not be able to log in until re-enabled.
            </p>
          </div>
        )}
        {actionDialog?.type === 'delete' && (
          <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-red-700">
              <p className="font-semibold">Warning: This action is irreversible!</p>
              <p className="mt-1">This will permanently disable the user account, terminate all active sessions, and the user will not be able to log in. The user data will be retained for audit purposes.</p>
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          variant={(actionDialog?.type === 'disable' || actionDialog?.type === 'delete') ? 'destructive' : 'default'}
          onClick={onConfirm}
          className={(actionDialog?.type === 'disable' || actionDialog?.type === 'delete')
            ? 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600'
            : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600'
          }
        >
          {actionDialog?.type === 'enable' && (
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {actionDialog?.type === 'disable' && (
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          )}
          {actionDialog?.type === 'delete' && (
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
          {actionDialog?.type === 'delete' ? 'Delete User' : 'Confirm'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
