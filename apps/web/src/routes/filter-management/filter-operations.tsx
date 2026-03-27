import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const CLEANING_STAGES = [
  { key: 'TO_BE_CLEANED', label: 'To Be Cleaned', icon: '\ud83d\udea9', color: 'from-orange-800 to-orange-900', border: 'border-orange-600', activeBg: 'bg-orange-900/40', needsBlock: false },
  { key: 'WASH_IN', label: 'Wash In', icon: '\ud83d\udebf', color: 'from-sky-800 to-sky-900', border: 'border-sky-600', activeBg: 'bg-sky-900/40', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '\ud83d\udca7', color: 'from-sky-800 to-sky-950', border: 'border-sky-500', activeBg: 'bg-sky-900/40', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '\ud83c\udf21\ufe0f', color: 'from-amber-800 to-amber-900', border: 'border-amber-600', activeBg: 'bg-amber-900/40', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '\u2600\ufe0f', color: 'from-amber-800 to-amber-950', border: 'border-amber-500', activeBg: 'bg-amber-900/40', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '\ud83d\udce5', color: 'from-gray-700 to-gray-800', border: 'border-gray-500', activeBg: 'bg-gray-800/40', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '\ud83d\udce4', color: 'from-gray-700 to-gray-900', border: 'border-gray-400', activeBg: 'bg-gray-800/40', needsBlock: false },
  { key: 'READY_FOR_USE', label: 'Ready For Use', icon: '\u2705', color: 'from-green-800 to-green-900', border: 'border-green-600', activeBg: 'bg-green-900/40', needsBlock: false },
];

interface ChecklistQuestion {
  id: string;
  question: string;
  questionType: string;
  required: boolean;
  section: string | null;
  description: string | null;
  options: any[];
  sortOrder: number;
}

interface PendingChecklist {
  pipelineNodeId: string;
  checklistProfileId: string;
  checklistProfileName: string;
  questions: ChecklistQuestion[];
}

