import { useState, useEffect, useMemo, useCallback } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useReauth } from '../../hooks/use-reauth';
import { ReauthDialog } from '../../components/reauth-dialog';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { StageScanDialog } from './components/stage-scan-dialog';
import { CleaningReasonDialog } from './components/cleaning-reason-dialog';
import { EquipmentDialog } from './components/equipment-dialog';
import { ChecklistDialog } from './components/checklist-dialog';
import { CLEANING_STAGES_OPS } from '../../lib/filter-constants';
import { ErrorPopup } from '../../components/ui/error-popup';
import type { FilterInstance, PaginatedResponse } from '../../types/filter';

const CLEANING_STAGES = CLEANING_STAGES_OPS;

interface PendingChecklist {
  pipelineNodeId: string;
  checklistProfileId: string;
  checklistProfileName: string;
  questions: {
    id: string;
    question: string;
    questionType: string;
    required: boolean;
    section: string | null;
    description: string | null;
    options: any[];
    sortOrder: number;
  }[];
}

export function FilterOperationsPage() {
  const { data: instancesData } = useSWR<PaginatedResponse<FilterInstance>>('/api/assets/instances?limit=200', { refreshInterval: 30000 });
  const { data: templatesData } = useSWR<PaginatedResponse<{ id: string; name: string }>>('/api/assets/templates?limit=100');
  const { formatDateTime, formatDate, formatTime } = useDatetimeFormat();
  const reauth = useReauth();

  const [mode, setMode] = useState<'operations' | 'status'>('operations');
  const [activeStage, setActiveStage] = useState<typeof CLEANING_STAGES[0] | null>(null);
  const [selectedStatusStage, setSelectedStatusStage] = useState<string | null>(null);
  const [step, setStep] = useState<'block' | 'scan'>('block');
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [popupError, setPopupError] = useState('');
  const [recentSubmissions, setRecentSubmissions] = useState<Array<{stage: string; filter: string; block?: string; time: string}>>([]);
  const [submitting, setSubmitting] = useState(false); // double-submit guard

  // Cleaning reason dialog state
  const [reasonDialog, setReasonDialog] = useState<{ filterId: string; filterName: string; stage: typeof CLEANING_STAGES[0]; block?: { id: string; name: string } } | null>(null);
  const [reasonError, setReasonError] = useState('');

  // Toast notification (appears at top, auto-dismisses)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  // Checklist state
  const [checklistDialog, setChecklistDialog] = useState<{
    filterId: string;
    filterName: string;
    checklists: PendingChecklist[];
  } | null>(null);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState('');

  // Equipment group & instrument readings state
  const [equipmentDialog, setEquipmentDialog] = useState<{
    filterId: string;
    filterName: string;
    stage: typeof CLEANING_STAGES[0];
    groups: any[];
    cycleEquipmentGroup?: any;
    block?: { id: string; name: string };
  } | null>(null);
  const [equipmentError, setEquipmentError] = useState('');
  const [equipmentLoading, setEquipmentLoading] = useState(false);

  const isLoading = !instancesData || !templatesData;

  // Include all active filter instances — profile may be assigned directly (filterProfileId)
  // or via config-based rules (BY_BLOCK, BY_AHU, etc.) which resolve server-side
  const allFilters = (instancesData?.data ?? []).filter((f: any) => f.template?.name === 'Filter' && f.isActive !== false && f.status !== 'Retired');

  const filterStateMap = useMemo(() => {
    const map: Record<string, { state: string; name: string; set: string; id: string }> = {};
    allFilters.forEach((f) => {
      if (f.currentLifecycleState) {
        map[f.id] = { state: f.currentLifecycleState, name: f.name, set: f.filterSet ?? '', id: f.id };
      }
    });
    return map;
  }, [allFilters]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(filterStateMap).forEach(f => {
      counts[f.state] = (counts[f.state] ?? 0) + 1;
    });
    return counts;
  }, [filterStateMap]);

  const filtersInStage = useMemo(() =>
    selectedStatusStage
      ? Object.values(filterStateMap).filter(f => f.state === selectedStatusStage)
      : [],
    [filterStateMap, selectedStatusStage]
  );

  const refreshFilters = useCallback(() => {
    mutate('/api/assets/instances?limit=200');
  }, []);

  const blockTemplateId = (templatesData?.data ?? []).find((t) => t.name === 'Block')?.id;
  const blocks = (instancesData?.data ?? []).filter((e) => e.templateId === blockTemplateId);

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
        else { setError('Filter not found. Try entering the filter name (e.g. HEPA-A-001)'); setLoading(false); setSubmitting(false); return; }
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
        setChecklistError('');
        setLoading(false); setSubmitting(false);
        return;
      }

      const nextAllowed = state.nextAllowedStages ?? [];
      if (nextAllowed.length > 0 && !nextAllowed.includes(activeStage.key)) {
        const allowedLabels = nextAllowed.map((k: string) => CLEANING_STAGES.find(s => s.key === k)?.label ?? k).join(', ');
        setError(`${filterName || state.filterName} is at "${(state.currentState ?? 'START').replace(/_/g, ' ')}". Next allowed: ${allowedLabels}`);
        setLoading(false); setSubmitting(false);
        return;
      }

      // Step 3: Start cycle if needed — show reason dialog
      if (!state.currentCycle) {
        const blockForReason = selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined;
        closeDialog();
        setReasonDialog({ filterId, filterName: filterName || state.filterName, stage: activeStage, block: blockForReason });
        setReasonError('');
        setLoading(false); setSubmitting(false);
        return;
      }

      // Step 3b: For DRY_IN with existing cycle — show equipment readings (Dryer Temperature)
      if (activeStage.key === 'DRY_IN' && state.equipmentGroup) {
        closeDialog();
        setEquipmentDialog({
          filterId,
          filterName: filterName || state.filterName,
          stage: activeStage,
          groups: [],
          cycleEquipmentGroup: state.equipmentGroup,
        });
        setEquipmentError('');
        setLoading(false); setSubmitting(false);
        return;
      }

      // Step 4: Advance (wrapped with reauth)
      const advanceBody = {
        targetState: activeStage.key,
        cleaningAreaId: selectedBlock?.id,
        remarks: remarks || `${activeStage.label} - Block: ${selectedBlock?.name ?? 'N/A'} - ${scanValue}`,
      };
      const displayName = filterName || state.filterName || filterId.slice(0, 8);
      const stageLabelCapture = activeStage.label;
      const blockNameCapture = selectedBlock?.name;

      const advanceResult = await apiClient.post<any>(`/api/filters/${filterId}/advance`, advanceBody);

      // Add to recent submissions
      setRecentSubmissions(prev => [{ stage: stageLabelCapture, filter: displayName, block: blockNameCapture, time: formatTime(new Date()) }, ...prev].slice(0, 10));
      refreshFilters();

      // Close stage dialog immediately
      closeDialog();

      // Show success toast
      setToast({ type: 'success', message: `${displayName} \u2192 ${stageLabelCapture}` });

      // If there's a pending checklist after this stage, open it
      if (advanceResult?.pendingChecklist && advanceResult.pendingChecklist.length > 0) {
        setChecklistDialog({
          filterId,
          filterName: displayName,
          checklists: advanceResult.pendingChecklist,
        });
        setChecklistError('');
      }
    } catch (e: any) {
      setPopupError(e.message ?? 'Failed');
    }
    setLoading(false); setSubmitting(false);
  };

  const handleReasonSubmit = async (reasonKey: string, justification?: string) => {
    if (!reasonDialog || !reasonKey || submitting) return;
    // Validate justification requirement by fetching reasons
    let reasons: any[] = [];
    try {
      const res = await apiClient.get<any>('/api/filters/reasons');
      reasons = res?.reasons ?? res ?? [];
    } catch { /* proceed */ }
    const reason = reasons.find((r: any) => r.key === reasonKey);
    if (reason?.requiresJustification && (!justification || justification.length < 10)) {
      setReasonError('Justification required (min 10 characters)');
      return;
    }
    const reasonBlock = reasonDialog.block;
    const dialogCapture = { ...reasonDialog, block: reasonBlock };
    setLoading(true); setReasonError(''); setSubmitting(true);
    await reauth.execute('START_CLEANING_CYCLE', async (password?) => {
      const startBody = {
        cleaningReasonKey: reasonKey,
        cleaningJustification: justification || undefined,
        cleaningAreaId: reasonBlock?.id,
      };
      if (password) await apiClient.postWithReauth(`/api/filters/${dialogCapture.filterId}/start-cycle`, startBody, password);
      else await apiClient.post(`/api/filters/${dialogCapture.filterId}/start-cycle`, startBody);

      // For WASH_IN: show equipment group selection before advancing
      if (dialogCapture.stage.key === 'WASH_IN' && reasonBlock?.id) {
        try {
          const groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${reasonBlock.id}`);
          if (groups && groups.length > 0) {
            setReasonDialog(null);
            setEquipmentDialog({
              filterId: dialogCapture.filterId,
              filterName: dialogCapture.filterName,
              stage: dialogCapture.stage,
              groups,
              block: reasonBlock,
            });
            setEquipmentError('');
            setLoading(false); setSubmitting(false);
            return;
          }
        } catch { /* no groups -- proceed normally */ }
      }

      // No equipment groups or not WASH_IN -- advance directly
      const advanceBody = {
        targetState: dialogCapture.stage.key,
        cleaningAreaId: reasonBlock?.id,
        remarks: remarks || `${dialogCapture.stage.label} - ${dialogCapture.filterName}`,
      };
      const advanceResult = password
        ? await apiClient.postWithReauth<any>(`/api/filters/${dialogCapture.filterId}/advance`, advanceBody, password)
        : await apiClient.post<any>(`/api/filters/${dialogCapture.filterId}/advance`, advanceBody);
      setRecentSubmissions(prev => [{ stage: dialogCapture.stage.label, filter: dialogCapture.filterName, block: reasonBlock?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
      refreshFilters();
      setReasonDialog(null);
      setToast({ type: 'success', message: `${dialogCapture.filterName} \u2192 ${dialogCapture.stage.label}` });
      if (advanceResult?.pendingChecklist?.length > 0) {
        setChecklistDialog({ filterId: dialogCapture.filterId, filterName: dialogCapture.filterName, checklists: advanceResult.pendingChecklist });
        setChecklistError('');
      }
    }, {
      onError: (e: unknown) => { setReasonError((e as any)?.message ?? 'Failed'); setPopupError((e as any)?.message ?? 'Failed'); },
    });
    setLoading(false); setSubmitting(false);
  };

  const handleEquipmentSubmit = async (groupId: string, readings: Record<string, number>) => {
    if (!equipmentDialog || equipmentLoading) return;
    setEquipmentLoading(true); setEquipmentError('');
    try {
      const advanceResult = await apiClient.post<any>(`/api/filters/${equipmentDialog.filterId}/advance`, {
        targetState: equipmentDialog.stage.key,
        cleaningAreaId: equipmentDialog.block?.id,
        equipmentGroupId: groupId,
        instrumentReadings: readings,
        remarks: remarks || `${equipmentDialog.stage.label} - ${equipmentDialog.filterName}`,
      });

      setRecentSubmissions(prev => [{ stage: equipmentDialog.stage.label, filter: equipmentDialog.filterName, block: equipmentDialog.block?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
      refreshFilters();
      setEquipmentDialog(null);
      setToast({ type: 'success', message: `${equipmentDialog.filterName} \u2192 ${equipmentDialog.stage.label}` });

      if (advanceResult?.pendingChecklist?.length > 0) {
        setChecklistDialog({ filterId: equipmentDialog.filterId, filterName: equipmentDialog.filterName, checklists: advanceResult.pendingChecklist });
        setChecklistError('');
      }
    } catch (e: any) { setEquipmentError(e.message ?? 'Failed to advance'); setPopupError(e.message ?? 'Failed to advance'); }
    setEquipmentLoading(false);
  };

  const handleChecklistSubmit = async (answers: Record<string, any>) => {
    if (!checklistDialog) return;
    setChecklistLoading(true); setChecklistError('');

    try {
      await apiClient.post(`/api/filters/${checklistDialog.filterId}/submit-checklist`, {
        answers,
      });
      setChecklistDialog(null);
      setToast({ type: 'success', message: 'Checklist submitted successfully' });
      refreshFilters();
    } catch (e: any) {
      setChecklistError(e.message ?? 'Failed to submit checklist');
      setPopupError(e.message ?? 'Failed to submit checklist');
    }
    setChecklistLoading(false);
  };

  const selectedStageInfo = CLEANING_STAGES.find(s => s.key === selectedStatusStage);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium transition-all animate-in ${toast.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          <span>{toast.type === 'success' ? '\u2713' : '\u2717'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Filter Operations</h1>
        <div className="flex bg-slate-100 rounded-xl p-1">
          <button onClick={() => { setMode('operations'); setSelectedStatusStage(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'operations' ? 'bg-cyan-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
            Cleaning
          </button>
          <button onClick={() => setMode('status')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'status' ? 'bg-cyan-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}>
            Filter Status
          </button>
        </div>
      </div>

      {mode === 'operations' && (
        <>
          <p className="text-slate-500 text-sm -mt-4">Select a cleaning stage to process filters</p>
          <div className="grid grid-cols-3 gap-3">
            {CLEANING_STAGES.map((stage) => (
              <button key={stage.key} onClick={() => handleStageClick(stage)}
                className={`bg-gradient-to-br ${stage.color} border-2 ${stage.border} rounded-2xl p-6 text-center transition-all hover:scale-[1.03] hover:shadow-lg hover:shadow-cyan-600/10 active:scale-[0.98]`}>
                <div className="text-4xl mb-3">{stage.icon}</div>
                <div className="text-white font-bold text-lg">{stage.label}</div>
                {stage.needsBlock && <div className="text-white/50 text-[10px] mt-2 uppercase tracking-wider">Block Selection Required</div>}
              </button>
            ))}
          </div>

          {recentSubmissions.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Recent Submissions</h3>
              <div className="space-y-2">
                {recentSubmissions.map((sub, i) => (
                  <div key={sub.filter + '-' + sub.stage + '-' + sub.time} className="flex items-center gap-3 py-2 border-b border-slate-200 last:border-0 text-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-slate-500 w-20 shrink-0">{sub.time}</span>
                    <span className="text-slate-700 font-medium">{sub.filter}</span>
                    <span className="text-cyan-600">\u2192 {sub.stage}</span>
                    {sub.block && <span className="text-slate-400 text-xs">({sub.block})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'status' && (
        <>
          <p className="text-slate-500 text-sm -mt-4">Click a stage to see filters currently in that state</p>
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
                  {isActive && <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-400 rounded-full border-2 border-white" />}
                </button>
              );
            })}
          </div>

          {selectedStatusStage && (
            <div className={`${selectedStageInfo?.activeBg ?? 'bg-slate-50'} border border-slate-200 rounded-2xl p-5`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">{selectedStageInfo?.icon}</span>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{selectedStageInfo?.label}</h2>
                  <p className="text-sm text-slate-500">{filtersInStage.length} filter(s)</p>
                </div>
              </div>
              {filtersInStage.length === 0 ? (
                <div className="text-center py-8 text-slate-400">No filters in this stage</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filtersInStage.map((filter) => (
                    <div key={filter.id} className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{filter.name}</span>
                        {filter.set && (
                          <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${filter.set === 'SET_A' ? 'bg-indigo-50 text-indigo-700' : 'bg-purple-50 text-purple-700'}`}>
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
      <StageScanDialog
        activeStage={activeStage}
        step={step}
        blocks={blocks}
        selectedBlock={selectedBlock}
        scanValue={scanValue}
        remarks={remarks}
        error={error}
        loading={loading}
        onScanValueChange={setScanValue}
        onRemarksChange={setRemarks}
        onClearError={() => setError('')}
        onBlockSelect={handleBlockSelect}
        onChangeBlock={() => setStep('block')}
        onSubmit={handleSubmit}
        onClose={closeDialog}
      />

      {/* Cleaning Reason Dialog */}
      <CleaningReasonDialog
        dialog={reasonDialog}
        onClose={() => { setReasonDialog(null); setReasonError(''); }}
        onSubmit={handleReasonSubmit}
        loading={loading}
        error={reasonError}
        onClearError={() => setReasonError('')}
      />

      {/* Equipment Group & Instrument Readings Dialog */}
      <EquipmentDialog
        dialog={equipmentDialog}
        onClose={() => { setEquipmentDialog(null); }}
        onSubmit={handleEquipmentSubmit}
        loading={equipmentLoading}
        error={equipmentError}
      />

      {/* Checklist Dialog */}
      <ChecklistDialog
        dialog={checklistDialog}
        onClose={() => { setChecklistDialog(null); }}
        onSubmit={handleChecklistSubmit}
        loading={checklistLoading}
        error={checklistError}
      />

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Filter Operation"
      />

      {/* Error Popup */}
      <ErrorPopup error={popupError} onClose={() => setPopupError('')} />
    </div>
  );
}
