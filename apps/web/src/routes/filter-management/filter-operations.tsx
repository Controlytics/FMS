import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const CLEANING_STAGES = [
  { key: 'WASH_IN', label: 'Wash In', icon: '🚿', color: 'from-sky-800 to-sky-900', border: 'border-sky-600', activeBg: 'bg-sky-900/40', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '💧', color: 'from-sky-800 to-sky-950', border: 'border-sky-500', activeBg: 'bg-sky-900/40', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '🌡️', color: 'from-amber-800 to-amber-900', border: 'border-amber-600', activeBg: 'bg-amber-900/40', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '☀️', color: 'from-amber-800 to-amber-950', border: 'border-amber-500', activeBg: 'bg-amber-900/40', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '📥', color: 'from-gray-700 to-gray-800', border: 'border-gray-500', activeBg: 'bg-gray-800/40', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '📤', color: 'from-gray-700 to-gray-900', border: 'border-gray-400', activeBg: 'bg-gray-800/40', needsBlock: false },
];

export function FilterOperationsPage() {
  // Fetch all filter events to get current stage counts
  const { data: eventsData } = useSWR('/api/filter/events?limit=200', { refreshInterval: 10000 });

  // Fetch filter instances - use a custom endpoint or direct query
  // We'll use the filter/cycles endpoint and events to compute counts
  // Better: fetch all instances and check their lifecycle state
  const { data: instancesData } = useSWR('/api/assets/instances?limit=200', { refreshInterval: 10000 });

  // States
  const [mode, setMode] = useState<'operations' | 'status'>('operations');
  const [activeStage, setActiveStage] = useState<typeof CLEANING_STAGES[0] | null>(null);
  const [selectedStatusStage, setSelectedStatusStage] = useState<string | null>(null);
  const [step, setStep] = useState<'block' | 'scan'>('block');
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recentSubmissions, setRecentSubmissions] = useState<Array<{stage: string; filter: string; block?: string; time: string}>>([]);

  // Get all filters with lifecycle state from DB
  // The instances API may not return lifecycle state, so let's compute from events + instances
  const allFilters = (instancesData?.data ?? []).filter((f: any) => f.filterSet || f.filterProfileId || f.name?.includes('HEPA'));

  // We need filter states - fetch each filter's current state
  // For now, compute from the filter names and use a status endpoint
  const { data: statusData } = useSWR('/api/filter/events?limit=500', { refreshInterval: 10000 });

  // Build filter state map from events (latest event per filter = current state)
  const filterStateMap: Record<string, { state: string; name: string; set: string; id: string }> = {};

  // First set from instances data
  allFilters.forEach((f: any) => {
    if (f.currentLifecycleState) {
      filterStateMap[f.id] = { state: f.currentLifecycleState, name: f.name, set: f.filterSet ?? '', id: f.id };
    }
  });

  // Count per stage
  const stageCounts: Record<string, number> = {};
  Object.values(filterStateMap).forEach(f => {
    stageCounts[f.state] = (stageCounts[f.state] ?? 0) + 1;
  });

  // Filters in selected status stage
  const filtersInStage = selectedStatusStage
    ? Object.values(filterStateMap).filter(f => f.state === selectedStatusStage)
    : [];

  // Blocks
  const blocks = (instancesData?.data ?? []).filter((e: any) =>
    e.name?.toLowerCase().includes('block') || e.attributes?.grade
  );

  const handleStageClick = (stage: typeof CLEANING_STAGES[0]) => {
    setActiveStage(stage);
    setError(''); setSuccess(''); setScanValue(''); setRemarks('');
    if (stage.needsBlock) { setStep('block'); setSelectedBlock(null); }
    else { setStep('scan'); }
  };

  const handleBlockSelect = (block: any) => { setSelectedBlock(block); setStep('scan'); };

  const handleSubmit = async () => {
    if (!scanValue.trim() || !activeStage) return;
    setLoading(true); setError('');

    try {
      let filterId = '', filterName = '';
      try {
        const lookup = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(scanValue.trim())}`);
        if (lookup?.asset?.id) { filterId = lookup.asset.id; filterName = lookup.asset.name; }
        else { setError('No filter found'); setLoading(false); return; }
      } catch {
        if (scanValue.match(/^[0-9a-f]{8}-/i)) { filterId = scanValue.trim(); filterName = scanValue.slice(0, 8); }
        else { setError('Filter not found'); setLoading(false); return; }
      }

      const state = await apiClient.get<any>(`/api/filters/${filterId}/current-state`);
      if (!state.currentCycle) {
        try {
          await apiClient.post(`/api/filters/${filterId}/start-cycle`, { cleaningReasonKey: 'TYPE_C', cleaningAreaId: selectedBlock?.id });
        } catch (e: any) {
          if (!e.message?.includes('CYCLE_ACTIVE')) { setError(e.message ?? 'Failed'); setLoading(false); return; }
        }
      }

      await apiClient.post(`/api/filters/${filterId}/advance`, {
        targetState: activeStage.key,
        cleaningAreaId: selectedBlock?.id,
        remarks: remarks || `${activeStage.label} - Block: ${selectedBlock?.name ?? 'N/A'} - Scanned: ${scanValue}`,
      });

      setSuccess(`✅ ${filterName} → ${activeStage.label}`);
      setRecentSubmissions(prev => [{ stage: activeStage.label, filter: filterName, block: selectedBlock?.name, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
      setScanValue(''); setRemarks('');
      // Refresh data
      mutate('/api/assets/instances?limit=200');
      mutate('/api/filter/events?limit=200');
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    setLoading(false);
  };

  const closeDialog = () => { setActiveStage(null); setSelectedBlock(null); setScanValue(''); setRemarks(''); setError(''); setSuccess(''); };

  const selectedStageInfo = CLEANING_STAGES.find(s => s.key === selectedStatusStage);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header with Toggle */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Filter Operations</h1>
        <div className="flex bg-gray-800 rounded-xl p-1">
          <button onClick={() => { setMode('operations'); setSelectedStatusStage(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'operations' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            Cleaning
          </button>
          <button onClick={() => setMode('status')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'status' ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            Filter Status
          </button>
        </div>
      </div>

      {/* === OPERATIONS MODE === */}
      {mode === 'operations' && (
        <>
          <p className="text-gray-400 text-sm -mt-4">Select a cleaning stage to process filters</p>

          {/* Stage Blocks - 3x2 Grid */}
          <div className="grid grid-cols-3 gap-4">
            {CLEANING_STAGES.map((stage) => (
              <button key={stage.key} onClick={() => handleStageClick(stage)}
                className={`bg-gradient-to-br ${stage.color} border-2 ${stage.border} rounded-2xl p-6 text-center transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-cyan-900/20 active:scale-[0.98]`}>
                <div className="text-4xl mb-3">{stage.icon}</div>
                <div className="text-white font-bold text-lg">{stage.label}</div>
                {stage.needsBlock && <div className="text-white/50 text-[10px] mt-2 uppercase tracking-wider">Block Selection Required</div>}
              </button>
            ))}
          </div>

          {/* Recent Submissions */}
          {recentSubmissions.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent Submissions</h3>
              <div className="space-y-2">
                {recentSubmissions.map((sub, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-700/50 last:border-0 text-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-gray-400 w-20 shrink-0">{sub.time}</span>
                    <span className="text-gray-200 font-medium">{sub.filter}</span>
                    <span className="text-cyan-400">→ {sub.stage}</span>
                    {sub.block && <span className="text-gray-500 text-xs">({sub.block})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* === STATUS MODE === */}
      {mode === 'status' && (
        <>
          <p className="text-gray-400 text-sm -mt-4">Click a stage to see filters currently in that state</p>

          {/* Stage Blocks with Counts */}
          <div className="grid grid-cols-3 gap-3">
            {CLEANING_STAGES.map((stage) => {
              const count = stageCounts[stage.key] ?? 0;
              const isActive = selectedStatusStage === stage.key;
              return (
                <button key={stage.key}
                  onClick={() => setSelectedStatusStage(isActive ? null : stage.key)}
                  className={`bg-gradient-to-br ${stage.color} border-2 ${isActive ? 'border-cyan-400 ring-2 ring-cyan-400/30 scale-[1.03]' : stage.border} rounded-2xl p-4 text-center transition-all hover:scale-[1.02] active:scale-[0.98] relative`}>
                  <div className="text-2xl mb-1">{stage.icon}</div>
                  <div className="text-white font-semibold text-xs">{stage.label}</div>
                  <div className={`mt-2 inline-flex items-center justify-center min-w-[28px] h-7 rounded-full font-bold text-sm ${count > 0 ? 'bg-white/20 text-white' : 'bg-white/5 text-white/30'}`}>
                    {count}
                  </div>
                  {isActive && <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-400 rounded-full border-2 border-gray-900" />}
                </button>
              );
            })}
          </div>

          {/* Filters in Selected Stage */}
          {selectedStatusStage && (
            <div className={`${selectedStageInfo?.activeBg ?? 'bg-gray-800/40'} border border-gray-700 rounded-2xl p-5`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{selectedStageInfo?.icon}</span>
                <div>
                  <h2 className="text-lg font-bold text-gray-100">{selectedStageInfo?.label}</h2>
                  <p className="text-sm text-gray-400">{filtersInStage.length} filter(s)</p>
                </div>
              </div>
              {filtersInStage.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No filters in this stage</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filtersInStage.map((filter) => (
                    <div key={filter.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-100">{filter.name}</span>
                        {filter.set && (
                          <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${filter.set === 'SET_A' ? 'bg-indigo-900/60 text-indigo-300' : 'bg-purple-900/60 text-purple-300'}`}>
                            Set {filter.set.replace('SET_', '')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* === STAGE DIALOG (Operations mode) === */}
      {activeStage && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeDialog}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className={`bg-gradient-to-r ${activeStage.color} px-6 py-4 flex items-center gap-3`}>
              <span className="text-3xl">{activeStage.icon}</span>
              <div>
                <h2 className="text-xl font-bold text-white">{activeStage.label}</h2>
                <p className="text-white/60 text-sm">{step === 'block' ? 'Step 1: Select Block' : selectedBlock ? `Block: ${selectedBlock.name}` : 'Scan filter to submit'}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {step === 'block' && (
                <>
                  <div className="text-sm text-gray-400 mb-2">Select the block:</div>
                  <div className="space-y-2">
                    {blocks.length === 0 && <div className="text-center py-6 text-gray-500">No blocks found</div>}
                    {blocks.map((block: any) => (
                      <button key={block.id} onClick={() => handleBlockSelect(block)}
                        className="w-full text-left px-4 py-4 bg-gray-700/50 hover:bg-gray-700 border-2 border-transparent hover:border-cyan-600 rounded-xl transition-all">
                        <div className="text-gray-100 font-semibold">{block.name}</div>
                        {block.attributes?.grade && <div className="text-xs text-gray-400 mt-0.5">{block.attributes.grade}</div>}
                      </button>
                    ))}
                  </div>
                  <button onClick={closeDialog} className="w-full py-3 bg-gray-700 text-gray-300 rounded-xl mt-2">Cancel</button>
                </>
              )}
              {step === 'scan' && (
                <>
                  {selectedBlock && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-cyan-900/30 border border-cyan-800 rounded-xl text-sm">
                      <span className="text-cyan-300">{selectedBlock.name}</span>
                      <button onClick={() => setStep('block')} className="ml-auto text-xs text-cyan-400">Change</button>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-medium text-gray-400 mb-1 block">Scan Filter Barcode / QR</label>
                    <input type="text"
                      className="w-full bg-gray-900 border-2 border-gray-600 rounded-xl px-4 py-4 text-gray-100 text-center font-mono text-xl placeholder:text-gray-600 focus:border-cyan-500 outline-none"
                      placeholder="Scan or type identifier"
                      value={scanValue} onChange={e => { setScanValue(e.target.value); setError(''); setSuccess(''); }}
                      onKeyDown={e => { if (e.key === 'Enter' && scanValue.trim()) handleSubmit(); }}
                      autoFocus />
                  </div>
                  <textarea className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-2 text-gray-100 text-sm placeholder:text-gray-500" rows={2}
                    placeholder="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  {error && <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-xl text-sm text-red-300">{error}</div>}
                  {success && <div className="px-4 py-3 bg-green-900/30 border border-green-800 rounded-xl text-sm text-green-300">{success}</div>}
                  <div className="flex gap-3">
                    <button onClick={closeDialog} className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl">Close</button>
                    <button onClick={handleSubmit} disabled={loading || !scanValue.trim()}
                      className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-green-500 transition-colors">
                      {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                        <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit</>}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 text-center">Scan another filter for same stage, or close.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
