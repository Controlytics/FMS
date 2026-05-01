import React, { useRef, useState, useMemo } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useReauth } from '../../hooks/use-reauth';
import { ReauthDialog } from '../../components/reauth-dialog';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';

interface UploadResult {
  imported: number;
  skipped: number;
  details: {
    imported: Array<{ row: number; ahuName: string; plannedDate: string; scheduleId: string; entryId: string }>;
    skipped: Array<{ row: number; reason: string; data?: any }>;
  };
}

interface ScheduleEntry {
  id: string; scheduleId: string; ahuId: string; ahuName: string;
  month: number; plannedDate: string; toleranceDays: number;
  windowStart: string; windowEnd: string;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvalRemarks: string | null;
  approvedByName: string | null; approvedAt: string | null;
  submittedByName: string | null;
  pendingPlannedDate: string | null; pendingToleranceDays: number | null;
}

interface PastDateEntry { ahuName: string; scheduledDate: string }

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  PENDING:  { label: 'Pending',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-400 animate-pulse' },
  APPROVED: { label: 'Approved', bg: 'bg-emerald-50',  text: 'text-emerald-700',  border: 'border-emerald-200',  dot: 'bg-emerald-400' },
  REJECTED: { label: 'Rejected', bg: 'bg-red-50',      text: 'text-red-700',      border: 'border-red-200',      dot: 'bg-red-400' },
};

function parseCsvText(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

function findPastDates(rows: Array<Record<string, string>>): PastDateEntry[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const past: PastDateEntry[] = [];
  for (const row of rows) {
    const ahuName = (row.ahu_name ?? row.ahuName ?? row.AHU ?? row['AHU Name'] ?? '').trim();
    const rawDate = (row.scheduled_date ?? row.scheduledDate ?? row.date ?? row['Scheduled Date'] ?? '').trim();
    if (!ahuName || !rawDate) continue;
    const isoMatch = rawDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    const dmyMatch = !isoMatch ? rawDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/) : null;
    let d: Date | null = null;
    if (isoMatch) d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    else if (dmyMatch) d = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
    if (d && d < today) past.push({ ahuName, scheduledDate: rawDate });
  }
  return past;
}

