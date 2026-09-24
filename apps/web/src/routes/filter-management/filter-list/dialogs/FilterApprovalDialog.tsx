import { useState } from 'react';
import useSWR from 'swr';

// Filter creation workflow — the details popup (2026-09-24).
//
// ONE dialog for three moments: a reviewer completing the review, an approver
// approving, and anyone opening a pending filter to look at it. The decision
// is taken HERE, with the filter's details in front of the decider, rather
// than from a bulk bar that showed a count and nothing else.
//
// Everything the row already knows is passed in (`filter`) so the popup paints
// immediately; the workflow attribution (who submitted / reviewed / rejected,
// when, remarks) and the template attributes are fetched from
// GET /api/assets/instances/:id, which returns the full asset_instances row.
// If that fetch fails the popup still works from the row data — the decision
// buttons never depend on it.

export type ApprovalDialogMode = 'view' | 'review' | 'approve';

export type ApprovalDialogFilter = {
  id: string;
  name: string;
  approvalStatus: string;
  blockName?: string | null;
  areaName?: string | null;
  ahuName?: string | null;
  ahuType?: string | null;
  filterType?: string | null;
  micronSize?: string | null;
  filterSize?: string | null;
  filterSet?: string | null;
  currentState?: string | null;
  rfid?: string | null;
  lastCleanedAt?: string | null;
};

type Props = {
  filter: ApprovalDialogFilter;
  mode: ApprovalDialogMode;
  /** Reject is offered inside the review / approve popups to either workflow role. */
  canReject: boolean;
  submitting: boolean;
  formatDateTime: (v: string | Date) => string;
  onClose: () => void;
  /** Complete Review (mode 'review') or Approve (mode 'approve'). */
  onComplete: (remarks: string) => void;
  onReject: (reason: string) => void;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING_REVIEW: { label: 'Pending Review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PENDING_APPROVAL: { label: 'Pending Approval', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  APPROVED: { label: 'Approved', cls: 'bg-green-50 text-green-700 border-green-200' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
};

// The attributes the row columns already show, so the "other fields" section
// lists only what the table does not.
const SHOWN_ATTRIBUTES = new Set(['filterType', 'ahuType', 'micronSize', 'filterSize', 'lastCleaningDate']);

function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
}

