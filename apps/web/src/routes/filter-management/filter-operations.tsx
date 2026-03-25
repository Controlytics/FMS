import { useState } from 'react';
import { useParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';


const STATE_COLORS: Record<string, string> = {
  INSTALLED: 'bg-blue-600', TO_BE_CLEANED: 'bg-red-500', WASH_IN: 'bg-sky-500', WASH_OUT: 'bg-sky-500',
  DRY_IN: 'bg-amber-500', DRY_OUT: 'bg-amber-500', STORAGE_IN: 'bg-gray-500', STORAGE_OUT: 'bg-gray-500',
  READY_FOR_USE: 'bg-green-500', IN_USE: 'bg-emerald-500', RETIRED: 'bg-red-800', REPLACED: 'bg-amber-800', CONDEMNED: 'bg-red-900',
};

export function FilterOperationsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: state, isLoading } = useSWR(id ? `/api/filters/${id}/current-state` : null);
  const { data: reasons } = useSWR(state?.profile ? `/api/filter/reasons${state?.filterProfileId ? `?profileId=${state.filterProfileId}` : ''}` : null);
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reasonKey, setReasonKey] = useState('');
  const [justification, setJustification] = useState('');
  const [targetState, setTargetState] = useState('');
  const [remarks, setRemarks] = useState('');
  const [params, setParams] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  const startCycle = async () => {
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/start-cycle`, { cleaningReasonKey: reasonKey, cleaningJustification: justification || undefined });
      setShowReasonDialog(false);
      setReasonKey('');
      setJustification('');
      mutate(`/api/filters/${id}/current-state`);
    } catch (e: any) {
      alert(e.message ?? 'Failed to start cycle');
    }
    setLoading(false);
  };

  const advance = async () => {
    if (!targetState) return;
    setLoading(true);
    try {
      await apiClient.post(`/api/filters/${id}/advance`, { targetState, parameters: Object.keys(params).length ? params : undefined, remarks: remarks || undefined });
      setTargetState('');
      setRemarks('');
      setParams({});
      mutate(`/api/filters/${id}/current-state`);
    } catch (e: any) {
      alert(e.message ?? 'Failed to advance');
    }
    setLoading(false);
  };

  if (isLoading) return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!state) return <div className="p-6 text-gray-400">Filter not found</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-100">{state.filterName ?? 'Filter'}</h1>
        {state.filterSet && <span className="px-2 py-1 text-xs bg-indigo-900 text-indigo-300 rounded">Set {state.filterSet.replace('SET_', '')}</span>}
        {state.profile && <span className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">{state.profile.name}</span>}
        <span className="text-sm text-gray-500">Total cycles: {state.totalCycles}</span>
      </div>

      {/* Current State Card */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-white text-2xl font-bold ${STATE_COLORS[state.currentState] ?? 'bg-gray-600'}`}>
            {(state.currentState ?? '?')[0]}
          </div>
          <div>
            <div className="text-xl font-semibold text-gray-100">{state.currentState?.replace(/_/g, ' ') ?? 'No State'}</div>
            {state.currentCycle && (
              <div className="text-sm text-gray-400">
                Cycle: <span className="text-cyan-400 font-mono">{state.currentCycle.cycleCode}</span> — {state.currentCycle.status}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline Mini Visualization */}
      {state.nextAllowedStages?.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Next Allowed Stages</h3>
          <div className="flex gap-2 flex-wrap">
            {state.nextAllowedStages.map((s: string) => (
              <button key={s} onClick={() => setTargetState(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${targetState === s ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action Area */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
        {!state.currentCycle ? (
          <button onClick={() => setShowReasonDialog(true)} className="w-full py-3 bg-cyan-600 text-white rounded-lg font-semibold hover:bg-cyan-500 transition-colors">
            Start Cleaning Cycle
          </button>
        ) : (
          <>
            {/* Intermediate blocks */}
            {state.nextBlocks?.map((block: any, i: number) => (
              <div key={i} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <div className="text-sm font-medium text-cyan-400 mb-2">{block.nodeType.replace(/_/g, ' ')}</div>
                {block.nodeType === 'PARAM_CAPTURE' && block.configuration?.parameters?.map((p: any) => (
                  <div key={p.key} className="flex items-center gap-3 mb-2">
                    <label className="text-sm text-gray-300 w-40">{p.label} {p.required && <span className="text-red-400">*</span>}</label>
                    <input type="number" className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-gray-100 w-32"
                      placeholder={`${p.min ?? ''}-${p.max ?? ''}`}
                      onChange={e => setParams(prev => ({ ...prev, [p.key]: { value: parseFloat(e.target.value), unit: p.unit } }))} />
                    <span className="text-sm text-gray-500">{p.unit}</span>
                  </div>
                ))}
                {block.nodeType === 'REMARKS' && (
                  <textarea className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-100" rows={2}
                    placeholder="Enter remarks..." value={remarks} onChange={e => setRemarks(e.target.value)} />
                )}
              </div>
            ))}

            {targetState && (
              <button onClick={advance} disabled={loading}
                className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition-colors disabled:opacity-50">
                {loading ? 'Advancing...' : `Advance to ${targetState.replace(/_/g, ' ')}`}
              </button>
            )}

            {state.profile?.flowMode === 'BYPASS_ENABLED' && (
              <button className="w-full py-2 bg-amber-700 text-white rounded-lg text-sm hover:bg-amber-600 transition-colors">
                Bypass (Deviation)
              </button>
            )}
          </>
        )}
      </div>

      {/* Cleaning Reason Dialog */}
      {showReasonDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowReasonDialog(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-100">Select Cleaning Reason</h2>
            <div className="space-y-2">
              {(reasons?.reasons ?? []).map((r: any) => (
                <button key={r.key} onClick={() => setReasonKey(r.key)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${reasonKey === r.key ? 'bg-cyan-900 border-cyan-500 border' : 'bg-gray-700 hover:bg-gray-600 border border-transparent'}`}>
                  <div className="text-gray-100 font-medium">{r.name}</div>
                  <div className="text-xs text-gray-400">{r.description}</div>
                </button>
              ))}
            </div>
            {reasons?.reasons?.find((r: any) => r.key === reasonKey)?.requiresJustification && (
              <textarea className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100" rows={3}
                placeholder="Justification (min 10 characters)..." value={justification} onChange={e => setJustification(e.target.value)} />
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowReasonDialog(false)} className="flex-1 py-2 bg-gray-700 text-gray-300 rounded-lg">Cancel</button>
              <button onClick={startCycle} disabled={!reasonKey || loading} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg disabled:opacity-50">
                {loading ? 'Starting...' : 'Start Cycle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
