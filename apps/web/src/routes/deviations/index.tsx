import { useState } from 'react';
import useSWR from 'swr';
import { useCan } from '@/hooks/use-can';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { Pagination } from '@/components/ui/pagination';
import { apiClient } from '@/lib/api-client';
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { requireExportReauth, isReauthCancelled } from '@/lib/report-export-log';
import { useExportLimit } from '@/hooks/use-export-limit';
import { ExportMenu } from '@/components/ExportMenu';
import { SendForReviewButton } from '@/components/SendForReviewButton';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { downloadName } from '@/lib/download-name';
import { ALL_ROWS } from '@/lib/page-size';
import { SuperAdminRecordEditDialog, SuperAdminEditButton, useIsSuperAdmin, userOptions, type EditFieldSpec } from '@/components/super-admin-record-edit';

interface DeviationRow {
  id: string;
  deviationNumber: string;
  acknowledgedBy?: string | null;
  completedBy?: string | null;
  closureKind?: string | null;
  closureReason?: string | null;
  ahuName: string;
  filterCount: number;
  scheduledDate: string;
  windowStart: string | null;
  windowEnd: string;
  overdueDaysAtOpen: number;
  liveOverdueDays: number;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  passwordVerified: boolean;
  completedByName: string | null;
  completedAt: string | null;
  delayDays: number | null;
  closedAt: string | null;
  createdAt: string;
}

interface DeviationResponse {
  data: DeviationRow[];
  total: number;
  openCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_META: Record<DeviationRow['status'], { label: string; cls: string; dot: string }> = {
  OPEN:         { label: 'Open',         cls: 'bg-rose-50 text-rose-700 border-rose-200',       dot: 'bg-rose-500' },
  ACKNOWLEDGED: { label: 'Acknowledged', cls: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-500' },
  CLOSED:       { label: 'Closed',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
};

const TABS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { key: 'CLOSED', label: 'Closed' },
];

// Overdue / delay severity bands (2026-06-10): ≤7 days yellow, 8–30 orange, >30 red.
// Rendered as filled badge pills (not thin text) with a wide hue gap so the three
// bands are easy to tell apart. Same scale colours the columns and the legend.
function severityCls(days: number | null | undefined): string {
  const n = days ?? 0;
  if (n > 30) return 'bg-red-100 text-red-700 border-red-300';
  if (n > 7) return 'bg-orange-100 text-orange-700 border-orange-300';
  return 'bg-yellow-100 text-yellow-800 border-yellow-400';
}
const severityPill = `inline-block px-2 py-0.5 rounded-md text-[12px] font-semibold border`;
const SEVERITY_BANDS: { dot: string; label: string }[] = [
  { dot: 'bg-yellow-400', label: '≤ 7 days' },
  { dot: 'bg-orange-500', label: '8–30 days' },
  { dot: 'bg-red-600',    label: '> 30 days' },
];

// Full "N day(s)" label instead of the terse "Nd".
function daysLabel(n: number | null | undefined): string {
  const v = n ?? 0;
  return `${v} day${v === 1 ? '' : 's'}`;
}

export function DeviationsPage() {
  const can = useCan();
  const { toast } = useToast();
  // Report exports are re-auth gated per report (Config → Action Re-auth → Reports), 2026-09-24.
  const reauth = useReauth();
  const exportLimit = useExportLimit();
  const { formatDate, formatDateTime, formatDayMonth } = useDatetimeFormat();
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Report download (period-scoped PDF).
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');

  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (status !== 'ALL') params.set('status', status);
  const { data, isLoading, mutate: refetch } = useSWR<DeviationResponse>(`/api/pm-schedules/deviations?${params}`, { refreshInterval: 30000 });

  // SUPER_ADMIN edit of any column (2026-09-05). Acknowledged / Completed by
  // are user pickers; the server stores the id and resolves the name.
  const isSuperAdmin = useIsSuperAdmin();
  const [editRow, setEditRow] = useState<DeviationRow | null>(null);
  const { data: usersData } = useSWR<any>(isSuperAdmin ? `/api/users?page=1&limit=${ALL_ROWS}` : null);
  const deviationFields: EditFieldSpec[] = [
    { key: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'OPEN', label: 'Open' }, { value: 'ACKNOWLEDGED', label: 'Acknowledged' }, { value: 'CLOSED', label: 'Closed' }] },
    { key: 'ahuName', label: 'AHU', type: 'text', required: true },
    { key: 'scheduledDate', label: 'Scheduled date', type: 'datetime', required: true },
    { key: 'windowStart', label: 'Window start', type: 'datetime' },
    { key: 'windowEnd', label: 'Window end', type: 'datetime', required: true },
    { key: 'overdueDaysAtOpen', label: 'Overdue days at open', type: 'number', required: true },
    { key: 'acknowledgedBy', label: 'Acknowledged by', type: 'select', options: userOptions((usersData as any)?.data ?? [], 'id'), emptyOption: '-- nobody --' },
    { key: 'acknowledgedAt', label: 'Acknowledged at', type: 'datetime' },
    { key: 'completedBy', label: 'Completed by', type: 'select', options: userOptions((usersData as any)?.data ?? [], 'id'), emptyOption: '-- nobody --' },
    { key: 'completedAt', label: 'Completed at', type: 'datetime' },
    { key: 'delayDays', label: 'Delay (days)', type: 'number' },
    { key: 'closedAt', label: 'Closed at', type: 'datetime' },
    { key: 'closureKind', label: 'Closure kind', type: 'select', options: [{ value: 'COMPLETED_LATE', label: 'Completed late' }, { value: 'SKIPPED', label: 'Skipped (written off)' }], emptyOption: '-- none --' },
    { key: 'closureReason', label: 'Closure reason', type: 'textarea' },
  ];
  const saveDeviation = async (changed: Record<string, any>, reason: string, password?: string) => {
    if (!editRow) return;
    const body: Record<string, any> = { ...changed, _changeReason: reason };
    const url = `/api/super-admin/data/deviations/${editRow.id}`;
    return password ? apiClient.putWithReauth<any>(url, body, password) : apiClient.put<any>(url, body);
  };

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const HEAD = ['Deviation #', 'AHU', 'Filters', 'Scheduled', 'Overdue', 'Status', 'Acknowledged By', 'Completed By', 'Completed', 'Delay'];