function dash(v: unknown): string {
  if (v === null || v === undefined || v === '' || v === '-') return '--';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function FilterApprovalDialog({ filter, mode, canReject, submitting, formatDateTime, onClose, onComplete, onReject }: Props) {
  const [remarks, setRemarks] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: detail, error: detailError } = useSWR<any>(`/api/assets/instances/${filter.id}`);

  const status = (detail?.approvalStatus as string | undefined) ?? filter.approvalStatus;
  const badge = STATUS_LABEL[status] ?? { label: status, cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  const attrs: Record<string, unknown> = (detail?.attributes as Record<string, unknown>) ?? {};
  const schemaFields: { fieldName: string; unit?: string }[] = Array.isArray(detail?.template?.attributeSchema) ? detail.template.attributeSchema : [];
  // Template-declared fields first (in schema order), then any stray keys.
  const extraKeys = [
    ...schemaFields.map(f => f.fieldName).filter(k => !SHOWN_ATTRIBUTES.has(k)),
    ...Object.keys(attrs).filter(k => !SHOWN_ATTRIBUTES.has(k) && !schemaFields.some(f => f.fieldName === k)),
  ];
  const unitOf = (k: string) => schemaFields.find(f => f.fieldName === k)?.unit;

  const rfid = filter.rfid
    ?? (Array.isArray(detail?.identifiers) ? detail.identifiers.find((i: any) => i.identifierType === 'RFID')?.identifierValue : null)
    ?? null;

  const isDecision = mode === 'review' || mode === 'approve';
  const title = mode === 'review' ? 'Review Filter' : mode === 'approve' ? 'Approve Filter' : 'Filter Details';
  const subtitle = mode === 'review'
    ? 'Check the details below, then complete the review to send this filter for approval.'
    : mode === 'approve'
      ? 'Check the details below. Once approved, this filter can be cleaned and operated.'
      : status === 'APPROVED'
        ? 'Approved filter. The workflow record below shows who submitted, reviewed and approved it.'
        : status === 'REJECTED'
          ? 'Rejected. Correct it and resubmit before it can be used.'
          : 'This filter is in the creation workflow and cannot be operated yet.';
  const headerCls = mode === 'review'
    ? 'bg-gradient-to-r from-amber-500 to-orange-500'
    : mode === 'approve'
      ? 'bg-gradient-to-r from-green-600 to-emerald-500'
      : 'bg-gradient-to-r from-slate-600 to-slate-500';

  const Row = ({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) => (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-100 last:border-b-0">
      <span className="text-xs font-medium text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm text-slate-800 text-right break-words min-w-0 ${mono ? 'font-mono text-xs' : ''}`}>{dash(value)}</span>
    </div>
  );

  const Who = ({ label, name, at, remarksText }: { label: string; name?: string | null; at?: string | null; remarksText?: string | null }) => {
    if (!name && !at) return null;
    return (
      <div className="py-1.5 border-b border-slate-100 last:border-b-0">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs font-medium text-slate-500 shrink-0">{label}</span>
          <span className="text-sm text-slate-800 text-right">
            {name ?? '--'}{at ? <span className="text-xs text-slate-500"> · {formatDateTime(at)}</span> : null}
          </span>
        </div>
        {remarksText ? <p className="mt-1 text-xs text-slate-600 italic text-right">“{remarksText}”</p> : null}
      </div>
    );
  };

  const submitReject = () => {
    if (!rejectReason.trim()) return;
    onReject(rejectReason.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4" data-testid="filter-approval-dialog">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl">
        <div className={`px-6 py-4 shrink-0 flex items-center justify-between ${headerCls}`}>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{title}</h2>
            <p className="text-white/80 text-sm truncate">{filter.name}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white shrink-0" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 170px)' }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">{subtitle}</p>
            <span className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.cls}`}>{badge.label}</span>
          </div>

          {detailError && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              Could not load the full record ({detailError?.message ?? 'request failed'}). Showing the list data only.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Location</h3>
              <Row label="Block" value={filter.blockName} />
              <Row label="Area" value={filter.areaName} />
              <Row label="AHU" value={filter.ahuName} />
              <Row label="AHU Type" value={filter.ahuType} />
            </div>
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Filter</h3>
              <Row label="Filter Type" value={filter.filterType} />
              <Row label="Micron Size" value={filter.micronSize && filter.micronSize !== '-' ? `${filter.micronSize} µm` : null} />
              <Row label="Filter Size" value={filter.filterSize} />
              <Row label="Set" value={filter.filterSet === 'SET_A' ? 'Set A' : filter.filterSet === 'SET_B' ? 'Set B' : filter.filterSet} />
              <Row label="RFID Tag" value={rfid} mono />
              <Row label="Cleaning Status" value={filter.currentState ? filter.currentState.replace(/_/g, ' ') : 'To Be Cleaned'} />
              <Row label="Last Cleaned" value={filter.lastCleanedAt ? formatDateTime(filter.lastCleanedAt) : 'NA'} />
            </div>
          </div>

          {extraKeys.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Other Fields</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                {extraKeys.map(k => (
                  <Row key={k} label={humanize(k)} value={attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '' && unitOf(k) ? `${attrs[k]} ${unitOf(k)}` : attrs[k]} />
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Workflow</h3>
            {detail ? (
              <>
                <Who label="Submitted by" name={detail.submittedByName} at={detail.submittedAt} />
                <Who label="Reviewed by" name={detail.reviewedByName} at={detail.reviewedAt} remarksText={detail.reviewRemarks} />
                <Who label="Approved by" name={detail.approvedByName} at={detail.approvedAt} remarksText={detail.approvalRemarks} />
                <Who label="Rejected by" name={detail.rejectedByName} at={detail.rejectedAt} remarksText={detail.rejectionRemarks} />
                {!detail.submittedByName && !detail.reviewedByName && !detail.approvedByName && !detail.rejectedByName && (
                  <p className="text-xs text-slate-400 py-1.5">No workflow history recorded.</p>
                )}
              </>
            ) : detailError ? (
              <p className="text-xs text-slate-400 py-1.5">Unavailable.</p>
            ) : (
              <p className="text-xs text-slate-400 py-1.5">Loading…</p>
            )}
          </div>

          {isDecision && !rejecting && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Remarks <span className="text-slate-400 font-normal">(optional)</span></label>
              <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
                placeholder={mode === 'review' ? 'Anything the approver should know' : 'Approval remarks'}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:border-[var(--theme-primary)]" />
            </div>
          )}

          {isDecision && rejecting && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <label className="block text-sm font-medium text-red-800 mb-1">Rejection reason <span className="text-red-500">*</span></label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} autoFocus
                placeholder="Why this filter is being rejected. It stays in the list as Rejected so it can be corrected and resubmitted."
                className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-400 focus:border-red-400" />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
          <button onClick={rejecting ? () => setRejecting(false) : onClose} disabled={submitting}
            className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
            {rejecting ? 'Back' : isDecision ? 'Cancel' : 'Close'}
          </button>
          <div className="flex-1" />
          {isDecision && canReject && !rejecting && (
            <button onClick={() => setRejecting(true)} disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium text-rose-700 border border-rose-300 bg-white hover:bg-rose-50 transition-colors disabled:opacity-50">
              Reject…
            </button>
          )}
          {isDecision && rejecting && (
            <button onClick={submitReject} disabled={submitting || !rejectReason.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-700 hover:bg-rose-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          )}
          {isDecision && !rejecting && (
            <button onClick={() => onComplete(remarks.trim())} disabled={submitting}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${mode === 'review' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-green-600 hover:bg-green-700'}`}>
              {submitting ? (mode === 'review' ? 'Completing…' : 'Approving…') : (mode === 'review' ? 'Complete Review' : 'Approve')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
