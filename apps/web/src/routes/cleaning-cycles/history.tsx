import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { usePaginationDefaults } from '../../hooks/use-pagination-config';
import { useReportConfig } from '@/hooks/use-report-config';
import { useReportLabels } from '../../hooks/use-report-labels';
import { ReportPageWrapper } from '@/components/report-page-wrapper';
import { createReport } from '../../lib/pdf-report';
import type { CleaningCycle, FilterInstance, PaginatedResponse } from '../../types/filter';
// Stage/dryer logic + column order live in a shared module so this list and the
// Filter Lifecycle Report (filter-lifecycle.tsx) can never drift. See that file
// for the 2026-06-08 column redefinition (Duration = dryer duration; Dry In =
// dryer-duration submission time; 'Dry By' + cycle-duration dropped).
import { CC_COL_KEYS as CC_COLS, getStageInfo, getReading, fmtMinutes, getDryerStart, effectiveCycleStatus } from '@/lib/cleaning-cycle-report';
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
  const { formatDateTime } = useDatetimeFormat();
  const { labelsFor } = useReportLabels();
  const ccL = labelsFor('cleaning-cycles');
  const msuL = labelsFor('manual-status-updates');
  const ccHead = CC_COLS.map((k) => ccL.columns[k]);
  const msuHead = MSU_COLS.map((k) => msuL.columns[k]);
  // 2026-05-26 audit fix (PA-CLEANUP-1): gate PDF export on
  // REPORT_EXPORT — pre-fix any CYCLE_READ user could PDF the history.
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canExportPdf = isSuperAdmin || perms.includes('REPORT_EXPORT') || perms.includes('REPORT_GENERATE');
  const { options: paginationOptions, defaultLimit } = usePaginationDefaults();
  const { config: reportConfig } = useReportConfig();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(reportConfig.recordsPerPage);
  const [perPageSynced, setPerPageSynced] = useState(false);
  useEffect(() => {
    if (!perPageSynced && defaultLimit && defaultLimit !== reportConfig.recordsPerPage) {
      setPerPage(defaultLimit);
      setPerPageSynced(true);
      setPage(1);
    }
  }, [defaultLimit, perPageSynced, reportConfig.recordsPerPage]);
  const [status, setStatus] = useState('');
  // 2026-06-03: Cleaning Cycles | Manual Status Updates toggle. Manual updates
  // are NOT cleaning cycles (no fabricated rows) — they come from the
  // /manual-status-changes log (STATE_TRANSITION events, cycleId null).
  const [view, setView] = useState<'cycles' | 'manual'>('cycles');
  const [selectedFilter, setSelectedFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [downloading, setDownloading] = useState(false);

  // A-01 Wave 5 (2026-05-29): migrated off /api/assets/instances +
  // /api/assets/templates to /api/hierarchy/filters (typed-table read).
  // The hierarchy endpoint already gates on isActive=true and returns ONLY
  // filter-kind rows — no template Set membership check needed.
  const { data: instancesData } = useSWR<PaginatedResponse<FilterInstance>>('/api/hierarchy/filters?limit=500');
  const filterInstances = (instancesData?.data ?? []).filter((i) => i.status !== 'Retired');

  const queryParams = new URLSearchParams({ page: String(page), limit: String(perPage), includeEvents: 'true' });
  if (status) queryParams.set('status', status);
  if (selectedFilter) queryParams.set('filterId', selectedFilter);
  if (fromDate) queryParams.set('from', new Date(fromDate).toISOString());
  if (toDate) queryParams.set('to', new Date(toDate).toISOString());

  const { data, isLoading } = useSWR<PaginatedResponse<CleaningCycle>>(
    view === 'cycles' ? `/api/filters/cycles?${queryParams}` : null);

  // Manual Status Updates view — Filter / From / To filters are shared; status
  // pills don't apply (these aren't cycles with a status lifecycle).
  const manualParams = new URLSearchParams({ page: String(page), limit: String(perPage) });
  if (selectedFilter) manualParams.set('filterId', selectedFilter);
  if (fromDate) manualParams.set('from', new Date(fromDate).toISOString());
  if (toDate) manualParams.set('to', new Date(toDate).toISOString());
  const { data: manualData, isLoading: manualLoading } = useSWR<PaginatedResponse<any>>(
    view === 'manual' ? `/api/filters/manual-status-changes?${manualParams}` : null);

  const selectedFilterName = selectedFilter
    ? filterInstances.find((f) => f.id === selectedFilter)?.name ?? 'Filter'
    : 'All Filters';

  const cycles = data?.data ?? [];
  const manualChanges = manualData?.data ?? [];
  // Active-view totals drive the header count + pagination footer.
  const totalPages = (view === 'cycles' ? data?.totalPages : manualData?.totalPages) ?? 1;
  const total = (view === 'cycles' ? data?.total : manualData?.total) ?? 0;

  const filterAttrMap = new Map<string, Record<string, any>>();
  (instancesData?.data ?? []).forEach((i) => {
    filterAttrMap.set(i.id, i.attributes ?? {});
  });

  // getStageInfo / getReading / fmtMinutes / getDryerStart now live in
  // @/lib/cleaning-cycle-report (shared with the Filter Lifecycle Report).

  const handleDownloadPDF = async () => {
    if (cycles.length === 0) return;
    setDownloading(true);
    try {
      const period = fromDate || toDate
        ? `${fromDate ? formatDateTime(fromDate) : 'Start'} to ${toDate ? formatDateTime(toDate) : 'Now'}`
        : 'All Time';

      const report = await createReport({
        title: ccL.title,
        subtitle: ccL.subtitle || `Filter: ${selectedFilterName}  |  Status: ${status || 'All'}  |  Period: ${period}  |  Total: ${total} cycle(s)`,
        orientation: 'landscape',
        formatDateTime,
      });

      const tableRows = cycles.map((c, idx: number) => {
        const attrs = filterAttrMap.get(c.filterId) ?? {};
        const washIn = getStageInfo(c.events ?? [], 'WASH_IN');
        const washOut = getStageInfo(c.events ?? [], 'WASH_OUT');
        const dryIn = getStageInfo(c.events ?? [], 'DRY_IN');
        const dryOut = getStageInfo(c.events ?? [], 'DRY_OUT');
        const washReadings = washIn?.readings ?? [];
        const dryReadings = (dryIn?.readings?.length ? dryIn.readings : null) ?? (dryOut?.readings?.length ? dryOut.readings : null) ?? [];
        // P2: missing profile stage → "NA" (string form for the PDF rows).
        // A cycle ended by retire/replace shows its un-reached in-profile stages
        // as "Retired"/"Replaced" rather than "-".
        const pStages: string[] = c.profileStages ?? [];
        const eff = effectiveCycleStatus(c);
        const termLabel = eff === 'RETIRED' ? 'Retired' : eff === 'REPLACED' ? 'Replaced' : null;
        const naCell = (stage: string, v: string | null) =>
          v != null ? v : pStages.length > 0 && !pStages.includes(stage) ? 'NA' : termLabel ?? '-';
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
          STATUS_CONFIG[eff]?.label ?? eff,
        ];
      });

      report.addTable({
        head: ccHead,
        body: tableRows,
        columnStyles: { 0: { halign: 'center', cellWidth: 10 } },
      });

      report.save(`cleaning-cycles-${selectedFilterName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally { setDownloading(false); }
  };

  const getPageNumbers = () => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600 to-cyan-700 shadow-lg shadow-cyan-600/10">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">{view === 'cycles' ? ccL.title : msuL.title}</h1>
              <p className="text-[13px] text-slate-400 mt-0.5">
                {total.toLocaleString()} {view === 'cycles' ? `total cycle${total !== 1 ? 's' : ''}` : `manual update${total !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          {view === 'cycles' && (
            <button onClick={handleDownloadPDF} disabled={downloading || cycles.length === 0 || !canExportPdf}
              title={!canExportPdf ? 'REPORT_EXPORT permission required' : undefined}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              {downloading ? (
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              Export PDF
            </button>
          )}
        </div>

        {/* View toggle: Cleaning Cycles | Manual Status Updates */}
        <div className="flex gap-2 mb-4">
          {([['cycles', ccL.title], ['manual', msuL.title]] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setView(key); setPage(1); }}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${view === key ? 'bg-cyan-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-end gap-3 flex-wrap mb-3">
          <div className="min-w-[200px]">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Filter</label>
            <select value={selectedFilter} onChange={e => { setSelectedFilter(e.target.value); setPage(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
              <option value="">All Filters</option>
              {filterInstances.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">From</label>
            <input type="datetime-local" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">To</label>
            <input type="datetime-local" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
          </div>
          {(selectedFilter || fromDate || toDate) && (
            <button onClick={() => { setSelectedFilter(''); setFromDate(''); setToDate(''); setPage(1); }}
              className="text-[12px] text-cyan-600 hover:text-cyan-700 font-medium pb-2">Clear all</button>
          )}
        </div>

        {/* Status pills — cycles view only (manual updates have no cycle status) */}
        {view === 'cycles' && (
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
        )}
      </div>

      {/* Table — fills remaining space */}
      <ReportPageWrapper
        title={view === 'cycles' ? ccL.title : msuL.title}
        totalRecords={total}
        page={page}
        totalPages={totalPages}
      >
      {/* Bounded-height scroll box: table scrolls both ways INSIDE here so the
          horizontal scrollbar stays in the viewport (not pushed below all rows). */}
      <div className="flex-1 overflow-auto max-h-[calc(100vh-26rem)]">
        {view === 'manual' ? (
          manualLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] text-slate-400">Loading manual updates...</span>
            </div>
          ) : manualChanges.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="text-slate-400 font-medium text-[14px]">No manual status updates found</span>
              <span className="text-[13px] text-slate-300">Changes made via Filters → Edit Filter Status appear here</span>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {msuHead.map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {manualChanges.map((m: any, idx: number) => (
                  <tr key={m.id} className="hover:bg-cyan-50/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-slate-400 font-medium text-center tabular-nums">{(page - 1) * perPage + idx + 1}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">{m.filterName ?? '-'}</td>
                    <td className="px-4 py-3 text-[13px] whitespace-nowrap">
                      <span className="text-slate-500">{(m.fromState ?? 'None').replace(/_/g, ' ')}</span>
                      <span className="text-slate-300 mx-1.5">→</span>
                      <span className="font-medium text-slate-800">{(m.toState ?? '-').replace(/_/g, ' ')}</span>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{m.performedAt ? formatDateTime(m.performedAt) : '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-800 font-medium">{m.performedByName ?? m.performedByUsername ?? '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 max-w-xs truncate" title={m.remarks ?? ''}>{m.remarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading cycles...</span>
          </div>
        ) : cycles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-slate-400 font-medium text-[14px]">No cleaning cycles found</span>
            <span className="text-[13px] text-slate-300">Cycles will appear here once filters start cleaning operations</span>
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200">
                {[...ccHead, ''].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {cycles.map((c, idx: number) => {
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
                const termLabel = eff === 'RETIRED' ? 'Retired' : eff === 'REPLACED' ? 'Replaced' : null;
                const stageCell = (stage: string, value: string | null) =>
                  value != null ? value
                    : profileStages.length > 0 && !profileStages.includes(stage)
                      ? <span className="text-slate-400 italic">NA</span>
                      : termLabel
                        ? <span className={`italic ${eff === 'RETIRED' ? 'text-amber-600' : 'text-purple-600'}`}>{termLabel}</span>
                        : '-';

                return (
                  <tr key={c.id} className="hover:bg-cyan-50/30 transition-colors group">
                    <td className="px-4 py-3 text-[13px] text-slate-400 font-medium text-center tabular-nums">{(page - 1) * perPage + idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-semibold text-slate-800">{c.filterName ?? '-'}</div>
                      {c.filterSet && (
                        <span className={`text-[10px] font-semibold ${c.filterSet === 'SET_A' ? 'text-indigo-500' : 'text-purple-500'}`}>
                          Set {c.filterSet.replace('SET_', '')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{attrs.filterSize ?? '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 font-mono tabular-nums">{getReading(washReadings, 'air pressure')}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 font-mono tabular-nums">{getReading(washReadings, 'ro water')}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('WASH_IN', washIn ? formatDateTime(washIn.time) : null)}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('WASH_OUT', washOut ? formatDateTime(washOut.time) : null)}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-800 font-medium">{washIn?.performedBy ?? washOut?.performedBy ?? '-'}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('DRY_IN', fmtMinutes(dryerStart.minutes))}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('DRY_IN', dryerStart.time ? formatDateTime(dryerStart.time) : null)}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 font-mono tabular-nums">{stageCell('DRY_IN', dryerTemp !== '-' ? dryerTemp : null)}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{stageCell('DRY_OUT', dryOut ? formatDateTime(dryOut.time) : null)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full whitespace-nowrap ${sc?.bg ?? 'bg-slate-50'} ${sc?.text ?? 'text-slate-600'} border ${sc?.border ?? 'border-slate-200'}`}>
                        {eff === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                        {sc?.label ?? eff}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => navigate(`/cleaning-cycles/${c.id}`)}
                        className="text-[12px] font-semibold text-cyan-600 hover:text-cyan-700 px-3 py-1.5 rounded-lg hover:bg-cyan-50 transition-colors opacity-60 group-hover:opacity-100">
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </ReportPageWrapper>

      {/* Pagination — fixed bottom */}
      {(view === 'cycles' ? cycles.length : manualChanges.length) > 0 && (
        <div className="px-6 py-3 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 text-[13px] text-slate-600">
            <span className="text-slate-400 font-medium">Rows per page:</span>
            <div className="flex items-center gap-0.5">
              {paginationOptions.map((opt) => (
                <button key={opt} onClick={() => { setPerPage(opt); setPage(1); }}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
                    perPage === opt ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}>
                  {opt}
                </button>
              ))}
            </div>
            <span className="text-slate-200 mx-1">|</span>
            <span className="text-slate-500">
              Showing <span className="font-semibold text-slate-700">{(page - 1) * perPage + 1}</span>
              {' '}-{' '}
              <span className="font-semibold text-slate-700">{Math.min(page * perPage, total)}</span>
              {' '}of{' '}
              <span className="font-semibold text-slate-700">{total.toLocaleString()}</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page <= 1}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              title="First page">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
            </button>
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
              className="px-3 h-9 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
              Previous
            </button>
            <div className="flex items-center gap-0.5 mx-1">
              {getPageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="w-9 text-center text-[13px] text-slate-300">...</span>
                ) : (
                  <button key={p} onClick={() => setPage(p as number)}
                    className={`w-9 h-9 rounded-lg text-[13px] font-semibold transition-all ${
                      page === p ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                    }`}>
                    {p}
                  </button>
                ),
              )}
            </div>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
              className="px-3 h-9 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
              Next
            </button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              title="Last page">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