  /**
   * Scheduled date + the tolerance window it may be met in, e.g.
   *   20/06/2026
   *   ±3d (17/06 – 23/06)
   *
   * The window is what actually decides whether a visit is late, so showing
   * the planned date alone understates the picture -- 20/06 ±3d is not overdue
   * on the 22nd. Tolerance is DERIVED from windowEnd - scheduledDate rather
   * than stored: deviations carry no toleranceDays column, and the windows are
   * symmetric by construction (plannedDate ± toleranceDays, see pm-separation).
   *
   * The window dates drop their year -- it is already on the line above, and in
   * portrait the column cannot afford to repeat it. windowStart is nullable on
   * older rows, so it is mirrored from windowEnd when missing.
   */
  const MS_DAY = 86400000;
  // Day + month in the configured order/timezone (was a hardcoded UTC "DD/MM",
  // which disagreed with the Scheduled column above it under MM/DD/YYYY).
  const shortDay = (iso: string) => formatDayMonth(iso);
  const toleranceOf = (d: DeviationRow) =>
    Math.round((new Date(d.windowEnd).getTime() - new Date(d.scheduledDate).getTime()) / MS_DAY);
  // Two short pieces rather than one string: at 7.5pt the PDF's Scheduled column
  // holds ~20mm, and a combined "±5d (15/06 – 25/06)" needs ~27mm, so autoTable
  // broke it wherever it ran out ("±5d (15/06 –" / "25/06)"). Two deliberate
  // lines beat one arbitrary wrap, and the compact "15/06-25/06" form fits.
  const toleranceLabel = (d: DeviationRow) => {
    const tol = toleranceOf(d);
    return Number.isFinite(tol) && tol >= 0 ? `±${tol}d` : '';
  };
  const windowRange = (d: DeviationRow) => {
    const tol = toleranceOf(d);
    if (!Number.isFinite(tol) || tol < 0) return '';
    const startIso = d.windowStart
      ?? new Date(new Date(d.scheduledDate).getTime() - tol * MS_DAY).toISOString();
    return `${shortDay(startIso)}-${shortDay(d.windowEnd)}`;
  };
  /** The on-screen form, which has room for one line. */
  const windowLine = (d: DeviationRow) => {
    const tol = toleranceLabel(d);
    return tol ? `${tol} (${windowRange(d)})` : '';
  };

