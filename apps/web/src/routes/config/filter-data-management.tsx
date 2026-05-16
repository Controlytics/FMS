import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { formatByLeastCount } from '@/lib/format-by-least-count';

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
  const ev = stageEvents.find((e: any) => (e.attributes as any)?.instrumentReadings?.length > 0) ?? stageEvents[0];
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

// Alarms helpers — copied from /alarms page so data-mgmt renders identically.
const ALARM_SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  MAJOR: 'bg-orange-100 text-orange-700 border-orange-200',
  MINOR: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  WARNING: 'bg-blue-100 text-blue-700 border-blue-200',
  INFO: 'bg-slate-100 text-slate-600 border-slate-200',
};
const ALARM_SEVERITY_DOT: Record<string, string> = {
  CRITICAL: 'bg-red-500', MAJOR: 'bg-orange-500', MINOR: 'bg-yellow-500',
  WARNING: 'bg-blue-500', INFO: 'bg-slate-400',
};
const ALARM_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-red-100 text-red-700 border-red-200',
  ACKNOWLEDGED: 'bg-amber-100 text-amber-700 border-amber-200',
  CLEARED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  MANUALLY_CLEARED: 'bg-blue-100 text-blue-700 border-blue-200',
};
const ALARM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active', ACKNOWLEDGED: 'Acknowledged', CLEARED: 'Cleared', MANUALLY_CLEARED: 'Manually Cleared',
};
function getAlarmHighLimit(a: any): string | null {
  const d = a.triggerDetails; if (!d || d._threshold === undefined) return null;
  if (d._condition === '>' || d._condition === '>=') return String(d._threshold);
  return null;
}
function getAlarmLowLimit(a: any): string | null {
  const d = a.triggerDetails; if (!d || d._threshold === undefined) return null;
  if (d._condition === '<' || d._condition === '<=') return String(d._threshold);
  return null;
}
function extractAlarmValue(details: Record<string, unknown> | undefined, sourceField?: string): string | null {
  if (!details) return null;
  if (sourceField) {
    const val = details[sourceField];
    if (val !== undefined && val !== null) return typeof val === 'number' ? val.toFixed(2) : String(val);
  }
  for (const [k, v] of Object.entries(details)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'number') return v.toFixed(2);
  }
  return null;
}
function getAlarmGeneratedValue(a: any): string | null { return extractAlarmValue(a.triggerDetails, a.triggerDetails?._sourceField); }
function getAlarmClearedValue(a: any): string | null { return extractAlarmValue(a.clearDetails, a.triggerDetails?._sourceField); }

// PM entry helpers — month names + status derivation matches /pm-schedules/:entityId detail page
const PM_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Audit-trail Success/Fail derivation matches /audit page behavior
function getAuditStatus(action: string): 'Success' | 'Fail' {
  if (!action) return 'Success';
  return action.toUpperCase().includes('FAIL') || action.toUpperCase().includes('REJECT') || action.toUpperCase().includes('DENIED')
    ? 'Fail' : 'Success';
}

