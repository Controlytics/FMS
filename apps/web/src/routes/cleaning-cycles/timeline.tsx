import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';

const EVENT_COLORS: Record<string, string> = {
  CYCLE_STARTED: 'border-cyan-500 bg-cyan-900/30',
  STATE_TRANSITION: 'border-blue-500 bg-blue-900/30',
  PARAMETER_CAPTURE: 'border-purple-500 bg-purple-900/30',
  CHECKLIST_COMPLETED: 'border-green-500 bg-green-900/30',
  BYPASS_DEVIATION: 'border-red-500 bg-red-900/30',
  EQUIPMENT_LINKED: 'border-amber-500 bg-amber-900/30',
  REMARK_ADDED: 'border-gray-500 bg-gray-900/30',
  APPROVAL_GRANTED: 'border-emerald-500 bg-emerald-900/30',
  CYCLE_COMPLETED: 'border-green-500 bg-green-900/30',
};

const STAGE_LABELS: Record<string, string> = {
  WASH_IN: 'Wash In', WASH_OUT: 'Wash Out', DRY_IN: 'Dry In', DRY_OUT: 'Dry Out',
  STORAGE_IN: 'Storage In', STORAGE_OUT: 'Storage Out', TO_BE_CLEANED: 'To Be Cleaned', READY_FOR_USE: 'Ready For Use',
};

export function CleaningCycleTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: cycle, isLoading } = useSWR(id ? `/api/filter/cycles/${id}` : null);

  if (isLoading) return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!cycle) return <div className="p-6 text-gray-400">Cycle not found</div>;

  const duration = cycle.completedAt
    ? Math.round((new Date(cycle.completedAt).getTime() - new Date(cycle.startedAt).getTime()) / 60000)
    : Math.round((Date.now() - new Date(cycle.startedAt).getTime()) / 60000);

  const durationStr = duration < 60 ? `${duration} min` : `${Math.floor(duration / 60)}h ${duration % 60}m`;

  return (
    <div className="p-6 space-y-6">
      {/* Back button */}
      <button onClick={() => navigate('/cleaning-cycles')} className="text-gray-400 hover:text-gray-200 text-sm flex items-center gap-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        Back to History
      </button>

      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-gray-100 font-mono">{cycle.cycleCode}</h1>
            {cycle.filterName && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-gray-300 font-medium">{cycle.filterName}</span>
                {cycle.filterSet && (
                  <span className={`px-2 py-0.5 text-[10px] rounded-full ${cycle.filterSet === 'SET_A' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-purple-900/60 text-purple-300'}`}>
                    Set {cycle.filterSet.replace('SET_', '')}
                  </span>
                )}
              </div>
            )}
          </div>
          <span className={`px-3 py-1 text-sm rounded-full font-medium ${cycle.status === 'COMPLETED' ? 'bg-green-900 text-green-300' : cycle.status === 'IN_PROGRESS' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'}`}>
            {cycle.status}
          </span>
        </div>
        <div className="flex gap-6 text-sm text-gray-400 flex-wrap">
          <span>Reason: <span className="text-gray-200">{cycle.cleaningReasonLabel}</span></span>
          <span>Duration: <span className="text-gray-200">{durationStr}</span></span>
          <span>Sequence: <span className="text-gray-200">#{cycle.sequenceNumber}</span></span>
          <span>Events: <span className="text-gray-200">{cycle.events?.length ?? 0}</span></span>
          <span>Started: <span className="text-gray-200">{new Date(cycle.startedAt).toLocaleString()}</span></span>
          {cycle.completedAt && <span>Completed: <span className="text-gray-200">{new Date(cycle.completedAt).toLocaleString()}</span></span>}
        </div>
        {cycle.cleaningJustification && (
          <div className="mt-3 px-3 py-2 bg-gray-900/50 rounded-lg text-sm text-gray-400 italic">{cycle.cleaningJustification}</div>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {(cycle.events ?? []).map((event: any, i: number) => (
          <div key={event.id} className="flex gap-4">
            {/* Timeline line */}
            <div className="flex flex-col items-center">
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${event.eventType === 'BYPASS_DEVIATION' ? 'border-red-500 bg-red-500' : event.eventType === 'CYCLE_COMPLETED' ? 'border-green-500 bg-green-500' : event.eventType === 'CYCLE_STARTED' ? 'border-cyan-500 bg-cyan-500' : 'border-blue-500 bg-blue-500'}`} />
              {i < (cycle.events?.length ?? 0) - 1 && <div className="w-0.5 flex-1 bg-gray-700 min-h-[40px]" />}
            </div>

            {/* Event card */}
            <div className={`flex-1 mb-4 rounded-lg border-l-4 p-4 ${EVENT_COLORS[event.eventType] ?? 'border-gray-500 bg-gray-900/30'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-100">{event.eventType.replace(/_/g, ' ')}</span>
                  {event.performedByName && <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">by {event.performedByName}</span>}
                </div>
                <span className="text-xs text-gray-500">{new Date(event.performedAt).toLocaleString()}</span>
              </div>
              {(event.fromState || event.toState) && (
                <div className="text-sm text-gray-300 mb-1">
                  {event.fromState && <span className="text-gray-500">{STAGE_LABELS[event.fromState] ?? event.fromState.replace(/_/g, ' ')}</span>}
                  {event.fromState && event.toState && <span className="text-gray-600 mx-2">&rarr;</span>}
                  {event.toState && <span className="text-cyan-400 font-medium">{STAGE_LABELS[event.toState] ?? event.toState.replace(/_/g, ' ')}</span>}
                </div>
              )}
              {event.remarks && <div className="text-sm text-gray-400 italic mt-1">{event.remarks}</div>}
              {event.deviationDetails && (
                <div className="mt-2 px-3 py-2 bg-red-900/30 rounded text-sm text-red-300">
                  Deviation: {(event.deviationDetails as any).justification}
                </div>
              )}
              {event.attributes && Object.keys(event.attributes).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(event.attributes).map(([k, v]: [string, any]) => (
                    <span key={k} className="px-2 py-0.5 text-xs bg-gray-700 rounded text-gray-300">
                      {k}: {typeof v === 'object' ? `${v.value} ${v.unit ?? ''}` : String(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