  // Fetch every page for the current status tab, filter by the selected period,
  // and build the export rows. Shared by the PDF + Excel export. Returns null
  // (and surfaces a message) when there's nothing to export.
  const buildDeviationsExport = async (): Promise<{ body: string[][]; period: string; total: number } | null> => {
    const all: DeviationRow[] = [];
    let p = 1;
    let totalPages = 1;
    do {
      const qp = new URLSearchParams({ page: String(p), limit: '200' });
      if (status !== 'ALL') qp.set('status', status);
      const resp = await apiClient.get<DeviationResponse>(`/api/pm-schedules/deviations?${qp}`);
      all.push(...(resp.data ?? []));
      totalPages = resp.totalPages ?? 1;
      p++;
    } while (p <= totalPages);

    const fromT = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
    const toT = toDate ? new Date(`${toDate}T23:59:59`).getTime() : Infinity;
    const filtered = all.filter(d => {
      const t = new Date(d.scheduledDate).getTime();
      return t >= fromT && t <= toT;
    });
    if (filtered.length === 0) { setDownloadMsg('No deviations in the selected period.'); return null; }
    if (filtered.length > exportLimit.maxRecords) { setDownloadMsg(exportLimit.tooLargeMessage(filtered.length)); return null; }

    const period = fromDate || toDate
      ? `${fromDate ? formatDate(fromDate) : 'Start'} to ${toDate ? formatDate(toDate) : 'Now'}`
      : 'All Time';
    const body = filtered.map(d => [
      d.deviationNumber, d.ahuName, String(d.filterCount),
      // Three deliberate lines. One combined string needs ~27mm and the column
      // holds ~20mm, so autoTable would break it wherever it ran out.
      `${formatDate(d.scheduledDate)}\n${toleranceLabel(d)}\n${windowRange(d)}`,
      d.status === 'CLOSED' ? `${daysLabel(d.delayDays ?? d.overdueDaysAtOpen)} delay` : daysLabel(d.liveOverdueDays),
      STATUS_META[d.status].label, d.acknowledgedByName ?? '-', d.completedByName ?? '-',
      d.completedAt ? formatDateTime(d.completedAt) : '-', d.delayDays != null ? daysLabel(d.delayDays) : '-',
    ]);
    return { body, period, total: filtered.length };
  };

