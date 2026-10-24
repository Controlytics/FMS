import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ReasonBox, reasonOk } from '@/components/ui/reason-box';

interface AuditDeleteDialogProps {
  open: boolean;
  selectedCount: number;
  deleting: boolean;
  onClose: () => void;
  /**
   * Called with the trimmed reason (>= 5 characters, the API's minimum). The
   * reason is asked HERE, not in a browser prompt (2026-10-24): `window.prompt`
   * dropped a short reason silently and is the one dialog the tablet cannot style.
   */
  onConfirm: (reason: string) => void;
  // 'redact' preserves the hash chain (masks payload); 'delete' physically removes
  // the row and BREAKS the chain. Defaults to 'redact' (the safe, common path).
  mode?: 'redact' | 'delete';
  /** Redact mode: selected rows left out because they cannot be redacted (already redacted, or the record of a redaction). */
  excludedCount?: number;
}

export function AuditDeleteDialog({
  open,
  selectedCount,
  deleting,
  onClose,
  onConfirm,
  mode = 'redact',
  excludedCount = 0,
}: AuditDeleteDialogProps) {
  const [reason, setReason] = useState('');
  // Each opening starts with an empty reason: one record's justification must
  // never be carried onto the next.
  useEffect(() => { if (open) setReason(''); }, [open]);
  const isDelete = mode === 'delete';
  const verb = isDelete ? 'permanently delete' : 'redact';
  const plural = selectedCount === 1 ? '' : 's';
  const title = isDelete ? `Delete Audit Record${plural}` : `Redact Audit Record${plural}`;
  const warning = isDelete
    ? 'Warning: physical deletion BREAKS the 21 CFR Part 11 tamper-evident hash chain. The integrity check (Verify Chain) will report the trail as invalid from this point on, permanently. This cannot be undone.'
    : 'Redaction masks the record contents (before/after values) but preserves the tamper-evident hash chain and a skeleton record of the action. This cannot be undone.';
  const btnLabel = deleting
    ? (isDelete ? 'Deleting...' : 'Redacting...')
    : `${isDelete ? 'Delete' : 'Redact'} ${selectedCount} Record${selectedCount > 1 ? 's' : ''}`;
  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-red-100 text-red-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          {title}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Are you sure you want to {verb} <span className="font-semibold text-red-700">{selectedCount}</span> audit record{selectedCount > 1 ? 's' : ''}? This action cannot be undone.
        </p>
        {!isDelete && excludedCount > 0 && (
          <p className="text-sm text-slate-600">
            {excludedCount} selected record{excludedCount > 1 ? 's are' : ' is'} left out: already redacted, or a record of an earlier audit-trail change, which cannot be redacted.
          </p>
        )}
        <div className="p-3 rounded-lg bg-red-50 border border-red-100">
          <p className="text-xs text-red-700 font-medium">{warning}</p>
        </div>
        <ReasonBox
          value={reason}
          onChange={setReason}
          danger={isDelete}
          placeholder={isDelete ? 'Why must this record be deleted?' : 'Why must this record be redacted?'}
          hint="Recorded on the audit trail with who did it and when."
        />
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(reason.trim())} disabled={deleting || selectedCount === 0 || !reasonOk(reason)} className="bg-red-600 hover:bg-red-700 text-white">
            {btnLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
