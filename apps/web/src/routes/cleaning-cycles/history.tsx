import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useCan } from '../../hooks/use-can';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { usePaginationDefaults } from '../../hooks/use-pagination-config';
import { useReportLabels } from '../../hooks/use-report-labels';
import { Pagination } from '@/components/ui/pagination';
import { api } from '../../lib/api-client';
import { createReport } from '../../lib/pdf-report';
import { datetimeInputToIso } from '@/lib/datetime-input';
import { exportToExcel } from '@/lib/excel-export';
import { ExportMenu } from '@/components/ExportMenu';
import { SendForReviewButton } from '@/components/SendForReviewButton';
import { ManualEntryBadge } from '@/components/manual-entry-badge';
import { requireExportReauth, isReauthCancelled } from '@/lib/report-export-log';
import { useExportLimit } from '@/hooks/use-export-limit';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { STATUS_LABELS } from '../filter-management/filter-list/constants';
import { CycleDetailView } from './cycle-detail-view';
import { SuperAdminEditButton, useIsSuperAdmin } from '@/components/super-admin-record-edit';
import { SuperAdminCycleEditDialog } from '@/components/super-admin-cycle-edit';
import type { CleaningCycle, FilterInstance, PaginatedResponse } from '../../types/filter';
// Stage/dryer logic + column order live in a shared module so this list and the
// Filter Lifecycle Report (filter-lifecycle.tsx) can never drift. See that file
// for the 2026-06-08 column redefinition (Duration = dryer duration; Dry In =
// dryer-duration submission time; 'Dry By' + cycle-duration dropped).
import { CC_COL_KEYS as CC_COLS, getStageInfo, getReading, fmtMinutes, getDryerStart, effectiveCycleStatus,
  maxReachedStageIndex, resolveStageCell, stageCellText, performerLabel } from '@/lib/cleaning-cycle-report';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { downloadName } from '@/lib/download-name';
