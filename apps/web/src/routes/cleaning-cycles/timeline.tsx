import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { createReport } from '../../lib/pdf-report';
import { formatByLeastCount } from '@/lib/format-by-least-count';

const EVENT_ICONS: Record<string, { icon: string; color: string; border: string; bg: string }> = {
  CYCLE_STARTED: { icon: '▶', color: 'text-cyan-600', border: 'border-cyan-500', bg: 'bg-cyan-50' },
  STATE_TRANSITION: { icon: '→', color: 'text-blue-600', border: 'border-blue-500', bg: 'bg-blue-50' },
  PARAMETER_CAPTURE: { icon: '📊', color: 'text-purple-600', border: 'border-purple-500', bg: 'bg-purple-50' },
  CHECKLIST_COMPLETED: { icon: '✓', color: 'text-green-600', border: 'border-green-500', bg: 'bg-green-50' },
  BYPASS_DEVIATION: { icon: '⚠', color: 'text-red-600', border: 'border-red-500', bg: 'bg-red-50' },
  EQUIPMENT_LINKED: { icon: '🔧', color: 'text-amber-600', border: 'border-amber-500', bg: 'bg-amber-50' },
  REMARK_ADDED: { icon: '💬', color: 'text-slate-500', border: 'border-slate-400', bg: 'bg-slate-50' },
  APPROVAL_GRANTED: { icon: '✅', color: 'text-emerald-600', border: 'border-emerald-500', bg: 'bg-emerald-50' },
  CYCLE_COMPLETED: { icon: '●', color: 'text-green-600', border: 'border-green-500', bg: 'bg-green-50' },
};

const STAGE_LABELS: Record<string, string> = {
  WASH_IN: 'Wash In', WASH_OUT: 'Wash Out', DRY_IN: 'Dry In', DRY_OUT: 'Dry Out',
  STORAGE_IN: 'Storage In', STORAGE_OUT: 'Storage Out', START: 'Start', END: 'End',
};

const STAGE_BADGE: Record<string, string> = {
  WASH_IN: 'bg-sky-50 text-sky-700 border-sky-200',
  WASH_OUT: 'bg-sky-50 text-sky-700 border-sky-200',
  DRY_IN: 'bg-amber-50 text-amber-700 border-amber-200',
  DRY_OUT: 'bg-amber-50 text-amber-200 border-amber-200/40',
  STORAGE_IN: 'bg-slate-100 text-slate-600 border-slate-200',
  STORAGE_OUT: 'bg-slate-100/40 text-slate-700 border-slate-200',
};

const REASON_COLORS: Record<string, string> = {
  PM: 'bg-blue-50 text-blue-700', TYPE_A: 'bg-purple-50 text-purple-700',
  TYPE_B: 'bg-indigo-50 text-indigo-700', TYPE_C: 'bg-sky-50 text-sky-700',
  ON_REQUEST: 'bg-amber-50 text-amber-700', CONTAMINATION: 'bg-red-50 text-red-700',
};

