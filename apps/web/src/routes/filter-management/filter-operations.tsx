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
import { formatByLeastCount } from '@/lib/format-by-least-count';
// Phase 8.6 — shared executor + action-tape resolver + offline-cache helper.
// All graph-walking decisions (next-stage, checklist-after-stage, cache
// rewrites) route through these so client/server stay in lockstep.
import { actionsForStage, getCurrentActions } from '@/lib/action-tape';
import {
  cacheServerStateResponse,
  recomputeAndCacheFilterState,
} from '@/lib/offline-cache';
// Phase 8.7 Wave-5 split — shared with mobile-operations.tsx.
// PendingChecklist + dialog-resolver + offline-gate + first-stages walker live
// in lib/filter-ops so the two pages cannot drift on these primitives.
import {
  firstStagesFromGraph,
  resolvePendingChecklistDialog,
  findNextPendingChecklist,
  buildTempOptionsSnapped,
  useNowTick,
  findDryerTempInstrument,
  projectDryerCountdown,
  type PendingChecklist,
  type PendingChecklistBatchItem,
} from '@/lib/filter-ops';

const CLEANING_STAGES = CLEANING_STAGES_OPS;

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
  const { data: templatesData, error: templatesError } = useSWR<PaginatedResponse<{ id: string; name: string }>>('/api/assets/templates?limit=1000');
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
          // Phase 8.7: route the cache write through the helper so the legacy
          // mirror field names live only in offline-cache.ts.
          await cacheServerStateResponse(f.id, st);
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
  // B7.4 (2026-05-02): advisory shown when admin edited the cycle's pinned
  // EquipmentGroup mid-cycle. Persistent (no auto-clear) — operator can keep
  // working on the pinned ranges, but should know the live group has moved.
  // Cleared on closeDialog / clearScanState / stage change.
  const [equipmentGroupSyncWarning, setEquipmentGroupSyncWarning] = useState<{
    groupId: string;
    pinnedVersion: number;
    liveVersion: number;
    recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART';
  } | null>(null);
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
  // Multi-filter post-advance checklist cycling — distinct from `pendingBatch`
  // (which feeds the BATCH MODE flow that submits ONE set of answers for every
  // filter). This queue is set by `advanceBatch` after queued offline advances:
  // each filter may have its OWN pending checklist, so we open the dialog for
  // the first one, stash the rest here, and walk through them in
  // handleChecklistSubmit. Pre-fix the loop dropped everything past the first
  // (PHASE_5_RECENT_WORK.md § 11, session 04-20 follow-up).
  const [postAdvanceChecklistQueue, setPostAdvanceChecklistQueue] = useState<PendingChecklistBatchItem[]>([]);

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
  const filterTemplateId = templates.find((t: any) => t.templateKind === 'FILTER')?.id;

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

  const blockTemplateId = templates.find((t: any) => t.templateKind === 'BLOCK')?.id;
  const blocks = instances.filter((e: any) => e.templateId === blockTemplateId);

  const handleStageClick = (stage: typeof CLEANING_STAGES[0]) => {
    navigate(`/filters/stage/${stage.key}`);
  };

  const handleBlockSelect = (block: any) => {
    // B7.4 follow-up (Issue #1): clear stale advisory when switching blocks
    // intra-stage. The equipmentGroupSyncWarning was bound to the previously
    // scanned filter on the previously selected block; once the operator
    // moves to a different block it no longer applies and would leak onto
    // the next scan view until the next current-state response replaces it.
    setEquipmentGroupSyncWarning(null);
    setSelectedBlock(block);
    setStep('scan');
  };

  // Clear scan state without navigating (used when handing off to sub-dialogs)
  const clearScanState = () => {
    setScanValue(''); setRemarks(''); setError(''); setScanQueue([]); setEquipmentGroupSyncWarning(null);
  };
  // Close stage screen and go back to landing
  const closeDialog = () => {
    setActiveStage(null); setSelectedBlock(null); setScanValue(''); setRemarks(''); setError(''); setScanQueue([]); setEquipmentGroupSyncWarning(null);
    setPostAdvanceChecklistQueue([]);
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
    setError(''); setScanValue(''); setRemarks(''); setEquipmentGroupSyncWarning(null);
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
    // Offline parity: if pipeline prescribes a checklist after this stage,
    // pop the dialog so the operator can complete it (matches mobile behavior,
    // blocks further advance). Phase 8.7: gate via the action tape (Tier-1
    // server actions[] when present, else local executor over the
    // just-rewritten cache row). Fall back to the helper that reads the
    // cached dialog payload when the tape can't surface questions inline
    // (legacy server response without TAPE_PARALLEL).
    //
    // Multi-filter cycling (PHASE_5_RECENT_WORK.md § 11 fix): EVERY filter in
    // the batch may have its own pending checklist (different cleaning
    // profiles → different CHECKLIST nodes). We open the dialog for the
    // first such filter and stash the rest in `postAdvanceChecklistQueue`;
    // `handleChecklistSubmit` walks the queue after each submit so no
    // checklist gate is ever silently skipped. Pre-fix the loop took only
    // the first item and dropped the rest.
    if (batch.length > 0 && newSubmissions.some(s => s.stage.includes('queued'))) {
      try {
        // Phase 8.7 Wave-5 helper. Tier-1 server actions (when emitted)
        // → Tier-2 local executor → Tier-3 cached pending payload fallback.
        // Returns null when no dialog is needed.
        const cycleBatch: PendingChecklistBatchItem[] = batch.map(b => ({
          filterId: b.filterId,
          filterName: b.filterName,
        }));
        const next = await findNextPendingChecklist(cycleBatch, resolvePendingChecklistDialog);
        if (next) {
          setChecklistDialog({
            filterId: next.item.filterId,
            filterName: next.item.filterName,
            checklists: next.checklists,
          });
          setPostAdvanceChecklistQueue(next.remaining);
          setChecklistError('');
        }
      } catch { /* ignore */ }
    }
    if (failed.length > 0 && !blockChangeDialog) {
      setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
    } else if (failed.length === 0) {
      setToast({ type: 'success', message: `${success} filter(s) → ${stageLabel}` });
    }
  };

  // Phase 8.6 part 2: cache rewrite after a queued offline advance. Wraps
  // `recomputeAndCacheFilterState` (the lib that replaces the deleted
  // `findChecklistsAfterStage` / `buildOfflineChecklist` /
  // `updateCachedStateAfterAdvance` helpers). Same shape as the deleted
  // helper — every existing call site stays identical.
  const updateCachedStateAfterAdvance = async (
    filterId: string,
    newStageKey: string,
    cycleStarted?: boolean,
  ) => {
    await recomputeAndCacheFilterState(
      filterId,
      newStageKey,
      !!cycleStarted,
      null,
    );
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
        // Cache the full state for offline use (Phase 8.7: route through helper
        // so the legacy mirror field names live only in offline-cache.ts).
        await cacheServerStateResponse(first.filterId, state);
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
          // Phase 8.7: legacy mirror fields omitted — gate sites below resolve
          // via the action tape (Tier-3 empty-tape fallback when no cached
          // graph), which produces the same "refuse the op offline without
          // cache" outcome the legacy reads of those fields would have.
          state = {
            currentState: cachedFilter?.currentLifecycleState || null,
            currentCycle: hasCycle ? { id: cachedFilter.currentCycleId } : null,
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

      // B7.4 (2026-05-02): surface the equipmentGroupSyncWarning advisory if
      // the server reported one. Online responses include it; offline-built
      // state does not, so this clears any stale value when offline.
      setEquipmentGroupSyncWarning(state.equipmentGroupSyncWarning ?? null);

      // ─── STRICT OFFLINE GATE (parity with mobile) ─────────────────────────
      // Without cached pipeline data we cannot enforce stage ordering — refuse
      // the operation explicitly rather than silently letting it through.
      //
      // Phase 8.6 part 2: reachability decisions read the action tape (server
      // actions[] when TAPE_PARALLEL=true, else executor.computeNextActions
      // resolved by getCurrentActions()). Both new-cycle entry points and
      // in-cycle reachability come from the SAME tape — the same one the
      // server emits and the FE caches.
      const resolvedActions = await getCurrentActions(first.filterId, state.actions);
      const advanceTargets = resolvedActions
        .filter(a => a.type === 'ADVANCE_TO_STAGE' || a.type === 'SET_DRYER_DURATION')
        .map(a => (a as { params: { targetState: string } }).params.targetState);

      if (!online) {
        const hasGraph = !!state.pipelineGraph?.stages;
        const hasLinearPipeline = (state.pipelineStages?.length ?? 0) > 0;
        const hasValidation = hasGraph || hasLinearPipeline || advanceTargets.length > 0;

        if (!hasValidation) {
          setPopupError(`${first.filterName}: offline data not cached. Connect to network and re-sync before retrying.`);
          setLoading(false); setSubmitting(false);
          return;
        }

        // Force block-change enforcement when homeBlock is known and differs
        if (state.homeBlock && selectedBlock?.id && state.homeBlock.id !== selectedBlock.id && state.blockChangeStatus !== 'APPROVED') {
          state.blockChangeStatus = 'REQUIRED';
        }

        const cycleInProgress = !!state.currentCycle;
        // New cycle: activeStage must be a legal entry point. The action tape
        // only emits ADVANCE_TO_STAGE entries for in-progress cycles — for the
        // pre-cycle case we walk the cached pipeline graph from its START
        // node via the shared executor's `findReachable` helper (Phase 8.7
        // Wave-5: lifted to `firstStagesFromGraph` in lib/filter-ops, shared
        // with mobile's validateOfflineGate so the walker can't drift).
        if (!cycleInProgress && hasGraph) {
          const firstStages = firstStagesFromGraph(state.pipelineGraph);
          if (firstStages.length > 0 && !firstStages.includes(activeStage.key)) {
            setError(`${first.filterName}: cannot start cycle at ${activeStage.label}. Start at: ${firstStages.map((s: string) => s.replace(/_/g, ' ')).join(', ')}`);
            setLoading(false); setSubmitting(false);
            return;
          }
        }

        // In-cycle but no advance actions on tape → stale cache; refuse
        if (cycleInProgress && advanceTargets.length === 0) {
          setPopupError(`${first.filterName}: filter is in-cycle but no next stage is cached. Reconnect and re-sync.`);
          setLoading(false); setSubmitting(false);
          return;
        }
      }
      // ─── END STRICT OFFLINE GATE ─────────────────────────────────────────

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

      // B.10 — stale profile detection on desktop too. Cycle bound to a profile
      // that no longer matches the live block-assignment → block advance and
      // tell the operator to terminate-and-restart.
      if (state.profileSyncWarning) {
        const w = state.profileSyncWarning;
        setPopupError(
          `${first.filterName}: active cycle is on profile "${w.cycleProfileName ?? w.cycleProfileId}", but the live profile for this block is "${w.expectedProfileName ?? w.expectedProfileId}". Terminate the current cycle and rescan to start fresh.`
        );
        setLoading(false); setSubmitting(false);
        return;
      }

      // DRY_IN: if temperature already recorded, direct user to Dry Out stage
      // (runs BEFORE generic nextAllowed check so the user gets a clear instruction
      // instead of the confusing "is at DRY IN. Next allowed: Dry Out")
      if (activeStage.key === 'DRY_IN' && state.currentCycle?.dryerReadingsSubmitted) {
        setPopupError('Dry In complete — temperature already recorded. Scan on Dry Out stage to advance.');
        setLoading(false); setSubmitting(false);
        return;
      }

      // Phase 8.6 part 2: tape-derived "wrong stage" check. activeStage must
      // appear as an ADVANCE / SET_DRYER target on the resolved tape.
      const advanceMatch = actionsForStage(activeStage.key, resolvedActions).some(
        a => a.type === 'ADVANCE_TO_STAGE' || a.type === 'SET_DRYER_DURATION',
      );
      if (advanceTargets.length > 0 && !advanceMatch) {
        const allowedLabels = advanceTargets.map((k: string) => CLEANING_STAGES.find(s => s.key === k)?.label ?? k).join(', ');
        setError(`${first.filterName} is at "${(state.currentState ?? 'START').replace(/_/g, ' ')}". Next allowed: ${allowedLabels}`);
        setLoading(false); setSubmitting(false);
        return;
      }

      // Phase 8.7 Wave-5: shared checklist-dialog resolver. Pass the resolved
      // tape from the offline-gate computation above so we don't recompute it.
      {
        const dialogChecklists = await resolvePendingChecklistDialog(first.filterId, resolvedActions);
        if (dialogChecklists) {
          const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          setChecklistDialog({ filterId: first.filterId, filterName: `${batch.length} filter(s)`, checklists: dialogChecklists });
          setChecklistError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      }

      // Need cycle start
      if (!state.currentCycle) {
        // Gap 7: PM auto-start — if filter's AHU has an active PM schedule, auto-start with PM reason
        if (state.isPmDue && state.pmReasonKey) {
          const batch = scanQueue.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          const blockId = selectedBlock?.id;
          let pmSuccess = 0;
          const pmFailed: string[] = [];
          let blockChangePopped = false;
          for (const item of batch) {
            const cyclePayload = { cleaningReasonKey: state.pmReasonKey, cleaningAreaId: blockId };
            const advancePayload = { targetState: activeStage.key, cleaningAreaId: blockId, remarks: remarks || `${activeStage.label} - ${item.filterName} (PM auto)` };
            try {
              await executeOrQueue('start-and-advance', item.filterId, item.filterName, { cyclePayload, advancePayload } as any, activeStage.key);
              pmSuccess++;
            } catch (e: any) {
              // B7.2: PM auto-start goes through `start-and-advance` → start-cycle →
              // validateBlockChange. The proactive `state.blockChangeStatus === 'REQUIRED'`
              // check at line 661 covers most cases via the cached state, but a stale-cache
              // or race can still surface the structured 409 here. Mirror the mobile pattern
              // (mobile-operations.tsx:1015-1022) and pop the existing block-change modal.
              if (e?.code === 'BLOCK_CHANGE_REQUIRED' && e?.connectionInfo) {
                if (!blockChangePopped) {
                  setBlockChangeDialog({
                    filterId: e.connectionInfo.filterId ?? item.filterId,
                    filterName: item.filterName,
                    homeBlockId: e.connectionInfo.homeBlockId,
                    homeBlockName: e.connectionInfo.homeBlockName,
                    requestedBlockId: e.connectionInfo.requestedBlockId,
                    requestedBlockName: e.connectionInfo.requestedBlockName,
                  });
                  setBlockChangeReason('');
                  blockChangePopped = true;
                }
                pmFailed.push(`${item.filterName}: Block change approval required`);
              } else {
                pmFailed.push(`${item.filterName}: ${e?.message ?? 'failed'}`);
              }
            }
          }
          if (pmFailed.length > 0 && !blockChangePopped) {
            setPopupError(`${pmSuccess} succeeded, ${pmFailed.length} failed:\n${pmFailed.join('\n')}`);
          } else if (pmFailed.length === 0) {
            setToast({ type: 'success', message: `${batch.length} filter(s) → ${activeStage.label} (PM auto)` });
          }
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
        if (cyc.dryerReadingsSubmitted) {
          setPopupError('Dry In complete — temperature already recorded. Scan on Dry Out stage to advance.');
          setLoading(false); setSubmitting(false);
          return;
        }
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

          // Phase 8.7 cutover (Wave 2 — server commit f8fae1d): /advance now
          // requires `tapeVersion` in the body. We just started the cycle on
          // the previous line so the cache row's tapeVersion is stale (or
          // null). Fetch the freshly-derived tapeVersion via /current-state
          // and include it. This is a one-shot read; the offline path uses
          // executeOrQueue which handles the cache lookup itself.
          let advanceTapeVersion: number | undefined;
          try {
            const fresh = await apiClient.get<any>(`/api/filters/${dialogCapture.filterId}/current-state`);
            if (typeof fresh?.tapeVersion === 'number') advanceTapeVersion = fresh.tapeVersion;
          } catch { /* if this fails, advance will 400 STALE_TAPE → reauth.execute surfaces it */ }
          const advBodyWithTape = advanceTapeVersion !== undefined
            ? { ...advBody, tapeVersion: advanceTapeVersion }
            : advBody;
          const advanceResult = password
            ? await apiClient.postWithReauth<any>(`/api/filters/${dialogCapture.filterId}/advance`, advBodyWithTape, password)
            : await apiClient.post<any>(`/api/filters/${dialogCapture.filterId}/advance`, advBodyWithTape);
          setRecentSubmissions(prev => [{ stage: dialogCapture.stage.label, filter: dialogCapture.filterName, block: reasonBlock?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
          refreshFilters();
          setReasonDialog(null);
          setToast({ type: 'success', message: `${dialogCapture.filterName} \u2192 ${dialogCapture.stage.label}` });
          // Phase 8.7 Wave-5: shared checklist-dialog resolver. /advance
          // returns getCurrentState() — its actions[] is the canonical source.
          {
            const dialogChecklists = await resolvePendingChecklistDialog(
              dialogCapture.filterId,
              advanceResult?.actions,
            );
            if (dialogChecklists) {
              setChecklistDialog({ filterId: dialogCapture.filterId, filterName: dialogCapture.filterName, checklists: dialogChecklists });
              setChecklistError('');
            }
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
        // Phase 8.7 Wave-5: shared checklist-dialog resolver (only when the
        // request was executed online — queued path has no server result).
        if (executed) {
          const dialogChecklists = await resolvePendingChecklistDialog(
            dialogCapture.filterId,
            result?.actions,
          );
          if (dialogChecklists) {
            setChecklistDialog({ filterId: dialogCapture.filterId, filterName: dialogCapture.filterName, checklists: dialogChecklists });
            setChecklistError('');
          }
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
      // Cache dryer timing + equipmentGroup for each filter (offline + navigation persistence)
      const dryerStartedAt = new Date().toISOString();
      // Resolve equipment group for offline temperature dropdown
      let batchEqGroup: any = null;
      if (blockId) {
        try {
          const allGroups = await getCache<any[]>('equipment-groups') ?? [];
          const blockGroups = allGroups.filter((g: any) => g.blockId === blockId);
          if (blockGroups.length === 1) batchEqGroup = blockGroups[0];
        } catch {}
      }
      for (const item of batch) {
        try {
          const cached = await getCache<any>(`filter-state-${item.filterId}`) ?? {};
          cache(`filter-state-${item.filterId}`, {
            ...cached,
            currentState: 'DRY_IN',
            equipmentGroup: cached.equipmentGroup ?? batchEqGroup,
            currentCycle: {
              ...(cached.currentCycle ?? {}),
              status: 'IN_PROGRESS',
              dryerDurationMinutes: minutes,
              dryerStartedAt,
              cleaningAreaId: blockId ?? cached.currentCycle?.cleaningAreaId ?? null,
            },
          }, 24 * 60 * 60 * 1000);
        } catch { /* ignore cache errors */ }
      }
      // Update offline cache (action tape + reachable-target mirrors) per filter when queued
      for (const item of batch) {
        await updateCachedStateAfterAdvance(item.filterId, 'DRY_IN', false);
      }
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
      // Cache dryer timing + equipmentGroup (offline + navigation persistence)
      try {
        const cached = await getCache<any>(`filter-state-${dryerDialog.filterId}`) ?? {};
        let eqGroup = cached.equipmentGroup ?? null;
        if (!eqGroup && blockId) {
          const allGroups = await getCache<any[]>('equipment-groups') ?? [];
          const blockGroups = allGroups.filter((g: any) => g.blockId === blockId);
          if (blockGroups.length === 1) eqGroup = blockGroups[0];
        }
        cache(`filter-state-${dryerDialog.filterId}`, {
          ...cached,
          currentState: 'DRY_IN',
          equipmentGroup: eqGroup,
          currentCycle: {
            ...(cached.currentCycle ?? {}),
            status: 'IN_PROGRESS',
            dryerDurationMinutes: minutes,
            dryerStartedAt: new Date().toISOString(),
            cleaningAreaId: blockId ?? cached.currentCycle?.cleaningAreaId ?? null,
          },
        }, 24 * 60 * 60 * 1000);
      } catch { /* ignore cache errors */ }
      // Update offline cache (action tape + reachable-target mirrors) when queued
      if (!executed) {
        await updateCachedStateAfterAdvance(dryerDialog.filterId, 'DRY_IN', false);
      }
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
      // Minor #2: track first 409 BLOCK_CHANGE_REQUIRED hit with a local flag.
      // The closure-captured `blockChangeDialog` does NOT update mid-loop —
      // React doesn't flush state between iterations of a sync `for`/await —
      // so `if (!blockChangeDialog)` would always be whatever it was at
      // function entry, not "have we set it this run". Local flag = correct.
      let blockChangePopped = false;
      for (const item of batch) {
        try {
          const advPayload = {
            targetState: isDryerReadings ? 'DRY_IN' : stage.key,
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
            } as any, isDryerReadings ? 'DRY_IN' : stage.key);
            executed = res.executed;
          } else {
            const res = await executeOrQueue('advance', item.filterId, item.filterName, advPayload, isDryerReadings ? 'DRY_IN' : stage.key);
            executed = res.executed;
          }
          success++;
          // Update cached state after offline operation
          if (!executed) await updateCachedStateAfterAdvance(item.filterId, isDryerReadings ? 'DRY_IN' : stage.key, !!savedCyclePayload);
          newSubs.push({ stage: stage.label + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
        } catch (e: any) {
          // B7.2: equipment-dialog batch loop uses `start-and-advance` when a
          // cycle hasn't started yet, which calls start-cycle → validateBlockChange.
          // A cross-block hit can return 409 BLOCK_CHANGE_REQUIRED. Pop the
          // structured modal once on first hit (matches advanceBatch:388
          // pattern) and continue iterating so other items can still succeed.
          if (e?.code === 'BLOCK_CHANGE_REQUIRED' && e?.connectionInfo) {
            if (!blockChangePopped) {
              setBlockChangeDialog({
                filterId: e.connectionInfo.filterId ?? item.filterId,
                filterName: item.filterName,
                homeBlockId: e.connectionInfo.homeBlockId,
                homeBlockName: e.connectionInfo.homeBlockName,
                requestedBlockId: e.connectionInfo.requestedBlockId,
                requestedBlockName: e.connectionInfo.requestedBlockName,
              });
              setBlockChangeReason('');
              blockChangePopped = true;
            }
            failed.push(`${item.filterName}: Block change approval required`);
          } else {
            failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
          }
        }
      }
      setRecentSubmissions(prev => [...newSubs, ...prev].slice(0, 10));
      refreshFilters();
      getOfflineFilters().then(setOfflineInstances); // refresh cached data
      setEquipmentDialog(null);
      setPendingBatch(null);
      setPendingCyclePayload(null);
      // Minor #3: suppress generic toast when block-change modal is up
      // (mirrors advanceBatch:422 `&& !blockChangeDialog`, but using the
      // local flag to avoid the same closure-staleness pitfall).
      if (failed.length > 0 && !blockChangePopped) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else if (failed.length === 0) setToast({ type: 'success', message: `${success} filter(s) → ${stage.label}` });
      setEquipmentLoading(false);
      return;
    }

    try {
      const advPayload = {
        targetState: isDryerReadings ? 'DRY_IN' : equipmentDialog.stage.key,
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
        } as any, isDryerReadings ? 'DRY_IN' : equipmentDialog.stage.key);
        executed = res.executed;
        advanceResult = res.result;
        setPendingCyclePayload(null);
      } else {
        const res = await executeOrQueue('advance', equipmentDialog.filterId, equipmentDialog.filterName, advPayload, isDryerReadings ? 'DRY_IN' : equipmentDialog.stage.key);
        executed = res.executed;
        advanceResult = res.result;
      }

      setRecentSubmissions(prev => [{ stage: equipmentDialog.stage.label + (executed ? '' : ' (queued)'), filter: equipmentDialog.filterName, block: equipmentDialog.block?.name, time: formatTime(new Date()) }, ...prev].slice(0, 10));
      refreshFilters();
      setEquipmentDialog(null);
      setToast({ type: 'success', message: `${equipmentDialog.filterName} \u2192 ${equipmentDialog.stage.label}${executed ? '' : ' (queued)'}` });

      // Phase 8.7 Wave-5: shared checklist-dialog resolver.
      if (executed) {
        const dialogChecklists = await resolvePendingChecklistDialog(
          equipmentDialog.filterId,
          advanceResult?.actions,
        );
        if (dialogChecklists) {
          setChecklistDialog({ filterId: equipmentDialog.filterId, filterName: equipmentDialog.filterName, checklists: dialogChecklists });
          setChecklistError('');
        }
      }
    } catch (e: any) {
      // B7.2: single-filter equipment submit goes through `start-and-advance`
      // when pendingCyclePayload is set (cycle not yet started). That calls
      // start-cycle → validateBlockChange and can return 409 BLOCK_CHANGE_REQUIRED.
      // Mirror the reason-dialog catch (line ~1060) and pop the structured
      // modal instead of falling through to a generic toast.
      if (e?.code === 'BLOCK_CHANGE_REQUIRED' && e?.connectionInfo) {
        setBlockChangeDialog({
          filterId: e.connectionInfo.filterId ?? equipmentDialog.filterId,
          filterName: equipmentDialog.filterName,
          homeBlockId: e.connectionInfo.homeBlockId,
          homeBlockName: e.connectionInfo.homeBlockName,
          requestedBlockId: e.connectionInfo.requestedBlockId,
          requestedBlockName: e.connectionInfo.requestedBlockName,
        });
        setBlockChangeReason('');
        // Clear equipment-dialog state so the structured modal isn't stacked.
        setEquipmentDialog(null);
        setPendingCyclePayload(null);
      } else {
        setEquipmentError(e.message ?? 'Failed to advance');
        setPopupError(e.message ?? 'Failed to advance');
      }
    }
    setEquipmentLoading(false);
  };

  const handleChecklistSubmit = async (answers: Record<string, any>) => {
    if (!checklistDialog) return;
    setChecklistLoading(true); setChecklistError('');

    // Phase A.1: include the version each profile was rendered against. Server
    // compares to its cycle pins and returns 409 SCHEMA_DRIFT if the live profile
    // version moved between when the dialog opened and when we submitted.
    const expectedProfileVersions: Record<string, number> = {};
    for (const cl of checklistDialog.checklists) {
      if (typeof cl.profileVersion === 'number') {
        expectedProfileVersions[cl.checklistProfileId] = cl.profileVersion;
      }
    }
    const submitPayload = { answers, expectedProfileVersions };

    // BATCH MODE: submit same answers for every filter in the snapshot
    if (pendingBatch && pendingBatch.length > 0) {
      const batch = pendingBatch;
      let success = 0; const failed: string[] = [];
      for (const item of batch) {
        try {
          const { executed } = await executeOrQueue('submit-checklist', item.filterId, item.filterName, submitPayload);
          success++;
          if (!executed) failed.push(`${item.filterName}: queued for sync`);
        } catch (e: any) {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      setChecklistDialog(null);
      setPendingBatch(null);
      // BATCH MODE owns its own batch (`pendingBatch`); the post-advance
      // queue should never be set here, but clear defensively to keep the
      // two cycling paths from interfering if state ever overlaps.
      setPostAdvanceChecklistQueue([]);
      refreshFilters();
      if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else setToast({ type: 'success', message: `Checklist submitted for ${success} filter(s)` });
      setChecklistLoading(false);
      return;
    }

    try {
      const { executed } = await executeOrQueue('submit-checklist', checklistDialog.filterId, checklistDialog.filterName, submitPayload);
      // Multi-filter post-advance cycling (PHASE_5_RECENT_WORK.md § 11 fix):
      // walk `postAdvanceChecklistQueue` for the next filter that still has
      // a pending checklist. If none remain, the dialog closes; otherwise we
      // re-open it pointing at the next filter. Filters whose checklist was
      // just submitted resolve to `null` and are skipped automatically. The
      // pre-advance BATCH MODE path (above) is unaffected — it never sets
      // `postAdvanceChecklistQueue`.
      let nextDialog: { filterId: string; filterName: string; checklists: PendingChecklist[] } | null = null;
      let nextRemaining: PendingChecklistBatchItem[] = [];
      if (postAdvanceChecklistQueue.length > 0) {
        try {
          const next = await findNextPendingChecklist(postAdvanceChecklistQueue, resolvePendingChecklistDialog);
          if (next) {
            nextDialog = {
              filterId: next.item.filterId,
              filterName: next.item.filterName,
              checklists: next.checklists,
            };
            nextRemaining = next.remaining;
          }
        } catch { /* ignore — falls through to close dialog */ }
      }
      setChecklistDialog(nextDialog);
      setPostAdvanceChecklistQueue(nextRemaining);
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
        {/* B7.4 (2026-05-02): equipmentGroupSyncWarning advisory — admin edited
            the cycle's pinned EquipmentGroup mid-cycle. Persistent (no
            auto-clear); operator may continue on the pinned ranges or
            terminate-and-restart. */}
        {equipmentGroupSyncWarning && (
          <div className="mx-4 mb-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <span className="text-sm text-amber-800">
              Equipment group has been updated by admin (you started on v{equipmentGroupSyncWarning.pinnedVersion}, current is v{equipmentGroupSyncWarning.liveVersion}). Your readings will continue to validate against the version you started with — terminate-and-restart only if you need the new ranges.
            </span>
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
          onChangeBlock={() => {
            // B7.4 follow-up (Issue #1): clear stale advisory before
            // returning to block-picker; otherwise the warning lingers
            // visually while operator selects a new block.
            setEquipmentGroupSyncWarning(null);
            setStep('block');
          }}
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
        <ChecklistDialog dialog={checklistDialog} onClose={() => { setChecklistDialog(null); setPostAdvanceChecklistQueue([]); }} onSubmit={handleChecklistSubmit} loading={checklistLoading} error={checklistError} />
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
        onChangeBlock={() => {
          // B7.4 follow-up (Issue #1): clear stale advisory before
          // returning to block-picker; mirror of the fullPage variant
          // above so both render paths behave identically.
          setEquipmentGroupSyncWarning(null);
          setStep('block');
        }}
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
        onClose={() => { setChecklistDialog(null); setPostAdvanceChecklistQueue([]); }}
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
// Phase 8.7 Wave-5: countdown helpers + temperature-options + instrument
// lookup live in `lib/filter-ops/use-dryer-countdown.ts`, shared with the
// mobile DryingFilterCard. Layout stays per-page (desktop = compact row,
// mobile = card with progress bar + minute:second countdown).

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
  const { executeOrQueue } = useOffline();
  const { data: state, mutate: refreshState } = useSWR<any>(`/api/filters/${filterId}/current-state`, { refreshInterval: 15000 });
  const [temp, setTemp] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  // Phase 8.7 Wave-5: shared 1Hz tick — same hook the mobile DryingFilterCard uses.
  const now = useNowTick();
  const [offlineState, setOfflineState] = useState<any>(null);
  const [offlineEquipGroups, setOfflineEquipGroups] = useState<any[]>([]);
  // Restore previously selected temperature from cache (survives navigation)
  // Also load offline state fallback from IndexedDB
  useEffect(() => {
    import('@/lib/offline-store').then(({ getCachedData }) => {
      getCachedData<number>(`dryer-temp-${filterId}`).then(saved => {
        if (saved !== null && saved !== undefined) setTemp(saved);
      });
      getCachedData<any>(`filter-state-${filterId}`).then(cached => {
        if (cached) setOfflineState(cached);
      });
      // Load cached equipment groups as fallback for offline
      getCachedData<any[]>('equipment-groups').then(groups => {
        if (groups) setOfflineEquipGroups(groups);
      });
    }).catch(() => {});
  }, [filterId]);

  // Use SWR data when available, fall back to offline cache
  const effectiveState = state ?? offlineState;
  const cyc = effectiveState?.currentCycle;
  // Phase 8.7 Wave-5: shared countdown projection (same shape mobile uses).
  const projection = projectDryerCountdown(cyc, now);
  const { startedAt, durationMin } = projection;

  // Equipment group from cycle or block fallback
  const stateGroup = effectiveState?.equipmentGroup;
  const blockGroups: any[] = effectiveState?.blockEquipmentGroups ?? [];
  // Offline fallback: resolve from cached equipment groups by block
  const offlineBlockGroups = (() => {
    if (stateGroup || blockGroups.length > 0) return [];
    const areaId = cyc?.cleaningAreaId;
    if (areaId) return offlineEquipGroups.filter((g: any) => g.blockId === areaId);
    return offlineEquipGroups.length === 1 ? offlineEquipGroups : [];
  })();

  // Resolve which group to use: cycle's group > block groups > offline fallback > user-selected
  const resolvedGroup = stateGroup
    ?? (blockGroups.length === 1 ? blockGroups[0] : null)
    ?? (offlineBlockGroups.length >= 1 ? offlineBlockGroups[0] : null)
    ?? (selectedGroupId ? blockGroups.find((g: any) => g.id === selectedGroupId) : null);

  // Phase 8.7 Wave-5: shared instrument lookup (same logic mobile uses).
  const dryerInstrument = findDryerTempInstrument(resolvedGroup);
  // Desktop snaps the first option to a least-count multiple ≥ min — keep the
  // snapped flavour to preserve byte-equivalent runtime for this page.
  const tempOptions = dryerInstrument
    ? buildTempOptionsSnapped(dryerInstrument.operatingMin, dryerInstrument.operatingMax, dryerInstrument.leastCount)
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

  // Phase 8.7 Wave-5: countdown numbers from the shared projection above.
  const halfElapsed = projection.halfReached;
  const remainingToHalfMin = projection.remainingToHalfMin;

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
      const { executed } = await executeOrQueue('advance', filterId, filterName, {
        targetState: 'DRY_IN',
        dryerAction: 'SUBMIT_READINGS',
        equipmentGroupId: resolvedGroup.id,
        instrumentReadings: readings,
        remarks: `Dryer temperature ${temp}${tempUom} - ${filterName}`,
      }, 'DRY_IN');
      setToast({ type: 'success', message: `${filterName} → Dry In complete (${temp}${tempUom})${executed ? '' : ' (queued)'}` });
      // Mark readings submitted in cache + clear persisted temp
      import('@/lib/offline-store').then(({ cacheData, getCachedData }) => {
        cacheData(`dryer-temp-${filterId}`, null, 0);
        getCachedData<any>(`filter-state-${filterId}`).then(cs => {
          if (cs) cacheData(`filter-state-${filterId}`, { ...cs, currentCycle: { ...(cs.currentCycle ?? {}), dryerReadingsSubmitted: true } });
        });
      }).catch(() => {});
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
            {cyc?.dryerReadingsSubmitted ? (
              <span className="text-green-600">• temperature recorded</span>
            ) : halfElapsed ? (
              <span className="text-green-600">• ready for reading</span>
            ) : (
              <span className="text-amber-600">• {remainingToHalfMin} min until reading</span>
            )}
          </div>
        </div>
        {cyc?.dryerReadingsSubmitted ? (
          <span className="text-xs text-green-600 font-medium bg-green-50 border border-green-200 rounded px-2 py-1">Complete</span>
        ) : needsGroupSelect ? (
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
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : '';
                setTemp(val);
                if (val !== '') {
                  import('@/lib/offline-store').then(({ cacheData }) => {
                    cacheData(`dryer-temp-${filterId}`, val, 24 * 60 * 60 * 1000);
                  }).catch(() => {});
                }
              }}
              disabled={!halfElapsed || submitting}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={dryerInstrument ? `${formatByLeastCount(dryerInstrument.operatingMin, dryerInstrument.leastCount)}–${formatByLeastCount(dryerInstrument.operatingMax, dryerInstrument.leastCount)} ${tempUom} (step ${dryerInstrument.leastCount})` : ''}
            >
              <option value="">{tempUom}</option>
              {tempOptions.map((v) => (
                <option key={v} value={v}>{formatByLeastCount(v, dryerInstrument?.leastCount)}{tempUom}</option>
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
