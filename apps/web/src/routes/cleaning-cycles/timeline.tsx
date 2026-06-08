import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { createReport } from '../../lib/pdf-report';
import { CycleDetailView } from './cycle-detail-view';
import { appendCycleDetailToReport } from './cycle-detail-pdf';

export function CleaningCycleTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatDateTime, formatDate } = useDatetimeFormat();
  // 2026-05-26 audit fix (PA-CLEANUP-1): gate PDF export on
  // REPORT_EXPORT — pre-fix any CYCLE_READ user could PDF the timeline.
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canExportPdf = isSuperAdmin || perms.includes('REPORT_EXPORT') || perms.includes('REPORT_GENERATE');
  const [downloading, setDownloading] = useState(false);
  const { data: cycle, isLoading } = useSWR(id ? `/api/filters/cycles/${id}` : null);

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">Loading cycle details...</span>
    </div>
  );
  if (!cycle) return <div className="p-6 text-slate-500">Cycle not found</div>;

  const handleExportPDF = async () => {
    setDownloading(true);
    try {
      const infoLine = [
        `Filter: ${cycle.filterName ?? '-'}`,
        cycle.ahuName ? `AHU: ${cycle.ahuName}` : '',
        cycle.filterSet ? `Set ${cycle.filterSet.replace('SET_', '')}` : '',
        `Status: ${cycle.status}`,
      ].filter(Boolean).join('  |  ');

      const report = await createReport({
        title: 'Cleaning Cycle Detail',
        subtitle: infoLine,
        orientation: 'portrait',
        formatDateTime,
      });
      appendCycleDetailToReport(report, cycle, { formatDateTime });
      report.save(`cycle-${cycle.filterName ?? 'filter'}-${formatDate(cycle.startedAt)}.pdf`);
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
          <button onClick={handleExportPDF} disabled={downloading || !canExportPdf}
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
        </div>
      </div>

      {/* Detail body */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <CycleDetailView cycle={cycle} />
      </div>
    </div>
  );
}
