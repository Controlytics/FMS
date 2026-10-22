import { useEffect, useId, useState } from 'react';

/**
 * Approval / decision flows require remarks (CLAUDE.md). A review or an approval
 * says why as much as a rejection does (D03-13, 2026-10-22): this is the dialog
 * the PM schedule and Replacement Schedule review / approve buttons ask in. The
 * server refuses fewer than DECISION_REMARKS_MIN characters (once trimmed)
 * before the signature, so the confirm button stays disabled until there are
 * enough. Escape and Cancel close it without a request.
 */
export const DECISION_REMARKS_MIN = 3;

export function DecisionRemarksDialog({ title, confirmLabel, busy, onConfirm, onCancel }: {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (remarks: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [remarks, setRemarks] = useState('');
  const ready = remarks.trim().length >= DECISION_REMARKS_MIN;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[56] p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
        className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-5 shadow-2xl">
        <h3 id={`${id}-title`} className="text-lg font-bold text-slate-800 mb-1">{title}</h3>
        <label htmlFor={`${id}-remarks`} className="block text-sm text-slate-500 mb-2">
          Remarks <span className="text-red-500">*</span> <span className="text-slate-400">(at least {DECISION_REMARKS_MIN} characters)</span>
        </label>
        <textarea id={`${id}-remarks`} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} autoFocus
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-3 focus:ring-brand-600/15"
          placeholder="What was checked…" />
        <div className="flex gap-2 mt-3">
          <button type="button" onClick={onCancel} disabled={busy}
            className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-200 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => onConfirm(remarks.trim())} disabled={busy || !ready}
            className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
