import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

const REASON_COLORS: Record<string, string> = {
  PM: 'bg-blue-900 text-blue-300', TYPE_A: 'bg-purple-900 text-purple-300', TYPE_B: 'bg-indigo-900 text-indigo-300',
  TYPE_C: 'bg-sky-900 text-sky-300', ON_REQUEST: 'bg-amber-900 text-amber-300', CONTAMINATION: 'bg-red-900 text-red-300',
  FAILURE: 'bg-red-900 text-red-300', CUSTOM: 'bg-gray-700 text-gray-300',
};

const STAGE_LABELS: Record<string, string> = {
  WASH_IN: 'Wash In', WASH_OUT: 'Wash Out', DRY_IN: 'Dry In', DRY_OUT: 'Dry Out',
  STORAGE_IN: 'Storage In', STORAGE_OUT: 'Storage Out', TO_BE_CLEANED: 'To Be Cleaned', READY_FOR_USE: 'Ready For Use',
};

const STAGE_COLORS: Record<string, string> = {
  WASH_IN: 'text-sky-400', WASH_OUT: 'text-sky-300', DRY_IN: 'text-amber-400', DRY_OUT: 'text-amber-300',
  STORAGE_IN: 'text-gray-300', STORAGE_OUT: 'text-gray-200', TO_BE_CLEANED: 'text-orange-400', READY_FOR_USE: 'text-green-400',
};

export function CleaningCycleHistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
  const { data, isLoading } = useSWR(`/api/filter/cycles?page=${page}&limit=20&includeEvents=true${status ? `&status=${status}` : ''}`);

  const getStageEvents = (events: any[]) => {
    return (events ?? []).filter((e: any) => e.eventType === 'STATE_TRANSITION');
  };

  const getDuration = (cycle: any) => {
    if (!cycle.completedAt) return null;
    const ms = new Date(cycle.completedAt).getTime() - new Date(cycle.startedAt).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">Cleaning Cycle History</h1>

      <div className="flex gap-2 flex-wrap">
        {['', 'IN_PROGRESS', 'COMPLETED', 'TERMINATED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm ${status === s ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {(data?.data ?? []).map((c: any) => {
            const stageEvents = getStageEvents(c.events);
            const isExpanded = expandedCycle === c.id;
            const duration = getDuration(c);

            return (
              <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                {/* Cycle Header Row */}
                <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-750/50 transition-colors"
                  onClick={() => setExpandedCycle(isExpanded ? null : c.id)}>
                  {/* Expand arrow */}
                  <svg className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>

                  {/* Filter Name */}
                  <div className="min-w-[120px]">
                    <div className="text-sm font-semibold text-gray-100">{c.filterName ?? 'Unknown Filter'}</div>
                    {c.filterSet && (
                      <span className={`text-[10px] ${c.filterSet === 'SET_A' ? 'text-indigo-400' : 'text-purple-400'}`}>
                        Set {c.filterSet.replace('SET_', '')}
                      </span>
                    )}
                  </div>

                  {/* Cycle Code */}
                  <div className="font-mono text-cyan-400 text-xs min-w-[180px]">{c.cycleCode}</div>

                  {/* Reason */}
                  <span className={`px-2 py-0.5 text-[10px] rounded-full shrink-0 ${REASON_COLORS[c.cleaningReasonKey] ?? 'bg-gray-700 text-gray-300'}`}>
                    {c.cleaningReasonLabel}
                  </span>

                  {/* Status */}
                  <span className={`px-2 py-0.5 text-[10px] rounded-full shrink-0 ${c.status === 'COMPLETED' ? 'bg-green-900 text-green-300' : c.status === 'IN_PROGRESS' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'}`}>
                    {c.status}
                  </span>

                  {/* Stage progress dots */}
                  <div className="flex gap-1 items-center ml-auto">
                    {stageEvents.map((ev: any, i: number) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-cyan-500" title={STAGE_LABELS[ev.toState] ?? ev.toState} />
                    ))}
                  </div>

                  {/* Duration */}
                  {duration && <span className="text-xs text-gray-500 shrink-0 ml-2">{duration}</span>}

                  {/* Started time */}
                  <span className="text-xs text-gray-500 shrink-0">{new Date(c.startedAt).toLocaleDateString()}</span>

                  {/* View detail button */}
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/cleaning-cycles/${c.id}`); }}
                    className="text-xs text-cyan-500 hover:text-cyan-400 shrink-0 px-2 py-1 rounded hover:bg-gray-700 transition-colors">
                    View
                  </button>
                </div>

                {/* Expanded: Stage Timeline */}
                {isExpanded && (
                  <div className="border-t border-gray-700 bg-gray-850/50 px-5 py-4">
                    {stageEvents.length === 0 ? (
                      <div className="text-sm text-gray-500 italic py-2">No stage transitions recorded</div>
                    ) : (
                      <div className="space-y-0">
                        {/* Cycle Started */}
                        <div className="flex items-start gap-3 pb-3">
                          <div className="flex flex-col items-center">
                            <div className="w-3 h-3 rounded-full bg-cyan-500 border-2 border-cyan-400 shrink-0 mt-0.5" />
                            {stageEvents.length > 0 && <div className="w-0.5 flex-1 bg-gray-700 min-h-[16px]" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-cyan-400">Cycle Started</span>
                              <span className="text-[10px] text-gray-500 shrink-0">{new Date(c.startedAt).toLocaleString()}</span>
                            </div>
                            {c.cleaningJustification && (
                              <p className="text-[11px] text-gray-500 italic mt-0.5">{c.cleaningJustification}</p>
                            )}
                          </div>
                        </div>

                        {/* Stage Events */}
                        {stageEvents.map((ev: any, i: number) => (
                          <div key={ev.id} className="flex items-start gap-3 pb-3">
                            <div className="flex flex-col items-center">
                              <div className={`w-3 h-3 rounded-full border-2 shrink-0 mt-0.5 ${i === stageEvents.length - 1 && c.status === 'IN_PROGRESS' ? 'bg-blue-500 border-blue-400 animate-pulse' : 'bg-green-500 border-green-400'}`} />
                              {(i < stageEvents.length - 1 || c.completedAt) && <div className="w-0.5 flex-1 bg-gray-700 min-h-[16px]" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {ev.fromState && (
                                    <>
                                      <span className="text-xs text-gray-500">{STAGE_LABELS[ev.fromState] ?? ev.fromState}</span>
                                      <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </>
                                  )}
                                  <span className={`text-xs font-semibold ${STAGE_COLORS[ev.toState] ?? 'text-gray-200'}`}>
                                    {STAGE_LABELS[ev.toState] ?? ev.toState}
                                  </span>
                                </div>
                                <span className="text-[10px] text-gray-500 shrink-0">{new Date(ev.performedAt).toLocaleString()}</span>
                              </div>
                              {ev.remarks && (
                                <p className="text-[11px] text-gray-500 mt-0.5 truncate">{ev.remarks}</p>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Cycle Completed */}
                        {c.completedAt && (
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-400 shrink-0 mt-0.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-green-400">Cycle Completed</span>
                                <span className="text-[10px] text-gray-500 shrink-0">{new Date(c.completedAt).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {(data?.data ?? []).length === 0 && (
            <div className="text-center py-12 text-gray-500 bg-gray-800 border border-gray-700 rounded-xl">No cleaning cycles found</div>
          )}
        </div>
      )}

      {data?.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50 text-gray-300">Prev</button>
          <span className="px-3 py-1 text-gray-400">{page} / {data.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50 text-gray-300">Next</button>
        </div>
      )}
    </div>
  );
}