export function CleaningCycleTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatDateTime, formatDate, formatTime } = useDatetimeFormat();
  const [downloading, setDownloading] = useState(false);
  const { data: cycle, isLoading } = useSWR(id ? `/api/filters/cycles/${id}` : null);

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">Loading cycle details...</span>
    </div>
  );
  if (!cycle) return <div className="p-6 text-slate-500">Cycle not found</div>;

  const duration = cycle.completedAt
    ? Math.round((new Date(cycle.completedAt).getTime() - new Date(cycle.startedAt).getTime()) / 60000)
    : Math.round((Date.now() - new Date(cycle.startedAt).getTime()) / 60000);
  const durationStr = duration < 60 ? `${duration} min` : `${Math.floor(duration / 60)}h ${duration % 60}m`;

  const events = cycle.events ?? [];

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

      // Summary key-values
      report.addKeyValue([
        ['Cleaning Reason', cycle.cleaningReasonLabel || cycle.cleaningReasonKey || '-'],
        ['Block', cycle.cleaningAreaName ?? '-'],
        ['Duration', durationStr],
        ['Started', formatDateTime(cycle.startedAt)],
        ['Completed', cycle.completedAt ? formatDateTime(cycle.completedAt) : 'In Progress'],
        ['Events', `${events.length} event(s)`],
      ]);

      // Stage progress
      report.addSectionTitle('Stage Progress');
      const allStages = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];
      report.addTable({
        head: allStages.map(s => STAGE_LABELS[s] ?? s),
        body: [allStages.map(s => completedStages.includes(s) ? 'Done' : '-')],
        headColor: [59, 130, 246],
      });

      // Events
      report.addSectionTitle('Event Timeline');
      const eventRows: string[][] = [];
      const checklistRows: { eventIdx: number; qa: { question: string; answer: any }[] }[] = [];

      events.forEach((ev: any, idx: number) => {
        const attrs = ev.attributes ?? {};
        const readings: any[] = attrs.instrumentReadings ?? [];
        const readingsStr = readings.map((r: any) => {
          const val = r.leastCount !== undefined && r.leastCount !== null ? formatByLeastCount(r.value, r.leastCount) : String(r.value);
          return `${r.description ?? ''}: ${val} ${r.uom ?? ''}`;
        }).join(', ');
        eventRows.push([
          String(idx + 1),
          ev.eventType.replace(/_/g, ' '),
          ev.fromState ? (STAGE_LABELS[ev.fromState] ?? ev.fromState) : '-',
          ev.toState ? (STAGE_LABELS[ev.toState] ?? ev.toState) : '-',
          ev.performedByName ?? '-',
          formatDateTime(ev.performedAt),
          readingsStr || ev.remarks || '-',
        ]);
        if (ev.enrichedAnswers?.length > 0) {
          checklistRows.push({ eventIdx: idx + 1, qa: ev.enrichedAnswers });
        }
      });

      report.addTable({
        head: ['#', 'Event', 'From', 'To', 'Performed By', 'Time', 'Details'],
        body: eventRows,
        columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 6: { cellWidth: 50 } },
      });

      // Checklist answers
      for (const cl of checklistRows) {
        report.addSectionTitle(`Checklist Responses (Event #${cl.eventIdx})`);
        const qaRows = cl.qa.map((qa, i) => [
          String(i + 1),
          qa.question,
          typeof qa.answer === 'boolean' ? (qa.answer ? 'Yes' : 'No') : String(qa.answer),
        ]);
        report.addTable({
          head: ['#', 'Question', 'Answer'],
          body: qaRows,
          headColor: [21, 128, 61],
          columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 30 } },
        });
      }

      report.save(`cycle-${cycle.filterName ?? 'filter'}-${formatDate(cycle.startedAt)}.pdf`);
    } finally { setDownloading(false); }
  };

  // Extract stage progress
  const completedStages = events
    .filter((e: any) => e.eventType === 'STATE_TRANSITION' && e.toState)
    .map((e: any) => e.toState);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/cleaning-cycles')} className="text-slate-500 hover:text-slate-700 text-sm flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to History
          </button>
          <button onClick={handleExportPDF} disabled={downloading}
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

        {/* Cycle Info Card */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-slate-800">{cycle.filterName ?? 'Filter'}</h1>
                  {cycle.ahuName && (
                    <span className="px-2 py-0.5 text-[11px] rounded-full font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      AHU: {cycle.ahuName}
                    </span>
                  )}
                  {cycle.filterSet && (
                    <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${cycle.filterSet === 'SET_A' ? 'bg-indigo-50 text-indigo-700' : 'bg-purple-50 text-purple-700'}`}>
                      Set {cycle.filterSet.replace('SET_', '')}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full ${
                    cycle.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border border-green-200'
                    : cycle.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {cycle.status === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                    {cycle.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-slate-50/50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Cleaning Reason</div>
                <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${REASON_COLORS[cycle.cleaningReasonKey] ?? 'bg-slate-100 text-slate-600'}`}>
                  {cycle.cleaningReasonLabel || cycle.cleaningReasonKey || '—'}
                </span>
              </div>
              <div className="bg-slate-50/50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Block</div>
                <div className="text-sm text-slate-700 font-medium">{cycle.cleaningAreaName ?? '—'}</div>
              </div>
              <div className="bg-slate-50/50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Duration</div>
                <div className="text-sm text-slate-700 font-medium">{durationStr}</div>
              </div>
              <div className="bg-slate-50/50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Started</div>
                <div className="text-sm text-slate-700">{formatDateTime(cycle.startedAt)}</div>
              </div>
              <div className="bg-slate-50/50 rounded-lg px-3 py-2.5">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">{cycle.completedAt ? 'Completed' : 'Events'}</div>
                <div className="text-sm text-slate-700">{cycle.completedAt ? formatDateTime(cycle.completedAt) : `${events.length} events`}</div>
              </div>
            </div>

            {cycle.cleaningJustification && (
              <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 italic">
                {cycle.cleaningJustification}
              </div>
            )}

            {/* CHVH (2026-05-02): pinned versions linkage. Each chip deep-links
                to the Version History page focused on the entity + version this
                cycle was pinned to at start, so an auditor can see the exact
                rules in effect when the cycle ran. */}
            {(cycle.profileVersion !== undefined || cycle.equipmentGroupVersionPin || (cycle.checklistVersionPins && Object.keys(cycle.checklistVersionPins ?? {}).length > 0)) && (
              <div className="mt-3 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div className="text-[10px] text-indigo-700 uppercase tracking-wider mb-1.5 font-semibold">Pinned Versions (audit replay)</div>
                <div className="flex flex-wrap gap-2 items-center">
                  {cycle.profileVersion !== undefined && (
                    <button
                      onClick={() => navigate(`/version-history?entity=cleaning-profile&id=${cycle.profileId}&v=${cycle.profileVersion}`)}
                      className="text-xs px-2 py-1 bg-white border border-indigo-300 hover:border-indigo-500 hover:bg-indigo-50 rounded-md font-medium text-indigo-800 transition-colors"
                      title="Cleaning pipeline pinned at cycle start"
                    >
                      Pipeline v{cycle.profileVersion}
                    </button>
                  )}
                  {cycle.equipmentGroupVersionPin !== undefined && cycle.equipmentGroupVersionPin !== null && cycle.equipmentGroupId && (
                    <button
                      onClick={() => navigate(`/version-history?entity=equipment-group&id=${cycle.equipmentGroupId}&v=${cycle.equipmentGroupVersionPin}`)}
                      className="text-xs px-2 py-1 bg-white border border-indigo-300 hover:border-indigo-500 hover:bg-indigo-50 rounded-md font-medium text-indigo-800 transition-colors"
                      title="Equipment group ranges pinned at cycle start (P1)"
                    >
                      Equipment v{cycle.equipmentGroupVersionPin}
                    </button>
                  )}
                  {cycle.checklistVersionPins && Object.entries(cycle.checklistVersionPins).map(([profileId, version]) => (
                    <button
                      key={profileId}
                      onClick={() => navigate(`/version-history?entity=checklist-profile&id=${profileId}&v=${version}`)}
                      className="text-xs px-2 py-1 bg-white border border-indigo-300 hover:border-indigo-500 hover:bg-indigo-50 rounded-md font-medium text-indigo-800 transition-colors"
                      title={`Checklist profile ${(profileId as string).slice(0, 8)}… pinned at cycle start`}
                    >
                      Checklist v{String(version)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Stage Progress Bar */}
          <div className="border-t border-slate-200 px-5 py-3 bg-slate-50">
            <div className="flex items-center gap-2">
              {['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'].map((stage, i) => {
                const done = completedStages.includes(stage);
                const isCurrent = !done && completedStages.length > 0 && i === completedStages.length;
                return (
                  <div key={stage} className="flex items-center gap-2 flex-1">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium flex-1 justify-center transition-all ${
                      done ? (STAGE_BADGE[stage] ?? 'bg-slate-100 text-slate-600') + ' border'
                      : isCurrent ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse'
                      : 'bg-slate-50 text-slate-300 border border-slate-200'
                    }`}>
                      {done && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      {STAGE_LABELS[stage]}
                    </div>
                    {i < 5 && <div className={`w-3 h-0.5 shrink-0 ${done ? 'bg-slate-200' : 'bg-white'}`} />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline — scrollable */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-0">
          {events.map((event: any, i: number) => {
            const style = EVENT_ICONS[event.eventType] ?? EVENT_ICONS.REMARK_ADDED;
            const attrs = event.attributes ?? {};
            const instrumentReadings: any[] = attrs.instrumentReadings ?? [];
            const hasReadings = instrumentReadings.length > 0;

            // Filter out internal keys from attributes display
            const displayAttrs = Object.entries(attrs).filter(
              ([k]) => !['cleaningReasonKey', 'cleaningReasonLabel', 'instrumentReadings', 'sequenceNumber', 'answers', 'afterStage'].includes(k)
            );
            const enrichedAnswers: { questionId: string; question: string; answer: any }[] = event.enrichedAnswers ?? [];

            return (
              <div key={event.id} className="flex gap-4">
                {/* Timeline connector */}
                <div className="flex flex-col items-center w-5 shrink-0">
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 ${
                    event.eventType === 'CYCLE_STARTED' ? 'border-cyan-500 bg-cyan-500 shadow-sm shadow-cyan-500/30'
                    : event.eventType === 'CYCLE_COMPLETED' ? 'border-green-500 bg-green-500 shadow-sm shadow-green-500/30'
                    : event.eventType === 'BYPASS_DEVIATION' ? 'border-red-500 bg-red-500 shadow-sm shadow-red-500/30'
                    : i === events.length - 1 && cycle.status === 'IN_PROGRESS' ? 'border-blue-400 bg-blue-400 animate-pulse shadow-sm shadow-blue-500/30'
                    : 'border-blue-500 bg-blue-500'
                  }`} />
                  {i < events.length - 1 && <div className="w-0.5 flex-1 bg-slate-100/80 min-h-[24px]" />}
                </div>

                {/* Event Card */}
                <div className={`flex-1 mb-4 rounded-xl border-l-4 p-4 ${style.border} ${style.bg}`}>
                  {/* Event Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">
                        {event.eventType.replace(/_/g, ' ')}
                      </span>
                      {event.performedByName && (
                        <span className="text-[11px] text-slate-400 bg-white px-2 py-0.5 rounded-full">
                          by {event.performedByName}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 tabular-nums">{formatDateTime(event.performedAt)}</span>
                  </div>

                  {/* State Transition */}
                  {(event.fromState || event.toState) && (
                    <div className="flex items-center gap-2 mb-2">
                      {event.fromState && (
                        <span className="px-2 py-0.5 text-xs rounded-md bg-white text-slate-500">
                          {STAGE_LABELS[event.fromState] ?? event.fromState.replace(/_/g, ' ')}
                        </span>
                      )}
                      {event.fromState && event.toState && (
                        <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      )}
                      {event.toState && (
                        <span className={`px-2.5 py-0.5 text-xs font-medium rounded-md border ${STAGE_BADGE[event.toState] ?? 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                          {STAGE_LABELS[event.toState] ?? event.toState.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Cleaning Reason (for CYCLE_STARTED) */}
                  {event.eventType === 'CYCLE_STARTED' && (attrs.cleaningReasonKey || cycle.cleaningReasonKey) && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-slate-400">Reason:</span>
                      <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${
                        REASON_COLORS[attrs.cleaningReasonKey ?? cycle.cleaningReasonKey] ?? 'bg-slate-100 text-slate-600'
                      }`}>
                        {attrs.cleaningReasonLabel ?? cycle.cleaningReasonLabel ?? attrs.cleaningReasonKey ?? cycle.cleaningReasonKey}
                      </span>
                    </div>
                  )}

                  {/* Instrument Readings */}
                  {hasReadings && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">Instrument Readings</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {instrumentReadings.map((reading: any, ri: number) => (
                          <div key={ri} className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                            <div className="text-[11px] text-slate-400 mb-1">{reading.description || reading.instrumentCode || `Instrument ${ri + 1}`}</div>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-lg font-bold text-slate-800 tabular-nums">{reading.leastCount !== undefined && reading.leastCount !== null ? formatByLeastCount(reading.value, reading.leastCount) : reading.value}</span>
                              <span className="text-xs text-slate-500">{reading.uom || reading.unit || ''}</span>
                            </div>
                            {reading.instrumentCode && reading.description && (
                              <div className="text-[10px] text-slate-300 mt-0.5 font-mono">{reading.instrumentCode}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Checklist Answers */}
                  {enrichedAnswers.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">Checklist Responses</div>
                      <div className="space-y-1.5">
                        {enrichedAnswers.map((qa, qi) => (
                          <div key={qa.questionId} className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 flex items-start gap-3">
                            <span className="text-[11px] text-slate-400 font-medium mt-0.5 shrink-0">{qi + 1}.</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] text-slate-700">{qa.question}</div>
                              <div className="text-[13px] font-semibold text-slate-900 mt-0.5">
                                {typeof qa.answer === 'boolean' ? (qa.answer ? 'Yes' : 'No') : String(qa.answer)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deviation Details */}
                  {event.deviationDetails && (
                    <div className="mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      Deviation: {(event.deviationDetails as any).justification || JSON.stringify(event.deviationDetails)}
                    </div>
                  )}

                  {/* Remarks */}
                  {event.remarks && (
                    <div className="text-sm text-slate-500 italic mt-2">{event.remarks}</div>
                  )}

                  {/* Other Attributes */}
                  {displayAttrs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {displayAttrs.map(([k, v]: [string, any]) => (
                        <span key={k} className="px-2 py-0.5 text-[11px] bg-white border border-slate-200 rounded-md text-slate-500">
                          {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
