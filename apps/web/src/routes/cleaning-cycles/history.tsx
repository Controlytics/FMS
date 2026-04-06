import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CleaningCycle, FilterEvent, FilterInstance, PaginatedResponse } from '../../types/filter';

const REASON_COLORS: Record<string, string> = {
  PM: 'bg-blue-50 text-blue-700 border border-blue-200', TYPE_A: 'bg-purple-50 text-purple-700 border border-purple-200',
  TYPE_B: 'bg-indigo-50 text-indigo-700 border border-indigo-200', TYPE_C: 'bg-sky-50 text-sky-700 border border-sky-200',
  ON_REQUEST: 'bg-amber-50 text-amber-700 border border-amber-200', CONTAMINATION: 'bg-red-50 text-red-700 border border-red-200',
  FAILURE: 'bg-red-50 text-red-700 border border-red-200', CUSTOM: 'bg-slate-100 text-slate-600 border border-slate-200',
};

const STAGE_LABELS: Record<string, string> = {
  WASH_IN: 'Wash In', WASH_OUT: 'Wash Out', DRY_IN: 'Dry In', DRY_OUT: 'Dry Out',
  STORAGE_IN: 'Storage In', STORAGE_OUT: 'Storage Out',
};

const STAGE_COLORS: Record<string, string> = {
  WASH_IN: 'text-sky-600', WASH_OUT: 'text-sky-700', DRY_IN: 'text-amber-600', DRY_OUT: 'text-amber-700',
  STORAGE_IN: 'text-slate-600', STORAGE_OUT: 'text-slate-700',
};

const STAGE_DOT_COLORS: Record<string, string> = {
  WASH_IN: 'bg-sky-500', WASH_OUT: 'bg-sky-400', DRY_IN: 'bg-amber-500', DRY_OUT: 'bg-amber-400',
  STORAGE_IN: 'bg-gray-400', STORAGE_OUT: 'bg-gray-300',
};

