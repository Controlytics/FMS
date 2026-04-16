import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useReauth } from '../../hooks/use-reauth';
import { ReauthDialog } from '../../components/reauth-dialog';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { StageScanDialog } from './components/stage-scan-dialog';
import { CleaningReasonDialog } from './components/cleaning-reason-dialog';
import { EquipmentDialog } from './components/equipment-dialog';
import { DryerDurationDialog } from './components/dryer-duration-dialog';
import { ChecklistDialog } from './components/checklist-dialog';
import { CLEANING_STAGES_OPS } from '../../lib/filter-constants';
import { ErrorPopup } from '../../components/ui/error-popup';
import { useOffline } from '../../hooks/use-offline';
import { onSyncEvent } from '../../lib/sync-engine';
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
  const navigate = useNavigate();
  const { stageKey: urlStageKey } = useParams<{ stageKey?: string }>();
  // Optional ?ahuId= query param lets other pages (e.g. My Tasks) deep-link
  // here with the list pre-filtered to an AHU's child filters.
  const [searchParams] = useSearchParams();
  const ahuIdFilter = searchParams.get('ahuId');
  const { formatDateTime, formatDate, formatTime } = useDatetimeFormat();
  const reauth = useReauth();
  const { online, pendingCount, syncing, executeOrQueue, manualSync, clearQueue, cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();
  const { data: instancesData, error: instancesError } = useSWR<PaginatedResponse<FilterInstance>>('/api/assets/instances?limit=500', { refreshInterval: online ? 30000 : 0 });
  const { data: templatesData, error: templatesError } = useSWR<PaginatedResponse<{ id: string; name: string }>>('/api/assets/templates?limit=100');
  const { data: identifiersData } = useSWR<any[]>(online ? '/api/assets/identifiers?limit=1000' : null);
  const { data: reasonsData } = useSWR<any>(online ? '/api/filters/reasons' : null);
  const { data: equipGroupsData } = useSWR<any>(online ? '/api/equipment-groups' : null);
  const isMobile = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

  // Offline fallback data
  const [offlineInstances, setOfflineInstances] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  const [offlineDataLoaded, setOfflineDataLoaded] = useState(false);

  // Cache filter data for offline use
  useEffect(() => { if (instancesData?.data) cacheFilterData(instancesData.data); }, [instancesData]);
  useEffect(() => { if (templatesData?.data) cache('templates', templatesData.data); }, [templatesData]);
  // Cache cleaning reasons for offline cycle start
  useEffect(() => { const r = (reasonsData as any)?.reasons ?? reasonsData; if (r) cache('cleaning-reasons', r); }, [reasonsData]);
  // Cache equipment groups for offline equipment/limits selection
  useEffect(() => { if (equipGroupsData) cache('equipment-groups', Array.isArray(equipGroupsData) ? equipGroupsData : equipGroupsData?.data ?? []); }, [equipGroupsData]);
  // Pre-cache current-state for all filters while online (so offline has full state)
  // Runs on page load and whenever instances data refreshes
  useEffect(() => {
    if (!online || !instancesData?.data) return;
    const filters = instancesData.data.filter((f: any) => {
      const isFilter = f.template?.name === 'Filter' || (filterTemplateId && f.templateId === filterTemplateId);
      return isFilter && f.isActive !== false && f.status !== 'Retired';
    });
    const cacheFilterStates = async () => {
      for (const f of filters) {
        try {
          const st = await apiClient.get<any>(`/api/filters/${f.id}/current-state`);
          cache(`filter-state-${f.id}`, {
            currentState: st.currentState ?? null,
            equipmentGroup: st.equipmentGroup ?? null,
            blockEquipmentGroups: st.blockEquipmentGroups ?? [],
            pendingChecklist: st.pendingChecklist ?? [],
            pipelineStages: st.pipelineStages ?? [],
            nextAllowedStages: st.nextAllowedStages ?? [],
            isPmDue: st.isPmDue ?? false,
            pmReasonKey: st.pmReasonKey ?? null,
            currentCycle: st.currentCycle ?? null,
            homeBlock: st.homeBlock ?? null,
            blockChangeStatus: st.blockChangeStatus ?? null,
          });
        } catch { break; } // stop on first failure
      }
    };
    const timer = setTimeout(cacheFilterStates, 2000);
    return () => clearTimeout(timer);
  }, [online, instancesData]);
  // Cache identifier map for offline RFID/tag lookup
  useEffect(() => {
    if (identifiersData) {
      const list = Array.isArray(identifiersData) ? identifiersData : [];
      const map: Record<string, { filterId: string; filterName: string }> = {};
      for (const ident of list) {
        if (ident.identifierValue && ident.assetId) {
          const entry = { filterId: ident.assetId, filterName: ident.asset?.name || ident.assetId };
          map[ident.identifierValue] = entry;
          map[ident.identifierValue.toUpperCase()] = entry;
          map[ident.identifierValue.toLowerCase()] = entry;
        }
      }
      if (Object.keys(map).length > 0) cache('identifier-map', map);
    }
  }, [identifiersData]);

  // Load cached data on mount + when going offline
  useEffect(() => {
    Promise.all([
      getOfflineFilters().then(setOfflineInstances),
      getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? [])),
    ]).finally(() => setOfflineDataLoaded(true));
  }, []);
  useEffect(() => {
    if (!online) {
      Promise.all([
        getOfflineFilters().then(setOfflineInstances),
        getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? [])),
      ]).finally(() => setOfflineDataLoaded(true));
    }
  }, [online]);

  // Refresh data after sync completes
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'complete' && event.synced && event.synced > 0) {
        mutate('/api/assets/instances?limit=500');
      }
    });
    return cleanup;
  }, []);

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

  // Scan queue (batch mode)
  const [scanQueue, setScanQueue] = useState<Array<{ filterId: string; filterName: string; tagId: string }>>([]);
  const [addingToQueue, setAddingToQueue] = useState(false);
  // Snapshot of queue while a shared dialog (reason/duration/equipment/checklist) is open
  const [pendingBatch, setPendingBatch] = useState<Array<{ filterId: string; filterName: string }> | null>(null);

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

  // Dryer duration state
  const [dryerDialog, setDryerDialog] = useState<{
    filterId: string;
    filterName: string;
    stage: typeof CLEANING_STAGES[0];
    block?: { id: string; name: string };
  } | null>(null);
  const [dryerLoading, setDryerLoading] = useState(false);
  const [dryerError, setDryerError] = useState('');

  // Block change request dialog state
  const [blockChangeDialog, setBlockChangeDialog] = useState<{
    filterId: string; filterName: string;
    homeBlockId: string; homeBlockName: string;
    requestedBlockId: string; requestedBlockName: string;
  } | null>(null);
  const [blockChangeReason, setBlockChangeReason] = useState('');
  const [blockChangeSubmitting, setBlockChangeSubmitting] = useState(false);
  // Saved cycle-start payload when equipment dialog is opened before cycle is started (offline flow)
  const [pendingCyclePayload, setPendingCyclePayload] = useState<Record<string, any> | null>(null);

  // If SWR fetch failed (network error), treat as offline — use cached data
  const swrFailed = !!(instancesError || templatesError);
  // When online and SWR hasn't failed, wait for server data.
  // When offline or SWR failed, wait for IndexedDB cache load to complete.
  const isLoading = (!swrFailed && online) ? (!instancesData || !templatesData) : !offlineDataLoaded;

  // Include all active filter instances — profile may be assigned directly (filterProfileId)
  // or via config-based rules (BY_BLOCK, BY_AHU, etc.) which resolve server-side.
  // When ?ahuId=X is present (deep-link from My Tasks), narrow to filters whose parentId matches.
  // Use SWR data when online, cached data when offline
  const instances = (instancesData?.data ?? offlineInstances) as any[];
  const templates = (templatesData?.data ?? offlineTemplates) as any[];

  // Find the Filter template ID — works with both online (template.name) and offline (templateId) data
  const filterTemplateId = templates.find((t: any) => t.name === 'Filter')?.id;

  const allFilters = instances.filter((f: any) => {
    // Match by template object (online) OR by templateId (offline cached data)
    const isFilter = f.template?.name === 'Filter' || (filterTemplateId && f.templateId === filterTemplateId);
    if (!isFilter || f.isActive === false || f.status === 'Retired') return false;
    if (ahuIdFilter && f.parentId !== ahuIdFilter) return false;
    return true;
  });

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
    mutate('/api/assets/instances?limit=500');
  }, []);

  const blockTemplateId = templates.find((t: any) => t.name === 'Block')?.id;
  const blocks = instances.filter((e: any) => e.templateId === blockTemplateId);

  const handleStageClick = (stage: typeof CLEANING_STAGES[0]) => {
    navigate(`/filters/stage/${stage.key}`);
  };

  const handleBlockSelect = (block: any) => { setSelectedBlock(block); setStep('scan'); };

  // Clear scan state without navigating (used when handing off to sub-dialogs)
  const clearScanState = () => {
    setScanValue(''); setRemarks(''); setError(''); setScanQueue([]);
  };
  // Close stage screen and go back to landing
  const closeDialog = () => {
    setActiveStage(null); setSelectedBlock(null); setScanValue(''); setRemarks(''); setError(''); setScanQueue([]);
    navigate('/filters');
  };

  // Sync URL stageKey → activeStage
  useEffect(() => {
    if (!urlStageKey) {
      setActiveStage(null);
      return;
    }
    const stage = CLEANING_STAGES.find(s => s.key === urlStageKey);
    if (!stage) { navigate('/filters'); return; }
    setActiveStage(stage);
    setError(''); setScanValue(''); setRemarks('');
    if (stage.needsBlock) { setStep('block'); setSelectedBlock(null); }
    else { setStep('scan'); setSelectedBlock(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStageKey]);

  // Resolve a tag/name → filterId+name
  // Uses API when online, cached identifier map when offline
  const resolveFilter = async (tagOrName: string): Promise<{ filterId: string; filterName: string } | null> => {
    let trimmed = tagOrName.trim().toUpperCase();
    // RFID dedup: reader may send the same tag 2x or 3x concatenated
    if (trimmed.length >= 6 && trimmed.length % 2 === 0) {
      const half = trimmed.length / 2;
      if (trimmed.substring(0, half) === trimmed.substring(half)) trimmed = trimmed.substring(0, half);
    }
    if (trimmed.length >= 9 && trimmed.length % 3 === 0) {
      const third = trimmed.length / 3;
      if (trimmed.substring(0, third) === trimmed.substring(third, third * 2) && trimmed.substring(0, third) === trimmed.substring(third * 2)) trimmed = trimmed.substring(0, third);
    }
    if (!trimmed) return null;

    // 1. Try API lookup (works when online)
    try {
      const lookup = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(trimmed)}`);
      if (lookup?.asset?.id) return { filterId: lookup.asset.id, filterName: lookup.asset.name };
    } catch { /* offline or network error — fall through */ }

    // 2. Try cached identifier map (works offline — built from identifiers API and stored in IndexedDB)
    try {
      const identifierMap = await getCache<Record<string, { filterId: string; filterName: string }>>('identifier-map');
      if (identifierMap) {
        const entry = identifierMap[trimmed] || identifierMap[trimmed.toUpperCase()] || identifierMap[trimmed.toLowerCase()];
        if (entry) return entry;
      }
    } catch { /* IndexedDB error — fall through */ }

    // 3. Try matching by filter name
    const match = instances.find((a: any) => a.name?.toLowerCase() === trimmed.toLowerCase());
    if (match) return { filterId: match.id, filterName: match.name };
    return null;
  };

  const handleAddToQueue = async (tagOrName: string) => {
    if (addingToQueue) return;
    setAddingToQueue(true); setError('');
    try {
      const resolved = await resolveFilter(tagOrName);
      if (!resolved) {
        setError(`Filter not found: ${tagOrName}`);
        setAddingToQueue(false);
        return;
      }
      if (scanQueue.some(q => q.filterId === resolved.filterId)) {
        setError(`${resolved.filterName} already in queue`);
        setAddingToQueue(false);
        return;
      }
      setScanQueue(prev => [...prev, { ...resolved, tagId: tagOrName }]);
    } catch (e: any) {
      setError(e.message ?? 'Failed to add to queue');
    }
    setAddingToQueue(false);
  };

  const handleRemoveFromQueue = (filterId: string) => {
    setScanQueue(prev => prev.filter(q => q.filterId !== filterId));
  };

  // Loop the batch advancing each filter with shared params
  const advanceBatch = async (
    batch: Array<{ filterId: string; filterName: string }>,
    extraBody: Record<string, any>,
    overrideTargetState?: string,
  ) => {
    if (!activeStage) return;
    const stageLabel = activeStage.label;
    const blockId = selectedBlock?.id;
    const blockName = selectedBlock?.name;
    let success = 0;
    const failed: string[] = [];
    const newSubmissions: Array<{stage: string; filter: string; block?: string; time: string}> = [];
    for (const item of batch) {
      try {
        const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, {
          targetState: overrideTargetState ?? activeStage.key,
          cleaningAreaId: blockId,
          remarks: remarks || `${stageLabel} - Batch - ${item.filterName}`,
          ...extraBody,
        }, overrideTargetState ?? activeStage.key);
        success++;
        // Update cached pipeline state after offline advance
        if (!executed) await updateCachedStateAfterAdvance(item.filterId, overrideTargetState ?? activeStage.key, false);
        newSubmissions.push({ stage: stageLabel + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
      } catch (e: any) {
        if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
          setBlockChangeDialog({
            filterId: e.connectionInfo.filterId ?? item.filterId,
            filterName: item.filterName,
            homeBlockId: e.connectionInfo.homeBlockId,
            homeBlockName: e.connectionInfo.homeBlockName,
            requestedBlockId: e.connectionInfo.requestedBlockId,
            requestedBlockName: e.connectionInfo.requestedBlockName,
          });
          setBlockChangeReason('');
          failed.push(`${item.filterName}: Block change approval required`);
        } else {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
    }
    setRecentSubmissions(prev => [...newSubmissions, ...prev].slice(0, 10));
    refreshFilters();
    // Gap 20: Refresh offline cached data after queued operations
    if (newSubmissions.some(s => s.stage.includes('queued'))) {
      getOfflineFilters().then(setOfflineInstances);
    }
    if (failed.length > 0 && !blockChangeDialog) {
      setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
    } else if (failed.length === 0) {
      setToast({ type: 'success', message: `${success} filter(s) → ${stageLabel}` });
    }
  };

  // After an offline advance, update cached filter state to reflect new stage
  const updateCachedStateAfterAdvance = async (filterId: string, newStageKey: string, cycleStarted?: boolean) => {
    try {
      const cachedState = await getCache<any>(`filter-state-${filterId}`) ?? {};
      const pipeline: any[] = (cachedState.pipelineStages ?? [])
        .filter((s: any) => s.stateKey)
        .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      // Compute new nextAllowedStages from sorted pipeline
      const currentIdx = pipeline.findIndex((s: any) => s.stateKey === newStageKey);
      const nextAllowed = (currentIdx >= 0 && currentIdx < pipeline.length - 1)
        ? [pipeline[currentIdx + 1].stateKey] : [];

      cache(`filter-state-${filterId}`, {
        ...cachedState,
        currentState: newStageKey,
        nextAllowedStages: nextAllowed,
        pendingChecklist: [], // cleared after advance — server recomputes on sync
        currentCycle: cachedState.currentCycle ?? (cycleStarted ? { id: `offline-cycle-${Date.now()}` } : null),
      });

      // Also update the filter instance's local state
      const { updateFilterStateLocally } = await import('@/lib/offline-store');
      await updateFilterStateLocally(filterId, newStageKey, cycleStarted);
    } catch { /* ignore cache update errors */ }
  };

  const handleSubmitBatch = async () => {
    if (scanQueue.length === 0 || !activeStage || submitting) return;
    setLoading(true); setSubmitting(true); setError('');
    try {
      // Try to inspect first filter's state to decide which dialog to show.
      // When offline, skip state inspection and queue the advance directly.
      const first = scanQueue[0];
      // Try to get filter state from API; if offline, build from cached data
      let state: any = null;
      const csQuery = selectedBlock?.id ? `?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}` : '';
      try {
        state = await apiClient.get<any>(`/api/filters/${first.filterId}/current-state${csQuery}`);
        // Cache the state for offline use (match mobile's cache shape)
        cache(`filter-state-${first.filterId}`, {
          equipmentGroup: state.equipmentGroup ?? null,
          pendingChecklist: state.pendingChecklist ?? [],
          pipelineStages: state.pipelineStages ?? [],
          isPmDue: state.isPmDue ?? false,
          pmReasonKey: state.pmReasonKey ?? null,
          currentCycle: state.currentCycle ?? null,
        });
      } catch (fetchErr: any) {
        const msg = String(fetchErr?.message || '').toLowerCase();
        const isNetErr = (fetchErr instanceof TypeError && msg.includes('fetch'))
          || msg.includes('failed to fetch') || msg.includes('networkerror')
          || msg.includes('load failed') || msg.includes('econnrefused');
        if (!isNetErr) throw fetchErr;

        // ===== OFFLINE PATH =====
        // Use the LAST CACHED current-state response for this filter.
        // This was cached during the previous online session when handleSubmitBatch
        // or the pre-cache loop fetched /current-state successfully.
        const cachedFilter = instances.find((f: any) => f.id === first.filterId);
        const cachedState = await getCache<any>(`filter-state-${first.filterId}`);

        if (cachedState) {
          // We have a full cached state from a previous online fetch — use it directly
          state = {
            ...cachedState,
            currentState: cachedFilter?.currentLifecycleState ?? cachedState.currentState ?? null,
            currentCycle: cachedState.currentCycle ?? (cachedFilter?.currentCycleId ? { id: cachedFilter.currentCycleId } : null),
            blockChangeStatus: null,
          };
        } else {
          // No cached state at all — we CANNOT safely determine the pipeline.
          // Use minimal state: check if filter has a cycle, and let the server
          // validate everything on sync.
          const hasCycle = !!cachedFilter?.currentCycleId;
          state = {
            currentState: cachedFilter?.currentLifecycleState || null,
            currentCycle: hasCycle ? { id: cachedFilter.currentCycleId } : null,
            nextAllowedStages: [],
            pendingChecklist: [],
            equipmentGroup: null,
            isPmDue: false,
            pmReasonKey: null,
            blockChangeStatus: null,
          };

          // Try to resolve equipment group from cached groups for this block
          if (selectedBlock?.id) {
            try {
              const cachedGroups = await getCache<any[]>('equipment-groups') ?? [];
              const blockGroups = cachedGroups.filter((g: any) => g.blockId === selectedBlock.id);
              if (blockGroups.length === 1) state.equipmentGroup = blockGroups[0];
            } catch { /* ignore */ }
          }
        }
      }

      // Gap 9: Proactive block change check (before any dialogs)
      if (state.blockChangeStatus === 'REQUIRED' && state.homeBlock && selectedBlock?.id) {
        setBlockChangeDialog({
          filterId: first.filterId,
          filterName: first.filterName,
          homeBlockId: state.homeBlock.id,
          homeBlockName: state.homeBlock.name,
          requestedBlockId: selectedBlock.id,
          requestedBlockName: selectedBlock.name,
        });
        setBlockChangeReason('');
        setLoading(false); setSubmitting(false);
        return;
      }

      const nextAllowed = state.nextAllowedStages ?? [];
      if (nextAllowed.length > 0 && !nextAllowed.includes(activeStage.key)) {
        const allowedLabels = nextAllowed.map((k: string) => CLEANING_STAGES.find(s => s.key === k)?.label ?? k).join(', ');
        setError(`${first.filterName} is at "${(state.currentState ?? 'START').replace(/_/g, ' ')}". Next allowed: ${allowedLabels}`);
        setLoading(false); setSubmitting(false);
        return;
      }

      // If there is a pending checklist already pending → batch checklist dialog
      if (state.pendingChecklist && state.pendingChecklist.length > 0) {
        const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
        setPendingBatch(batch);
        clearScanState();
        setChecklistDialog({ filterId: first.filterId, filterName: `${batch.length} filter(s)`, checklists: state.pendingChecklist });
        setChecklistError('');
        setLoading(false); setSubmitting(false);
        return;
      }

      // Need cycle start
      if (!state.currentCycle) {
        // Gap 7: PM auto-start — if filter's AHU has an active PM schedule, auto-start with PM reason
        if (state.isPmDue && state.pmReasonKey) {
          const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          const blockId = selectedBlock?.id;
          for (const item of batch) {
            const cyclePayload = { cleaningReasonKey: state.pmReasonKey, cleaningAreaId: blockId };
            const advancePayload = { targetState: activeStage.key, cleaningAreaId: blockId, remarks: remarks || `${activeStage.label} - ${item.filterName} (PM auto)` };
            await executeOrQueue('start-and-advance', item.filterId, item.filterName, { cyclePayload, advancePayload } as any, activeStage.key);
          }
          setToast({ type: 'success', message: `${batch.length} filter(s) → ${activeStage.label} (PM auto)` });
          clearScanState();
          refreshFilters();
          setLoading(false); setSubmitting(false);
          return;
        }

        // No PM — show reason dialog
        const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
        setPendingBatch(batch);
        const blockForReason = selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined;
        clearScanState();
        setReasonDialog({ filterId: first.filterId, filterName: `${batch.length} filter(s)`, stage: activeStage, block: blockForReason });
        setReasonError('');
        setLoading(false); setSubmitting(false);
        return;
      }

      // DRY_IN special two-step dryer flow
      if (activeStage.key === 'DRY_IN') {
        const cyc = state.currentCycle ?? {};
        const startedAt = cyc.dryerStartedAt ? new Date(cyc.dryerStartedAt).getTime() : null;
        const durationMin: number | null = cyc.dryerDurationMinutes ?? null;

        if (!startedAt || !durationMin) {
          // Step 1: ask for duration (shared)
          const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          setDryerDialog({
            filterId: first.filterId,
            filterName: `${batch.length} filter(s)`,
            stage: activeStage,
            block: selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined,
          });
          setDryerError('');
          setLoading(false); setSubmitting(false);
          return;
        }

        const halfMs = (durationMin * 60_000) / 2;
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs < halfMs) {
          const remainingMin = Math.ceil((halfMs - elapsedMs) / 60_000);
          setPopupError(`Dryer still running. Wait ${remainingMin} more minute(s) before entering temperature readings.`);
          setLoading(false); setSubmitting(false);
          return;
        }

        if (state.equipmentGroup) {
          // Step 2: shared temperature/readings dialog
          const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          setEquipmentDialog({
            filterId: first.filterId,
            filterName: `${batch.length} filter(s)`,
            stage: activeStage,
            groups: [],
            cycleEquipmentGroup: state.equipmentGroup,
            block: selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined,
          });
          setEquipmentError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      }

      // Check if equipment group has instruments for this stage — show readings dialog if so
      if (state.equipmentGroup && selectedBlock?.id) {
        const instruments = state.equipmentGroup.instruments ?? [];
        const stageInstruments = instruments.filter((i: any) => i.stageKey === activeStage.key);
        if (stageInstruments.length > 0) {
          const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          setEquipmentDialog({
            filterId: first.filterId,
            filterName: `${batch.length} filter(s)`,
            stage: activeStage,
            groups: [],
            cycleEquipmentGroup: state.equipmentGroup,
            block: selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined,
          });
          setEquipmentError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      }

      // No dialog needed → advance the whole batch
      const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
      await advanceBatch(batch, {});
      // Stay on the stage screen; clear queue so user can scan more
      clearScanState();
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

    // BATCH MODE: start cycle for every filter in the snapshot.
    // For WASH_IN with equipment groups on the block, pause after start-cycle
    // and hand off to the equipment-group / limits dialog (which will run the
    // batch advance). For every other stage, advance immediately.
    if (pendingBatch && pendingBatch.length > 0 && reasonDialog.stage) {
      const batch = pendingBatch;
      const stage = reasonDialog.stage;
      const blockId = reasonDialog.block?.id;
      const blockName = reasonDialog.block?.name;
      const block = reasonDialog.block;
      setLoading(true); setReasonError(''); setSubmitting(true);
      await reauth.execute('START_CLEANING_CYCLE', async (password?) => {
        const startBody = { cleaningReasonKey: reasonKey, cleaningJustification: justification || undefined, cleaningAreaId: blockId };

        // 1) Start cycle for every filter in the batch
        let started = 0; const startFailed: string[] = [];
        for (const item of batch) {
          try {
            await executeOrQueue('start-cycle', item.filterId, item.filterName, startBody);
            started++;
          } catch (e: any) {
            if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
              setBlockChangeDialog({
                filterId: e.connectionInfo.filterId ?? item.filterId,
                filterName: item.filterName,
                homeBlockId: e.connectionInfo.homeBlockId,
                homeBlockName: e.connectionInfo.homeBlockName,
                requestedBlockId: e.connectionInfo.requestedBlockId,
                requestedBlockName: e.connectionInfo.requestedBlockName,
              });
              setBlockChangeReason('');
              setReasonDialog(null);
              setPendingBatch(null);
              refreshFilters();
              setLoading(false); setSubmitting(false);
              return;
            }
            startFailed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
          }
        }
        if (startFailed.length > 0) {
          setPopupError(`${started} cycle(s) started, ${startFailed.length} failed:\n${startFailed.join('\n')}`);
          setReasonDialog(null);
          setPendingBatch(null);
          refreshFilters();
          return;
        }

        // 2) WASH_IN + block selected → check for equipment groups; if any,
        //    hand off to equipment/limits dialog (keeps pendingBatch set).
        if (stage.key === 'WASH_IN' && blockId && block) {
          let groups: any[] = [];
          try {
            groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${blockId}`) ?? [];
          } catch {
            // Offline: use cached equipment groups filtered by block
            try {
              const cachedGroups = await getCache<any[]>('equipment-groups') ?? [];
              groups = cachedGroups.filter((g: any) => g.blockId === blockId);
            } catch { /* no cached groups */ }
          }
          if (groups.length > 0) {
            setReasonDialog(null);
            setEquipmentDialog({
              filterId: batch[0].filterId,
              filterName: `${batch.length} filter(s)`,
              stage,
              groups,
              block,
            });
            setEquipmentError('');
            return; // pendingBatch stays set — equipment dialog handles advance
          }
        }

        // 3) No equipment dialog needed → advance the whole batch now
        let success = 0; const failed: string[] = [];
        const newSubs: typeof recentSubmissions = [];
        for (const item of batch) {
          try {
            const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, {
              targetState: stage.key,
              cleaningAreaId: blockId,
              remarks: remarks || `${stage.label} - Batch - ${item.filterName}`,
            }, stage.key);
            success++;
            newSubs.push({ stage: stage.label + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
          } catch (e: any) {
            if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
              setBlockChangeDialog({
                filterId: e.connectionInfo.filterId ?? item.filterId,
                filterName: item.filterName,
                homeBlockId: e.connectionInfo.homeBlockId,
                homeBlockName: e.connectionInfo.homeBlockName,
                requestedBlockId: e.connectionInfo.requestedBlockId,
                requestedBlockName: e.connectionInfo.requestedBlockName,
              });
              setBlockChangeReason('');
              setReasonDialog(null); setPendingBatch(null); refreshFilters();
              return;
            }
            failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
          }
        }
        setRecentSubmissions(prev => [...newSubs, ...prev].slice(0, 10));
        refreshFilters();
        setReasonDialog(null);
        setPendingBatch(null);
        if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
        else setToast({ type: 'success', message: `${success} filter(s) → ${stage.label}` });
      }, {
        onError: (e: unknown) => { setReasonError((e as any)?.message ?? 'Failed'); setPopupError((e as any)?.message ?? 'Failed'); },
      });
      setLoading(false); setSubmitting(false);
      return;
    }

    const reasonBlock = reasonDialog.block;
    const dialogCapture = { ...reasonDialog, block: reasonBlock };
    setLoading(true); setReasonError(''); setSubmitting(true);

    try {
      const cycleBody = { cleaningReasonKey: reasonKey, cleaningJustification: justification || undefined, cleaningAreaId: reasonBlock?.id };
      const advBody = { targetState: dialogCapture.stage.key, cleaningAreaId: reasonBlock?.id, remarks: remarks || `${dialogCapture.stage.label} - ${dialogCapture.filterName}` };

      // For WASH_IN: check equipment groups before advancing (online only)
      if (dialogCapture.stage.key === 'WASH_IN' && reasonBlock?.id && online) {
        await reauth.execute('START_CLEANING_CYCLE', async (password?) => {
          const startBody = { ...cycleBody };
          if (password) await apiClient.postWithReauth(`/api/filters/${dialogCapture.filterId}/start-cycle`, startBody, password);
          else await apiClient.post(`/api/filters/${dialogCapture.filterId}/start-cycle`, startBody);

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

          const advanceResult = password
            ? await apiClient.postWithReauth<any>(`/api/filters/${dialogCapture.filterId}/advance`, advBody, password)
            : await apiClient.post<any>(`/api/filters/${dialogCapture.filterId}/advance`, advBody);
          setRecentSubmissions(prev => [{ stage: dialogCapture.stage.label, filter: dialogCapture.filterName, block: reasonBlock?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
          refreshFilters();
          setReasonDialog(null);
          setToast({ type: 'success', message: `${dialogCapture.filterName} \u2192 ${dialogCapture.stage.label}` });
          if (advanceResult?.pendingChecklist?.length > 0) {
            setChecklistDialog({ filterId: dialogCapture.filterId, filterName: dialogCapture.filterName, checklists: advanceResult.pendingChecklist });
            setChecklistError('');
          }
        }, {
          onError: (e: unknown) => {
            const err = e as any;
            if (err?.code === 'BLOCK_CHANGE_REQUIRED' && err?.connectionInfo) {
              setBlockChangeDialog({
                filterId: err.connectionInfo.filterId ?? dialogCapture.filterId,
                filterName: dialogCapture.filterName,
                homeBlockId: err.connectionInfo.homeBlockId,
                homeBlockName: err.connectionInfo.homeBlockName,
                requestedBlockId: err.connectionInfo.requestedBlockId,
                requestedBlockName: err.connectionInfo.requestedBlockName,
              });
              setBlockChangeReason('');
              setReasonDialog(null);
              return;
            }
            setReasonError(err?.message ?? 'Failed'); setPopupError(err?.message ?? 'Failed');
          },
        });
      } else {
        // Non-WASH_IN or offline: check equipment groups (offline uses cache), then start-and-advance
        if (dialogCapture.stage.key === 'WASH_IN' && reasonBlock?.id) {
          let groups: any[] = [];
          try {
            const cachedGroups = await getCache<any[]>('equipment-groups') ?? [];
            groups = cachedGroups.filter((g: any) => g.blockId === reasonBlock.id);
          } catch { /* no cached groups */ }
          if (groups.length > 0) {
            // Save cycle payload — equipment dialog will use it for compound start-and-advance
            setPendingCyclePayload(cycleBody);
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
        }

        const { executed, result } = await executeOrQueue('start-and-advance', dialogCapture.filterId, dialogCapture.filterName, { cyclePayload: cycleBody, advancePayload: advBody } as any, dialogCapture.stage.key);
        setRecentSubmissions(prev => [{ stage: dialogCapture.stage.label + (executed ? '' : ' (queued)'), filter: dialogCapture.filterName, block: reasonBlock?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
        refreshFilters();
        setReasonDialog(null);
        setToast({ type: 'success', message: `${dialogCapture.filterName} \u2192 ${dialogCapture.stage.label}${executed ? '' : ' (queued)'}` });
        if (executed && result?.pendingChecklist?.length > 0) {
          setChecklistDialog({ filterId: dialogCapture.filterId, filterName: dialogCapture.filterName, checklists: result.pendingChecklist });
          setChecklistError('');
        }
      }
    } catch (e: any) {
      if (e?.code === 'BLOCK_CHANGE_REQUIRED' && e?.connectionInfo) {
        setBlockChangeDialog({
          filterId: e.connectionInfo.filterId ?? dialogCapture.filterId,
          filterName: dialogCapture.filterName,
          homeBlockId: e.connectionInfo.homeBlockId,
          homeBlockName: e.connectionInfo.homeBlockName,
          requestedBlockId: e.connectionInfo.requestedBlockId,
          requestedBlockName: e.connectionInfo.requestedBlockName,
        });
        setBlockChangeReason('');
        setReasonDialog(null);
      } else {
        setReasonError(e?.message ?? 'Failed'); setPopupError(e?.message ?? 'Failed');
      }
    }
    setLoading(false); setSubmitting(false);
  };

  const handleDryerDurationSubmit = async (minutes: number) => {
    if (!dryerDialog || dryerLoading) return;
    setDryerLoading(true); setDryerError('');
    const blockId = dryerDialog.block?.id;
    const blockName = dryerDialog.block?.name;

    // BATCH MODE
    if (pendingBatch && pendingBatch.length > 0) {
      const batch = pendingBatch;
      let success = 0; const failed: string[] = [];
      const newSubs: typeof recentSubmissions = [];
      for (const item of batch) {
        try {
          const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, {
            targetState: 'DRY_IN',
            cleaningAreaId: blockId,
            dryerAction: 'SET_DURATION',
            dryerDurationMinutes: minutes,
            remarks: remarks || `Dryer started (${minutes} min) - Batch`,
          }, 'DRY_IN');
          success++;
          newSubs.push({ stage: 'Dryer Started' + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
        } catch (e: any) {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      setRecentSubmissions(prev => [...newSubs, ...prev].slice(0, 10));
      refreshFilters();
      setDryerDialog(null);
      setPendingBatch(null);
      if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else setToast({ type: 'success', message: `${success} filter(s) → Dryer running (${minutes} min)` });
      setDryerLoading(false);
      return;
    }

    try {
      const { executed } = await executeOrQueue('advance', dryerDialog.filterId, dryerDialog.filterName, {
        targetState: 'DRY_IN',
        cleaningAreaId: blockId,
        dryerAction: 'SET_DURATION',
        dryerDurationMinutes: minutes,
        remarks: remarks || `Dryer started (${minutes} min) - ${dryerDialog.filterName}`,
      }, 'DRY_IN');
      setRecentSubmissions(prev => [{ stage: 'Dryer Started' + (executed ? '' : ' (queued)'), filter: dryerDialog.filterName, block: blockName, time: formatTime(new Date()) }, ...prev].slice(0, 10));
      refreshFilters();
      setDryerDialog(null);
      setToast({ type: 'success', message: `${dryerDialog.filterName} → Dryer running (${minutes} min)${executed ? '' : ' (queued)'}` });
    } catch (e: any) {
      setDryerError(e.message ?? 'Failed to start dryer');
      setPopupError(e.message ?? 'Failed to start dryer');
    }
    setDryerLoading(false);
  };

  const handleEquipmentSubmit = async (groupId: string, readings: Record<string, number>) => {
    if (!equipmentDialog || equipmentLoading) return;
    setEquipmentLoading(true); setEquipmentError('');
    const isDryerReadings = equipmentDialog.stage.key === 'DRY_IN';
    const blockId = equipmentDialog.block?.id;
    const blockName = equipmentDialog.block?.name;
    const stage = equipmentDialog.stage;

    // BATCH MODE: same readings applied to every filter in the snapshot
    if (pendingBatch && pendingBatch.length > 0) {
      const batch = pendingBatch;
      const savedCyclePayload = pendingCyclePayload;
      let success = 0; const failed: string[] = [];
      const newSubs: typeof recentSubmissions = [];
      for (const item of batch) {
        try {
          const advPayload = {
            targetState: isDryerReadings ? 'DRY_OUT' : stage.key,
            cleaningAreaId: blockId,
            equipmentGroupId: groupId,
            instrumentReadings: readings,
            ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
            remarks: remarks || `${stage.label} - Batch - ${item.filterName}`,
          };
          let executed: boolean;
          if (savedCyclePayload) {
            // Cycle not started yet — compound start-and-advance with readings
            const res = await executeOrQueue('start-and-advance', item.filterId, item.filterName, {
              cyclePayload: { ...savedCyclePayload, equipmentGroupId: groupId },
              advancePayload: advPayload,
            } as any, isDryerReadings ? 'DRY_OUT' : stage.key);
            executed = res.executed;
          } else {
            const res = await executeOrQueue('advance', item.filterId, item.filterName, advPayload, isDryerReadings ? 'DRY_OUT' : stage.key);
            executed = res.executed;
          }
          success++;
          // Update cached state after offline operation
          if (!executed) await updateCachedStateAfterAdvance(item.filterId, isDryerReadings ? 'DRY_OUT' : stage.key, !!savedCyclePayload);
          newSubs.push({ stage: stage.label + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
        } catch (e: any) {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      setRecentSubmissions(prev => [...newSubs, ...prev].slice(0, 10));
      refreshFilters();
      getOfflineFilters().then(setOfflineInstances); // refresh cached data
      setEquipmentDialog(null);
      setPendingBatch(null);
      setPendingCyclePayload(null);
      if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else setToast({ type: 'success', message: `${success} filter(s) → ${stage.label}` });
      setEquipmentLoading(false);
      return;
    }

    try {
      const advPayload = {
        targetState: isDryerReadings ? 'DRY_OUT' : equipmentDialog.stage.key,
        cleaningAreaId: equipmentDialog.block?.id,
        equipmentGroupId: groupId,
        instrumentReadings: readings,
        ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
        remarks: remarks || `${equipmentDialog.stage.label} - ${equipmentDialog.filterName}`,
      };
      let executed: boolean;
      let advanceResult: any;
      if (pendingCyclePayload) {
        // Cycle not started yet — compound start-and-advance with readings
        const res = await executeOrQueue('start-and-advance', equipmentDialog.filterId, equipmentDialog.filterName, {
          cyclePayload: { ...pendingCyclePayload, equipmentGroupId: groupId },
          advancePayload: advPayload,
        } as any, isDryerReadings ? 'DRY_OUT' : equipmentDialog.stage.key);
        executed = res.executed;
        advanceResult = res.result;
        setPendingCyclePayload(null);
      } else {
        const res = await executeOrQueue('advance', equipmentDialog.filterId, equipmentDialog.filterName, advPayload, isDryerReadings ? 'DRY_OUT' : equipmentDialog.stage.key);
        executed = res.executed;
        advanceResult = res.result;
      }

      setRecentSubmissions(prev => [{ stage: equipmentDialog.stage.label + (executed ? '' : ' (queued)'), filter: equipmentDialog.filterName, block: equipmentDialog.block?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
      refreshFilters();
      setEquipmentDialog(null);
      setToast({ type: 'success', message: `${equipmentDialog.filterName} \u2192 ${equipmentDialog.stage.label}${executed ? '' : ' (queued)'}` });

      if (executed && advanceResult?.pendingChecklist?.length > 0) {
        setChecklistDialog({ filterId: equipmentDialog.filterId, filterName: equipmentDialog.filterName, checklists: advanceResult.pendingChecklist });
        setChecklistError('');
      }
    } catch (e: any) { setEquipmentError(e.message ?? 'Failed to advance'); setPopupError(e.message ?? 'Failed to advance'); }
    setEquipmentLoading(false);
  };

  const handleChecklistSubmit = async (answers: Record<string, any>) => {
    if (!checklistDialog) return;
    setChecklistLoading(true); setChecklistError('');

    // BATCH MODE: submit same answers for every filter in the snapshot
    if (pendingBatch && pendingBatch.length > 0) {
      const batch = pendingBatch;
      let success = 0; const failed: string[] = [];
      for (const item of batch) {
        try {
          const { executed } = await executeOrQueue('submit-checklist', item.filterId, item.filterName, { answers });
          success++;
          if (!executed) failed.push(`${item.filterName}: queued for sync`);
        } catch (e: any) {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      setChecklistDialog(null);
      setPendingBatch(null);
      refreshFilters();
      if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else setToast({ type: 'success', message: `Checklist submitted for ${success} filter(s)` });
      setChecklistLoading(false);
      return;
    }

    try {
      const { executed } = await executeOrQueue('submit-checklist', checklistDialog.filterId, checklistDialog.filterName, { answers });
      setChecklistDialog(null);
      setToast({ type: 'success', message: executed ? 'Checklist submitted successfully' : 'Checklist queued for sync' });
      refreshFilters();
    } catch (e: any) {
      setChecklistError(e.message ?? 'Failed to submit checklist');
      setPopupError(e.message ?? 'Failed to submit checklist');
    }
    setChecklistLoading(false);
  };

  const handleBlockChangeRequest = async () => {
    if (!blockChangeDialog || blockChangeSubmitting) return;
    // Gap 4: Block change requests require internet
    if (!online) {
      setPopupError('Block change requests require an internet connection. Please connect to WiFi and try again.');
      return;
    }
    setBlockChangeSubmitting(true);
    try {
      await apiClient.post('/api/block-change-requests', {
        filterId: blockChangeDialog.filterId,
        filterName: blockChangeDialog.filterName,
        fromBlockId: blockChangeDialog.homeBlockId,
        fromBlockName: blockChangeDialog.homeBlockName,
        toBlockId: blockChangeDialog.requestedBlockId,
        toBlockName: blockChangeDialog.requestedBlockName,
        reason: blockChangeReason.trim(),
      });
      setToast({ type: 'success', message: 'Block change request submitted. Waiting for approval.' });
      setBlockChangeDialog(null);
      setBlockChangeReason('');
    } catch (e: any) {
      setPopupError(e.message ?? 'Failed to submit block change request');
    }
    setBlockChangeSubmitting(false);
  };

  const selectedStageInfo = CLEANING_STAGES.find(s => s.key === selectedStatusStage);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Stage screen mode: dedicated page for one stage
  if (urlStageKey && activeStage) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        {toast && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium ${toast.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <span>{toast.type === 'success' ? '\u2713' : '\u2717'}</span>
            <span>{toast.message}</span>
          </div>
        )}
        {pendingCount > 0 && (
          <div className="mx-4 mb-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
            <span className="text-sm text-amber-700 font-medium">{pendingCount} operation(s) pending sync</span>
            <div className="flex gap-2">
              <button onClick={manualSync} disabled={syncing} className="px-3 py-1 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium">{syncing ? 'Syncing...' : 'Sync Now'}</button>
              <button onClick={() => { if (confirm('Clear all pending?')) clearQueue(); }} className="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-xs">Clear</button>
            </div>
          </div>
        )}
        <button onClick={closeDialog} className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <span>←</span> Back to Stages
        </button>
        <StageScanDialog
          fullPage
          activeStage={activeStage}
          step={step}
          blocks={blocks}
          selectedBlock={selectedBlock}
          scanValue={scanValue}
          remarks={remarks}
          error={error}
          loading={loading}
          queue={scanQueue}
          addingToQueue={addingToQueue}
          onScanValueChange={setScanValue}
          onRemarksChange={setRemarks}
          onClearError={() => setError('')}
          onBlockSelect={handleBlockSelect}
          onChangeBlock={() => setStep('block')}
          onAddToQueue={handleAddToQueue}
          onRemoveFromQueue={handleRemoveFromQueue}
          onSubmitBatch={handleSubmitBatch}
          onClose={closeDialog}
          instances={instances}
        />
        {activeStage.key === 'DRY_IN' && (
          <DryingFiltersPanel
            filters={allFilters.filter((f: any) => f.currentLifecycleState === 'DRY_IN')}
            refreshFilters={refreshFilters}
            setToast={setToast}
            setPopupError={setPopupError}
          />
        )}
        <CleaningReasonDialog dialog={reasonDialog} onClose={() => { setReasonDialog(null); setReasonError(''); }} onSubmit={handleReasonSubmit} loading={loading} error={reasonError} onClearError={() => setReasonError('')} />
        <EquipmentDialog dialog={equipmentDialog} onClose={() => { setEquipmentDialog(null); }} onSubmit={handleEquipmentSubmit} loading={equipmentLoading} error={equipmentError} />
        <DryerDurationDialog open={!!dryerDialog} filterName={dryerDialog?.filterName ?? ''} loading={dryerLoading} error={dryerError} onClose={() => { setDryerDialog(null); setDryerError(''); }} onSubmit={handleDryerDurationSubmit} />
        <ChecklistDialog dialog={checklistDialog} onClose={() => { setChecklistDialog(null); }} onSubmit={handleChecklistSubmit} loading={checklistLoading} error={checklistError} />
        <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying} onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} actionLabel="Filter Operation" />
        {blockChangeDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
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
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Reason <span className="text-red-500">*</span></label>
                    <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" rows={2}
                      value={blockChangeReason} onChange={e => setBlockChangeReason(e.target.value)}
                      placeholder="Why does this filter need to be cleaned in a different block? (required)" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setBlockChangeDialog(null); }} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                  <button onClick={handleBlockChangeRequest} disabled={blockChangeSubmitting || !blockChangeReason.trim()}
                    className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-cyan-500/25">
                    {blockChangeSubmitting ? 'Submitting...' : 'Request Change'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <ErrorPopup error={popupError} onClose={() => setPopupError('')} />
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

      {pendingCount > 0 && (
        <div className="mx-4 mb-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
          <span className="text-sm text-amber-700 font-medium">{pendingCount} operation(s) pending sync</span>
          <div className="flex gap-2">
            <button onClick={manualSync} disabled={syncing} className="px-3 py-1 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium">{syncing ? 'Syncing...' : 'Sync Now'}</button>
            <button onClick={() => { if (confirm('Clear all pending?')) clearQueue(); }} className="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-xs">Clear</button>
          </div>
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
        queue={scanQueue}
        addingToQueue={addingToQueue}
        onScanValueChange={setScanValue}
        onRemarksChange={setRemarks}
        onClearError={() => setError('')}
        onBlockSelect={handleBlockSelect}
        onChangeBlock={() => setStep('block')}
        onAddToQueue={handleAddToQueue}
        onRemoveFromQueue={handleRemoveFromQueue}
        onSubmitBatch={handleSubmitBatch}
        onClose={closeDialog}
        instances={instances}
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

      {/* Dryer Duration Dialog */}
      <DryerDurationDialog
        open={!!dryerDialog}
        filterName={dryerDialog?.filterName ?? ''}
        loading={dryerLoading}
        error={dryerError}
        onClose={() => { setDryerDialog(null); setDryerError(''); }}
        onSubmit={handleDryerDurationSubmit}
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

      {/* Block Change Request Dialog */}
      {blockChangeDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
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
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Reason *</label>
                  <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" rows={2}
                    value={blockChangeReason} onChange={e => setBlockChangeReason(e.target.value)}
                    placeholder="Why does this filter need to be cleaned in a different block?" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setBlockChangeDialog(null); }} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={handleBlockChangeRequest} disabled={blockChangeSubmitting || !blockChangeReason.trim()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-cyan-500/25">
                  {blockChangeSubmitting ? 'Submitting...' : 'Request Change'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Popup */}
      <ErrorPopup error={popupError} onClose={() => setPopupError('')} />
    </div>
  );
}

// ─── Drying Filters Panel (DRY_IN stage screen) ─────────────────────
function buildTempOptions(min: number, max: number, step: number): number[] {
  if (!(step > 0) || max <= min) return [];
  const opts: number[] = [];
  const decimals = (String(step).split('.')[1] || '').length;
  // Start at the first multiple of step >= min
  const first = Math.ceil(min / step) * step;
  for (let v = first; v <= max + 1e-9; v += step) {
    opts.push(Number(v.toFixed(decimals)));
    if (opts.length > 500) break; // safety
  }
  return opts;
}

function DryingFiltersPanel({
  filters,
  refreshFilters,
  setToast,
  setPopupError,
}: {
  filters: any[];
  refreshFilters: () => void;
  setToast: (t: { type: 'success' | 'error'; message: string } | null) => void;
  setPopupError: (msg: string) => void;
}) {
  if (filters.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center text-sm text-slate-400">
        No filters currently drying
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Currently Drying</h3>
      {filters.map((f: any) => (
        <DryingFilterRow
          key={f.id}
          filterId={f.id}
          filterName={f.name}
          refreshFilters={refreshFilters}
          setToast={setToast}
          setPopupError={setPopupError}
        />
      ))}
    </div>
  );
}

function DryingFilterRow({
  filterId,
  filterName,
  refreshFilters,
  setToast,
  setPopupError,
}: {
  filterId: string;
  filterName: string;
  refreshFilters: () => void;
  setToast: (t: { type: 'success' | 'error'; message: string } | null) => void;
  setPopupError: (msg: string) => void;
}) {
  const { data: state, mutate: refreshState } = useSWR<any>(`/api/filters/${filterId}/current-state`, { refreshInterval: 15000 });
  const [temp, setTemp] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cyc = state?.currentCycle;
  const startedAt = cyc?.dryerStartedAt ? new Date(cyc.dryerStartedAt).getTime() : null;
  const durationMin: number | null = cyc?.dryerDurationMinutes ?? null;

  // Equipment group from cycle or block fallback
  const stateGroup = state?.equipmentGroup;
  const blockGroups: any[] = state?.blockEquipmentGroups ?? [];

  // Resolve which group to use: cycle's group > single block group > user-selected
  const resolvedGroup = stateGroup
    ?? (blockGroups.length === 1 ? blockGroups[0] : null)
    ?? (selectedGroupId ? blockGroups.find((g: any) => g.id === selectedGroupId) : null);

  // Find the dryer temperature instrument
  const dryerInstrument = (resolvedGroup?.instruments ?? []).find(
    (i: any) => i.stageKey === 'DRY_IN' && /temp/i.test(i.description ?? ''),
  );
  const tempOptions = dryerInstrument
    ? buildTempOptions(dryerInstrument.operatingMin, dryerInstrument.operatingMax, dryerInstrument.leastCount)
    : [];
  const tempUom = dryerInstrument?.uom ?? '°C';

  if (!startedAt || !durationMin) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
        <span className="font-medium text-slate-700">{filterName}</span>
        <span className="text-xs text-slate-400">waiting for dryer start…</span>
      </div>
    );
  }

  const halfMs = (durationMin * 60_000) / 2;
  const elapsedMs = now - startedAt;
  const halfElapsed = elapsedMs >= halfMs;
  const remainingToHalfMin = Math.max(0, Math.ceil((halfMs - elapsedMs) / 60_000));

  const handleSubmit = async () => {
    if (!temp || submitting || !resolvedGroup) return;
    setSubmitting(true);
    try {
      const dryInInstruments = (resolvedGroup.instruments ?? []).filter((i: any) => i.stageKey === 'DRY_IN');
      const readings: Record<string, number> = {};
      for (const inst of dryInInstruments) {
        if (dryerInstrument && inst.id === dryerInstrument.id) readings[inst.id] = Number(temp);
        else readings[inst.id] = inst.operatingMin;
      }
      const { executeOrQueue: eOrQ } = await import('@/hooks/use-offline').then(() => {
        // Use apiClient for online, queue for offline
        return { executeOrQueue: async (type: any, fId: string, fName: string, payload: any, optState?: string) => {
          try {
            await apiClient.post(`/api/filters/${fId}/advance`, payload);
            return { executed: true };
          } catch (e: any) {
            const msg = String(e?.message || '').toLowerCase();
            if (msg.includes('fetch') || msg.includes('network') || msg.includes('load failed')) {
              const { queueOperation, updateFilterStateLocally } = await import('@/lib/offline-store');
              await queueOperation({ type: 'advance', filterId: fId, filterName: fName, payload });
              if (optState) await updateFilterStateLocally(fId, optState);
              return { executed: false };
            }
            throw e;
          }
        }};
      });
      const { executed } = await eOrQ('advance', filterId, filterName, {
        targetState: 'DRY_OUT',
        dryerAction: 'SUBMIT_READINGS',
        equipmentGroupId: resolvedGroup.id,
        instrumentReadings: readings,
        remarks: `Dryer temperature ${temp}${tempUom} - ${filterName}`,
      }, 'DRY_OUT');
      setToast({ type: 'success', message: `${filterName} → DRY_OUT (${temp}${tempUom})${executed ? '' : ' (queued)'}` });
      refreshFilters();
      if (executed) refreshState();
    } catch (e: any) {
      setPopupError(e.message ?? 'Failed to submit dryer reading');
    }
    setSubmitting(false);
  };

  // Need user to pick equipment group
  const needsGroupSelect = !stateGroup && blockGroups.length > 1 && !selectedGroupId;

  return (
    <div className="flex flex-col gap-2 py-2 border-b border-slate-100 last:border-0 text-sm">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-800 truncate">{filterName}</div>
          <div className="text-xs text-slate-500">
            {durationMin} min total{' '}
            {halfElapsed ? (
              <span className="text-green-600">• ready for reading</span>
            ) : (
              <span className="text-amber-600">• {remainingToHalfMin} min until reading</span>
            )}
          </div>
        </div>
        {needsGroupSelect ? (
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-slate-800 text-sm"
          >
            <option value="">Select Equipment Group</option>
            {blockGroups.map((g: any) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        ) : tempOptions.length === 0 ? (
          <span className="text-xs text-red-600">No dryer temperature instrument configured</span>
        ) : (
          <>
            <select
              value={temp}
              onChange={(e) => setTemp(e.target.value ? Number(e.target.value) : '')}
              disabled={!halfElapsed || submitting}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={dryerInstrument ? `${dryerInstrument.operatingMin}–${dryerInstrument.operatingMax} ${tempUom} (step ${dryerInstrument.leastCount})` : ''}
            >
              <option value="">{tempUom}</option>
              {tempOptions.map((v) => (
                <option key={v} value={v}>{v}{tempUom}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!halfElapsed || !temp || submitting}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? '…' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