export function FilterOperationsPage() {
  const { data: instancesData } = useSWR('/api/assets/instances?limit=200', { refreshInterval: 10000 });

  const [mode, setMode] = useState<'operations' | 'status'>('operations');
  const [activeStage, setActiveStage] = useState<typeof CLEANING_STAGES[0] | null>(null);
  const [selectedStatusStage, setSelectedStatusStage] = useState<string | null>(null);
  const [step, setStep] = useState<'block' | 'scan'>('block');
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentSubmissions, setRecentSubmissions] = useState<Array<{stage: string; filter: string; block?: string; time: string}>>([]);
  const [submitting, setSubmitting] = useState(false); // double-submit guard

  // Cleaning reason selection
  const [reasonDialog, setReasonDialog] = useState<{ filterId: string; filterName: string; stage: typeof CLEANING_STAGES[0] } | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [justification, setJustification] = useState('');
  const { data: reasonsData } = useSWR('/api/filter/reasons');
  const cleaningReasons = (reasonsData as any)?.reasons ?? reasonsData ?? [];

  // Toast notification (appears at top, auto-dismisses)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  // Checklist state
  const [checklistDialog, setChecklistDialog] = useState<{
    filterId: string;
    filterName: string;
    checklists: PendingChecklist[];
  } | null>(null);
  const [checklistAnswers, setChecklistAnswers] = useState<Record<string, any>>({});
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState('');

  const allFilters = (instancesData?.data ?? []).filter((f: any) => f.filterSet || f.filterProfileId);

  const filterStateMap: Record<string, { state: string; name: string; set: string; id: string }> = {};
  allFilters.forEach((f: any) => {
    if (f.currentLifecycleState) {
      filterStateMap[f.id] = { state: f.currentLifecycleState, name: f.name, set: f.filterSet ?? '', id: f.id };
    }
  });

  const stageCounts: Record<string, number> = {};
  Object.values(filterStateMap).forEach(f => {
    stageCounts[f.state] = (stageCounts[f.state] ?? 0) + 1;
  });

  const filtersInStage = selectedStatusStage
    ? Object.values(filterStateMap).filter(f => f.state === selectedStatusStage)
    : [];

  const blocks = (instancesData?.data ?? []).filter((e: any) =>
    (e.name?.toLowerCase().includes('block') || e.name?.toLowerCase().includes('area') || e.attributes?.grade) && !e.filterProfileId && !e.filterSet
  );

  const handleStageClick = (stage: typeof CLEANING_STAGES[0]) => {
    setActiveStage(stage);
    setError(''); setScanValue(''); setRemarks('');
    if (stage.needsBlock) { setStep('block'); setSelectedBlock(null); }
    else { setStep('scan'); }
  };

  const handleBlockSelect = (block: any) => { setSelectedBlock(block); setStep('scan'); };

  const closeDialog = () => {
    setActiveStage(null); setSelectedBlock(null); setScanValue(''); setRemarks(''); setError('');
  };

  const handleSubmit = async () => {
    if (!scanValue.trim() || !activeStage || submitting) return;
    setLoading(true); setError(''); setSubmitting(true);

    try {
      // Step 1: Resolve filter
      let filterId = '';
      let filterName = '';

      try {
        const lookup = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(scanValue.trim())}`);
        if (lookup?.asset?.id) { filterId = lookup.asset.id; filterName = lookup.asset.name; }
      } catch { /* identifier not found, try name */ }

      if (!filterId) {
        const allInstances = instancesData?.data ?? [];
        const match = allInstances.find((a: any) => a.name?.toLowerCase() === scanValue.trim().toLowerCase());
        if (match) { filterId = match.id; filterName = match.name; }
      }

      if (!filterId) {
        if (scanValue.match(/^[0-9a-f]{8}-/i)) { filterId = scanValue.trim(); filterName = scanValue.slice(0, 8); }
        else { setError('Filter not found. Try entering the filter name (e.g. HEPA-A-001)'); setLoading(false); return; }
      }

      // Step 2: Get current state
      const state = await apiClient.get<any>(`/api/filters/${filterId}/current-state`);

      // Check if there's a pending checklist to fill first
      if (state.pendingChecklist && state.pendingChecklist.length > 0) {
        // Close the stage dialog, open checklist
        closeDialog();
        setChecklistDialog({
          filterId,
          filterName: filterName || state.filterName,
          checklists: state.pendingChecklist,
        });
        setChecklistAnswers({});
        setChecklistError('');
        setLoading(false);
        return;
      }

      const nextAllowed = state.nextAllowedStages ?? [];
      if (nextAllowed.length > 0 && !nextAllowed.includes(activeStage.key)) {
        const allowedLabels = nextAllowed.map((k: string) => CLEANING_STAGES.find(s => s.key === k)?.label ?? k).join(', ');
        setError(`${filterName || state.filterName} is at "${(state.currentState ?? 'START').replace(/_/g, ' ')}". Next allowed: ${allowedLabels}`);
        setLoading(false);
        return;
      }

      // Step 3: Start cycle if needed — show reason dialog
      if (!state.currentCycle) {
        closeDialog();
        setReasonDialog({ filterId, filterName: filterName || state.filterName, stage: activeStage });
        setSelectedReason(''); setJustification('');
        setLoading(false); setSubmitting(false);
        return;
      }

      // Step 4: Advance
      const advanceResult = await apiClient.post<any>(`/api/filters/${filterId}/advance`, {
        targetState: activeStage.key,
        cleaningAreaId: selectedBlock?.id,
        remarks: remarks || `${activeStage.label} - Block: ${selectedBlock?.name ?? 'N/A'} - ${scanValue}`,
      });

      const displayName = filterName || state.filterName || filterId.slice(0, 8);

      // Add to recent submissions
      setRecentSubmissions(prev => [{ stage: activeStage.label, filter: displayName, block: selectedBlock?.name, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
      mutate('/api/assets/instances?limit=200');

      // Close stage dialog immediately
      closeDialog();

      // Show success toast
      setToast({ type: 'success', message: `${displayName} \u2192 ${activeStage.label}` });

      // If there's a pending checklist after this stage, open it
      if (advanceResult?.pendingChecklist && advanceResult.pendingChecklist.length > 0) {
        setChecklistDialog({
          filterId,
          filterName: displayName,
          checklists: advanceResult.pendingChecklist,
        });
        setChecklistAnswers({});
        setChecklistError('');
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed');
    }
    setLoading(false); setSubmitting(false);
  };

  const handleReasonSubmit = async () => {
    if (!reasonDialog || !selectedReason || submitting) return;
    const reason = cleaningReasons.find((r: any) => r.key === selectedReason);
    if (reason?.requiresJustification && (!justification || justification.length < 10)) {
      setError('Justification required (min 10 characters)');
      return;
    }
    setLoading(true); setError(''); setSubmitting(true);
    try {
      await apiClient.post(`/api/filters/${reasonDialog.filterId}/start-cycle`, {
        cleaningReasonKey: selectedReason,
        cleaningJustification: justification || undefined,
        cleaningAreaId: selectedBlock?.id,
      });
      // Now advance to the target stage
      const advanceResult = await apiClient.post<any>(`/api/filters/${reasonDialog.filterId}/advance`, {
        targetState: reasonDialog.stage.key,
        cleaningAreaId: selectedBlock?.id,
        remarks: remarks || `${reasonDialog.stage.label} - ${reasonDialog.filterName}`,
      });
      setRecentSubmissions(prev => [{ stage: reasonDialog.stage.label, filter: reasonDialog.filterName, block: selectedBlock?.name, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10));
      mutate('/api/assets/instances?limit=200');
      setReasonDialog(null);
      setToast({ type: 'success', message: `${reasonDialog.filterName} \u2192 ${reasonDialog.stage.label}` });
      if (advanceResult?.pendingChecklist?.length > 0) {
        setChecklistDialog({ filterId: reasonDialog.filterId, filterName: reasonDialog.filterName, checklists: advanceResult.pendingChecklist });
        setChecklistAnswers({}); setChecklistError('');
      }
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    setLoading(false); setSubmitting(false);
  };

  const handleChecklistSubmit = async () => {
    if (!checklistDialog) return;
    setChecklistLoading(true); setChecklistError('');

    // Validate required questions
    for (const cl of checklistDialog.checklists) {
      for (const q of cl.questions) {
        if (q.required && (checklistAnswers[q.id] === undefined || checklistAnswers[q.id] === '')) {
          setChecklistError(`Please answer: "${q.question}"`);
          setChecklistLoading(false);
          return;
        }
      }
    }

    try {
      await apiClient.post(`/api/filters/${checklistDialog.filterId}/submit-checklist`, {
        answers: checklistAnswers,
      });
      setChecklistDialog(null);
      setChecklistAnswers({});
      setToast({ type: 'success', message: 'Checklist submitted successfully' });
      mutate('/api/assets/instances?limit=200');
    } catch (e: any) {
      setChecklistError(e.message ?? 'Failed to submit checklist');
    }
    setChecklistLoading(false);
  };

  const renderQuestionInput = (q: ChecklistQuestion) => {
    const value = checklistAnswers[q.id] ?? '';
    const onChange = (val: any) => setChecklistAnswers(prev => ({ ...prev, [q.id]: val }));

    switch (q.questionType) {
      case 'YES_NO':
        return (
          <div className="flex gap-2">
            {['Yes', 'No'].map(opt => (
              <button key={opt} onClick={() => onChange(opt)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${value === opt ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {opt}
              </button>
            ))}
          </div>
        );
      case 'YES_NO_NA':
        return (
          <div className="flex gap-2">
            {['Yes', 'No', 'N/A'].map(opt => (
              <button key={opt} onClick={() => onChange(opt)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${value === opt ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {opt}
              </button>
            ))}
          </div>
        );
      case 'PASS_FAIL':
        return (
          <div className="flex gap-2">
            {['Pass', 'Fail'].map(opt => (
              <button key={opt} onClick={() => onChange(opt)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${value === opt ? (opt === 'Pass' ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                {opt}
              </button>
            ))}
          </div>
        );
      case 'NUMERIC':
        return (
          <input type="number" value={value} onChange={e => onChange(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm focus:border-cyan-500 outline-none" placeholder="Enter value" />
        );
      case 'DROPDOWN':
        return (
          <select value={value} onChange={e => onChange(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm focus:border-cyan-500 outline-none">
            <option value="">Select...</option>
            {(Array.isArray(q.options) ? q.options : []).map((opt: any, i: number) => (
              <option key={i} value={typeof opt === 'string' ? opt : opt.value}>{typeof opt === 'string' ? opt : opt.label}</option>
            ))}
          </select>
        );
      case 'MULTI_SELECT':
        return (
          <div className="flex flex-wrap gap-2">
            {(Array.isArray(q.options) ? q.options : []).map((opt: any, i: number) => {
              const optVal = typeof opt === 'string' ? opt : opt.value;
              const optLabel = typeof opt === 'string' ? opt : opt.label;
              const selected = Array.isArray(value) && value.includes(optVal);
              return (
                <button key={i} onClick={() => {
                  const arr = Array.isArray(value) ? [...value] : [];
                  if (selected) onChange(arr.filter((v: string) => v !== optVal));
                  else onChange([...arr, optVal]);
                }}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${selected ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {optLabel}
                </button>
              );
            })}
          </div>
        );
      case 'TEXT':
      default:
        return (
          <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm focus:border-cyan-500 outline-none" placeholder="Enter answer" />
        );
    }
  };

  const selectedStageInfo = CLEANING_STAGES.find(s => s.key === selectedStatusStage);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium transition-all animate-in ${toast.type === 'success' ? 'bg-green-900 border border-green-600 text-green-200' : 'bg-red-900 border border-red-600 text-red-200'}`}>
          <span>{toast.type === 'success' ? '\u2713' : '\u2717'}</span>
          <span>{toast.message}</span>
        </div>
      )}

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

      {mode === 'operations' && (
        <>
          <p className="text-gray-400 text-sm -mt-4">Select a cleaning stage to process filters</p>
          <div className="grid grid-cols-4 gap-3">
            {CLEANING_STAGES.map((stage) => (
              <button key={stage.key} onClick={() => handleStageClick(stage)}
                className={`bg-gradient-to-br ${stage.color} border-2 ${stage.border} rounded-2xl p-6 text-center transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-cyan-900/20 active:scale-[0.98]`}>
                <div className="text-4xl mb-3">{stage.icon}</div>
                <div className="text-white font-bold text-lg">{stage.label}</div>
                {stage.needsBlock && <div className="text-white/50 text-[10px] mt-2 uppercase tracking-wider">Block Selection Required</div>}
              </button>
            ))}
          </div>

          {recentSubmissions.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent Submissions</h3>
              <div className="space-y-2">
                {recentSubmissions.map((sub, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-700/50 last:border-0 text-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-gray-400 w-20 shrink-0">{sub.time}</span>
                    <span className="text-gray-200 font-medium">{sub.filter}</span>
                    <span className="text-cyan-400">\u2192 {sub.stage}</span>
                    {sub.block && <span className="text-gray-500 text-xs">({sub.block})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'status' && (
        <>
          <p className="text-gray-400 text-sm -mt-4">Click a stage to see filters currently in that state</p>
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

      {/* Stage Dialog */}
      {activeStage && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeDialog}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className={`bg-gradient-to-r ${activeStage.color} px-6 py-4 flex items-center gap-3`}>
              <span className="text-3xl">{activeStage.icon}</span>
              <div>
                <h2 className="text-xl font-bold text-white">{activeStage.label}</h2>
                <p className="text-white/60 text-sm">
                  {step === 'block' ? 'Step 1: Select Block' : selectedBlock ? `Block: ${selectedBlock.name}` : 'Scan filter to proceed'}
                </p>
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
                    <label className="text-sm font-medium text-gray-400 mb-1 block">Enter Filter Name or Identifier</label>
                    <input type="text"
                      className="w-full bg-gray-900 border-2 border-gray-600 rounded-xl px-4 py-4 text-gray-100 text-center font-mono text-xl placeholder:text-gray-600 focus:border-cyan-500 outline-none"
                      placeholder="Filter name or identifier"
                      value={scanValue} onChange={e => { setScanValue(e.target.value); setError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter' && scanValue.trim()) handleSubmit(); }}
                      autoFocus />
                  </div>

                  <textarea className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-2 text-gray-100 text-sm placeholder:text-gray-500" rows={2}
                    placeholder="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} />
                  {error && <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-xl text-sm text-red-300">{error}</div>}
                  <div className="flex gap-3">
                    <button onClick={closeDialog} className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl">Cancel</button>
                    <button onClick={handleSubmit} disabled={loading || !scanValue.trim()}
                      className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-green-500 transition-colors">
                      {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                        <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit</>}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 text-center">Type filter name (e.g. HEPA-A-001) and press Enter or Submit</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cleaning Reason Dialog */}
      {reasonDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[55] p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-cyan-800 to-cyan-900 px-6 py-4">
              <h2 className="text-lg font-bold text-white">Select Cleaning Reason</h2>
              <p className="text-cyan-200/70 text-sm">{reasonDialog.filterName} &rarr; {reasonDialog.stage.label}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                {cleaningReasons.filter((r: any) => r.isActive !== false).map((r: any) => (
                  <button key={r.key} onClick={() => { setSelectedReason(r.key); setError(''); }}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all ${selectedReason === r.key ? 'bg-cyan-900/50 border-2 border-cyan-500' : 'bg-gray-700/50 border-2 border-transparent hover:border-gray-600'}`}>
                    <div className="text-sm font-medium text-gray-100">{r.name}</div>
                    {r.description && <div className="text-xs text-gray-500 mt-0.5">{r.description}</div>}
                    {r.requiresJustification && <div className="text-[10px] text-amber-500 mt-0.5">Requires justification</div>}
                  </button>
                ))}
              </div>
              {cleaningReasons.find((r: any) => r.key === selectedReason)?.requiresJustification && (
                <textarea className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-2 text-gray-100 text-sm placeholder:text-gray-500" rows={2}
                  placeholder="Justification (min 10 characters)" value={justification} onChange={e => setJustification(e.target.value)} />
              )}
              {error && <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-xl text-sm text-red-300">{error}</div>}
              <div className="flex gap-3">
                <button onClick={() => { setReasonDialog(null); setError(''); }} className="flex-1 py-3 bg-gray-700 text-gray-300 rounded-xl">Cancel</button>
                <button onClick={handleReasonSubmit} disabled={loading || !selectedReason}
                  className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-bold disabled:opacity-40 hover:bg-cyan-500 transition-colors flex items-center justify-center gap-2">
                  {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Start & Submit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Checklist Dialog — no backdrop click dismiss, no skip */}
      {checklistDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-purple-800 to-purple-900 px-6 py-4 flex items-center gap-3 shrink-0">
              <svg className="w-7 h-7 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <div>
                <h2 className="text-lg font-bold text-white">Checklist Required</h2>
                <p className="text-purple-200/70 text-sm">{checklistDialog.filterName}</p>
              </div>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {checklistDialog.checklists.map((cl) => (
                <div key={cl.pipelineNodeId}>
                  <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wider mb-3">{cl.checklistProfileName}</h3>
                  <div className="space-y-4">
                    {cl.questions.map((q, qi, arr) => {
                      const prevSection = qi > 0 ? arr[qi - 1].section : null;
                      const showSection = q.section && q.section !== prevSection;
                      return (
                        <div key={q.id}>
                          {showSection && (
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-2 mb-1 border-b border-gray-700 pb-1">{q.section}</div>
                          )}
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="text-gray-500 text-xs font-mono mt-0.5 w-5 shrink-0">{qi + 1}.</span>
                              <div className="flex-1">
                                <p className="text-sm text-gray-200">
                                  {q.question}
                                  {q.required && <span className="text-red-400 ml-1">*</span>}
                                </p>
                                {q.description && <p className="text-xs text-gray-500 mt-0.5">{q.description}</p>}
                              </div>
                            </div>
                            <div className="ml-7">
                              {renderQuestionInput(q)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {checklistError && <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-xl text-sm text-red-300">{checklistError}</div>}
            </div>
            <div className="px-6 py-4 border-t border-gray-700 shrink-0">
              <button onClick={handleChecklistSubmit} disabled={checklistLoading}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-purple-500 transition-colors">
                {checklistLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                  <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit Checklist</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
