import { useMemo, useState } from 'react';
import useSWR from 'swr';
import type { ApprovalDialogFilter, ApprovalDialogMode } from './FilterApprovalDialog';

// Filter creation workflow — bulk review / approve popup (2026-09-24).
//
// Opened from the block toolbar ("Review (n)" / "Approve (n)"). Lists every
// filter of the block that is waiting on the viewer's step, with the same
// columns the table shows plus who submitted it and when, so the decider sees
// the data before deciding. All rows start ticked; untick to leave one for
// later. One request for the ticked ids — the endpoints take an array, and a
// per-filter audit row is still written server-side.
//
// Reject here takes ONE reason for every ticked row. A filter that fails for
// its own reason is rejected from its single popup (the eye icon opens it).

export type BulkMode = Exclude<ApprovalDialogMode, 'view'>;

type Props = {
  filters: ApprovalDialogFilter[];
  mode: BulkMode;
  canReject: boolean;
  submitting: boolean;
  formatDateTime: (v: string | Date) => string;
  onClose: () => void;
  onViewDetails: (f: ApprovalDialogFilter) => void;
  onComplete: (ids: string[], remarks: string) => void;
  onReject: (ids: string[], reason: string) => void;
};

type PendingRow = { id: string; submittedByName?: string | null; submittedAt?: string | null; reviewedByName?: string | null; reviewedAt?: string | null; reviewRemarks?: string | null };

const dash = (v: unknown) => (v === null || v === undefined || v === '' || v === '-' ? '--' : String(v));

