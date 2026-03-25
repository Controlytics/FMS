import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const STAGE_ICONS: Record<string, string> = {
  TO_BE_CLEANED: '🔴', WASH_IN: '🚿', WASH_OUT: '💧', DRY_IN: '🌡️', DRY_OUT: '☀️',
  STORAGE_IN: '📥', STORAGE_OUT: '📤', READY_FOR_USE: '✅', IN_USE: '⚡',
  INSTALLED: '📦', RETIRED: '🚫', REPLACED: '🔄', CONDEMNED: '⛔',
};

const STAGE_COLORS: Record<string, { bg: string; border: string; text: string; doneBg: string }> = {
  TO_BE_CLEANED:  { bg: 'bg-red-950',    border: 'border-red-700',    text: 'text-red-200',    doneBg: 'bg-red-900/30' },
  WASH_IN:        { bg: 'bg-sky-950',     border: 'border-sky-700',    text: 'text-sky-200',    doneBg: 'bg-sky-900/30' },
  WASH_OUT:       { bg: 'bg-sky-950',     border: 'border-sky-600',    text: 'text-sky-200',    doneBg: 'bg-sky-900/30' },
  DRY_IN:         { bg: 'bg-amber-950',   border: 'border-amber-700',  text: 'text-amber-200',  doneBg: 'bg-amber-900/30' },
  DRY_OUT:        { bg: 'bg-amber-950',   border: 'border-amber-600',  text: 'text-amber-200',  doneBg: 'bg-amber-900/30' },
  STORAGE_IN:     { bg: 'bg-gray-900',    border: 'border-gray-600',   text: 'text-gray-300',   doneBg: 'bg-gray-800/30' },
  STORAGE_OUT:    { bg: 'bg-gray-900',    border: 'border-gray-500',   text: 'text-gray-300',   doneBg: 'bg-gray-800/30' },
  READY_FOR_USE:  { bg: 'bg-green-950',   border: 'border-green-700',  text: 'text-green-200',  doneBg: 'bg-green-900/30' },
};