// Notification type → color (matches /notifications typeColors)
const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
  CYCLE_STARTED: 'bg-blue-50 text-blue-700 border-blue-200',
  CYCLE_COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CYCLE_TERMINATED: 'bg-red-50 text-red-700 border-red-200',
  ACCOUNT_LOCKED: 'bg-red-50 text-red-700 border-red-200',
  PASSWORD_RESET_REQUEST: 'bg-amber-50 text-amber-700 border-amber-200',
  USER_CREATED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ALARM: 'bg-orange-50 text-orange-700 border-orange-200',
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
}) {
  const { label, value, onChange, type = 'text', textarea, select, options } = props;
  const cls = 'w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-[13px] text-slate-700 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none';
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</label>
      {select ? (
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls}>
          {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : textarea ? (
        <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={2} className={cls} />
      ) : (
        <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls} />
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

export function FilterDataManagementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDateTime } = useDatetimeFormat();
  const [tab, setTab] = useState<string>('retirements');
  const [processing, setProcessing] = useState(false);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; type: 'retirement' | 'replacement'; name: string } | null>(null);
  // Edit-row modal for cycles/events tabs. Shows only the columns that live
  // ON the underlying DB row (vs. the derived display columns in the table).
  // For cleaning_cycles: cycleCode, status, cleaningReasonLabel, startedAt,
  //   completedAt, terminatedAt, terminationReason, sequenceNumber,
  //   dryerDurationMinutes, dryerStartedAt
  // For filter_events:  eventType, fromState, toState, performedAt, remarks
  // (checksum deliberately excluded — editing would break the SHA-256 hash chain)
  const [rowEditDialog, setRowEditDialog] = useState<{ id: string; entity: 'cycle' | 'event' | 'alarm' | 'pm-entry' | 'notification' | 'admin-request' | 'block-change'; rowName: string } | null>(null);
  const [rowEditFields, setRowEditFields] = useState<Record<string, any>>({});
  const [rowEditSaving, setRowEditSaving] = useState(false);
  const [unretireDialog, setUnretireDialog] = useState<{ id: string; name: string; preRetireParentId: string | null; preRetireParentName: string | null } | null>(null);
  const [unretireParentId, setUnretireParentId] = useState('');

  const { data: retirements, isLoading: retLoading } = useSWR<RetiredFilter[]>('/api/filters/retirements');
  const { data: replacements, isLoading: repLoading } = useSWR<ReplacementRecord[]>('/api/filters/replacements');

  // Generic data tabs — columns mirror what's actually shown on the
  // corresponding user-facing pages so admins don't see internal UUIDs and
  // junk columns the operator never sees.
  //
  // cleaning-cycles, filter-events, alarms AND pm-entries are NOT in this
  // list — they have dedicated render branches below that hit the same
  // enriched endpoints the user-facing pages use (cycles join filter+events,
  // events use filter-traceability's card layout, alarms use the /alarms
  // page table with severity/threshold/value columns, pm-entries use the
  // /pm-schedules/:id detail-page card grid) so the data-management view
  // looks identical to what the operator sees.
  // All tabs that previously lived here — cleaning-cycles, filter-events,
  // alarms, pm-entries, audit-trail, notifications, admin-requests, and
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
  const cyclesEnriched = useSWR<any>(tab === 'cleaning-cycles' ? '/api/filters/cycles?page=1&limit=50&includeEvents=true' : null);
  const cycleInstancesData = useSWR<any>(tab === 'cleaning-cycles' ? '/api/assets/instances?limit=500' : null);
  const cycleTemplatesData = useSWR<any>(tab === 'cleaning-cycles' ? '/api/assets/templates?limit=1000' : null);
  // Bug fix 2026-05-10: match by stable `templateKind === 'FILTER'`, not the
  // editable `name`. Without this, the cycle attribute map was empty whenever
  // the admin renamed the Filter template or created variants.
  const cycleFilterTemplateIds = new Set(
    (cycleTemplatesData.data?.data ?? [])
      .filter((t: any) => t.templateKind === 'FILTER')
      .map((t: any) => t.id),
  );
  const cycleFilterAttrMap = new Map<string, Record<string, any>>();
  (cycleInstancesData.data?.data ?? []).forEach((i: any) => {
    if (cycleFilterTemplateIds.has(i.templateId)) cycleFilterAttrMap.set(i.id, i.attributes ?? {});
  });
  const enrichedCycles: any[] = cyclesEnriched.data?.data ?? [];
  const filteredEnrichedCycles = enrichedCycles.filter(c => !search || c.filterName?.toLowerCase().includes(search.toLowerCase()) || c.cycleCode?.toLowerCase().includes(search.toLowerCase()));

  const eventsEnriched = useSWR<any>(tab === 'filter-events' ? '/api/filters/events?page=1&limit=50' : null);
  const enrichedEvents: any[] = eventsEnriched.data?.data ?? [];
  const filteredEnrichedEvents = enrichedEvents.filter(e => !search || e.eventType?.toLowerCase().includes(search.toLowerCase()) || e.fromState?.toLowerCase().includes(search.toLowerCase()) || e.toState?.toLowerCase().includes(search.toLowerCase()));

  // Alarms tab — same endpoint as /alarms page, same columns, same badges
  const alarmsEnriched = useSWR<any>(tab === 'alarms' ? '/api/alarms?page=1&limit=50' : null);
  const enrichedAlarms: any[] = alarmsEnriched.data?.data ?? [];
  const filteredEnrichedAlarms = enrichedAlarms.filter(a => !search ||
    a.alarmType?.toLowerCase().includes(search.toLowerCase()) ||
    a.entityName?.toLowerCase().includes(search.toLowerCase()) ||
    a.severity?.toLowerCase().includes(search.toLowerCase()) ||
    a.message?.toLowerCase().includes(search.toLowerCase()));

  // Remaining tabs use the same super-admin data endpoints but are rendered
  // by dedicated branches that mirror their corresponding user-facing pages.
  const auditEnriched = useSWR<any>(tab === 'audit-trail' ? '/api/audit?page=1&limit=50' : null);
  const enrichedAudit: any[] = (auditEnriched.data as any)?.data ?? [];
  const filteredEnrichedAudit = enrichedAudit.filter(a => !search ||
    (a.action ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.userId ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.userName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (a.targetType ?? '').toLowerCase().includes(search.toLowerCase()));

  const notificationsEnriched = useSWR<any>(tab === 'notifications' ? '/api/super-admin/data/notifications?limit=100' : null);
  const enrichedNotifications: any[] = (notificationsEnriched.data as any)?.data ?? [];
  const filteredEnrichedNotifications = enrichedNotifications.filter(n => !search ||
    (n.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (n.message ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (n.type ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (n.targetUserId ?? '').toLowerCase().includes(search.toLowerCase()));

  const adminReqEnriched = useSWR<any>(tab === 'admin-requests' ? '/api/admin-requests' : null);
  const enrichedAdminReqs: any[] = (adminReqEnriched.data as any)?.data ?? (adminReqEnriched.data as any) ?? [];
  const filteredEnrichedAdminReqs = (Array.isArray(enrichedAdminReqs) ? enrichedAdminReqs : []).filter((r: any) => !search ||
    (r.requesterName ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.requesterEmployeeId ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.requestType ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.status ?? '').toLowerCase().includes(search.toLowerCase()));

  const blockChangesEnriched = useSWR<any>(tab === 'block-changes' ? '/api/block-change-requests?page=1&limit=50&status=ALL' : null);
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
  const pmEntriesEnriched = useSWR<any>(tab === 'pm-entries' ? '/api/super-admin/data/pm-entries?limit=100' : null);
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

  const filteredRetirements = (retirements ?? []).filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const filteredReplacements = (replacements ?? []).filter(r => !search ||
    r.oldFilterName.toLowerCase().includes(search.toLowerCase()) ||
    r.newFilterName.toLowerCase().includes(search.toLowerCase()) ||
    r.performedBy.toLowerCase().includes(search.toLowerCase()));

  const handleEditRetirement = async (id: string) => {
    setProcessing(true);
    try {
      const body: any = {};
      if (editFields.name !== undefined) body.name = editFields.name;
      if (editFields.filterSet !== undefined) body.filterSet = editFields.filterSet;
      if (editFields.updatedAt !== undefined) body.updatedAt = editFields.updatedAt;
      await apiClient.put(`/api/super-admin/filter-data/retirements/${id}`, body);
      toast.success('Updated', 'Retirement record updated silently');
      setEditingId(null); setEditFields({}); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleDeleteRetirement = async (id: string) => {
    setProcessing(true);
    try {
      await apiClient.delete(`/api/super-admin/filter-data/retirements/${id}`);
      toast.success('Deleted', 'Retirement record permanently removed');
      setConfirmDelete(null); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleUnretire = async (id: string) => {
    setProcessing(true);
    try {
      await apiClient.post(`/api/super-admin/filter-data/retirements/${id}/unretire`, { parentId: unretireParentId || undefined });
      toast.success('Unretired', 'Filter restored to Active status');
      setUnretireDialog(null); setUnretireParentId(''); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleEditReplacement = async (id: string) => {
    setProcessing(true);
    try {
      const body: any = {};
      for (const f of ['remarks', 'performedBy', 'replacedAt', 'oldFilterId', 'oldFilterName', 'newFilterId', 'newFilterName']) {
        if (editFields[f] !== undefined) body[f] = editFields[f];
      }
      await apiClient.put(`/api/super-admin/filter-data/replacements/${id}`, body);
      toast.success('Updated', 'Replacement record updated silently');
      setEditingId(null); setEditFields({}); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleDeleteReplacement = async (id: string) => {
    setProcessing(true);
    try {
      await apiClient.delete(`/api/super-admin/filter-data/replacements/${id}`);
      toast.success('Deleted', 'Replacement record permanently removed');
      setConfirmDelete(null); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const openRowEdit = (row: any, entity: 'cycle' | 'event' | 'alarm' | 'pm-entry' | 'notification' | 'admin-request' | 'block-change', rowName: string) => {
    setRowEditDialog({ id: row.id, entity, rowName });
    if (entity === 'cycle') {
      setRowEditFields({
        cycleCode: row.cycleCode ?? '',
        status: row.status ?? 'IN_PROGRESS',
        cleaningReasonLabel: row.cleaningReasonLabel ?? '',
        startedAt: row.startedAt ? row.startedAt.slice(0, 16) : '',
        completedAt: row.completedAt ? row.completedAt.slice(0, 16) : '',
        terminatedAt: row.terminatedAt ? row.terminatedAt.slice(0, 16) : '',
        terminationReason: row.terminationReason ?? '',
        sequenceNumber: row.sequenceNumber ?? '',
        dryerDurationMinutes: row.dryerDurationMinutes ?? '',
        dryerStartedAt: row.dryerStartedAt ? row.dryerStartedAt.slice(0, 16) : '',
      });
    } else if (entity === 'event') {
      setRowEditFields({
        eventType: row.eventType ?? '',
        fromState: row.fromState ?? '',
        toState: row.toState ?? '',
        performedAt: row.performedAt ? row.performedAt.slice(0, 16) : '',
        remarks: row.remarks ?? '',
      });
    } else if (entity === 'alarm') {
      // alarm row — only the columns that are settable on the underlying alarm row
      setRowEditFields({
        severity: row.severity ?? 'INFO',
        status: row.status ?? 'ACTIVE',
        alarmType: row.alarmType ?? '',
        message: row.message ?? '',
        acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.slice(0, 16) : '',
        clearedAt: row.clearedAt ? row.clearedAt.slice(0, 16) : '',
      });
    } else if (entity === 'pm-entry') {
      // pm-entry row — editable fields on the underlying pm_schedule_entries row
      setRowEditFields({
        month: row.month ?? '',
        plannedDate: row.plannedDate ? row.plannedDate.slice(0, 16) : '',
        windowStart: row.windowStart ? row.windowStart.slice(0, 16) : '',
        windowEnd: row.windowEnd ? row.windowEnd.slice(0, 16) : '',
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
        readAt: row.readAt ? row.readAt.slice(0, 16) : '',
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
        'alarm': '/api/super-admin/data/alarms',
        'pm-entry': '/api/super-admin/data/pm-entries',
        'notification': '/api/super-admin/data/notifications',
        'admin-request': '/api/super-admin/data/admin-requests',
        'block-change': '/api/super-admin/data/block-change-requests',
      };
      const endpoint = endpointMap[rowEditDialog.entity];
      // Coerce numeric fields + drop empty strings so the server doesn't try
      // to write '' into an integer column. Date inputs come back as
      // 'YYYY-MM-DDTHH:mm' — leave them as-is; backend parses ISO-ish.
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
          body[k] = v;
        }
      }
      await apiClient.put(`${endpoint}/${rowEditDialog.id}`, body);
      const labelMap: Record<string, string> = {
        'cycle': 'Cycle', 'event': 'Event', 'alarm': 'Alarm', 'pm-entry': 'PM entry',
        'notification': 'Notification', 'admin-request': 'Admin request', 'block-change': 'Block change',
      };
      toast.success('Updated', `${labelMap[rowEditDialog.entity]} updated silently`);
      setRowEditDialog(null);
      setRowEditFields({});
      // Refresh both the enriched feed (used by the table) and the super-admin
      // feed (used by other tabs that hit the same endpoint).
      if (rowEditDialog.entity === 'cycle') {
        globalMutate('/api/filters/cycles?page=1&limit=50&includeEvents=true');
        globalMutate('/api/super-admin/data/cleaning-cycles?limit=50');
      } else if (rowEditDialog.entity === 'event') {
        globalMutate('/api/filters/events?page=1&limit=50');
        globalMutate('/api/super-admin/data/filter-events?limit=50');
      } else if (rowEditDialog.entity === 'alarm') {
        globalMutate('/api/alarms?page=1&limit=50');
        globalMutate('/api/super-admin/data/alarms?limit=50');
      } else if (rowEditDialog.entity === 'pm-entry') {
        globalMutate('/api/super-admin/data/pm-entries?limit=100');
      } else if (rowEditDialog.entity === 'notification') {
        globalMutate('/api/super-admin/data/notifications?limit=100');
      } else if (rowEditDialog.entity === 'admin-request') {
        globalMutate('/api/admin-requests');
      } else if (rowEditDialog.entity === 'block-change') {
        globalMutate('/api/block-change-requests?page=1&limit=50&status=ALL');
      }
    } catch (e: any) {
      toast.error('Update failed', e?.message ?? 'Could not update record');
    }
    setRowEditSaving(false);
  };

  const handleDeleteGeneric = async (id: string) => {
    // Resolve endpoint from active tab. The dedicated cleaning-cycles +
    // filter-events tabs aren't in genericTabs but still hit the super-admin
    // data endpoints under the same naming convention.
    let endpoint = activeGenericTab?.endpoint;
    if (!endpoint && tab === 'cleaning-cycles') endpoint = '/api/super-admin/data/cleaning-cycles';
    if (!endpoint && tab === 'filter-events') endpoint = '/api/super-admin/data/filter-events';
    if (!endpoint && tab === 'alarms') endpoint = '/api/super-admin/data/alarms';
    if (!endpoint && tab === 'pm-entries') endpoint = '/api/super-admin/data/pm-entries';
    if (!endpoint && tab === 'audit-trail') endpoint = '/api/super-admin/data/audit-trail';
    if (!endpoint && tab === 'notifications') endpoint = '/api/super-admin/data/notifications';
    if (!endpoint && tab === 'admin-requests') endpoint = '/api/super-admin/data/admin-requests';
    if (!endpoint && tab === 'block-changes') endpoint = '/api/super-admin/data/block-change-requests';
    if (!endpoint) return;

    setProcessing(true);
    try {
      await apiClient.delete(`${endpoint}/${id}`);
      toast.success('Deleted', 'Record permanently removed');
      setConfirmDelete(null);
      // Invalidate both the super-admin data feed AND the enriched feed used
      // by the dedicated cycles/events tabs so the row disappears immediately.
      globalMutate(`${endpoint}?limit=50`);
      if (tab === 'cleaning-cycles') globalMutate('/api/filters/cycles?page=1&limit=50&includeEvents=true');
      if (tab === 'filter-events') globalMutate('/api/filters/events?page=1&limit=50');
      if (tab === 'alarms') globalMutate('/api/alarms?page=1&limit=50');
      if (tab === 'pm-entries') globalMutate('/api/super-admin/data/pm-entries?limit=100');
      if (tab === 'audit-trail') globalMutate('/api/audit?page=1&limit=50');
      if (tab === 'notifications') globalMutate('/api/super-admin/data/notifications?limit=100');
      if (tab === 'admin-requests') globalMutate('/api/admin-requests');
      if (tab === 'block-changes') globalMutate('/api/block-change-requests?page=1&limit=50&status=ALL');
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const isLoading = tab === 'retirements' ? retLoading
    : tab === 'replacements' ? repLoading
    : tab === 'cleaning-cycles' ? cyclesEnriched.isLoading
    : tab === 'filter-events' ? eventsEnriched.isLoading
    : tab === 'alarms' ? alarmsEnriched.isLoading
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
                <span className="text-[12px] text-slate-400">Changes are not recorded in the audit trail</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-800">
                {tab === 'retirements' ? retirements?.length ?? 0 : tab === 'replacements' ? replacements?.length ?? 0 : (genericData as any)?.total ?? genericRows.length}
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
            { key: 'alarms', label: 'Alarms' },
            { key: 'pm-entries', label: 'PM Entries' },
            { key: 'audit-trail', label: 'Audit Trail' },
            { key: 'notifications', label: 'Notifications' },
            { key: 'admin-requests', label: 'Admin Requests' },
            { key: 'block-changes', label: 'Block Changes' },
            ...genericTabs.map((t: GenericTabDef) => ({ key: t.key, label: t.label })),
          ].map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setEditingId(null); setSearch(''); }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 w-52 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" />
        </div>
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
                {filteredRetirements.map(r => {
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
                          <input type="datetime-local" value={editFields.updatedAt ?? r.updatedAt?.slice(0, 16)}
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
                              <button onClick={() => handleEditRetirement(r.id)} disabled={processing}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-[11px] font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(r.id); setEditFields({ name: r.name, filterSet: r.filterSet ?? '', updatedAt: r.updatedAt?.slice(0, 16) ?? '' }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => setUnretireDialog({ id: r.id, name: r.name, preRetireParentId: r.preRetireParentId, preRetireParentName: r.preRetireParentName })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-emerald-600 text-[11px] font-medium rounded-lg hover:bg-emerald-50 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                Restore
                              </button>
                              <button onClick={() => setConfirmDelete({ id: r.id, type: 'retirement', name: r.name })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
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
                {filteredReplacements.map(r => {
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
                          <input type="datetime-local" value={editFields.replacedAt ?? r.replacedAt?.slice(0, 16)}
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
                              <button onClick={() => handleEditReplacement(r.id)} disabled={processing}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-[11px] font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(r.id); setEditFields({ oldFilterName: r.oldFilterName, oldFilterId: r.oldFilterId, newFilterName: r.newFilterName, newFilterId: r.newFilterId, performedBy: r.performedBy, remarks: r.remarks ?? '', replacedAt: r.replacedAt?.slice(0, 16) ?? '' }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => setConfirmDelete({ id: r.id, type: 'replacement', name: r.oldFilterName })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
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
                  {['S.No', 'Filter', 'Size', 'Air Pressure', 'RO Water', 'Wash In', 'Wash Out', 'Wash By', 'Dryer Temp', 'Dry In', 'Dry Out', 'Dry By', 'Duration', 'Status', 'Actions'].map((h, i) => (
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
                    <tr key={c.id} className="hover:bg-slate-50/50 group">
                      <td className="px-3 py-2.5 text-[12px] text-slate-400 tabular-nums">{idx + 1}</td>
                      <td className="px-3 py-2.5 text-[12px] font-semibold text-slate-800">{c.filterName ?? '-'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-slate-600">{attrs.filterSize ?? '-'}</td>
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
                          <button onClick={() => openRowEdit(c, 'cycle', c.cycleCode ?? c.filterName ?? 'Cycle')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            Edit
                          </button>
                          <button onClick={() => setConfirmDelete({ id: c.id, type: 'generic' as any, name: c.cycleCode ?? c.filterName ?? 'Cycle' })}
                            className="inline-flex items-center gap-1 px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
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
                    <span className="text-sm font-semibold text-slate-800">{e.eventType?.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{formatDateTime(e.performedAt)}</span>
                      <button onClick={() => openRowEdit(e, 'event', e.eventType ?? 'Event')}
                        className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100">
                        Edit
                      </button>
                      <button onClick={() => setConfirmDelete({ id: e.id, type: 'generic' as any, name: e.eventType ?? 'Event' })}
                        className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100">
                        Delete
                      </button>
                    </div>
                  </div>
                  {(e.fromState || e.toState) && (
                    <div className="text-sm text-slate-600">
                      {e.fromState?.replace(/_/g, ' ') ?? ''} {e.fromState && e.toState && '→'} <span className="text-cyan-600">{e.toState?.replace(/_/g, ' ') ?? ''}</span>
                    </div>
                  )}
                  {e.remarks && <div className="text-sm text-slate-400 mt-1 italic">{e.remarks}</div>}
                  {e.checksum && <div className="text-xs text-slate-300 mt-1 font-mono">Checksum: {String(e.checksum).slice(0, 16)}...</div>}
                </div>
              ))}
            </div>
          )
        )}

        {/* ─── Alarms — mirrors /alarms page exactly ─── */}
        {tab === 'alarms' && !alarmsEnriched.isLoading && (
          filteredEnrichedAlarms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No alarms'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Severity', 'Alarm Type', 'Filter', 'High Limit', 'Low Limit', 'Generated Value', 'Cleared Value', 'Status', 'Generated At', 'Cleared At', 'Actions'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredEnrichedAlarms.map((a: any) => {
                  const sev = ALARM_SEVERITY_COLORS[a.severity] ?? 'bg-slate-100 text-slate-600 border-slate-200';
                  const dot = ALARM_SEVERITY_DOT[a.severity] ?? 'bg-slate-400';
                  const stCol = ALARM_STATUS_COLORS[a.status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
                  const stLabel = ALARM_STATUS_LABELS[a.status] ?? a.status;
                  const high = getAlarmHighLimit(a);
                  const low = getAlarmLowLimit(a);
                  const gen = getAlarmGeneratedValue(a);
                  const clr = getAlarmClearedValue(a);
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/50 group">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${sev}`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dot}`} />
                          {a.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[12px] font-medium text-slate-700">{a.alarmType}</div>
                        {a.message && <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]">{a.message}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">{a.entityName ?? a.entityId}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {high ? <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md">{high}</span> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {low ? <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">{low}</span> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {gen ? <span className="text-[10px] font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md">{gen}</span> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {clr ? <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">{clr}</span> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${stCol}`}>{stLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">{a.createdAt ? formatDateTime(a.createdAt) : '-'}</td>
                      <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">{a.clearedAt ? formatDateTime(a.clearedAt) : '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openRowEdit(a, 'alarm', a.alarmType ?? 'Alarm')}
                            className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            Edit
                          </button>
                          <button onClick={() => setConfirmDelete({ id: a.id, type: 'generic' as any, name: a.alarmType ?? 'Alarm' })}
                            className="inline-flex items-center gap-1 px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

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
                      <span className="text-lg font-semibold text-slate-800">
                        {PM_MONTHS[(entry.month ?? 1) - 1] ?? `Month ${entry.month}`}
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
                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openRowEdit(entry, 'pm-entry', `${PM_MONTHS[(entry.month ?? 1) - 1]} ${entry.plannedDate ? new Date(entry.plannedDate).getFullYear() : ''}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        Edit
                      </button>
                      <button onClick={() => setConfirmDelete({ id: entry.id, type: 'generic' as any, name: `${PM_MONTHS[(entry.month ?? 1) - 1]} entry` })}
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
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => setConfirmDelete({ id: a.id, type: 'generic' as any, name: a.action ?? 'Audit record' })}
                            className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100">
                            Delete
                          </button>
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
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button onClick={() => openRowEdit(n, 'notification', n.title ?? 'Notification')}
                          className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100">Edit</button>
                        <button onClick={() => setConfirmDelete({ id: n.id, type: 'generic' as any, name: n.title ?? 'Notification' })}
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
                {filteredEnrichedAdminReqs.map((req: any) => {
                  const typeLabel = ADMIN_REQ_TYPE_LABELS[req.requestType] ?? req.requestType;
                  const sCol = ADMIN_REQ_STATUS_COLORS[req.status] ?? 'bg-slate-50 text-slate-600 border-slate-200';
                  return (
                    <tr key={req.id} className="hover:bg-slate-50/50 group">
                      <td className="px-5 py-3.5">
                        <div className="text-[13px] font-semibold text-slate-800">{req.requesterName}</div>
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
                            className="px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100">Edit</button>
                          <button onClick={() => setConfirmDelete({ id: req.id, type: 'generic' as any, name: `${typeLabel} - ${req.requesterName}` })}
                            className="px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100">Delete</button>
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
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                          <button onClick={() => openRowEdit(r, 'block-change', r.filterName ?? 'Block change')}
                            className="px-2.5 py-1 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100">Edit</button>
                          <button onClick={() => setConfirmDelete({ id: r.id, type: 'generic' as any, name: `Block change for ${r.filterName ?? 'filter'}` })}
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
        {activeGenericTab && tab !== 'retirements' && tab !== 'replacements' && tab !== 'cleaning-cycles' && tab !== 'filter-events' && tab !== 'alarms' && tab !== 'pm-entries' && tab !== 'audit-trail' && tab !== 'notifications' && tab !== 'admin-requests' && tab !== 'block-changes' && (
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
                        const isBadge = ['status', 'approvalStatus', 'severity', 'eventType', 'action', 'requestType', 'alarmType'].includes(col);

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
                                <input type="datetime-local" value={editFields[col] ?? (rawVal ? rawVal.slice(0, 16) : '')}
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
                                    else body[k] = v;
                                  }
                                  await apiClient.put(activeGenericTab.endpoint + '/' + rowId, body);
                                  toast.success('Updated', 'Record updated silently');
                                  setEditingId(null); setEditFields({});
                                  globalMutate(activeGenericTab.endpoint + '?limit=50');
                                } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
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
                                  if (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) fields[col] = v.slice(0, 16);
                                  else if (typeof v === 'boolean') fields[col] = String(v);
                                  else fields[col] = String(v ?? '');
                                });
                                setEditFields(fields);
                              }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => setConfirmDelete({ id: rowId, type: 'generic' as any, name: row.cycleCode || row.filterName || row.action || row.message || row.title || row.requestType || 'Record' })}
                                className="inline-flex items-center gap-1 px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
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
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
                <p className="text-[13px] text-red-800">
                  <strong>{confirmDelete.name}</strong> {confirmDelete.type} record will be permanently removed with no trace in the system.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={() => {
                  if (confirmDelete.type === 'retirement') handleDeleteRetirement(confirmDelete.id);
                  else if (confirmDelete.type === 'replacement') handleDeleteReplacement(confirmDelete.id);
                  else handleDeleteGeneric(confirmDelete.id);
                }}
                  disabled={processing}
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
                      'cycle': 'Cleaning Cycle', 'event': 'Filter Event', 'alarm': 'Alarm',
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
                  <Field label="From State" value={rowEditFields.fromState} onChange={v => setRowEditFields(p => ({ ...p, fromState: v }))} />
                  <Field label="To State" value={rowEditFields.toState} onChange={v => setRowEditFields(p => ({ ...p, toState: v }))} />
                  <Field label="Performed At" value={rowEditFields.performedAt} onChange={v => setRowEditFields(p => ({ ...p, performedAt: v }))} type="datetime-local" />
                  <Field label="Remarks" value={rowEditFields.remarks} onChange={v => setRowEditFields(p => ({ ...p, remarks: v }))} textarea />
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Note: SHA-256 checksum is not editable. Changing it would break the audit hash chain.
                  </p>
                </>
              ) : rowEditDialog.entity === 'alarm' ? (
                <>
                  <Field label="Severity" value={rowEditFields.severity} onChange={v => setRowEditFields(p => ({ ...p, severity: v }))}
                    select options={['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO']} />
                  <Field label="Status" value={rowEditFields.status} onChange={v => setRowEditFields(p => ({ ...p, status: v }))}
                    select options={['ACTIVE', 'ACKNOWLEDGED', 'CLEARED', 'MANUALLY_CLEARED']} />
                  <Field label="Alarm Type" value={rowEditFields.alarmType} onChange={v => setRowEditFields(p => ({ ...p, alarmType: v }))} />
                  <Field label="Message" value={rowEditFields.message} onChange={v => setRowEditFields(p => ({ ...p, message: v }))} textarea />
                  <Field label="Acknowledged At" value={rowEditFields.acknowledgedAt} onChange={v => setRowEditFields(p => ({ ...p, acknowledgedAt: v }))} type="datetime-local" />
                  <Field label="Cleared At" value={rowEditFields.clearedAt} onChange={v => setRowEditFields(p => ({ ...p, clearedAt: v }))} type="datetime-local" />
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Note: trigger details, threshold values, and entity references are not editable here — they're set by the rule engine when the alarm fires.
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
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={() => { setRowEditDialog(null); setRowEditFields({}); }}
                className="flex-1 py-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">
                Cancel
              </button>
              <button onClick={submitRowEdit} disabled={rowEditSaving}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:from-cyan-500 hover:to-blue-500">
                {rowEditSaving ? 'Saving...' : 'Save Changes'}
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
                  <strong>{unretireDialog.name}</strong> will be restored to Active status. The retirement audit record will be removed.
                </p>
                {unretireDialog.preRetireParentName && (
                  <p className="text-[12px] text-emerald-700 mt-1.5">
                    Original parent: <strong>{unretireDialog.preRetireParentName}</strong> — will be auto-restored
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setUnretireDialog(null); setUnretireParentId(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={() => handleUnretire(unretireDialog.id)} disabled={processing}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500 transition-all">
                  {processing ? 'Restoring...' : 'Restore Filter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