export function FilterBulkApprovalDialog({ filters, mode, canReject, submitting, formatDateTime, onClose, onViewDetails, onComplete, onReject }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(filters.map(f => f.id)));
  const [remarks, setRemarks] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Submitted / reviewed attribution for every pending filter (one request).
  const { data: pending } = useSWR<{ data: PendingRow[] }>('/api/assets/instances/pending-approval');
  const attribution = useMemo(() => {
    const m = new Map<string, PendingRow>();
    for (const r of pending?.data ?? []) m.set(r.id, r);
    return m;
  }, [pending]);

  // Keep the selection in step with the list: a row that left the block (or
  // changed state under us) must not stay ticked.
  const ids = filters.map(f => f.id);
  const picked = ids.filter(id => selected.has(id));
  const allPicked = picked.length === ids.length && ids.length > 0;

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allPicked ? new Set() : new Set(ids));

  const isReview = mode === 'review';
  const title = isReview ? 'Review Pending Filters' : 'Approve Pending Filters';
  const headerCls = isReview ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-green-600 to-emerald-500';
  const verb = isReview ? 'Complete Review' : 'Approve';

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-[54] p-4" data-testid="filter-bulk-approval-dialog">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-6xl overflow-hidden flex flex-col shadow-2xl" style={{ maxHeight: '92vh' }}>
        <div className={`px-6 py-4 shrink-0 flex items-center justify-between ${headerCls}`}>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <p className="text-white/80 text-sm">
              {filters.length} filter(s) waiting {isReview ? 'for review' : 'for approval'} in this block · {picked.length} selected
            </p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white shrink-0" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr className="text-xs text-slate-500 [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-slate-200">
                <th className="w-8">
                  <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all"
                    className="w-4 h-4 rounded border-slate-300 text-[var(--theme-primary)] focus:ring-[var(--theme-focus-ring)] cursor-pointer" />
                </th>
                <th>Filter</th>
                <th>Area</th>
                <th>AHU</th>
                <th>AHU Type</th>
                <th>Filter Type</th>
                <th>Micron</th>
                <th>Dimensions</th>
                <th>Set</th>
                <th>RFID</th>
                <th>Submitted</th>
                {!isReview && <th>Reviewed</th>}
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filters.map(f => {
                const a = attribution.get(f.id);
                const on = selected.has(f.id);
                return (
                  <tr key={f.id} className={`[&>td]:px-3 [&>td]:py-2 [&>td]:whitespace-nowrap ${on ? 'bg-[var(--theme-primary-light)]' : 'hover:bg-slate-50/60'}`}>
                    <td>
                      <input type="checkbox" checked={on} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`}
                        className="w-4 h-4 rounded border-slate-300 text-[var(--theme-primary)] focus:ring-[var(--theme-focus-ring)] cursor-pointer" />
                    </td>
                    <td className="font-medium text-slate-800">{f.name}</td>
                    <td className="text-slate-600">{dash(f.areaName)}</td>
                    <td className="text-slate-600">{dash(f.ahuName)}</td>
                    <td className="text-slate-600">{dash(f.ahuType)}</td>
                    <td className="text-slate-600">{dash(f.filterType)}</td>
                    <td className="text-slate-600">{f.micronSize && f.micronSize !== '-' ? `${f.micronSize} µm` : '--'}</td>
                    <td className="text-slate-600">{dash(f.filterSize)}</td>
                    <td>
                      {f.filterSet ? (
                        <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${f.filterSet === 'SET_A' ? 'bg-blue-50 text-blue-700' : 'bg-brand-50 text-brand-700'}`}>
                          {f.filterSet === 'SET_A' ? 'Set A' : f.filterSet === 'SET_B' ? 'Set B' : f.filterSet}
                        </span>
                      ) : <span className="text-slate-300">--</span>}
                    </td>
                    <td className="font-mono text-xs text-slate-600">{dash(f.rfid)}</td>
                    <td className="text-xs text-slate-600">
                      {a?.submittedByName ?? (pending ? '--' : '…')}
                      {a?.submittedAt ? <span className="text-slate-400"> · {formatDateTime(a.submittedAt)}</span> : null}
                    </td>
                    {!isReview && (
                      <td className="text-xs text-slate-600" title={a?.reviewRemarks ?? undefined}>
                        {a?.reviewedByName ?? (pending ? '--' : '…')}
                        {a?.reviewedAt ? <span className="text-slate-400"> · {formatDateTime(a.reviewedAt)}</span> : null}
                        {a?.reviewRemarks ? <span className="block italic text-slate-500 truncate max-w-[220px]">“{a.reviewRemarks}”</span> : null}
                      </td>
                    )}
                    <td>
                      <button onClick={() => onViewDetails(f)} title="Filter Details"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filters.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-sm text-slate-400">Nothing is waiting on this step in this block.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 px-6 py-3 border-t border-slate-200 space-y-3">
          {!rejecting ? (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Remarks <span className="text-slate-400 font-normal">(optional, recorded on every selected filter)</span></label>
              <input value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder={isReview ? 'Anything the approver should know' : 'Approval remarks'}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-3 focus:ring-[var(--theme-primary)] focus:border-[var(--theme-primary)]" />
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <label className="block text-sm font-medium text-red-800 mb-1">
                Rejection reason for the {picked.length} selected filter(s) <span className="text-red-500">*</span>
              </label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} autoFocus
                placeholder="One reason recorded on every selected filter. They stay in the list as Rejected so they can be corrected and resubmitted."
                className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm bg-white focus:ring-3 focus:ring-red-400 focus:border-red-400" />
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={rejecting ? () => setRejecting(false) : onClose} disabled={submitting}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
              {rejecting ? 'Back' : 'Cancel'}
            </button>
            <div className="flex-1" />
            {canReject && !rejecting && (
              <button onClick={() => setRejecting(true)} disabled={submitting || picked.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium text-rose-700 border border-rose-300 bg-white hover:bg-rose-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                Reject selected ({picked.length})…
              </button>
            )}
            {rejecting && (
              <button onClick={() => onReject(picked, rejectReason.trim())} disabled={submitting || picked.length === 0 || !rejectReason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-700 hover:bg-rose-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? 'Rejecting…' : `Confirm Reject (${picked.length})`}
              </button>
            )}
            {!rejecting && (
              <button onClick={() => onComplete(picked, remarks.trim())} disabled={submitting || picked.length === 0}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isReview ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {submitting ? (isReview ? 'Completing…' : 'Approving…') : `${verb} (${picked.length})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
