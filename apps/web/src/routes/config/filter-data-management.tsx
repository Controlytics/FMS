import { Fragment, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { isoToDatetimeInput, toIsoIfNaiveDatetime } from '@/lib/datetime-input';
import { formatByLeastCount } from '@/lib/format-by-least-count';
import { ManualEntryBadge } from '@/components/manual-entry-badge';

// Helpers copied from cleaning-cycles/history.tsx + filter-traceability.tsx so
// the data-management view renders rows identically to the user-facing pages.
// Keeping them inline (rather than in a shared module) keeps the data-management
// page self-contained and avoids a refactor of the existing pages.
const CYCLE_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  COMPLETED: { label: 'Completed', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  TERMINATED: { label: 'Terminated', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
};
function getStageInfoFromEvents(events: any[], stage: string) {
  const stageEvents = (events ?? []).filter((e: any) => e.eventType === 'STATE_TRANSITION' && e.toState === stage);
  // DRY_IN — require the SUBMIT_READINGS event; the SET_DURATION event
  // (which entered DRY_IN with no readings) should not back-fill the time
  // column. Same rule as cleaning-cycles/history.tsx — operator request
  // 2026-05-25: DRY_IN time = temperature submission time only.
  const requireReadings = stage === 'DRY_IN';
  const evWithReadings = stageEvents.find((e: any) => (e.attributes as any)?.instrumentReadings?.length > 0);
  const ev = evWithReadings ?? (requireReadings ? null : stageEvents[0]);
  if (!ev) return null;
  return {
    time: ev.performedAt,
    performedBy: ev.performedByName ?? ev.performedBy?.substring(0, 8) ?? '-',
    readings: (ev.attributes as any)?.instrumentReadings ?? [],
  };
}
function getReadingValue(readings: any[], desc: string) {
  const r = readings.find((x: any) => x.description?.toLowerCase().includes(desc.toLowerCase()));
  if (!r) return '-';
  const formatted = r.leastCount !== undefined && r.leastCount !== null
    ? formatByLeastCount(r.value, r.leastCount)
    : String(r.value);
  return `${formatted} ${r.uom ?? ''}`.trim();
}
function getCycleDuration(cycle: any) {
  const end = cycle.completedAt ?? (cycle.status === 'IN_PROGRESS' ? new Date().toISOString() : null);
  if (!end) return '-';
  const ms = new Date(end).getTime() - new Date(cycle.startedAt).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

// Alarm helpers + Alarms tab removed 2026-05-17 (alarm subsystem retired).

import { getAuditStatus } from '../audit/audit-helpers';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { Pagination } from '@/components/ui/pagination';
import { usePaginationDefaults } from '@/hooks/use-pagination-config';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

/**
 * Lifecycle states offered by the From/To dropdowns.
 *
 * These were free-text inputs, and the live data shows exactly what that costs:
 * WASH_IN, WASHIN, washin and WASH-IN all exist as separate values, as do
 * washout / WASHOUT / WASH_OUT. Every one of those is invisible to the stage
 * lookups (`getStageInfoFromEvents` matches `toState === 'WASH_IN'`), so a typo
 * silently blanks the Wash In column for that cycle.
 *
 * The six cleaning stages plus the cycle-level markers that legitimately appear
 * in from/to. A value already on the row is added to the list at render time, so
 * opening the dialog on a legacy row never silently discards its current value.
 */
const LIFECYCLE_STATES = [
  'WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT',
  'CYCLE_STARTED', 'CLEANING_CYCLE_COMPLETED', 'IN_USE',
];

/** The canonical list plus `current`, so an existing odd value is never lost. */
function statesWith(current?: string): string[] {
  const v = (current ?? '').trim();
  return v && !LIFECYCLE_STATES.includes(v) ? [v, ...LIFECYCLE_STATES] : LIFECYCLE_STATES;
}

// PM entry helpers — month names + status derivation matches /pm-schedules/:entityId detail page
const PM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Audit-trail Success/Fail: import the /audit page's own rule rather than
// re-deriving it. The local copy this replaces claimed parity but used a
// substring heuristic, so anything containing REJECT/DENIED (e.g.
// STAGE_APPROVAL_REJECTED, PASSWORD_RESET_REQUEST_REJECTED) rendered "Fail"
// here and "Success" on /audit for the same row.

/** Minimum length of the mandatory change reason — mirrors the API's check. */
const MIN_REASON_LEN = 5;
const reasonOk = (r: string) => r.trim().length >= MIN_REASON_LEN;

/**
 * Mandatory justification input. Every create / edit / delete on this page is
 * written to the audit trail with this text, so it is a required field, not a
 * courtesy note. Declared at module scope (not inline in the page component)
 * so React keeps the same element across re-renders and the textarea does not
 * lose focus on every keystroke.
 */
function ReasonBox({ value, onChange, danger, hint }: { value: string; onChange: (v: string) => void; danger?: boolean; hint?: string }) {
  const short = MIN_REASON_LEN - value.trim().length;
  return (
    <div className="mt-4">
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
        Reason for this change <span className="text-red-500">*</span>
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        placeholder="Why is this record being changed?"
        className={`w-full px-3 py-2 border rounded-lg text-[13px] resize-none focus:ring-2 focus:outline-none ${
          danger ? 'border-red-200 focus:ring-red-500/30 focus:border-red-400' : 'border-slate-200 focus:ring-cyan-500/30 focus:border-cyan-400'
        }`}
      />
      <p className="text-[11px] text-slate-400 mt-1">
        {short > 0 ? `${short} more character${short === 1 ? '' : 's'} required` : (hint ?? 'Recorded on the audit trail alongside the before/after values.')}
      </p>
    </div>
  );
}

// Notification type → color (matches /notifications typeColors)
const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
  CYCLE_STARTED: 'bg-blue-50 text-blue-700 border-blue-200',
  CYCLE_COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CYCLE_TERMINATED: 'bg-red-50 text-red-700 border-red-200',
  ACCOUNT_LOCKED: 'bg-red-50 text-red-700 border-red-200',
  PASSWORD_RESET_REQUEST: 'bg-amber-50 text-amber-700 border-amber-200',
  USER_CREATED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

// Admin request type + status badges (mirrors /admin-requests)
const ADMIN_REQ_TYPE_LABELS: Record<string, string> = {
  CREATE_USER: 'Create User',
  RESET_PASSWORD: 'Reset Password',
  UNLOCK_USER: 'Unlock User',
  MODIFY_USER: 'Modify User',
};
const ADMIN_REQ_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

// Block-change status badges (mirrors /approvals STATUS_CONFIG)
const BLOCK_CHANGE_STATUS: Record<string, { label: string; bg: string; text: string; dot: string; bar: string }> = {
  PENDING: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', bar: 'bg-gradient-to-r from-amber-400 to-orange-400' },
  APPROVED: { label: 'Approved', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400', bar: 'bg-gradient-to-r from-emerald-400 to-green-500' },
  REJECTED: { label: 'Rejected', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-400', bar: 'bg-gradient-to-r from-red-400 to-rose-500' },
  CONSUMED: { label: 'Consumed', bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400', bar: 'bg-gradient-to-r from-slate-300 to-slate-400' },
};

function getPmEntryStatus(entry: any): { label: string; bg: string; text: string; border: string; cardBorder: string } {
  const exec = entry.execution;
  const now = new Date();
  const windowStart = entry.windowStart ? new Date(entry.windowStart) : null;
  const windowEnd = entry.windowEnd ? new Date(entry.windowEnd) : null;
  if (exec?.status === 'COMPLETED') return { label: 'Completed', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', cardBorder: 'border-green-600' };
  if (exec?.status === 'IN_PROGRESS') return { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', cardBorder: 'border-blue-600' };
  if (!exec && windowEnd && now > windowEnd) return { label: 'Overdue', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', cardBorder: 'border-red-600' };
  if (!exec && windowStart && windowEnd && now >= windowStart && now <= windowEnd) return { label: 'Due', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', cardBorder: 'border-amber-600' };
  return { label: 'Scheduled', bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', cardBorder: 'border-slate-200' };
}

// Local field renderer used by the row-edit modal. Keeps the modal markup
// readable and gives all inputs the same styling without an external dep.
function Field(props: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  select?: boolean;
  options?: string[];
  // Object-valued dropdown (value ≠ label) — used by the Create modal's FK
  // pickers so a SUPER_ADMIN picks a filter/profile/schedule by name, not UUID.
  optionObjs?: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}) {
  const { label, value, onChange, type = 'text', textarea, select, options, optionObjs, placeholder, required } = props;
  const cls = 'w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-[13px] text-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none';
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {optionObjs ? (
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">{placeholder ?? 'Select…'}</option>
          {optionObjs.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : select ? (
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls}>
          {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : textarea ? (
        <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={2} className={cls} />
      ) : (
        <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </div>
  );
}

interface RetiredFilter {
  id: string; name: string; updatedAt: string; filterSet: string | null; attributes: any;
  preRetireParentId: string | null; preRetireParentName: string | null;
}

interface ReplacementRecord {
  id: string; oldFilterId: string; oldFilterName: string;
  newFilterId: string; newFilterName: string;
  remarks: string | null; replacedAt: string; performedBy: string;
}

// The six data surfaces that support inline edit AND (new) create.
type RowEntity = 'cycle' | 'event' | 'pm-entry' | 'notification' | 'admin-request' | 'block-change';
// Tab key → create entity (tabs not listed here have no create support:
// retirements/replacements own their workflows; audit-trail is immutable).
const TAB_CREATE_ENTITY: Record<string, RowEntity> = {
  'cleaning-cycles': 'cycle',
  'filter-events': 'event',
  'pm-entries': 'pm-entry',
  'notifications': 'notification',
  'admin-requests': 'admin-request',
  'block-changes': 'block-change',
};
// Enum option lists (mirror the Prisma enums) so create-modal selects can't
// submit an invalid value the DB would reject.
const FILTER_EVENT_TYPES = ['STATE_TRANSITION', 'PARAMETER_CAPTURE', 'CHECKLIST_COMPLETED', 'BYPASS_DEVIATION', 'EQUIPMENT_LINKED', 'REMARK_ADDED', 'APPROVAL_GRANTED', 'SCRIPT_EXECUTED', 'CYCLE_STARTED', 'CYCLE_COMPLETED', 'CYCLE_TERMINATED'];
const NOTIFICATION_TYPES = ['ACCOUNT_LOCKED', 'ACCOUNT_DISABLED', 'ACCOUNT_ENABLED', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_APPROVED', 'PASSWORD_RESET_REJECTED', 'USER_CREATED', 'USER_UPDATED', 'ROLE_CHANGED', 'USER_CREATION_REQUEST_SUBMITTED', 'USER_CREATION_REQUEST_APPROVED', 'USER_CREATION_REQUEST_REJECTED', 'USER_LOGIN', 'USER_LOCKED', 'CHECKLIST_SUBMITTED', 'CHECKLIST_APPROVED', 'CHECKLIST_REJECTED', 'SYSTEM_ERROR', 'PM_OVERDUE', 'PM_OVERDUE_COMPLETED', 'PM_SCHEDULE_QNN', 'GUEST_CLEANING_REQUEST', 'REPORT_REVIEW_REQUESTED', 'REPORT_REVIEW_APPROVED', 'REPORT_REVIEW_REJECTED', 'PASSWORD_EXPIRY_WARNING', 'PASSWORD_EXPIRED_NOTICE', 'STAGE_APPROVAL_REQUESTED', 'STAGE_APPROVAL_APPROVED', 'STAGE_APPROVAL_REJECTED'];

/**
 * The status/type filter each tab offers, mirroring its user-facing page.
 *
 * `param` is only documentation here — the SWR keys above map `kindFilter` onto
 * the right query name per tab. A tab absent from this map gets the date range
 * and search only, because its endpoint supports nothing else and offering a
 * dropdown that silently does nothing is worse than offering none.
 */
const FILTERS_BY_TAB: Record<string, { label: string; options: { value: string; label: string }[] }> = {
  'cleaning-cycles': {
    label: 'Status',
    options: [
      { value: 'IN_PROGRESS', label: 'In Progress' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'TERMINATED', label: 'Terminated' },
      { value: 'RETIRED', label: 'Retired' },
      { value: 'REPLACED', label: 'Replaced' },
    ],
  },
  'filter-events': {
    label: 'Event Type',
    options: FILTER_EVENT_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') })),
  },
  'pm-entries': {
    label: 'Approval',
    options: [
      { value: 'PENDING_REVIEW', label: 'Pending Review' },
      { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
      { value: 'PENDING', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
  notifications: {
    label: 'Type',
    options: NOTIFICATION_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') })),
  },
  'admin-requests': {
    label: 'Status',
    options: [
      { value: 'PENDING', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
    ],
  },
  'block-changes': {
    label: 'Status',
    options: [
      { value: 'PENDING', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'REJECTED', label: 'Rejected' },
      { value: 'EXPIRED', label: 'Expired' },
    ],
  },
};

/**
 * Tabs whose endpoint returns the WHOLE set with no paging or date support, so
 * the date range and the paging are applied in the browser. That is correct
 * here and only here — doing it on a server-paginated tab would filter just the
 * rows that came back.
 */
const CLIENT_PAGED_TABS = new Set(['retirements', 'replacements', 'admin-requests']);


/**
 * One cleaning cycle's lifecycle — the ordered stage history that cycle actually
 * went through, with each step editable in place.
 *
 * The Filter Events tab lists EVERY event in the system; when an operator is
 * looking at one cycle and wants to correct a stage time or a remark, hunting
 * for it there is the wrong shape of work. This panel scopes the same rows to
 * the cycle in front of them.
 *
 * No extra request: the cycles feed is already fetched with `includeEvents=true`,
 * so the events are data the page is holding either way. Editing goes through
 * the SAME event dialog and the SAME audited endpoint as the Filter Events tab —
 * a second edit path would be a second set of rules to keep in step.
 */
function LifecyclePanel({
  cycle,
  formatDateTime,
  onEditEvent,
  onDeleteEvent,
}: {
  cycle: any;
  formatDateTime: (d: string) => string;
  onEditEvent: (ev: any) => void;
  onDeleteEvent: (ev: any) => void;
}) {
  const events: any[] = [...(cycle.events ?? [])].sort(
    (a, b) => new Date(a.performedAt).getTime() - new Date(b.performedAt).getTime(),
  );

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[12px] text-slate-400">
        This cycle has no recorded stage events yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Lifecycle · {cycle.cycleCode ?? cycle.filterName}
        </span>
        <span className="text-[11px] text-slate-400">{events.length} step{events.length === 1 ? '' : 's'}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {events.map((ev, i) => (
          <div key={ev.id} className="group flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50/60">
            {/* Step number + the transition, which is what an operator scans for. */}
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-800">{ev.eventType}</span>
                {(ev.fromState || ev.toState) && (
                  <span className="text-[11px] text-slate-500">
                    {ev.fromState ?? '—'} <span className="text-slate-300">→</span> {ev.toState ?? '—'}
                  </span>
                )}
                <ManualEntryBadge manual={ev.manualEntry} />
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                <span>{formatDateTime(ev.performedAt)}</span>
                {ev.performedByName && <span>by {ev.performedByName}</span>}
                {ev.remarks && <span className="text-slate-500">“{ev.remarks}”</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
              <button onClick={() => onEditEvent(ev)}
                className="rounded-lg px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-100">Edit</button>
              <button onClick={() => onDeleteEvent(ev)}
                className="rounded-lg px-2 py-1 text-[10px] font-medium text-red-500 hover:bg-red-50">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FilterDataManagementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDateTime, config: datetimeConfig } = useDatetimeFormat();
  // datetime-local inputs carry no zone, so every stored instant must be
  // converted to the configured zone's wall clock on the way in and back to an
  // explicit-UTC instant on the way out — otherwise the input shows the UTC
  // clock while the label beside it shows local, and saving shifts the record
  // by the zone offset. See lib/datetime-input.ts.
  const tz = datetimeConfig.timezone;
  const toInput = (iso: string | null | undefined) => isoToDatetimeInput(iso, tz);
  const [tab, setTab] = useState<string>('retirements');

  // ── Pagination + filters (2026-08-27) ────────────────────────────────────
  // Every tab used to be pinned to `?page=1&limit=50`, so records past the
  // first page were simply unreachable — on a table with 18k audit rows that
  // is 0.3% of the data. Each tab now pages properly and offers the filters its
  // user-facing page offers.
  //
  // Filtering happens SERVER-side wherever the endpoint supports it. Filtering a
  // server-paginated list in the browser would only ever filter the rows that
  // came back, so "no results" would be indistinguishable from "none on this
  // page". The two array endpoints (retirements / replacements) return the whole
  // set, so those are filtered and paged client-side — which is correct there.
  const { options: pageSizeOptions, defaultLimit } = usePaginationDefaults();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultLimit);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** Status / type filter — meaning depends on the tab (see FILTERS_BY_TAB). */
  const [kindFilter, setKindFilter] = useState('');

  // Any filter change must return to page 1: staying on page 7 of a freshly
  // narrowed result set shows an empty table that looks like a bug.
  const resetPaging = () => setPage(1);
  // Switching tabs clears filters — they mean different things per tab, and a
  // status carried from Block Changes into PM Entries would silently return
  // nothing.
  const switchTab = (key: string) => {
    setTab(key);
    setEditingId(null);
    setSearch('');
    setPage(1);
    setDateFrom('');
    setDateTo('');
    setKindFilter('');
  };

  /**
   * Widen a bare `yyyy-mm-dd` into a full instant.
   *
   * `/api/filters/cycles` and `/api/filters/events` declare their range as
   * `format: 'date-time'`, so a bare date is rejected outright by schema
   * validation — the tab would 400 the moment anyone touched the date filter.
   * Building the instant WITHOUT a trailing Z means it is interpreted in the
   * operator's local zone, so "5 Aug" is their 5 Aug, not UTC's.
   *
   * The end is the last millisecond of the day, the same "a bare end date covers
   * the whole day" rule as `listWhere` on the server and `inDateRange` below.
   * All three have to agree or one filter means three different things.
   */
  const asInstant = (value: string, edge: 'start' | 'end') => {
    if (!value) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; // already carries a time
    const d = new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  };

  /** Query fragment shared by every server-filtered list. */
  const listParams = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (dateFrom) q.set('from', asInstant(dateFrom, 'start'));
    if (dateTo) q.set('to', asInstant(dateTo, 'end'));
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return q.toString();
  };
  const [processing, setProcessing] = useState(false);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  // Retirement/replacement rows have no Delete — deleting them meant destroying
  // FILTER_RETIRED / FILTER_REPLACED audit rows, which 21 CFR §11 forbids.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  // Edit-row modal for cycles/events tabs. Shows only the columns that live
  // ON the underlying DB row (vs. the derived display columns in the table).
  // For cleaning_cycles: cycleCode, status, cleaningReasonLabel, startedAt,
  //   completedAt, terminatedAt, terminationReason, sequenceNumber,
  //   dryerDurationMinutes, dryerStartedAt
  // For filter_events:  eventType, fromState, toState, performedAt, remarks
  // (checksum deliberately excluded — editing would break the SHA-256 hash chain)
  const [rowEditDialog, setRowEditDialog] = useState<{ id: string; entity: RowEntity; rowName: string } | null>(null);
  const [rowEditFields, setRowEditFields] = useState<Record<string, any>>({});
  const [rowEditSaving, setRowEditSaving] = useState(false);
  // Create-row modal — a mirror of the edit modal that INSERTS a new row into
  // the tab's underlying table (manual / back-dated records). Same columns as
  // edit plus the required FKs a fresh row can't exist without (filter,
  // profile, schedule…), surfaced as name-based dropdowns.
  const [createDialog, setCreateDialog] = useState<{ entity: RowEntity } | null>(null);
  const [createFields, setCreateFields] = useState<Record<string, any>>({});
  const [createSaving, setCreateSaving] = useState(false);
  const [unretireDialog, setUnretireDialog] = useState<{ id: string; name: string; preRetireParentId: string | null; preRetireParentName: string | null } | null>(null);
  const [unretireParentId, setUnretireParentId] = useState('');

  // ── Mandatory change reason (2026-08-27 audit retrofit) ──────────────────
  // `changeReason` backs the ReasonBox embedded in the dialogs that already
  // exist (row edit / create / delete / unretire). `reasonPrompt` is a
  // standalone modal for the INLINE row edits (Retirements, Replacements,
  // generic tabs) and for row actions with no dialog of their own — putting a
  // textarea inside a table row is not workable, and stacking a second modal on
  // top of an existing one is worse than either.
  // ── Re-authentication ────────────────────────────────────────────────────
  // Every mutation below is reauth-gated server-side: the super-admin data and
  // filter-data routes on SUPER_ADMIN_DATA_EDIT, the audit-row actions on their
  // own keys. `apiClient` does NOT prompt — it just rethrows REAUTH_REQUIRED —
  // so a page that calls it directly shows an unexplained error toast the moment
  // an operator switches that action on in Config → Action Reauth. This page did
  // exactly that until 2026-08-27; every call now goes through `gated()`, which
  // is a no-op when the action isn't configured and opens the password dialog
  // when it is.
  const reauth = useReauth();
  const gated = <T,>(action: string, fn: (password?: string) => Promise<T>): Promise<T> =>
    reauth.executeWithResult(action, fn);
  /** A cancelled/superseded password prompt is a choice, not a failure — no toast. */
  const isReauthAbort = (e: any) => e?.error === 'REAUTH_CANCELLED' || e?.error === 'REAUTH_SUPERSEDED';

  // Which cleaning cycle has its lifecycle expanded. The cycles feed already
  // ships each cycle's events (`includeEvents=true`), so this needs no extra
  // request — the stage history is data we are already holding.
  const [openLifecycle, setOpenLifecycle] = useState<string | null>(null);
  /** The event's readings as stored, so identity fields survive an edit. */
  const [rowEditReadings, setRowEditReadings] = useState<any[]>([]);

  // Users for the "Performed By" picker. Fetched only while an event edit is
  // open — the console has nine tabs and most never need this list.
  const usersData = useSWR<any>(rowEditDialog?.entity === 'event' ? '/api/users?page=1&limit=500' : null);
  const userOptions = ((usersData.data as any)?.data ?? []).map((u: any) => ({
    value: u.id,
    label: `${u.fullName ?? u.username} (${u.username})`,
  }));

  const [changeReason, setChangeReason] = useState('');
  // Audit-row edit dialog (Audit Trail tab). Only the fields that are safe to
  // correct — checksum / previousChecksum / chainPosition are deliberately
  // absent, since editing them would let an operator forge a chain link and
  // hide the break this very edit creates.
  const [auditEditDialog, setAuditEditDialog] = useState<{ id: string; action: string } | null>(null);
  const [auditEditFields, setAuditEditFields] = useState<Record<string, string>>({});
  const [auditEditSaving, setAuditEditSaving] = useState(false);
  // Manual retirement / replacement creation. Both pick EXISTING filters rather
  // than inventing one: a retirement record is a live filter moved to Retired,
  // and a replacement record names the two filters involved. Creating a filter
  // from scratch belongs on the Filters page, not here.
  const [manualRecordDialog, setManualRecordDialog] = useState<{ kind: 'retirement' | 'replacement' } | null>(null);
  const [manualRecordFields, setManualRecordFields] = useState<Record<string, string>>({});
  const [manualRecordSaving, setManualRecordSaving] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState<{
    title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean;
    run: (reason: string) => Promise<void>;
  } | null>(null);
  const [promptReason, setPromptReason] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);
  const askReason = (opts: { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; run: (reason: string) => Promise<void> }) => {
    setPromptReason('');
    setReasonPrompt(opts);
  };
  const runReasonPrompt = async () => {
    if (!reasonPrompt || promptBusy || !reasonOk(promptReason)) return;
    setPromptBusy(true);
    try {
      await reasonPrompt.run(promptReason.trim());
      setReasonPrompt(null);
      setPromptReason('');
    } catch (e: any) {
      if (!isReauthAbort(e)) toast.error('Failed', e?.message ?? 'Could not apply the change');
    }
    setPromptBusy(false);
  };

  /**
   * Date-range predicate for the tabs whose endpoint returns the whole set.
   * Compares on the row's own date field. `to` covers the whole day, matching
   * the server-side `listWhere` helper — the two must agree or the same filter
   * would mean different things on different tabs.
   */
  const inDateRange = (value: string | Date | null | undefined) => {
    if (!dateFrom && !dateTo) return true;
    if (!value) return false;
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) return false;
    if (dateFrom && t < new Date(dateFrom).getTime()) return false;
    if (dateTo) {
      const end = /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? new Date(`${dateTo}T23:59:59.999`) : new Date(dateTo);
      if (t > end.getTime()) return false;
    }
    return true;
  };
  /** Slice the current page out of an already-filtered array. */
  const clientPage = <T,>(rows: T[]): T[] => rows.slice((page - 1) * pageSize, page * pageSize);

  const { data: retirements, isLoading: retLoading } = useSWR<RetiredFilter[]>('/api/filters/retirements');
  const { data: replacements, isLoading: repLoading } = useSWR<ReplacementRecord[]>('/api/filters/replacements');

  // Generic data tabs — columns mirror what's actually shown on the
  // corresponding user-facing pages so admins don't see internal UUIDs and
  // junk columns the operator never sees.
  //
  // cleaning-cycles, filter-events AND pm-entries are NOT in this list —
  // they have dedicated render branches below that hit the same enriched
  // endpoints the user-facing pages use (cycles join filter+events, events
  // use filter-traceability's card layout, pm-entries use the
  // /pm-schedules/:id detail-page card grid) so the data-management view
  // looks identical to what the operator sees.
  // All tabs that previously lived here — cleaning-cycles, filter-events,
  // pm-entries, audit-trail, notifications, admin-requests, and
  // block-changes — now have dedicated render branches that mirror their
  // user-facing pages. The genericTabs list is intentionally empty but
  // typed so TypeScript can still infer activeGenericTab's shape (and so
  // adding a future generic tab is a one-liner).
  type GenericTabDef = { key: string; label: string; endpoint: string; idField: string; columns: string[] };
  const genericTabs: GenericTabDef[] = [];
  const activeGenericTab = genericTabs.find((t: GenericTabDef) => t.key === tab);
  const { data: genericData, isLoading: genericLoading } = useSWR(
    activeGenericTab ? `${activeGenericTab.endpoint}?limit=50` : null
  );
  const genericRows: any[] = (genericData as any)?.data ?? [];

  // Enriched fetches for the dedicated cleaning-cycles + filter-events tabs.
  // These hit the SAME endpoints the user-facing /cleaning-cycles and
  // /filters/:id/trace?tab=events pages use, so the data-management view
  // displays the same joined+computed columns instead of raw DB rows.
  const cyclesEnriched = useSWR<any>(tab === 'cleaning-cycles' ? `/api/filters/cycles?${listParams({ status: kindFilter })}&includeEvents=true` : null);
  // Wave 5 A-01: replaced /api/assets/instances + /api/assets/templates with
  // /api/hierarchy/filters which returns typed filter rows directly — no
  // templateKind heuristic needed. The `id` field is the same AssetInstance
  // UUID referenced by cleaning_cycles.filter_id.
  const cycleFiltersData = useSWR<any>(tab === 'cleaning-cycles' ? '/api/hierarchy/filters' : null);
  const cycleFilterAttrMap = new Map<string, Record<string, any>>();
  (cycleFiltersData.data?.data ?? []).forEach((f: any) => {
    cycleFilterAttrMap.set(f.id, f.attributes ?? {});
  });
  const enrichedCycles: any[] = cyclesEnriched.data?.data ?? [];
  const filteredEnrichedCycles = enrichedCycles.filter(c => !search || c.filterName?.toLowerCase().includes(search.toLowerCase()) || c.cycleCode?.toLowerCase().includes(search.toLowerCase()));

  const eventsEnriched = useSWR<any>(tab === 'filter-events' ? `/api/filters/events?${listParams({ eventType: kindFilter })}` : null);
  const enrichedEvents: any[] = eventsEnriched.data?.data ?? [];
  const filteredEnrichedEvents = enrichedEvents.filter(e => !search || e.eventType?.toLowerCase().includes(search.toLowerCase()) || e.fromState?.toLowerCase().includes(search.toLowerCase()) || e.toState?.toLowerCase().includes(search.toLowerCase()));

  // Alarms tab removed 2026-05-17 (alarm subsystem retired).

  // Remaining tabs use the same super-admin data endpoints but are rendered
  // by dedicated branches that mirror their corresponding user-facing pages.
  // /api/audit names its range startDate/endDate (not from/to) and does its own
  // server-side search, so it builds its key rather than using listParams().
  const auditEnriched = useSWR<any>(tab === 'audit-trail' ? (() => {
    const q = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (dateFrom) q.set('startDate', asInstant(dateFrom, 'start'));
    if (dateTo) q.set('endDate', asInstant(dateTo, 'end'));
    if (kindFilter) q.set('action', kindFilter);
    return `/api/audit?${q.toString()}`;
  })() : null);
  const enrichedAudit: any[] = (auditEnriched.data as any)?.data ?? [];
  const filteredEnrichedAudit = enrichedAudit.filter(a => !search ||
    (a.action ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.userId ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.userName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.targetType ?? '').toLowerCase().includes(search.toLowerCase()));

  const notificationsEnriched = useSWR<any>(tab === 'notifications' ? `/api/super-admin/data/notifications?${listParams({ type: kindFilter })}` : null);
  const enrichedNotifications: any[] = (notificationsEnriched.data as any)?.data ?? [];
  const filteredEnrichedNotifications = enrichedNotifications.filter(n => !search ||
    (n.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (n.message ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (n.type ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (n.targetUserId ?? '').toLowerCase().includes(search.toLowerCase()));

  // /api/admin-requests supports `status` but has no paging or date range, so it
  // returns the whole set and is paged client-side below.
  const adminReqEnriched = useSWR<any>(tab === 'admin-requests' ? `/api/admin-requests${kindFilter ? `?status=${kindFilter}` : ''}` : null);
  const enrichedAdminReqs: any[] = (adminReqEnriched.data as any)?.data ?? (adminReqEnriched.data as any) ?? [];
  const filteredEnrichedAdminReqs = (Array.isArray(enrichedAdminReqs) ? enrichedAdminReqs : []).filter((r: any) => !search ||
    (r.requesterName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.requesterEmployeeId ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.requestType ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.status ?? '').toLowerCase().includes(search.toLowerCase()))
    .filter((r: any) => inDateRange(r.requestedAt));

  const blockChangesEnriched = useSWR<any>(tab === 'block-changes' ? `/api/block-change-requests?page=${page}&limit=${pageSize}&status=${kindFilter || 'ALL'}` : null);
  const enrichedBlockChanges: any[] = (blockChangesEnriched.data as any)?.data ?? [];
  const filteredEnrichedBlockChanges = enrichedBlockChanges.filter((b: any) => !search ||
    (b.filterName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (b.fromBlockName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (b.toBlockName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (b.status ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (b.requestedByName ?? '').toLowerCase().includes(search.toLowerCase()));

  // PM Entries tab — same super-admin endpoint as before, but rendered as
  // cards mirroring the /pm-schedules/:entityId detail-page layout. The
  // super-admin route already includes joined `execution` so the status
  // pill (Completed / In Progress / Overdue / Due / Scheduled) and timing
  // info match what operators see on the detail page.
  const pmEntriesEnriched = useSWR<any>(tab === 'pm-entries' ? `/api/super-admin/data/pm-entries?${listParams({ approvalStatus: kindFilter })}` : null);
  const enrichedPmEntries: any[] = (pmEntriesEnriched.data as any)?.data ?? [];
  const filteredEnrichedPmEntries = enrichedPmEntries.filter(e => {
    if (!search) return true;
    const monthName = (PM_MONTHS[(e.month ?? 1) - 1] ?? '').toLowerCase();
    const q = search.toLowerCase();
    return monthName.includes(q)
      || (e.approvalStatus ?? '').toLowerCase().includes(q)
      || (e.submittedByName ?? '').toLowerCase().includes(q)
      || (e.approvedByName ?? '').toLowerCase().includes(q)
      || (e.notes ?? '').toLowerCase().includes(q);
  });

  // ─── Create-modal dropdown sources ───────────────────────────────
  // Fetched only while a create dialog that needs them is open, so opening
  // other tabs stays cheap. Filters anchor cycles/events/block-changes;
  // profiles anchor cycles; PM-schedule options are derived from the already
  // loaded entries (there is no flat /pm-schedules list endpoint).
  const needFilterOpts = !!createDialog && (createDialog.entity === 'cycle' || createDialog.entity === 'event' || createDialog.entity === 'block-change');
  const createFiltersData = useSWR<any>(needFilterOpts ? '/api/hierarchy/filters' : null);
  const createProfilesData = useSWR<any>(createDialog?.entity === 'cycle' ? '/api/filter-cleaning-profiles?limit=200' : null);
  const createSchedulesData = useSWR<any>(createDialog?.entity === 'pm-entry' ? '/api/super-admin/data/pm-schedules' : null);
  const filterOpts: { value: string; label: string }[] = (createFiltersData.data?.data ?? []).map((f: any) => ({ value: f.id, label: f.name ?? f.id }));
  const profileOpts: { value: string; label: string }[] = (createProfilesData.data?.data ?? []).map((p: any) => ({ value: p.id, label: `${p.name ?? p.id}${p.version ? ` (v${p.version})` : ''}` }));
  const scheduleOpts: { value: string; label: string }[] = (createSchedulesData.data?.data ?? []).map((s: any) => ({
    value: s.id,
    label: `${s.entityName ?? `Entity ${String(s.entityId).slice(0, 8)}`} — ${s.year}${s.version ? ` (v${s.version})` : ''}`,
  }));

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="bg-white border border-red-200 rounded-2xl p-12 text-center max-w-md shadow-lg">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Access Restricted</h2>
          <p className="text-slate-500 text-sm">This page is available to Super Admin only.</p>
        </div>
      </div>
    );
  }

  const refreshAll = () => { globalMutate('/api/filters/retirements'); globalMutate('/api/filters/replacements'); };

  const filteredRetirements = (retirements ?? [])
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
    .filter(r => inDateRange((r as any).retiredAt ?? r.updatedAt));
  const filteredReplacements = (replacements ?? []).filter(r => !search ||
    r.oldFilterName.toLowerCase().includes(search.toLowerCase()) ||
    r.newFilterName.toLowerCase().includes(search.toLowerCase()) ||
    r.performedBy.toLowerCase().includes(search.toLowerCase()))
    .filter(r => inDateRange(r.replacedAt));

  const handleEditRetirement = (id: string, name: string) => {
    const body: any = {};
    if (editFields.name !== undefined) body.name = editFields.name;
    if (editFields.filterSet !== undefined) body.filterSet = editFields.filterSet;
    if (editFields.updatedAt !== undefined) body.updatedAt = toIsoIfNaiveDatetime(editFields.updatedAt, tz);
    askReason({
      title: 'Edit retirement record',
      body: <>Changes to <strong>{name}</strong> are recorded in the audit trail with the before and after values.</>,
      confirmLabel: 'Save changes',
      run: async (reason) => {
        await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
          ? apiClient.putWithReauth(`/api/super-admin/filter-data/retirements/${id}`, { ...body, _changeReason: reason }, pw)
          : apiClient.put(`/api/super-admin/filter-data/retirements/${id}`, { ...body, _changeReason: reason }));
        toast.success('Updated', 'Retirement record updated and audited');
        setEditingId(null); setEditFields({}); refreshAll();
      },
    });
  };

  // Deleting a retirement record deletes the retired filter asset itself. The
  // API refuses (409 HAS_HISTORY) when the filter still has cleaning cycles,
  // filter events, tags or children, and names them — surfaced verbatim here so
  // the operator learns what is attached instead of a generic failure.
  const handleDeleteRetirement = (id: string, name: string) => {
    askReason({
      title: 'Delete retirement record',
      danger: true,
      body: <><strong>{name}</strong> will be permanently removed. Its FILTER_RETIRED audit record is kept. Refused if the filter still has cleaning cycles, events or tags.</>,
      confirmLabel: 'Delete permanently',
      run: async (reason) => {
        await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
          ? apiClient.deleteWithReauth(`/api/super-admin/filter-data/retirements/${id}`, pw, { _changeReason: reason })
          : apiClient.delete(`/api/super-admin/filter-data/retirements/${id}`, { _changeReason: reason }));
        toast.success('Deleted', 'Retirement record removed and audited');
        refreshAll();
      },
    });
  };

  const handleUnretire = async (id: string) => {
    if (!reasonOk(changeReason)) return;
    setProcessing(true);
    try {
      await apiClient.post(`/api/super-admin/filter-data/retirements/${id}/unretire`, {
        parentId: unretireParentId || undefined,
        _changeReason: changeReason.trim(),
      });
      toast.success('Unretired', 'Filter restored to Active status');
      setUnretireDialog(null); setUnretireParentId(''); setChangeReason(''); refreshAll();
    } catch (e: any) { if (!isReauthAbort(e)) toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  // A replacement record IS an audit_trail row, so editing or deleting one
  // breaks the tamper-evident hash chain from that row onward — permanently and
  // by design. The warning below is not boilerplate; the operator is choosing
  // to invalidate verify-chain.
  const CHAIN_WARNING = (
    <span className="block mt-2 text-[12px] text-red-700">
      A replacement record is stored as an audit-trail row. This change breaks the
      audit hash chain from this record onward — <strong>permanently</strong>. The
      original values are preserved in a new audit record.
    </span>
  );

  const handleEditReplacement = (id: string, label: string) => {
    const body: any = {};
    for (const f of ['remarks', 'performedBy', 'replacedAt', 'oldFilterId', 'oldFilterName', 'newFilterId', 'newFilterName']) {
      if (editFields[f] !== undefined) body[f] = toIsoIfNaiveDatetime(editFields[f], tz);
    }
    askReason({
      title: 'Edit replacement record',
      danger: true,
      body: <>Editing the replacement record for <strong>{label}</strong>.{CHAIN_WARNING}</>,
      confirmLabel: 'Save changes',
      run: async (reason) => {
        await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
          ? apiClient.putWithReauth(`/api/super-admin/filter-data/replacements/${id}`, { ...body, _changeReason: reason }, pw)
          : apiClient.put(`/api/super-admin/filter-data/replacements/${id}`, { ...body, _changeReason: reason }));
        toast.success('Updated', 'Replacement record updated and audited');
        setEditingId(null); setEditFields({}); refreshAll();
      },
    });
  };

  const handleDeleteReplacement = (id: string, label: string) => {
    askReason({
      title: 'Delete replacement record',
      danger: true,
      body: <>The replacement record for <strong>{label}</strong> will be permanently destroyed and will disappear from the audit trail too.{CHAIN_WARNING}</>,
      confirmLabel: 'Delete permanently',
      run: async (reason) => {
        await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
          ? apiClient.deleteWithReauth(`/api/super-admin/filter-data/replacements/${id}`, pw, { _changeReason: reason })
          : apiClient.delete(`/api/super-admin/filter-data/replacements/${id}`, { _changeReason: reason }));
        toast.success('Deleted', 'Replacement record removed and audited');
        refreshAll();
      },
    });
  };

  const openRowEdit = (row: any, entity: 'cycle' | 'event' | 'pm-entry' | 'notification' | 'admin-request' | 'block-change', rowName: string) => {
    setChangeReason('');
    setRowEditDialog({ id: row.id, entity, rowName });
    if (entity === 'cycle') {
      setRowEditFields({
        cycleCode: row.cycleCode ?? '',
        status: row.status ?? 'IN_PROGRESS',
        cleaningReasonLabel: row.cleaningReasonLabel ?? '',
        startedAt: toInput(row.startedAt),
        completedAt: toInput(row.completedAt),
        terminatedAt: toInput(row.terminatedAt),
        terminationReason: row.terminationReason ?? '',
        sequenceNumber: row.sequenceNumber ?? '',
        dryerDurationMinutes: row.dryerDurationMinutes ?? '',
        dryerStartedAt: toInput(row.dryerStartedAt),
      });
    } else if (entity === 'event') {
      // Keep the ORIGINAL readings array: the dialog edits only each reading's
      // value, and instrumentId / description / uom / leastCount are written
      // back untouched. Rebuilding the array from the form would quietly drop
      // the instrument identity that makes a reading traceable.
      const readings: any[] = (row.attributes as any)?.instrumentReadings ?? [];
      setRowEditReadings(readings);
      const readingFields: Record<string, any> = {};
      readings.forEach((r, i) => { readingFields[`reading_${i}`] = r?.value ?? ''; });
      setRowEditFields({
        eventType: row.eventType ?? '',
        fromState: row.fromState ?? '',
        toState: row.toState ?? '',
        performedAt: toInput(row.performedAt),
        performedBy: row.performedBy ?? '',
        remarks: row.remarks ?? '',
        ...readingFields,
      });
    } else if (entity === 'pm-entry') {
      // pm-entry row — editable fields on the underlying pm_schedule_entries row
      setRowEditFields({
        month: row.month ?? '',
        plannedDate: toInput(row.plannedDate),
        windowStart: toInput(row.windowStart),
        windowEnd: toInput(row.windowEnd),
        toleranceDays: row.toleranceDays ?? '',
        approvalStatus: row.approvalStatus ?? '',
        approvalRemarks: row.approvalRemarks ?? '',
        notes: row.notes ?? '',
      });
    } else if (entity === 'notification') {
      setRowEditFields({
        type: row.type ?? '',
        title: row.title ?? '',
        message: row.message ?? '',
        targetUserId: row.targetUserId ?? '',
        forRole: row.forRole ?? '',
        isRead: row.isRead === true ? 'true' : 'false',
        readAt: toInput(row.readAt),
      });
    } else if (entity === 'admin-request') {
      setRowEditFields({
        requestType: row.requestType ?? '',
        status: row.status ?? 'PENDING',
        requesterName: row.requesterName ?? '',
        requesterEmployeeId: row.requesterEmployeeId ?? '',
        requesterEmail: row.requesterEmail ?? '',
        remarks: row.remarks ?? '',
        adminRemarks: row.adminRemarks ?? '',
      });
    } else {
      // block-change request row
      setRowEditFields({
        status: row.status ?? 'PENDING',
        reason: row.reason ?? '',
        processedComment: row.processedComment ?? '',
      });
    }
  };

  const submitRowEdit = async () => {
    if (!rowEditDialog || rowEditSaving) return;
    setRowEditSaving(true);
    try {
      const endpointMap: Record<string, string> = {
        'cycle': '/api/super-admin/data/cleaning-cycles',
        'event': '/api/super-admin/data/filter-events',
        'pm-entry': '/api/super-admin/data/pm-entries',
        'notification': '/api/super-admin/data/notifications',
        'admin-request': '/api/super-admin/data/admin-requests',
        'block-change': '/api/super-admin/data/block-change-requests',
      };
      const endpoint = endpointMap[rowEditDialog.entity];
      // Coerce numeric fields + drop empty strings so the server doesn't try
      // to write '' into an integer column. Date inputs come back as the naive
      // 'YYYY-MM-DDTHH:mm' the operator saw — convert to an explicit-UTC
      // instant, or the server's `new Date(...)` re-reads them in ITS zone.
      const body: Record<string, any> = {};
      const numericKeys = new Set(['sequenceNumber', 'dryerDurationMinutes', 'month', 'toleranceDays']);
      const booleanKeys = new Set(['isRead']);
      for (const [k, v] of Object.entries(rowEditFields)) {
        if (v === '' || v === null || v === undefined) continue;
        if (numericKeys.has(k)) {
          const n = Number(v);
          if (Number.isFinite(n)) body[k] = n;
        } else if (booleanKeys.has(k)) {
          body[k] = v === 'true' || v === true;
        } else {
          body[k] = toIsoIfNaiveDatetime(v, tz);
        }
      }
      // Reassemble the instrument readings: take the ORIGINAL array and
      // overwrite only each `value`. instrumentId / description / uom /
      // leastCount are what make a reading traceable to an instrument and are
      // not the operator's to retype, so they carry through untouched.
      if (rowEditDialog.entity === 'event' && rowEditReadings.length > 0) {
        const readings = rowEditReadings.map((r, idx) => {
          const raw = rowEditFields[`reading_${idx}`];
          if (raw === '' || raw === null || raw === undefined) return r;
          const n = Number(raw);
          return Number.isFinite(n) ? { ...r, value: n } : r;
        });
        body.attributes = { instrumentReadings: readings };
      }
      // The per-reading keys are UI-only — never send them to the API.
      for (const k of Object.keys(body)) if (k.startsWith('reading_')) delete body[k];
      body._changeReason = changeReason.trim();
      await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
        ? apiClient.putWithReauth(`${endpoint}/${rowEditDialog.id}`, body, pw)
        : apiClient.put(`${endpoint}/${rowEditDialog.id}`, body));
      const labelMap: Record<string, string> = {
        'cycle': 'Cycle', 'event': 'Event', 'pm-entry': 'PM entry',
        'notification': 'Notification', 'admin-request': 'Admin request', 'block-change': 'Block change',
      };
      toast.success('Updated', `${labelMap[rowEditDialog.entity]} updated and audited`);
      setRowEditDialog(null);
      setRowEditFields({});
      setChangeReason('');
      // Refresh both the enriched feed (used by the table) and the super-admin
      // feed (used by other tabs that hit the same endpoint).
      // Same map as create and delete — see REVALIDATE_KEYS. The three paths
      // used to keep their own lists and they drifted apart.
      revalidateEntity(rowEditDialog.entity);
    } catch (e: any) {
      if (!isReauthAbort(e)) toast.error('Update failed', e?.message ?? 'Could not update record');
    }
    setRowEditSaving(false);
  };

  // Revalidate every cache key touched by a given entity — shared by edit +
  // create so a new/edited row shows up on the data-mgmt tab AND the matching
  // user-facing page immediately.
  /**
   * Every SWR key an edit to each entity can invalidate — the ONE list.
   *
   * This was previously duplicated three times (edit, create, delete) and the
   * copies had drifted, which is exactly how the bug arose: a cleaning-cycle
   * edit refreshed `/api/filters/cycles` but NOT `/api/filters/cleaning-record`,
   * which is what the user-facing Cleaning Record page actually reads
   * (history.tsx:129). The edit saved correctly and the operator saw a stale
   * page, which reads as "it didn't save".
   *
   * Err on the side of over-invalidating. A needless refetch costs one request;
   * a missed one shows the operator wrong data and destroys their trust in the
   * console. Each key below is listed with WHY it is affected, so the next
   * person can tell a deliberate entry from a copy-paste.
   */
  const REVALIDATE_KEYS: Record<RowEntity, string[]> = {
    cycle: [
      '/api/filters/cleaning-record',      // Cleaning Record page (history.tsx) — the one that was missing
      '/api/filters/cycles',               // cycle list + detail, filter-lifecycle, traceability
      '/api/filters/manual-status-changes',// manual updates render alongside cycles in the unified record
      '/api/filters/dashboard-stats',      // cycle counts on the dashboard
      '/api/filters/batch-states',         // tablet/desktop per-filter state
      '/api/filters/ahu-completion-status',// AHU readiness is derived from cycles
      '/api/super-admin/data/cleaning-cycles',
    ],
    event: [
      '/api/filters/events',               // events list + filter traceability timeline
      '/api/filters/cycles',               // cycle detail embeds its events (includeEvents=true)
      '/api/filters/cleaning-record',      // the record view shows event-derived stages
      '/api/super-admin/data/filter-events',
    ],
    'pm-entry': [
      '/api/pm-schedules',                 // PM Schedules page, My Tasks (/due), pending-tasks-map
      '/api/super-admin/data/pm-entries',
    ],
    notification: [
      '/api/notifications',                // the bell + the notifications page
      '/api/super-admin/data/notifications',
    ],
    'admin-request': ['/api/admin-requests'],
    'block-change': ['/api/block-change-requests'],
  };

  const revalidateEntity = (entity: RowEntity) => {
    const prefixes = REVALIDATE_KEYS[entity] ?? [];
    globalMutate((key) => typeof key === 'string' && prefixes.some((pre) => key.startsWith(pre)));
  };

  const openCreate = (entity: RowEntity) => {
    setChangeReason('');
    // Seed status/type defaults so required selects aren't blank on open.
    const seed: Record<string, any> = {};
    if (entity === 'cycle') seed.status = 'COMPLETED';
    if (entity === 'admin-request') seed.status = 'PENDING';
    if (entity === 'block-change') seed.status = 'PENDING';
    setCreateFields(seed);
    setCreateDialog({ entity });
  };

  const submitCreate = async () => {
    if (!createDialog || createSaving) return;
    setCreateSaving(true);
    try {
      const endpointMap: Record<RowEntity, string> = {
        'cycle': '/api/super-admin/data/cleaning-cycles',
        'event': '/api/super-admin/data/filter-events',
        'pm-entry': '/api/super-admin/data/pm-entries',
        'notification': '/api/super-admin/data/notifications',
        'admin-request': '/api/super-admin/data/admin-requests',
        'block-change': '/api/super-admin/data/block-change-requests',
      };
      const numericKeys = new Set(['sequenceNumber', 'dryerDurationMinutes', 'month', 'toleranceDays', 'profileVersion']);
      const booleanKeys = new Set(['isRead']);
      const body: Record<string, any> = {};
      for (const [k, v] of Object.entries(createFields)) {
        if (v === '' || v === null || v === undefined) continue;
        if (numericKeys.has(k)) { const n = Number(v); if (Number.isFinite(n)) body[k] = n; }
        else if (booleanKeys.has(k)) body[k] = v === 'true' || v === true;
        // Back/future-dated create: the picked wall clock is in the operator's
        // configured zone, so it converts exactly like an edit does.
        else body[k] = toIsoIfNaiveDatetime(v, tz);
      }
      body._changeReason = changeReason.trim();
      await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
        ? apiClient.postWithReauth(endpointMap[createDialog.entity], body, pw)
        : apiClient.post(endpointMap[createDialog.entity], body));
      const labelMap: Record<RowEntity, string> = {
        'cycle': 'Cleaning cycle', 'event': 'Filter event', 'pm-entry': 'PM entry',
        'notification': 'Notification', 'admin-request': 'Admin request', 'block-change': 'Block change',
      };
      toast.success('Created', `${labelMap[createDialog.entity]} added`);
      revalidateEntity(createDialog.entity);
      setCreateDialog(null);
      setCreateFields({});
      setChangeReason('');
    } catch (e: any) {
      if (!isReauthAbort(e)) toast.error('Create failed', e?.message ?? 'Could not create record');
    }
    setCreateSaving(false);
  };

  // ── Audit-trail row actions ────────────────────────────────────────────
  // These go to /api/audit/:id, not the super-admin data endpoints: those
  // carry the trigger-disable dance, the meta-audit write and the chain-break
  // semantics. Redact is offered alongside delete because it is the one option
  // that answers "this row is wrong" WITHOUT invalidating the chain.
  const AUDIT_CHAIN_WARNING = (
    <span className="block mt-2 text-[12px] text-red-700">
      This breaks the audit hash chain from this record onward — <strong>permanently</strong>.
      Verify Chain will report every later record as unverifiable. Redact instead if the
      record only needs to be masked.
    </span>
  );

  const openAuditEdit = (a: any) => {
    setChangeReason('');
    setAuditEditDialog({ id: a.id, action: a.action });
    setAuditEditFields({
      timestamp: toInput(a.timestamp),
      userName: a.userName ?? '',
      userRole: a.userRole ?? '',
      action: a.action ?? '',
      targetType: a.targetType ?? '',
      targetId: a.targetId ?? '',
      signatureMeaning: a.signatureMeaning ?? '',
    });
  };

  const submitAuditEdit = async () => {
    if (!auditEditDialog || auditEditSaving || !reasonOk(changeReason)) return;
    setAuditEditSaving(true);
    try {
      const body: Record<string, any> = { reason: changeReason.trim() };
      for (const [k, v] of Object.entries(auditEditFields)) {
        if (k === 'timestamp') { if (v) body.timestamp = toIsoIfNaiveDatetime(v, tz); continue; }
        body[k] = v;
      }
      await gated('UPDATE_AUDIT_RECORD', (pw) => pw
        ? apiClient.putWithReauth(`/api/audit/${auditEditDialog.id}`, body, pw)
        : apiClient.put(`/api/audit/${auditEditDialog.id}`, body));
      toast.success('Audit record edited', 'The change is recorded; the hash chain is now broken at this record');
      setAuditEditDialog(null); setAuditEditFields({}); setChangeReason('');
      globalMutate((key) => typeof key === 'string' && key.startsWith('/api/audit'));
    } catch (e: any) {
      if (!isReauthAbort(e)) toast.error('Edit failed', e?.message ?? 'Could not edit the audit record');
    }
    setAuditEditSaving(false);
  };

  const handleDeleteAuditRow = (a: any) => {
    askReason({
      title: 'Delete audit record',
      danger: true,
      body: <>Audit record <strong>{a.action}</strong> will be permanently destroyed.{AUDIT_CHAIN_WARNING}</>,
      confirmLabel: 'Delete permanently',
      run: async (reason) => {
        await gated('DELETE_AUDIT_RECORD', (pw) => pw
          ? apiClient.deleteWithReauth(`/api/audit/${a.id}`, pw, { reason })
          : apiClient.delete(`/api/audit/${a.id}`, { reason }));
        toast.success('Deleted', 'Audit record destroyed; the deletion itself is recorded');
        globalMutate((key) => typeof key === 'string' && key.startsWith('/api/audit'));
      },
    });
  };

  const handleRedactAuditRow = (a: any) => {
    askReason({
      title: 'Redact audit record',
      body: <>The payload of <strong>{a.action}</strong> will be masked. The record, its checksum and its chain link survive, so the audit chain stays intact — this is the recommended alternative to deleting.</>,
      confirmLabel: 'Redact record',
      run: async (reason) => {
        await gated('REDACT_AUDIT_RECORD', (pw) => pw
          ? apiClient.postWithReauth(`/api/audit/${a.id}/redact`, { reason }, pw)
          : apiClient.post(`/api/audit/${a.id}/redact`, { reason }));
        toast.success('Redacted', 'Payload masked; hash chain preserved');
        globalMutate((key) => typeof key === 'string' && key.startsWith('/api/audit'));
      },
    });
  };

  // Filter pickers for the manual retirement / replacement dialogs. Retirement
  // needs filters that are NOT already retired; replacement needs any filter on
  // either side (a replaced filter is retired, so both lists are unfiltered).
  const manualFiltersData = useSWR<any>(manualRecordDialog ? '/api/hierarchy/filters' : null);
  const manualFilters: any[] = manualFiltersData.data?.data ?? [];

  const submitManualRecord = async () => {
    if (!manualRecordDialog || manualRecordSaving || !reasonOk(changeReason)) return;
    setManualRecordSaving(true);
    try {
      const f = manualRecordFields;
      if (manualRecordDialog.kind === 'retirement') {
        if (!f.filterId) { toast.error('Missing field', 'Select the filter being retired'); setManualRecordSaving(false); return; }
        await apiClient.post('/api/super-admin/filter-data/retirements', {
          filterId: f.filterId,
          remarks: f.remarks || undefined,
          retiredAt: f.retiredAt ? toIsoIfNaiveDatetime(f.retiredAt, tz) : undefined,
          performedBy: f.performedBy || undefined,
          _changeReason: changeReason.trim(),
        });
        toast.success('Created', 'Retirement record added and audited');
      } else {
        if (!f.oldFilterId || !f.newFilterId) { toast.error('Missing field', 'Select both the replaced and the replacement filter'); setManualRecordSaving(false); return; }
        await apiClient.post('/api/super-admin/filter-data/replacements', {
          oldFilterId: f.oldFilterId,
          newFilterId: f.newFilterId,
          remarks: f.remarks || undefined,
          replacedAt: f.replacedAt ? toIsoIfNaiveDatetime(f.replacedAt, tz) : undefined,
          performedBy: f.performedBy || undefined,
          _changeReason: changeReason.trim(),
        });
        toast.success('Created', 'Replacement record added and audited');
      }
      setManualRecordDialog(null); setManualRecordFields({}); setChangeReason(''); refreshAll();
    } catch (e: any) {
      if (!isReauthAbort(e)) toast.error('Create failed', e?.message ?? 'Could not create the record');
    }
    setManualRecordSaving(false);
  };

  const handleDeleteGeneric = async (id: string) => {
    // Resolve endpoint from active tab. The dedicated cleaning-cycles +
    // filter-events tabs aren't in genericTabs but still hit the super-admin
    // data endpoints under the same naming convention.
    let endpoint = activeGenericTab?.endpoint;
    if (!endpoint && tab === 'cleaning-cycles') endpoint = '/api/super-admin/data/cleaning-cycles';
    if (!endpoint && tab === 'filter-events') endpoint = '/api/super-admin/data/filter-events';
    if (!endpoint && tab === 'pm-entries') endpoint = '/api/super-admin/data/pm-entries';
    // audit-trail is deliberately absent: audit rows are edited and deleted
    // through /api/audit/:id (see handleEditAuditRow / handleDeleteAuditRow),
    // which carries the chain-break handling and the meta-audit write. Routing
    // them through the generic super-admin data endpoints would bypass both.
    if (!endpoint && tab === 'notifications') endpoint = '/api/super-admin/data/notifications';
    if (!endpoint && tab === 'admin-requests') endpoint = '/api/super-admin/data/admin-requests';
    if (!endpoint && tab === 'block-changes') endpoint = '/api/super-admin/data/block-change-requests';
    if (!endpoint) return;

    if (!reasonOk(changeReason)) return;
    setProcessing(true);
    try {
      await gated('SUPER_ADMIN_DATA_EDIT', (pw) => pw
        ? apiClient.deleteWithReauth(`${endpoint}/${id}`, pw, { _changeReason: changeReason.trim() })
        : apiClient.delete(`${endpoint}/${id}`, { _changeReason: changeReason.trim() }));
      toast.success('Deleted', 'Record removed and audited');
      setConfirmDelete(null);
      setChangeReason('');
      // This tab's own feed, plus every user-facing key the entity touches.
      // Same REVALIDATE_KEYS map as edit and create — the three paths kept
      // separate lists before and drifted, which is how a cleaning-cycle edit
      // stopped refreshing the Cleaning Record page.
      globalMutate((key) => typeof key === 'string' && key.startsWith(endpoint));
      const deletedEntity = TAB_CREATE_ENTITY[tab];
      if (deletedEntity) revalidateEntity(deletedEntity);
      if (tab === 'audit-trail') globalMutate((key) => typeof key === 'string' && key.startsWith('/api/audit'));
    } catch (e: any) { if (!isReauthAbort(e)) toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  /**
   * Total matching records for the active tab.
   *
   * SERVER total where the endpoint paginates, filtered-array length where it
   * does not. Getting this wrong is not cosmetic: the header used to read
   * `genericData?.total ?? genericRows.length`, and `genericTabs` has been empty
   * since every tab got its own render branch — so every tab except Retirements
   * and Replacements displayed a flat **0 records** regardless of content.
   */
  const totalRecords: number =
      tab === 'retirements' ? filteredRetirements.length
    : tab === 'replacements' ? filteredReplacements.length
    : tab === 'admin-requests' ? filteredEnrichedAdminReqs.length
    : tab === 'cleaning-cycles' ? (cyclesEnriched.data?.total ?? filteredEnrichedCycles.length)
    : tab === 'filter-events' ? (eventsEnriched.data?.total ?? filteredEnrichedEvents.length)
    : tab === 'pm-entries' ? (pmEntriesEnriched.data?.total ?? filteredEnrichedPmEntries.length)
    : tab === 'audit-trail' ? (auditEnriched.data?.total ?? filteredEnrichedAudit.length)
    : tab === 'notifications' ? (notificationsEnriched.data?.total ?? filteredEnrichedNotifications.length)
    : tab === 'block-changes' ? (blockChangesEnriched.data?.total ?? filteredEnrichedBlockChanges.length)
    : genericRows.length;

  const isLoading = tab === 'retirements' ? retLoading
    : tab === 'replacements' ? repLoading
    : tab === 'cleaning-cycles' ? cyclesEnriched.isLoading
    : tab === 'filter-events' ? eventsEnriched.isLoading
    : tab === 'pm-entries' ? pmEntriesEnriched.isLoading
    : tab === 'audit-trail' ? auditEnriched.isLoading
    : tab === 'notifications' ? notificationsEnriched.isLoading
    : tab === 'admin-requests' ? adminReqEnriched.isLoading
    : tab === 'block-changes' ? blockChangesEnriched.isLoading
    : genericLoading;

  return (
    <div className="h-full flex flex-col space-y-4 p-4 overflow-hidden">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm shrink-0">
        <div className="h-1 bg-gradient-to-r from-red-500 via-rose-500 to-pink-500" />
        <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/20">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">Filter Data Management</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold border border-red-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" /></svg>
                  SUPER ADMIN
                </span>
                <span className="text-[12px] text-slate-500">Every change here is recorded in the audit trail with a reason</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-800">
                {totalRecords}
              </div>
              <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Records</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 flex-wrap">
          {[
            { key: 'retirements', label: 'Retirements' },
            { key: 'replacements', label: 'Replacements' },
            { key: 'cleaning-cycles', label: 'Cleaning Cycles' },
            { key: 'filter-events', label: 'Filter Events' },
            { key: 'pm-entries', label: 'PM Entries' },
            { key: 'audit-trail', label: 'Audit Trail' },
            { key: 'notifications', label: 'Notifications' },
            { key: 'admin-requests', label: 'Admin Requests' },
            { key: 'block-changes', label: 'Block Changes' },
            ...genericTabs.map((t: GenericTabDef) => ({ key: t.key, label: t.label })),
          ].map(t => (
            <button key={t.key} onClick={() => switchTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(tab === 'retirements' || tab === 'replacements') && (
            <button
              onClick={() => { setChangeReason(''); setManualRecordDialog({ kind: tab === 'retirements' ? 'retirement' : 'replacement' }); setManualRecordFields({}); }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:from-cyan-500 hover:to-blue-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Create
            </button>
          )}
          {TAB_CREATE_ENTITY[tab] && (
            <button
              onClick={() => openCreate(TAB_CREATE_ENTITY[tab])}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl text-sm font-semibold shadow-sm hover:from-cyan-500 hover:to-blue-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Create
            </button>
          )}
          <div className="relative">
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={search} onChange={e => { setSearch(e.target.value); resetPaging(); }} placeholder="Search..."
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 w-52 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" />
          </div>
        </div>
      </div>

      {/* ─── Filter bar ─── Date range for every tab, plus the status/type
          filter its user-facing page offers. Both are applied server-side
          wherever the endpoint supports it (see listParams / listWhere); the
          three array tabs filter in the browser over the full set. */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap shrink-0">
        <DateRangeFilter
          size="sm"
          from={dateFrom}
          to={dateTo}
          onFromChange={v => { setDateFrom(v); resetPaging(); }}
          onToChange={v => { setDateTo(v); resetPaging(); }}
          fromAriaLabel="Records from date"
          toAriaLabel="Records to date"
        />

        {FILTERS_BY_TAB[tab] && (
          <>
            <div className="h-6 w-px bg-slate-200" />
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {FILTERS_BY_TAB[tab].label}
              </span>
              <select
                value={kindFilter}
                onChange={e => { setKindFilter(e.target.value); resetPaging(); }}
                className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-700 focus:bg-white focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 focus:outline-none transition-all"
              >
                <option value="">All</option>
                {FILTERS_BY_TAB[tab].options.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </>
        )}

        {(dateFrom || dateTo || kindFilter || search) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setKindFilter(''); setSearch(''); resetPaging(); }}
            className="ml-auto text-[12px] font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Main Content — fills remaining height, scrolls internally */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading records...</span>
          </div>
        ) : tab === 'retirements' ? (
          /* ─── Retirements ─── */
          filteredRetirements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No retired filters'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filter Name</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Original Parent</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filter Set</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Retired At</th>
                  <th className="text-right px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clientPage(filteredRetirements).map(r => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className={`group transition-colors ${isEditing ? 'bg-cyan-50/30' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-5 py-3.5">
                        {isEditing ? (
                          <input value={editFields.name ?? r.name} onChange={e => setEditFields(p => ({ ...p, name: e.target.value }))} autoFocus
                            className="border border-cyan-300 rounded-lg px-3 py-1.5 text-[13px] w-56 bg-white focus:ring-2 focus:ring-cyan-100 outline-none" />
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                            </div>
                            <span className="text-[13px] font-semibold text-slate-800">{r.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[13px]">
                        {r.preRetireParentName ? (
                          <span className="text-slate-600">{r.preRetireParentName}</span>
                        ) : (
                          <span className="text-slate-300 text-[12px]">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {isEditing ? (
                          <select value={editFields.filterSet ?? r.filterSet ?? ''} onChange={e => setEditFields(p => ({ ...p, filterSet: e.target.value }))}
                            className="border border-cyan-300 rounded-lg px-3 py-1.5 text-[13px] bg-white focus:ring-2 focus:ring-cyan-100 outline-none">
                            <option value="">None</option>
                            <option value="SET_A">Set A</option>
                            <option value="SET_B">Set B</option>
                          </select>
                        ) : (
                          r.filterSet ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">{r.filterSet.replace('_', ' ')}</span>
                          ) : (
                            <span className="text-slate-300 text-[12px]">--</span>
                          )
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] tabular-nums whitespace-nowrap">
                        {isEditing ? (
                          <input type="datetime-local" value={editFields.updatedAt ?? toInput(r.updatedAt)}
                            onChange={e => setEditFields(p => ({ ...p, updatedAt: e.target.value }))}
                            className="border border-cyan-300 rounded-lg px-2 py-1 text-[11px] bg-white w-44" />
                        ) : (
                          <span className="text-slate-400">{formatDateTime(r.updatedAt)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleEditRetirement(r.id, r.name)} disabled={processing}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-[11px] font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(r.id); setEditFields({ name: r.name, filterSet: r.filterSet ?? '', updatedAt: toInput(r.updatedAt) }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => { setChangeReason(''); setUnretireDialog({ id: r.id, name: r.name, preRetireParentId: r.preRetireParentId, preRetireParentName: r.preRetireParentName }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-emerald-600 text-[11px] font-medium rounded-lg hover:bg-emerald-50 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                Restore
                              </button>
                              <button onClick={() => handleDeleteRetirement(r.id, r.name)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : tab === 'replacements' ? (
          /* ─── Replacements ─── */
          filteredReplacements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No replacement records'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Old Filter Name</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Old Filter ID</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Filter Name</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Filter ID</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Performed By</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remarks</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="text-right px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clientPage(filteredReplacements).map(r => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className={`group transition-colors ${isEditing ? 'bg-cyan-50/30' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.oldFilterName ?? r.oldFilterName} onChange={e => setEditFields(p => ({ ...p, oldFilterName: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-32" />
                        ) : (
                          <span className="text-[12px] font-semibold text-slate-500 line-through">{r.oldFilterName}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.oldFilterId ?? r.oldFilterId} onChange={e => setEditFields(p => ({ ...p, oldFilterId: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[10px] font-mono bg-white w-36" />
                        ) : (
                          <span className="text-[10px] font-mono text-slate-300" title={r.oldFilterId}>{r.oldFilterId?.slice(0, 8)}...</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.newFilterName ?? r.newFilterName} onChange={e => setEditFields(p => ({ ...p, newFilterName: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-32" />
                        ) : (
                          <span className="text-[12px] font-semibold text-slate-800">{r.newFilterName}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.newFilterId ?? r.newFilterId} onChange={e => setEditFields(p => ({ ...p, newFilterId: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[10px] font-mono bg-white w-36" />
                        ) : (
                          <span className="text-[10px] font-mono text-slate-300" title={r.newFilterId}>{r.newFilterId?.slice(0, 8)}...</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px]">
                        {isEditing ? (
                          <input value={editFields.performedBy ?? r.performedBy} onChange={e => setEditFields(p => ({ ...p, performedBy: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-28" />
                        ) : (
                          <span className="text-slate-600">{r.performedBy}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px] max-w-[150px]">
                        {isEditing ? (
                          <input value={editFields.remarks ?? r.remarks ?? ''} onChange={e => setEditFields(p => ({ ...p, remarks: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-32" />
                        ) : (
                          <span className="text-slate-400 truncate block" title={r.remarks ?? ''}>{r.remarks || '--'}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px] tabular-nums whitespace-nowrap">
                        {isEditing ? (
                          <input type="datetime-local" value={editFields.replacedAt ?? toInput(r.replacedAt)}
                            onChange={e => setEditFields(p => ({ ...p, replacedAt: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-44" />
                        ) : (
                          <span className="text-slate-400">{formatDateTime(r.replacedAt)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleEditReplacement(r.id, `${r.oldFilterName} to ${r.newFilterName}`)} disabled={processing}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-[11px] font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(r.id); setEditFields({ oldFilterName: r.oldFilterName, oldFilterId: r.oldFilterId, newFilterName: r.newFilterName, newFilterId: r.newFilterId, performedBy: r.performedBy, remarks: r.remarks ?? '', replacedAt: toInput(r.replacedAt) }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => handleDeleteReplacement(r.id, `${r.oldFilterName} to ${r.newFilterName}`)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : null}

        {/* ─── Cleaning Cycles — mirrors /cleaning-cycles page exactly ─── */}
        {tab === 'cleaning-cycles' && !cyclesEnriched.isLoading && (
          filteredEnrichedCycles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No cleaning cycles'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['S.No', 'Filter', 'Micron Size', 'Air Pressure', 'RO Water', 'Wash In', 'Wash Out', 'Wash By', 'Dryer Temp', 'Dry In', 'Dry Out', 'Dry By', 'Duration', 'Status', 'Actions'].map((h, i) => (
                    <th key={i} className="text-left px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredEnrichedCycles.map((c: any, idx: number) => {
                  const attrs = cycleFilterAttrMap.get(c.filterId) ?? {};
                  const washIn = getStageInfoFromEvents(c.events ?? [], 'WASH_IN');
                  const washOut = getStageInfoFromEvents(c.events ?? [], 'WASH_OUT');
                  const dryIn = getStageInfoFromEvents(c.events ?? [], 'DRY_IN');
                  const dryOut = getStageInfoFromEvents(c.events ?? [], 'DRY_OUT');
                  const washReadings = washIn?.readings ?? [];
                  const dryReadings = (dryIn?.readings?.length ? dryIn.readings : null) ?? (dryOut?.readings?.length ? dryOut.readings : null) ?? [];
                  const dryerTemp = getReadingValue(dryReadings, 'dryer') !== '-' ? getReadingValue(dryReadings, 'dryer') : getReadingValue(dryReadings, 'temperature');
                  const sc = CYCLE_STATUS_CONFIG[c.status] ?? { label: c.status, bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' };
                  return (
                    <Fragment key={c.id}>
                    <tr className="hover:bg-slate-50/50 group">
                      <td className="px-3 py-2.5 text-[12px] text-slate-400 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2.5 text-[12px] font-semibold text-slate-800"><span className="inline-flex items-center gap-1.5">{c.filterName ?? '-'}<ManualEntryBadge manual={c.manualEntry} /></span></td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600">{attrs.micronSize ?? '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600 font-mono tabular-nums">{getReadingValue(washReadings, 'air pressure')}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600 font-mono tabular-nums">{getReadingValue(washReadings, 'ro water')}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">{washIn ? formatDateTime(washIn.time) : '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">{washOut ? formatDateTime(washOut.time) : '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600">{washIn?.performedBy ?? washOut?.performedBy ?? '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600 font-mono tabular-nums">{dryerTemp}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">{dryIn ? formatDateTime(dryIn.time) : '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-500 whitespace-nowrap">{dryOut ? formatDateTime(dryOut.time) : '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600">{dryIn?.performedBy ?? dryOut?.performedBy ?? '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600 tabular-nums">{getCycleDuration(c)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${sc.bg} ${sc.text} border ${sc.border}`}>{sc.label}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setOpenLifecycle(openLifecycle === c.id ? null : c.id)}
                            title="Show this cycle's stage history — each step can be edited here"
                            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-colors ${
                              openLifecycle === c.id ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-100'
                            }`}>
                            <svg className={`w-3 h-3 transition-transform ${openLifecycle === c.id ? 'rotate-180' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            Lifecycle
                            <span className="ml-0.5 text-slate-400">({(c.events ?? []).length})</span>
                          </button>
                          <button onClick={() => openRowEdit(c, 'cycle', c.cycleCode ?? c.filterName ?? 'Cycle')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-60 group-hover:opacity-100 transition-opacity">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            Edit
                          </button>
                          <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: c.id, name: c.cycleCode ?? c.filterName ?? 'Cycle' }); }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-60 group-hover:opacity-100 transition-opacity">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {openLifecycle === c.id && (
                      <tr key={`${c.id}-lifecycle`} className="bg-slate-50/70">
                        <td colSpan={99} className="px-4 py-3">
                          <LifecyclePanel
                            cycle={c}
                            formatDateTime={formatDateTime}
                            onEditEvent={(ev) => openRowEdit(ev, 'event', `${ev.eventType} · ${c.cycleCode ?? ''}`)}
                            onDeleteEvent={(ev) => { setChangeReason(''); setConfirmDelete({ id: ev.id, name: `${ev.eventType} (${c.cycleCode ?? 'cycle'})` }); }}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* ─── Filter Events — mirrors /filters/:id/trace?tab=events card layout ─── */}
        {tab === 'filter-events' && !eventsEnriched.isLoading && (
          filteredEnrichedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No filter events'}</span>
            </div>
          ) : (
            <div className="space-y-2 p-4">
              {filteredEnrichedEvents.map((e: any) => (
                <div key={e.id} className={`group bg-white border-l-4 rounded-lg p-4 hover:bg-slate-50/50 ${e.eventType === 'BYPASS_DEVIATION' ? 'border-red-500' : 'border-cyan-600'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">{e.eventType?.replace(/_/g, ' ')}<ManualEntryBadge manual={e.manualEntry} /></span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{formatDateTime(e.performedAt)}</span>
                      <button onClick={() => openRowEdit(e, 'event', e.eventType ?? 'Event')}
                        className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-60 group-hover:opacity-100 transition-opacity">
                        Edit
                      </button>
                      <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: e.id, name: e.eventType ?? 'Event' }); }}
                        className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-60 group-hover:opacity-100 transition-opacity">
                        Delete
                      </button>
                    </div>
                  </div>
                  {(e.fromState || e.toState) && (
                    <div className="text-sm text-slate-600">
                      {e.fromState ? e.fromState.replace(/_/g, ' ') : (e.toState ? 'To Be Cleaned' : '')} {e.toState && '→'} <span className="text-cyan-600">{e.toState?.replace(/_/g, ' ') ?? ''}</span>
                    </div>
                  )}
                  {e.remarks && <div className="text-sm text-slate-400 mt-1 italic">{e.remarks}</div>}
                  {e.checksum && <div className="text-xs text-slate-300 mt-1 font-mono">Checksum: {String(e.checksum).slice(0, 16)}...</div>}
                </div>
              ))}
            </div>
          )
        )}

        {/* Alarms render branch removed 2026-05-17 (alarm subsystem retired). */}

        {/* ─── PM Entries — mirrors /pm-schedules/:id detail page card grid ─── */}
        {tab === 'pm-entries' && !pmEntriesEnriched.isLoading && (
          filteredEnrichedPmEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No PM entries'}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
              {filteredEnrichedPmEntries.map((entry: any) => {
                const exec = entry.execution;
                const st = getPmEntryStatus(entry);
                return (
                  <div key={entry.id} className={`group bg-white border rounded-xl p-4 ${st.cardBorder}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-flex items-center gap-2 text-lg font-semibold text-slate-800">
                        {PM_MONTHS[(entry.month ?? 1) - 1] ?? `Month ${entry.month}`}
                        <ManualEntryBadge manual={entry.manualEntry} />
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                    </div>
                    <div className="text-sm text-slate-500 space-y-1">
                      {entry.plannedDate && <div>Planned: <span className="text-slate-600">{formatDateTime(entry.plannedDate)}</span></div>}
                      {entry.windowStart && entry.windowEnd && (
                        <div>Window: <span className="text-slate-600">{formatDateTime(entry.windowStart)} - {formatDateTime(entry.windowEnd)}</span></div>
                      )}
                      {entry.toleranceDays !== undefined && entry.toleranceDays !== null && (
                        <div>Tolerance: <span className="text-slate-600">{entry.toleranceDays} days</span></div>
                      )}
                    </div>
                    {exec && (
                      <div className="mt-2 pt-2 border-t border-slate-200 text-sm text-slate-500 space-y-0.5">
                        {exec.startedAt && <div>Started: <span className="text-slate-600">{formatDateTime(exec.startedAt)}</span></div>}
                        {exec.completedAt && <div>Done: <span className="text-slate-600">{formatDateTime(exec.completedAt)}</span></div>}
                        {exec.isWithinWindow === false && <div className="text-xs text-amber-600">Out of window</div>}
                      </div>
                    )}
                    {(entry.approvalStatus || entry.submittedByName || entry.approvedByName) && (
                      <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500 space-y-0.5">
                        {entry.approvalStatus && (
                          <div>Approval: <span className={`font-semibold ${entry.approvalStatus === 'APPROVED' ? 'text-emerald-600' : entry.approvalStatus === 'REJECTED' ? 'text-red-600' : 'text-amber-600'}`}>{entry.approvalStatus}</span></div>
                        )}
                        {entry.submittedByName && <div>Submitted by: <span className="text-slate-600">{entry.submittedByName}</span></div>}
                        {entry.approvedByName && <div>Approved by: <span className="text-slate-600">{entry.approvedByName}</span></div>}
                        {entry.approvedAt && <div>Approved at: <span className="text-slate-600">{formatDateTime(entry.approvedAt)}</span></div>}
                        {entry.notes && <div className="italic">"{entry.notes}"</div>}
                      </div>
                    )}
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2 justify-end opacity-60 group-hover:opacity-100 transition-opacity transition-opacity">
                      <button onClick={() => openRowEdit(entry, 'pm-entry', `${PM_MONTHS[(entry.month ?? 1) - 1]} ${entry.plannedDate ? new Date(entry.plannedDate).getFullYear() : ''}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        Edit
                      </button>
                      <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: entry.id, name: `${PM_MONTHS[(entry.month ?? 1) - 1]} entry` }); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ─── Audit Trail — mirrors /audit page (Timestamp / Description / Action / User / Status) ─── */}
        {tab === 'audit-trail' && !auditEnriched.isLoading && (
          filteredEnrichedAudit.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No audit records'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Timestamp', 'Action', 'Performed By', 'Target', 'Status', 'Actions'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredEnrichedAudit.map((a: any) => {
                  const status = getAuditStatus(a.action ?? '');
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/50 group">
                      <td className="px-4 py-3 text-[12px] text-slate-600 whitespace-nowrap tabular-nums">{formatDateTime(a.timestamp)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">{a.action}</span>
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        <div className="font-semibold text-slate-700">{a.userId ?? '-'}</div>
                        {a.userRole && <div className="text-[10px] text-slate-400">{a.userRole}</div>}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-500">
                        {a.targetType ? <span>{a.targetType}{a.targetId ? <span className="text-slate-300 ml-1">({String(a.targetId).slice(0, 8)})</span> : null}</span> : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${status === 'Success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end opacity-60 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openAuditEdit(a)} title="Correct this record. Breaks the hash chain from here onward."
                            className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100">Edit</button>
                          <button onClick={() => handleRedactAuditRow(a)} title="Mask the payload but keep the record and its chain link (recommended)."
                            className="px-2 py-1 text-amber-600 text-[10px] font-medium rounded-lg hover:bg-amber-50">Redact</button>
                          <button onClick={() => handleDeleteAuditRow(a)} title="Destroy this record. Permanently breaks the hash chain."
                            className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* ─── Notifications — mirrors /notifications page (type / title / message / read / time) ─── */}
        {tab === 'notifications' && !notificationsEnriched.isLoading && (
          filteredEnrichedNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No notifications'}</span>
            </div>
          ) : (
            <div className="space-y-2 p-4">
              {filteredEnrichedNotifications.map((n: any) => {
                const tCol = NOTIFICATION_TYPE_COLORS[n.type] ?? 'bg-slate-50 text-slate-600 border-slate-200';
                return (
                  <div key={n.id} className={`group bg-white border rounded-lg p-4 ${n.isRead ? 'border-slate-200' : 'border-cyan-300 shadow-sm'} hover:bg-slate-50/50`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border ${tCol}`}>{n.type?.replace(/_/g, ' ')}</span>
                          {!n.isRead && <span className="text-[10px] text-cyan-600 font-bold">UNREAD</span>}
                          <ManualEntryBadge manual={n.manualEntry} />
                        </div>
                        <div className="text-[13px] font-semibold text-slate-800">{n.title}</div>
                        {n.message && <div className="text-[12px] text-slate-500 mt-0.5">{n.message}</div>}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                          {n.targetUserId && <span>For: {n.targetUserId}</span>}
                          {n.forRole && <span>Role: {n.forRole}</span>}
                          <span>{formatDateTime(n.createdAt)}</span>
                          {n.readAt && <span>Read: {formatDateTime(n.readAt)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openRowEdit(n, 'notification', n.title ?? 'Notification')}
                          className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100">Edit</button>
                        <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: n.id, name: n.title ?? 'Notification' }); }}
                          className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50">Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ─── Admin Requests — mirrors /admin-requests page (Requester / Type / Status / Submitted) ─── */}
        {tab === 'admin-requests' && !adminReqEnriched.isLoading && (
          filteredEnrichedAdminReqs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No admin requests'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Requester', 'Type', 'Status', 'Submitted', 'Processed By', 'Actions'].map((h, i) => (
                    <th key={i} className="text-left px-5 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {clientPage(filteredEnrichedAdminReqs).map((req: any) => {
                  const typeLabel = ADMIN_REQ_TYPE_LABELS[req.requestType] ?? req.requestType;
                  const sCol = ADMIN_REQ_STATUS_COLORS[req.status] ?? 'bg-slate-50 text-slate-600 border-slate-200';
                  return (
                    <tr key={req.id} className="hover:bg-slate-50/50 group">
                      <td className="px-5 py-3.5">
                        <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">{req.requesterName}<ManualEntryBadge manual={req.manualEntry} /></div>
                        {req.requesterEmployeeId && <div className="text-[11px] text-slate-400">{req.requesterEmployeeId}</div>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">{typeLabel}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold border ${sCol}`}>{req.status}</span>
                      </td>
                      <td className="px-5 py-3.5 text-[12px] text-slate-600 whitespace-nowrap tabular-nums">{formatDateTime(req.requestedAt)}</td>
                      <td className="px-5 py-3.5 text-[12px] text-slate-500">{req.processedByName ?? req.processedBy ?? '-'}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openRowEdit(req, 'admin-request', `${typeLabel} - ${req.requesterName}`)}
                            className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-60 group-hover:opacity-100 transition-opacity">Edit</button>
                          <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: req.id, name: `${typeLabel} - ${req.requesterName}` }); }}
                            className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-60 group-hover:opacity-100 transition-opacity">Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* ─── Block Changes — mirrors /approvals page (filter / from→to block / status / reason) ─── */}
        {tab === 'block-changes' && !blockChangesEnriched.isLoading && (
          filteredEnrichedBlockChanges.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No block change requests'}</span>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {filteredEnrichedBlockChanges.map((r: any) => {
                const sc = BLOCK_CHANGE_STATUS[r.status] ?? BLOCK_CHANGE_STATUS.PENDING;
                return (
                  <div key={r.id} className="group bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                    <div className={`h-1 ${sc.bar}`} />
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-base font-bold text-slate-800">{r.filterName ?? '-'}</h3>
                            <ManualEntryBadge manual={r.manualEntry} />
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${sc.bg} ${sc.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                              {sc.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span className="font-medium text-slate-700">{r.fromBlockName ?? '-'}</span>
                            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                            <span className="font-medium text-cyan-600">{r.toBlockName ?? '-'}</span>
                          </div>
                          {r.reason && <p className="text-sm text-slate-400 mt-2">Reason: {r.reason}</p>}
                          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                            <span>By: {r.requestedByName ?? '-'}</span>
                            <span>{formatDateTime(r.createdAt)}</span>
                            {r.processedByName && <span>Processed by: {r.processedByName}</span>}
                            {r.processedComment && <span>Comment: {r.processedComment}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openRowEdit(r, 'block-change', r.filterName ?? 'Block change')}
                            className="px-2.5 py-1 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100">Edit</button>
                          <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: r.id, name: `Block change for ${r.filterName ?? 'filter'}` }); }}
                            className="px-2.5 py-1 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50">Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ─── Generic Data Tables (all columns editable) ─── */}
        {activeGenericTab && tab !== 'retirements' && tab !== 'replacements' && tab !== 'cleaning-cycles' && tab !== 'filter-events' && tab !== 'pm-entries' && tab !== 'audit-trail' && tab !== 'notifications' && tab !== 'admin-requests' && tab !== 'block-changes' && (
          genericLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] text-slate-400">Loading {activeGenericTab.label}...</span>
            </div>
          ) : genericRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">No records found</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  {activeGenericTab.columns.map(col => (
                    <th key={col} className="text-left px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{col.replace(/([A-Z])/g, ' $1').trim()}</th>
                  ))}
                  <th className="text-right px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky right-0 bg-slate-50/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {genericRows.map((row: any) => {
                  const rowId = row[activeGenericTab.idField];
                  const isRowEditing = editingId === rowId;
                  return (
                    <tr key={rowId} className={`group transition-colors ${isRowEditing ? 'bg-cyan-50/30' : 'hover:bg-slate-50/50'}`}>
                      {activeGenericTab.columns.map(col => {
                        const rawVal = row[col];
                        const isDate = rawVal && typeof rawVal === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rawVal);
                        const isBool = typeof rawVal === 'boolean';
                        const displayVal = isDate ? formatDateTime(rawVal) : isBool ? (rawVal ? 'Yes' : 'No') : String(rawVal ?? '--');
                        const isBadge = ['status', 'approvalStatus', 'severity', 'eventType', 'action', 'requestType'].includes(col);

                        if (isRowEditing) {
                          return (
                            <td key={col} className="px-3 py-2">
                              {isBool ? (
                                <select value={editFields[col] ?? String(rawVal)} onChange={e => setEditFields(p => ({ ...p, [col]: e.target.value }))}
                                  className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-16">
                                  <option value="true">Yes</option>
                                  <option value="false">No</option>
                                </select>
                              ) : isDate ? (
                                <input type="datetime-local" value={editFields[col] ?? toInput(rawVal)}
                                  onChange={e => setEditFields(p => ({ ...p, [col]: e.target.value }))}
                                  className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-40" />
                              ) : (
                                <input value={editFields[col] ?? String(rawVal ?? '')}
                                  onChange={e => setEditFields(p => ({ ...p, [col]: e.target.value }))}
                                  className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-full min-w-[80px]" />
                              )}
                            </td>
                          );
                        }

                        return (
                          <td key={col} className="px-3 py-2.5 text-[11px] text-slate-600 max-w-[180px] truncate" title={displayVal}>
                            {isBadge ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                {displayVal}
                              </span>
                            ) : displayVal}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 sticky right-0 bg-white">
                        <div className="flex items-center gap-1 justify-end">
                          {isRowEditing ? (
                            <>
                              <button onClick={async () => {
                                setProcessing(true);
                                try {
                                  const body: any = {};
                                  for (const [k, v] of Object.entries(editFields)) {
                                    if (typeof row[k] === 'boolean') body[k] = v === 'true';
                                    else body[k] = toIsoIfNaiveDatetime(v, tz);
                                  }
                                  await apiClient.put(activeGenericTab.endpoint + '/' + rowId, body);
                                  toast.success('Updated', 'Record updated silently');
                                  setEditingId(null); setEditFields({});
                                  globalMutate((key) => typeof key === 'string' && key.startsWith(activeGenericTab.endpoint));
                                } catch (e: any) { if (!isReauthAbort(e)) toast.error('Error', e?.message ?? 'Failed'); }
                                setProcessing(false);
                              }} disabled={processing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-600 text-white text-[10px] font-semibold rounded-lg disabled:opacity-50">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-lg">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => {
                                setEditingId(rowId);
                                const fields: Record<string, string> = {};
                                activeGenericTab.columns.forEach(col => {
                                  const v = row[col];
                                  if (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) fields[col] = toInput(v);
                                  else if (typeof v === 'boolean') fields[col] = String(v);
                                  else fields[col] = String(v ?? '');
                                });
                                setEditFields(fields);
                              }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => { setChangeReason(''); setConfirmDelete({ id: rowId, name: row.cycleCode || row.filterName || row.action || row.message || row.title || row.requestType || 'Record' }); }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-60 group-hover:opacity-100 transition-opacity">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
        </div>
        {/* Pagination. `totalItems` is the SERVER total where the endpoint
            paginates, and the filtered array length where it does not — the
            distinction matters: using the array length on a server-paginated
            tab would report "50 of 50" while 18,000 rows sat behind it. */}
        {totalRecords > 0 && (
          <div className="border-t border-slate-200 px-4 py-2.5 bg-slate-50/60 shrink-0">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={totalRecords}
              onPageChange={setPage}
              onPageSizeChange={size => { setPageSize(size); setPage(1); }}
              pageSizeOptions={pageSizeOptions}
            />
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">Permanent Deletion</h3>
                  <p className="text-[12px] text-slate-400">This action cannot be undone</p>
                </div>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-1">
                <p className="text-[13px] text-red-800">
                  <strong>{confirmDelete.name}</strong> will be permanently removed. A record of the deletion, including the row's contents, is kept in the audit trail.
                </p>
              </div>
              <ReasonBox value={changeReason} onChange={setChangeReason} danger />
              <div className="flex gap-3 mt-4">
                <button onClick={() => { setConfirmDelete(null); setChangeReason(''); }} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={() => handleDeleteGeneric(confirmDelete.id)}
                  disabled={processing || !reasonOk(changeReason)}
                  title={reasonOk(changeReason) ? undefined : 'Enter a reason for this deletion'}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-red-700 transition-colors">
                  {processing ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Row Edit Dialog — used by Cleaning Cycles + Filter Events tabs.
          Shows only fields that exist on the underlying DB row (not the
          derived display columns). Checksum intentionally omitted because
          editing it would invalidate the SHA-256 hash chain. */}
      {rowEditDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500" />
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-bold text-slate-800">
                  Edit {(() => {
                    const titleMap: Record<string, string> = {
                      'cycle': 'Cleaning Cycle', 'event': 'Filter Event',
                      'pm-entry': 'PM Entry', 'notification': 'Notification',
                      'admin-request': 'Admin Request', 'block-change': 'Block Change Request',
                    };
                    return titleMap[rowEditDialog.entity];
                  })()}
                </h3>
                <p className="text-[12px] text-slate-400 mt-0.5">{rowEditDialog.rowName}</p>
              </div>
              <button onClick={() => { setRowEditDialog(null); setRowEditFields({}); }}
                className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {rowEditDialog.entity === 'cycle' ? (
                <>
                  <Field label="Cycle Code" value={rowEditFields.cycleCode} onChange={v => setRowEditFields(p => ({ ...p, cycleCode: v }))} />
                  <Field label="Status" value={rowEditFields.status} onChange={v => setRowEditFields(p => ({ ...p, status: v }))}
                    select options={['IN_PROGRESS', 'COMPLETED', 'TERMINATED']} />
                  <Field label="Cleaning Reason" value={rowEditFields.cleaningReasonLabel} onChange={v => setRowEditFields(p => ({ ...p, cleaningReasonLabel: v }))} />
                  <Field label="Sequence Number" value={rowEditFields.sequenceNumber} onChange={v => setRowEditFields(p => ({ ...p, sequenceNumber: v }))} type="number" />
                  <Field label="Started At" value={rowEditFields.startedAt} onChange={v => setRowEditFields(p => ({ ...p, startedAt: v }))} type="datetime-local" />
                  <Field label="Completed At" value={rowEditFields.completedAt} onChange={v => setRowEditFields(p => ({ ...p, completedAt: v }))} type="datetime-local" />
                  <Field label="Terminated At" value={rowEditFields.terminatedAt} onChange={v => setRowEditFields(p => ({ ...p, terminatedAt: v }))} type="datetime-local" />
                  <Field label="Termination Reason" value={rowEditFields.terminationReason} onChange={v => setRowEditFields(p => ({ ...p, terminationReason: v }))} textarea />
                  <Field label="Dryer Duration (min)" value={rowEditFields.dryerDurationMinutes} onChange={v => setRowEditFields(p => ({ ...p, dryerDurationMinutes: v }))} type="number" />
                  <Field label="Dryer Started At" value={rowEditFields.dryerStartedAt} onChange={v => setRowEditFields(p => ({ ...p, dryerStartedAt: v }))} type="datetime-local" />
                </>
              ) : rowEditDialog.entity === 'event' ? (
                <>
                  <Field label="Event Type" value={rowEditFields.eventType} onChange={v => setRowEditFields(p => ({ ...p, eventType: v }))} />
                  {/* Dropdowns, not text. A mistyped state is invisible to the
                      stage lookups and silently blanks that column. */}
                  <Field label="From State" value={rowEditFields.fromState}
                    onChange={v => setRowEditFields(p => ({ ...p, fromState: v }))}
                    optionObjs={statesWith(rowEditFields.fromState).map(x => ({ value: x, label: x }))}
                    placeholder="— none —" />
                  <Field label="To State" value={rowEditFields.toState}
                    onChange={v => setRowEditFields(p => ({ ...p, toState: v }))}
                    optionObjs={statesWith(rowEditFields.toState).map(x => ({ value: x, label: x }))}
                    placeholder="— none —" />
                  <Field label="Performed At" value={rowEditFields.performedAt} onChange={v => setRowEditFields(p => ({ ...p, performedAt: v }))} type="datetime-local" />
                  {/* performed_by is a user UUID (FK), so this is a picker —
                      a hand-typed uuid is either wrong or unverifiable. */}
                  <Field label="Performed By" value={rowEditFields.performedBy}
                    onChange={v => setRowEditFields(p => ({ ...p, performedBy: v }))}
                    optionObjs={userOptions} placeholder="— unchanged —" />
                  {/* RO water / compressed air / dryer temperature live in
                      attributes.instrumentReadings on the EVENT, which is why
                      they were never editable from the cycle dialog. Only the
                      VALUE is editable: instrument identity, uom and least count
                      describe the instrument, not the operator's reading. */}
                  {(rowEditReadings ?? []).map((r: any, i: number) => (
                    <Field
                      key={`${r.instrumentId ?? r.description}-${i}`}
                      label={`${r.description ?? 'Reading'}${r.uom ? ` (${r.uom})` : ''}`}
                      type="number"
                      value={rowEditFields[`reading_${i}`]}
                      onChange={v => setRowEditFields(p => ({ ...p, [`reading_${i}`]: v }))}
                    />
                  ))}
                  <Field label="Remarks" value={rowEditFields.remarks} onChange={v => setRowEditFields(p => ({ ...p, remarks: v }))} textarea />
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Note: SHA-256 checksum is not editable. Changing it would break the audit hash chain.
                  </p>
                </>
              ) : rowEditDialog.entity === 'pm-entry' ? (
                <>
                  <Field label="Month (1-12)" value={rowEditFields.month} onChange={v => setRowEditFields(p => ({ ...p, month: v }))} type="number" />
                  <Field label="Planned Date" value={rowEditFields.plannedDate} onChange={v => setRowEditFields(p => ({ ...p, plannedDate: v }))} type="datetime-local" />
                  <Field label="Window Start" value={rowEditFields.windowStart} onChange={v => setRowEditFields(p => ({ ...p, windowStart: v }))} type="datetime-local" />
                  <Field label="Window End" value={rowEditFields.windowEnd} onChange={v => setRowEditFields(p => ({ ...p, windowEnd: v }))} type="datetime-local" />
                  <Field label="Tolerance Days" value={rowEditFields.toleranceDays} onChange={v => setRowEditFields(p => ({ ...p, toleranceDays: v }))} type="number" />
                  <Field label="Approval Status" value={rowEditFields.approvalStatus} onChange={v => setRowEditFields(p => ({ ...p, approvalStatus: v }))}
                    select options={['', 'PENDING', 'APPROVED', 'REJECTED']} />
                  <Field label="Approval Remarks" value={rowEditFields.approvalRemarks} onChange={v => setRowEditFields(p => ({ ...p, approvalRemarks: v }))} textarea />
                  <Field label="Notes" value={rowEditFields.notes} onChange={v => setRowEditFields(p => ({ ...p, notes: v }))} textarea />
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Note: execution status (Completed / In Progress / Overdue / Due) is computed from the joined PM execution row + window dates and is not directly editable.
                  </p>
                </>
              ) : rowEditDialog.entity === 'notification' ? (
                <>
                  <Field label="Type" value={rowEditFields.type} onChange={v => setRowEditFields(p => ({ ...p, type: v }))} />
                  <Field label="Title" value={rowEditFields.title} onChange={v => setRowEditFields(p => ({ ...p, title: v }))} />
                  <Field label="Message" value={rowEditFields.message} onChange={v => setRowEditFields(p => ({ ...p, message: v }))} textarea />
                  <Field label="Target User ID" value={rowEditFields.targetUserId} onChange={v => setRowEditFields(p => ({ ...p, targetUserId: v }))} />
                  <Field label="For Role" value={rowEditFields.forRole} onChange={v => setRowEditFields(p => ({ ...p, forRole: v }))} />
                  <Field label="Read" value={rowEditFields.isRead} onChange={v => setRowEditFields(p => ({ ...p, isRead: v }))}
                    select options={['true', 'false']} />
                  <Field label="Read At" value={rowEditFields.readAt} onChange={v => setRowEditFields(p => ({ ...p, readAt: v }))} type="datetime-local" />
                </>
              ) : rowEditDialog.entity === 'admin-request' ? (
                <>
                  <Field label="Request Type" value={rowEditFields.requestType} onChange={v => setRowEditFields(p => ({ ...p, requestType: v }))}
                    select options={['CREATE_USER', 'RESET_PASSWORD', 'UNLOCK_USER', 'MODIFY_USER']} />
                  <Field label="Status" value={rowEditFields.status} onChange={v => setRowEditFields(p => ({ ...p, status: v }))}
                    select options={['PENDING', 'APPROVED', 'REJECTED']} />
                  <Field label="Requester Name" value={rowEditFields.requesterName} onChange={v => setRowEditFields(p => ({ ...p, requesterName: v }))} />
                  <Field label="Requester Employee ID" value={rowEditFields.requesterEmployeeId} onChange={v => setRowEditFields(p => ({ ...p, requesterEmployeeId: v }))} />
                  <Field label="Requester Email" value={rowEditFields.requesterEmail} onChange={v => setRowEditFields(p => ({ ...p, requesterEmail: v }))} />
                  <Field label="Requester Remarks" value={rowEditFields.remarks} onChange={v => setRowEditFields(p => ({ ...p, remarks: v }))} textarea />
                  <Field label="Admin Remarks" value={rowEditFields.adminRemarks} onChange={v => setRowEditFields(p => ({ ...p, adminRemarks: v }))} textarea />
                </>
              ) : (
                <>
                  <Field label="Status" value={rowEditFields.status} onChange={v => setRowEditFields(p => ({ ...p, status: v }))}
                    select options={['PENDING', 'APPROVED', 'REJECTED', 'CONSUMED']} />
                  <Field label="Reason" value={rowEditFields.reason} onChange={v => setRowEditFields(p => ({ ...p, reason: v }))} textarea />
                  <Field label="Processed Comment" value={rowEditFields.processedComment} onChange={v => setRowEditFields(p => ({ ...p, processedComment: v }))} textarea />
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Note: filter / from-block / to-block references and the requester are not editable here — they're set when the request is created.
                  </p>
                </>
              )}
            </div>
            <div className="px-6 pb-2">
              <ReasonBox value={changeReason} onChange={setChangeReason} />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => { setRowEditDialog(null); setRowEditFields({}); setChangeReason(''); }}
                className="flex-1 py-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={submitRowEdit} disabled={rowEditSaving || !reasonOk(changeReason)}
                title={reasonOk(changeReason) ? undefined : 'Enter a reason for this change'}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:from-cyan-500 hover:to-blue-500">
                {rowEditSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create-row Dialog — inserts a new record into the active tab's table */}
      {createDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500" />
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-bold text-slate-800">
                  Create {(() => {
                    const titleMap: Record<RowEntity, string> = {
                      'cycle': 'Cleaning Cycle', 'event': 'Filter Event', 'pm-entry': 'PM Entry',
                      'notification': 'Notification', 'admin-request': 'Admin Request', 'block-change': 'Block Change Request',
                    };
                    return titleMap[createDialog.entity];
                  })()}
                </h3>
                <p className="text-[12px] text-slate-400 mt-0.5">New record — not written to the audit trail</p>
              </div>
              <button onClick={() => { setCreateDialog(null); setCreateFields({}); }} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-3 max-h-[60vh] overflow-y-auto">
              {createDialog.entity === 'cycle' ? (
                <>
                  <Field label="Filter" required optionObjs={filterOpts} placeholder={createFiltersData.isLoading ? 'Loading…' : 'Select a filter'} value={createFields.filterId} onChange={v => setCreateFields(p => ({ ...p, filterId: v }))} />
                  <Field label="Cleaning Profile" required optionObjs={profileOpts} placeholder={createProfilesData.isLoading ? 'Loading…' : 'Select a profile'} value={createFields.profileId} onChange={v => setCreateFields(p => ({ ...p, profileId: v }))} />
                  <Field label="Cleaning Reason" required value={createFields.cleaningReasonLabel} onChange={v => setCreateFields(p => ({ ...p, cleaningReasonLabel: v }))} />
                  <Field label="Status" select options={['COMPLETED', 'IN_PROGRESS', 'TERMINATED']} value={createFields.status} onChange={v => setCreateFields(p => ({ ...p, status: v }))} />
                  <Field label="Cycle Code" placeholder="Auto-generated if blank" value={createFields.cycleCode} onChange={v => setCreateFields(p => ({ ...p, cycleCode: v }))} />
                  <Field label="Sequence Number" type="number" placeholder="Auto if blank" value={createFields.sequenceNumber} onChange={v => setCreateFields(p => ({ ...p, sequenceNumber: v }))} />
                  <Field label="Started At" type="datetime-local" value={createFields.startedAt} onChange={v => setCreateFields(p => ({ ...p, startedAt: v }))} />
                  <Field label="Completed At" type="datetime-local" value={createFields.completedAt} onChange={v => setCreateFields(p => ({ ...p, completedAt: v }))} />
                  <Field label="Terminated At" type="datetime-local" value={createFields.terminatedAt} onChange={v => setCreateFields(p => ({ ...p, terminatedAt: v }))} />
                  <Field label="Termination Reason" textarea value={createFields.terminationReason} onChange={v => setCreateFields(p => ({ ...p, terminationReason: v }))} />
                  <Field label="Dryer Duration (min)" type="number" value={createFields.dryerDurationMinutes} onChange={v => setCreateFields(p => ({ ...p, dryerDurationMinutes: v }))} />
                  <Field label="Dryer Started At" type="datetime-local" value={createFields.dryerStartedAt} onChange={v => setCreateFields(p => ({ ...p, dryerStartedAt: v }))} />
                  <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    A blank cycle code / sequence is generated automatically. Only ONE in-progress cycle is allowed per filter — use COMPLETED for historical records.
                  </p>
                </>
              ) : createDialog.entity === 'event' ? (
                <>
                  <Field label="Filter" required optionObjs={filterOpts} placeholder={createFiltersData.isLoading ? 'Loading…' : 'Select a filter'} value={createFields.filterId} onChange={v => setCreateFields(p => ({ ...p, filterId: v }))} />
                  <Field label="Event Type" required select options={['', ...FILTER_EVENT_TYPES]} value={createFields.eventType} onChange={v => setCreateFields(p => ({ ...p, eventType: v }))} />
                  <Field label="Cycle ID (optional)" placeholder="Must belong to the selected filter" value={createFields.cycleId} onChange={v => setCreateFields(p => ({ ...p, cycleId: v }))} />
                  <Field label="From State" value={createFields.fromState} onChange={v => setCreateFields(p => ({ ...p, fromState: v }))} />
                  <Field label="To State" value={createFields.toState} onChange={v => setCreateFields(p => ({ ...p, toState: v }))} />
                  <Field label="Performed At" type="datetime-local" value={createFields.performedAt} onChange={v => setCreateFields(p => ({ ...p, performedAt: v }))} />
                  <Field label="Remarks" textarea value={createFields.remarks} onChange={v => setCreateFields(p => ({ ...p, remarks: v }))} />
                  <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    Performed-by, IP and the SHA-256 checksum are stamped automatically.
                  </p>
                </>
              ) : createDialog.entity === 'pm-entry' ? (
                <>
                  {(scheduleOpts.length > 0 || createSchedulesData.isLoading) ? (
                    <Field label="PM Schedule" required optionObjs={scheduleOpts} placeholder={createSchedulesData.isLoading ? 'Loading…' : 'Select a schedule'} value={createFields.scheduleId} onChange={v => setCreateFields(p => ({ ...p, scheduleId: v }))} />
                  ) : (
                    <Field label="PM Schedule ID" required placeholder="No PM schedules exist yet — paste a schedule UUID" value={createFields.scheduleId} onChange={v => setCreateFields(p => ({ ...p, scheduleId: v }))} />
                  )}
                  <Field label="Month (1-12)" required type="number" value={createFields.month} onChange={v => setCreateFields(p => ({ ...p, month: v }))} />
                  <Field label="Planned Date" required type="datetime-local" value={createFields.plannedDate} onChange={v => setCreateFields(p => ({ ...p, plannedDate: v }))} />
                  <Field label="Window Start" type="datetime-local" placeholder="Defaults to planned date" value={createFields.windowStart} onChange={v => setCreateFields(p => ({ ...p, windowStart: v }))} />
                  <Field label="Window End" type="datetime-local" placeholder="Defaults to planned date" value={createFields.windowEnd} onChange={v => setCreateFields(p => ({ ...p, windowEnd: v }))} />
                  <Field label="Tolerance Days" type="number" value={createFields.toleranceDays} onChange={v => setCreateFields(p => ({ ...p, toleranceDays: v }))} />
                  <Field label="Approval Status" select options={['', 'PENDING', 'APPROVED', 'REJECTED']} value={createFields.approvalStatus} onChange={v => setCreateFields(p => ({ ...p, approvalStatus: v }))} />
                  <Field label="Approval Remarks" textarea value={createFields.approvalRemarks} onChange={v => setCreateFields(p => ({ ...p, approvalRemarks: v }))} />
                  <Field label="Notes" textarea value={createFields.notes} onChange={v => setCreateFields(p => ({ ...p, notes: v }))} />
                </>
              ) : createDialog.entity === 'notification' ? (
                <>
                  <Field label="Type" required select options={['', ...NOTIFICATION_TYPES]} value={createFields.type} onChange={v => setCreateFields(p => ({ ...p, type: v }))} />
                  <Field label="Title" required value={createFields.title} onChange={v => setCreateFields(p => ({ ...p, title: v }))} />
                  <Field label="Message" required textarea value={createFields.message} onChange={v => setCreateFields(p => ({ ...p, message: v }))} />
                  <Field label="Target User ID" value={createFields.targetUserId} onChange={v => setCreateFields(p => ({ ...p, targetUserId: v }))} />
                  <Field label="For User ID" placeholder="Blank = admins" value={createFields.forUserId} onChange={v => setCreateFields(p => ({ ...p, forUserId: v }))} />
                  <Field label="For Role" value={createFields.forRole} onChange={v => setCreateFields(p => ({ ...p, forRole: v }))} />
                  <Field label="Created At" type="datetime-local" placeholder="Defaults to now" value={createFields.createdAt} onChange={v => setCreateFields(p => ({ ...p, createdAt: v }))} />
                  <Field label="Read" select options={['false', 'true']} value={createFields.isRead} onChange={v => setCreateFields(p => ({ ...p, isRead: v }))} />
                  <Field label="Read At" type="datetime-local" value={createFields.readAt} onChange={v => setCreateFields(p => ({ ...p, readAt: v }))} />
                </>
              ) : createDialog.entity === 'admin-request' ? (
                <>
                  <Field label="Request Type" required select options={['', 'CREATE_USER', 'RESET_PASSWORD', 'UNLOCK_USER', 'MODIFY_USER']} value={createFields.requestType} onChange={v => setCreateFields(p => ({ ...p, requestType: v }))} />
                  <Field label="Status" select options={['PENDING', 'APPROVED', 'REJECTED']} value={createFields.status} onChange={v => setCreateFields(p => ({ ...p, status: v }))} />
                  <Field label="Requester Name" required value={createFields.requesterName} onChange={v => setCreateFields(p => ({ ...p, requesterName: v }))} />
                  <Field label="Requester Employee ID" value={createFields.requesterEmployeeId} onChange={v => setCreateFields(p => ({ ...p, requesterEmployeeId: v }))} />
                  <Field label="Requester Email" value={createFields.requesterEmail} onChange={v => setCreateFields(p => ({ ...p, requesterEmail: v }))} />
                  <Field label="Requested At" type="datetime-local" placeholder="Defaults to now" value={createFields.requestedAt} onChange={v => setCreateFields(p => ({ ...p, requestedAt: v }))} />
                  <Field label="Requester Remarks" textarea value={createFields.remarks} onChange={v => setCreateFields(p => ({ ...p, remarks: v }))} />
                  <Field label="Admin Remarks" textarea value={createFields.adminRemarks} onChange={v => setCreateFields(p => ({ ...p, adminRemarks: v }))} />
                </>
              ) : (
                <>
                  <Field label="Filter" required optionObjs={filterOpts} placeholder={createFiltersData.isLoading ? 'Loading…' : 'Select a filter'} value={createFields.filterId} onChange={v => setCreateFields(p => ({ ...p, filterId: v }))} />
                  <Field label="Filter Name" required value={createFields.filterName} onChange={v => setCreateFields(p => ({ ...p, filterName: v }))} />
                  <Field label="From Block ID" required value={createFields.fromBlockId} onChange={v => setCreateFields(p => ({ ...p, fromBlockId: v }))} />
                  <Field label="From Block Name" required value={createFields.fromBlockName} onChange={v => setCreateFields(p => ({ ...p, fromBlockName: v }))} />
                  <Field label="To Block ID" required value={createFields.toBlockId} onChange={v => setCreateFields(p => ({ ...p, toBlockId: v }))} />
                  <Field label="To Block Name" required value={createFields.toBlockName} onChange={v => setCreateFields(p => ({ ...p, toBlockName: v }))} />
                  <Field label="Status" select options={['PENDING', 'APPROVED', 'REJECTED', 'CONSUMED']} value={createFields.status} onChange={v => setCreateFields(p => ({ ...p, status: v }))} />
                  <Field label="Reason" textarea value={createFields.reason} onChange={v => setCreateFields(p => ({ ...p, reason: v }))} />
                  <Field label="Processed Comment" textarea value={createFields.processedComment} onChange={v => setCreateFields(p => ({ ...p, processedComment: v }))} />
                  <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    Requester defaults to you. Block IDs/names are entered manually (no block picker here).
                  </p>
                </>
              )}
            </div>
            <div className="px-6 pb-2">
              <ReasonBox value={changeReason} onChange={setChangeReason} />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => { setCreateDialog(null); setCreateFields({}); setChangeReason(''); }}
                className="flex-1 py-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={submitCreate} disabled={createSaving || !reasonOk(changeReason)}
                title={reasonOk(changeReason) ? undefined : 'Enter a reason for this change'}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:from-cyan-500 hover:to-blue-500">
                {createSaving ? 'Creating…' : 'Create Record'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Reason prompt ──────────────────────────────────────────────────
          Used by the surfaces that have no dialog of their own: the inline row
          edits on Retirements / Replacements, and the row actions on the Audit
          Trail tab. Every mutation on this page needs a reason, and a textarea
          cannot live inside a table row. */}
      {reasonPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className={`h-1.5 bg-gradient-to-r ${reasonPrompt.danger ? 'from-red-500 to-rose-500' : 'from-cyan-500 to-blue-500'}`} />
            <div className="p-6">
              <h3 className="text-[15px] font-bold text-slate-800 mb-2">{reasonPrompt.title}</h3>
              <div className={`text-[13px] rounded-xl p-3 border ${reasonPrompt.danger ? 'bg-red-50 border-red-100 text-red-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                {reasonPrompt.body}
              </div>
              <ReasonBox value={promptReason} onChange={setPromptReason} danger={reasonPrompt.danger} />
              <div className="flex gap-3 mt-4">
                <button onClick={() => { setReasonPrompt(null); setPromptReason(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={runReasonPrompt} disabled={promptBusy || !reasonOk(promptReason)}
                  title={reasonOk(promptReason) ? undefined : 'Enter a reason for this change'}
                  className={`flex-1 py-2.5 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors ${reasonPrompt.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'}`}>
                  {promptBusy ? 'Working…' : reasonPrompt.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Audit record edit ──────────────────────────────────────────────
          Corrects a factually wrong audit row. Checksum, previous checksum and
          chain position are absent on purpose: editable, they would let the
          operator forge a chain link and conceal the break this edit creates. */}
      {auditEditDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-500" />
            <div className="px-6 pt-5 pb-3">
              <h3 className="text-[15px] font-bold text-slate-800">Edit audit record</h3>
              <p className="text-[12px] text-slate-400 mt-0.5">{auditEditDialog.action}</p>
            </div>
            <div className="px-6 pb-4 overflow-y-auto space-y-3">
              <div className="text-[12px] bg-red-50 border border-red-100 rounded-xl p-3 text-red-800">
                Editing an audit record breaks the tamper-evident hash chain from this
                record onward — <strong>permanently</strong>. Verify Chain will report every
                later record as unverifiable. Use <strong>Redact</strong> instead if the record
                only needs to be masked; the original values are preserved either way.
              </div>
              <Field label="Timestamp" type="datetime-local" value={auditEditFields.timestamp} onChange={v => setAuditEditFields(p => ({ ...p, timestamp: v }))} />
              <Field label="User Name" value={auditEditFields.userName} onChange={v => setAuditEditFields(p => ({ ...p, userName: v }))} />
              <Field label="User Role" value={auditEditFields.userRole} onChange={v => setAuditEditFields(p => ({ ...p, userRole: v }))} />
              <Field label="Action" value={auditEditFields.action} onChange={v => setAuditEditFields(p => ({ ...p, action: v }))} />
              <Field label="Target Type" value={auditEditFields.targetType} onChange={v => setAuditEditFields(p => ({ ...p, targetType: v }))} />
              <Field label="Target ID" value={auditEditFields.targetId} onChange={v => setAuditEditFields(p => ({ ...p, targetId: v }))} />
              <Field label="Signature Meaning" textarea value={auditEditFields.signatureMeaning} onChange={v => setAuditEditFields(p => ({ ...p, signatureMeaning: v }))} />
              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                The checksum, previous checksum and chain position are not editable — changing
                them would let a broken chain be made to look intact.
              </p>
              <ReasonBox value={changeReason} onChange={setChangeReason} danger />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => { setAuditEditDialog(null); setAuditEditFields({}); setChangeReason(''); }}
                className="flex-1 py-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancel</button>
              <button onClick={submitAuditEdit} disabled={auditEditSaving || !reasonOk(changeReason)}
                title={reasonOk(changeReason) ? undefined : 'Enter a reason for this change'}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-red-700">
                {auditEditSaving ? 'Saving…' : 'Save & break chain'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual retirement / replacement record ─────────────────────────
          Both pick existing filters. "Create a retirement record" means retiring
          a live filter with a back-dated date and remarks; "create a
          replacement record" records a swap between two filters that already
          exist. Neither invents a filter — that belongs on the Filters page. */}
      {manualRecordDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="h-1.5 bg-gradient-to-r from-cyan-500 to-blue-500" />
            <div className="px-6 pt-5 pb-3">
              <h3 className="text-[15px] font-bold text-slate-800">
                {manualRecordDialog.kind === 'retirement' ? 'Create retirement record' : 'Create replacement record'}
              </h3>
              <p className="text-[12px] text-slate-400 mt-0.5">
                {manualRecordDialog.kind === 'retirement'
                  ? 'Retires an existing filter and records when, by whom and why.'
                  : 'Records a filter swap that happened outside the app.'}
              </p>
            </div>
            <div className="px-6 pb-4 overflow-y-auto space-y-3">
              {manualRecordDialog.kind === 'retirement' ? (
                <>
                  <Field label="Filter being retired" required value={manualRecordFields.filterId}
                    onChange={v => setManualRecordFields(p => ({ ...p, filterId: v }))}
                    optionObjs={manualFilters.filter((f: any) => f.status !== 'Retired').map((f: any) => ({ value: f.id, label: f.name }))}
                    placeholder="Select a filter…" />
                  <Field label="Retired On" type="datetime-local" value={manualRecordFields.retiredAt} onChange={v => setManualRecordFields(p => ({ ...p, retiredAt: v }))} />
                  <Field label="Performed By" value={manualRecordFields.performedBy} onChange={v => setManualRecordFields(p => ({ ...p, performedBy: v }))} />
                  <Field label="Remarks" textarea value={manualRecordFields.remarks} onChange={v => setManualRecordFields(p => ({ ...p, remarks: v }))} />
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    The filter is moved to Retired and leaves the Block/AHU tree, exactly as the
                    Retire action does. Any cleaning cycle still in progress is terminated. Use
                    Restore to undo.
                  </p>
                </>
              ) : (
                <>
                  <Field label="Filter that was replaced" required value={manualRecordFields.oldFilterId}
                    onChange={v => setManualRecordFields(p => ({ ...p, oldFilterId: v }))}
                    optionObjs={manualFilters.map((f: any) => ({ value: f.id, label: f.name }))}
                    placeholder="Select a filter…" />
                  <Field label="Filter that replaced it" required value={manualRecordFields.newFilterId}
                    onChange={v => setManualRecordFields(p => ({ ...p, newFilterId: v }))}
                    optionObjs={manualFilters.map((f: any) => ({ value: f.id, label: f.name }))}
                    placeholder="Select a filter…" />
                  <Field label="Replaced On" type="datetime-local" value={manualRecordFields.replacedAt} onChange={v => setManualRecordFields(p => ({ ...p, replacedAt: v }))} />
                  <Field label="Performed By" value={manualRecordFields.performedBy} onChange={v => setManualRecordFields(p => ({ ...p, performedBy: v }))} />
                  <Field label="Remarks" textarea value={manualRecordFields.remarks} onChange={v => setManualRecordFields(p => ({ ...p, remarks: v }))} />
                  <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    This writes a new, correctly chain-linked audit record — it adds to the audit
                    chain rather than breaking it. Neither filter's status is changed.
                  </p>
                </>
              )}
              <ReasonBox value={changeReason} onChange={setChangeReason} />
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => { setManualRecordDialog(null); setManualRecordFields({}); setChangeReason(''); }}
                className="flex-1 py-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancel</button>
              <button onClick={submitManualRecord} disabled={manualRecordSaving || !reasonOk(changeReason)}
                title={reasonOk(changeReason) ? undefined : 'Enter a reason for this change'}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:from-cyan-500 hover:to-blue-500">
                {manualRecordSaving ? 'Creating…' : 'Create Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unretire Dialog */}
      {unretireDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">Restore Filter</h3>
                  <p className="text-[12px] text-slate-400">Unretire and set back to Active</p>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-4">
                <p className="text-[13px] text-emerald-800">
                  <strong>{unretireDialog.name}</strong> will be restored to Active status. The retirement audit record is kept.
                </p>
                {unretireDialog.preRetireParentName && (
                  <p className="text-[12px] text-emerald-700 mt-1.5">
                    Original parent: <strong>{unretireDialog.preRetireParentName}</strong> — will be auto-restored
                  </p>
                )}
              </div>
              <ReasonBox value={changeReason} onChange={setChangeReason} />
              <div className="flex gap-3 mt-4">
                <button onClick={() => { setUnretireDialog(null); setUnretireParentId(''); setChangeReason(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={() => handleUnretire(unretireDialog.id)} disabled={processing || !reasonOk(changeReason)}
                  title={reasonOk(changeReason) ? undefined : 'Enter a reason for restoring this filter'}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500 transition-all">
                  {processing ? 'Restoring...' : 'Restore Filter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rendered last so it wins any z-index tie: the password step is always
          the innermost confirmation, on top of whatever dialog opened it. */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={() => { reauth.cancel(); setProcessing(false); setPromptBusy(false); setRowEditSaving(false); setCreateSaving(false); setAuditEditSaving(false); setManualRecordSaving(false); }}
      />

    </div>
  );
}
