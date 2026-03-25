import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const STAGES = [
  { key: 'WASH_IN', label: 'Wash In', icon: '🚿', color: 'from-sky-800 to-sky-900', border: 'border-sky-600', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '💧', color: 'from-sky-800 to-sky-950', border: 'border-sky-500', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '🌡️', color: 'from-amber-800 to-amber-900', border: 'border-amber-600', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '☀️', color: 'from-amber-800 to-amber-950', border: 'border-amber-500', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '📥', color: 'from-gray-700 to-gray-800', border: 'border-gray-500', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '📤', color: 'from-gray-700 to-gray-900', border: 'border-gray-400', needsBlock: false },
];

export function FilterOperationsPage() {
  const navigate = useNavigate();

  // Step tracking
  const [activeStage, setActiveStage] = useState<typeof STAGES[0] | null>(null);
  const [step, setStep] = useState<'block' | 'scan'>('block');
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Fetch blocks (entities that are "Block" type - top level with children)
  const { data: instances } = useSWR('/api/assets/instances?limit=100');
  const blocks = (instances?.data ?? []).filter((e: any) =>
    e.name?.toLowerCase().includes('block') || e.attributes?.grade
  );

  // Recent submissions tracking
  const [recentSubmissions, setRecentSubmissions] = useState<Array<{stage: string; filter: string; block?: string; time: string}>>([]);

  const handleStageClick = (stage: typeof STAGES[0]) => {
    setActiveStage(stage);
    setError('');
    setSuccess('');
    setScanValue('');
    setRemarks('');
    if (stage.needsBlock) {
      setStep('block');
      setSelectedBlock(null);
    } else {
      setStep('scan');
    }
  };

  const handleBlockSelect = (block: any) => {
    setSelectedBlock(block);
    setStep('scan');
  };

  const handleSubmit = async () => {
    if (!scanValue.trim() || !activeStage) return;
    setLoading(true);
    setError('');

    try {
      // 1. Lookup filter by scanned identifier
      let filterId = '';
      let filterName = '';
      try {
        const lookup = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(scanValue.trim())}`);
        if (lookup?.asset?.id) {
          filterId = lookup.asset.id;
          filterName = lookup.asset.name;

          // Verify filter belongs to selected block (if block was selected)
          if (selectedBlock && lookup.asset.parentId) {
            // Walk up parent chain to check if filter is under this block
            // For now just allow - the backend will validate
          }
        } else {
          setError('No filter found with this identifier');
          setLoading(false);
          return;
        }
      } catch {
        // Maybe it's a UUID
        if (scanValue.match(/^[0-9a-f]{8}-/i)) {
          filterId = scanValue.trim();
          filterName = scanValue.trim().slice(0, 8) + '...';
        } else {
          setError('Filter not found. Check identifier and try again.');
          setLoading(false);
          return;
        }
      }

      // 2. Check if filter has active cycle, if not start one
      const state = await apiClient.get<any>(`/api/filters/${filterId}/current-state`);

      if (!state.currentCycle) {
        // Start a new cycle
        try {
          await apiClient.post(`/api/filters/${filterId}/start-cycle`, {
            cleaningReasonKey: 'TYPE_C',
            cleaningAreaId: selectedBlock?.id,
          });
        } catch (e: any) {
          if (!e.message?.includes('CYCLE_ACTIVE')) {
            setError(e.message ?? 'Failed to start cycle');
            setLoading(false);
            return;
          }
        }
      }

      // 3. Advance to this stage
      try {
        await apiClient.post(`/api/filters/${filterId}/advance`, {
          targetState: activeStage.key,
          cleaningAreaId: selectedBlock?.id,
          remarks: remarks || `${activeStage.label} - Block: ${selectedBlock?.name ?? 'N/A'} - Scanned: ${scanValue}`,
        });
      } catch (e: any) {
        setError(e.message ?? 'Failed to advance stage');
        setLoading(false);
        return;
      }

      // 4. Success
      setSuccess(`✅ ${filterName} → ${activeStage.label} completed`);
      setRecentSubmissions(prev => [{
        stage: activeStage.label,
        filter: filterName,
        block: selectedBlock?.name,
        time: new Date().toLocaleTimeString(),
      }, ...prev].slice(0, 10));

      // Reset for next scan (stay on same stage for batch processing)
      setScanValue('');
      setRemarks('');

    } catch (e: any) {
      setError(e.message ?? 'Something went wrong');
    }
    setLoading(false);
  };

  const closeDialog = () => {
    setActiveStage(null);
    setSelectedBlock(null);
    setScanValue('');
    setRemarks('');
    setError('');
    setSuccess('');
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-100">Filter Cleaning Operations</h1>
        <p className="text-gray-400 mt-1">Select a cleaning stage to begin</p>
      </div>

      {/* Stage Blocks - 3x2 Grid */}
      <div className="grid grid-cols-3 gap-4">
        {STAGES.map((stage) => (
          <button
            key={stage.key}
            onClick={() => handleStageClick(stage)}
            className={`bg-gradient-to-br ${stage.color} border-2 ${stage.border} rounded-2xl p-6 text-center transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-cyan-900/20 active:scale-[0.98] cursor-pointer`}
          >
            <div className="text-4xl mb-3">{stage.icon}</div>
            <div className="text-white font-bold text-lg">{stage.label}</div>
            {stage.needsBlock && (
              <div className="text-white/50 text-[10px] mt-2 uppercase tracking-wider">Block Selection Required</div>
            )}
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

      {/* === STAGE DIALOG === */}
      {activeStage && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeDialog}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* Dialog Header */}
            <div className={`bg-gradient-to-r ${activeStage.color} px-6 py-4 flex items-center gap-3`}>
              <span className="text-3xl">{activeStage.icon}</span>
              <div>
                <h2 className="text-xl font-bold text-white">{activeStage.label}</h2>
                <p className="text-white/60 text-sm">
                  {step === 'block' ? 'Step 1: Select Block' : selectedBlock ? `Block: ${selectedBlock.name}` : 'Scan filter to submit'}
                </p>
              </div>
            </div>

            <div className="p-6 space-y-4">

              {/* Step 1: Block Selection (for Wash In, Dry In) */}
              {step === 'block' && (
                <>
                  <div className="text-sm text-gray-400 mb-2">Select the block where cleaning will happen:</div>
                  <div className="space-y-2">
                    {blocks.length === 0 && (
                      <div className="text-center py-6 text-gray-500">No blocks found. Create blocks in Assets first.</div>
                    )}
                    {blocks.map((block: any) => (
                      <button
                        key={block.id}
                        onClick={() => handleBlockSelect(block)}
                        className="w-full text-left px-4 py-4 bg-gray-700/50 hover:bg-gray-700 border-2 border-transparent hover:border-cyan-600 rounded-xl transition-all"
                      >
                        <div className="text-gray-100 font-semibold">{block.name}</div>
                        {block.attributes?.grade && (
                          <div className="text-xs text-gray-400 mt-0.5">{block.attributes.grade}</div>
                        )}
                      </button>
                    ))}
                  </div>
                  <button onClick={closeDialog} className="w-full py-3 bg-gray-700 text-gray-300 rounded-xl mt-2">Cancel</button>
                </>
              )}

              {/* Step 2: Scan Filter */}
              {step === 'scan' && (
                <>
                  {selectedBlock && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-cyan-900/30 border border-cyan-800 rounded-xl text-sm">
                      <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                      <span className="text-cyan-300">{selectedBlock.name}</span>
                      <button onClick={() => setStep('block')} className="ml-auto text-xs text-cyan-400 hover:text-cyan-300">Change</button>
                    </div>
                  )}

                  <div>
                    <label className="text-sm font-medium text-gray-400 mb-1 block">Scan Filter Barcode / QR</label>
                    <input
                      type="text"
                      className="w-full bg-gray-900 border-2 border-gray-600 rounded-xl px-4 py-4 text-gray-100 text-center font-mono text-xl placeholder:text-gray-600 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/30 outline-none"
                      placeholder="Scan or type identifier"
                      value={scanValue}
                      onChange={e => { setScanValue(e.target.value); setError(''); setSuccess(''); }}
                      onKeyDown={e => { if (e.key === 'Enter' && scanValue.trim()) handleSubmit(); }}
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-400 mb-1 block">Remarks (optional)</label>
                    <textarea
                      className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-2 text-gray-100 text-sm placeholder:text-gray-500"
                      rows={2}
                      placeholder="Any observations..."
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                    />
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-xl text-sm text-red-300 flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {error}
                    </div>
                  )}

                  {/* Success */}
                  {success && (
                    <div className="px-4 py-3 bg-green-900/30 border border-green-800 rounded-xl text-sm text-green-300 flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      {success}
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex gap-3">
                    <button onClick={closeDialog} className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl font-medium">Close</button>
                    <button
                      onClick={handleSubmit}
                      disabled={loading || !scanValue.trim()}
                      className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-green-500 transition-colors"
                    >
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit</>
                      )}
                    </button>
                  </div>

                  <p className="text-[11px] text-gray-500 text-center">
                    Scan another filter to submit to the same stage, or close to go back.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
