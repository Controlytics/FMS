import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const STAGE_CONFIG: Record<string, { icon: string; color: string; bgColor: string; borderColor: string }> = {
  INSTALLED:      { icon: '📦', color: 'text-blue-300',   bgColor: 'bg-blue-900/40',   borderColor: 'border-blue-600' },
  TO_BE_CLEANED:  { icon: '🔴', color: 'text-red-300',    bgColor: 'bg-red-900/40',    borderColor: 'border-red-600' },
  WASH_IN:        { icon: '🚿', color: 'text-sky-300',    bgColor: 'bg-sky-900/40',    borderColor: 'border-sky-600' },
  WASH_OUT:       { icon: '💧', color: 'text-sky-300',    bgColor: 'bg-sky-900/40',    borderColor: 'border-sky-500' },
  DRY_IN:         { icon: '🌡️', color: 'text-amber-300',  bgColor: 'bg-amber-900/40',  borderColor: 'border-amber-600' },
  DRY_OUT:        { icon: '☀️', color: 'text-amber-300',  bgColor: 'bg-amber-900/40',  borderColor: 'border-amber-500' },
  STORAGE_IN:     { icon: '📥', color: 'text-gray-300',   bgColor: 'bg-gray-800/40',   borderColor: 'border-gray-600' },
  STORAGE_OUT:    { icon: '📤', color: 'text-gray-300',   bgColor: 'bg-gray-800/40',   borderColor: 'border-gray-500' },
  READY_FOR_USE:  { icon: '✅', color: 'text-green-300',  bgColor: 'bg-green-900/40',  borderColor: 'border-green-600' },
  IN_USE:         { icon: '⚡', color: 'text-emerald-300',bgColor: 'bg-emerald-900/40',borderColor: 'border-emerald-600' },
  RETIRED:        { icon: '🚫', color: 'text-red-400',    bgColor: 'bg-red-950/40',    borderColor: 'border-red-800' },
};

// Pipeline stages come from API: state.pipelineStages

function getStageStatus(stage: string, currentState: string | null, completedStages: string[], allStages: string[]): 'completed' | 'current' | 'upcoming' | 'locked' {
  if (completedStages.includes(stage)) return 'completed';
  if (stage === currentState) return 'current';
  const currentIdx = allStages.indexOf(currentState ?? '');
  const stageIdx = allStages.indexOf(stage);
  if (currentIdx >= 0 && stageIdx === currentIdx + 1) return 'upcoming';
  // If no current state in pipeline (e.g. INSTALLED), first stage is upcoming
  if (currentIdx < 0 && stageIdx === 0) return 'upcoming';
  return 'locked';
}