  const buildDeviationsReport = async () => {
    const r = await buildDeviationsExport();
    if (!r) return null;
    const report = await createReport({ reportKey: 'deviations',
      title: 'Deviations Report',
      subtitle: `Status: ${status === 'ALL' ? 'All' : STATUS_META[status as DeviationRow['status']]?.label ?? status}  |  Period: ${r.period}  |  Total: ${r.total} deviation(s)`,
      // 2026-09-02 (operator request, reaffirmed): A4 PORTRAIT, matching the RFID
      // and Quality Notifications reports. Page size was always A4 — pdf-report.ts
      // hard-codes format:'a4' for every report — so only the orientation changes.
      orientation: 'portrait',
      formatDateTime,
    });
    // TEN columns in portrait's 181mm, against RFID's eight and QN's seven.
    // Ten columns spend 50mm of that on horizontal padding, leaving ~131mm of
    // text, while the headers alone want ~195mm at 9pt. Something must wrap, and
    // these widths choose WHERE: the multi-word headers ("Acknowledged By" →
    // "Acknowledged" / "By") break at their word boundary, which reads fine,
    // while the date and identifier columns keep their values on one line.
    // Landscape would avoid the wrapping entirely — kept portrait per operator
    // request. Widths sum to 181.
    report.addTable({
      head: HEAD,
      body: r.body,
      headColor: [225, 29, 72],
      // 7.5pt, NOT the 9pt the other two reports use — this table has ten
      // columns and portrait offers 181mm.
      //
      // The widths below are not estimates. Each was measured with jsPDF's own
      // font metrics as the widest UNBREAKABLE token the column can hold (its
      // longest header word at bold fontSize+0.5, or its longest value token),
      // plus the 5mm of horizontal padding. Summed, that is the minimum the
      // table can occupy without splitting a word or a date. Measured totals:
      //
      //     9.0pt -> 204mm   over by 23   (broke dates: "20/06/202" / "6")
      //     8.0pt -> 189mm   over by 8    (broke "AHU-0"/"3", "Complete"/"d By")
      //     7.5pt -> 179mm   FITS
      //
      // So 7.5 is the largest size at which nothing breaks mid-token here. Going
      // back to landscape would allow 9pt like the other reports; portrait was
      // the operator's explicit choice, and this is what it costs.
      fontSize: 7.5,
      columnStyles: {
        0: { cellWidth: 20 },  // Deviation # — "DEV-000142"
        1: { cellWidth: 16 },  // AHU — "AHU-024"
        2: { cellWidth: 14 },  // Filters (a count)
        3: { cellWidth: 20 },  // Scheduled — a whole date, unbroken
        4: { cellWidth: 17 },  // Overdue — "62 days delay" wraps between words
        5: { cellWidth: 14 },  // Status — "Closed"
        6: { cellWidth: 25 },  // Acknowledged By — breaks after "Acknowledged"
        7: { cellWidth: 20 },  // Completed By — breaks after "Completed"
        8: { cellWidth: 20 },  // Completed — a whole date; time wraps below it
        9: { cellWidth: 13 },  // Delay
      },
    });
    return { report, count: r.body.length };
  };

  const exportPdf = async () => {
    setDownloading(true); setDownloadMsg('');
    try {
      const built = await buildDeviationsReport();
      if (!built) return;
      await requireExportReauth(reauth, { reportType: 'Deviations', format: 'PDF', recordCount: built.count }, toast.warning);
      built.report.save(`${downloadName('deviations')}.pdf`);
    } catch (e: any) {
      if (isReauthCancelled(e)) return; // operator dismissed the password dialog — no export
      setDownloadMsg(e?.message ?? 'Failed to generate the report.');
    } finally { setDownloading(false); }
  };

  const buildDeviationsSnapshot = async () => { const built = await buildDeviationsReport(); return built ? built.report.getSnapshot() : null; };

  const exportExcel = async () => {
    setDownloading(true); setDownloadMsg('');
    try {
      const r = await buildDeviationsExport();
      if (!r) return;
      await requireExportReauth(reauth, { reportType: 'Deviations', format: 'Excel', recordCount: r.body.length }, toast.warning);
      exportToExcel({ filename: `deviations-${new Date().toISOString().slice(0, 10)}`, sheetName: 'Deviations', head: HEAD, rows: r.body });
    } catch (e: any) {
      if (isReauthCancelled(e)) return; // operator dismissed the password dialog — no export
      setDownloadMsg(e?.message ?? 'Failed to generate the report.');
    } finally { setDownloading(false); }
  };

