import { useState } from 'react';
import useSWR from 'swr';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { createReport } from '../../lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { logReportExportOrWarn } from '@/lib/report-export-log';
import { useExportLimit } from '@/hooks/use-export-limit';
import { ExportMenu } from '@/components/ExportMenu';
import { SendForReviewButton } from '@/components/SendForReviewButton';
import { api } from '../../lib/api-client';
import { ReportPageWrapper } from '@/components/report-page-wrapper';
import { useReportLabels } from '../../hooks/use-report-labels';
import { useToast } from '@/hooks/use-toast';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { Pagination } from '@/components/ui/pagination';
import { usePaginationDefaults } from '@/hooks/use-pagination-config';
import { downloadName } from '@/lib/download-name';

const QNN_COLS = ['sNo', 'qnn', 'action', 'ahu', 'message', 'by', 'dateTime'];

type QnnRow = {
  id: string;
  qnn: string;
  action: string;
  ahuName: string | null;
  message: string | null;
  performedByName: string | null;
  createdAt: string;
};
type Resp = { data: QnnRow[]; total: number; page: number; limit: number; totalPages: number };


export function QualityNotificationsPage() {
  const { formatDateTime } = useDatetimeFormat();
  const { toast } = useToast();
  const exportLimit = useExportLimit();
  const { labelsFor } = useReportLabels();
  const L = labelsFor('quality-notifications');
  const headLabels = QNN_COLS.map((k) => L.columns[k]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  // 2026-09-02: page size now comes from the app-wide Pagination Settings
  // config, like every other paged list, instead of a hard-coded 50.
  const { options: paginationOptions, defaultLimit } = usePaginationDefaults();
  const [perPage, setPerPage] = useState(defaultLimit);
  const [downloading, setDownloading] = useState(false);
  const { data: vis } = useSWR<{ visible: boolean }>('/api/pm-schedules/qnn/visible');

  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  const buildQs = (limit: number, pg: number) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', `${to}T23:59:59`);
    qs.set('page', String(pg));
    qs.set('limit', String(limit));
    return qs.toString();
  };

  const { data, isLoading } = useSWR<Resp>(`/api/pm-schedules/qnn?${buildQs(perPage, page)}`);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const buildExport = async (): Promise<{ body: string[][]; period: string; total: number }> => {
    const all = await api.get<Resp>(`/api/pm-schedules/qnn?${buildQs(500, 1)}`);
    const period = from || to
      ? `${from ? formatDateTime(from) : 'Start'} to ${to ? formatDateTime(`${to}T23:59:59`) : 'Now'}`
      : 'All Time';
    const body = all.data.map((r, i) => [
      String(i + 1), r.qnn, r.action, r.ahuName ?? '-', r.message ?? '-',
      r.performedByName ?? '-', formatDateTime(r.createdAt),
    ]);
    return { body, period, total: all.total };
  };

  const buildQnnReport = async () => {
    const r = await buildExport();
    if (r.body.length > exportLimit.maxRecords) { toast.error('Export too large', exportLimit.tooLargeMessage(r.body.length)); return null; }
    const report = await createReport({ reportKey: 'quality-notifications',
      title: L.title,
      subtitle: L.subtitle || `Period: ${r.period}  |  Total: ${r.total} notification(s)`,
      // 2026-09-02 (operator request): matched to the RFID Track Record report —
      // A4 portrait at 9pt. The shared builder already gives every report the
      // thicker grid, unsplit rows, bold Printed By and centred page number.
      orientation: 'portrait',
      formatDateTime,
    });
    // Portrait gives 181mm of usable width; 7 columns spend 35mm of it on
    // horizontal padding. The six fixed-content columns below were sized to
    // their own longest value at 9pt, and the remainder went to Message, which
    // is free text and the right column to absorb the wrapping.
    report.addTable({
      head: headLabels,
      body: r.body,
      fontSize: 9,
      columnStyles: {
        0: { halign: 'center', cellWidth: 13 },  // S.No
        1: { cellWidth: 34 },                    // QNN — "QN-2026-000131"
        2: { cellWidth: 22 },                    // Action — APPROVE / REVIEW
        3: { cellWidth: 20 },                    // AHU
        // 39, not 40: these seven columns totalled 181mm against the 180mm a
        // portrait page actually gives (addTable passes no `margin`, so
        // autoTable's default applies and 181 reports "0.78 units width could
        // not fit page"). The millimetre comes off the free-text column, which
        // wraps anyway. 2026-09-03.
        4: { cellWidth: 39 },                    // Message — free text, wraps
        5: { cellWidth: 20 },                    // By
        6: { cellWidth: 32 },                    // Date & Time — "8/10/2026 17:43"
      },
    });
    return { report, count: r.body.length };
  };

  const exportPdf = async () => {
    setDownloading(true);
    try {
      const built = await buildQnnReport();
      if (!built) return;
      await logReportExportOrWarn({ reportType: 'Quality Notifications', format: 'PDF', recordCount: built.count }, toast.warning);
      built.report.save(`${downloadName('quality-notifications')}.pdf`);
    } finally { setDownloading(false); }
  };

  const buildQnnSnapshot = async () => { const b = await buildQnnReport(); return b ? b.report.getSnapshot() : null; };

  const exportExcel = async () => {
    setDownloading(true);
    try {
      const r = await buildExport();
      if (r.body.length > exportLimit.maxRecords) { toast.error('Export too large', exportLimit.tooLargeMessage(r.body.length)); return; }
      await logReportExportOrWarn({ reportType: 'Quality Notifications', format: 'Excel', recordCount: r.body.length }, toast.warning);
      exportToExcel({ filename: `quality-notifications-${new Date().toISOString().slice(0, 10)}`, sheetName: 'QNN', head: headLabels, rows: r.body });
    } finally { setDownloading(false); }
  };

  const inputCls = 'px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500';

  if (vis && !vis.visible) {
    return (
      <div className="flex items-center justify-center py-20 text-center">
        <div className="max-w-sm space-y-2">
          <h2 className="text-lg font-semibold text-slate-800">Access Denied</h2>
          <p className="text-sm text-slate-500">You don't have permission to view Quality Notifications.</p>
        </div>
      </div>
    );
  }

  // 2026-09-02 (operator request): report FOOTER dropped — its identity line
  // (logo + company + application name) and its record-count / "Page X of Y"
  // row both sat directly above this page's own pagination, which states the
  // same numbers. Matches the Audit Trail page. On-screen chrome only; exports
  // build their own.
  return (
    <ReportPageWrapper title={L.title} totalRecords={total} page={page} totalPages={data?.totalPages ?? 1} hideFooter>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-800">{L.title}</h1>
              <p className="text-[13px] text-slate-500">{L.subtitle || 'Quality Notifications (QNN) minted by the PM approval workflow'}</p>
            </div>
            {total > 0 && (
              <>
                <ExportMenu surface="qnn" onExportPdf={exportPdf} onExportExcel={exportExcel} busy={downloading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors disabled:opacity-50" />
                <SendForReviewButton buildSnapshot={buildQnnSnapshot}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50" />
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <DateRangeFilter
              size="sm"
              from={from}
              to={to}
              onFromChange={reset(setFrom)}
              onToChange={reset(setTo)}
              fromAriaLabel="Quality notifications from date"
              toAriaLabel="Quality notifications to date"
            />
          </div>
        </div>
  
        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="text-center text-slate-400 py-12">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-400 py-12">No Quality Notifications found for these filters.</div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {headLabels.map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-cyan-50/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-slate-400 font-medium text-center tabular-nums">{(page - 1) * perPage + idx + 1}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 font-mono whitespace-nowrap">{r.qnn}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">{r.action}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{r.ahuName ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 max-w-[360px]">{r.message ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{r.performedByName ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 2026-09-02: was a hand-rolled Previous/Next bar — no page numbers, no
            rows-per-page, and a fixed page size of 50. Replaced with the shared
            control, whose own docblock calls it the "canonical app-wide
            pagination control. ONE style everywhere"; this page had drifted from
            it. Same component and props the Audit Trail page uses. */}
        {total > 0 && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white shrink-0">
            <Pagination
              page={page}
              pageSize={perPage}
              totalItems={total}
              onPageChange={setPage}
              onPageSizeChange={setPerPage}
              pageSizeOptions={paginationOptions}
            />
          </div>
        )}
      </div>
    </ReportPageWrapper>
  );
}