export function CleaningCycleHistoryPage() {
  const navigate = useNavigate();
  const { formatDateTime, formatDate, formatTime } = useDatetimeFormat();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [downloading, setDownloading] = useState(false);

  // Fetch filter instances for dropdown
  const { data: instancesData } = useSWR<PaginatedResponse<FilterInstance>>('/api/assets/instances?limit=500');
  const { data: templatesData } = useSWR<PaginatedResponse<{ id: string; name: string }>>('/api/assets/templates?limit=100');
  const filterTemplateId = (templatesData?.data ?? []).find((t) => t.name === 'Filter')?.id;
  const filterInstances = (instancesData?.data ?? []).filter((i) => i.templateId === filterTemplateId && i.isActive !== false && i.status !== 'Retired');

  // Build query with optional filterId and date range
  const queryParams = new URLSearchParams({ page: String(page), limit: '20', includeEvents: 'true' });
  if (status) queryParams.set('status', status);
  if (selectedFilter) queryParams.set('filterId', selectedFilter);
  if (fromDate) queryParams.set('from', new Date(fromDate).toISOString());
  if (toDate) queryParams.set('to', new Date(toDate).toISOString());

  const { data, isLoading } = useSWR<PaginatedResponse<CleaningCycle>>(`/api/filters/cycles?${queryParams}`);

  const selectedFilterName = selectedFilter
    ? filterInstances.find((f) => f.id === selectedFilter)?.name ?? 'Filter'
    : 'All Filters';

  const cycles = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

  const getStageEvents = (events: FilterEvent[]) => (events ?? []).filter((e) => e.eventType === 'STATE_TRANSITION');

  // Build filter attribute map from instances (for filterSize etc.)
  const filterAttrMap = new Map<string, Record<string, any>>();
  (instancesData?.data ?? []).forEach((i) => {
    if (i.templateId === filterTemplateId) filterAttrMap.set(i.id, i.attributes ?? {});
  });

  // Extract stage info from events
  const getStageInfo = (events: FilterEvent[], stage: string) => {
    const ev = (events ?? []).find((e) => e.eventType === 'STATE_TRANSITION' && e.toState === stage);
    if (!ev) return null;
    return { time: ev.performedAt, performedBy: ev.performedByName ?? ev.performedBy?.substring(0, 8) ?? '-', readings: ev.attributes?.instrumentReadings ?? [] };
  };

  const getReading = (readings: any[], desc: string) => {
    const r = readings.find((r: any) => r.description?.toLowerCase().includes(desc.toLowerCase()));
    return r ? `${r.value} ${r.uom ?? ''}`.trim() : '-';
  };

  const getDuration = (cycle: any) => {
    const end = cycle.completedAt ?? (cycle.status === 'IN_PROGRESS' ? new Date().toISOString() : null);
    if (!end) return null;
    const ms = new Date(end).getTime() - new Date(cycle.startedAt).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  const statusCounts = {
    IN_PROGRESS: cycles.filter((c) => c.status === 'IN_PROGRESS').length,
    COMPLETED: cycles.filter((c) => c.status === 'COMPLETED').length,
    TERMINATED: cycles.filter((c) => c.status === 'TERMINATED').length,
  };

  const handleDownloadPDF = () => {
    if (cycles.length === 0) return;
    setDownloading(true);

    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const period = fromDate || toDate
        ? `${fromDate ? formatDateTime(fromDate) : 'Start'} to ${toDate ? formatDateTime(toDate) : 'Now'}`
        : 'All Time';

      // Title
      doc.setFontSize(16);
      doc.setTextColor(30, 41, 59);
      doc.text('Cleaning Cycle Report', 14, 15);

      // Subtitle
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`Filter: ${selectedFilterName}  |  Status: ${status || 'All'}  |  Period: ${period}`, 14, 22);
      doc.text(`Generated: ${formatDateTime(new Date().toISOString())}  |  Total: ${cycles.length} cycle(s)`, 14, 27);

      // Table data — match the new detailed columns
      const tableRows = cycles.map((c, idx: number) => {
        const attrs = filterAttrMap.get(c.filterId) ?? {};
        const washIn = getStageInfo(c.events ?? [], 'WASH_IN');
        const washOut = getStageInfo(c.events ?? [], 'WASH_OUT');
        const dryIn = getStageInfo(c.events ?? [], 'DRY_IN');
        const dryOut = getStageInfo(c.events ?? [], 'DRY_OUT');
        const washReadings = washIn?.readings ?? [];
        const dryReadings = dryIn?.readings ?? [];

        return [
          String(idx + 1),
          c.filterName ?? '-',
          attrs.filterSize ?? '-',
          getReading(washReadings, 'air pressure'),
          getReading(washReadings, 'ro water'),
          washIn ? formatDateTime(washIn.time) : '-',
          washOut ? formatDateTime(washOut.time) : '-',
          washIn?.performedBy ?? washOut?.performedBy ?? '-',
          getReading(dryReadings, 'dryer') !== '-' ? getReading(dryReadings, 'dryer') : getReading(dryReadings, 'temperature'),
          dryIn ? formatDateTime(dryIn.time) : '-',
          dryOut ? formatDateTime(dryOut.time) : '-',
          dryIn?.performedBy ?? dryOut?.performedBy ?? '-',
          c.status,
        ];
      });

      autoTable(doc, {
        startY: 32,
        head: [['S.No', 'Filter ID', 'Size', 'Air Press.', 'RO Water', 'Wash In', 'Wash Out', 'Wash By', 'Dryer Temp', 'Dry In', 'Dry Out', 'Dry By', 'Status']],
        body: tableRows,
        theme: 'grid',
        styles: { fontSize: 6.5, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.2 },
        headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold', fontSize: 6 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          12: { fontStyle: 'bold' },
        },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 12) {
            const val = data.cell.raw as string;
            if (val === 'COMPLETED') data.cell.styles.textColor = [21, 128, 61];
            else if (val === 'IN_PROGRESS') data.cell.styles.textColor = [29, 78, 216];
            else if (val === 'TERMINATED') data.cell.styles.textColor = [220, 38, 38];
          }
        },
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text('DigiLog - Digital Filter Management System', 14, doc.internal.pageSize.height - 7);
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.width - 30, doc.internal.pageSize.height - 7);
      }

      // Download
      const fileName = `cleaning-cycles-${selectedFilterName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fileName);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-600 to-cyan-700 shadow-lg shadow-cyan-600/10">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Cleaning Cycles</h1>
              <p className="text-sm text-slate-400">{total} total cycles</p>
            </div>
          </div>

          {/* Download PDF */}
          <button onClick={handleDownloadPDF} disabled={downloading || cycles.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {downloading ? (
              <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
            Download PDF
          </button>
        </div>

        {/* Filters Row: Filter selector + Date range */}
        <div className="flex items-end gap-4 mb-3 flex-wrap">
          <div className="relative">
            <select
              value={selectedFilter}
              onChange={e => { setSelectedFilter(e.target.value); setPage(1); }}
              className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-700 focus:outline-none focus:border-cyan-500 min-w-[220px]"
            >
              <option value="">All Filters</option>
              {filterInstances.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {/* From Date */}
          <div>
            <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">From</label>
            <input type="datetime-local" value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(1); }}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-cyan-500" />
          </div>

          {/* To Date */}
          <div>
            <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">To</label>
            <input type="datetime-local" value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(1); }}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-cyan-500" />
          </div>

          {/* Clear All */}
          {(selectedFilter || fromDate || toDate) && (
            <button onClick={() => { setSelectedFilter(''); setFromDate(''); setToDate(''); setPage(1); }}
              className="text-xs text-cyan-600 hover:text-cyan-700 pb-2">
              Clear all
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          {[
            { key: '', label: 'All', count: total },
            { key: 'IN_PROGRESS', label: 'In Progress', count: statusCounts.IN_PROGRESS, dot: 'bg-blue-400 animate-pulse' },
            { key: 'COMPLETED', label: 'Completed', count: statusCounts.COMPLETED, dot: 'bg-green-400' },
            { key: 'TERMINATED', label: 'Terminated', count: statusCounts.TERMINATED, dot: 'bg-red-400' },
          ].map(s => (
            <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                status === s.key
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/10'
                  : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
              }`}>
              {s.dot && <span className={`w-2 h-2 rounded-full ${s.dot}`} />}
              {s.label}
              {s.count > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${status === s.key ? 'bg-white/20' : 'bg-slate-100'}`}>{s.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content — fills remaining space */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-slate-400">Loading cycles...</span>
          </div>
        ) : cycles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-16 h-16 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-slate-400 font-medium">No cleaning cycles found</span>
            <span className="text-sm text-slate-300">Cycles will appear here once filters start cleaning operations</span>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">S.No</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Filter ID</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Size (Micron)</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Air Pressure</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">RO Water</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Wash In</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Wash Out</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Wash By</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Dryer Temp</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Dry In</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Dry Out</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Dry By</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cycles.map((c, idx: number) => {
                    const attrs = filterAttrMap.get(c.filterId) ?? {};
                    const washIn = getStageInfo(c.events ?? [], 'WASH_IN');
                    const washOut = getStageInfo(c.events ?? [], 'WASH_OUT');
                    const dryIn = getStageInfo(c.events ?? [], 'DRY_IN');
                    const dryOut = getStageInfo(c.events ?? [], 'DRY_OUT');

                    // Readings from WASH_IN event (air pressure, RO water)
                    const washReadings = washIn?.readings ?? [];
                    const airPressure = getReading(washReadings, 'air pressure');
                    const roWater = getReading(washReadings, 'ro water');

                    // Reading from DRY_IN event (dryer temperature)
                    const dryReadings = dryIn?.readings ?? [];
                    const dryerTemp = getReading(dryReadings, 'dryer') !== '-' ? getReading(dryReadings, 'dryer') : getReading(dryReadings, 'temperature');

                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        {/* S.No */}
                        <td className="px-3 py-2.5 text-slate-500 font-medium">{(page - 1) * 20 + idx + 1}</td>

                        {/* Filter ID */}
                        <td className="px-3 py-2.5">
                          <div className="text-xs font-semibold text-slate-800">{c.filterName ?? '-'}</div>
                          {c.filterSet && <span className={`text-[9px] ${c.filterSet === 'SET_A' ? 'text-indigo-500' : 'text-purple-500'}`}>Set {c.filterSet.replace('SET_', '')}</span>}
                        </td>

                        {/* Filter Size */}
                        <td className="px-3 py-2.5 text-slate-600">{attrs.filterSize ?? '-'}</td>

                        {/* Air Pressure */}
                        <td className="px-3 py-2.5 text-slate-600">{airPressure}</td>

                        {/* RO Water Pressure */}
                        <td className="px-3 py-2.5 text-slate-600">{roWater}</td>

                        {/* Wash In */}
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{washIn ? formatDateTime(washIn.time) : '-'}</td>

                        {/* Wash Out */}
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{washOut ? formatDateTime(washOut.time) : '-'}</td>

                        {/* Wash Performed By */}
                        <td className="px-3 py-2.5 text-slate-600">{washIn?.performedBy ?? washOut?.performedBy ?? '-'}</td>

                        {/* Dryer Temp */}
                        <td className="px-3 py-2.5 text-slate-600">{dryerTemp}</td>

                        {/* Dry In */}
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{dryIn ? formatDateTime(dryIn.time) : '-'}</td>

                        {/* Dry Out */}
                        <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{dryOut ? formatDateTime(dryOut.time) : '-'}</td>

                        {/* Dry Performed By */}
                        <td className="px-3 py-2.5 text-slate-600">{dryIn?.performedBy ?? dryOut?.performedBy ?? '-'}</td>

                        {/* Status */}
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full whitespace-nowrap ${
                            c.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border border-green-200'
                            : c.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {c.status === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                            {c.status}
                          </span>
                        </td>

                        {/* View */}
                        <td className="px-3 py-2.5">
                          <button onClick={() => navigate(`/cleaning-cycles/${c.id}`)}
                            className="text-[10px] text-cyan-600 hover:text-cyan-700 px-2 py-1 rounded hover:bg-cyan-50 transition-colors">
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Pagination — fixed at bottom */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-slate-200 shrink-0 flex items-center justify-between">
          <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg disabled:opacity-40 text-slate-600 text-sm hover:bg-slate-100 transition-colors">
              Previous
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 bg-white border border-slate-200 rounded-lg disabled:opacity-40 text-slate-600 text-sm hover:bg-slate-100 transition-colors">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