  return (
    <div className="h-full flex flex-col">
      <ReauthPrompt reauth={reauth} actionLabel="Export report" />
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Deviations</h1>
            <p className="text-[13px] text-slate-400 mt-0.5">
              {total.toLocaleString()} deviation{total === 1 ? '' : 's'}
              {data?.openCount ? ` · ${data.openCount} open` : ''} — overdue AHU filter cleaning audit trail
            </p>
          </div>
        </div>

        {/* Overdue severity legend */}
        <div className="flex items-center gap-4 mb-3 text-[11px]">
          <span className="font-bold text-slate-500">Overdue / Delay</span>
          {SEVERITY_BANDS.map(b => (
            <span key={b.label} className="flex items-center gap-1.5 text-slate-500">
              <span className={`w-2.5 h-2.5 rounded-full ${b.dot}`} />{b.label}
            </span>
          ))}
        </div>

        {/* Tabs + report download toolbar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {TABS.map(t => (
              <button key={t.key} onClick={() => { setStatus(t.key); setPage(1); }}
                className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all ${status === t.key ? 'bg-rose-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter
              size="sm"
              from={fromDate}
              to={toDate}
              onFromChange={v => { setFromDate(v); setDownloadMsg(''); }}
              onToChange={v => { setToDate(v); setDownloadMsg(''); }}
              fromAriaLabel="Deviations from date"
              toAriaLabel="Deviations to date"
            />
            {/* Phase 5C: Export gated on deviations.export (gate: PM_READ).
                Previously UNGATED (fail-open); now correctly hidden from users without PM_READ. */}
            {can('deviations.export') && (
              <ExportMenu surface="deviations" onExportPdf={exportPdf} onExportExcel={exportExcel} busy={downloading}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-r from-rose-500 to-rose-600 shadow-sm disabled:opacity-50" />
            )}
            <SendForReviewButton buildSnapshot={buildDeviationsSnapshot}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50" />
          </div>
        </div>
        {downloadMsg && <div className="mt-2 text-[12px] text-rose-600">{downloadMsg}</div>}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading deviations...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-slate-400 font-medium text-[14px]">No deviations</span>
            <span className="text-[13px] text-slate-300">Overdue AHU cleaning tasks appear here automatically</span>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Deviation #', 'AHU', 'Filters', 'Scheduled', 'Overdue', 'Status', 'Acknowledged By', 'Completed By', 'Completed', 'Delay', ...(isSuperAdmin ? ['Edit'] : [])].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-xs font-bold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(d => {
                  const sm = STATUS_META[d.status];
                  return (
                    <tr key={d.id} className="hover:bg-rose-50/20 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 whitespace-nowrap">{d.deviationNumber}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-700">{d.ahuName}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 text-center tabular-nums">{d.filterCount}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">
                        <div>{formatDate(d.scheduledDate)}</div>
                        <div className="text-[11px] text-slate-400">{windowLine(d)}</div>
                      </td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap">
                        {d.status === 'CLOSED' ? (
                          <span className={`${severityPill} ${severityCls(d.delayDays ?? d.overdueDaysAtOpen)}`}>
                            {daysLabel(d.delayDays ?? d.overdueDaysAtOpen)} delay
                          </span>
                        ) : (
                          <span className={`${severityPill} ${severityCls(d.liveOverdueDays)}`}>
                            {daysLabel(d.liveOverdueDays)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border ${sm.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />{sm.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">
                        {d.acknowledgedByName ?? '—'}
                        {d.passwordVerified && <span className="ml-1 text-emerald-500" title="Password verified">✓</span>}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">{d.completedByName ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{d.completedAt ? formatDateTime(d.completedAt) : '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-center tabular-nums">
                        {d.delayDays != null
                          ? <span className={`${severityPill} ${severityCls(d.delayDays)}`}>{daysLabel(d.delayDays)}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      {isSuperAdmin && (
                        <td className="px-4 py-3 text-right"><SuperAdminEditButton onClick={() => setEditRow(d)} /></td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {rows.length > 0 && (
        <div className="border-t border-slate-200 bg-white shrink-0">
          <Pagination page={page} pageSize={pageSize} totalItems={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}

      {editRow && (
        <SuperAdminRecordEditDialog
          open
          title={`Edit deviation - ${editRow.deviationNumber}`}
          fields={deviationFields}
          initial={{
            status: editRow.status, ahuName: editRow.ahuName ?? '', scheduledDate: editRow.scheduledDate, windowStart: editRow.windowStart ?? '', windowEnd: editRow.windowEnd,
            overdueDaysAtOpen: editRow.overdueDaysAtOpen, acknowledgedBy: editRow.acknowledgedBy ?? '', acknowledgedAt: editRow.acknowledgedAt ?? '',
            completedBy: editRow.completedBy ?? '', completedAt: editRow.completedAt ?? '', delayDays: editRow.delayDays ?? '', closedAt: editRow.closedAt ?? '',
            closureKind: editRow.closureKind ?? '', closureReason: editRow.closureReason ?? '',
          }}
          onSave={saveDeviation}
          onSaved={() => { toast.success('Deviation updated', 'Recorded in the audit trail'); refetch(); }}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  );
}
