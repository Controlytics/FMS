import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';

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

  // Extract stage progress
  const completedStages = events
    .filter((e: any) => e.eventType === 'STATE_TRANSITION' && e.toState)
    .map((e: any) => e.toState);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0 space-y-4">
        <button onClick={() => navigate('/cleaning-cycles')} className="text-slate-500 hover:text-slate-700 text-sm flex items-center gap-1.5 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to History
        </button>

        {/* Cycle Info Card */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-slate-800 font-mono">{cycle.cycleCode}</h1>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full ${
                    cycle.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border border-green-200'
                    : cycle.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {cycle.status === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                    {cycle.status}
                  </span>
                </div>
                {cycle.filterName && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-sm text-slate-600 font-medium">{cycle.filterName}</span>
                    {cycle.filterSet && (
                      <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${cycle.filterSet === 'SET_A' ? 'bg-indigo-50 text-indigo-700' : 'bg-purple-50 text-purple-700'}`}>
                        Set {cycle.filterSet.replace('SET_', '')}
                      </span>
                    )}
                  </div>
                )}
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
              ([k]) => !['cleaningReasonKey', 'cleaningReasonLabel', 'instrumentReadings', 'sequenceNumber'].includes(k)
            );

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
                              <span className="text-lg font-bold text-slate-800 tabular-nums">{reading.value}</span>
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