import { readCleaningRecordExport, type CleaningRecordExport } from '@/lib/cleaning-record-export';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
const MSU_COLS = ['sNo', 'filter', 'statusChange', 'dateTime', 'updatedBy', 'remarks'];

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string; border: string }> = {
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400 animate-pulse', border: 'border-blue-200' },
  COMPLETED: { label: 'Completed', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-400', border: 'border-green-200' },
  TERMINATED: { label: 'Terminated', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-400', border: 'border-red-200' },
  // Cycle ended because the filter was retired / replaced mid-cleaning.
  RETIRED: { label: 'Retired', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', border: 'border-amber-200' },
  REPLACED: { label: 'Replaced', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-400', border: 'border-purple-200' },
};

export function CleaningCycleHistoryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Report exports are re-auth gated per report (Config → Action Re-auth → Reports), 2026-09-24.

  const reauth = useReauth();
  const exportLimit = useExportLimit();
  const { formatDateTime, config: datetimeConfig } = useDatetimeFormat();
  const { labelsFor } = useReportLabels();
  const ccL = labelsFor('cleaning-cycles');
  const msuL = labelsFor('manual-status-updates');
  const ccHead = CC_COLS.map((k) => ccL.columns[k]);
  const msuHead = MSU_COLS.map((k) => msuL.columns[k]);
  // Phase 5C: cleaning_record.export gate = ['REPORT_EXPORT','REPORT_GENERATE'] — SAME as old check.
  const can = useCan();
  const canExportPdf = can('cleaning_record.export');
  const { options: paginationOptions, defaultLimit } = usePaginationDefaults();
  const [page, setPage] = useState(1);
  // The page size FOLLOWS the Pagination Settings default until the operator
  // picks one. Seeding state from `defaultLimit` captured the hook's pre-load
  // fallback (20) on a cold load, and a "synced once" flag then locked it in,
  // so the configured size never applied (2026-10-21, D6).
  const [perPageChoice, setPerPageChoice] = useState<number | null>(null);
  const perPage = perPageChoice ?? defaultLimit;
  const [status, setStatus] = useState('');
  // 2026-06-09: cleaning cycles + manual status updates are now MERGED into one
  // date-sorted list via /api/filters/cleaning-record. Manual rows are tagged
  // `_kind: 'manual'` and rendered as a single "Manual status update" line.
  const [selectedFilter, setSelectedFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Search (debounced) + cascading Block → Area → AHU hierarchy filters. All
  // resolved server-side (the list is paginated, so client-side filtering would
  // only ever see the current page).
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [blockId, setBlockId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [ahuId, setAhuId] = useState('');
  useEffect(() => {
    // Only a CHANGED search resets the page. The effect also runs at mount (and
    // on whitespace-only edits); arming the timer then sent an operator who had
    // already clicked Next back to page 1 (2026-10-21, D10).
    const next = searchInput.trim();
    if (next === search) return;
    const t = setTimeout(() => { setSearch(next); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput, search]);
  const [downloading, setDownloading] = useState(false);
  // Manual status update opened in the detail dialog (manual rows have no cycle
  // page to navigate to, so View opens an in-place summary instead).
  const [manualView, setManualView] = useState<any | null>(null);
  // SUPER_ADMIN edit (2026-09-05): a cycle row edits the cycle + its stage
  // events; a manual status update row edits that single event.
  const isSuperAdmin = useIsSuperAdmin();
  const [saEdit, setSaEdit] = useState<{ cycle: any | null; events: any[]; title: string } | null>(null);

  // A-01 Wave 5 (2026-05-29): migrated off /api/assets/instances +
  // /api/assets/templates to /api/hierarchy/filters (typed-table read).
  // The hierarchy endpoint already gates on isActive=true and returns ONLY
  // filter-kind rows — no template Set membership check needed.
  const { data: instancesData } = useSWR<PaginatedResponse<FilterInstance>>('/api/hierarchy/filters');
  const filterInstances = (instancesData?.data ?? []).filter((i) => i.status !== 'Retired');

  // Cascading hierarchy options. Areas scope to the chosen block, AHUs to the
  // chosen area — both server-scoped, so depth variance is handled server-side.
  // NOTE: blocks laid out Block→AHU (no Area level) return no areas; the operator
  // filters at Block level there (the backend recursive walk still resolves every
  // descendant filter), and the AHU dropdown stays disabled until an area exists.
  const { data: blocksData } = useSWR<PaginatedResponse<any>>('/api/hierarchy/blocks');
  const { data: areasData } = useSWR<PaginatedResponse<any>>(blockId ? `/api/hierarchy/areas?blockId=${blockId}` : null);
  const { data: ahusData } = useSWR<PaginatedResponse<any>>(areaId ? `/api/hierarchy/ahus?areaId=${areaId}` : null);
  const blocks = (blocksData?.data ?? []) as any[];
  const areas = (areasData?.data ?? []) as any[];
  const ahus = (ahusData?.data ?? []) as any[];

  // Unified record: cleaning cycles + manual status updates, date-sorted + paged.
  const queryParams = new URLSearchParams({ page: String(page), limit: String(perPage) });
  if (status) queryParams.set('status', status);
  if (selectedFilter) queryParams.set('filterId', selectedFilter);
  if (search) queryParams.set('search', search);
  if (blockId) queryParams.set('blockId', blockId);
  if (areaId) queryParams.set('areaId', areaId);
  if (ahuId) queryParams.set('ahuId', ahuId);
  // The range control is `datetime-local`: each end is a wall-clock DATE AND TIME
  // in the configured zone (the zone every timestamp on this page is shown in).
  // It used to go through the date-only startOfDayIso/endOfDayIso, which return
  // '' for a value with a time part — so no from/to was ever sent and the list
  // AND the export ignored the range (2026-10-21, D4). The server compares
  // gte/lte; the input is minute-precision and the list shows minutes, so "To"
  // includes the whole chosen minute (17:45 → 17:45:59.999).
  const fromIso = datetimeInputToIso(fromDate, datetimeConfig.timezone);
  const toStart = datetimeInputToIso(toDate, datetimeConfig.timezone);
  const toIso = toStart ? new Date(new Date(toStart).getTime() + 59_999).toISOString() : '';
  if (fromIso) queryParams.set('from', fromIso);
  if (toIso) queryParams.set('to', toIso);

  // M63: `error` is read so a failed fetch is not rendered as "No records
  // found". Stale rows from an earlier good load stay up on a later failure.
  const { data, error: loadError, isLoading, mutate: reload } = useSWR<PaginatedResponse<any>>(`/api/filters/cleaning-record?${queryParams}`);

  const selectedFilterName = selectedFilter
    ? filterInstances.find((f) => f.id === selectedFilter)?.name ?? 'Filter'
    : 'All Filters';
  // Every filter that produced an export, by name: the REPORT_GENERATED row must
  // say WHICH records were exported, not only how many (2026-10-22).
  const exportFilters = {
    Search: search,
    Block: blockId ? blocks.find((b) => b.id === blockId)?.name ?? blockId : '',
    Area: areaId ? areas.find((a) => a.id === areaId)?.name ?? areaId : '',
    AHU: ahuId ? ahus.find((h) => h.id === ahuId)?.name ?? ahuId : '',
    Filter: selectedFilter ? selectedFilterName : '',
    Status: status ? STATUS_CONFIG[status]?.label ?? status : '',
    From: fromDate,
    To: toDate,
  };

  const records = (data?.data ?? []) as any[];
  // Only real cleaning cycles feed the export (manual rows have no stages) —
  // selected by readCleaningRecordExport (via fetchExportCycles), which reads the
  // whole set rather than this page.
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  const filterAttrMap = new Map<string, Record<string, any>>();
  (instancesData?.data ?? []).forEach((i) => {
    filterAttrMap.set(i.id, i.attributes ?? {});
  });

  // getStageInfo / getReading / fmtMinutes / getDryerStart now live in
  // @/lib/cleaning-cycle-report (shared with the Filter Lifecycle Report).

  /**
   * Fetch the WHOLE filtered cleaning record, not just the page on screen —
   * exporting one page shipped ~10 rows under a header claiming the full total.
   * The paging, the cycles-only count, the export limit and the truncation rule
   * live in lib/cleaning-record-export.ts. Returns null (after toasting) when
   * the record is over the export limit.
   */
  const fetchExportCycles = async (): Promise<Extract<CleaningRecordExport, { tooLarge: false }> | null> => {
    const record = await readCleaningRecordExport((page, pageSize) => {
      const u = new URLSearchParams(queryParams);
      u.set('page', String(page));
      u.set('limit', String(pageSize));
      return api.get(`/api/filters/cleaning-record?${u.toString()}`);
    }, exportLimit.maxRecords);
    if (record.tooLarge) {
      toast.error('Export too large', exportLimit.tooLargeMessage(record.cycleCount));
      return null;
    }
    if (record.truncated) {
      toast.warning('Export incomplete', `The server returned ${record.read.toLocaleString()} of ${record.total.toLocaleString()} records, so cycles may be missing. Narrow the period or filter and export again.`);
    }
    return record;
  };

  const buildCleaningRows = (rows: any[]): string[][] =>
    rows.map((c, idx: number) => {
        const attrs = filterAttrMap.get(c.filterId) ?? {};
        const washIn = getStageInfo(c.events ?? [], 'WASH_IN');
        const washOut = getStageInfo(c.events ?? [], 'WASH_OUT');
        const dryIn = getStageInfo(c.events ?? [], 'DRY_IN');
        const dryOut = getStageInfo(c.events ?? [], 'DRY_OUT');
        const washReadings = washIn?.readings ?? [];
        const dryReadings = (dryIn?.readings?.length ? dryIn.readings : null) ?? (dryOut?.readings?.length ? dryOut.readings : null) ?? [];
        // Stage columns resolve through the SAME shared rule the on-screen table
        // uses (2026-09-02). This builder previously carried its own copy with no
        // "Skipped" branch, so a stage shown Skipped on screen printed "Pending"
        // in the PDF and Excel export of the same cycle.
        const pStages: string[] = c.profileStages ?? [];
        const eff = effectiveCycleStatus(c);
        const maxReachedIdx = maxReachedStageIndex(c.events ?? [], pStages);
        const naCell = (stage: string, v: string | null) =>
          stageCellText(resolveStageCell({ stage, value: v, profileStages: pStages, effStatus: eff, maxReachedIdx }));
        const dryerTempStr = getReading(dryReadings, 'dryer') !== '-' ? getReading(dryReadings, 'dryer') : getReading(dryReadings, 'temperature');
        const dryerStart = getDryerStart(c, c.events ?? []);
        return [
          String(idx + 1), c.filterName ?? '-', attrs.filterSize ?? '-',
          getReading(washReadings, 'air pressure'), getReading(washReadings, 'ro water'),
          naCell('WASH_IN', washIn ? formatDateTime(washIn.time) : null), naCell('WASH_OUT', washOut ? formatDateTime(washOut.time) : null),
          washIn?.performedBy ?? washOut?.performedBy ?? '-',
          naCell('DRY_IN', fmtMinutes(dryerStart.minutes)),
          naCell('DRY_IN', dryerStart.time ? formatDateTime(dryerStart.time) : null),
          naCell('DRY_IN', dryerTempStr !== '-' ? dryerTempStr : null),
          naCell('DRY_OUT', dryOut ? formatDateTime(dryOut.time) : null),
          // DRY_OUT first — the stage the operator asked about — falling back to
          // DRY_IN. Deliberately the mirror image of washBy above, which reads
          // WASH_IN first. `performedBy` here is the USERNAME
          // (filter-operations.service.ts maps performedByName: u?.username),
          // not the full name, so this column is the user id it looks like.
          dryOut?.performedBy ?? dryIn?.performedBy ?? '-',
          STATUS_CONFIG[eff]?.label ?? eff,
        ];
      });

  const buildHistoryReport = async (record: Extract<CleaningRecordExport, { tooLarge: false }>) => {
    const rows = record.cycles;
    if (rows.length === 0) return null;
    const period = fromDate || toDate
      ? `${fromDate ? formatDateTime(fromDate) : 'Start'} to ${toDate ? formatDateTime(toDate) : 'Now'}`
      : 'All Time';
    // A record that arrived short says so on the document itself, rather than
    // letting the header imply it is complete (rule: lib/cleaning-record-export.ts).
    const incomplete = record.truncated
      ? ` (incomplete: the server returned ${record.read.toLocaleString()} of ${record.total.toLocaleString()} records — narrow the period or filter and export again)`
      : '';
    const report = await createReport({ reportKey: 'cleaning-cycle-history',
      title: ccL.title,
      // Count the cycles actually in the table below. The on-screen `total`
      // also counts manual status updates, which this export excludes — quoting
      // it here made the header overstate the document's own contents.
      subtitle: ccL.subtitle || `Filter: ${selectedFilterName}  |  Status: ${status || 'All'}  |  Period: ${period}  |  Total: ${rows.length} cycle(s)${incomplete}`,
      orientation: 'landscape',
      formatDateTime,
      legend: [
        { abbr: 'NA', meaning: 'Not Applicable (stage not in this cycle’s profile)' },
        { abbr: 'Skipped', meaning: 'In this cycle’s profile but not performed — the cycle completed without it' },
        { abbr: 'Terminated', meaning: 'In this cycle’s profile and never reached — the cycle was terminated first' },
        { abbr: 'Pending', meaning: 'In this cycle’s profile and not reached — the cycle is still in progress' },
      ],
    });
    // 2026-09-03: 7pt, DOWN from the 8pt set on 2026-09-02, to make room for the
    // 14th column ("Dry By"). Operator chose this over dropping a column.
    //
    // Measured with jsPDF's own font metrics, never estimated — 8.5pt looked
    // viable against sample values on 09-02 and failed on the real ones. Each
    // column needs its widest UNBREAKABLE token (longest header word at bold
    // fontSize+0.5, or longest value) plus the 5mm autoTable actually reserves
    // (pdf-report.ts sets cellPadding left/right 2.5). Against landscape's usable
    // width, with the values that occur in the live data, FOURTEEN columns need:
    //     8.0pt -> 284mm  over by 16     7.5pt -> 273mm  over by 5
    //     7.0pt -> 261mm  FITS
    // The usable width is 267mm, not the 268 quoted before: addTable passes no
    // `margin`, so autoTable's default applies and a 268mm table warns "0.78
    // units width could not fit page". Verified by rendering this exact table
    // and reading the PDF back — the 12 longest live filter names, both
    // dimensions and "superadmin" all come out whole, 24 username cells across
    // the two By columns.
    // The spare goes to Filter, whose longest live value
    // ("CWH/F1/AHU-0B/SA/05/06-01") is a single unbreakable token more than twice
    // the width of any other column and which autoTable would otherwise starve.
    //
    // Wash By moves 17 -> 18mm: at 8pt the live username "superadmin" measured
    // 14.6mm against 12mm of usable cell, so that column has been overflowing
    // since it shipped. 18mm at 7pt leaves 13mm usable for a 12.8mm token.
    // Grid lines thin with the font automatically (see pdf-report addTable).
    report.addTable({
      head: ccHead,
      body: buildCleaningRows(rows),
      fontSize: 7,
      columnStyles: {
        0: { halign: 'center', cellWidth: 12 },  // S.No
        1: { cellWidth: 45 },                    // Filter — one token; needs 39, holds the spare
        2: { cellWidth: 24 },                    // Filter Dimensions — "500X300X200"
        3: { cellWidth: 17 },                    // Air Pressure — header is the widest part
        4: { cellWidth: 13 },                    // RO Water — "25.0 bar"
        5: { cellWidth: 18 },                    // Wash In — date over time
        6: { cellWidth: 18 },                    // Wash Out
        7: { cellWidth: 18 },                    // Wash By — username, e.g. "superadmin"
        8: { cellWidth: 16 },                    // Duration
        9: { cellWidth: 18 },                    // Dry In
        10: { cellWidth: 14 },                   // Dryer Temp
        11: { cellWidth: 18 },                   // Dry Out
        12: { cellWidth: 18 },                   // Dry By — username
        13: { cellWidth: 18 },                   // Status
      },
    });
    return report;
  };


  // C-05: requireExportReauth re-throws a dismissed password prompt as
  // REAUTH_CANCELLED. Uncaught, a cancel became an unhandled rejection, and a
  // real export failure surfaced only in the console. Cancel = no export, silent.
  const reportExportError = (e: unknown) => {
    if (isReauthCancelled(e)) return;
    toast.error('Export failed', (e as any)?.message ?? 'The export could not be completed.');
  };

  const exportPdf = async () => {
    setDownloading(true);
    try {
      const record = await fetchExportCycles();
      if (!record) return;
      const rows = record.cycles;
      if (rows.length === 0) { toast.error('Nothing to export', 'This selection contains no cleaning cycles.'); return; }
      const report = await buildHistoryReport(record);
      if (!report) return;
      await requireExportReauth(reauth, { reportType: 'Cleaning Record', format: 'PDF', recordCount: rows.length, search: search || undefined, startDate: fromIso || undefined, endDate: toIso || undefined, filters: exportFilters }, toast.warning);
      report.save(`${downloadName('cleaning-cycles', selectedFilterName)}.pdf`);
    } catch (e) { reportExportError(e); } finally { setDownloading(false); }
  };

  const buildHistorySnapshot = async () => {
    const record = await fetchExportCycles();
    if (!record) return null;
    const report = await buildHistoryReport(record);
    return report ? report.getSnapshot() : null;
  };

  const exportExcel = async () => {
    setDownloading(true);
    try {
      const record = await fetchExportCycles();
      if (!record) return;
      const rows = record.cycles;
      if (rows.length === 0) { toast.error('Nothing to export', 'This selection contains no cleaning cycles.'); return; }
      await requireExportReauth(reauth, { reportType: 'Cleaning Record', format: 'Excel', recordCount: rows.length, search: search || undefined, startDate: fromIso || undefined, endDate: toIso || undefined, filters: exportFilters }, toast.warning);
      exportToExcel({ filename: `cleaning-cycles-${selectedFilterName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}`, sheetName: 'Cleaning Record', head: ccHead, rows: buildCleaningRows(rows) });
    } catch (e) { reportExportError(e); } finally { setDownloading(false); }
  };

  return (
    <div className="h-full flex flex-col">
      <ReauthPrompt reauth={reauth} actionLabel="Export report" />
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white shrink-0">
        <PageHeader
          className="mb-4"
          title={ccL.title}
          subtitle={<>{total.toLocaleString()} record{total !== 1 ? 's' : ''} (cycles + manual updates)</>}
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />}
          actions={
            /* Gate on the whole filtered set, not this page: a page holding only
               manual rows hid the export even when other pages had cycles. */
            canExportPdf && total > 0 && (
              <>
                <ExportMenu surface="cleaning-record" onExportPdf={exportPdf} onExportExcel={exportExcel} busy={downloading}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all disabled:opacity-40" />
                <SendForReviewButton buildSnapshot={buildHistorySnapshot}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all" />
              </>
            )
          }
        />

        {/* Filters */}
        <div className="flex items-end gap-3 flex-wrap mb-3">
          <div className="min-w-[180px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="cr-search">Search</label>
            <Input id="cr-search" type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Filter name…" className="h-9 text-[13px]" />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="cr-block">Block</label>
            <Select id="cr-block" value={blockId} onChange={e => { setBlockId(e.target.value); setAreaId(''); setAhuId(''); setPage(1); }} className="h-9 text-[13px]">
              <option value="">All Blocks</option>
              {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="cr-area">Area</label>
            <Select id="cr-area" value={areaId} onChange={e => { setAreaId(e.target.value); setAhuId(''); setPage(1); }} disabled={!blockId} className="h-9 text-[13px]">
              <option value="">{blockId ? 'All Areas' : 'Select block'}</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="cr-ahu">AHU</label>
            <Select id="cr-ahu" value={ahuId} onChange={e => { setAhuId(e.target.value); setPage(1); }} disabled={!areaId} className="h-9 text-[13px]">
              <option value="">{areaId ? 'All AHUs' : 'Select area'}</option>
              {ahus.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </Select>
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="cr-filter">Filter</label>
            <Select id="cr-filter" value={selectedFilter} onChange={e => { setSelectedFilter(e.target.value); setPage(1); }} className="h-9 text-[13px]">
              <option value="">All Filters</option>
              {filterInstances.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </div>
          {/* From + To are one control, so they also wrap as one unit. */}
          <DateRangeFilter
            label="Date range"
            type="datetime-local"
            from={fromDate}
            to={toDate}
            onFromChange={v => { setFromDate(v); setPage(1); }}
            onToChange={v => { setToDate(v); setPage(1); }}
            fromAriaLabel="Cleaning history from date and time"
            toAriaLabel="Cleaning history to date and time"
          />
          {(selectedFilter || fromDate || toDate || searchInput || blockId || areaId || ahuId) && (
            <button onClick={() => { setSelectedFilter(''); setFromDate(''); setToDate(''); setSearchInput(''); setSearch(''); setBlockId(''); setAreaId(''); setAhuId(''); setPage(1); }}
              className="text-[12px] text-cyan-600 hover:text-cyan-700 font-medium pb-2">Clear all</button>
          )}
        </div>

        {/* Status pills — selecting one shows cycles only (manual updates have no
            cycle status, so they're excluded while a status filter is active). */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { setStatus(''); setPage(1); }}
            className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all ${status === '' ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
            All ({total})
          </button>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <button key={key} onClick={() => { setStatus(key); setPage(1); }}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all flex items-center gap-1.5 ${status === key ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status === key ? 'bg-white' : cfg.dot}`} />
              {cfg.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table — fills ALL remaining height between header and pagination, so a
          full page of rows is visible (flex-1 + min-h-0 make the scroll area grow
          to the available space instead of being capped to a few rows). */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loadError && !data ? (
          <div role="alert" className="flex flex-col items-center justify-center py-16 gap-2 text-center px-6">
            <span className="text-[14px] font-semibold text-red-700">Could not load the cleaning record</span>
            <span className="text-[13px] text-slate-500 max-w-md">{(loadError as any)?.status === 403 ? 'You do not have permission to view this.' : ((loadError as any)?.message || 'The server did not answer.')}</span>
            {(loadError as any)?.status !== 403 && (
              <button onClick={() => reload()} className="mt-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-brand-600 hover:bg-brand-700">Retry</button>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading record...</span>
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-slate-400 font-medium text-[14px]">No records found</span>
            <span className="text-[13px] text-slate-300">Cleaning cycles and manual status updates appear here</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                {[...ccHead, ''].map((h, i) => (
                  <th key={i} className="h-10 text-left px-4 text-xs font-semibold text-slate-600 whitespace-nowrap bg-slate-50">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white">
              {records.map((c, idx: number) => {
                // Manual status update — rendered in the SAME columns as a cleaning
                // cycle (2026-06-10 request). The stage the operator set shows its
                // time (orange = manual); in-profile stages the from->to jump
                // bypassed show "Skipped"; the rest follow NA / Pending like a cycle.
                if (c._kind === 'manual') {
                  const mAttrs = filterAttrMap.get(c.filterId) ?? {};
                  const pStages: string[] = c.profileStages ?? [];
                  const toComplete = c.toState === 'CLEANING_CYCLE_COMPLETED';
                  const toIdx = toComplete ? pStages.length : pStages.indexOf(c.toState ?? '');
                  const fromIdx = c.fromState ? pStages.indexOf(c.fromState) : -1;
                  const mStatus = toComplete ? 'CLEANING_CYCLE_COMPLETED' : (c.toState ?? '');
                  const mInfo = STATUS_LABELS[mStatus] ?? { label: (mStatus || '-').replace(/_/g, ' '), color: 'bg-slate-50 text-slate-600 border-slate-200' };
                  const manualCell = (stage: string) => {
                    if (pStages.length > 0 && !pStages.includes(stage)) return <span className="text-slate-400 italic">NA</span>;
                    const si = pStages.indexOf(stage);
                    if (stage === c.toState) return <span className="text-orange-600 font-semibold" title="Set by manual update">{formatDateTime(c.performedAt)}</span>;
                    if (si >= 0 && si > fromIdx && si < toIdx) return <span className="text-rose-500 italic">Skipped</span>;
                    if (si >= 0 && si <= fromIdx) return <span className="text-slate-300">—</span>;
                    return <span className="text-blue-500 italic">Pending</span>;
                  };
                  return (
                    <tr key={`m-${c.id}`} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 py-2.5 text-[13px] text-slate-400 font-medium text-center tabular-nums">{(page - 1) * perPage + idx + 1}</td>
                      <td className="px-4 py-2.5"><div className="text-[13px] font-semibold text-slate-800">{c.filterName ?? '-'}</div></td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-600">{mAttrs.filterSize ?? '-'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-400 font-mono tabular-nums whitespace-nowrap">-</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-400 font-mono tabular-nums whitespace-nowrap">-</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{manualCell('WASH_IN')}</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{manualCell('WASH_OUT')}</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-800 font-medium">{performerLabel(c)}</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-400 whitespace-nowrap tabular-nums">-</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{manualCell('DRY_IN')}</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-400 font-mono tabular-nums whitespace-nowrap">-</td>
                      <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{manualCell('DRY_OUT')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-bold rounded-full whitespace-nowrap border ${mInfo.color}`}>{mInfo.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1">
                          {isSuperAdmin && <SuperAdminEditButton onClick={() => setSaEdit({ cycle: null, events: [c], title: `Edit manual status update - ${c.filterName ?? ''}` })} />}
                          <button onClick={() => setManualView(c)}
                            className="text-[12px] font-semibold text-cyan-600 hover:text-cyan-700 px-3 py-1.5 rounded-lg hover:bg-cyan-50 transition-colors opacity-60 group-hover:opacity-100">
                            View
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                }
                const attrs = filterAttrMap.get(c.filterId) ?? {};
                const washIn = getStageInfo(c.events ?? [], 'WASH_IN');
                const washOut = getStageInfo(c.events ?? [], 'WASH_OUT');
                const dryIn = getStageInfo(c.events ?? [], 'DRY_IN');
                const dryOut = getStageInfo(c.events ?? [], 'DRY_OUT');
                const washReadings = washIn?.readings ?? [];
                const dryReadings = (dryIn?.readings?.length ? dryIn.readings : null) ?? (dryOut?.readings?.length ? dryOut.readings : null) ?? [];
                const dryerTemp = getReading(dryReadings, 'dryer') !== '-' ? getReading(dryReadings, 'dryer') : getReading(dryReadings, 'temperature');
                const dryerStart = getDryerStart(c, c.events ?? []);
                const eff = effectiveCycleStatus(c);
                const sc = STATUS_CONFIG[eff];
                // P2 (2026-06-03): a stage the cycle's profile does NOT configure
                // shows "NA"; an in-profile stage not yet reached shows "-".
                // profileStages comes from the cycles API (empty ⇒ unknown ⇒ keep "-").
                // 2026-06-08: a cycle ended by retire/replace shows its un-reached
                // in-profile stages as "Retired"/"Replaced".
                const profileStages: string[] = c.profileStages ?? [];
                const maxReachedIdx = maxReachedStageIndex(c.events ?? [], profileStages);
                // The DECISION lives in cleaning-cycle-report.ts so the PDF/Excel
                // builder above cannot drift from it; only the colours are local.
                const stageCell = (stage: string, value: string | null, manual?: boolean) => {
                  const st = resolveStageCell({ stage, value, manual, profileStages, effStatus: eff, maxReachedIdx });
                  switch (st.kind) {
                    case 'value':
                      return st.manual
                        ? <span className="text-orange-600 font-semibold" title="Set by manual update">{st.value}</span>
                        : st.value;
                    case 'na':
                      return <span className="text-slate-400 italic">NA</span>;
                    case 'terminal': {
                      // Three labels share this kind now (Retired / Replaced /
                      // Terminated, 2026-09-03). Branch on the LABEL rather than
                      // on `eff` — keyed on eff, Terminated silently inherited
                      // Replaced's purple and the two read as the same outcome.
                      const tone = st.label === 'Retired' ? 'text-amber-600'
                        : st.label === 'Replaced' ? 'text-purple-600'
                        : 'text-slate-500';
                      return <span className={`italic ${tone}`}>{st.label}</span>;
                    }
                    case 'skipped':
                      return <span className="text-rose-500 italic">Skipped</span>;
                    case 'pending':
                      return <span className="text-blue-500 italic">Pending</span>;
                  }
                };

                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-4 py-2.5 text-[13px] text-slate-400 font-medium text-center tabular-nums">{(page - 1) * perPage + idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">{c.filterName ?? '-'}<ManualEntryBadge manual={c.manualEntry} /></div>
                      {c.filterSet && (
                        <span className={`text-[11px] font-semibold ${c.filterSet === 'SET_A' ? 'text-indigo-500' : 'text-purple-500'}`}>
                          Set {c.filterSet.replace('SET_', '')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600">{attrs.filterSize ?? '-'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 font-mono tabular-nums whitespace-nowrap">{getReading(washReadings, 'air pressure')}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 font-mono tabular-nums whitespace-nowrap">{getReading(washReadings, 'ro water')}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('WASH_IN', washIn ? formatDateTime(washIn.time) : null, washIn?.manual)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('WASH_OUT', washOut ? formatDateTime(washOut.time) : null, washOut?.manual)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-800 font-medium">{washIn?.performedBy ?? washOut?.performedBy ?? '-'}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('DRY_IN', fmtMinutes(dryerStart.minutes), dryIn?.manual)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('DRY_IN', dryerStart.time ? formatDateTime(dryerStart.time) : null, dryIn?.manual)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 font-mono tabular-nums whitespace-nowrap">{stageCell('DRY_IN', dryerTemp !== '-' ? dryerTemp : null, dryIn?.manual)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('DRY_OUT', dryOut ? formatDateTime(dryOut.time) : null, dryOut?.manual)}</td>
                    {/* Who completed the dry — DRY_OUT first, falling back to DRY_IN. */}
                    <td className="px-4 py-2.5 text-[13px] text-slate-800 font-medium">{dryOut?.performedBy ?? dryIn?.performedBy ?? '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full whitespace-nowrap ${sc?.bg ?? 'bg-slate-50'} ${sc?.text ?? 'text-slate-600'} border ${sc?.border ?? 'border-slate-200'}`}>
                        {eff === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                        {sc?.label ?? eff}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1">
                        {isSuperAdmin && <SuperAdminEditButton onClick={() => setSaEdit({ cycle: c, events: c.events ?? [], title: `Edit cleaning record - ${c.filterName ?? ''}` })} />}
                        <button onClick={() => navigate(`/cleaning-cycles/${c.id}`)}
                          className="text-[12px] font-semibold text-cyan-600 hover:text-cyan-700 px-3 py-1.5 rounded-lg hover:bg-cyan-50 transition-colors opacity-60 group-hover:opacity-100">
                          View
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination — fixed bottom */}
      {records.length > 0 && (
        <div className="border-t border-slate-200 bg-white shrink-0">
          <Pagination
            page={page}
            pageSize={perPage}
            totalItems={total}
            onPageChange={setPage}
            onPageSizeChange={setPerPageChoice}
            pageSizeOptions={paginationOptions}
          />
        </div>
      )}

      {saEdit && (
        <SuperAdminCycleEditDialog cycle={saEdit.cycle} events={saEdit.events} title={saEdit.title}
          onClose={() => setSaEdit(null)} onSaved={() => toast.success('Record updated', 'Written to the database and recorded in the audit trail')} />
      )}

      {/* Manual status update — shown through the SAME detail view as a cleaning
          cycle (info card + stage bar + event timeline), built from the row's
          data since a manual update has no cycle row to fetch. */}
      {manualView && (() => {
        const m = manualView;
        const pseudoCycle = {
          _manual: true,
          id: m.id,
          filterName: m.filterName ?? null,
          filterSet: m.filterSet ?? null,
          ahuName: m.ahuName ?? null,
          cleaningReasonKey: m.attributes?.cleaningReasonKey ?? null,
          cleaningReasonLabel: m.attributes?.cleaningReasonLabel ?? null,
          cleaningAreaName: null,
          profileStages: m.profileStages ?? [],
          startedAt: m.performedAt,
          completedAt: m.toState === 'CLEANING_CYCLE_COMPLETED' ? m.performedAt : null,
          status: 'COMPLETED',
          events: [{
            id: m.id,
            eventType: 'STATE_TRANSITION',
            fromState: m.fromState ?? null,
            toState: m.toState ?? null,
            performedAt: m.performedAt,
            performedByName: performerLabel(m, ''),  // '' so a missing performer stays falsy downstream
            remarks: m.remarks ?? null,
            attributes: { ...(m.attributes ?? {}), manual: true },
          }],
        };
        return (
          <div className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
            <div className="px-6 pt-6 pb-4 shrink-0">
              <button onClick={() => setManualView(null)} className="text-slate-500 hover:text-slate-700 text-sm flex items-center gap-1.5 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back to History
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              <CycleDetailView cycle={pseudoCycle} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