export function FilterOperationsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: state, isLoading } = useSWR(id ? `/api/filters/${id}/current-state` : null, { refreshInterval: 5000 });
  const { data: reasons } = useSWR(id ? `/api/filter/reasons` : null);
  const { data: events } = useSWR(id && state?.currentCycle ? `/api/filter/events?filterId=${id}&cycleId=${state.currentCycle.id}&limit=50` : null);

  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reasonKey, setReasonKey] = useState('');
  const [justification, setJustification] = useState('');
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  const completedStages = (events?.data ?? [])
    .filter((e: any) => e.eventType === 'STATE_TRANSITION')
    .map((e: any) => e.toState)
    .filter(Boolean) as string[];

  const allStages = (state?.pipelineStages ?? []).map((s: any) => s.stateKey) as string[];

  const refreshAll = () => {
    mutate(`/api/filters/${id}/current-state`);
    if (state?.currentCycle) mutate(`/api/filter/events?filterId=${id}&cycleId=${state.currentCycle.id}&limit=50`);
  };

  const getStatus = (stage: string): 'done' | 'current' | 'next' | 'locked' => {
    if (completedStages.includes(stage)) return 'done';
    if (stage === state?.currentState) return 'current';
    const curIdx = allStages.indexOf(state?.currentState ?? '');
    const stgIdx = allStages.indexOf(stage);
    if (curIdx >= 0 && stgIdx === curIdx + 1) return 'next';
    if (curIdx < 0 && stgIdx === 0) return 'next';
    return 'locked';
  };

  const getEventForStage = (stage: string) =>
    (events?.data ?? []).find((e: any) => e.toState === stage && e.eventType === 'STATE_TRANSITION');

  const startCycle = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/start-cycle`, { cleaningReasonKey: reasonKey, cleaningJustification: justification || undefined });
      setShowReasonDialog(false); setReasonKey(''); setJustification('');
      refreshAll();
    } catch (e: any) { alert(e.message ?? 'Failed'); }
    setLoading(false);
  };

  const submitStage = async () => {
    if (!activeStage) return;
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/advance`, {
        targetState: activeStage,
        remarks: remarks || `Scanned: ${scanValue || 'manual entry'}`,
      });
      setActiveStage(null); setScanValue(''); setRemarks('');
      refreshAll();
    } catch (e: any) { alert(e.message ?? 'Failed'); }
    setLoading(false);
  };

  const completeCycle = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/advance`, { targetState: 'END', remarks: 'Cycle completed' });
      refreshAll();
    } catch (e: any) { alert(e.message ?? 'Failed'); }
    setLoading(false);
  };

  if (isLoading) return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!state) return <div className="p-6 text-gray-400">Filter not found</div>;

  const hasCycle = !!state.currentCycle;
  const lastStage = allStages[allStages.length - 1];
  const allDone = hasCycle && state.currentState === lastStage;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-cyan-900/40 rounded-xl flex items-center justify-center text-2xl">
            {STAGE_ICONS[state.currentState] ?? '🔧'}
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">{state.filterName}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {state.filterSet && <span className="px-2 py-0.5 text-[11px] bg-indigo-900/60 text-indigo-300 rounded-full font-medium">Set {state.filterSet.replace('SET_', '')}</span>}
              {state.profile && <span className="px-2 py-0.5 text-[11px] bg-gray-700 text-gray-300 rounded-full">{state.profile.name}</span>}
              <span className="px-2 py-0.5 text-[11px] bg-gray-700 text-gray-400 rounded-full">Cycles: {state.totalCycles}</span>
            </div>
          </div>
        </div>
        {state.currentCycle && (
          <div className="text-right hidden sm:block">
            <div className="text-xs text-gray-500">Active Cycle</div>
            <div className="text-sm font-mono text-cyan-400">{state.currentCycle.cycleCode}</div>
          </div>
        )}
      </div>

      {/* Start Cycle */}
      {!hasCycle && (
        <button onClick={() => setShowReasonDialog(true)}
          className="w-full py-5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-2xl font-bold text-lg hover:from-cyan-500 hover:to-blue-500 transition-all shadow-lg shadow-cyan-900/30 flex items-center justify-center gap-3">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          Start Cleaning Cycle
        </button>
      )}

      {/* Stage Blocks Grid */}
      {hasCycle && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {allStages.map((stage) => {
              const status = getStatus(stage);
              const colors = STAGE_COLORS[stage] ?? { bg: 'bg-gray-900', border: 'border-gray-600', text: 'text-gray-300', doneBg: 'bg-gray-800/30' };
              const event = getEventForStage(stage);
              const icon = STAGE_ICONS[stage] ?? '⬜';

              return (
                <div
                  key={stage}
                  onClick={() => { if (status === 'next') setActiveStage(stage); }}
                  className={`rounded-2xl border-2 p-5 transition-all relative overflow-hidden ${
                    status === 'done'
                      ? `border-green-700/50 ${colors.doneBg} cursor-default`
                      : status === 'current'
                      ? `${colors.border} ${colors.bg} ring-2 ring-cyan-400/40 cursor-default`
                      : status === 'next'
                      ? `${colors.border} ${colors.bg} cursor-pointer hover:ring-2 hover:ring-cyan-400/60 hover:scale-[1.02] active:scale-[0.98]`
                      : 'border-gray-800 bg-gray-900/40 opacity-40 cursor-not-allowed'
                  }`}
                >
                  {/* Done overlay checkmark */}
                  {status === 'done' && (
                    <div className="absolute top-3 right-3">
                      <div className="w-7 h-7 bg-green-600 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      </div>
                    </div>
                  )}

                  {/* Current pulse */}
                  {status === 'current' && (
                    <div className="absolute top-3 right-3">
                      <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse" />
                    </div>
                  )}

                  {/* Icon */}
                  <div className="text-3xl mb-3">{icon}</div>

                  {/* Stage name */}
                  <div className={`font-bold text-sm ${status === 'done' ? 'text-green-300' : status === 'locked' ? 'text-gray-600' : colors.text}`}>
                    {stage.replace(/_/g, ' ')}
                  </div>

                  {/* Timestamp for done stages */}
                  {status === 'done' && event && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      {new Date(event.performedAt).toLocaleTimeString()}
                    </div>
                  )}

                  {/* Tap to scan for next */}
                  {status === 'next' && (
                    <div className="mt-3 flex items-center gap-1.5 text-cyan-400 text-xs font-semibold">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" /><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={1.5} /><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={1.5} /><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={1.5} /></svg>
                      Tap to Scan & Submit
                    </div>
                  )}

                  {/* Lock icon */}
                  {status === 'locked' && (
                    <div className="mt-3 text-gray-700">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Complete Cycle */}
          {allDone && (
            <button onClick={completeCycle} disabled={loading}
              className="w-full py-5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-2xl font-bold text-lg hover:from-green-500 hover:to-emerald-500 transition-all shadow-lg shadow-green-900/30 flex items-center justify-center gap-3 disabled:opacity-50">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {loading ? 'Completing...' : 'Complete Cleaning Cycle'}
            </button>
          )}
        </>
      )}

      {/* Event Log */}
      {hasCycle && (events?.data ?? []).length > 0 && (
        <details className="bg-gray-800 border border-gray-700 rounded-2xl">
          <summary className="p-4 cursor-pointer text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Event Log ({(events?.data ?? []).length} events)
          </summary>
          <div className="px-4 pb-4 space-y-1">
            {(events?.data ?? []).slice().reverse().map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 py-1.5 text-xs border-b border-gray-800 last:border-0">
                <span className="text-gray-500 w-20 shrink-0">{new Date(e.performedAt).toLocaleTimeString()}</span>
                <span className="text-gray-300">{e.eventType.replace(/_/g, ' ')}</span>
                {e.toState && <span className="text-cyan-400">→ {e.toState.replace(/_/g, ' ')}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Trace link */}
      <div className="text-center pb-4">
        <button onClick={() => navigate(`/filters/${id}/trace`)} className="text-sm text-gray-500 hover:text-cyan-400 transition-colors">
          View Full Traceability →
        </button>
      </div>

      {/* === DIALOGS === */}

      {/* Reason Dialog */}
      {showReasonDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowReasonDialog(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-100">Select Cleaning Reason</h2>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(reasons?.reasons ?? []).filter((r: any) => r.isActive !== false).map((r: any) => (
                <button key={r.key} onClick={() => setReasonKey(r.key)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all ${reasonKey === r.key ? 'bg-cyan-900/60 border-cyan-500 border-2 ring-1 ring-cyan-400/30' : 'bg-gray-700/50 hover:bg-gray-700 border-2 border-transparent'}`}>
                  <div className="text-gray-100 font-medium text-sm">{r.name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{r.description}</div>
                </button>
              ))}
            </div>
            {reasons?.reasons?.find((r: any) => r.key === reasonKey)?.requiresJustification && (
              <textarea className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-gray-100 text-sm" rows={3}
                placeholder="Justification required (min 10 characters)..." value={justification} onChange={e => setJustification(e.target.value)} />
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowReasonDialog(false)} className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl">Cancel</button>
              <button onClick={startCycle} disabled={!reasonKey || loading} className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-semibold disabled:opacity-50">
                {loading ? 'Starting...' : 'Start'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan & Submit Dialog */}
      {activeStage && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => { setActiveStage(null); setScanValue(''); setRemarks(''); }}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-5" onClick={e => e.stopPropagation()}>
            {/* Stage header */}
            <div className="text-center">
              <div className="text-4xl mb-2">{STAGE_ICONS[activeStage] ?? '⬜'}</div>
              <h2 className="text-xl font-bold text-gray-100">{activeStage.replace(/_/g, ' ')}</h2>
              <p className="text-sm text-gray-400 mt-1">Scan filter QR / enter identifier to confirm</p>
            </div>

            {/* Scan input */}
            <div>
              <input
                type="text"
                className="w-full bg-gray-900 border-2 border-gray-600 rounded-xl px-4 py-4 text-gray-100 text-center font-mono text-xl placeholder:text-gray-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/30 outline-none"
                placeholder="Scan QR or type ID"
                value={scanValue}
                onChange={e => setScanValue(e.target.value)}
                autoFocus
              />
            </div>

            {/* Remarks */}
            <div>
              <textarea
                className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-2 text-gray-100 text-sm placeholder:text-gray-500"
                rows={2}
                placeholder="Remarks (optional)"
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button onClick={() => { setActiveStage(null); setScanValue(''); setRemarks(''); }}
                className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl font-medium">Cancel</button>
              <button
                onClick={submitStage}
                disabled={loading || !scanValue.trim()}
                className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-green-500 transition-colors"
              >
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (
                  <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
