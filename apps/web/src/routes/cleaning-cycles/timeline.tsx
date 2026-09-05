import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { createReport } from '../../lib/pdf-report';
import { CycleDetailView } from './cycle-detail-view';
import { appendCycleDetailToReport } from './cycle-detail-pdf';
import { exportToExcel } from '@/lib/excel-export';
import { ExportMenu } from '@/components/ExportMenu';
import { SendForReviewButton } from '@/components/SendForReviewButton';
import { effectiveCycleStatus, performerLabel, transitionEndpoints, phaseSuffix } from '../../lib/cleaning-cycle-report';
import { logReportExportOrWarn } from '@/lib/report-export-log';
import { useToast } from '@/hooks/use-toast';
import { downloadName } from '@/lib/download-name';
import { PencilIcon } from '@/components/super-admin-record-edit';
import { SuperAdminCycleEditDialog } from '@/components/super-admin-cycle-edit';

export function CleaningCycleTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { formatDateTime, formatDate } = useDatetimeFormat();
  // 2026-05-26 audit fix (PA-CLEANUP-1): gate PDF export on
  // REPORT_EXPORT — pre-fix any CYCLE_READ user could PDF the timeline.
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canExportPdf = isSuperAdmin || perms.includes('REPORT_EXPORT') || perms.includes('REPORT_GENERATE');
  const [downloading, setDownloading] = useState(false);
  const [saEdit, setSaEdit] = useState(false);
  const { data: cycle, isLoading } = useSWR(id ? `/api/filters/cycles/${id}` : null);

  // A cycle ended by retire/replace writes NO CYCLE_TERMINATED event — the
  // operator is on the FILTER_RETIRED / FILTER_REPLACED audit instead — so
  // without these the detail can only say "Terminated by —" for exactly the
  // cycles whose ending was most deliberate.
  //
  // Fetched only for those cycles (both lists are whole-table reads, and 19 of
  // 672 live cycles need them), and fetched HERE rather than resolved on
  // /api/filters/cycles/:id because /api/filters/replacements hides
  // SUPER_ADMIN-performed rows from lower roles — resolving it server-side on
  // the cycle would quietly bypass that rule. SWR shares the keys with the
  // Filter Lifecycle Report, so a user coming from that page pays nothing.
  const eff = cycle ? effectiveCycleStatus(cycle) : null;
  const needsAuditPerformer = eff === 'RETIRED' || eff === 'REPLACED';
  const { data: retirementsData } = useSWR<any[]>(needsAuditPerformer ? '/api/filters/retirements' : null);
  const { data: replacementsData } = useSWR<any[]>(needsAuditPerformer ? '/api/filters/replacements' : null);
  const fallback = useMemo(() => ({
    replacedBy: (replacementsData ?? []).find((r) => r.oldFilterId === cycle?.filterId)?.performedBy ?? null,
    retiredBy: (retirementsData ?? []).find((r) => r.id === cycle?.filterId)?.retiredBy ?? null,
  }), [replacementsData, retirementsData, cycle?.filterId]);

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">Loading cycle details...</span>
    </div>
  );
  if (!cycle) return <div className="p-6 text-slate-500">Cycle not found</div>;

  const buildCycleReport = async () => {
    const infoLine = [
      `Filter: ${cycle.filterName ?? '-'}`,
      cycle.ahuName ? `AHU: ${cycle.ahuName}` : '',
      cycle.filterSet ? `Set ${cycle.filterSet.replace('SET_', '')}` : '',
      `Status: ${effectiveCycleStatus(cycle)}`,
    ].filter(Boolean).join('  |  ');
    const report = await createReport({ reportKey: 'cleaning-cycle-detail',
      title: 'Cleaning Cycle Detail',
      subtitle: infoLine,
      orientation: 'portrait',
      formatDateTime,
      legend: [{ abbr: 'S.No', meaning: 'Serial Number' }],
    });
    appendCycleDetailToReport(report, cycle, { formatDateTime, fallback });
    return report;
  };

  const handleExportPDF = async () => {
    setDownloading(true);
    try {
      const report = await buildCycleReport();
      await logReportExportOrWarn({ reportType: 'Cleaning Cycle Detail', format: 'PDF', recordCount: cycle.events?.length ?? 0 }, toast.warning);
      report.save(`${downloadName('cycle', cycle.filterName ?? 'filter', formatDate(cycle.startedAt))}.pdf`);
    } finally { setDownloading(false); }
  };

  const buildCycleSnapshot = async () => (await buildCycleReport()).getSnapshot();

  // Excel = the cycle's event timeline as a flat sheet (genesis "from" shown as
  // "To Be Cleaned", matching the PDF).
  const exportExcel = async () => {
    setDownloading(true);
    try {
      const events = cycle.events ?? [];
      const head = ['S.No', 'Event', 'From', 'To', 'Performed By', 'Time', 'Remarks'];
      const rows = events.map((e: any, i: number) => {
        // Same DRY_IN rule as the PDF and the screen — one helper, three surfaces.
        const { from, to, phase } = transitionEndpoints(e);
        return [
        String(i + 1),
        e.eventType?.replace(/_/g, ' ') ?? '-',
        from ? from.replace(/_/g, ' ') : (e.eventType === 'STATE_TRANSITION' && to ? 'To Be Cleaned' : '-'),
        to ? `${to.replace(/_/g, ' ')}${phaseSuffix(phase)}` : '-',
        performerLabel(e),
        formatDateTime(e.performedAt),
        e.remarks ?? '-',
        ];
      });
      await logReportExportOrWarn({ reportType: 'Cleaning Cycle Detail', format: 'Excel', recordCount: rows.length }, toast.warning);
      exportToExcel({ filename: `cycle-${cycle.filterName ?? 'filter'}-${formatDate(cycle.startedAt)}`, sheetName: 'Cycle Detail', head, rows });
    } finally { setDownloading(false); }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header (back + export) — page-level chrome stays here; the per-cycle
          detail body is the shared <CycleDetailView>. */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/cleaning-cycles')} className="text-slate-500 hover:text-slate-700 text-sm flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to History
          </button>
          {(canExportPdf || isSuperAdmin) && (
            <div className="flex items-center gap-2">
              {isSuperAdmin && (
                <button type="button" onClick={() => setSaEdit(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-amber-300 rounded-lg text-[13px] font-medium text-amber-700 hover:bg-amber-50 shadow-sm transition-all">
                  <PencilIcon className="w-4 h-4 text-amber-600" /> Edit record
                </button>
              )}
              {canExportPdf && <ExportMenu surface="cleaning-detail" onExportPdf={handleExportPDF} onExportExcel={exportExcel} busy={downloading}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all disabled:opacity-40" />}
              {canExportPdf && <SendForReviewButton buildSnapshot={buildCycleSnapshot}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all" />}
            </div>
          )}
        </div>
      </div>

      {/* Detail body */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <CycleDetailView cycle={cycle} fallback={fallback} />
      </div>
      {saEdit && (
        <SuperAdminCycleEditDialog cycle={cycle} events={cycle.events ?? []} title={`Edit cleaning record - ${cycle.filterName ?? ''}`}
          onClose={() => setSaEdit(false)} onSaved={() => toast.success('Record updated', 'Written to the database and recorded in the audit trail')} />
      )}
    </div>
  );
}
