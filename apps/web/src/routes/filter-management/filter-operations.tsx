import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useReauth } from '../../hooks/use-reauth';
import { withStageAction, signOnce } from '../../lib/stage-reauth';
import { isReauthError } from '../../lib/report-export-log';
import { ReauthDialog } from '../../components/reauth-dialog';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { StageScanDialog } from './components/stage-scan-dialog';
import { CleaningReasonDialog } from './components/cleaning-reason-dialog';
import { EquipmentDialog } from './components/equipment-dialog';
import { DryerDurationDialog } from './components/dryer-duration-dialog';
import { normalizeRfidScan } from '@/lib/rfid-scan';
import { ChecklistDialog } from './components/checklist-dialog';
import { BlockChangeRequestDialog } from './components/block-change-request-dialog';
import { DryingFiltersPanel } from './components/drying-filters-panel';
import { buildAhuBlockMap, filtersInBlock } from '@/lib/ahu-block-map';
import { useFilterOperationsOfflineCache } from './hooks/use-filter-operations-offline-cache';
import { useRecentSubmissions } from './hooks/use-recent-submissions';
import { CLEANING_STAGES_OPS } from '../../lib/filter-constants';
import { ErrorPopup } from '../../components/ui/error-popup';
import { useOffline } from '../../hooks/use-offline';
import { onSyncEvent } from '../../lib/sync-engine';
import type { FilterInstance, PaginatedResponse } from '../../types/filter';
// Phase 8.6 — shared executor + action-tape resolver + offline-cache helper.
// All graph-walking decisions (next-stage, checklist-after-stage, cache
// rewrites) route through these so client/server stay in lockstep.
import { actionsForStage, getCurrentActions } from '@/lib/action-tape';
import { prettyStage as interlockStageLabel } from '@/lib/stage-approval';
import {
  cacheServerStateResponse,
  recomputeAndCacheFilterState,
} from '@/lib/offline-cache';
// Phase 8.7 Wave-5 split — shared with mobile-operations.tsx.
// PendingChecklist + dialog-resolver + offline-gate + first-stages walker live
// in lib/filter-ops so the two pages cannot drift on these primitives.
import {
  firstStagesFromGraph,
  equipmentGroupChoice,
  groupHasStageInstruments,
  resolveChecklistForTargetStage,
  resolvePendingChecklistDialog,
  findNextPendingChecklist,
  splitByReadings,
  splitNewCycleBatch,
  splitUnread,
  planFinalStageBatch,
  planPendingChecklistBatch,
  leftInQueueMessage,
  type BatchItem,
  type FinalStagePlan,
  type LeftItem,
  type PendingChecklist,
  type PendingChecklistBatchItem,
} from '@/lib/filter-ops';
// D1/D2/D4 refactor Day 4 (2026-05-18) — useFilterOperationsCore is now
// authoritative. All dialog state lives in core.dialogState (changed through
// core.dispatch). This page's stage writes are batch loops over executeOrQueue;
// a single-filter checklist submit goes through core.submitChecklist.
import { useFilterOperationsCore } from '@/lib/filter-ops/use-core';
// Task 7 — AHU completion pre-flight (Remaining Filters dialog).
import { useAhuCompletionMode } from '../../hooks/use-ahu-completion-mode';
import { checkAhuCompletionBatch, checkAhuHasBothSets, isTerminalChecklist, isCompletingAdvance, isTerminalTargetWithChecklist } from '../../lib/filter-ops/ahu-completion-check';
import { RemainingFiltersDialog } from './components/remaining-filters-dialog';
import { AhuSetChooserDialog, type FilterSetChoice } from './components/ahu-set-chooser-dialog';
import { PmPendingTasksDialog, type PendingPmTask } from '@/components/pm-pending-tasks-dialog';

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
  // ─── D1/D2/D4 Day 4 — useFilterOperationsCore is now authoritative ──────
  // AHU completion pre-flight for the hook's OWN dialog-first deferral
  // (single-filter advance / start-and-advance) — see the mobile page for the
  // full rationale. Resolves at call time, after the gate below is initialised.
  const core = useFilterOperationsCore({
    onBeforeDeferredChecklist: (filterId, targetState) =>
      gateAhuBeforeDeferredChecklist([filterId], targetState),
  });
  const { online, pendingCount, syncing, executeOrQueue, manualSync, clearQueue, cache, getCache } = useOffline();
  // Task 7: AHU completion mode (NONE / POPUP / INTERLOCK) from config.
  const ahuMode = useAhuCompletionMode();
  const { data: instancesData, error: instancesError } = useSWR<PaginatedResponse<FilterInstance>>('/api/assets/instances', { refreshInterval: online ? 30000 : 0 });
  const { data: templatesData, error: templatesError } = useSWR<PaginatedResponse<{ id: string; name: string }>>('/api/assets/templates');
  const { data: identifiersData } = useSWR<any[]>(online ? '/api/assets/identifiers' : null);
  // A-01 cluster Step 4 (2026-05-29): primary data source is the typed
  // hierarchy endpoints. Filter rows include the four cycle-state fields
  // (currentLifecycleState / currentCycleId / filterProfileId / filterSet)
  // because hierarchy.service.ts.listFilters LEFT JOINs FilterDetails
  // (Tier 1.6 unblock). The two legacy SWR calls above remain ONLY to feed
  // useFilterOperationsOfflineCache, which still primes the legacy mixed-kind
  // `filters` IDB store + offlineInstances/Templates that mobile-wrapper +
  // mobile-operations consume. Steps 5-6 migrate those consumers; Step 7
  // drops the legacy SWR + cache entirely.
  const { data: typedFiltersResp, error: typedFiltersError } = useSWR<PaginatedResponse<any>>(
    '/api/hierarchy/filters',
    { refreshInterval: online ? 30000 : 0 },
  );
  const { data: typedBlocksResp, error: typedBlocksError } = useSWR<PaginatedResponse<any>>(
    '/api/hierarchy/blocks',
  );
  // AHU→block resolution for the Dry In panel (scopes drying filters to the
  // selected block). Filter rows carry only ahuId; these give ahu.blockId /
  // area.blockId. Online-only — the panel's countdowns need the server anyway.
  const { data: ahusResp } = useSWR<PaginatedResponse<any>>(online ? '/api/hierarchy/ahus' : null);
  const { data: areasResp } = useSWR<PaginatedResponse<any>>(online ? '/api/hierarchy/areas' : null);
  const ahuBlockMap = useMemo(
    () => buildAhuBlockMap(ahusResp?.data ?? [], areasResp?.data ?? []),
    [ahusResp, areasResp],
  );
  const { data: reasonsData } = useSWR<any>(online ? '/api/filters/reasons' : null);
  const { data: equipGroupsData } = useSWR<any>(online ? '/api/equipment-groups' : null);
  const isMobile = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

  // Phase 2 of the offline-tier extraction: offline cache state + 9 priming
  // effects live in the hook so this file isn't fighting offline-cache
  // bookkeeping in the middle of cycle-write logic.
  const {
    // A-01 Step 4: offlineInstances/offlineTemplates no longer consumed in
    // this file's derivations — typed caches replace them. They remain in
    // the hook for mobile-wrapper + mobile-operations (Steps 5-6).
    offlineBlocks,
    offlineFiltersTyped,
    offlineDataLoaded,
    refreshOfflineInstances,
  } = useFilterOperationsOfflineCache({
    online,
    instancesData,
    templatesData,
    reasonsData,
    equipGroupsData,
    identifiersData,
  });

  const [mode, setMode] = useState<'operations' | 'status'>('operations');
  const [activeStage, setActiveStage] = useState<typeof CLEANING_STAGES[0] | null>(null);
  const [selectedStatusStage, setSelectedStatusStage] = useState<string | null>(null);
  const [step, setStep] = useState<'block' | 'scan'>('block');
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');


  // ── "Previous scheduled PM not carried out" gate ─────────────────────────
  //
  // The server 409s PM_PREVIOUS_TASK_PENDING when a PM cleaning is started on an
  // AHU that still owes an earlier PM, and returns the outstanding visits. The
  // dialog collects a reason per visit and the SAME call is retried with them
  // attached.
  //
  // Promise-based rather than a state machine: the gate happens INSIDE the
  // per-filter batch loop, so the loop has to await the operator's answer and
  // then continue with the remaining tags. On a 50-tag batch this fires once —
  // the first tag's write-off clears the pending state for the rest.
  const [pmGate, setPmGate] = useState<{
    tasks: PendingPmTask[];
    minReasonLength: number;
    resolve: (skips: Array<{ entryId: string; reason: string }> | null) => void;
  } | null>(null);
  const [pmGateBusy, setPmGateBusy] = useState(false);
  /** Answers given for the current batch — reused for its remaining tags. */
  const pmSkipsForBatch = useRef<Array<{ entryId: string; reason: string }>>([]);

  const askPmSkipReasons = (tasks: PendingPmTask[], minReasonLength: number) =>
    new Promise<Array<{ entryId: string; reason: string }> | null>((resolve) => {
      setPmGate({ tasks, minReasonLength, resolve });
    });  const [remarks, setRemarks] = useState('');
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
  // Stage interlock — when the current stage (Wash Out / Dry Out) is awaiting QA
  // approval, the server drops the advance action from the tape; this surfaces WHY.
  const [interlock, setInterlock] = useState<{
    gatedStage: boolean;
    stageKey: string | null;
    status: string | null;
    approvalId: string | null;
    approverRole: string | null;
    blocksLeaving: boolean;
  } | null>(null);
  const { recentSubmissions, record: recordSubmission } = useRecentSubmissions();
  const [submitting, setSubmitting] = useState(false); // double-submit guard

  // Scan queue (batch mode)
  const [scanQueue, setScanQueue] = useState<Array<{ filterId: string; filterName: string; tagId: string }>>([]);
  // Dry In multi-select (2026-09-04): Submit acts on the ticked queue rows only
  // (new rows start ticked), and on DRY_IN one duration covers the whole selection.
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  const [dryerBatchDuration, setDryerBatchDuration] = useState<number>(30);
  const toggleQueueSelect = (filterId: string) => setSelectedQueueIds(prev => { const n = new Set(prev); if (n.has(filterId)) n.delete(filterId); else n.add(filterId); return n; });
  const selectAllQueue = (all: boolean) => setSelectedQueueIds(all ? new Set(scanQueue.map(q => q.filterId)) : new Set());
  const [addingToQueue, setAddingToQueue] = useState(false);
  // Snapshot of queue while a shared dialog (reason/duration/equipment/checklist) is open
  const [pendingBatch, setPendingBatch] = useState<Array<{ filterId: string; filterName: string }> | null>(null);
  // The remark typed for the submit a dialog continues (2026-10-22). Opening the
  // dialog clears the scan screen, remark included, so the reason and readings
  // handlers read the cleared field and recorded the default remark instead of
  // the operator's.
  const batchRemarksRef = useRef('');

  // ─── Dialog state — owned by useFilterOperationsCore (D1/D2/D4 Day 4) ───
  // The six imperative useState hooks below are replaced by compat aliases
  // that narrow core.dialogState. JSX reads unchanged; dialog changes route
  // through core.dispatch so the D4 clobber-races are no longer expressible.
  // Capture narrowed state once so TypeScript's type narrowing holds inside
  // each compat alias (ternary RHS resets the narrowing).
  // Memoised on the dialog state (2026-10-22): each dialog resets its own inputs when
  // its `dialog` prop changes, so a fresh object on every render wiped a half-filled
  // checklist, typed readings (and aborted their fetch) and the chosen cleaning reason
  // on ANY re-render - a reader burst into the scan box, a toast, a refresh.
  const _ds = core.dialogState;
  const { reasonDialog, checklistDialog, equipmentDialog, dryerDialog, blockChangeDialog } = useMemo(() => {
    const reasonDialog = _ds.kind === 'awaiting_reason'
      ? {
          filterId: _ds.filterId,
          filterName: _ds.filterName,
          stage: CLEANING_STAGES.find(s => s.key === _ds.stage) as typeof CLEANING_STAGES[0],
          block: selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined,
        }
      : null;
    const checklistDialog = _ds.kind === 'awaiting_checklist'
      ? {
          filterId: _ds.filterId,
          filterName: _ds.filterName,
          checklists: _ds.checklists as PendingChecklist[],
        }
      : null;
    const equipmentDialog = _ds.kind === 'awaiting_equipment'
      ? {
          filterId: _ds.filterId,
          filterName: _ds.filterName,
          stage: CLEANING_STAGES.find(s => s.key === _ds.stage) as typeof CLEANING_STAGES[0],
          groups: _ds.groups as any[],
          cycleEquipmentGroup: _ds.cycleGroup,
          block: selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined,
        }
      : null;
    const dryerDialog = _ds.kind === 'awaiting_dryer'
      ? {
          filterId: _ds.filterId,
          filterName: _ds.filterName,
          block: selectedBlock ? { id: selectedBlock.id, name: selectedBlock.name } : undefined,
        }
      : null;
    const blockChangeDialog = _ds.kind === 'awaiting_block_change'
      ? _ds
      : null;
    return { reasonDialog, checklistDialog, equipmentDialog, dryerDialog, blockChangeDialog };
  }, [_ds, selectedBlock]);

  const [reasonError, setReasonError] = useState('');
  // PM-due context for the reason dialog: pre-select PM + show the PM banner.
  const [pmReasonCtx, setPmReasonCtx] = useState<{ pmDue: boolean; defaultReasonKey?: string }>({ pmDue: false });

  // Toast notification (appears at top, auto-dismisses)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);

  // Checklist state (loading/error remain local; dialog state is in core)
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState('');

  // Equipment group & instrument readings state (loading/error remain local)
  const [equipmentError, setEquipmentError] = useState('');
  const [equipmentLoading, setEquipmentLoading] = useState(false);

  // Dryer duration state (loading/error remain local)
  const [dryerLoading, setDryerLoading] = useState(false);
  const [dryerError, setDryerError] = useState('');

  // Block change request state (reason/submitting remain local)
  const [blockChangeReason, setBlockChangeReason] = useState('');
  const [blockChangeSubmitting, setBlockChangeSubmitting] = useState(false);
  // 2026-06-09: block-change approval replaced by an operator self-confirm. Filters
  // the operator confirmed for cross-block cleaning (start payload sends
  // acknowledgeBlockChange=true so the backend lets the cycle start in that block).
  const ackedBlockFiltersRef = useRef<Set<string>>(new Set());
  // 2026-06-09: cross-block mode is configurable (config block-change-approval.mode):
  // CONFIRM = operator self-confirm; APPROVAL = submit a request an approver approves.
  // Reads the authenticated-only /current mirror — the SUPER_ADMIN-gated
  // dynamic route 403'd for every operator role, silently defaulting to CONFIRM.
  // NONE needs no branch here: the dialog only opens when the SERVER reports
  // blockChangeStatus CONFIRM/REQUIRED, and under NONE current-state.ts reports
  // MATCH. This mode only picks the wording/flow once a dialog is warranted.
  const { data: bcCfg } = useSWR<any>('/api/config/block-change-approval/current');
  const blockChangeMode: 'CONFIRM' | 'APPROVAL' = bcCfg?.mode === 'APPROVAL' ? 'APPROVAL' : 'CONFIRM';
  // Task 7 + 2026-07-02: AHU remaining-filters dialog state + Promise resolve ref.
  // ahus = one card per AHU in the batch (multi-AHU carousel).
  const [ahuDialogState, setAhuDialogState] = useState<{
    mode: 'POPUP' | 'INTERLOCK';
    ahus: { ahuName: string; allAtFinal: boolean; filters: { id: string; name: string; stage: string; done: boolean }[] }[];
    currentFilterIds: string[];
  } | null>(null);
  const ahuDialogResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  // 2026-07-03: filter-set chooser shown BEFORE the AHU popup. The choice
  // scopes the status check AND rides in the submit body via ahuSetChoiceRef.
  const [ahuSetChooser, setAhuSetChooser] = useState<boolean>(false);
  const ahuSetResolveRef = useRef<((set: FilterSetChoice | null) => void) | null>(null);
  const ahuSetChoiceRef = useRef<FilterSetChoice | null>(null);

  // If SWR fetch failed (network error), treat as offline — use cached data.
  // A-01 Step 4: include typed-hierarchy errors so the typed source's network
  // failure cleanly drops to offlineFiltersTyped/offlineBlocks fallback.
  const swrFailed = !!(instancesError || templatesError || typedFiltersError || typedBlocksError);
  // Loading gate: prefer typed-hierarchy presence. Legacy SWR no longer
  // gates render — it stays only as cache-hook input. Offline branch waits
  // for IDB load (which now includes the typed-kind stores) as before.
  const isLoading = (!swrFailed && online)
    ? (!typedFiltersResp || !typedBlocksResp)
    : !offlineDataLoaded;

  // A-01 Step 4 (2026-05-29): primary source is the typed hierarchy endpoint.
  // FilterDetails join (Tier 1.6) provides currentLifecycleState, filterSet,
  // currentCycleId, filterProfileId on each row — the four fields the stage
  // counter / status drilldown / Set A/B labels / offline cycle-state fallback
  // depend on. Falls back to offlineFiltersTyped when SWR hasn't responded
  // (first paint / disconnect). The previous filterTemplateIds Set +
  // template.templateKind name-substring heuristic is gone: cache_filters_typed
  // is kind-scoped by design — no discrimination needed (see [[template-kind-
  // heuristic-bug-class]] memory). Same applies to `blocks` below.
  const typedFilters = (typedFiltersResp?.data ?? offlineFiltersTyped ?? []) as any[];
  const typedBlocks  = (typedBlocksResp?.data  ?? offlineBlocks         ?? []) as any[];

  // `instances` alias kept for the offline cycle-state fallback at the
  // /current-state catch branch (~line 472) which does instances.find(byId).
  // Shape-compatible with typedFilters per Tier 1.6 join.
  const instances = typedFilters;

  const allFilters = typedFilters.filter((f: any) => {
    if (f.isActive === false || f.status === 'Retired') return false;
    if (ahuIdFilter && f.ahuId !== ahuIdFilter) return false;
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
    // A-01 Step 4: invalidate typed-hierarchy SWR (primary source) AND the
    // legacy /api/assets/instances key (still feeds the offline cache hook
    // for the legacy mixed `filters` IDB store until Step 7).
    mutate('/api/hierarchy/filters');
    mutate('/api/hierarchy/blocks');
    mutate('/api/assets/instances');
  }, []);

  // A-01 Step 4: blocks come direct from the typed-hierarchy endpoint. The
  // previous `templates.find(BLOCK)?.id` + instance-template-match heuristic
  // is gone — cache_blocks is kind-scoped.
  const blocks = typedBlocks.filter((b: any) => b.isActive !== false);

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
    setScanValue(''); setRemarks(''); setError(''); setScanQueue([]); setSelectedQueueIds(new Set()); setEquipmentGroupSyncWarning(null);
  };
  // Drop only the rows that were just submitted; unticked rows stay queued.
  const dropFromQueue = (ids: string[]) => {
    const gone = new Set(ids);
    setScanQueue(prev => prev.filter(q => !gone.has(q.filterId)));
    setSelectedQueueIds(prev => new Set([...prev].filter(id => !gone.has(id))));
    setScanValue(''); setError('');
  };
  // Filters left out of this submit (lib/filter-ops/batch-plan) go back in the
  // queue, ticked, with why — after clearScanState/dropFromQueue, which clear both.
  const keepQueued = (left: LeftItem[]) => {
    if (left.length === 0) return;
    setScanQueue(prev => [
      ...prev,
      ...left
        .filter(l => !prev.some(q => q.filterId === l.item.filterId))
        .map(l => ({ filterId: l.item.filterId, filterName: l.item.filterName, tagId: (l.item as { tagId?: string }).tagId ?? l.item.filterName })),
    ]);
    setSelectedQueueIds(prev => new Set([...prev, ...left.map(l => l.item.filterId)]));
    setError(leftInQueueMessage(left));
  };

  /**
   * Each filter's OWN state for a batch (2026-10-22): the batch is decided per
   * filter (lib/filter-ops/batch-plan), never on the first one alone. The first
   * filter's state is already in hand. Online, the others are read live and
   * cached — the checklist resolvers read the cache. When a read fails, or
   * offline, the cached row; null when there is none, and the planners then
   * leave that filter in the queue rather than give it another's call.
   * Six reads at a time (~6 queries each server-side), not one after another.
   */
  const loadBatchStates = async (batch: BatchItem[], firstState: any, csQuery: string): Promise<Map<string, any>> => {
    const states = new Map<string, any>();
    if (batch.length === 0) return states;
    states.set(batch[0].filterId, firstState);
    const rest = batch.slice(1);
    let next = 0;
    const readOne = async (filterId: string): Promise<any> => {
      if (online) {
        try {
          const live = await apiClient.get<any>(`/api/filters/${filterId}/current-state${csQuery}`);
          await cacheServerStateResponse(filterId, live);
          return live;
        } catch {
          // Not read live (offline, or refused): the cached row below decides.
        }
      }
      return (await getCache<any>(`filter-state-${filterId}`).catch(() => null)) ?? null;
    };
    const worker = async () => {
      while (next < rest.length) {
        const item = rest[next++];
        states.set(item.filterId, await readOne(item.filterId));
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, rest.length) }, worker));
    return states;
  };
  // Close stage screen and go back to landing
  const closeDialog = () => {
    setActiveStage(null); setSelectedBlock(null); setScanValue(''); setRemarks(''); setError(''); setScanQueue([]); setEquipmentGroupSyncWarning(null);
    core.dispatch({ type: 'close' });
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
    // Upper-case + de-duplicate the reader burst — ONE rule for every scan path (lib/rfid-scan.ts).
    const trimmed = normalizeRfidScan(tagOrName);
    if (!trimmed) return null;

    // Audit 2026-09-24 (web F3, closed 2026-09-25): mirror the server's
    // creation-workflow gate at scan time — a filter that is not APPROVED is
    // refused here, with the server's wording, instead of entering the queue
    // and failing the submit with 409 FILTER_NOT_APPROVED. Only an EXPLICIT
    // non-APPROVED value blocks; a missing value (older cache rows) does not.
    type Resolved = { filterId: string; filterName: string; approvalStatus?: string | null };
    const gate = (r: Resolved): Resolved => {
      const st = r.approvalStatus ?? (instances.find((a: any) => a.id === r.filterId) as any)?.approvalStatus ?? null;
      if (st != null && st !== 'APPROVED') {
        const why = st === 'REJECTED' ? 'was rejected and must be corrected and re-submitted' : 'is still awaiting review/approval';
        throw new Error(`Filter "${r.filterName}" ${why}, so it cannot be cleaned yet.`);
      }
      return { filterId: r.filterId, filterName: r.filterName };
    };

    // 1. Try API lookup (works when online) — authoritative for reassigned tags.
    try {
      const lookup = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(trimmed)}`);
      if (lookup?.asset?.id) {
        const resolved: Resolved = { filterId: lookup.asset.id as string, filterName: lookup.asset.name as string, approvalStatus: lookup.asset.approvalStatus ?? null };
        // Self-heal the offline cache so a later offline scan of this (possibly
        // just-reassigned) tag resolves to the CURRENT filter, not a stale one.
        try {
          const m = (await getCache<Record<string, Resolved>>('identifier-map')) || {};
          m[trimmed] = resolved; m[trimmed.toUpperCase()] = resolved; m[trimmed.toLowerCase()] = resolved;
          await cache('identifier-map', m);
        } catch { /* best-effort cache write */ }
        return gate(resolved);
      }
    } catch (e: any) {
      if (e instanceof Error && /cannot be cleaned yet/.test(e.message)) throw e;
      /* offline or network error — fall through */
    }

    // 2. Try cached identifier map (works offline — built from identifiers API and stored in IndexedDB)
    try {
      const identifierMap = await getCache<Record<string, Resolved>>('identifier-map');
      if (identifierMap) {
        const entry = identifierMap[trimmed] || identifierMap[trimmed.toUpperCase()] || identifierMap[trimmed.toLowerCase()];
        if (entry) return gate(entry);
      }
    } catch (e: any) {
      if (e instanceof Error && /cannot be cleaned yet/.test(e.message)) throw e;
      /* IndexedDB error — fall through */
    }

    // 3. Try matching by filter name
    const match = instances.find((a: any) => a.name?.toLowerCase() === trimmed.toLowerCase());
    if (match) return gate({ filterId: match.id, filterName: match.name, approvalStatus: (match as any).approvalStatus ?? null });
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
      setSelectedQueueIds(prev => new Set([...prev, resolved.filterId]));
    } catch (e: any) {
      setError(e.message ?? 'Failed to add to queue');
    }
    setAddingToQueue(false);
  };

  const handleRemoveFromQueue = (filterId: string) => {
    setScanQueue(prev => prev.filter(q => q.filterId !== filterId));
    setSelectedQueueIds(prev => { const n = new Set(prev); n.delete(filterId); return n; });
  };

  // Loop the batch advancing each filter with shared params.
  // 'dialog' = it opened a dialog (block change / a checklist), 'stopped' = it
  // wrote nothing (AHU pre-flight or signature declined).
  const advanceBatch = async (
    batch: Array<{ filterId: string; filterName: string }>,
    extraBody: Record<string, any>,
    overrideTargetState?: string,
    // The caller already ran ONE AHU pre-flight over this batch and more.
    opts: { ahuGated?: boolean } = {},
  ): Promise<'done' | 'dialog' | 'stopped'> => {
    if (!activeStage) return 'stopped';
    const stageLabel = activeStage.label;
    const blockId = selectedBlock?.id;
    const blockName = selectedBlock?.name;
    // AHU pre-flight for the checklist-less completion case (2026-08-10). One
    // call for the WHOLE batch, before the loop — never per filter.
    if (
      !opts.ahuGated &&
      (await gateAhuBeforeCompletingAdvance(
        batch.map(b => b.filterId),
        overrideTargetState ?? activeStage.key,
      )) === 'blocked'
    ) return 'stopped';
    // Sign ONCE for the whole batch (2026-09-24): ADVANCE_FILTER_STAGE and the
    // station row can be switched on; the password is forwarded per filter.
    const sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], overrideTargetState ?? activeStage.key));
    if (!sig.ok) return 'stopped';
    let dialogOpened = false;
    let success = 0;
    const failed: string[] = [];
    const newSubmissions: Array<{stage: string; filter: string; block?: string; time: string}> = [];
    for (const item of batch) {
      try {
        const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, {
          targetState: overrideTargetState ?? activeStage.key,
          cleaningAreaId: blockId,
          remarks: remarks || `${stageLabel} - Batch - ${item.filterName}`,
          // Operator's A/B/All pick from the AHU pre-flight above. Only set when
          // this advance completes the cycle; scopes the server INTERLOCK gate to
          // the same roster the popup showed (mirrors submit-checklist).
          ...(ahuSetChoiceRef.current ? { filterSet: ahuSetChoiceRef.current } : {}),
          ...extraBody,
        }, overrideTargetState ?? activeStage.key, sig.password);
        success++;
        // Update cached pipeline state after offline advance.
        // Deep-review fix D3: pass blockId so the offline cycle stub records cleaningAreaId.
        if (!executed) await recomputeAndCacheFilterState(item.filterId, overrideTargetState ?? activeStage.key, false, blockId ?? null);
        newSubmissions.push({ stage: stageLabel + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
      } catch (e: any) {
        if ((e.code === 'BLOCK_CHANGE_CONFIRM' || e.code === 'BLOCK_CHANGE_REQUIRED') && e.connectionInfo) {
          core.dispatch({
            type: 'open_block_change',
            filterId: e.connectionInfo.filterId ?? item.filterId,
            filterName: item.filterName,
            homeBlockId: e.connectionInfo.homeBlockId,
            homeBlockName: e.connectionInfo.homeBlockName,
            requestedBlockId: e.connectionInfo.requestedBlockId,
            requestedBlockName: e.connectionInfo.requestedBlockName,
          });
          setBlockChangeReason('');
          dialogOpened = true;
          failed.push(`${item.filterName}: Block change approval required`);
        } else {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
    }
    recordSubmission(newSubmissions);
    refreshFilters();
    // Gap 20: Refresh offline cached data after queued operations
    if (newSubmissions.some(s => s.stage.includes('queued'))) {
      refreshOfflineInstances();
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
        // Not over a block-change dialog this loop opened: the dialog reducer
        // refuses to open one dialog over another.
        if (next && !dialogOpened) {
          // AHU pre-flight BEFORE the (terminal) checklist opens (whole batch).
          if ((await gateAhuBeforeChecklist(cycleBatch.map(b => b.filterId))) === 'proceed') {
            core.dispatch({
              type: 'open_checklist',
              filterId: next.item.filterId,
              filterName: next.item.filterName,
              checklists: next.checklists,
              remainingBatch: next.remaining,
            });
            setChecklistError('');
            dialogOpened = true;
          }
        }
      } catch { /* ignore */ }
    }
    if (failed.length > 0 && !blockChangeDialog) {
      setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
    } else if (failed.length === 0) {
      setToast({ type: 'success', message: `${success} filter(s) → ${stageLabel}` });
    }
    return dialogOpened ? 'dialog' : 'done';
  };


  const handleSubmitBatch = async () => {
    // Dry In multi-select (2026-09-04): only the ticked rows are submitted.
    const batchQueue = scanQueue.filter(q => selectedQueueIds.has(q.filterId));
    if (batchQueue.length === 0 || !activeStage || submitting) return;
    setLoading(true); setSubmitting(true); setError('');
    batchRemarksRef.current = remarks;
    try {
      // Try to inspect first filter's state to decide which dialog to show.
      // When offline, skip state inspection and queue the advance directly.
      const first = batchQueue[0];
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
      // Stage interlock state (online responses only; offline state omits it).
      setInterlock(state.interlock ?? null);

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

        // OFFLINE cross-block: never blocks (no confirm, no approval per config).
        // Just show an informational notice that the filter belongs elsewhere and
        // let the operation queue; the server auto-passes the offline replay.
        if (state.homeBlock && selectedBlock?.id && state.homeBlock.id !== selectedBlock.id) {
          setToast({ type: 'success', message: `Note: ${first.filterName} belongs to ${state.homeBlock.name}, not ${selectedBlock.name}. Recorded offline.` });
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

      // Gap 9: Proactive cross-block gate (ONLINE only — offline showed a notice
      // above and proceeds). CONFIRM → confirm dialog; REQUIRED → request dialog.
      // APPROVED/MATCH proceed. Acked filters (CONFIRM mode) skip.
      if (online && state.homeBlock && selectedBlock?.id && state.homeBlock.id !== selectedBlock.id
          && !ackedBlockFiltersRef.current.has(first.filterId)
          && (state.blockChangeStatus === 'CONFIRM' || state.blockChangeStatus === 'REQUIRED')) {
        core.dispatch({
          type: 'open_block_change',
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

      // Every filter's OWN state from here on (2026-10-22). The first filter
      // picks which step this submit is; which filters share that step's call is
      // decided per filter (lib/filter-ops/batch-plan). The others stay queued.
      const states = await loadBatchStates(batchQueue, state, csQuery);
      const stateOf = (filterId: string) => states.get(filterId) ?? null;

      // Phase 8.7 Wave-5: shared checklist-dialog resolver. Pass the resolved
      // tape from the offline-gate computation above so we don't recompute it.
      {
        const dialogChecklists = await resolvePendingChecklistDialog(first.filterId, resolvedActions);
        if (dialogChecklists) {
          // One set of answers is sent to every filter of the dialog, so only the
          // filters waiting on the SAME checklist share it.
          const plan = await planPendingChecklistBatch(batchQueue, stateOf, (id) =>
            id === first.filterId ? Promise.resolve(dialogChecklists) : resolvePendingChecklistDialog(id, stateOf(id)?.actions));
          // AHU pre-flight BEFORE the (terminal) checklist opens (whole batch).
          if ((await gateAhuBeforeChecklist(plan.ride.map(q => q.filterId))) === 'blocked') {
            setLoading(false); setSubmitting(false);
            return;
          }
          const batch = plan.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          keepQueued(plan.left);
          core.dispatch({ type: 'open_checklist', filterId: batch[0].filterId, filterName: `${batch.length} filter(s)`, checklists: plan.checklists });
          setChecklistError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      }

      // Need cycle start — always confirm the reason via the dialog. For a
      // PM-due filter, pre-select PM + show a "PM schedule" banner so the
      // operator confirms PM (completes the My Tasks PM task) or picks another
      // reason (which leaves the PM task pending). No more silent PM auto-start.
      if (!state.currentCycle) {
        // A new cycle starts at the pipeline's FIRST stage. The offline gate
        // above already says so; online it was left to the server, which only
        // refuses the ADVANCE — after the reason was asked and the cycle started
        // (2026-10-01).
        const firstStagesForStart = firstStagesFromGraph(state.pipelineGraph);
        if (firstStagesForStart.length > 0 && !firstStagesForStart.includes(activeStage.key)) {
          setPopupError(`${first.filterName} has no cleaning cycle yet. Start it at ${firstStagesForStart.map((s: string) => s.replace(/_/g, ' ')).join(', ')}, not ${activeStage.label}.`);
          setLoading(false); setSubmitting(false);
          return;
        }
        // Only filters with no cycle whose cleaning starts here get a START.
        const startable = splitNewCycleBatch(batchQueue, stateOf, activeStage.key, (st) => firstStagesFromGraph(st?.pipelineGraph));
        const batch = startable.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
        setPendingBatch(batch);
        setPmReasonCtx(state.isPmDue && state.pmReasonKey ? { pmDue: true, defaultReasonKey: state.pmReasonKey } : { pmDue: false });
        clearScanState();
        keepQueued(startable.left);
        core.dispatch({ type: 'open_reason', filterId: first.filterId, filterName: `${batch.length} filter(s)`, stage: activeStage.key });
        setReasonError('');
        setLoading(false); setSubmitting(false);
        return;
      }

      // Which equipment group the readings use (operator decision 2026-10-22): a
      // cycle not yet bound to one, on a block with several, gets a CHOICE in the
      // readings dialog. The state's `equipmentGroup` is then only the block's
      // oldest group, not a decision — using it recorded readings against a group
      // nobody chose. One rule for every surface (lib/filter-ops).
      const groupChoice = equipmentGroupChoice(state);
      const readingsDialogGroups = groupChoice.needsChoice
        ? { groups: groupChoice.groups, cycleGroup: undefined }
        : { groups: [] as any[], cycleGroup: groupChoice.group };

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
          // Step 1 (2026-09-04): the ONE duration chosen in the queue header is
          // applied to every selected filter — no per-batch dialog any more.
          const known = splitUnread(batchQueue, stateOf);
          const batch = known.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          await startDryerForBatch(batch, dryerBatchDuration);
          dropFromQueue(batch.map(b => b.filterId));
          keepQueued(known.left);
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

        if (groupChoice.groups.length > 0) {
          // Step 2: shared temperature/readings dialog — for the filters whose
          // readings go to the SAME group (2026-10-22): a cycle bound to another
          // group, or one that needs its own choice, is not sent this one.
          const split = splitByReadings(batchQueue, stateOf, null);
          const batch = split.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          keepQueued(split.left);
          core.dispatch({ type: 'open_equipment', filterId: first.filterId, filterName: `${batch.length} filter(s)`, stage: activeStage.key, ...readingsDialogGroups });
          setEquipmentError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      }

      // Check if the equipment group (or, when the operator must choose, any group
      // on offer) has instruments for this stage — show readings dialog if so
      if (groupChoice.groups.length > 0 && selectedBlock?.id) {
        if (groupChoice.groups.some((g: any) => groupHasStageInstruments(g, activeStage.key))) {
          const split = splitByReadings(batchQueue, stateOf, activeStage.key);
          const batch = split.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          keepQueued(split.left);
          core.dispatch({ type: 'open_equipment', filterId: first.filterId, filterName: `${batch.length} filter(s)`, stage: activeStage.key, ...readingsDialogGroups });
          setEquipmentError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      } else if (activeStage.key === 'WASH_IN' && selectedBlock?.id) {
        // 2026-10-08: a cycle that did NOT start at Wash In (e.g. a Dry In →
        // Dry Out → Wash In profile) reaches Wash In mid-cycle, possibly with no
        // equipment group bound yet. The server still requires the readings
        // whenever the block has an active group (WASH_IN_READINGS_REQUIRED), so
        // ask for them here — the dialog lets the operator pick the group.
        let groups: any[] = [];
        if (online) {
          try { groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${selectedBlock.id}`) ?? []; } catch { /* fall back to cache */ }
        }
        if (groups.length === 0) {
          try { groups = ((await getCache<any[]>('equipment-groups')) ?? []).filter((g: any) => g.blockId === selectedBlock.id); } catch { /* none cached */ }
        }
        if (groups.length > 0) {
          const split = splitByReadings(batchQueue, stateOf, null, groups);
          const batch = split.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
          setPendingBatch(batch);
          clearScanState();
          keepQueued(split.left);
          core.dispatch({ type: 'open_equipment', filterId: first.filterId, filterName: `${batch.length} filter(s)`, stage: activeStage.key, groups });
          setEquipmentError('');
          setLoading(false); setSubmitting(false);
          return;
        }
      }

      // No dialog needed → advance. A filter that DOES take readings here is not
      // advanced without them (2026-10-22); the page asks for readings only with
      // a block selected. Into the LAST stage with a checklist after it (A-01),
      // each filter's own profile decides (advanceIntoStage).
      const split = selectedBlock?.id ? splitByReadings(batchQueue, stateOf, activeStage.key) : splitUnread(batchQueue, stateOf);
      const batch = split.ride.map(q => ({ filterId: q.filterId, filterName: q.filterName }));
      const { outcome, left } = await advanceIntoStage(batch, activeStage.key, {
        targetState: activeStage.key,
        cleaningAreaId: selectedBlock?.id,
        ...(remarks ? { remarks } : {}),
      }, stateOf, (plain, opts) => advanceBatch(plain, {}, undefined, opts));
      // Nothing written (AHU pre-flight or signature declined): the queue stays for a retry.
      if (outcome !== 'stopped') {
        // Stay on the stage screen; clear queue so user can scan more
        clearScanState();
        keepQueued([...split.left, ...left]);
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

    // Start a cycle for every filter in the snapshot. The reason dialog opens only
    // from handleSubmitBatch, always with the queue snapshot in pendingBatch (one
    // scanned filter is a batch of one). The separate single-filter path that
    // followed here could not be reached and was removed 2026-10-22.
    // For WASH_IN with equipment groups on the block, pause after start-cycle
    // and hand off to the equipment-group / limits dialog (which will run the
    // batch advance). For every other stage, advance immediately.
    if (!pendingBatch || pendingBatch.length === 0 || !reasonDialog.stage) return;
    const stage = reasonDialog.stage;
    const blockId = reasonDialog.block?.id;
    const blockName = reasonDialog.block?.name;
    const block = reasonDialog.block;
    // The remark typed for this submit: the scan screen's field was cleared when
    // the reason dialog opened.
    const typedRemarks = batchRemarksRef.current;
    const startBody = { cleaningReasonKey: reasonKey, cleaningJustification: justification || undefined, cleaningAreaId: blockId };
    setLoading(true); setReasonError(''); setSubmitting(true);

    // Wash In on a block with equipment groups: the readings dialog takes over
    // after the start (step 2 below). Read before the start now, because it also
    // decides whether the start can wait on a checklist.
    const blockEquipmentGroups = async (id: string): Promise<any[]> => {
      try {
        return await apiClient.get<any[]>(`/api/equipment-groups/by-block/${id}`) ?? [];
      } catch {
        // Offline: use cached equipment groups filtered by block
        try {
          return ((await getCache<any[]>('equipment-groups')) ?? []).filter((g: any) => g.blockId === id);
        } catch { return []; /* no cached groups */ }
      }
    };
    const washInGroups = stage.key === 'WASH_IN' && blockId && block ? await blockEquipmentGroups(blockId) : [];

    // A START whose first stage is ALSO the last, with a checklist after it
    // (2026-10-22): the start-cycle was written, then the bare advance refused
    // (A-01, CHECKLIST_REQUIRED) — a cycle started at no stage. Ask the checklist
    // FIRST and write start + advance + answers as ONE queued op
    // (start-and-advance-with-checklist), like the tablet. Per filter: a batch may
    // mix profiles. Not for Dry In (a profile ending at Dry In is with the
    // operator) nor a Wash In whose readings dialog follows the start.
    let batch: BatchItem[] = pendingBatch;
    let parkAfter: { carry: BatchItem[]; checklists: PendingChecklist[] } | null = null;
    if (stage.key !== 'DRY_IN' && washInGroups.length === 0) {
      const stateOf = await cachedStatesOf(pendingBatch);
      const plan = await planFinalStageBatch(pendingBatch, stage.key, stateOf, (id) => resolveChecklistForTargetStage(id, stage.key, online));
      keepQueued(plan.left);
      batch = plan.plain;
      if (plan.carry.length > 0) {
        if ((await gateAhuForFinalStage(plan, stage.key, stateOf)) === 'blocked') {
          setLoading(false); setSubmitting(false);
          return;
        }
        parkAfter = { carry: plan.carry, checklists: plan.checklists };
      }
    }
    const parkedAdvance = { targetState: stage.key, cleaningAreaId: blockId, ...(typedRemarks ? { remarks: typedRemarks } : {}) };
    if (batch.length === 0) {
      // Nothing starts without its checklist: open it, nothing is written yet.
      if (parkAfter) openParkedChecklist(parkAfter.carry, parkAfter.checklists, stage.key, parkedAdvance, startBody);
      else { core.dispatch({ type: 'close' }); setPendingBatch(null); }
      setLoading(false); setSubmitting(false);
      return;
    }
    // The checklist group waits for the plain starts; if they stop part-way it
    // stays queued, named, for its own submit.
    const requeueParked = () => {
      if (parkAfter) keepQueued(parkAfter.carry.map(item => ({ item, note: 'its checklist was not asked — submit it again' })));
    };
    // + the station row of the first stage (2026-09-24).
    await reauth.execute(withStageAction(['START_CLEANING_CYCLE'], stage.key), async (password?) => {
      // 1) Start cycle for every filter in the batch.
      //    `password` is forwarded so executeOrQueue's online path uses
      //    postWithReauth — closes the gap that previously dropped the
      //    operator's typed password and surfaced as "Password is required"
      //    on every batch start by an ADMIN-role user.
      let started = 0; const startFailed: string[] = [];
      // Fresh batch: forget any answers carried from a previous run, or a
      // reason given for one AHU would silently ride along to another.
      pmSkipsForBatch.current = [];
      for (const item of batch) {
        try {
          const startPayload = {
            ...startBody,
            acknowledgeBlockChange: ackedBlockFiltersRef.current.has(item.filterId),
            // Carried forward once the operator has answered for this AHU, so
            // the remaining tags in the batch do not re-prompt.
            ...(pmSkipsForBatch.current.length > 0 ? { pmSkips: pmSkipsForBatch.current } : {}),
          };
          try {
            await executeOrQueue('start-cycle', item.filterId, item.filterName, startPayload, undefined, password);
          } catch (startErr: any) {
            const code = startErr?.error ?? startErr?.code;
            const pending = startErr?.connectionInfo?.pendingPmTasks;
            if (code !== 'PM_PREVIOUS_TASK_PENDING' || !Array.isArray(pending) || pending.length === 0) throw startErr;
            // Ask once, then retry this same tag with the answers attached.
            const answers = await askPmSkipReasons(pending, startErr?.connectionInfo?.minReasonLength ?? 5);
            if (!answers) throw startErr; // operator cancelled — leave the tag unstarted
            pmSkipsForBatch.current = answers;
            await executeOrQueue('start-cycle', item.filterId, item.filterName,
              { ...startPayload, pmSkips: answers }, undefined, password);
          }
          started++;
        } catch (e: any) {
          // REAUTH errors must NOT be swallowed into the per-filter
          // failure list — the reauth dialog needs to stay open with
          // the inline "Incorrect password" message and let the
          // operator retry, instead of closing on a generic popup.
          // A lockout (ACCOUNT_LOCKED) escapes too (2026-10-22): it refuses the
          // signature, not this filter, and counting it re-sent the same wrong
          // password for every remaining filter (one more failed signature each).
          if (isReauthError(e)) throw e;
          if ((e.code === 'BLOCK_CHANGE_CONFIRM' || e.code === 'BLOCK_CHANGE_REQUIRED') && e.connectionInfo) {
            core.dispatch({ type: 'close' }); // close reason dialog
            core.dispatch({
              type: 'open_block_change',
              filterId: e.connectionInfo.filterId ?? item.filterId,
              filterName: item.filterName,
              homeBlockId: e.connectionInfo.homeBlockId,
              homeBlockName: e.connectionInfo.homeBlockName,
              requestedBlockId: e.connectionInfo.requestedBlockId,
              requestedBlockName: e.connectionInfo.requestedBlockName,
            });
            setBlockChangeReason('');
            setPendingBatch(null);
            refreshFilters();
            requeueParked();
            setLoading(false); setSubmitting(false);
            return;
          }
          startFailed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      if (startFailed.length > 0) {
        setPopupError(`${started} cycle(s) started, ${startFailed.length} failed:\n${startFailed.join('\n')}`);
        core.dispatch({ type: 'close' }); // close reason dialog
        setPendingBatch(null);
        refreshFilters();
        requeueParked();
        return;
      }

      // 2) WASH_IN + block selected → check for equipment groups; if any,
      //    hand off to equipment/limits dialog (keeps pendingBatch set).
      if (washInGroups.length > 0) {
        core.dispatch({ type: 'close' }); // close reason dialog
        core.dispatch({ type: 'open_equipment', filterId: batch[0].filterId, filterName: `${batch.length} filter(s)`, stage: stage.key, groups: washInGroups });
        setEquipmentError('');
        return; // pendingBatch stays set — equipment dialog handles advance
      }

      // 3) No equipment dialog needed → advance the whole batch now.
      // AHU pre-flight for the checklist-less completion case (2026-08-10);
      // one call for the whole batch, before the loop. Already run, once, over
      // these AND the checklist group when one waits (gateAhuForFinalStage).
      if (!parkAfter && (await gateAhuBeforeCompletingAdvance(batch.map(b => b.filterId), stage.key)) === 'blocked') {
        setLoading(false); setSubmitting(false);
        return;
      }
      const sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], stage.key));
      if (!sig.ok) { requeueParked(); setLoading(false); setSubmitting(false); return; }
      let success = 0; const failed: string[] = [];
      const newSubs: typeof recentSubmissions = [];
      for (const item of batch) {
        try {
          const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, {
            targetState: stage.key,
            cleaningAreaId: blockId,
            remarks: typedRemarks || `${stage.label} - Batch - ${item.filterName}`,
            // See advanceBatch: scopes the server INTERLOCK gate to the roster
            // the AHU pre-flight showed. Absent when the pre-flight didn't run.
            ...(ahuSetChoiceRef.current ? { filterSet: ahuSetChoiceRef.current } : {}),
            // A cycle that STARTS at Dry In enters it with the dryer running (2026-10-06).
            ...dryerFieldsForStart(stage.key),
          }, stage.key, sig.password);
          success++;
          newSubs.push({ stage: stage.label + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
        } catch (e: any) {
          if ((e.code === 'BLOCK_CHANGE_CONFIRM' || e.code === 'BLOCK_CHANGE_REQUIRED') && e.connectionInfo) {
            core.dispatch({ type: 'close' }); // close reason dialog
            core.dispatch({
              type: 'open_block_change',
              filterId: e.connectionInfo.filterId ?? item.filterId,
              filterName: item.filterName,
              homeBlockId: e.connectionInfo.homeBlockId,
              homeBlockName: e.connectionInfo.homeBlockName,
              requestedBlockId: e.connectionInfo.requestedBlockId,
              requestedBlockName: e.connectionInfo.requestedBlockName,
            });
            setBlockChangeReason('');
            setPendingBatch(null); refreshFilters();
            requeueParked();
            return;
          }
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      recordSubmission(newSubs);
      refreshFilters();
      // A Dry In START: the dryer runs from this moment — remember its timing
      // offline exactly as the mid-pipeline dryer start does (2026-10-06).
      if (stage.key === 'DRY_IN') await primeDryerCacheForBatch(batch, dryerBatchDuration, blockId);
      core.dispatch({ type: 'close' }); // close reason dialog
      setPendingBatch(null);
      if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else setToast({ type: 'success', message: `${success} filter(s) → ${stage.label}` });
      // Then the filters whose START waits on its checklist: nothing written yet.
      if (parkAfter) openParkedChecklist(parkAfter.carry, parkAfter.checklists, stage.key, parkedAdvance, startBody);
    }, {
      onError: (e: unknown) => { setReasonError((e as any)?.message ?? 'Failed'); setPopupError((e as any)?.message ?? 'Failed'); },
      // A dismissed password prompt is not a failure: the reason dialog stays for a retry, nothing is shown.
      onCancel: () => { setLoading(false); setSubmitting(false); },
    });
    setLoading(false); setSubmitting(false);
  };

  /**
   * Remember dryer timing + the block's equipment group on each filter's cache
   * row (offline countdown, temperature dropdown, navigation persistence).
   * Shared by the mid-pipeline dryer start and, since 2026-10-06, a cycle START
   * whose first stage is DRY_IN.
   */
  const primeDryerCacheForBatch = async (batch: Array<{ filterId: string }>, minutes: number, blockId: string | undefined) => {
    const dryerStartedAt = new Date().toISOString();
    // Resolve equipment group for offline temperature dropdown
    let batchEqGroup: any = null;
    if (blockId) {
      try {
        const allGroups = await getCache<any[]>('equipment-groups') ?? [];
        const blockGroups = allGroups.filter((g: any) => g.blockId === blockId);
        if (blockGroups.length === 1) batchEqGroup = blockGroups[0];
      } catch { /* IDB read failed — batchEqGroup stays null and each item resolves its own */ }
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
  };

  /**
   * Dryer fields for the ADVANCE half of a cycle START whose first stage is
   * DRY_IN (2026-10-06). The start payloads on this page carried no dryer
   * fields, so a profile that begins with Dry In entered the stage with no
   * duration and the dryer phase was skipped silently. ONE duration for the
   * batch, from the queue header. Empty for any other stage.
   */
  const dryerFieldsForStart = (stageKey: string): Record<string, any> =>
    stageKey === 'DRY_IN' ? { dryerAction: 'SET_DURATION', dryerDurationMinutes: dryerBatchDuration } : {};

  // Dry In multi-select (2026-09-04): start the dryer for a batch with ONE duration.
  // Shared by the queue-header path (no dialog) and the legacy dialog path.
  const startDryerForBatch = async (batch: Array<{ filterId: string; filterName: string }>, minutes: number) => {
    const blockId = selectedBlock?.id;
    const blockName = selectedBlock?.name;
      const sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], 'DRY_IN'));
      if (!sig.ok) return;
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
          }, 'DRY_IN', sig.password);
          success++;
          newSubs.push({ stage: 'Dryer Started' + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
        } catch (e: any) {
          failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        }
      }
      recordSubmission(newSubs);
      refreshFilters();
      // Cache dryer timing + equipmentGroup for each filter (offline + navigation persistence)
      await primeDryerCacheForBatch(batch, minutes, blockId);
      // Update offline cache (action tape + reachable-target mirrors) per filter when queued.
      // Deep-review fix D3: blockId pulled from selectedBlock via wrapper default.
      for (const item of batch) {
        await recomputeAndCacheFilterState(item.filterId, 'DRY_IN', false, selectedBlock?.id ?? null);
      }
      if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else setToast({ type: 'success', message: `${success} filter(s) → Dryer running (${minutes} min)` });
  };

  const handleDryerDurationSubmit = async (minutes: number) => {
    if (!dryerDialog || dryerLoading) return;
    setDryerLoading(true); setDryerError('');
    const blockId = dryerDialog.block?.id;
    const blockName = dryerDialog.block?.name;

    // BATCH MODE
    if (pendingBatch && pendingBatch.length > 0) {
      const batch = pendingBatch;
      await startDryerForBatch(batch, minutes);
      core.dispatch({ type: 'close' }); // close dryer dialog
      setPendingBatch(null);
      setDryerLoading(false);
      return;
    }

    const sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], 'DRY_IN'));
    if (!sig.ok) { setDryerLoading(false); return; }
    try {
      const { executed } = await executeOrQueue('advance', dryerDialog.filterId, dryerDialog.filterName, {
        targetState: 'DRY_IN',
        cleaningAreaId: blockId,
        dryerAction: 'SET_DURATION',
        dryerDurationMinutes: minutes,
        remarks: remarks || `Dryer started (${minutes} min) - ${dryerDialog.filterName}`,
      }, 'DRY_IN', sig.password);
      recordSubmission({ stage: 'Dryer Started' + (executed ? '' : ' (queued)'), filter: dryerDialog.filterName, block: blockName, time: formatTime(new Date()) });
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
      // Update offline cache (action tape + reachable-target mirrors) when queued.
      // Deep-review fix D3: pass blockId explicitly.
      if (!executed) {
      await recomputeAndCacheFilterState(dryerDialog.filterId, 'DRY_IN', false, selectedBlock?.id ?? null);
      }
      core.dispatch({ type: 'close' }); // close dryer dialog
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
    // The remark typed for this submit: the scan screen's field was cleared when
    // this dialog opened.
    const typedRemarks = batchRemarksRef.current;

    // Same readings applied to every filter in the snapshot. The dialog opens only
    // with the queue snapshot in pendingBatch (one filter is a batch of one); the
    // separate single-filter branch that followed could not be reached and was
    // removed 2026-10-22. The snapshot holds only filters whose readings go to
    // this dialog's group (handleSubmitBatch splits by it).
    if (!pendingBatch || pendingBatch.length === 0) { setEquipmentLoading(false); return; }
    const batch = pendingBatch;

    // The readings as bare advances for `items`. 'dialog' = a block-change dialog
    // replaced this one; 'stopped' = nothing sent (AHU pre-flight or signature).
    const sendReadings = async (items: BatchItem[], opts: { ahuGated: boolean }): Promise<'done' | 'dialog' | 'stopped'> => {
      // Readings that COMPLETE the cycle (the last stage, no checklist after it)
      // had no AHU pre-flight on this path, so POPUP never warned there (2026-10-22).
      // Dry In readings are an in-place dryer step, never a completion.
      if (
        !isDryerReadings && !opts.ahuGated &&
        (await gateAhuBeforeCompletingAdvance(items.map(b => b.filterId), stage.key)) === 'blocked'
      ) return 'stopped';
      let success = 0; const failed: string[] = [];
      const newSubs: typeof recentSubmissions = [];
      // Minor #2: track first 409 BLOCK_CHANGE_REQUIRED hit with a local flag.
      // The closure-captured `blockChangeDialog` does NOT update mid-loop —
      // React doesn't flush state between iterations of a sync `for`/await —
      // so `if (!blockChangeDialog)` would always be whatever it was at
      // function entry, not "have we set it this run". Local flag = correct.
      let blockChangePopped = false;
      // One signature for the batch: the stage move, plus the station row of the
      // target stage (2026-09-24). Cycles are already started by the time this
      // dialog opens (handleReasonSubmit starts them before handing over).
      const sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], isDryerReadings ? 'DRY_IN' : stage.key));
      if (!sig.ok) return 'stopped';
      for (const item of items) {
        try {
          const advPayload = {
            targetState: isDryerReadings ? 'DRY_IN' : stage.key,
            cleaningAreaId: blockId,
            equipmentGroupId: groupId,
            instrumentReadings: readings,
            ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
            remarks: typedRemarks || `${stage.label} - Batch - ${item.filterName}`,
          };
          const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, advPayload, isDryerReadings ? 'DRY_IN' : stage.key, sig.password);
          success++;
          // Update cached state after offline operation.
          // Deep-review fix D3: pass blockId from the equipment dialog scope.
          if (!executed) await recomputeAndCacheFilterState(item.filterId, isDryerReadings ? 'DRY_IN' : stage.key, false, blockId ?? null);
          newSubs.push({ stage: stage.label + (executed ? '' : ' (queued)'), filter: item.filterName, block: blockName, time: formatTime(new Date()) });
        } catch (e: any) {
          // B7.2: a cross-block hit can return 409 BLOCK_CHANGE_REQUIRED. Pop the
          // structured modal once on first hit (the advanceBatch pattern) and
          // continue iterating so other items can still succeed.
          if ((e?.code === 'BLOCK_CHANGE_CONFIRM' || e?.code === 'BLOCK_CHANGE_REQUIRED') && e?.connectionInfo) {
            if (!blockChangePopped) {
              core.dispatch({
                type: 'open_block_change',
                filterId: e.connectionInfo.filterId ?? item.filterId,
                filterName: item.filterName,
                homeBlockId: e.connectionInfo.homeBlockId,
                homeBlockName: e.connectionInfo.homeBlockName,
                requestedBlockId: e.connectionInfo.requestedBlockId,
                requestedBlockName: e.connectionInfo.requestedBlockName,
              });
              setBlockChangeReason('');
              // Pop the structured modal ONCE (first cross-block hit). Without
              // this assignment the flag stayed false, so the modal re-dispatched
              // for every failing item (last-wins) and the generic failure toast
              // below always fired on top of it. (Fixed 2026-08-18; the omission
              // was surfaced by eslint prefer-const flagging a never-reassigned
              // `let`.)
              blockChangePopped = true;
            }
            failed.push(`${item.filterName}: Block change approval required`);
          } else {
            failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
          }
        }
      }
      recordSubmission(newSubs);
      refreshFilters();
      refreshOfflineInstances(); // refresh cached data after queued ops
      // Close the equipment dialog (batch end) — unless a block-change dialog
      // REPLACED it in the loop: closing then closed that one, and with the
      // generic popup suppressed below the refusal was never shown (2026-10-22).
      if (!blockChangePopped) core.dispatch({ type: 'close' });
      setPendingBatch(null);
      // Minor #3: suppress generic toast when block-change modal is up
      // (mirrors advanceBatch:422 `&& !blockChangeDialog`, but using the
      // local flag to avoid the same closure-staleness pitfall).
      if (failed.length > 0 && !blockChangePopped) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      else if (failed.length === 0) setToast({ type: 'success', message: `${success} filter(s) → ${stage.label}` });
      return blockChangePopped ? 'dialog' : 'done';
    };

    if (isDryerReadings) {
      await sendReadings(batch, { ahuGated: false });
    } else {
      // Readings INTO the last stage with a checklist after it (A-01): the
      // readings ride on the parked advance and go with the checklist in one call,
      // per filter (advanceIntoStage). (The Dry In readings are an in-place dryer
      // step, not an entry into a stage.)
      const { left } = await advanceIntoStage(batch, stage.key, {
        targetState: stage.key,
        cleaningAreaId: blockId,
        equipmentGroupId: groupId,
        instrumentReadings: readings,
        ...(typedRemarks ? { remarks: typedRemarks } : {}),
      }, await cachedStatesOf(batch), sendReadings);
      keepQueued(left);
    }
    setEquipmentLoading(false);
  };

  // 2026-07-02: AHU completion pre-flight — runs BEFORE the terminal checklist
  // opens, for BOTH modes. Gated on isTerminalChecklist so intermediate
  // checklists are never affected (this is what dissolves the old two-filter
  // deadlock concern). Returns 'blocked' when the operator must NOT proceed to
  // open the checklist: INTERLOCK when siblings are pending, or POPUP when the
  // operator picks Cancel. Non-fatal on any error (the server 422 still guards
  // INTERLOCK at submit as a safety net).
  const gateAhuBeforeChecklist = async (filterIds: string[]): Promise<'proceed' | 'blocked'> => {
    // Reset any prior choice so a non-AHU / non-terminal submit carries none
    // (server then treats it as ALL — legacy behavior).
    ahuSetChoiceRef.current = null;
    if (ahuMode === 'NONE' || filterIds.length === 0) return 'proceed';
    // Terminal-checklist detection. The CACHED filter-state row can carry a
    // PREVIOUS cycle's terminal stage (or miss stageLookup) — that both skipped
    // the pre-flight AND mis-fired the POPUP at intermediate stages. ALWAYS
    // attempt fresh state (NOT gated on the flaky `online` flag); fall back to
    // cache only if the fetch truly fails (genuinely offline).
    let termState: any = await getCache<any>(`filter-state-${filterIds[0]}`).catch(() => null);
    try { termState = await apiClient.get<any>(`/api/filters/${filterIds[0]}/current-state`); }
    catch { /* genuinely offline → keep cached fallback */ }
    if (!isTerminalChecklist(termState?.currentState, termState?.stageLookup)) return 'proceed';
    return runAhuGate(filterIds);
  };

  // 2026-08-10: second entry point — an advance that COMPLETES the cycle with no
  // checklist after it (`… → FINAL STAGE → END`). Those pipelines never open a
  // terminal checklist, so gateAhuBeforeChecklist could never fire for them and
  // the AHU popup silently did nothing at Storage Out. Disjoint from the
  // checklist path by construction — see isCompletingAdvance.
  const gateAhuBeforeCompletingAdvance = async (
    filterIds: string[],
    targetState: string | undefined,
  ): Promise<'proceed' | 'blocked'> => {
    ahuSetChoiceRef.current = null;
    if (ahuMode === 'NONE' || filterIds.length === 0 || !targetState) return 'proceed';
    // Same freshness rule as the checklist path: the cached filter-state row can
    // carry a PREVIOUS cycle's stageLookup, so always attempt a live read and
    // fall back to cache only when genuinely offline.
    let st: any = await getCache<any>(`filter-state-${filterIds[0]}`).catch(() => null);
    try { st = await apiClient.get<any>(`/api/filters/${filterIds[0]}/current-state`); }
    catch { /* genuinely offline → keep cached fallback */ }
    if (!isCompletingAdvance(targetState, st?.stageLookup)) return 'proceed';
    return runAhuGate(filterIds);
  };

  /**
   * 2026-08-10: third entry point — the DIALOG-FIRST terminal checklist opened
   * by `useFilterOperationsCore` itself (single-filter advance /
   * start-and-advance). Nothing is written at that moment, so the filter is
   * still at the PREVIOUS stage and the `currentState`-based
   * `gateAhuBeforeChecklist` cannot recognise the terminal step — the cause of
   * the missing Storage Out popup after the 2026-07-16 dialog-first refactor.
   * `isTerminalTargetWithChecklist` is the exact complement of
   * `isCompletingAdvance`, so the two gates never both fire for one submit.
   */
  const gateAhuBeforeDeferredChecklist = async (
    filterIds: string[],
    targetState: string | undefined,
  ): Promise<'proceed' | 'blocked'> => {
    ahuSetChoiceRef.current = null;
    if (ahuMode === 'NONE' || filterIds.length === 0 || !targetState) return 'proceed';
    let st: any = await getCache<any>(`filter-state-${filterIds[0]}`).catch(() => null);
    try { st = await apiClient.get<any>(`/api/filters/${filterIds[0]}/current-state`); }
    catch { /* genuinely offline → keep cached fallback */ }
    if (!isTerminalTargetWithChecklist(targetState, st?.stageLookup)) return 'proceed';
    return runAhuGate(filterIds);
  };

  /**
   * Shared tail of both AHU pre-flights: optional A/B/All chooser, batch
   * completion-status check, then the warn/block dialog. Extracted 2026-08-10
   * so the checklist-less completion path reuses the exact same behaviour
   * (including the INTERLOCK fail-safe) rather than a parallel copy.
   */
  const runAhuGate = async (filterIds: string[]): Promise<'proceed' | 'blocked'> => {
    // Only ask A / B / All when the batch actually spans both sets — otherwise
    // the choice is meaningless (proceed as ALL). Cancel = don't proceed.
    let set: FilterSetChoice | undefined;
    if (await checkAhuHasBothSets(ahuMode, filterIds, online)) {
      const chosen = await new Promise<FilterSetChoice | null>((resolve) => {
        ahuSetResolveRef.current = resolve;
        setAhuSetChooser(true);
      });
      if (!chosen) return 'blocked';
      set = chosen;
      ahuSetChoiceRef.current = chosen;
    }

    const { ahus, failed } = await checkAhuCompletionBatch(ahuMode, filterIds, online, set);
    // Fail-safe: the INTERLOCK gate exists to BLOCK completion while sibling
    // filters are unfinished. A FAILED check returns no AHUs — reading that as
    // "all done → proceed" would silently defeat the interlock. Stop and tell
    // the operator to retry instead of walking into a server-side 422 at submit.
    // (POPUP is advisory-only, so a failed check there proceeds — already logged.)
    if (failed && ahuMode === 'INTERLOCK') {
      setPopupError('Could not verify AHU completion status. Check your connection and try again.');
      return 'blocked';
    }
    if (ahus.filter((a) => !a.allAtFinal).length === 0) return 'proceed';
    const proceed = await new Promise<boolean>((resolve) => {
      ahuDialogResolveRef.current = resolve;
      setAhuDialogState({
        mode: ahuMode === 'INTERLOCK' ? 'INTERLOCK' : 'POPUP',
        ahus,
        currentFilterIds: filterIds,
      });
    });
    return proceed ? 'proceed' : 'blocked';
  };

  /**
   * A-01 (operator decision 2026-10-21): an advance INTO the last stage, with an
   * enabled checklist after it, is written together with that checklist in ONE
   * call (advance-with-checklist); the server refuses a bare advance there (409
   * CHECKLIST_REQUIRED). Every advance on this page is a batch loop of bare
   * advances, so from 2026-10-21 desktop could not complete such a cycle.
   *
   * When the rule applies, the checklist opens FIRST with the advance parked on
   * the dialog (nothing written; Close discards it) and the batch branch of
   * handleChecklistSubmit sends one advance-with-checklist per filter. The rule is
   * the server's own — packages/shared advanceMustCarryChecklist over the
   * server-built stageLookup — so a disabled checklist, a QA-interlock final stage
   * and a mid-pipeline stage keep the bare advance.
   *
   * Decided PER FILTER (2026-10-22, lib/filter-ops planFinalStageBatch): a batch
   * can mix profiles. Filters whose profile needs no checklist here get their
   * bare advance (`sendPlain`); the largest group sharing one checklist gets the
   * dialog; a filter needing a different checklist stays queued (`left`). A
   * filter that must carry a checklist whose questions cannot be resolved goes
   * plain: the server refuses it and the refusal is shown — never a silent skip.
   *
   * ONE AHU pre-flight over every filter this submit completes, parked or plain:
   * gated separately, the last two filters of an AHU split across the two halves
   * would each wait on the other under INTERLOCK, and POPUP would ask twice.
   *
   * outcome: 'parked' = the checklist is open; 'stopped' = nothing written (AHU
   * pre-flight or a declined signature); 'dialog' = the plain half opened another
   * dialog (block change), so the checklist group stays queued instead.
   */
  const advanceIntoStage = async (
    batch: BatchItem[],
    targetState: string,
    payload: Record<string, unknown>,
    stateOf: (filterId: string) => any,
    sendPlain: (plain: BatchItem[], opts: { ahuGated: boolean }) => Promise<'done' | 'dialog' | 'stopped'>,
  ): Promise<{ outcome: 'done' | 'parked' | 'dialog' | 'stopped'; left: LeftItem[] }> => {
    const plan = await planFinalStageBatch(batch, targetState, stateOf, (id) => resolveChecklistForTargetStage(id, targetState, online));
    if (plan.carry.length === 0) {
      const sent = plan.plain.length > 0 ? await sendPlain(plan.plain, { ahuGated: false }) : 'done';
      return { outcome: sent, left: plan.left };
    }
    if ((await gateAhuForFinalStage(plan, targetState, stateOf)) === 'blocked') return { outcome: 'stopped', left: [] };
    if (plan.plain.length > 0) {
      const sent = await sendPlain(plan.plain, { ahuGated: true });
      if (sent === 'stopped') return { outcome: 'stopped', left: [] };
      if (sent === 'dialog') {
        return { outcome: 'dialog', left: [...plan.left, ...plan.carry.map(item => ({ item, note: 'its checklist was not asked — submit it again' }))] };
      }
    }
    openParkedChecklist(plan.carry, plan.checklists, targetState, payload);
    return { outcome: 'parked', left: plan.left };
  };

  /** The single AHU pre-flight of a final-stage submit (see advanceIntoStage). */
  const gateAhuForFinalStage = async (
    plan: Pick<FinalStagePlan<BatchItem>, 'plain' | 'carry'>,
    targetState: string,
    stateOf: (filterId: string) => any,
  ): Promise<'proceed' | 'blocked'> => {
    ahuSetChoiceRef.current = null;
    if (ahuMode === 'NONE') return 'proceed';
    const completing = plan.plain.filter(p => isCompletingAdvance(targetState, stateOf(p.filterId)?.stageLookup));
    const ids = [...plan.carry, ...completing].map(b => b.filterId);
    return ids.length > 0 ? runAhuGate(ids) : 'proceed';
  };

  /**
   * Open the checklist with the batch's advance parked on it — or, with
   * `cyclePayload`, the whole cycle START (start-and-advance-with-checklist).
   */
  const openParkedChecklist = (
    carry: BatchItem[],
    checklists: PendingChecklist[],
    targetState: string,
    payload: Record<string, unknown>,
    cyclePayload?: Record<string, unknown>,
  ) => {
    const batch = carry.map(c => ({ filterId: c.filterId, filterName: c.filterName }));
    setPendingBatch(batch);
    core.dispatch({
      type: 'open_checklist',
      filterId: batch[0].filterId,
      filterName: `${batch.length} filter(s)`,
      checklists,
      deferredAdvance: {
        targetState,
        payload,
        cleaningAreaId: (payload.cleaningAreaId as string | undefined) ?? null,
        ...(cyclePayload ? { cyclePayload } : {}),
      },
    });
    setChecklistError('');
  };

  /** The cached state rows of a dialog's batch (loadBatchStates cached them at submit). */
  const cachedStatesOf = async (batch: BatchItem[]): Promise<(filterId: string) => any> => {
    const rows = new Map<string, any>();
    for (const b of batch) rows.set(b.filterId, await getCache<any>(`filter-state-${b.filterId}`).catch(() => null));
    return (filterId: string) => rows.get(filterId) ?? null;
  };

  const handleChecklistSubmit = async (answers: Record<string, any>) => {
    if (!checklistDialog) return;
    setChecklistLoading(true); setChecklistError('');

    // 2026-07-02: the AHU completion pre-flight (POPUP + INTERLOCK) now runs
    // BEFORE the checklist opens (gateAhuBeforeChecklist), so there is no
    // submit-time POPUP pre-flight here. INTERLOCK still has a server-side 422
    // safety net caught below in case state changed between open and submit.

    // Phase A.1: include the version each profile was rendered against. Server
    // compares to its cycle pins and returns 409 SCHEMA_DRIFT if the live profile
    // version moved between when the dialog opened and when we submitted.
    const expectedProfileVersions: Record<string, number> = {};
    for (const cl of checklistDialog.checklists) {
      if (typeof cl.profileVersion === 'number') {
        expectedProfileVersions[cl.checklistProfileId] = cl.profileVersion;
      }
    }
    // ahuSetChoiceRef holds the operator's A/B/All pick (set in gateAhuBeforeChecklist).
    // It scopes the server INTERLOCK gate to the same roster the popup showed.
    const submitPayload = {
      answers,
      expectedProfileVersions,
      ...(ahuSetChoiceRef.current ? { filterSet: ahuSetChoiceRef.current } : {}),
    };

    // SUBMIT_CHECKLIST_WITH_SIGNATURE is reauth-gated when the admin enables
    // it in Action-Reauth config. Wrap so the password dialog appears once
    // for the whole submission (single or batch). Mirrors mobile-operations
    // handleChecklistSubmit. Without the wrap, the backend's enforceReauth
    // would 401 silently when policy demands a password.
    // A batch whose advance into the LAST stage is parked on this dialog
    // (advanceIntoStage): each filter enters the stage and answers the
    // checklist in ONE call — signed once for both writes, as the server
    // enforces both on advance-with-checklist. With `cyclePayload` the cycle
    // START is parked too (a first stage that is also the last, 2026-10-22):
    // start-and-advance-with-checklist, signed once for all three.
    const parked = pendingBatch && pendingBatch.length > 0 && core.dialogState.kind === 'awaiting_checklist'
      ? core.dialogState.deferredAdvance ?? null
      : null;
    const parkedLabel = parked ? (CLEANING_STAGES.find(s => s.key === parked.targetState)?.label ?? parked.targetState) : '';
    const signature = parked
      ? withStageAction([...(parked.cyclePayload ? ['START_CLEANING_CYCLE'] : []), 'ADVANCE_FILTER_STAGE', 'SUBMIT_CHECKLIST_WITH_SIGNATURE'], parked.targetState)
      : 'SUBMIT_CHECKLIST_WITH_SIGNATURE';

    await reauth.execute(signature, async (password?: string) => {
      // BATCH MODE: submit same answers for every filter in the snapshot
      if (pendingBatch && pendingBatch.length > 0) {
        const batch = pendingBatch;
        let success = 0; const failed: string[] = [];
        const newSubs: typeof recentSubmissions = [];
        // A parked START asks the missed-PM question at most once per batch, as the
        // reason path does; the answers ride on every later start.
        if (parked?.cyclePayload) pmSkipsForBatch.current = [];
        const startAndAdvance = (item: BatchItem, pmSkips: Array<{ entryId: string; reason: string }>) =>
          executeOrQueue('start-and-advance-with-checklist', item.filterId, item.filterName, {
            cyclePayload: {
              ...parked!.cyclePayload,
              acknowledgeBlockChange: ackedBlockFiltersRef.current.has(item.filterId),
              ...(pmSkips.length > 0 ? { pmSkips } : {}),
            },
            advancePayload: {
              ...parked!.payload,
              remarks: (parked!.payload.remarks as string | undefined) || `${parkedLabel} - Batch - ${item.filterName}`,
              ...submitPayload,
            },
          } as any, parked!.targetState, password);
        const startWithPmGate = async (item: BatchItem) => {
          try {
            return await startAndAdvance(item, pmSkipsForBatch.current);
          } catch (startErr: any) {
            const code = startErr?.error ?? startErr?.code;
            const pending = startErr?.connectionInfo?.pendingPmTasks;
            if (code !== 'PM_PREVIOUS_TASK_PENDING' || !Array.isArray(pending) || pending.length === 0) throw startErr;
            const pmAnswers = await askPmSkipReasons(pending, startErr?.connectionInfo?.minReasonLength ?? 5);
            if (!pmAnswers) throw startErr; // cancelled — this filter does not start
            pmSkipsForBatch.current = pmAnswers;
            return await startAndAdvance(item, pmAnswers);
          }
        };
        for (const item of batch) {
          try {
            const { executed } = parked?.cyclePayload
              ? await startWithPmGate(item)
              : parked
              ? await executeOrQueue('advance-with-checklist', item.filterId, item.filterName, {
                  ...parked.payload,
                  remarks: (parked.payload.remarks as string | undefined) || `${parkedLabel} - Batch - ${item.filterName}`,
                  ...submitPayload,
                }, parked.targetState, password)
              : await executeOrQueue('submit-checklist', item.filterId, item.filterName, submitPayload, undefined, password);
            success++;
            if (parked) newSubs.push({ stage: parkedLabel + (executed ? '' : ' (queued)'), filter: item.filterName, block: selectedBlock?.name, time: formatTime(new Date()) });
            if (!executed) failed.push(`${item.filterName}: queued for sync`);
          } catch (e: any) {
            // Re-auth answers escape the loop so the prompt handles them (re-prompt on a
            // wrong password, open on a stale gate) — never "failed" filters (2026-10-22;
            // the tablet copy already did this). So does a lockout: it refuses the
            // signature, so it goes to onError once instead of N times.
            if (isReauthError(e)) throw e;
            failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
          }
        }
        core.dispatch({ type: 'close' }); // BATCH MODE: close checklist dialog
        setPendingBatch(null);
        if (newSubs.length > 0) recordSubmission(newSubs);
        refreshFilters();
        if (failed.length > 0) setPopupError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
        else setToast({ type: 'success', message: parked ? `${success} filter(s) → ${parkedLabel}, checklist submitted` : `Checklist submitted for ${success} filter(s)` });
        return;
      }

      try {
        const submitOnce = (extraCycleFields?: Record<string, unknown>) => core.submitChecklist({
          filterId: checklistDialog.filterId,
          filterName: checklistDialog.filterName,
          answers: submitPayload.answers,
          expectedProfileVersions: submitPayload.expectedProfileVersions,
          filterSet: ahuSetChoiceRef.current ?? undefined,
          password,
          ...(extraCycleFields ? { extraCycleFields } : {}),
        });
        // A checklist on the FIRST stage parks the whole cycle START on this
        // dialog, so the missed-PM 409 arrives here. Ask, then re-submit with the
        // answers riding on the start (2026-10-01).
        let submitted: { executed: boolean };
        try {
          submitted = await submitOnce();
        } catch (startErr: any) {
          const code = startErr?.error ?? startErr?.code;
          const pendingPm = startErr?.connectionInfo?.pendingPmTasks;
          if (code !== 'PM_PREVIOUS_TASK_PENDING' || !Array.isArray(pendingPm) || pendingPm.length === 0) throw startErr;
          const answers = await askPmSkipReasons(pendingPm, startErr?.connectionInfo?.minReasonLength ?? 5);
          if (!answers) throw startErr; // cancelled — the cleaning does not start
          submitted = await submitOnce({ pmSkips: answers });
        }
        const { executed } = submitted;
        // Dialog close + offline cache-clear + batch walking handled by core.submitChecklist.
        setToast({ type: 'success', message: executed ? 'Checklist submitted successfully' : 'Checklist queued for sync' });
        refreshFilters();
      } catch (e: any) {
        // INTERLOCK: server returns 422 AHU_INTERLOCK_PENDING only at the terminal
        // checklist (when shouldComplete=true). Show the blocking dialog; the
        // operator must click Close, then wait for siblings to finish.
        if (e?.code === 'AHU_INTERLOCK_PENDING' && ahuMode === 'INTERLOCK') {
          const info = e?.connectionInfo ?? {};
          const pending = (info.pendingFilters as { id: string; name: string; stage: string }[]) ?? [];
          const filters = (info.filters as { id: string; name: string; stage: string; done: boolean }[])
            ?? pending.map(p => ({ ...p, done: false }));
          // Clear the checklist Submit spinner BEFORE showing the blocking
          // dialog so the button doesn't spin behind the interlock modal.
          setChecklistLoading(false);
          await new Promise<boolean>((resolve) => {
            ahuDialogResolveRef.current = resolve;
            setAhuDialogState({
              mode: 'INTERLOCK',
              ahus: [{ ahuName: info.ahuName ?? '', filters, allAtFinal: false }],
              currentFilterIds: [info.currentFilterId ?? checklistDialog.filterId],
            });
          });
          return;
        }
        // Everything else goes to onError below — including the re-auth answers,
        // which the hook must see (a wrong password re-prompts; a stale gate opens it).
        throw e;
      }
    }, {
      onError: (e: unknown) => {
        const message = (e as { message?: string } | null)?.message ?? 'Failed to submit checklist';
        setChecklistError(message);
        setPopupError(message);
        setChecklistLoading(false);
      },
      // A dismissed password prompt is not a failure: the checklist stays open, nothing is shown.
      onCancel: () => setChecklistLoading(false),
    });
    setChecklistLoading(false);
  };

  // 2026-06-09: block-change approval removed. The operator self-confirms cleaning
  // the filter in a different block; we mark it acknowledged and the next start for
  // that filter sends acknowledgeBlockChange=true so the cycle starts in that block.
  const handleBlockChangeRequest = async () => {
    if (!blockChangeDialog || blockChangeSubmitting) return;
    if (blockChangeMode === 'APPROVAL') {
      // Submit a block-change request for an approver to approve.
      if (!online) { setPopupError('Block change requests need an internet connection. Connect and try again.'); return; }
      setBlockChangeSubmitting(true);
      // REQUEST_BLOCK_CHANGE is a configurable re-auth row (2026-09-24).
      const body = {
        filterId: blockChangeDialog.filterId,
        filterName: blockChangeDialog.filterName,
        fromBlockId: blockChangeDialog.homeBlockId,
        fromBlockName: blockChangeDialog.homeBlockName,
        toBlockId: blockChangeDialog.requestedBlockId,
        toBlockName: blockChangeDialog.requestedBlockName,
        reason: blockChangeReason.trim() || undefined,
      };
      await reauth.execute('REQUEST_BLOCK_CHANGE', async (password?) => {
        if (password) await apiClient.postWithReauth('/api/block-change-requests', body, password);
        else await apiClient.post('/api/block-change-requests', body);
      }, {
        onSuccess: () => {
          setToast({ type: 'success', message: 'Block change request submitted. Waiting for approval.' });
          core.dispatch({ type: 'close' });
          setBlockChangeReason('');
          setBlockChangeSubmitting(false);
        },
        onError: (e: any) => { setPopupError(e?.message ?? 'Failed to submit block change request'); setBlockChangeSubmitting(false); },
        onCancel: () => setBlockChangeSubmitting(false),
      });
      return;
    }
    // CONFIRM mode: operator self-confirm — mark acknowledged + re-submit.
    ackedBlockFiltersRef.current.add(blockChangeDialog.filterId);
    core.dispatch({ type: 'close' });
    setBlockChangeReason('');
    setToast({ type: 'success', message: `Confirmed. Scan ${blockChangeDialog.filterName} again to clean it in this block.` });
  };

  const selectedStageInfo = CLEANING_STAGES.find(s => s.key === selectedStatusStage);

  // QA-D002 (2026-10-19): the dialogs that RESOLVE a pending submit promise —
  // AHU set chooser (runAhuGate), AHU remaining-filters warn/block
  // (checkAhuCompletionBatch), and the missed-PM question (askPmSkipReasons on a
  // 409 PM_PREVIOUS_TASK_PENDING). They used to be mounted only in the landing
  // return; the stage screen (/filters/stage/:key) runs the same submit handlers,
  // so there the promise could never settle and the submit spun forever. One
  // element, rendered in BOTH returns, so the two cannot drift again.
  const gateDialogs = (
    <>
      {/* AHU Filter-Set Chooser — shown before the completion popup (2026-07-03) */}
      {ahuSetChooser && (
        <AhuSetChooserDialog
          onChoose={(set) => {
            setAhuSetChooser(false);
            ahuSetResolveRef.current?.(set);
            ahuSetResolveRef.current = null;
          }}
          onCancel={() => {
            setAhuSetChooser(false);
            ahuSetResolveRef.current?.(null);
            ahuSetResolveRef.current = null;
          }}
        />
      )}

      {/* AHU Remaining Filters Dialog (Task 7) */}
      {ahuDialogState && (
        <RemainingFiltersDialog
          mode={ahuDialogState.mode}
          ahus={ahuDialogState.ahus}
          currentFilterIds={ahuDialogState.currentFilterIds}
          onContinue={() => {
            ahuDialogResolveRef.current?.(true);
            ahuDialogResolveRef.current = null;
            setAhuDialogState(null);
          }}
          onCancel={() => {
            ahuDialogResolveRef.current?.(false);
            ahuDialogResolveRef.current = null;
            setAhuDialogState(null);
          }}
        />
      )}

      {pmGate && (
        <PmPendingTasksDialog
          tasks={pmGate.tasks}
          minReasonLength={pmGate.minReasonLength}
          busy={pmGateBusy}
          formatDate={formatDate}
          onCancel={() => { pmGate.resolve(null); setPmGate(null); }}
          onConfirm={(skips) => { setPmGateBusy(false); pmGate.resolve(skips); setPmGate(null); }}
        />
      )}
    </>
  );

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
        {/* Stage interlock — this stage is paused awaiting a QA approval signature.
            The server has already dropped the advance action from the tape, so this
            banner explains why no "next stage" button is shown. */}
        {interlock?.blocksLeaving && (
          <div className="mx-4 mb-2 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2">
            <svg className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            <div className="text-sm text-amber-800">
              <div className="font-semibold">{interlockStageLabel(interlock.stageKey)} is awaiting QA approval.</div>
              <div className="text-amber-700 mt-0.5">
                {interlock.status === 'REJECTED'
                  ? 'This stage was rejected — the filter has been sent back for re-cleaning.'
                  : `${interlock.approverRole ?? 'An approver'} must verify the filter details and approve before this filter can continue. You'll be notified once it's released.`}
              </div>
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
          selectedIds={selectedQueueIds}
          onToggleSelect={toggleQueueSelect}
          onSelectAll={selectAllQueue}
          dryerDuration={dryerBatchDuration}
          onDryerDurationChange={setDryerBatchDuration}
          onSubmitBatch={handleSubmitBatch}
          onClose={closeDialog}
          instances={instances}
        />
        {activeStage.key === 'DRY_IN' && selectedBlock && (
          <DryingFiltersPanel
            filters={filtersInBlock(
              allFilters.filter((f: any) => f.currentLifecycleState === 'DRY_IN'),
              selectedBlock?.id,
              ahuBlockMap,
            )}
            online={online}
            executeOrQueue={executeOrQueue as any}
            getCache={getCache}
            cacheData={cache}
            onSuccess={(m) => setToast({ type: 'success', message: m })}
            onError={setPopupError}
            onAfterSubmit={refreshFilters}
            variant="desktop"
          />
        )}
        <CleaningReasonDialog dialog={reasonDialog} onClose={() => { core.dispatch({ type: 'close' }); setReasonError(''); }} onSubmit={handleReasonSubmit} loading={loading} error={reasonError} onClearError={() => setReasonError('')} defaultReasonKey={pmReasonCtx.defaultReasonKey} pmDue={pmReasonCtx.pmDue} />
        <EquipmentDialog dialog={equipmentDialog} onClose={() => core.dispatch({ type: 'close' })} onSubmit={handleEquipmentSubmit} loading={equipmentLoading} error={equipmentError} online={online} />
        <DryerDurationDialog open={!!dryerDialog} filterName={dryerDialog?.filterName ?? ''} loading={dryerLoading} error={dryerError} onClose={() => { core.dispatch({ type: 'close' }); setDryerError(''); }} onSubmit={handleDryerDurationSubmit} />
        <ChecklistDialog dialog={checklistDialog} onClose={() => core.dispatch({ type: 'close' })} onSubmit={handleChecklistSubmit} loading={checklistLoading} error={checklistError} />
        <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying} onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} actionLabel={reauth.pendingActionLabel ?? 'Filter Operation'} />
        <BlockChangeRequestDialog
          dialog={blockChangeDialog}
          reason={blockChangeReason}
          onReasonChange={setBlockChangeReason}
          submitting={blockChangeSubmitting}
          onSubmit={handleBlockChangeRequest}
          onCancel={() => { core.dispatch({ type: 'close' }); }}
          mode={blockChangeMode}
        />
        {gateDialogs}
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
                className={`bg-gradient-to-br ${stage.color} border-2 ${stage.border} rounded-2xl p-6 text-center transition-all hover:shadow-lg active:scale-[0.98]`}>
                <div className="text-4xl mb-3">{stage.icon}</div>
                <div className="text-white font-bold text-lg">{stage.label}</div>
                {stage.needsBlock && <div className="text-white/50 text-[11px] mt-2">Block Selection Required</div>}
              </button>
            ))}
          </div>

          {recentSubmissions.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-slate-500 mb-3">Recent Submissions</h3>
              <div className="space-y-2">
                {recentSubmissions.map((sub, i) => (
                  <div key={sub.filter + '-' + sub.stage + '-' + sub.time} className="flex items-center gap-3 py-2 border-b border-slate-200 last:border-0 text-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    <span className="text-slate-500 w-20 shrink-0">{sub.time}</span>
                    <span className="text-slate-700 font-medium">{sub.filter}</span>
                    <span className="text-cyan-600">&#8594; {sub.stage}</span>
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
                  className={`bg-gradient-to-br ${stage.color} border-2 ${isActive ? 'border-cyan-400 ring-2 ring-cyan-400/30 scale-[1.03]' : stage.border} rounded-2xl p-4 text-center transition-all active:scale-[0.98] relative`}>
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
                          <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${filter.set === 'SET_A' ? 'bg-brand-50 text-brand-700' : 'bg-brand-50 text-brand-700'}`}>
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
        selectedIds={selectedQueueIds}
        onToggleSelect={toggleQueueSelect}
        onSelectAll={selectAllQueue}
        dryerDuration={dryerBatchDuration}
        onDryerDurationChange={setDryerBatchDuration}
        onSubmitBatch={handleSubmitBatch}
        onClose={closeDialog}
        instances={instances}
      />

      {/* Cleaning Reason Dialog */}
      <CleaningReasonDialog
        dialog={reasonDialog}
        onClose={() => { core.dispatch({ type: 'close' }); setReasonError(''); }}
        onSubmit={handleReasonSubmit}
        loading={loading}
        error={reasonError}
        onClearError={() => setReasonError('')}
        defaultReasonKey={pmReasonCtx.defaultReasonKey}
        pmDue={pmReasonCtx.pmDue}
      />

      {/* Equipment Group & Instrument Readings Dialog */}
      <EquipmentDialog
        dialog={equipmentDialog}
        onClose={() => core.dispatch({ type: 'close' })}
        onSubmit={handleEquipmentSubmit}
        loading={equipmentLoading}
        error={equipmentError}
        online={online}
      />

      {/* Dryer Duration Dialog */}
      <DryerDurationDialog
        open={!!dryerDialog}
        filterName={dryerDialog?.filterName ?? ''}
        loading={dryerLoading}
        error={dryerError}
        onClose={() => { core.dispatch({ type: 'close' }); setDryerError(''); }}
        onSubmit={handleDryerDurationSubmit}
      />

      {/* Checklist Dialog */}
      <ChecklistDialog
        dialog={checklistDialog}
        onClose={() => core.dispatch({ type: 'close' })}
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
        actionLabel={reauth.pendingActionLabel ?? 'Filter Operation'}
      />

      {/* Block Change Request Dialog */}
      <BlockChangeRequestDialog
        dialog={blockChangeDialog}
        reason={blockChangeReason}
        onReasonChange={setBlockChangeReason}
        submitting={blockChangeSubmitting}
        onSubmit={handleBlockChangeRequest}
        onCancel={() => { core.dispatch({ type: 'close' }); }}
        mode={blockChangeMode}
      />

      {gateDialogs}

      {/* Error Popup */}
      <ErrorPopup error={popupError} onClose={() => setPopupError('')} />

    </div>
  );
}