export function FilterOperationsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: state, isLoading } = useSWR(id ? `/api/filters/${id}/current-state` : null, { refreshInterval: 5000 });
  const { data: reasons } = useSWR(id ? `/api/filter/reasons` : null);
  const { data: events } = useSWR(id && state?.currentCycle ? `/api/filter/events?filterId=${id}&cycleId=${state.currentCycle.id}&limit=50` : null);

  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reasonKey, setReasonKey] = useState('');
  const [justification, setJustification] = useState('');
  const [activeStageDialog, setActiveStageDialog] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [params, setParams] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  // Determine completed stages from events
  const completedStages = (events?.data ?? [])
    .filter((e: any) => e.eventType === 'STATE_TRANSITION')
    .map((e: any) => e.toState)
    .filter(Boolean) as string[];

  const refreshAll = () => {
    mutate(`/api/filters/${id}/current-state`);
    if (state?.currentCycle) mutate(`/api/filter/events?filterId=${id}&cycleId=${state.currentCycle.id}&limit=50`);
  };

  const startCycle = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/start-cycle`, {
        cleaningReasonKey: reasonKey,
        cleaningJustification: justification || undefined,
      });
      setShowReasonDialog(false);
      setReasonKey('');
      setJustification('');
      refreshAll();
    } catch (e: any) {
      alert(e.message ?? 'Failed to start cycle');
    }
    setLoading(false);
  };

  const advanceToStage = async (targetState: string) => {
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/advance`, {
        targetState,
        parameters: Object.keys(params).length ? params : undefined,
        remarks: remarks || `${targetState.replace(/_/g, ' ')} - Identifier scanned: ${scanValue || 'manual'}`,
      });
      setActiveStageDialog(null);
      setScanValue('');
      setRemarks('');
      setParams({});
      refreshAll();
    } catch (e: any) {
      alert(e.message ?? 'Failed to advance');
    }
    setLoading(false);
  };

  const completeCycle = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/advance`, {
        targetState: 'END',
        remarks: 'Cycle completed',
      });
      refreshAll();
    } catch (e: any) {
      alert(e.message ?? 'Failed to complete cycle');
    }
    setLoading(false);
  };

  if (isLoading) return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!state) return <div className="p-6 text-gray-400">Filter not found</div>;

  const hasCycle = !!state.currentCycle;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-3xl">{STAGE_CONFIG[state.currentState]?.icon ?? '🔧'}</div>
            <div>
              <h1 className="text-xl font-bold text-gray-100">{state.filterName ?? 'Filter'}</h1>
              <div className="flex items-center gap-3 mt-1">
                {state.filterSet && <span className="px-2 py-0.5 text-xs bg-indigo-900 text-indigo-300 rounded-full">Set {state.filterSet.replace('SET_', '')}</span>}
                {state.profile && <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded-full">{state.profile.name}</span>}
                <span className="text-xs text-gray-500">Cycles: {state.totalCycles}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-lg font-bold ${STAGE_CONFIG[state.currentState]?.color ?? 'text-gray-300'}`}>
              {state.currentState?.replace(/_/g, ' ') ?? 'No State'}
            </div>
            {state.currentCycle && (
              <div className="text-xs text-gray-500 font-mono mt-1">{state.currentCycle.cycleCode}</div>
            )}
          </div>
        </div>
      </div>

      {/* Start Cycle Button */}
      {!hasCycle && (
        <button onClick={() => setShowReasonDialog(true)}
          className="w-full py-4 bg-cyan-600 text-white rounded-xl font-semibold text-lg hover:bg-cyan-500 transition-colors flex items-center justify-center gap-3">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Start Cleaning Cycle
        </button>
      )}

      {/* Pipeline Stages */}
      {hasCycle && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Cleaning Pipeline</h2>

          {(state.pipelineStages ?? []).map((ps: any, idx: number) => ps.stateKey).map((stage: string, idx: number) => {
            const allStages = (state.pipelineStages ?? []).map((ps: any) => ps.stateKey);
            const status = getStageStatus(stage, state.currentState, completedStages, allStages);
            const config = STAGE_CONFIG[stage] ?? { icon: '⬜', color: 'text-gray-300', bgColor: 'bg-gray-800', borderColor: 'border-gray-600' };
            const isNext = status === 'upcoming';
            const event = (events?.data ?? []).find((e: any) => e.toState === stage && e.eventType === 'STATE_TRANSITION');

            return (
              <div key={stage}>
                {/* Connector line */}
                {idx > 0 && (
                  <div className="flex justify-center -my-1">
                    <div className={`w-0.5 h-4 ${status === 'completed' || status === 'current' ? 'bg-cyan-600' : 'bg-gray-700'}`} />
                  </div>
                )}

                <div
                  className={`rounded-xl border-2 p-4 transition-all ${
                    status === 'completed' ? 'border-green-700 bg-green-900/20' :
                    status === 'current' ? `${config.borderColor} ${config.bgColor} ring-2 ring-cyan-500/30` :
                    isNext ? `${config.borderColor} ${config.bgColor} cursor-pointer hover:ring-2 hover:ring-cyan-500/50` :
                    'border-gray-700 bg-gray-800/30 opacity-50'
                  }`}
                  onClick={() => {
                    if (isNext) setActiveStageDialog(stage);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{config.icon}</span>
                      <div>
                        <div className={`font-semibold ${status === 'completed' ? 'text-green-300' : config.color}`}>
                          {stage.replace(/_/g, ' ')}
                        </div>
                        {event && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {new Date(event.performedAt).toLocaleString()} {event.remarks && `— ${event.remarks}`}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {status === 'completed' && (
                        <span className="px-3 py-1 text-xs bg-green-900 text-green-300 rounded-full font-medium flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          Done
                        </span>
                      )}
                      {status === 'current' && (
                        <span className="px-3 py-1 text-xs bg-cyan-900 text-cyan-300 rounded-full font-medium animate-pulse">
                          Current
                        </span>
                      )}
                      {isNext && (
                        <button
                          className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-semibold hover:bg-cyan-500 transition-colors flex items-center gap-2"
                          onClick={(e) => { e.stopPropagation(); setActiveStageDialog(stage); }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          Scan & Submit
                        </button>
                      )}
                      {status === 'locked' && (
                        <span className="text-xs text-gray-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Complete Cycle */}
          {state.currentState === 'READY_FOR_USE' && (
            <>
              <div className="flex justify-center -my-1">
                <div className="w-0.5 h-4 bg-green-600" />
              </div>
              <button onClick={completeCycle} disabled={loading}
                className="w-full py-4 bg-green-600 text-white rounded-xl font-semibold text-lg hover:bg-green-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {loading ? 'Completing...' : 'Complete Cleaning Cycle'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Event Log */}
      {hasCycle && (events?.data ?? []).length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Event Log</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {(events?.data ?? []).slice().reverse().map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 py-2 border-b border-gray-700/50 last:border-0 text-sm">
                <div className={`w-2 h-2 rounded-full ${e.eventType === 'BYPASS_DEVIATION' ? 'bg-red-500' : e.eventType === 'CYCLE_STARTED' ? 'bg-cyan-500' : 'bg-green-500'}`} />
                <span className="text-gray-400 w-40 shrink-0">{new Date(e.performedAt).toLocaleTimeString()}</span>
                <span className="text-gray-200">{e.eventType.replace(/_/g, ' ')}</span>
                {e.toState && <span className="text-cyan-400 text-xs">→ {e.toState.replace(/_/g, ' ')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Traceability link */}
      <div className="text-center">
        <button onClick={() => navigate(`/filters/${id}/trace`)} className="text-sm text-gray-500 hover:text-cyan-400 transition-colors">
          View Full Traceability →
        </button>
      </div>

      {/* === DIALOGS === */}

      {/* Cleaning Reason Dialog */}
      {showReasonDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowReasonDialog(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-100">Select Cleaning Reason</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(reasons?.reasons ?? []).filter((r: any) => r.isActive !== false).map((r: any) => (
                <button key={r.key} onClick={() => setReasonKey(r.key)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all ${reasonKey === r.key ? 'bg-cyan-900/60 border-cyan-500 border-2' : 'bg-gray-700/50 hover:bg-gray-700 border-2 border-transparent'}`}>
                  <div className="text-gray-100 font-medium">{r.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{r.description}</div>
                </button>
              ))}
            </div>
            {reasons?.reasons?.find((r: any) => r.key === reasonKey)?.requiresJustification && (
              <textarea className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-gray-100 placeholder:text-gray-600" rows={3}
                placeholder="Justification required (min 10 characters)..." value={justification} onChange={e => setJustification(e.target.value)} />
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowReasonDialog(false)} className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl font-medium">Cancel</button>
              <button onClick={startCycle} disabled={!reasonKey || loading}
                className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-semibold disabled:opacity-50">
                {loading ? 'Starting...' : 'Start Cycle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stage Scan & Submit Dialog */}
      {activeStageDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setActiveStageDialog(null)}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{STAGE_CONFIG[activeStageDialog]?.icon ?? '⬜'}</span>
              <div>
                <h2 className="text-lg font-bold text-gray-100">{activeStageDialog.replace(/_/g, ' ')}</h2>
                <p className="text-xs text-gray-400">Scan filter identifier and confirm</p>
              </div>
            </div>

            {/* Scan Input */}
            <div>
              <label className="text-sm font-medium text-gray-400 mb-1 block">Scan Identifier / QR Value</label>
              <input
                type="text"
                className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-gray-100 font-mono text-lg placeholder:text-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
                placeholder="Scan or type identifier..."
                value={scanValue}
                onChange={e => setScanValue(e.target.value)}
                autoFocus
              />
            </div>

            {/* Remarks */}
            <div>
              <label className="text-sm font-medium text-gray-400 mb-1 block">Remarks (optional)</label>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-2 text-gray-100 placeholder:text-gray-600"
                rows={2}
                placeholder="Any observations..."
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
              />
            </div>

            {/* Parameter capture if needed */}
            {state.nextBlocks?.filter((b: any) => b.nodeType === 'PARAM_CAPTURE').map((block: any, i: number) => (
              <div key={i} className="bg-gray-900/50 rounded-xl p-4 space-y-3">
                <div className="text-sm font-medium text-cyan-400">Parameter Capture</div>
                {(block.configuration?.parameters ?? []).map((p: any) => (
                  <div key={p.key} className="flex items-center gap-3">
                    <label className="text-sm text-gray-300 w-36">{p.label} {p.required && <span className="text-red-400">*</span>}</label>
                    <input type="number" step="any"
                      className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-100"
                      placeholder={`${p.min ?? ''} - ${p.max ?? ''} ${p.unit ?? ''}`}
                      onChange={e => setParams(prev => ({ ...prev, [p.key]: { value: parseFloat(e.target.value), unit: p.unit } }))}
                    />
                    <span className="text-sm text-gray-500 w-12">{p.unit}</span>
                  </div>
                ))}
              </div>
            ))}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setActiveStageDialog(null); setScanValue(''); setRemarks(''); }}
                className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl font-medium">Cancel</button>
              <button
                onClick={() => advanceToStage(activeStageDialog)}
                disabled={loading || !scanValue.trim()}
                className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Submit
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