export function PmScheduleListPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDate } = useDatetimeFormat();
  const reauth = useReauth();
  const { data: pmConfig } = useSWR('/api/config/dynamic/pm-schedule-settings');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastDateWarning, setPastDateWarning] = useState<PastDateEntry[] | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Permission flags
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canDownload = isSuperAdmin || perms.includes('PM_DOWNLOAD_TEMPLATE');
  const canUpload = isSuperAdmin || perms.includes('PM_UPLOAD');
  const canEditEntry = isSuperAdmin || perms.includes('PM_EDIT_ENTRY');
  const canResubmit = isSuperAdmin || perms.includes('PM_RESUBMIT');
  const isApprover = isSuperAdmin || perms.includes('PM_APPROVE');

  // Table state
  const [statusFilter, setStatusFilter] = useState('ALL');
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
  const [dateTo, setDateTo] = useState(() => {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectDialog, setRejectDialog] = useState<string[] | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [processing, setProcessing] = useState(false);

  // Pagination
  const paginationOptions = usePaginationConfig();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(paginationOptions[0] ?? 10);

  // Expandable AHU rows — show/hide filters
  const [expandedAhus, setExpandedAhus] = useState<Set<string>>(new Set());
  const toggleAhuExpand = (ahuId: string) => {
    setExpandedAhus(prev => { const n = new Set(prev); if (n.has(ahuId)) n.delete(ahuId); else n.add(ahuId); return n; });
  };

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTolerance, setEditTolerance] = useState('');

  // Data fetching — filter by date range
  const year = new Date(dateFrom).getFullYear();
  const entriesKey = `/api/pm-schedules/entries?year=${year}${statusFilter !== 'ALL' ? `&approvalStatus=${statusFilter}` : ''}`;
  const { data: entriesData, isLoading } = useSWR(entriesKey, { refreshInterval: 15000 });
  // Client-side filter entries to the selected date range
  const allEntries: ScheduleEntry[] = entriesData?.data ?? [];
  const entries = allEntries.filter(e => {
    const d = e.plannedDate?.slice(0, 10);
    if (!d) return true;
    return d >= dateFrom && d <= dateTo;
  });
  const { data: countsData } = useSWR('/api/pm-schedules/entries/pending-counts');
  const pendingCount = countsData?.pending ?? 0;
  const rejectedCount = countsData?.rejected ?? 0;

  const refreshAll = () => {
    globalMutate(entriesKey);
    globalMutate('/api/pm-schedules/entries/pending-counts');
  };

  // PM disabled check moved below all hooks (was here before; the early return
  // skipped the useSWR + useMemo hooks defined further down → React error #300).

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch(`${(window as any).__API_BASE__ ?? ''}/api/pm-schedules/template.csv`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token_backup') ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'pm-schedule-template.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e: any) { setUploadError(`Failed to download template: ${e.message ?? 'unknown error'}`); }
  };

  const uploadFile = async (file: File) => {
    setUploading(true); setUploadError(''); setResult(null);
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch('/api/pm-schedules/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token_backup') ?? ''}` },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setUploadError(body?.message ?? `Upload failed (HTTP ${res.status})`);
      else { setResult(body as UploadResult); refreshAll(); }
    } catch (e: any) { setUploadError(e.message ?? 'Upload failed'); }
    setUploading(false);
  };

  const handleFile = async (file: File) => {
    setUploadError(''); setResult(null);
    if (file.name.endsWith('.csv')) {
      try {
        const text = await file.text();
        const rows = parseCsvText(text);
        const past = findPastDates(rows);
        if (past.length > 0) { setPastDateWarning(past); setPendingFile(file); return; }
      } catch { /* let server handle */ }
    }
    uploadFile(file);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); };

  // ─── Approval actions ───

  const handleApprove = (ids: string[]) => {
    setProcessing(true);
    reauth.execute('APPROVE_PM_SCHEDULE', async (password?: string) => {
      if (password) await apiClient.postWithReauth('/api/pm-schedules/entries/approve', { entryIds: ids }, password);
      else await apiClient.post('/api/pm-schedules/entries/approve', { entryIds: ids });
    }, {
      onSuccess: () => { toast.success('Approved', `${ids.length} entry(s) approved`); setSelected(new Set()); refreshAll(); setProcessing(false); },
      onError: (e: any) => { toast.error('Error', e?.message ?? 'Failed'); setProcessing(false); },
    });
  };

  const handleReject = (ids: string[]) => { setRejectDialog(ids); setRejectRemarks(''); };

  const submitReject = () => {
    if (!rejectDialog || !rejectRemarks.trim()) return;
    const ids = rejectDialog;
    setProcessing(true);
    reauth.execute('REJECT_PM_SCHEDULE', async (password?: string) => {
      if (password) await apiClient.postWithReauth('/api/pm-schedules/entries/reject', { entryIds: ids, remarks: rejectRemarks.trim() }, password);
      else await apiClient.post('/api/pm-schedules/entries/reject', { entryIds: ids, remarks: rejectRemarks.trim() });
    }, {
      onSuccess: () => { toast.success('Rejected', `${ids.length} entry(s) rejected`); setRejectDialog(null); setSelected(new Set()); refreshAll(); setProcessing(false); },
      onError: (e: any) => { toast.error('Error', e?.message ?? 'Failed'); setProcessing(false); },
    });
  };

  const handleResubmit = async (id: string) => {
    if (!editDate) return;
    setProcessing(true);
    try {
      await apiClient.post(`/api/pm-schedules/entries/${id}/resubmit`, {
        plannedDate: editDate,
        ...(editTolerance ? { toleranceDays: Number(editTolerance) } : {}),
      });
      toast.success('Re-submitted', 'Entry sent for QA approval');
      setEditingId(null); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleEdit = async (id: string) => {
    if (!editDate) return;
    setProcessing(true);
    reauth.execute('EDIT_PM_SCHEDULE', async (password?: string) => {
      const body = { plannedDate: editDate, ...(editTolerance ? { toleranceDays: Number(editTolerance) } : {}) };
      if (password) await apiClient.putWithReauth(`/api/pm-schedules/entries/${id}/edit`, body, password);
      else await apiClient.put(`/api/pm-schedules/entries/${id}/edit`, body);
    }, {
      onSuccess: () => { toast.success('Edit Submitted', 'Change sent for QA approval'); setEditingId(null); refreshAll(); setProcessing(false); },
      onError: (e: any) => { toast.error('Error', e?.message ?? 'Failed'); setProcessing(false); },
    });
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const pendingEntries = entries.filter(e => e.approvalStatus === 'PENDING');
  const allPendingSelected = pendingEntries.length > 0 && pendingEntries.every(e => selected.has(e.id));
  const toggleSelectAll = () => {
    if (allPendingSelected) setSelected(new Set());
    else setSelected(new Set(pendingEntries.map(e => e.id)));
  };

  // Fetch all instances to resolve filter names per AHU
  const { data: instancesData } = useSWR('/api/assets/instances?limit=500');
  const instances = (instancesData?.data ?? []) as any[];

  // Paginate entries first, then group by AHU
  const totalEntries = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / perPage));
  const paginatedEntries = useMemo(() => {
    const start = (page - 1) * perPage;
    return entries.slice(start, start + perPage);
  }, [entries, page, perPage]);

  // PM disabled check — must run AFTER all hooks above to avoid React error #300
  // ("rendered fewer hooks than expected") when the config arrives async and
  // the page short-circuits on the second render.
  if (pmConfig && !(pmConfig as any)?.enabled && !((pmConfig as any)?.value?.enabled)) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
          <h2 className="text-xl font-semibold text-slate-700 mb-2">PM Module Disabled</h2>
          <p className="text-slate-500">Enable Preventive Maintenance scheduling in Configuration settings.</p>
        </div>
      </div>
    );
  }

  // Group paginated entries by AHU for display
  const groupedEntries: Array<{ ahuName: string; ahuId: string; entries: ScheduleEntry[]; filterNames: string[] }> = [];
  const ahuMap = new Map<string, ScheduleEntry[]>();
  for (const e of paginatedEntries) {
    if (!ahuMap.has(e.ahuId)) ahuMap.set(e.ahuId, []);
    ahuMap.get(e.ahuId)!.push(e);
  }
  for (const [ahuId, ahuEntries] of ahuMap) {
    const filterNames = instances
      .filter((inst: any) => inst.parentId === ahuId)
      .map((inst: any) => inst.name);
    groupedEntries.push({ ahuId, ahuName: ahuEntries[0].ahuName, entries: ahuEntries, filterNames });
  }

  // Summary stats
  const approvedCount = entries.filter(e => e.approvalStatus === 'APPROVED').length;
  const pendingInView = entries.filter(e => e.approvalStatus === 'PENDING').length;
  const rejectedInView = entries.filter(e => e.approvalStatus === 'REJECTED').length;
  const colCount = (isApprover ? 1 : 0) + 8;

  return (
    <div className="p-6 space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl shadow-lg" style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">PM Schedules</h1>
            <p className="text-sm text-slate-400 mt-0.5">Preventive maintenance cleaning schedules</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {canDownload && (
            <button onClick={handleDownloadTemplate} className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 hover:border-slate-300 transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
            </button>
          )}
          {canUpload && (
            <button onClick={() => { setUploadOpen(true); setResult(null); setUploadError(''); }} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))', color: '#fff' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9A5.001 5.001 0 0115.9 6a5 5 0 01.1 10H7zM9 15l3-3m0 0l3 3m-3-3v6" /></svg>
              Upload Schedule
            </button>
          )}
        </div>
      </div>

      {/* ─── Summary Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-slate-800 mt-0.5">{totalEntries}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <p className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider">Approved</p>
          <p className="text-2xl font-bold text-emerald-700 mt-0.5">{approvedCount}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-[11px] font-semibold text-amber-500 uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-amber-700 mt-0.5">{pendingInView}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Rejected</p>
          <p className="text-2xl font-bold text-red-600 mt-0.5">{rejectedInView}</p>
        </div>
      </div>

      {/* ─── Filters Bar ─── */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex items-center gap-5 flex-wrap">
        {/* Date range */}
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setSelected(new Set()); setPage(1); }}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 bg-slate-50 focus:bg-white focus:ring-2 transition-all"
            style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as any} />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setSelected(new Set()); setPage(1); }}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 bg-slate-50 focus:bg-white focus:ring-2 transition-all"
            style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as any} />
        </div>
        {/* Separator */}
        <div className="h-6 w-px bg-slate-200" />
        {/* Status tabs */}
        <div className="flex items-center gap-1.5">
          {['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map(s => {
            const count = s === 'ALL' ? totalEntries : s === 'PENDING' ? pendingInView : s === 'APPROVED' ? approvedCount : rejectedInView;
            return (
              <button key={s} onClick={() => { setStatusFilter(s); setSelected(new Set()); setPage(1); }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${statusFilter === s
                  ? 'text-white shadow-sm'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200'}`}
                style={statusFilter === s ? { backgroundColor: 'var(--theme-primary)', color: '#fff' } : undefined}>
                {s === 'ALL' ? 'All' : STATUS_CFG[s]?.label ?? s}
                {count > 0 && <span className={`ml-1.5 text-[10px] ${statusFilter === s ? 'opacity-70' : 'text-slate-400'}`}>({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Bulk Actions (QA only) ─── */}
      {isApprover && selected.size > 0 && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl border" style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary-light)' }}>
            <span className="text-sm font-bold" style={{ color: 'var(--theme-primary-dark)' }}>{selected.size}</span>
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-dark)' }}>entries selected</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => handleApprove([...selected])} disabled={processing}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Approve
            </button>
            <button onClick={() => handleReject([...selected])} disabled={processing}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 shadow-sm transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Reject
            </button>
            <button onClick={() => setSelected(new Set())} className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 rounded-lg hover:bg-white/50 transition-all">Clear</button>
          </div>
        </div>
      )}

      {/* ─── Table ─── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
            <p className="text-sm text-slate-400">Loading schedules...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-20 text-center">
            <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-slate-500 font-medium">No schedule entries found</p>
            <p className="text-xs text-slate-400 mt-1">Upload a CSV to create schedule entries for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  {isApprover && (
                    <th className="w-10 px-3 py-3.5">
                      <input type="checkbox" checked={allPendingSelected} onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded border-slate-300 cursor-pointer" style={{ accentColor: 'var(--theme-primary)' }} />
                    </th>
                  )}
                  <th className="w-14 text-center px-2 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">S.No</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">AHU</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Scheduled Date</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Tolerance</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Window</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Approved By</th>
                  <th className="text-right px-5 py-3.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupedEntries.map(group => {
                  const isExpanded = expandedAhus.has(group.ahuId);
                  return (
                  <React.Fragment key={group.ahuId}>
                    {group.entries.map((entry, entryIdx) => {
                      const sc = STATUS_CFG[entry.approvalStatus] ?? STATUS_CFG.PENDING;
                      const isEditing = editingId === entry.id;
                      const hasPendingEdit = !!entry.pendingPlannedDate;
                      const globalIdx = paginatedEntries.indexOf(entry);
                      const serialNo = (page - 1) * perPage + globalIdx + 1;

                      return (
                        <tr key={entry.id} className={`transition-colors hover:bg-slate-50/50 ${entry.approvalStatus === 'PENDING' ? 'bg-amber-50/15' : entry.approvalStatus === 'REJECTED' ? 'bg-red-50/15' : ''}`}>
                          {isApprover && (
                            <td className="w-10 px-3 py-3">
                              {entry.approvalStatus === 'PENDING' && (
                                <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)}
                                  className="w-3.5 h-3.5 rounded border-slate-300 cursor-pointer" style={{ accentColor: 'var(--theme-primary)' }} />
                              )}
                            </td>
                          )}
                          <td className="w-14 text-center px-2 py-3 text-sm text-slate-400 font-medium">{serialNo}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800">{group.ahuName}</span>
                              {group.filterNames.length > 0 && (
                                <button onClick={e => { e.stopPropagation(); toggleAhuExpand(group.ahuId); }}
                                  className="text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium" style={{ color: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
                                  {group.filterNames.length} filters {isExpanded ? '▾' : '▸'}
                                </button>
                              )}
                            </div>
                            {/* Inline filter list when expanded — only show on first entry of the group */}
                            {isExpanded && entryIdx === 0 && group.filterNames.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {group.filterNames.map((fn, fi) => (
                                  <span key={fi} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border" style={{ color: 'var(--theme-primary-dark)', backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
                                    <span className="w-4.5 h-4.5 text-[10px] font-bold text-white rounded-full flex items-center justify-center leading-none" style={{ width: 18, height: 18, backgroundColor: 'var(--theme-primary)' }}>{fi + 1}</span>
                                    {fn}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {isEditing ? (
                              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 w-40 transition-all"
                                style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as any} />
                            ) : (
                              <div>
                                <span className="text-sm font-medium text-slate-700 tabular-nums">{formatDate(entry.plannedDate)}</span>
                                {hasPendingEdit && (
                                  <div className="text-[10px] text-amber-600 font-medium mt-0.5 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    Pending: {formatDate(entry.pendingPlannedDate!)}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {isEditing ? (
                              <input type="number" value={editTolerance} onChange={e => setEditTolerance(e.target.value)}
                                placeholder={String(entry.toleranceDays)} min={0} max={365}
                                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 w-20 transition-all"
                                style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as any} />
                            ) : (
                              <span className="text-sm text-slate-500 font-medium">{entry.toleranceDays} days</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-400 tabular-nums whitespace-nowrap">
                            {formatDate(entry.windowStart)} — {formatDate(entry.windowEnd)}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-bold ${sc.bg} ${sc.text} ${sc.border}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {entry.approvedByName ? (
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                                  <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                </div>
                                <span className="text-xs font-medium text-emerald-700">{entry.approvedByName}</span>
                              </div>
                            ) : entry.submittedByName ? (
                              <span className="text-xs text-slate-400">by {entry.submittedByName}</span>
                            ) : (
                              <span className="text-xs text-slate-300">--</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {isEditing ? (
                                <>
                                  <button onClick={() => entry.approvalStatus === 'REJECTED' ? handleResubmit(entry.id) : handleEdit(entry.id)}
                                    disabled={processing || !editDate}
                                    className="px-3.5 py-1.5 text-white text-[11px] font-semibold rounded-lg disabled:opacity-50 transition-colors shadow-sm"
                                    style={{ backgroundColor: 'var(--theme-primary)' }}>
                                    Save
                                  </button>
                                  <button onClick={() => setEditingId(null)} className="px-3.5 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  {isApprover && entry.approvalStatus === 'PENDING' && (
                                    <>
                                      <button onClick={() => handleApprove([entry.id])} disabled={processing}
                                        className="px-3 py-1.5 bg-emerald-500 text-white text-[11px] font-semibold rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors shadow-sm">
                                        Approve
                                      </button>
                                      <button onClick={() => handleReject([entry.id])} disabled={processing}
                                        className="px-3 py-1.5 bg-red-500 text-white text-[11px] font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors shadow-sm">
                                        Reject
                                      </button>
                                    </>
                                  )}
                                  {canEditEntry && entry.approvalStatus === 'APPROVED' && !hasPendingEdit && (
                                    <button onClick={() => { setEditingId(entry.id); setEditDate(entry.plannedDate.slice(0, 10)); setEditTolerance(String(entry.toleranceDays)); }}
                                      className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all">
                                      Edit
                                    </button>
                                  )}
                                  {canResubmit && entry.approvalStatus === 'REJECTED' && (
                                    <button onClick={() => { setEditingId(entry.id); setEditDate(entry.plannedDate.slice(0, 10)); setEditTolerance(String(entry.toleranceDays)); }}
                                      className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-semibold rounded-lg hover:bg-amber-100 transition-all">
                                      Resubmit
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* ─── Pagination Footer ─── */}
        {totalEntries > 0 && (
          <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="text-xs font-medium">Per page:</span>
              <div className="flex items-center gap-1">
                {paginationOptions.map(opt => (
                  <button key={opt} onClick={() => { setPerPage(opt); setPage(1); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      perPage === opt ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    style={perPage === opt ? { backgroundColor: 'var(--theme-primary)', color: '#fff' } : undefined}>
                    {opt}
                  </button>
                ))}
              </div>
              <span className="text-slate-200">|</span>
              <span className="text-xs">
                Page <span className="font-semibold text-slate-800">{page}</span> of{' '}
                <span className="font-semibold text-slate-800">{totalPages}</span>
                <span className="text-slate-400 ml-1.5">({totalEntries} entries)</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage(1)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
              </button>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                Prev
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pn: number;
                if (totalPages <= 5) pn = i + 1;
                else if (page <= 3) pn = i + 1;
                else if (page >= totalPages - 2) pn = totalPages - 4 + i;
                else pn = page - 2 + i;
                return (
                  <button key={pn} onClick={() => setPage(pn)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                      pn === page ? 'text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                    style={pn === page ? { backgroundColor: 'var(--theme-primary)', color: '#fff' } : undefined}>
                    {pn}
                  </button>
                );
              })}
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                Next
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(totalPages)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Reject Dialog ─── */}
      {rejectDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-500" />
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-1">Reject {rejectDialog.length} Entry(s)</h3>
              <p className="text-xs text-slate-400 mb-4">Provide a reason for rejection. The uploader will see this.</p>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Remarks <span className="text-red-500">*</span></label>
              <textarea value={rejectRemarks} onChange={e => setRejectRemarks(e.target.value)}
                placeholder="Why are these entries being rejected? (required)"
                rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none" />
              <div className="flex gap-3 mt-4">
                <button onClick={() => setRejectDialog(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={submitReject} disabled={processing || !rejectRemarks.trim()}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {processing ? 'Rejecting...' : 'Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Upload Dialog ─── */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="h-1.5" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Upload PM Schedule</h3>
                  <p className="text-xs text-slate-400 mt-0.5">CSV or XLSX • max 5 MB • entries go to Pending for QA approval</p>
                </div>
                <button onClick={() => { setUploadOpen(false); setResult(null); setUploadError(''); }}
                  className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center" aria-label="Close">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {!result && (
                <div onDragOver={e => { e.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragActive ? 'border-slate-300 bg-slate-50' : 'border-slate-300 bg-slate-50'}`}
                  style={dragActive ? { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' } : undefined}>
                  {uploading ? (
                    <><div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} /><p className="text-sm font-semibold text-slate-700">Uploading...</p></>
                  ) : (
                    <><p className="text-sm font-semibold text-slate-700">{dragActive ? 'Drop the file here' : 'Drag and drop or click to choose'}</p><p className="text-xs text-slate-400 mt-1">Accepts .csv, .xls, .xlsx</p></>
                  )}
                  <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </div>
              )}
              {uploadError && <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">{uploadError}</div>}
              {result && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <div className="text-2xl font-bold text-emerald-700">{result.imported}</div>
                      <div className="text-xs text-emerald-600 font-semibold mt-0.5">Uploaded (Pending QA)</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="text-2xl font-bold text-amber-700">{result.skipped}</div>
                      <div className="text-xs text-amber-600 font-semibold mt-0.5">Skipped</div>
                    </div>
                  </div>
                  {result.details.skipped.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Skipped</div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {result.details.skipped.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm px-3 py-1.5 bg-amber-50/50 rounded-lg">
                            <span className="text-amber-500 shrink-0">!</span>
                            <span className="text-slate-600">Row {r.row}: {r.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => { setResult(null); setUploadError(''); }} className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50">Upload Another</button>
                    <button onClick={() => { setUploadOpen(false); setResult(null); setUploadError(''); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold shadow-lg" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))', color: '#fff' }}>Done</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Past-Date Warning ─── */}
      {pastDateWarning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-1">Past Dates Detected</h3>
              <p className="text-xs text-slate-400 mb-4">These AHUs have dates before today and will appear as overdue.</p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto mb-4">
                {pastDateWarning.map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl text-sm">
                    <span className="font-semibold text-slate-700">{e.ahuName}</span>
                    <span className="text-amber-700 font-medium tabular-nums">{e.scheduledDate}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setPastDateWarning(null); setPendingFile(null); }} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={() => { const f = pendingFile; setPastDateWarning(null); setPendingFile(null); if (f) uploadFile(f); }}
                  className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-amber-500/25">Proceed Anyway</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} actionLabel="PM Schedule Action" />
    </div>
  );
}
