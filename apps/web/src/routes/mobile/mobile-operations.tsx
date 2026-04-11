import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { useOffline } from '../../hooks/use-offline';
import { DryerDurationDialog } from '../filter-management/components/dryer-duration-dialog';

const STAGES = [
  { key: 'WASH_IN', label: 'Wash In', icon: '🚿', gradient: 'from-sky-500 to-sky-600', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '💧', gradient: 'from-sky-400 to-sky-500', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-600', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '🌡️', gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '☀️', gradient: 'from-amber-400 to-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '📥', gradient: 'from-slate-500 to-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '📤', gradient: 'from-slate-400 to-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', needsBlock: false },
];

type View = 'home' | 'status' | 'stage';

// Build identifier→filter map from identifiers list
function buildIdentifierMap(identifiers: any[]): Record<string, { filterId: string; filterName: string }> {
  const list = Array.isArray(identifiers) ? identifiers : [];
  const map: Record<string, { filterId: string; filterName: string }> = {};
  for (const ident of list) {
    if (ident.identifierValue && ident.assetId) {
      const entry = { filterId: ident.assetId, filterName: ident.asset?.name || ident.assetId };
      map[ident.identifierValue] = entry;
      map[ident.identifierValue.toUpperCase()] = entry;
      map[ident.identifierValue.toLowerCase()] = entry;
    }
  }
  return map;
}

export function MobileOperationsPage() {
  const { user, isLoading: authLoading, logout: authLogout } = useAuth();
  const { formatTime } = useDatetimeFormat();
  const { online, pendingCount, syncing, executeOrQueue, manualSync, cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();
  const mobileNav = useNavigate();

  if (!authLoading && !user) return <Navigate to="/m/login" replace />;

  const logout = async () => {
    await authLogout();
    mobileNav('/m/login', { replace: true });
  };

  const [view, setView] = useState<View>('home');
  const [activeStage, setActiveStage] = useState<typeof STAGES[0] | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [blockChangeDialog, setBlockChangeDialog] = useState<{ filterId: string; filterName: string; homeBlockId: string; homeBlockName: string; requestedBlockId: string; requestedBlockName: string } | null>(null);
  const [blockChangeReason, setBlockChangeReason] = useState('');
  const [blockChangeSubmitting, setBlockChangeSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recentOps, setRecentOps] = useState<Array<{ stage: string; filter: string; time: string; queued?: boolean }>>([]);

  // Dialogs
  const [reasonDialog, setReasonDialog] = useState<{ filterId: string; filterName: string; stage: string } | null>(null);
  const [selectedReason, setSelectedReason] = useState('');
  const [justification, setJustification] = useState('');
  const [equipDialog, setEquipDialog] = useState<{ filterId: string; filterName: string; stage: string; groups: any[]; cycleGroup?: any } | null>(null);
  const [selectedEquipGroup, setSelectedEquipGroup] = useState<any>(null);
  const [readings, setReadings] = useState<Record<string, number>>({});
  const [dryerDialog, setDryerDialog] = useState<{ filterId: string; filterName: string } | null>(null);
  const [dryerLoading, setDryerLoading] = useState(false);
  const [dryerError, setDryerError] = useState('');
  const [checklistDialog, setChecklistDialog] = useState<{ filterId: string; filterName: string; checklists: any[] } | null>(null);
  const [checklistAnswers, setChecklistAnswers] = useState<Record<string, any>>({});

  // Data — always fetch when online, cache for offline
  const { data: instancesData } = useSWR(online ? '/api/assets/instances?limit=500' : null, { refreshInterval: 15000 });
  const { data: templatesData } = useSWR(online ? '/api/assets/templates?limit=100' : null);
  const { data: reasonsData } = useSWR(online ? '/api/filters/reasons' : null);
  const { data: identifiersData } = useSWR(online ? '/api/assets/identifiers?limit=1000' : null);
  const [offlineFilters, setOfflineFilters] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  const [offlineReasons, setOfflineReasons] = useState<any[]>([]);
  const [dataCached, setDataCached] = useState(false);

  // Cache data when online for offline use
  useEffect(() => { if (instancesData?.data) cacheFilterData(instancesData.data); }, [instancesData]);
  useEffect(() => {
    if (identifiersData) {
      const map = buildIdentifierMap(identifiersData as any[]);
      if (Object.keys(map).length > 0) {
        cache('identifier-map', map);
      }
    }
  }, [identifiersData, cache]);
  useEffect(() => { if (templatesData?.data) cache('templates', templatesData.data); }, [templatesData, cache]);
  useEffect(() => { const r = (reasonsData as any)?.reasons ?? reasonsData; if (r) cache('cleaning-reasons', r); }, [reasonsData, cache]);

  // Track when all data is cached and ready for offline
  useEffect(() => {
    if (online && instancesData?.data && templatesData?.data && identifiersData && reasonsData) {
      setDataCached(true);
    }
  }, [online, instancesData, templatesData, identifiersData, reasonsData]);

  // Load cached data when offline
  useEffect(() => {
    if (!online) {
      getOfflineFilters().then(setOfflineFilters);
      getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? []));
      getCache<any[]>('cleaning-reasons').then(r => setOfflineReasons(r ?? []));
    }
  }, [online]);

  const cleaningReasons = online ? ((reasonsData as any)?.reasons ?? reasonsData ?? []) : offlineReasons;
  const templates = (online ? (templatesData?.data ?? []) : offlineTemplates) as any[];
  const instances = online ? ((instancesData?.data ?? []) as any[]) : offlineFilters;
  const filterTemplateId = templates.find((t: any) => t.name === 'Filter')?.id;
  const blockTemplateId = templates.find((t: any) => t.name === 'Block')?.id;
  const allFilters = instances.filter((f: any) => f.templateId === filterTemplateId && f.isActive !== false && f.status !== 'Retired');
  const blocks = instances.filter((i: any) => i.templateId === blockTemplateId);

  const stageCounts: Record<string, number> = {};
  allFilters.forEach((f: any) => { if (f.currentLifecycleState) stageCounts[f.currentLifecycleState] = (stageCounts[f.currentLifecycleState] ?? 0) + 1; });

  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); } }, [success]);
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 6000); return () => clearTimeout(t); } }, [error]);

  const openStage = (stage: typeof STAGES[0]) => {
    setActiveStage(stage);
    setView('stage');
    setScanValue(''); setRemarks(''); setError(''); setSuccess(''); setSelectedBlock(null);
  };

  const goHome = () => { setView('home'); setActiveStage(null); setReasonDialog(null); setEquipDialog(null); setChecklistDialog(null); setError(''); setSuccess(''); };

  const resolveFilter = async (): Promise<{ filterId: string; filterName: string } | null> => {
    let filterId = ''; let filterName = '';

    // Deduplicate RFID scan value (reader may repeat tag ID)
    let sv = scanValue.trim().toUpperCase();
    if (sv.length >= 6 && sv.length % 2 === 0) {
      const half = sv.length / 2;
      if (sv.substring(0, half) === sv.substring(half)) sv = sv.substring(0, half);
    }
    if (sv.length >= 9 && sv.length % 3 === 0) {
      const third = sv.length / 3;
      if (sv.substring(0, third) === sv.substring(third, third * 2) && sv.substring(0, third) === sv.substring(third * 2)) sv = sv.substring(0, third);
    }

    // Online: try identifier lookup API
    if (online) {
      try { const l = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(sv)}`); if (l?.asset?.id) { filterId = l.asset.id; filterName = l.asset.name; } } catch {}
    }

    // Try cached identifier map (works both online and offline)
    if (!filterId) {
      try {
        const map = await getCache<Record<string, { filterId: string; filterName: string }>>('identifier-map');
        if (map) {
          const match = map[sv] || map[sv.toUpperCase()] || map[sv.toLowerCase()] || map[scanValue.trim()];
          if (match) { filterId = match.filterId; filterName = match.filterName; }
        }
      } catch {}
    }

    // Fallback: match by filter name in cached instances
    if (!filterId) { const m = allFilters.find((a: any) => a.name?.toLowerCase() === sv.toLowerCase()); if (m) { filterId = m.id; filterName = m.name; } }
    if (!filterId && sv.match(/^[0-9a-f]{8}-/i)) { filterId = sv; filterName = sv.slice(0, 8); }
    if (!filterId) { setError('Filter not found. Ensure you scanned while online first to cache identifiers.'); return null; }
    return { filterId, filterName };
  };

  // Helper: detect network errors (fetch failures + CapacitorHttp native errors)
  const isNetworkError = (e: any): boolean => {
    if (!e) return false;
    const msg = String(e.message || e).toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')
      || msg.includes('failed to connect') || msg.includes('unable to resolve host')
      || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enetunreach')
      || e.name === 'TypeError';
  };

  // Queue the operation offline (used as fallback when network fails mid-operation)
  const queueOfflineAdvance = async (filterId: string, filterName: string) => {
    if (!activeStage) return;
    await executeOrQueue('advance', filterId, filterName, { targetState: activeStage.key, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${activeStage.label} - ${filterName}` }, activeStage.key);
    setSuccess(`${filterName} → ${activeStage.label} (queued)`);
    setRecentOps(prev => [{ stage: activeStage.key, filter: filterName, time: formatTime(new Date()), queued: true }, ...prev].slice(0, 20));
    setScanValue(''); setRemarks('');
  };

  const handleSubmit = async () => {
    if (!scanValue.trim() || !activeStage || loading) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const resolved = await resolveFilter();
      if (!resolved) { setLoading(false); return; }
      const { filterId, filterName } = resolved;

      if (!online) {
        await queueOfflineAdvance(filterId, filterName);
        setLoading(false); return;
      }

      // Online path — if any network call fails, fall back to offline queue
      let state: any;
      try {
        // Pass the selected cleaning area so the backend can pre-compute the
        // block-change status. This lets us show the "request block change"
        // popup up-front, before the wash-in reason dialog — instead of
        // surfacing it as a background error after the user already picked a reason.
        const csUrl = `/api/filters/${filterId}/current-state${selectedBlock?.id ? `?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}` : ''}`;
        state = await apiClient.get<any>(csUrl);
      } catch (e: any) {
        if (isNetworkError(e)) {
          // Network dropped — queue for later sync
          await queueOfflineAdvance(filterId, filterName);
          setLoading(false); return;
        }
        throw e;
      }

      // Up-front block verification. If the filter belongs to a different
      // block and there is no standing approval, show the request-block-change
      // popup now and stop — the user should never reach the reason dialog in
      // that case.
      if (state.blockChangeStatus === 'REQUIRED' && state.homeBlock && selectedBlock?.id) {
        setBlockChangeDialog({
          filterId,
          filterName: filterName || state.filterName || scanValue,
          homeBlockId: state.homeBlock.id,
          homeBlockName: state.homeBlock.name,
          requestedBlockId: selectedBlock.id,
          requestedBlockName: selectedBlock.name,
        });
        setBlockChangeReason('');
        setLoading(false);
        return;
      }

      if (state.pendingChecklist?.length > 0) { setChecklistDialog({ filterId, filterName: filterName || state.filterName, checklists: state.pendingChecklist }); setChecklistAnswers({}); setLoading(false); return; }
      const nextAllowed = state.nextAllowedStages ?? [];
      if (nextAllowed.length > 0 && !nextAllowed.includes(activeStage.key)) { setError(`Next allowed: ${nextAllowed.map((k: string) => k.replace(/_/g, ' ')).join(', ')}`); setLoading(false); return; }
      if (!state.currentCycle) { setReasonDialog({ filterId, filterName: filterName || state.filterName, stage: activeStage.key }); setSelectedReason(''); setJustification(''); setLoading(false); return; }
      if (activeStage.key === 'DRY_IN') {
        const cyc = state.currentCycle ?? {};
        const startedAt = cyc.dryerStartedAt ? new Date(cyc.dryerStartedAt).getTime() : null;
        const durationMin: number | null = cyc.dryerDurationMinutes ?? null;
        if (!startedAt || !durationMin) {
          setDryerDialog({ filterId, filterName: filterName || state.filterName });
          setLoading(false); return;
        }
        const halfMs = (durationMin * 60_000) / 2;
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs < halfMs) {
          const remainingMin = Math.ceil((halfMs - elapsedMs) / 60_000);
          setError(`Dryer still running. Wait ${remainingMin} more minute(s).`);
          setLoading(false); return;
        }
        if (state.equipmentGroup) {
          setEquipDialog({ filterId, filterName: filterName || state.filterName, stage: activeStage.key, groups: [], cycleGroup: state.equipmentGroup });
          setSelectedEquipGroup(state.equipmentGroup); setReadings({}); setLoading(false); return;
        }
      }

      let result: any;
      try {
        result = await apiClient.post<any>(`/api/filters/${filterId}/advance`, { targetState: activeStage.key, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${activeStage.label} - ${filterName}` });
      } catch (e: any) {
        if (isNetworkError(e)) { await queueOfflineAdvance(filterId, filterName); setLoading(false); return; }
        throw e;
      }
      setSuccess(`${filterName || state.filterName} → ${activeStage.label}`);
      setRecentOps(prev => [{ stage: activeStage.key, filter: filterName || state.filterName, time: formatTime(new Date()) }, ...prev].slice(0, 20));
      setScanValue(''); setRemarks(''); mutate('/api/assets/instances?limit=500');
      if (result?.pendingChecklist?.length > 0) { setChecklistDialog({ filterId, filterName: filterName || state.filterName, checklists: result.pendingChecklist }); setChecklistAnswers({}); }
    } catch (e: any) {
      if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
        setBlockChangeDialog({ filterId: e.connectionInfo.filterId, filterName: scanValue, homeBlockId: e.connectionInfo.homeBlockId, homeBlockName: e.connectionInfo.homeBlockName, requestedBlockId: e.connectionInfo.requestedBlockId, requestedBlockName: e.connectionInfo.requestedBlockName });
        setBlockChangeReason(''); setLoading(false); return;
      }
      setError(e.message ?? 'Failed');
    }
    setLoading(false);
  };

  const handleReasonSubmit = async () => {
    if (!reasonDialog || !selectedReason) return;
    setLoading(true); setError('');
    try {
      const cyclePayload = { cleaningReasonKey: selectedReason, cleaningJustification: justification || undefined, cleaningAreaId: selectedBlock?.id };
      const { executed: cycleExecuted } = await executeOrQueue('start-cycle', reasonDialog.filterId, reasonDialog.filterName, cyclePayload);

      if (!cycleExecuted) {
        // Offline: also queue the advance after start-cycle
        await executeOrQueue('advance', reasonDialog.filterId, reasonDialog.filterName, { targetState: reasonDialog.stage, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${reasonDialog.stage.replace(/_/g, ' ')} - ${reasonDialog.filterName}` }, reasonDialog.stage);
        setSuccess(`${reasonDialog.filterName} → ${reasonDialog.stage.replace(/_/g, ' ')} (queued)`);
        setRecentOps(prev => [{ stage: reasonDialog.stage, filter: reasonDialog.filterName, time: formatTime(new Date()), queued: true }, ...prev].slice(0, 20));
        setScanValue(''); setRemarks(''); setReasonDialog(null); setLoading(false); return;
      }

      if (reasonDialog.stage === 'WASH_IN' && selectedBlock?.id) {
        try { const groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${selectedBlock.id}`); if (groups?.length) { setReasonDialog(null); setEquipDialog({ filterId: reasonDialog.filterId, filterName: reasonDialog.filterName, stage: reasonDialog.stage, groups }); setSelectedEquipGroup(null); setReadings({}); setLoading(false); return; } } catch {}
      }
      const { result } = await executeOrQueue('advance', reasonDialog.filterId, reasonDialog.filterName, { targetState: reasonDialog.stage, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${reasonDialog.stage.replace(/_/g, ' ')} - ${reasonDialog.filterName}` }, reasonDialog.stage);
      setSuccess(`${reasonDialog.filterName} → ${reasonDialog.stage.replace(/_/g, ' ')}`);
      setRecentOps(prev => [{ stage: reasonDialog.stage, filter: reasonDialog.filterName, time: formatTime(new Date()) }, ...prev].slice(0, 20));
      setScanValue(''); setRemarks(''); setReasonDialog(null); mutate('/api/assets/instances?limit=500');
      if (result?.pendingChecklist?.length > 0) { setChecklistDialog({ filterId: reasonDialog.filterId, filterName: reasonDialog.filterName, checklists: result.pendingChecklist }); setChecklistAnswers({}); }
    } catch (e: any) {
      if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
        setBlockChangeDialog({ filterId: e.connectionInfo.filterId, filterName: reasonDialog?.filterName ?? '', homeBlockId: e.connectionInfo.homeBlockId, homeBlockName: e.connectionInfo.homeBlockName, requestedBlockId: e.connectionInfo.requestedBlockId, requestedBlockName: e.connectionInfo.requestedBlockName });
        setBlockChangeReason(''); setReasonDialog(null); setLoading(false); return;
      }
      setError(e.message ?? 'Failed');
    }
    setLoading(false);
  };

  const handleDryerDurationSubmit = async (minutes: number) => {
    if (!dryerDialog || dryerLoading) return;
    setDryerLoading(true); setDryerError('');
    try {
      const payload = {
        targetState: 'DRY_IN',
        cleaningAreaId: selectedBlock?.id,
        dryerAction: 'SET_DURATION',
        dryerDurationMinutes: minutes,
        remarks: remarks || `Dryer started (${minutes} min) - ${dryerDialog.filterName}`,
      };
      const { executed } = await executeOrQueue('advance', dryerDialog.filterId, dryerDialog.filterName, payload, 'DRY_IN');
      setSuccess(`${dryerDialog.filterName} → Dryer running (${minutes} min)${executed ? '' : ' (queued)'}`);
      setRecentOps(prev => [{ stage: 'Dryer Started', filter: dryerDialog.filterName, time: formatTime(new Date()), queued: !executed }, ...prev].slice(0, 20));
      setScanValue(''); setRemarks(''); setDryerDialog(null);
      if (executed) mutate('/api/assets/instances?limit=500');
    } catch (e: any) {
      setDryerError(e.message ?? 'Failed to start dryer');
    }
    setDryerLoading(false);
  };

  const handleEquipSubmit = async () => {
    if (!equipDialog || !selectedEquipGroup) return;
    setLoading(true); setError('');
    try {
      const isDryerReadings = equipDialog.stage === 'DRY_IN';
      const advancePayload = { targetState: isDryerReadings ? 'DRY_OUT' : equipDialog.stage, cleaningAreaId: selectedBlock?.id, equipmentGroupId: selectedEquipGroup.id, instrumentReadings: readings, ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}), remarks: remarks || `${equipDialog.stage.replace(/_/g, ' ')} - ${equipDialog.filterName}` };
      const { executed, result } = await executeOrQueue('advance', equipDialog.filterId, equipDialog.filterName, advancePayload, equipDialog.stage);
      const queued = !executed;
      setSuccess(`${equipDialog.filterName} → ${equipDialog.stage.replace(/_/g, ' ')}${queued ? ' (queued)' : ''}`);
      setRecentOps(prev => [{ stage: equipDialog.stage, filter: equipDialog.filterName, time: formatTime(new Date()), queued }, ...prev].slice(0, 20));
      setScanValue(''); setRemarks(''); setEquipDialog(null); setSelectedEquipGroup(null); setReadings({});
      if (executed) mutate('/api/assets/instances?limit=500');
      if (result?.pendingChecklist?.length > 0) { setChecklistDialog({ filterId: equipDialog.filterId, filterName: equipDialog.filterName, checklists: result.pendingChecklist }); setChecklistAnswers({}); }
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    setLoading(false);
  };

  const handleChecklistSubmit = async () => {
    if (!checklistDialog) return;
    for (const cl of checklistDialog.checklists) { for (const q of cl.questions) { if (q.required && (checklistAnswers[q.id] === undefined || checklistAnswers[q.id] === '')) { setError(`Answer required: "${q.question}"`); return; } } }
    setLoading(true); setError('');
    try {
      const { executed } = await executeOrQueue('submit-checklist', checklistDialog.filterId, checklistDialog.filterName, { answers: checklistAnswers });
      setSuccess(`Checklist submitted${executed ? '' : ' (queued)'}`);
      setChecklistDialog(null); setChecklistAnswers({});
      if (executed) mutate('/api/assets/instances?limit=500');
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    setLoading(false);
  };

  const handleBlockChangeRequest = async () => {
    if (!blockChangeDialog) return;
    setBlockChangeSubmitting(true);
    try {
      await apiClient.post('/api/block-change-requests', {
        filterId: blockChangeDialog.filterId, filterName: blockChangeDialog.filterName,
        fromBlockId: blockChangeDialog.homeBlockId, fromBlockName: blockChangeDialog.homeBlockName,
        toBlockId: blockChangeDialog.requestedBlockId, toBlockName: blockChangeDialog.requestedBlockName,
        reason: blockChangeReason || undefined,
      });
      setSuccess('Block change request submitted. Waiting for approval.');
      setBlockChangeDialog(null); setScanValue('');
    } catch (e: any) { setError(e.message ?? 'Failed to submit request'); }
    setBlockChangeSubmitting(false);
  };

  const genOpts = (min: number, max: number, step: number): number[] => { const o: number[] = []; if (step <= 0) return o; for (let v = min, i = 0; v <= max + 1e-9 && i < 10000; v = Math.round((v + step) * 1e10) / 1e10, i++) o.push(v); return o; };

  return (
    <div className="h-[100dvh] flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 select-none overflow-hidden">
      {/* ─── HEADER ─── */}
      <div className="bg-white/80 backdrop-blur-lg border-b border-slate-200/60 px-4 py-3 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          {view !== 'home' && (
            <button onClick={goHome} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center active:bg-slate-200">
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
          )}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-extrabold shadow-lg shadow-cyan-500/20">DL</div>
          <div>
            <div className="text-sm font-bold text-slate-800 leading-tight">DigiLog</div>
            <div className="text-[10px] text-slate-400 leading-tight">{user?.fullName ?? user?.username}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${online ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
            {online ? 'Online' : 'Offline'}
          </div>
          {online && (
            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${dataCached ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-yellow-50 text-yellow-600 border border-yellow-200'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${dataCached ? 'bg-blue-500' : 'bg-yellow-400 animate-pulse'}`} />
              {dataCached ? 'Data Synced' : 'Syncing...'}
            </div>
          )}
          {pendingCount > 0 && (
            <button onClick={manualSync} disabled={!online || syncing} className="px-2 py-1 bg-amber-50 border border-amber-200 rounded-full text-[10px] text-amber-700 font-medium">
              {syncing ? '⟳' : pendingCount} {syncing ? 'Syncing' : 'pending'}
            </button>
          )}
        </div>
      </div>

      {/* Offline Banner */}
      {!online && <div className="mx-4 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700 flex items-center gap-2"><span>📡</span> Working offline — operations queued for sync</div>}

      {/* Toast */}
      {success && <div className="mx-4 mt-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium shadow-sm">✓ {success}</div>}
      {error && <div className="mx-4 mt-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 shadow-sm">{error}</div>}

      {/* ─── CONTENT ─── */}
      <div className="flex-1 overflow-y-auto">

        {/* ═══ HOME VIEW ═══ */}
        {view === 'home' && !reasonDialog && !equipDialog && !checklistDialog && (
          <div className="p-4 space-y-4">
            {/* Status Card */}
            <button onClick={() => setView('status')} className="w-full bg-white rounded-2xl border border-slate-200 p-5 shadow-sm active:shadow-none active:bg-slate-50 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                    <span className="text-2xl">📊</span>
                  </div>
                  <div className="text-left">
                    <div className="text-base font-bold text-slate-800">Filter Status</div>
                    <div className="text-xs text-slate-400">{allFilters.length} total filters</div>
                  </div>
                </div>
                <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {STAGES.slice(0, 3).map(s => (
                  <div key={s.key} className={`${s.bg} ${s.border} border rounded-lg px-2 py-1.5 text-center`}>
                    <div className={`text-lg font-bold ${s.text}`}>{stageCounts[s.key] ?? 0}</div>
                    <div className="text-[9px] text-slate-500">{s.label}</div>
                  </div>
                ))}
              </div>
            </button>

            {/* Stage Cards Grid */}
            <div className="grid grid-cols-2 gap-3">
              {STAGES.map(stage => (
                <button key={stage.key} onClick={() => openStage(stage)}
                  className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:shadow-none active:scale-[0.98] transition-all text-left">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${stage.gradient} flex items-center justify-center mb-3 shadow-lg shadow-slate-300/30`}>
                    <span className="text-3xl">{stage.icon}</span>
                  </div>
                  <div className="text-sm font-bold text-slate-800">{stage.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{stageCounts[stage.key] ?? 0} filter(s)</div>
                </button>
              ))}
            </div>

            {/* Logout */}
            <button onClick={logout} className="w-full py-3 bg-white border border-red-200 rounded-2xl text-sm font-medium text-red-600 active:bg-red-50 flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Logout
            </button>

            {/* Recent */}
            {recentOps.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">Recent Operations</h3>
                {recentOps.slice(0, 5).map((op, i) => (
                  <div key={i} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{STAGES.find(s => s.key === op.stage)?.icon ?? '⚙️'}</span>
                      <span className="text-xs text-slate-700 font-medium">{op.filter}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{op.time} {op.queued ? '⏳' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ STATUS VIEW ═══ */}
        {view === 'status' && (
          <div className="p-4 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Filter Status</h2>
            <div className="grid grid-cols-2 gap-3">
              {STAGES.map(s => (
                <div key={s.key} className={`bg-white border ${s.border} rounded-xl p-4`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.icon}</span>
                    <span className="text-xs font-semibold text-slate-600">{s.label}</span>
                  </div>
                  <div className={`text-2xl font-bold ${s.text}`}>{stageCounts[s.key] ?? 0}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-600">All Filters ({allFilters.length})</h3>
              {allFilters.map((f: any) => {
                const stageInfo = STAGES.find(s => s.key === f.currentLifecycleState);
                return (
                  <div key={f.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{f.name}</div>
                      {f.filterSet && <span className="text-[10px] text-slate-400">Set {f.filterSet.replace('SET_', '')}</span>}
                    </div>
                    <span className={`text-[10px] px-2.5 py-1 rounded-full border font-medium ${stageInfo ? `${stageInfo.bg} ${stageInfo.text} ${stageInfo.border}` : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                      {f.currentLifecycleState?.replace(/_/g, ' ') ?? 'Idle'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ STAGE OPERATION VIEW ═══ */}
        {view === 'stage' && activeStage && !reasonDialog && !equipDialog && !checklistDialog && (
          <div className="p-4 space-y-4">
            <div className={`bg-gradient-to-br ${activeStage.gradient} rounded-2xl p-5 shadow-lg`}>
              <div className="flex items-center gap-3">
                <span className="text-4xl">{activeStage.icon}</span>
                <div>
                  <div className="text-xl font-bold text-white">{activeStage.label}</div>
                  <div className="text-white/70 text-sm">{stageCounts[activeStage.key] ?? 0} filter(s) in this stage</div>
                </div>
              </div>
            </div>

            {/* Block Selection */}
            {activeStage.needsBlock && !selectedBlock && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-600">Select Block</h3>
                <div className="grid grid-cols-2 gap-2">
                  {blocks.map((b: any) => (
                    <button key={b.id} onClick={() => setSelectedBlock(b)}
                      className="bg-white border-2 border-slate-200 rounded-xl p-3 text-left active:border-cyan-500 active:bg-cyan-50 transition-colors">
                      <div className="text-sm font-semibold text-slate-700">{b.name}</div>
                    </button>
                  ))}
                  <button onClick={() => setSelectedBlock({ id: null, name: 'No Block' })}
                    className="bg-white border-2 border-dashed border-slate-200 rounded-xl p-3 text-left active:border-cyan-500">
                    <div className="text-sm text-slate-400">Skip Block</div>
                  </button>
                </div>
              </div>
            )}

            {/* Scan + Submit */}
            {(!activeStage.needsBlock || selectedBlock) && (
              <div className="space-y-3">
                {selectedBlock && (
                  <div className="flex items-center justify-between bg-cyan-50 border border-cyan-200 rounded-xl px-3 py-2">
                    <span className="text-xs text-cyan-700 font-medium">Block: {selectedBlock.name}</span>
                    <button onClick={() => setSelectedBlock(null)} className="text-[10px] text-cyan-600 underline">Change</button>
                  </div>
                )}

                <input type="text" value={scanValue} onChange={e => { setScanValue(e.target.value); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="Scan or type filter name..."
                  className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-4 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 shadow-sm" autoFocus />

                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Remarks (optional)" rows={2}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500" />

                <button onClick={handleSubmit} disabled={loading || !scanValue.trim()}
                  className={`w-full py-4 bg-gradient-to-r ${activeStage.gradient} text-white rounded-2xl font-bold text-base disabled:opacity-40 active:opacity-90 flex items-center justify-center gap-2 shadow-lg`}>
                  {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>✓ Submit</>}
                </button>
              </div>
            )}

            {/* Stage Recent */}
            {recentOps.filter(op => op.stage === activeStage.key).length > 0 && (
              <div className="space-y-1 mt-2">
                <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Recent {activeStage.label}</h3>
                {recentOps.filter(op => op.stage === activeStage.key).map((op, i) => (
                  <div key={i} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-700 font-medium">{op.filter}</span>
                    <span className="text-[10px] text-slate-400">{op.time} {op.queued ? '⏳' : '✓'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── DIALOGS ─── */}

      {/* Reason */}
      {reasonDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl animate-slide-up">
            <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-4 rounded-t-3xl"><h2 className="text-lg font-bold text-white">Cleaning Reason</h2><p className="text-cyan-100 text-sm">{reasonDialog.filterName}</p></div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              {cleaningReasons.filter((r: any) => r.isActive !== false).map((r: any) => (
                <button key={r.key} onClick={() => setSelectedReason(r.key)} className={`w-full text-left px-4 py-3 rounded-xl border-2 ${selectedReason === r.key ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200'}`}>
                  <div className="text-sm font-medium text-slate-800">{r.name}</div>
                  {r.requiresJustification && <div className="text-[10px] text-amber-600">Requires justification</div>}
                </button>
              ))}
              {cleaningReasons.find((r: any) => r.key === selectedReason)?.requiresJustification && (
                <textarea className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm" rows={2} placeholder="Justification (min 10 chars)" value={justification} onChange={e => setJustification(e.target.value)} />
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3"><button onClick={() => setReasonDialog(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium">Cancel</button><button onClick={handleReasonSubmit} disabled={loading || !selectedReason} className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-bold disabled:opacity-40">{loading ? 'Starting...' : 'Start'}</button></div>
          </div>
        </div>
      )}

      {/* Equipment */}
      {equipDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 rounded-t-3xl"><h2 className="text-lg font-bold text-white">{equipDialog.stage === 'DRY_IN' ? 'Dryer Temperature' : 'Equipment Readings'}</h2><p className="text-amber-100 text-sm">{equipDialog.filterName}</p></div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              {!equipDialog.cycleGroup && equipDialog.groups.map((g: any) => (
                <button key={g.id} onClick={() => { setSelectedEquipGroup(g); setReadings({}); }} className={`w-full text-left px-4 py-3 rounded-xl border-2 ${selectedEquipGroup?.id === g.id ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200'}`}>
                  <div className="text-sm font-medium text-slate-800">{g.name}</div>
                </button>
              ))}
              {selectedEquipGroup && (selectedEquipGroup.instruments ?? []).filter((i: any) => i.stageKey === equipDialog.stage).map((inst: any) => (
                <div key={inst.id}><label className="text-sm font-medium text-slate-700">{inst.description} ({inst.uom})</label>
                  <select value={readings[inst.id] ?? ''} onChange={e => setReadings(p => ({ ...p, [inst.id]: Number(e.target.value) }))} className="w-full mt-1 border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white">
                    <option value="">Select...</option>{genOpts(inst.operatingMin, inst.operatingMax, inst.leastCount).map(v => <option key={v} value={v}>{v} {inst.uom}</option>)}
                  </select></div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3"><button onClick={() => setEquipDialog(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium">Cancel</button><button onClick={handleEquipSubmit} disabled={loading || !selectedEquipGroup} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold disabled:opacity-40">{loading ? 'Submitting...' : 'Submit'}</button></div>
          </div>
        </div>
      )}

      <DryerDurationDialog
        open={!!dryerDialog}
        filterName={dryerDialog?.filterName ?? ''}
        loading={dryerLoading}
        error={dryerError}
        onClose={() => { setDryerDialog(null); setDryerError(''); }}
        onSubmit={handleDryerDurationSubmit}
      />

      {/* Checklist */}
      {checklistDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
            <div className="bg-gradient-to-r from-emerald-500 to-green-600 px-5 py-4 rounded-t-3xl"><h2 className="text-lg font-bold text-white">Checklist</h2><p className="text-emerald-100 text-sm">{checklistDialog.filterName}</p></div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {checklistDialog.checklists.map((cl: any) => (<div key={cl.pipelineNodeId}><h3 className="text-sm font-semibold text-slate-700 mb-3">{cl.checklistProfileName}</h3>
                {cl.questions.map((q: any) => (<div key={q.id} className="mb-4"><label className="text-sm text-slate-700 font-medium">{q.question} {q.required && <span className="text-red-500">*</span>}</label>
                  {['YES_NO', 'YES_NO_NA', 'PASS_FAIL'].includes(q.questionType) ? (
                    <div className="flex gap-2 mt-2">{(q.questionType === 'YES_NO' ? ['Yes', 'No'] : q.questionType === 'YES_NO_NA' ? ['Yes', 'No', 'N/A'] : ['Pass', 'Fail']).map((opt: string) => (
                      <button key={opt} onClick={() => setChecklistAnswers(p => ({ ...p, [q.id]: opt }))} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 ${checklistAnswers[q.id] === opt ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{opt}</button>
                    ))}</div>
                  ) : <input type={q.questionType === 'NUMERIC' ? 'number' : 'text'} value={checklistAnswers[q.id] ?? ''} onChange={e => setChecklistAnswers(p => ({ ...p, [q.id]: e.target.value }))} className="w-full mt-2 border border-slate-200 rounded-xl px-4 py-3 text-sm" placeholder="Enter answer..." />}
                </div>))}
              </div>))}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3"><button onClick={() => setChecklistDialog(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium">Cancel</button><button onClick={handleChecklistSubmit} disabled={loading} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold disabled:opacity-40">{loading ? 'Submitting...' : 'Submit'}</button></div>
          </div>
        </div>
      )}

      {/* Block Change Request Dialog */}
      {blockChangeDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Block Change Required</h3>
                  <p className="text-xs text-slate-400">This filter belongs to a different block</p>
                </div>
              </div>
              <div className="space-y-3 mb-5">
                <div className="bg-slate-50 rounded-xl p-3 text-sm">
                  <div className="text-slate-500">Filter: <span className="font-semibold text-slate-800">{blockChangeDialog.filterName}</span></div>
                  <div className="text-slate-500 mt-1">Home Block: <span className="font-semibold text-slate-800">{blockChangeDialog.homeBlockName}</span></div>
                  <div className="text-slate-500 mt-1">Requested Block: <span className="font-semibold text-amber-700">{blockChangeDialog.requestedBlockName}</span></div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Reason</label>
                  <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" rows={2}
                    value={blockChangeReason} onChange={e => setBlockChangeReason(e.target.value)}
                    placeholder="Why does this filter need to be cleaned in a different block?" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setBlockChangeDialog(null); setScanValue(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={handleBlockChangeRequest} disabled={blockChangeSubmitting}
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-cyan-500/25">
                  {blockChangeSubmitting ? 'Submitting...' : 'Request Change'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
