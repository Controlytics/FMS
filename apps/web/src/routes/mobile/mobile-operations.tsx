import { useState, useEffect, useRef, useMemo, type MutableRefObject } from 'react';
import { Navigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { useOffline } from '../../hooks/use-offline';
import { useReauth, isReauthCancelled } from '../../hooks/use-reauth';
import { useToast } from '@/hooks/use-toast';
import { ReauthDialog } from '../../components/reauth-dialog';
import { onSyncEvent } from '../../lib/sync-engine';
import { withStageAction, batchTargetState } from '../../lib/stage-reauth';
import { normalizeRfidScan } from '@/lib/rfid-scan';
import { buildIdentifierMap, filterIdsWithUnsyncedWork, type IdentifierMapEntry } from '../../lib/offline-sync-service';
// Dry In multi-select (2026-09-04): the Currently Drying panel is SHARED with the desktop page.
import { DryingFiltersPanel } from '../filter-management/components/drying-filters-panel';
import { formatByLeastCount, formatRecordedReading } from '@/lib/format-by-least-count';
import { buildAhuBlockMap, filtersInBlock } from '@/lib/ahu-block-map';
import { subscribeRfidTags } from '@/lib/rfid-bridge';
// Phase 8.6 — shared executor + action-tape resolver + offline-cache helper.
// All graph-walking decisions (next-stage, checklist-after-stage, cache
// rewrites) route through these so client/server stay in lockstep.
import { getCurrentActions, hasActionKind } from '@/lib/action-tape';
import {
  cacheServerStateResponse,
  recomputeAndCacheFilterState,
} from '@/lib/offline-cache';
// Phase 8.7 Wave-5 split — shared with desktop filter-operations.tsx.
// validateOfflineGate + checklist-resolver + dryer countdown helpers all live
// in lib/filter-ops so the two pages cannot drift again.
import {
  validateOfflineGate,
  checklistMayBeAnsweredAt,
  pendingChecklistStage,
  stageLabel,
  resolvePendingChecklistDialog,
  resolveChecklistForTargetStage,
  findNextPendingChecklist,
  planStartChecklistBatch,
  resolveStartChecklists,
  leftInQueueMessage,
  splitByReadings,
  equipmentGroupChoice,
  groupHasStageInstruments,
  startChecklistProfileIds,
  splitNewCycleBatch,
  firstStagesFromGraph,
} from '@/lib/filter-ops';
import { resolveChecklistProfile } from '@/lib/local-context';
import type { PendingChecklistBatchItem, LeftItem, PendingChecklist } from '@/lib/filter-ops';
// D1/D2/D4 refactor Day 3b (2026-05-18) — useFilterOperationsCore is now
// authoritative. All dialog state lives in core.dialogState; all writes
// go through core.dispatch / core.advance / core.startAndAdvance / core.submitChecklist.
import { useFilterOperationsCore, type AdvanceOutcome } from '@/lib/filter-ops/use-core';
import { blockingInterlock, interlockBannerTitle, interlockBannerDetail, interlockRefusalLine, INTERLOCK_REFUSAL_CODES, type StageInterlockState } from './stage-interlock-notice';
import { useTabletAccess } from './use-tablet-access';
// Task 7 — AHU completion pre-flight (Remaining Filters dialog).
import { useAhuCompletionMode } from '../../hooks/use-ahu-completion-mode';
// 2026-08-10: DRY_IN instrument auto-fetch, shared with the desktop drying panel.
import { checkAhuCompletionBatch, checkAhuHasBothSets, isTerminalChecklist, isCompletingAdvance, isTerminalTargetWithChecklist } from '../../lib/filter-ops/ahu-completion-check';
import { RemainingFiltersDialog } from '../filter-management/components/remaining-filters-dialog';
import { AhuSetChooserDialog, type FilterSetChoice } from '../filter-management/components/ahu-set-chooser-dialog';

import { CLEANING_STAGES_MOBILE as STAGES } from '@/lib/filter-constants';
// Task 3 — batch the ONLINE mid-cycle advances into one /bulk-operate POST.
import { bulkOperate, type BulkClientItem, type BulkClientResult } from '@/lib/filter-ops/bulk-operate';
import { PmPendingTasksDialog, type PendingPmTask } from '@/components/pm-pending-tasks-dialog';
import { refreshPmPendingCache, getCachedPendingPmTasksForFilter, forgetCachedPmTasks } from '@/lib/pm-pending-cache';

// The page is ONE station (2026-10-22). The tablet shell (mobile-wrapper.tsx)
// owns Home, Status, My Tasks and the Cleaning Record and always opens this page
// on a station; the page's own copies of those screens (and its header) were
// unreachable from /m and were removed. 'home' = no station given: nothing renders.
type View = 'home' | 'stage';

// Identifier→filter map: ONE builder, shared with the full offline sync and the
// wrapper (M53, 2026-10-19). It carries the filter's creation-workflow status
// (2026-09-25, audit web F3) so a scan can refuse a not-yet-APPROVED filter
// offline, and leaves out tags held by retired / deactivated filters.

/**
 * Audit 2026-09-24 (web F3, closed 2026-09-25): the creation-workflow gate
 * lived only on the server write (409 FILTER_NOT_APPROVED after the scan was
 * queued and submitted). Mirror it at scan time: a filter that is still
 * pending review / approval, or rejected, is refused with the same wording
 * the server uses, and never enters the queue. `null`/`undefined` (older
 * cache rows, non-workflow rows) is NOT a block — only an explicit non-APPROVED
 * value is.
 */
function approvalBlockMessage(filterName: string, approvalStatus: string | null | undefined): string | null {
  if (approvalStatus == null || approvalStatus === 'APPROVED') return null;
  const why = approvalStatus === 'REJECTED'
    ? 'was rejected and must be corrected and re-submitted'
    : 'is still awaiting review/approval';
  return `Filter "${filterName}" ${why}, so it cannot be cleaned yet.`;
}


/** The dialog's rows are the checklist(s) between START and the first stage
 *  (keyed START-<profileId>: resolveStartChecklists and the tape's afterStage
 *  null alike). */
function isStartChecklist(rows: Array<{ pipelineNodeId?: string }> | null | undefined): boolean {
  return !!rows && rows.length > 0 && rows.every((r) => String(r?.pipelineNodeId ?? '').startsWith('START-'));
}

export function MobileOperationsPage({ initialStageKey, initialBlockId, overlayBackRef }: {
  initialStageKey?: string;
  /** OQ-05: My Tasks "Perform" opens the station with the task AHU's block already chosen. */
  initialBlockId?: string;
  /** The wrapper's Android-back hook (2026-10-22): the Dry In panel closes its own checklist first. */
  overlayBackRef?: MutableRefObject<(() => boolean) | null>;
} = {}) {
  const { user, isLoading: authLoading } = useAuth();
  const { formatTime, formatDate } = useDatetimeFormat();
  const { online, pendingCount, executeOrQueue, cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();
  const reauth = useReauth();
  // ─── D1/D2/D4 Day 3b — useFilterOperationsCore is now authoritative ──────
  // Owns all dialog state + executeOrQueue invocations for the five dialogs.
  // The AHU completion pre-flight for the hook's OWN dialog-first deferral
  // (single-filter advance / start-and-advance). Without this seam the popup
  // could only be wired to the batch handlers, so a single-scan Storage Out
  // submit skipped it. Defined below in the component body — this arrow defers
  // the lookup to call time, which is always after initialisation.
  const core = useFilterOperationsCore({
    onBeforeDeferredChecklist: (filterId, targetState) =>
      gateAhuBeforeDeferredChecklist([filterId], targetState),
  });
  // Task 7: AHU completion mode (NONE / POPUP / INTERLOCK) from config.
  const ahuMode = useAhuCompletionMode();

  // Tablet access control — which features are allowed for this role.
  // OQ-04 (2026-10-19): the SAME hook and rule as mobile-wrapper.tsx
  // (use-tablet-access.ts) — the server's `configured` flag decides, and the
  // last list read online is used offline instead of failing open. This page
  // used "empty list = everything allowed", which let a role configured with
  // an EMPTY allowlist through.
  const { tabletAccess, allowedFeatures, hasFeature } = useTabletAccess(user, online);

  // 2026-05-21: auth/feature redirects deferred to the final JSX block. See
  // mobile-wrapper.tsx for the same fix — early-returning before the ~50
  // hooks below caused React 19 error #300 ("Rendered fewer hooks than
  // expected") on logout when `user` flipped to undefined mid-render.


  const initialStage = initialStageKey ? STAGES.find(s => s.key === initialStageKey) : null;
  const [view] = useState<View>(initialStage ? 'stage' : 'home');
  const [activeStage] = useState<typeof STAGES[0] | null>(initialStage ?? null);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');


  // ── "Previous scheduled PM not carried out" gate (tablet) ────────────────
  //
  // Same dialog and same contract as the web page — the operator is more likely
  // to hit this on the tablet than anywhere else, standing in front of the AHU.
  // The reasons are attached to the cycle payload, so an OFFLINE start carries
  // them in its queued op and the server accepts them on replay without
  // re-asking (start-cycle exempts offline replay from the gate).
  const [pmGate, setPmGate] = useState<{
    tasks: PendingPmTask[];
    minReasonLength: number;
    resolve: (skips: Array<{ entryId: string; reason: string }> | null) => void;
  } | null>(null);
  const askPmSkipReasons = (tasks: PendingPmTask[], minReasonLength: number) =>
    new Promise<Array<{ entryId: string; reason: string }> | null>((resolve) => {
      setPmGate({ tasks, minReasonLength, resolve });
    });  const [scanQueue, setScanQueue] = useState<Array<{ filterId: string; filterName: string; ahuName?: string; tagId: string }>>([]);
  // 2026-05-20: per-filter dryer duration (DRY_IN stage). Keyed by filterId
  // so reordering the queue doesn't lose values. Cleared on queue drain.
  const [dryerDurations, setDryerDurations] = useState<Record<string, number>>({});
  // Dry In multi-select (2026-09-04): Submit acts on the ticked queue rows only
  // (new rows start ticked). On DRY_IN ONE duration covers every queued filter —
  // dryerDurations is kept as the per-filter mirror the batch path already reads.
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  const [dryerBatchDuration, setDryerBatchDuration] = useState<number>(30);
  const toggleQueueSelect = (filterId: string) => setSelectedQueueIds(prev => { const n = new Set(prev); if (n.has(filterId)) n.delete(filterId); else n.add(filterId); return n; });
  const selectAllQueue = (all: boolean) => setSelectedQueueIds(all ? new Set(scanQueue.map(q => q.filterId)) : new Set());
  const applyBatchDuration = (minutes: number) => {
    setDryerBatchDuration(minutes);
    setDryerDurations(prev => Object.fromEntries(Object.keys(prev).map(id => [id, minutes])));
  };
  // After a batch submit: drop the submitted rows, keep the unticked ones queued
  // (and `keep`: rows this submit held back, which stay for their own submit).
  const clearSubmittedFromQueue = (keep?: ReadonlySet<string>) => {
    const dropped = (id: string) => selectedQueueIds.has(id) && !keep?.has(id);
    setScanQueue(prev => prev.filter(q => !dropped(q.filterId)));
    setDryerDurations(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !dropped(id))));
    setSelectedQueueIds(new Set());
  };
  // Put filters a cycle-start submit left out back in the queue, ticked, for a
  // separate submit (their reason is shown with leftInQueueMessage).
  const requeueLeft = (left: Array<LeftItem>) => {
    if (left.length === 0) return;
    const ids = new Set(left.map(l => l.item.filterId));
    const rows = reasonQueueRowsRef.current.filter(r => ids.has(r.filterId));
    setScanQueue(prev => [...prev, ...rows.filter(r => !prev.some(p => p.filterId === r.filterId))]);
    setSelectedQueueIds(prev => new Set([...prev, ...rows.map(r => r.filterId)]));
  };
  const [remarks, setRemarks] = useState('');
  // ─── Dialog state — now owned by useFilterOperationsCore (D1/D2/D4 Day 3b) ──
  // Compat aliases: read-only views into core.dialogState.
  // All writes go through core.dispatch({ type: '...' }).
  const blockChangeDialog = core.dialogState.kind === 'awaiting_block_change' ? core.dialogState : null;
  const [blockChangeReason, setBlockChangeReason] = useState('');
  const [blockChangeSubmitting, setBlockChangeSubmitting] = useState(false);
  // 2026-06-09: block-change approval → operator self-confirm. Filters confirmed for
  // cross-block cleaning (start payload sends acknowledgeBlockChange=true).
  const ackedBlockFiltersRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recentOps, setRecentOps] = useState<Array<{ stage: string; filter: string; time: string; queued?: boolean; status?: 'ok' | 'failed'; msg?: string }>>([]);
  // 2026-05-25: combined-screen UX. When a stage submit triggers a follow-up
  // checklist dialog (resolveAndDispatchChecklist auto-opens it), we want the
  // operator to see the stage readings they just submitted at the top of the
  // checklist dialog — so both readings + checklist are visible on a single
  // screen instead of looking like two unrelated steps. We snapshot the
  // readings + stage right before advance fires and clear after the checklist
  // closes. `readings` is an instrument-id keyed map; we resolve the labels
  // (description + uom) lazily from the active stage's `instrumentsForStage`
  // when rendering, so the snapshot stays small and stable.
  const [stageSubmitRecap, setStageSubmitRecap] = useState<{
    stage: string;
    filterName: string;
    readings: Array<{ description: string; value: string | number; uom: string }>;
    submittedAt: string;
  } | null>(null);
  // Stage interlock — current stage (Wash Out / Dry Out) awaiting its configured approver.
  // OQ-02 (2026-10-19): set by the queue submit (handleSubmitQueue). Cleared on
  // each submit; never set offline (offline cleaning is exempt).
  const [interlock, setInterlock] = useState<StageInterlockState | null>(null);
  // Task 7 + 2026-07-02: AHU remaining-filters dialog state (multi-AHU carousel).
  const [ahuDialogState, setAhuDialogState] = useState<{
    mode: 'POPUP' | 'INTERLOCK';
    ahus: { ahuName: string; allAtFinal: boolean; filters: { id: string; name: string; stage: string; done: boolean }[] }[];
    currentFilterIds: string[];
  } | null>(null);
  const ahuDialogResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  // 2026-07-03: filter-set chooser shown BEFORE the AHU popup. Choice scopes the
  // status check AND rides in the submit body via ahuSetChoiceRef.
  const [ahuSetChooser, setAhuSetChooser] = useState<boolean>(false);
  const ahuSetResolveRef = useRef<((set: FilterSetChoice | null) => void) | null>(null);
  const ahuSetChoiceRef = useRef<FilterSetChoice | null>(null);

  // RFID scan input ref + focus management. autoFocus only fires once on mount,
  // so after the first scan succeeds the input loses focus and subsequent RFID
  // keystrokes hit document.body — third-party apps work because they keep one
  // input permanently focused. We do the same: refocus after every successful
  // scan, dialog close, view change, AND we install a global keydown trap on
  // the stage view that pipes RFID-speed keystrokes to the input regardless
  // of where focus is. (RFID readers in UKB mode type 3-50ms between keys;
  // humans type 80-300ms — anything ≤80ms is RFID.)
  const scanInputRef = useRef<HTMLInputElement>(null);
  // The scan field's refocus-after-blur timer. Cleared on unmount (2026-10-22):
  // a page closed inside its 50 ms window ran it against a torn-down document.
  const refocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current); }, []);
  const focusScanInput = () => {
    // setTimeout(0) so the focus runs after React commits the next paint
    setTimeout(() => { scanInputRef.current?.focus(); }, 0);
  };

  // 2026-05-20: when batch DRY_IN gate opens a checklist dialog, scanQueue +
  // dryerDurations stay populated so they can be replayed once all checklists
  // in the batch finish. This ref + effect below is the trigger: set to true
  // at the gate, watched by an effect that fires handleSubmitQueue when the
  // checklist dialog walks to 'none'. Without this, the per-filter SET_DURATION
  // advances never fire — operator saw no countdowns after batch DRY_IN.
  const pendingBatchReplayRef = useRef(false);
  // Stage readings for a QUEUE of mid-cycle filters (2026-10-08). A cycle that
  // did not START at Wash In (e.g. Dry In -> Dry Out -> Wash In) reaches it
  // mid-cycle, and only the cycle-START path used to ask for the equipment
  // readings - so the whole batch was refused WASH_IN_READINGS_REQUIRED.
  // `queueReadingsModeRef` = the open equipment dialog is collecting readings
  // for the queue (submit stashes them instead of advancing one filter);
  // `queueReadingsRef` = the readings the next handleSubmitQueue run applies to
  // every mid-cycle advance at that stage.
  const queueReadingsModeRef = useRef(false);
  const queueReadingsRef = useRef<{ stage: string; equipmentGroupId: string; instrumentReadings: Record<string, number> } | null>(null);
  const prevDialogKindRef = useRef<string>('none');
  // A checklist BEFORE the first stage (a START checklist, 2026-10-22): what the
  // cycle starts with while its dialog is open. Nothing is written until the
  // dialog is submitted; closing it (any way) discards this.
  const startChecklistRef = useRef<{
    stage: string;
    cyclePayload: Record<string, any>;
    batch: Array<{ filterId: string; filterName: string }>;
    checklistProfileIds: string[];
    remarks: string;
  } | null>(null);
  // The queue rows a cycle-start submit took off the queue (the reason dialog
  // carries them), so a filter left out of the start can go back, ticked.
  const reasonQueueRowsRef = useRef<Array<{ filterId: string; filterName: string; ahuName?: string; tagId: string }>>([]);

  // Dialogs (compat aliases — see blockChangeDialog above)
  const reasonDialog = core.dialogState.kind === 'awaiting_reason' ? core.dialogState : null;
  const equipDialog = core.dialogState.kind === 'awaiting_equipment' ? core.dialogState : null;
  const checklistDialog = core.dialogState.kind === 'awaiting_checklist' ? core.dialogState : null;
  // The stage an open checklist belongs to, when it is NOT this station's stage:
  // a checklist pending at the previous stage, answered at the next station
  // (2026-10-22). Every other checklist on this page belongs to the station's
  // own stage (the one being entered or just entered). Cleared on close.
  const [checklistStage, setChecklistStage] = useState<string | null>(null);
  // Cycles already told that their profile / equipment group changed since they
  // started — told once per cycle while this station is open (2026-10-22).
  const cycleNoticeShownRef = useRef<Set<string>>(new Set());
  useEffect(() => { if (!checklistDialog) setChecklistStage(null); }, [checklistDialog]);
  const [selectedReason, setSelectedReason] = useState('');
  // The filter opening the reason dialog is due for PM (2026-10-22, as the
  // desktop page): the PM reason is preselected and a banner explains that any
  // other reason leaves the My Tasks visit pending.
  const [pmReasonDue, setPmReasonDue] = useState(false);
  const [justification, setJustification] = useState('');
  const [selectedEquipGroup, setSelectedEquipGroup] = useState<any>(null);
  const [readings, setReadings] = useState<Record<string, number>>({});
  // Instrument auto-fetch (2026-06-13) — mirrors the shared web EquipmentDialog.
  const [equipSource, setEquipSource] = useState<Record<string, 'MANUAL' | 'AUTO' | 'AUTO_OVERRIDDEN'>>({});
  /**
   * Instruments whose fetch ran out the 1-minute budget (2026-08-10) — they
   * revert to the normal stepped dropdown until "Get Values" is pressed again.
   * Per-instrument: in a 2-instrument Wash In group one reading can land while
   * the other times out, and only the latter should revert.
   */
  const [equipManualFallback, setEquipManualFallback] = useState<Set<string>>(new Set());
  const [equipFetching, setEquipFetching] = useState(false);
  const [equipFetchStatus, setEquipFetchStatus] = useState('');
  const [equipPending, setEquipPending] = useState<Set<string>>(new Set());
  const equipCancelRef = useRef(false);
  const [checklistAnswers, setChecklistAnswers] = useState<Record<string, any>>({});
  // 2026-05-26: unified-batch checklist (mirrors desktop filter-operations.tsx
  // `pendingBatch` state at line ~110). When multiple filters are advancing
  // through the same checklist gate, the dialog now opens ONCE with
  // filterName="N filter(s)" and pendingBatch carries every filter; on submit
  // the same answers are POSTed for each filter sequentially. Replaces the
  // pre-fix per-filter cycling via `remainingBatch`, which made the operator
  // re-answer the same checklist N times.
  const [pendingBatch, setPendingBatch] = useState<Array<{ filterId: string; filterName: string }> | null>(null);
  /**
   * Advances PARKED behind the batch checklist dialog, keyed by filterId
   * (2026-07-16). Non-empty => those filters have NOT been advanced: the dialog
   * opened first and each advance commits atomically with the answers, as ONE
   * `advance-with-checklist` per filter.
   *
   * Batch needs its own store because a single dialog covers N filters, so only
   * the primary has dialog state — `core.dialogState.deferredAdvance` can't
   * carry members 2..N. Cleared alongside `pendingBatch`; if the operator closes
   * the dialog, nothing was written and these are simply dropped.
   */
  const [pendingBatchDeferred, setPendingBatchDeferred] = useState<Map<string, { targetState: string; payload: Record<string, unknown> }> | null>(null);

  // Auto-fetch: reset per-instrument provenance/fetch state when the equipment
  // dialog opens; abort any in-flight fetch loop when it closes.
  useEffect(() => {
    if (equipDialog) {
      setEquipSource({}); setEquipFetching(false); setEquipFetchStatus(''); setEquipPending(new Set());
      equipCancelRef.current = false;
    }
    return () => { equipCancelRef.current = true; };
  }, [equipDialog]);

  // Refocus the scan input whenever we enter the stage view, all dialogs close,
  // or success flashes. autoFocus only fires once on mount, so without this
  // the operator has to manually tap the input after every successful scan
  // before the next RFID trigger does anything.
  useEffect(() => {
    if (view === 'stage' && !reasonDialog && !equipDialog && !checklistDialog && !blockChangeDialog) {
      focusScanInput();
    }
  }, [view, reasonDialog, equipDialog, checklistDialog, blockChangeDialog, success]);

  // Native SDK-mode RFID bridge. When the reader is in answer/SDK mode the OS
  // does NOT inject keystrokes — Reader_Usb.jar reads tags directly via USB
  // and pushes them through Capacitor's RfidPlugin. We subscribe once on the
  // stage view and route every received tag to the scan input + auto-submit.
  // Falls back silently on web (browser) where the plugin isn't available;
  // the document-level keystroke trap below handles UKB-mode readers.
  const [rfidError, setRfidError] = useState<string | null>(null);
  // The latest handleAddToQueue, assigned on every render below its definition
  // (2026-10-22). Both scan listeners call THROUGH this ref: they subscribe only
  // when `view` / the queue length change, so a direct call ran the handler of
  // that render — the dryer duration picked since then, and the master data
  // (the AHU name) that arrived since then, were ignored.
  const addToQueueRef = useRef<(rawValue?: string) => Promise<void>>(async () => {});
  useEffect(() => {
    if (view !== 'stage') return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const off = await subscribeRfidTags(
        (tag) => {
          if (cancelled) return;
          // Use the EPC as the scan value. resolveFilter() already handles
          // RFID dedup + identifier-map lookup the same way it does for keyboard input.
          const epc = (tag.epc ?? '').trim();
          if (!epc) return;
          setScanValue(epc);
          // Pass epc directly so handleAddToQueue doesn't rely on the
          // not-yet-committed scanValue state (stale-closure issue).
          addToQueueRef.current(epc);
        },
        (err) => { if (!cancelled) setRfidError(err); },
      );
      if (cancelled) { try { off(); } catch {} } else unsub = off;
    })();
    return () => { cancelled = true; try { unsub?.(); } catch {} };
  }, [view, scanQueue.length]);

  // Global RFID-burst capture. UKB-mode readers inject keystrokes into the
  // focused app at 3-100ms intervals (way faster than human typing). We catch
  // those bursts at document level, build the tag string, and route it to the
  // scan input. Debug log captures every keydown so operators can verify keys
  // are actually arriving (toggle via tap on the small ⓘ in the header).
  const [rfidDebug, setRfidDebug] = useState<string[]>([]);
  const [rfidDebugVisible, setRfidDebugVisible] = useState(false);
  const pushDebug = (s: string) => setRfidDebug(prev => [s, ...prev].slice(0, 25));

  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;
    let captureMode = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const RFID_INTERVAL_MS = 150;  // ≤ this gap = RFID. Used only to gate captureMode.
    // 2026-05-20: gap-based auto-flush. Some KC-series readers send tags
    // back-to-back without Enter/Tab between them, so without this the
    // global buffer accumulates "tag-Atag-B…" and the scan input shows the
    // concatenation. After the last key of a burst, wait FLUSH_AFTER_MS for
    // another key — if none arrives, treat it as the burst end and submit.
    const FLUSH_AFTER_MS = 250;

    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = lastKeyTime === 0 ? -1 : now - lastKeyTime;
      lastKeyTime = now;

      if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab') {
        pushDebug(`key="${e.key}" gap=${gap}ms target=${(e.target as HTMLElement)?.tagName ?? '?'}`);
      }

      // 2026-07-10: leave keystrokes destined for ANOTHER editable field alone
      // (checklist question inputs, remarks textarea, search boxes, selects).
      // This global capture-phase trap catches USB keyboard-wedge RFID input
      // when the scan field isn't focused — but fast HUMAN typing (2 chars
      // within RFID_INTERVAL_MS) was latching captureMode, mirroring the
      // keystrokes into the scan box AND preventDefault-ing them away from the
      // field the operator was typing in (the "checklist answer shows up in the
      // scan box" bug). Hardware RFID scans arrive via the native RfidPlugin
      // bridge (subscribeRfidTags), not this keyboard fallback, so nothing is
      // lost by skipping here. The scan input itself stays trapped below.
      const tgt = e.target as HTMLElement | null;
      if (
        tgt && tgt !== scanInputRef.current &&
        (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' ||
         tgt.tagName === 'SELECT' || tgt.isContentEditable)
      ) {
        // Drop any stale wedge state so a later real scan into the scan input
        // starts clean.
        buffer = '';
        captureMode = false;
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        return;
      }

      // Enter or Tab terminates an RFID burst — most readers append CR/LF/TAB.
      // Submit immediately on terminator. Zero wait.
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        if (captureMode || buffer.length > 0) {
          e.preventDefault();
          if (buffer.length >= 4) {
            const toSubmit = buffer;
            pushDebug(`SUBMIT: "${toSubmit}" (len ${toSubmit.length})`);
            setScanValue('');
            if (view === 'stage') {
              // Pass buffer directly — scanValue state hasn't committed yet.
              addToQueueRef.current(toSubmit);
            }
          }
          buffer = '';
          captureMode = false;
        }
        return;
      }

      if (e.key.length !== 1) return;

      // Capture rule (no time wait — every captured char is written to the input
      // immediately so operators see the tag building live):
      //   - captureMode is on (already in a burst) → continue
      //   - First key (gap === -1) → seed the buffer; next gap tells us if RFID
      //   - Fast follow-up (gap <= threshold) → RFID burst, latch captureMode
      //   - Otherwise human typing → ignore + reset stale buffer
      const isFastFollow = gap >= 0 && gap <= RFID_INTERVAL_MS;
      const isFirstKey = gap === -1;

      if (captureMode || isFastFollow || isFirstKey) {
        const target = e.target as HTMLElement | null;
        const isScanInput = target === scanInputRef.current;

        if (isFastFollow || captureMode) captureMode = true;
        buffer += e.key;

        // Live update: stuff the buffer into the scan input as each key arrives.
        // Operator sees the EPC build in real time.
        setScanValue(buffer);

        // Restart the gap-based flush timer. If no further key arrives within
        // FLUSH_AFTER_MS, submit the buffer. This catches readers that don't
        // send Enter/Tab between back-to-back tags (without this, buffer
        // accumulates "tag-Atag-B…" and only one tag is registered).
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
          if (buffer.length >= 4) {
            const toSubmit = buffer;
            pushDebug(`AUTO-FLUSH: "${toSubmit}" (len ${toSubmit.length})`);
            setScanValue('');
            if (view === 'stage') addToQueueRef.current(toSubmit);
          }
          buffer = '';
          captureMode = false;
          flushTimer = null;
        }, FLUSH_AFTER_MS);

        if (!isScanInput && captureMode) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else {
        // Human-speed key after a long gap — reset state in case prior buffer was stale
        buffer = '';
        captureMode = false;
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [view, scanQueue.length]);

  // Data — always fetch when online, cache for offline
  const { data: instancesData } = useSWR(online ? '/api/assets/instances' : null, { refreshInterval: 30000 });
  const { data: templatesData } = useSWR(online ? '/api/assets/templates' : null);
  // AHU→block map to scope the "Currently Drying" panel to the selected block.
  // Filter rows carry parentId (= their AHU); these give ahu.blockId /
  // area.blockId. Online-only; when unavailable the panel safe-degrades to all.
  const { data: ahusResp } = useSWR<any>(online ? '/api/hierarchy/ahus' : null);
  const { data: areasResp } = useSWR<any>(online ? '/api/hierarchy/areas' : null);
  const ahuBlockMap = useMemo(
    () => buildAhuBlockMap(ahusResp?.data ?? [], areasResp?.data ?? []),
    [ahusResp, areasResp],
  );
  // Always attempt the reasons fetch (not gated on the `online` flag — that
  // flag is unreliable on Android WebViews and, when it flips false on an
  // actually-online device, left the cleaning-reason picker empty). Offline the
  // fetch fails gracefully and we fall back to the cached reasons below.
  const { data: reasonsData } = useSWR('/api/filters/reasons');
  // refreshInterval so the offline identifier-map cache stays current: a tag
  // reassigned to another filter (here or on admin/web) propagates within ~30s
  // of being online, so a later OFFLINE scan resolves to the right filter
  // instead of "Filter not found" (matches the instances cache cadence).
  const { data: identifiersData } = useSWR(online ? '/api/assets/identifiers' : null, { refreshInterval: 30000, revalidateOnReconnect: true });
  const { data: equipGroupsData } = useSWR(online ? '/api/equipment-groups' : null);
  // B.5 — Cache cleaning-profile-assignment + active profiles so offline scans of
  // a brand-new filter (no filter-state-{id} cache yet) can still resolve a pipeline.
  // 2026-10-06: the `/current` read needs no permission — the CONFIG_READ list
  // 403'd for every operator and left the offline map empty.
  const { data: cleaningAssignmentData } = useSWR(online ? '/api/config/cleaning-profile-assignment/current' : null);
  const { data: activeProfilesData } = useSWR(online ? '/api/filter-cleaning-profiles?status=ACTIVE&expand=stages,connections' : null);
  const { data: checklistProfilesData } = useSWR(online ? '/api/checklist-profiles?expand=questions' : null);
  // Task 5: cache the server's blocked-filter set (AHU replacement overdue) so
  // the client-side offline gate can refuse to START a cleaning cycle on a
  // blocked filter even without a round trip. Server gate (Task 3) backstops
  // this online regardless.
  const { data: blockedFiltersData } = useSWR(online ? '/api/replacement-schedules/blocked-filters' : null, { refreshInterval: 30000, revalidateOnReconnect: true });
  // B.13 — Cache branding/field-ids/datetime config so offline app restart doesn't
  // flash defaults or break field labels until reconnect.
  const { data: brandingData } = useSWR(online ? '/api/config/branding' : null);
  const { data: fieldIdsData } = useSWR(online ? '/api/config/field-ids/current' : null);
  const { data: datetimeData } = useSWR(online ? '/api/config/datetime/current' : null);
  // B.14 — Cache approved block-change requests so an APPROVED status from a
  // recent server-side approval is visible offline before the cycle starts.
  // (2026-10-22) The tablet no longer reads the APPROVED block-change requests:
  // the list (every one ever, limit 1,000,000 — a table that grows with use) was
  // cached as 'approved-block-changes' and read by nothing once offline
  // cross-block stopped blocking (2026-06-09). Online the cross-block decision
  // comes from each filter's current-state (blockChangeStatus).
  // B.11 — Cache reauth scope for current user so offline ops know which actions
  // need a queued password vs. immediate dialog.
  const { data: myReauthActionsData } = useSWR(online && user ? '/api/config/action-reauth/my-actions' : null);

  // 2026-06-09: cross-block mode (NONE no-check | CONFIRM self-confirm | APPROVAL request).
  // Reads the authenticated-only /current mirror — the SUPER_ADMIN-gated
  // dynamic route 403'd for every operator role, silently defaulting to CONFIRM.
  const { data: bcCfg } = useSWR<any>(online ? '/api/config/block-change-approval/current' : null);
  // Offline the mode last read online stays in force (2026-10-22). The SWR key is
  // null offline, so the mode fell back to CONFIRM: an open APPROVAL dialog turned
  // into "Continue with cleaning" (a self-confirm) when the link dropped, and a
  // NONE site got cross-block notes it had switched off.
  const [storedBcMode, setStoredBcMode] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!bcCfg?.mode) return;
    setStoredBcMode(bcCfg.mode);
    cache('block-change-mode', bcCfg.mode).catch(() => { /* best effort: the in-memory copy still applies */ });
  }, [bcCfg?.mode]);
  useEffect(() => {
    getCache<string>('block-change-mode')
      .then((m) => { if (m) setStoredBcMode((cur) => cur ?? m); })
      .catch(() => { /* nothing stored: CONFIRM, as before */ });
  }, []);
  const bcModeRaw = bcCfg?.mode ?? storedBcMode;
  const blockChangeMode: 'NONE' | 'CONFIRM' | 'APPROVAL' =
    bcModeRaw === 'NONE' ? 'NONE' : bcModeRaw === 'APPROVAL' ? 'APPROVAL' : 'CONFIRM';

  const [offlineFilters, setOfflineFilters] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  const [offlineReasons, setOfflineReasons] = useState<any[]>([]);

  // Revalidate SWR data after sync completes (fixes "buffering" after sync)
  const [prevPendingCount, setPrevPendingCount] = useState(0);
  useEffect(() => {
    // When pending count drops (operations synced), refresh data
    if (prevPendingCount > 0 && pendingCount < prevPendingCount && online) {
      mutate('/api/assets/instances');
    }
    setPrevPendingCount(pendingCount);
  }, [pendingCount, online]);

  // Also listen for sync events directly
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'complete' && event.synced && event.synced > 0) {
        mutate('/api/assets/instances');
      }
    });
    return cleanup;
  }, []);

  // Cache data when online for offline use
  useEffect(() => { if (instancesData?.data) cacheFilterData(instancesData.data); }, [instancesData]);
  useEffect(() => {
    if (!identifiersData) return;
    let live = true;
    // M53: retired / deactivated holders drop out unless they still have
    // unsynced queued work on this tablet (that work must never be stranded).
    filterIdsWithUnsyncedWork().catch(() => undefined).then((keep) => {
      if (!live) return;
      const map = buildIdentifierMap(identifiersData as any[], keep);
      if (Object.keys(map).length > 0) {
        cache('identifier-map', map);
      }
    });
    return () => { live = false; };
  }, [identifiersData, cache]);
  useEffect(() => { if (templatesData?.data) cache('templates', templatesData.data, 24 * 60 * 60 * 1000); }, [templatesData, cache]);
  useEffect(() => { const r = (reasonsData as any)?.reasons ?? reasonsData; if (r) cache('cleaning-reasons', r, 24 * 60 * 60 * 1000); }, [reasonsData, cache]);
  useEffect(() => { if (equipGroupsData) cache('equipment-groups', Array.isArray(equipGroupsData) ? equipGroupsData : equipGroupsData?.data ?? [], 24 * 60 * 60 * 1000); }, [equipGroupsData, cache]);
  // B.5/B.11/B.13/B.14 — operationally-critical caches: 24h TTL so they survive long shifts
  useEffect(() => { if (cleaningAssignmentData) cache('cleaning-profile-assignment', cleaningAssignmentData, 24 * 60 * 60 * 1000); }, [cleaningAssignmentData, cache]);
  useEffect(() => {
    const list = (activeProfilesData as any)?.data ?? activeProfilesData;
    if (Array.isArray(list)) {
      cache('active-profiles', list, 24 * 60 * 60 * 1000);
      // Also store per-profile so resolveProfileForBlockOffline() can look up by id quickly
      for (const p of list) cache(`active-profile-${p.id}`, p, 24 * 60 * 60 * 1000);
    }
  }, [activeProfilesData, cache]);
  useEffect(() => {
    const list = (checklistProfilesData as any)?.data ?? checklistProfilesData;
    if (Array.isArray(list)) cache('checklist-profiles', list, 24 * 60 * 60 * 1000);
  }, [checklistProfilesData, cache]);
  useEffect(() => {
    const ids = (blockedFiltersData as any)?.filterIds;
    if (Array.isArray(ids)) cache('blocked-filter-ids', ids, 24 * 60 * 60 * 1000);
  }, [blockedFiltersData, cache]);
  useEffect(() => { if (brandingData) cache('branding-config', brandingData, 24 * 60 * 60 * 1000); }, [brandingData, cache]);
  useEffect(() => { if (fieldIdsData) cache('field-ids-config', fieldIdsData, 24 * 60 * 60 * 1000); }, [fieldIdsData, cache]);
  useEffect(() => { if (datetimeData) cache('datetime-config', datetimeData, 24 * 60 * 60 * 1000); }, [datetimeData, cache]);
  useEffect(() => {
    const actions = (myReauthActionsData as any)?.actions ?? myReauthActionsData;
    if (actions) cache('my-reauth-actions', actions, 24 * 60 * 60 * 1000);
  }, [myReauthActionsData, cache]);

  // Batch-cache all filter states for offline use (single API call instead of N calls).
  // B.4 — surface failures via state so the "Data Synced" indicator can show a
  // warning instead of silently leaving the operator with a stale cache. Manual
  // re-cache button below uses the same function.
  const [batchCacheError, setBatchCacheError] = useState<string | null>(null);
  const [batchCacheTimestamp, setBatchCacheTimestamp] = useState<string | null>(null);
  const [recaching, setRecaching] = useState(false);
  const cacheAllStates = async (): Promise<{ ok: boolean; count: number; error?: string }> => {
    try {
      const result = await apiClient.get<{ states: Record<string, any>; cachedAt: string }>('/api/filters/batch-states');
      if (result?.states) {
        let count = 0;
        for (const [fid, st] of Object.entries(result.states)) {
          await cache(`filter-state-${fid}`, st, 24 * 60 * 60 * 1000);
          count++;
        }
        setBatchCacheError(null);
        setBatchCacheTimestamp(result.cachedAt ?? new Date().toISOString());
        return { ok: true, count };
      }
      setBatchCacheError('Batch states endpoint returned no data');
      return { ok: false, count: 0, error: 'No data' };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setBatchCacheError(msg);
      return { ok: false, count: 0, error: msg };
    }
  };
  // 2026-10-17 load test (operator decision): this used to re-run on every
  // `instancesData` refresh, i.e. every 30 s — one 11 MB all-filters download per
  // tablet per 30 s, ~7 s of server CPU each before fix 6 and still the single
  // request that saturated the server at 100 users. The offline cache is now
  // refreshed when the tablet comes online, every 5 minutes while it stays
  // online, on every sync (offline-sync-service.ts) and on the manual button;
  // the operator's own actions update their filter's cached state as they happen.
  useEffect(() => {
    if (!online) return;
    const timer = setTimeout(cacheAllStates, 2000);
    const every = setInterval(cacheAllStates, 5 * 60_000);
    return () => { clearTimeout(timer); clearInterval(every); };
  }, [online]);
  const manualRecache = async () => {
    if (!online || recaching) return;
    setRecaching(true);
    try {
      const r = await cacheAllStates();
      if (r.ok) setSuccess(`Re-cached ${r.count} filter states for offline use`);
      else setError(`Re-cache failed: ${r.error ?? 'unknown'}`);
    } finally {
      setRecaching(false);
    }
  };

  // Load cached data when offline
  const refreshOfflineData = () => {
    getOfflineFilters().then(setOfflineFilters);
    getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? []));
    getCache<any[]>('cleaning-reasons').then(r => setOfflineReasons(r ?? []));
  };
  useEffect(() => {
    if (!online) refreshOfflineData();
  }, [online]);

  // Keep the offline missed-PM map fresh while there IS a network, so the
  // dialog can still fire once there isn't. Cheap (one small GET) and only when
  // online, so it costs nothing on a disconnected shift.
  useEffect(() => {
    if (online) void refreshPmPendingCache();
  }, [online]);
  // Issue #5 fix (2026-05-18): home/status tile counters were rendering
  // stale state-counts (e.g. Wash In: 1 even after the filter advanced to
  // Wash Out offline). `recomputeAndCacheFilterState` correctly writes the
  // new currentLifecycleState to IndexedDB, but `refreshOfflineData()` is
  // fire-and-forget at the call site — if React happened to render before
  // setOfflineFilters resolved, the tile saw the old in-memory snapshot.
  // pendingCount changes whenever the queue grows (new offline op) or
  // shrinks (sync completed), so it's the right tripwire for re-reading
  // the cache and updating the counts.
  useEffect(() => {
    refreshOfflineData();
  }, [pendingCount]);

  // Prefer freshly-fetched reasons whenever the fetch returned any (regardless
  // of the flaky `online` flag); fall back to the cached reasons only when the
  // fetch yielded nothing (genuinely offline).
  const fetchedReasons = ((reasonsData as any)?.reasons ?? reasonsData ?? []) as any[];
  const cleaningReasons = fetchedReasons.length > 0 ? fetchedReasons : offlineReasons;
  const templates = (online ? (templatesData?.data ?? []) : offlineTemplates) as any[];
  const instances = online ? ((instancesData?.data ?? []) as any[]) : offlineFilters;
  // Match against every FILTER-kind template, not just one (history.tsx bug
  // fix from 2026-05-12 fanned out — single .find()?.id silently dropped
  // filters belonging to a second/third FILTER-kind template).
  const filterTemplateIds = new Set(
    templates.filter((t: any) => t.templateKind === 'FILTER').map((t: any) => t.id),
  );
  const blockTemplateId = templates.find((t: any) => t.templateKind === 'BLOCK')?.id;
  // Templates-loaded path: Set membership. First-paint fallback: the
  // instance carries its eager-loaded `template.templateKind` per
  // assets/instance.repository.ts. Same rename-stable filter as desktop.
  const allFilters = instances.filter((f: any) =>
    (filterTemplateIds.has(f.templateId) || f.template?.templateKind === 'FILTER') &&
    f.isActive !== false && f.status !== 'Retired'
  );
  const blocks = instances.filter((i: any) => i.templateId === blockTemplateId);
  // OQ-05 (2026-10-19): a My Tasks "Perform" names the task AHU's block. Pick it
  // once, as soon as the block list has loaded; "Change" still clears it, and
  // an unknown id leaves the normal block picker in place.
  const initialBlockAppliedRef = useRef(false);
  useEffect(() => {
    if (initialBlockAppliedRef.current || !initialBlockId || !activeStage?.needsBlock || selectedBlock) return;
    const b = blocks.find((x: any) => x.id === initialBlockId);
    if (b) { initialBlockAppliedRef.current = true; setSelectedBlock(b); }
  });

  const stageCounts: Record<string, number> = {};
  allFilters.forEach((f: any) => { if (f.currentLifecycleState) stageCounts[f.currentLifecycleState] = (stageCounts[f.currentLifecycleState] ?? 0) + 1; });

  // Per operator request 2026-05-25: every message (error / success /
  // warning) surfaces as a toast popup — no inline banners. Inline banners
  // were getting buried beneath scrollable content and operators missed
  // them. Toast pops at the top of the page from any view.
  const { toast } = useToast();
  useEffect(() => {
    if (error) {
      toast.error('Error', error);
      const t = setTimeout(() => setError(''), 100);
      return () => clearTimeout(t);
    }
  }, [error]);
  useEffect(() => {
    if (success) {
      toast.success('Success', success);
      const t = setTimeout(() => setSuccess(''), 100);
      return () => clearTimeout(t);
    }
  }, [success]);
  // batchCacheError stays as an inline banner because it carries a Retry button;
  // a toast can't host the action. rfidError also stays inline — it's stage-
  // local and the toast wouldn't see the same view scope.

  // 2026-05-20: accept an explicit `rawValue` arg so RFID-driven scans can
  // pass the EPC directly, bypassing the stale-closure problem where
  // setScanValue(epc) + immediate handleAddToQueue() sees the OLD scanValue
  // (React state update isn't observable inside the same callback frame).
  // The keyboard-input path falls back to reading scanValue as before.
  const resolveFilter = async (rawValue?: string): Promise<{ filterId: string; filterName: string; ahuName?: string } | null> => {
    let filterId = ''; let filterName = '';
    const source = rawValue ?? scanValue;

    // Upper-case + de-duplicate the reader burst — ONE rule for every scan path (lib/rfid-scan.ts).
    const sv = normalizeRfidScan(source);

    // Identifier lookup API — FIRST of three fallback strategies. Do NOT gate on
    // the `online` flag: navigator.onLine is unreliable on Android WebViews, so a
    // stale false-negative would skip a REACHABLE server and fall back to a stale
    // cached map — exactly the "Filter not found after a tag is reassigned to
    // another filter" bug (the cache still maps the tag to the old filter, or
    // lacks the new one). A genuinely-offline call throws (or returns the SPA
    // shell) and falls through to the cached map. 404 / network error are
    // non-fatal and intentionally silent.
    let approvalStatus: string | null | undefined;
    try {
      const l = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(sv)}`);
      if (l?.asset?.id) {
        filterId = l.asset.id; filterName = l.asset.name; approvalStatus = l.asset.approvalStatus ?? null;
        // Self-heal the offline cache so a later OFFLINE scan of this (possibly
        // just-reassigned) tag resolves to the CURRENT filter, not a stale one.
        // M53: never re-add a tag whose holder is retired / deactivated — the
        // sync just evicted it, and this would put it straight back.
        const holderGone = l.asset.status === 'Retired' || l.asset.isActive === false;
        if (!holderGone) try {
          const m = (await getCache<Record<string, IdentifierMapEntry>>('identifier-map')) || {};
          const entry: IdentifierMapEntry = { filterId: filterId as string, filterName: filterName as string, approvalStatus };
          m[sv] = entry; m[sv.toUpperCase()] = entry; m[sv.toLowerCase()] = entry;
          await cache('identifier-map', m);
        } catch { /* best-effort cache write */ }
      }
    } catch { /* offline / network error — fall through to cached map */ }

    // Try cached identifier map (works both online and offline)
    if (!filterId) {
      try {
        const map = await getCache<Record<string, IdentifierMapEntry>>('identifier-map');
        if (map) {
          const match = map[sv] || map[sv.toUpperCase()] || map[sv.toLowerCase()] || map[source.trim()];
          if (match) { filterId = match.filterId; filterName = match.filterName; approvalStatus = match.approvalStatus; }
        }
      } catch { /* IDB read failed — fall through to name match below */ }
    }
    // Creation-workflow gate at scan time (web F3) — the cached instances list
    // carries approvalStatus too, for the name-match fallback below.
    if (filterId && approvalStatus === undefined) {
      approvalStatus = (instances.find((i: any) => i.id === filterId) as any)?.approvalStatus ?? null;
    }
    if (filterId) {
      const blocked = approvalBlockMessage(filterName ?? sv, approvalStatus);
      if (blocked) { setError(blocked); return null; }
    }

    // Fallback: match by filter name in cached instances
    if (!filterId) {
      const m = allFilters.find((a: any) => a.name?.toLowerCase() === sv.toLowerCase());
      if (m) {
        const blocked = approvalBlockMessage(m.name, (m as any).approvalStatus);
        if (blocked) { setError(blocked); return null; }
        filterId = m.id; filterName = m.name;
      }
    }
    if (!filterId && sv.match(/^[0-9a-f]{8}-/i)) { filterId = sv; filterName = sv.slice(0, 8); }
    if (!filterId) {
      // Show the exact value we looked up (normalized + raw if different) so a
      // value-mismatch — scanned EPC ≠ the stored RFID number — is visible. The
      // server resolves the stored number exactly; if this value isn't found,
      // it doesn't match any assigned tag.
      const rawShown = source.trim();
      setError(`Filter not found for tag "${sv}"${rawShown !== sv ? ` (scanned "${rawShown}")` : ''}. ${online ? 'This value is not assigned to any filter on the server — the scanned value may differ from the stored RFID number.' : "You're offline and this tag isn't cached — connect once to sync."}`);
      return null;
    }
    // 2026-05-20: resolve parent AHU name so the queue display can show
    // "{filterName} · {ahuName}" — operators on the floor identify filters
    // by their AHU context, not by serial alone. Lookup against the same
    // instances cache that powers allFilters; both filter and AHU live there.
    const filterRow = instances.find((i: any) => i.id === filterId);
    let ahuName: string | undefined;
    if (filterRow?.parentId) {
      const parent = instances.find((i: any) => i.id === filterRow.parentId);
      if (parent?.name) ahuName = parent.name;
    }
    return { filterId, filterName, ahuName };
  };

  // Add scanned filter to queue (batch mode).
  // 2026-05-20: accept an explicit `rawValue` arg so RFID-driven scans
  // bypass the stale-closure problem (setScanValue + immediate call sees
  // the old value). Falls back to scanValue for the keyboard Enter path.
  const handleAddToQueue = async (rawValue?: string) => {
    const value = (rawValue ?? scanValue).trim();
    if (!value) return;
    setError('');
    const resolved = await resolveFilter(value);
    if (!resolved) return;
    if (scanQueue.some(q => q.filterId === resolved.filterId)) {
      setError('Filter already in queue');
      setScanValue('');
      return;
    }
    // Dedup INSIDE the functional updater too, not only the closure check above:
    // an RFID reader re-fires the same tag rapidly, so two handleAddToQueue calls
    // can run before a re-render — both see a stale `scanQueue` and pass the check
    // above. The updater sees the accumulated `prev`, so the duplicate is dropped.
    setScanQueue(prev =>
      prev.some(q => q.filterId === resolved.filterId) ? prev : [...prev, { ...resolved, tagId: value }],
    );
    // 2026-05-20: pre-populate per-filter dryer duration with a sensible
    // default so the Submit-All button is enabled out of the box. Operator
    // can change per row before submitting. Only meaningful on DRY_IN
    // stage; harmlessly ignored on others.
    setSelectedQueueIds(prev => new Set([...prev, resolved.filterId]));
    if (activeStage?.key === 'DRY_IN') {
      setDryerDurations(prev => ({ ...prev, [resolved.filterId]: prev[resolved.filterId] ?? dryerBatchDuration }));
    }
    setScanValue('');
  };
  addToQueueRef.current = handleAddToQueue;

  const removeFromQueue = (filterId: string) => {
    setScanQueue(prev => prev.filter(q => q.filterId !== filterId));
    setSelectedQueueIds(prev => { const n = new Set(prev); n.delete(filterId); return n; });
    setDryerDurations(prev => { const next = { ...prev }; delete next[filterId]; return next; });
  };

  // Post one batch of resolved ops to /bulk-operate (online only). Primes each ok
  // filter's cache from its returned snapshot and exposes the per-filter
  // post-write `actions` tape so the callers' existing post-loop checklist
  // dispatch keeps working.
  //
  // Reauth: wraps the ONE batch POST in reauth.executeWithResult — for a
  // reauth-gated action (START_CLEANING_CYCLE / SUBMIT_CHECKLIST_WITH_SIGNATURE for
  // the enabled role) it opens the password dialog and resolves with the POST
  // result once the operator confirms; for reauth-off actions (advance) it posts
  // inline. Returns 'cancelled' if the operator declines the dialog and
  // 'transport_error' on a wholesale failure — both keep the caller's queue for
  // retry (the operator re-submits).
  const runBulkOnline = async (
    ops: BulkClientItem[],
    // Generic row(s) + the station row of the batch's target stage (2026-09-24).
    reauthAction: string | string[],
  ): Promise<{ results: BulkClientResult[]; actionsByFilter: Map<string, any[]>; okCount: number; failures: string[] } | 'transport_error' | 'cancelled'> => {
    let resp: { results: BulkClientResult[] };
    try {
      resp = await reauth.executeWithResult(reauthAction, (password?: string) => bulkOperate(ops, password));
    } catch (e: any) {
      if (e?.error === 'REAUTH_CANCELLED') return 'cancelled';
      return 'transport_error';
    }
    const actionsByFilter = new Map<string, any[]>();
    const failures: string[] = [];
    let okCount = 0;
    for (const r of resp.results) {
      if (r.status === 'ok') {
        okCount++;
        if (r.snapshot) {
          await cache(`filter-state-${r.filterId}`, r.snapshot, 24 * 60 * 60 * 1000);
          if (Array.isArray((r.snapshot as any).actions)) actionsByFilter.set(r.filterId, (r.snapshot as any).actions);
        }
      } else {
        failures.push(`${r.filterId}: ${r.error?.message ?? 'failed'}`);
      }
    }
    return { results: resp.results, actionsByFilter, okCount, failures };
  };

  type BulkOutcome = Exclude<Awaited<ReturnType<typeof runBulkOnline>>, string>;

  /**
   * Missed-PM question for a BATCH cycle start (2026-10-01).
   *
   * /bulk-operate reports each refused start with a code + message only — no
   * task list — so a batch that hit PM_PREVIOUS_TASK_PENDING used to end on
   * "give a reason for each outstanding visit" with nowhere to give one. The
   * outstanding visits come from the same map the offline path uses (refreshed
   * first, since we are online); the operator answers ONCE and only the refused
   * items are re-sent with the answers attached. Anything else is returned
   * unchanged, so every other failure keeps its own message.
   */
  const retryBulkStartsForMissedPm = async (
    ops: BulkClientItem[],
    first: BulkOutcome,
    reauthAction: string | string[],
  ): Promise<BulkOutcome> => {
    const refusedIds = new Set(
      first.results.flatMap(r => (r.status === 'failed' && r.error?.code === 'PM_PREVIOUS_TASK_PENDING' ? [r.filterId] : [])),
    );
    if (refusedIds.size === 0) return first;
    await refreshPmPendingCache();
    const tasksById = new Map<string, PendingPmTask>();
    for (const fid of refusedIds) {
      for (const t of await getCachedPendingPmTasksForFilter(fid)) tasksById.set(t.entryId, t);
    }
    // Nothing to ask about (map unavailable to this role) — leave the server's message.
    if (tasksById.size === 0) return first;
    const answers = await askPmSkipReasons([...tasksById.values()], 5);
    if (!answers) return first; // cancelled — those cleanings do not start
    const retryOps = ops
      .filter(o => refusedIds.has(o.filterId))
      .map(o => ({ ...o, clientOpId: crypto.randomUUID(), cyclePayload: { ...(o.cyclePayload ?? {}), pmSkips: answers } }));
    const second = await runBulkOnline(retryOps, reauthAction);
    if (typeof second === 'string') return first;
    await forgetCachedPmTasks(answers.map(a => a.entryId));
    const secondById = new Map(second.results.map(r => [r.filterId, r]));
    const results = first.results.map(r => secondById.get(r.filterId) ?? r);
    const actionsByFilter = new Map([...first.actionsByFilter, ...second.actionsByFilter]);
    return {
      results,
      actionsByFilter,
      okCount: results.filter(r => r.status === 'ok').length,
      failures: results.flatMap(r => (r.status === 'failed' ? [`${r.filterId}: ${r.error?.message ?? 'failed'}`] : [])),
    };
  };

  // Submit all queued filters for the active stage (batch advance for mid-cycle stages).
  // Each item is validated against the cached pipeline graph + block assignment BEFORE
  // being queued — the shared strict offline gate (validateOfflineGate).
  /**
   * Does a MID-CYCLE advance into `stageKey` need equipment readings? Mirrors
   * the server: the groups the cycle's readings may use (lib/filter-ops
   * equipmentGroupChoice — a cycle bound to a group uses it; an unbound one on a
   * block with several asks the operator, never a silent pick of the server's
   * default) need them for any stage they have instruments for; with no group
   * known, Wash In needs them whenever the block has an active group (advance.ts
   * WASH_IN_READINGS_REQUIRED) — `blockFallback`. Dry In has its own two-step
   * dryer flow and is excluded. Returns what the equipment dialog should offer,
   * or null.
   */
  const stageReadingsNeed = async (stageKey: string, st: any): Promise<{ cycleGroup?: any; groups: any[]; blockFallback?: boolean } | null> => {
    if (stageKey === 'DRY_IN') return null;
    const choice = equipmentGroupChoice(st);
    if (choice.groups.length > 0) {
      if (!choice.groups.some((g: any) => groupHasStageInstruments(g, stageKey))) return null;
      return choice.needsChoice ? { groups: choice.groups } : { cycleGroup: choice.group, groups: [] };
    }
    if (stageKey !== 'WASH_IN' || !selectedBlock?.id) return null;
    let groups: any[] = [];
    if (online) {
      try { groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${selectedBlock.id}`) ?? []; } catch { /* fall back to cache */ }
    }
    if (groups.length === 0) {
      try { groups = ((await getCache<any[]>('equipment-groups')) ?? []).filter((g: any) => g.blockId === selectedBlock.id); } catch { /* none cached */ }
    }
    return groups.length > 0 ? { groups, blockFallback: true } : null;
  };

  /**
   * Offline, a cycle waiting at START (started, no stage entered): can this
   * tablet tell whether its checklist before the first stage is answered? The
   * executor drops a checklist it cannot resolve and the offline replay exempts
   * START_CHECKLIST, so what it cannot read is refused, never skipped (fail
   * CLOSED, 2026-10-22):
   *   - no pipeline graph cached → it cannot know whether there is one;
   *   - one there, unanswered on this tablet for this cycle, and its questions
   *     cached nowhere (local-context resolveChecklistProfile — the same source
   *     the tape is built from).
   * Returns the reason, or null when the tape can be trusted.
   */
  const offlineStartRefusal = async (state: any, cycleId: string | null): Promise<string | null> => {
    if (!state?.pipelineGraph?.stages) return 'its cleaning profile is not on this tablet — go online to continue its cycle';
    const ids = startChecklistProfileIds(state);
    if (ids.length === 0) return null;
    const answered = (state.checklistCompletions ?? []).some(
      (c: any) => (c.afterStage ?? null) === null && (c.cycleId ?? null) === cycleId,
    );
    if (answered) return null;
    const slice = await resolveChecklistProfile({ ...state, currentCycle: state.currentCycle ?? (cycleId ? { id: cycleId } : null) });
    if (slice && ids.includes(slice.id) && slice.questions.length > 0) return null;
    return 'its first checklist could not be loaded — go online to load its questions';
  };

  const handleSubmitQueue = async () => {
    // Dry In multi-select (2026-09-04): only the ticked rows are submitted.
    const batchQueue = scanQueue.filter(q => selectedQueueIds.has(q.filterId));
    if (batchQueue.length === 0 || !activeStage || loading) return;
    setLoading(true); setError(''); setSuccess('');
    setInterlock(null);
    // OQ-02: the first filter of this submit held by the stage interlock — the
    // banner explains it; every held filter also gets its own failure line.
    let interlockHit: StageInterlockState | null = null;
    const noteInterlock = (i: StageInterlockState) => { if (!interlockHit) { interlockHit = i; setInterlock(i); } };
    // 2026-05-20: snapshot the queue BEFORE the loop so the post-batch
    // current-state prime can target every filter even after setScanQueue([])
    // clears the live state.
    const scanQueueSnapshot = batchQueue.slice();
    // Rows left unticked are not part of this submit, and survive it.
    const submittedIds = new Set(batchQueue.map(q => q.filterId));
    // Rows this submit holds back (another readings call, 2026-10-22): skipped,
    // unticked, named, and kept in the queue for their own submit.
    const heldBack = new Set<string>();
    const holdBack = (left: LeftItem[]) => {
      if (left.length === 0) return;
      for (const l of left) { heldBack.add(l.item.filterId); submittedIds.delete(l.item.filterId); }
      setSelectedQueueIds(prev => new Set([...prev].filter(id => !heldBack.has(id))));
      toast.error('Error', leftInQueueMessage(left));
    };
    let successCount = 0;
    const failed: string[] = [];
    // 2026-05-26: capture per-filter server tape so the post-loop checklist
    // dispatch can pass authoritative server actions to
    // resolvePendingChecklistDialog instead of falling back to local
    // recompute (which depends on cache state that the post-loop /current-
    // state prime overwrites before the dispatch runs).
    const serverActionsByFilter = new Map<string, any[]>();
    // Task 3: ONLINE advance leaves accumulate a resolved op here instead of
    // firing a per-filter network call. After the loop, all of these post in ONE
    // /bulk-operate request (see the runBulkOnline dispatch below). Offline leaves
    // are untouched — they still go through executeOrQueue/core.advance.
    const bulkOps: BulkClientItem[] = [];
    // 2026-07-16: filters whose target stage carries a mandatory checklist. Their
    // advance is NOT dispatched in the loop — it is parked here, the dialog opens
    // after the loop, and each commits atomically with the answers. Works online
    // and offline (resolution is cache-first).
    const deferredAdvances = new Map<
      string,
      { item: { filterId: string; filterName: string }; payload: Record<string, unknown>; checklists: any[] }
    >();
    // 2026-05-26: filters whose dialog was ALREADY dispatched inside the
    // loop by core.advance/startAndAdvance's resolveAndDispatchChecklist.
    // The post-loop dispatch must SKIP these — otherwise it tries to open
    // open_checklist from awaiting_checklist and the state-machine guard
    // throws (caught offline DRY_IN SET_DURATION repro on 2026-05-26).
    const dialogDispatchedInLoop = new Set<string>();
    // Filters whose pending checklist this station may not answer — the
    // post-loop resolver below must not open it for them either.
    const stationRefused = new Set<string>();
    // Non-blocking notices (2026-10-22, CLAUDE.md "cycle profile_id is locked at
    // start"): a running cycle whose cleaning profile was reassigned, or whose
    // equipment group was edited, since it started still finishes as it
    // started. The operator is told, never stopped. Shown when the submit ends.
    const profileNotes: string[] = [];
    const groupNotes: string[] = [];
    // Deep-review fix D6 (2026-05-17): outer try/finally so the loading flag
    // always clears even when REAUTH or OFFLINE_CACHE_RECOMPUTE_FAILED bubble
    // out of the inner loop. Pre-fix a re-thrown REAUTH left loading=true
    // and the operator's UI was stuck until refresh. 2026-10-22: it opens
    // BEFORE the two IndexedDB reads below — when those rejected (storage
    // evicted), the spinner stuck the same way and the rejection went unhandled.
    try {
    // Perf (2026-07-09): read the ENTIRE cached-filter store ONCE, up front,
    // and index it by id. Pre-fix each loop iteration called getOfflineFilters()
    // — a full IDB scan of every cached filter — just to .find() its own row,
    // so a 50–100 tag batch did 50–100 full-store reads (O(N²)). Distinct
    // filterIds per queue item mean a single snapshot is correct; each row is
    // that filter's own state and no item depends on another item's row.
    const allCachedFilters = await getOfflineFilters();
    const cachedFilterById = new Map<string, any>(
      (allCachedFilters ?? []).map((f: any) => [f.id, f]),
    );
    // Task 5: the cached blocked-filter set (AHU replacement overdue). Loaded
    // once per batch submit; the gate below only uses it on the !cycleInProgress
    // (START) branch.
    const blockedIds = new Set<string>((await getCache<string[]>('blocked-filter-ids')) ?? []);
    // A submit mixing filters IN a cycle with filters to START (2026-10-22). A
    // start needs the reason dialog, which used to open mid-loop and return:
    // the advances already collected for /bulk-operate were never posted and
    // their rows were cleared (silently lost), and every later filter, in a
    // cycle or not, rode on the dialog as a cycle START. The in-cycle filters go
    // now; the ones to start stay queued, named, for their own submit.
    {
      const toStart: LeftItem[] = [];
      let anyInCycle = false;
      for (const q of batchQueue) {
        const row = await getCache<any>(`filter-state-${q.filterId}`).catch(() => null);
        if (row?.currentCycle?.id || cachedFilterById.get(q.filterId)?.currentCycleId) anyInCycle = true;
        else toStart.push({ item: q, note: 'starts a new cleaning cycle — submit it on its own' });
      }
      if (anyInCycle) holdBack(toStart);
    }
    // AHU pre-flight for the checklist-less completion case (2026-08-10). ONE
    // call for the whole queue, before the loop — the tablet submits 50–100
    // tags and the check is per-AHU, not per-filter. Pipelines that end with a
    // terminal checklist are unaffected (isCompletingAdvance returns false) and
    // keep warning at checklist-open via gateAhuBeforeChecklist below.
    // Deliberately INSIDE the D6 try/finally: a throw here (rather than the
    // handled 'blocked' return) would otherwise skip the finally and leave the
    // tablet spinner stuck — the exact failure D6 exists to prevent.
    if (
      (await gateAhuBeforeCompletingAdvance(
        scanQueueSnapshot.map(q => q.filterId),
        activeStage.key,
      )) === 'blocked'
    ) return;
    // Stage readings for the batch (2026-10-08): ask ONCE, before any advance,
    // when the queue holds a mid-cycle filter whose advance into this stage needs
    // equipment readings. Submit stashes them in queueReadingsRef and re-runs
    // this function; every mid-cycle advance below then carries them. Filters
    // still needing a cycle START keep the reason -> equipment flow.
    if (queueReadingsRef.current?.stage !== activeStage.key) {
      // The mid-cycle filters of this submit, each read on its OWN state (a
      // filter still to start takes the reason -> readings path instead).
      const inCycle: Array<{ filterId: string; filterName: string }> = [];
      const inCycleStates = new Map<string, any>();
      for (const q of batchQueue) {
        const cs = await getCache<any>(`filter-state-${q.filterId}`) ?? {};
        if (cs.currentCycle?.id || cachedFilterById.get(q.filterId)?.currentCycleId) {
          inCycle.push({ filterId: q.filterId, filterName: q.filterName });
          inCycleStates.set(q.filterId, cs);
        }
      }
      const probe = inCycle.length > 0 ? inCycleStates.get(inCycle[0].filterId) : null;
      const need = probe ? await stageReadingsNeed(activeStage.key, probe) : null;
      if (need) {
        // ONE readings call per submit — the first filter's (finding 5,
        // 2026-10-22). A filter whose cycle records readings with another group,
        // needs its own group choice, or takes none here is not given these
        // readings (the server refuses a mismatched group, 409
        // EQUIPMENT_GROUP_MISMATCH): it stays in the queue, unticked, named.
        const split = splitByReadings(
          inCycle,
          (id) => inCycleStates.get(id) ?? null,
          need.blockFallback ? null : activeStage.key,
          need.blockFallback ? need.groups : [],
        );
        holdBack(split.left);
        queueReadingsModeRef.current = true;
        core.dispatch({
          type: 'open_equipment',
          filterId: split.ride[0].filterId,
          filterName: split.ride.length > 1 ? `${split.ride.length} filter(s)` : split.ride[0].filterName,
          stage: activeStage.key,
          groups: need.groups,
          cycleGroup: need.cycleGroup,
        });
        setSelectedEquipGroup(need.cycleGroup ?? null); setReadings({});
        return; // finally clears loading; the queue stays for the re-run
      }
      // No readings for the first filter: one that DOES take readings here is not
      // advanced without them — held back, as above.
      holdBack(splitByReadings(inCycle, (id) => inCycleStates.get(id) ?? null, activeStage.key).left);
    }
    const stageReadings = queueReadingsRef.current?.stage === activeStage.key ? queueReadingsRef.current : null;
    for (const item of batchQueue) {
      if (heldBack.has(item.filterId)) continue;
      try {
        const cached = cachedFilterById.get(item.filterId);
        let cachedState = await getCache<any>(`filter-state-${item.filterId}`) ?? {};
        // 2026-10-01: a filter this tablet has never opened (newly created, or not
        // cleaned since the last cache wipe) has no cached pipeline, so the "a new
        // cycle starts at the FIRST stage" rule in the gate below had nothing to
        // check. A wrong-stage scan then asked for a cleaning reason, started the
        // cycle, and only the advance was refused. Online, read the state once so
        // the operator is told the right stage BEFORE anything is started.
        if (online && !cachedState.pipelineGraph?.stages && !(cachedState.currentCycle?.id || cached?.currentCycleId)) {
          try {
            const cs = await apiClient.get<any>(
              `/api/filters/${item.filterId}/current-state${selectedBlock?.id ? `?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}` : ''}`,
            );
            if (cs) { await cacheServerStateResponse(item.filterId, cs); cachedState = cs; }
          } catch { /* transient read failure — fall through with what is cached */ }
        }
        const currentLifecycle = cached?.currentLifecycleState || cachedState.currentState || null;
        const cycleInProgress = !!(cachedState.currentCycle?.id || cached?.currentCycleId);
        if (cycleInProgress) {
          const cycleKey = cachedState.currentCycle?.id ?? cached?.currentCycleId ?? item.filterId;
          const ps = cachedState.profileSyncWarning;
          if (ps && !cycleNoticeShownRef.current.has(`profile:${cycleKey}`)) {
            cycleNoticeShownRef.current.add(`profile:${cycleKey}`);
            profileNotes.push(`${item.filterName}: running on "${ps.cycleProfileName ?? ps.cycleProfileId}"; this block now uses "${ps.expectedProfileName ?? ps.expectedProfileId}"`);
          }
          const eg = cachedState.equipmentGroupSyncWarning;
          if (eg && !cycleNoticeShownRef.current.has(`group:${cycleKey}`)) {
            cycleNoticeShownRef.current.add(`group:${cycleKey}`);
            groupNotes.push(`${item.filterName}: group updated v${eg.pinnedVersion} → v${eg.liveVersion}`);
          }
        }

        // Phase 8.6 part 2: resolve the action tape — server actions[] when
        // TAPE_PARALLEL=true (currently absent in dev), else local compute via
        // the shared executor over loadLocalContextFromCache().
        //
        // Stage interlock is an ONLINE-only QA gate (commit d8afc02). Offline at
        // a gated stage (WASH_OUT / DRY_OUT) the cached server tape has the
        // advance stripped (only TERMINATE_CYCLE left), which would block the
        // offline op the replay would have exempted — so drop the stale stripped
        // tape and recompute locally. Online keeps respecting the live stripped
        // tape. (Same rationale as buildOfflineState above.)
        const itemGated = !online && !!cachedState.stageLookup?.[currentLifecycle ?? '']?.interlockGated;
        let itemActions = await getCurrentActions(item.filterId, itemGated ? null : cachedState.actions);
        // Offline at START (fail CLOSED, 2026-10-22): a checklist this tablet
        // cannot read is dropped from the tape, and the replay exempts it.
        if (!online && cycleInProgress && !currentLifecycle) {
          const refusal = await offlineStartRefusal(cachedState, cachedState.currentCycle?.id ?? cached?.currentCycleId ?? null);
          if (refusal) {
            failed.push(`${item.filterName}: ${refusal}`);
            continue;
          }
        }

        const runGate = () => validateOfflineGate({
          activeStageKey: activeStage.key,
          activeStageLabel: activeStage.label,
          online,
          currentLifecycle,
          actions: itemActions,
          hasGraph: !!cachedState.pipelineGraph?.stages,
          hasLinearPipeline: (cachedState.pipelineStages?.length ?? 0) > 0,
          pipelineGraph: cachedState.pipelineGraph,
          cycleInProgress,
          // Phase 8.7 cutover: derive checklist-pending from the resolved
          // tape rather than the deprecated cached pendingChecklist field.
          // itemActions is the executor-resolved tape for this filter.
          hasPendingChecklist: hasActionKind(itemActions, 'SUBMIT_CHECKLIST'),
          dryerReadingsSubmitted: cachedState.currentCycle?.dryerReadingsSubmitted,
          dryerStartedAt: cachedState.currentCycle?.dryerStartedAt ?? null,
          dryerDurationMinutes: cachedState.currentCycle?.dryerDurationMinutes ?? null,
          homeBlockId: cachedState.homeBlock?.id,
          blockChangeStatus: cachedState.blockChangeStatus,
          selectedBlockId: selectedBlock?.id,
          replacementBlocked: blockedIds.has(item.filterId),
        });
        let gate = runGate();
        // OQ-02 (2026-10-19): ONLINE at an interlock-gated stage the server tape
        // has the advance stripped while the approval is outstanding, so the
        // gate refuses with a generic line. The cached row cannot say why -
        // cacheServerStateResponse does not persist `interlock` - so read the
        // live state for THIS refused filter only (no extra call for a filter
        // the gate lets through). Approved since the cache was written: carry
        // on with the fresh state. Still held: say who must approve it.
        if (!gate.ok && online && cycleInProgress && cachedState.stageLookup?.[currentLifecycle ?? '']?.interlockGated) {
          try {
            const fresh = await apiClient.get<any>(
              `/api/filters/${item.filterId}/current-state${selectedBlock?.id ? `?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}` : ''}`,
            );
            const held = blockingInterlock(fresh);
            if (held) {
              noteInterlock(held);
              failed.push(interlockRefusalLine(item.filterName, held));
              continue;
            }
            if (fresh) {
              await cacheServerStateResponse(item.filterId, fresh);
              cachedState = fresh;
              itemActions = await getCurrentActions(item.filterId, cachedState.actions);
              gate = runGate();
            }
          } catch { /* transient read failure - report the gate's own reason below */ }
        }
        if (!gate.ok) {
          failed.push(`${item.filterName}: ${gate.reason}`);
          continue;
        }
        // OFFLINE cross-block: never blocks (per config) — informational notice + proceed.
        // NONE mode shows nothing at all (no check, no notice).
        if (!online && blockChangeMode !== 'NONE' && cachedState.homeBlock?.id && selectedBlock?.id && cachedState.homeBlock.id !== selectedBlock.id) {
          setSuccess(`Note: ${item.filterName} belongs to ${cachedState.homeBlock.name}, not ${selectedBlock.name}. Recorded offline.`);
        }

        // 2026-06-06 cross-block gate (queue/"Submit All" path). A filter being
        // cleaned in a block other than its home, with no standing approval,
        // gets the Request-Block-Change dialog. The queue path once lacked this
        // gate, so it submitted cross-block ops blindly: start-cycle was rejected
        // (409 BLOCK_CHANGE_REQUIRED) and the follow-on advance then surfaced
        // "No active cleaning cycle". So: open the approval popup and STOP — do
        // NOT start/advance. Online only
        // (offline cross-block is already caught by validateOfflineGate above).
        // Same-block / already-approved (MATCH / APPROVED) fall straight through
        // — normal cleaning is unaffected.
        //
        // Perf (2026-07-09): when this filter's cached home block IS the selected
        // block, it can never be a cross-block op, so the approval status can't be
        // CONFIRM/REQUIRED — skip the whole per-filter /current-state round-trip.
        // In the common batch workflow (operator scans filters belonging to the
        // block they picked) this eliminates one serial network call per filter,
        // roughly halving online submit time for 50–100 tags. Cold cache
        // (homeBlock unknown) falls through to the GET, unchanged.
        const sameHomeBlock =
          !!cachedState.homeBlock?.id && cachedState.homeBlock.id === selectedBlock?.id;
        if (online && selectedBlock?.id && !sameHomeBlock) {
          let bcStatus: string | null | undefined = cachedState.blockChangeStatus;
          let homeBlk: { id: string; name: string } | null | undefined = cachedState.homeBlock;
          // Refresh against the SELECTED block — the cached status may have been
          // primed without a cleaningAreaId and so wouldn't reflect this block.
          try {
            const cs = await apiClient.get<any>(`/api/filters/${item.filterId}/current-state?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}`);
            bcStatus = cs?.blockChangeStatus ?? bcStatus;
            homeBlk = cs?.homeBlock ?? homeBlk;
          } catch { /* fall back to cached values on a transient read failure */ }
          if ((bcStatus === 'CONFIRM' || bcStatus === 'REQUIRED') && homeBlk?.id && !ackedBlockFiltersRef.current.has(item.filterId)) {
            core.dispatch({
              type: 'open_block_change',
              filterId: item.filterId,
              filterName: item.filterName,
              homeBlockId: homeBlk.id,
              homeBlockName: homeBlk.name,
              requestedBlockId: selectedBlock.id,
              requestedBlockName: selectedBlock.name,
            });
            setBlockChangeReason('');
            clearSubmittedFromQueue(heldBack);
            setLoading(false);
            return;
          }
        }
        // 2026-05-20: batch cycle-start. When any queued filter has no
        // active cycle, open the reason dialog for the FIRST such filter
        // and stash the rest in remainingBatch. On equipment-readings
        // submit, the handler will iterate remainingBatch and apply the
        // SAME reason + equipment readings to each — one reason dialog,
        // one equipment dialog, N cycle-starts. Pre-fix this case fell
        // through to "use single scan" for queue.length > 1, blocking
        // common batch workflows where operators scan multiple filters
        // for a fresh cycle (typical: Wash In on shift start).
        if (!cycleInProgress) {
          // Build the remainingBatch from ALL queued items after this one
          // — they share the reason + equipment dialog values when they
          // are all cycle-start candidates.
          const startIdx = batchQueue.findIndex(q => q.filterId === item.filterId);
          const rest = startIdx >= 0
            ? batchQueue.slice(startIdx + 1).filter(q => !heldBack.has(q.filterId)).map(q => ({ filterId: q.filterId, filterName: q.filterName }))
            : [];
          core.dispatch({
            type: 'open_reason',
            filterId: item.filterId,
            filterName: item.filterName,
            stage: activeStage.key,
            remainingBatch: rest.length > 0 ? rest : undefined,
          });
          // PM-due (server's isPmDue + pmReasonKey, kept in the cached state):
          // the first filter decides for the batch, as on the desktop page.
          const pmDue = !!(cachedState.isPmDue && cachedState.pmReasonKey);
          setSelectedReason(pmDue ? cachedState.pmReasonKey : '');
          setPmReasonDue(pmDue);
          setJustification('');
          // Drop the queue — the reason dialog (carrying remainingBatch)
          // drives the rest of the flow. Equipment-submit will iterate.
          reasonQueueRowsRef.current = batchQueue.slice();
          clearSubmittedFromQueue(heldBack);
          setLoading(false);
          return;
        }

        // Issue #4 fix (2026-05-18): DRY_IN advance requires dryerAction +
        // dryerDurationMinutes when the dryer hasn't been started yet for this
        // cycle. The batch path used to fire a plain advance which the server
        // then rejected at replay time, leaving the cycle stuck. It now sends
        // SET_DURATION with the queue header's duration (below).
        // 2026-05-20 PRE-ADVANCE CHECKLIST FIX: ANY queued filter (not just
        // DRY_IN entry) may have a pending checklist that the server enforces
        // before allowing advance. The batch
        // loop previously relied on the post-loop findNextPendingChecklist
        // which calls the resolver WITHOUT serverActions — fallback path
        // uses local cache, which may be stale on fresh ops. Result:
        // multi-scan never opened the checklist dialog while single-scan
        // worked. Dispatch the dialog HERE using itemActions (fresh
        // server-resolved tape for THIS filter) and stash the rest of the
        // queue as remainingBatch — same continuation flow checklist dialog
        // already supports.
        if (hasActionKind(itemActions, 'SUBMIT_CHECKLIST')) {
          // 2026-10-22: a checklist pending at the cycle's CURRENT stage is
          // answered only at that stage's station or the next one — never at
          // any station (lib/filter-ops/checklist-station.ts). A cycle parked
          // at Storage Out, scanned at Wash In, used to get its final checklist
          // here, and submitting it completed the old cycle. Online and offline
          // alike: nothing is opened or queued.
          const checklistAt = pendingChecklistStage(itemActions) ?? currentLifecycle;
          const where = checklistMayBeAnsweredAt(activeStage.key, checklistAt, cachedState.stageLookup, item.filterName, cachedState.pipelineGraph);
          if (!where.ok) {
            stationRefused.add(item.filterId);
            failed.push(where.reason);
            continue;
          }
          const dialogChecklists = await resolvePendingChecklistDialog(item.filterId, itemActions);
          if (dialogChecklists && dialogChecklists.length > 0) {
            // 2026-05-26: unified-batch — collect EVERY queued filter that is
            // at the same checklist gate so the operator answers once. The
            // current item is always included; downstream queue items are
            // included when their tape also has SUBMIT_CHECKLIST against the
            // same checklistProfileId set (same block + same profile = same
            // gate, which is the operator's expectation).
            const sigOf = (rows: any[]) =>
              rows.map((r: any) => `${r.checklistProfileId}@${r.profileVersion ?? 0}`).sort().join('|');
            const primarySig = sigOf(dialogChecklists);
            const batchMembers: Array<{ filterId: string; filterName: string }> = [
              { filterId: item.filterId, filterName: item.filterName },
            ];
            const startIdx = batchQueue.findIndex(q => q.filterId === item.filterId);
            const downstream = startIdx >= 0 ? batchQueue.slice(startIdx + 1) : [];
            for (const q of downstream) {
              try {
                const cs = await getCache<any>(`filter-state-${q.filterId}`) ?? {};
                // Offline interlock exemption (commit d8afc02) — drop the stale
                // gate-stripped server tape so a gated downstream filter still
                // recomputes its real (interlock-free) tape locally.
                const qGated = !online && !!cs.stageLookup?.[cs.currentState ?? '']?.interlockGated;
                const qActions = await getCurrentActions(q.filterId, qGated ? null : cs.actions);
                if (!hasActionKind(qActions, 'SUBMIT_CHECKLIST')) continue;
                // Same station rule for every member: one refused here is
                // refused on its own turn of the loop, with the reason.
                if (!checklistMayBeAnsweredAt(activeStage.key, pendingChecklistStage(qActions) ?? cs.currentState ?? null, cs.stageLookup, q.filterName, cs.pipelineGraph).ok) continue;
                const qChecklists = await resolvePendingChecklistDialog(q.filterId, qActions);
                if (!qChecklists || qChecklists.length === 0) continue;
                if (sigOf(qChecklists) === primarySig) {
                  batchMembers.push({ filterId: q.filterId, filterName: q.filterName });
                }
              } catch { /* skip — unresolved filters fall back to single-mode */ }
            }
            // AHU pre-flight BEFORE the (terminal) checklist opens.
            if ((await gateAhuBeforeChecklist(batchMembers.map(m => m.filterId))) === 'blocked') {
              setLoading(false);
              return;
            }
            setPendingBatch(batchMembers);
            setChecklistStage(checklistAt);
            core.dispatch({
              type: 'open_checklist',
              filterId: item.filterId,
              filterName: batchMembers.length > 1 ? `${batchMembers.length} filter(s)` : item.filterName,
              checklists: dialogChecklists,
            });
            setChecklistAnswers({});
            // 2026-05-20: KEEP scanQueue + dryerDurations populated so that
            // after the checklist dialog walks the batch and closes, the
            // useEffect watcher below can re-trigger handleSubmitQueue and
            // fire SET_DURATION for each queued filter (the gate is now
            // cleared post-checklist). Pre-fix we cleared the queue here,
            // which dropped the durations on the floor and left the
            // operator with no countdowns after batch checklist completion.
            setLoading(false);
            pendingBatchReplayRef.current = true;
            return;
          }
        }

        if (activeStage.key === 'DRY_IN') {
          const cyc = cachedState.currentCycle ?? {};
          const dryerStarted = !!cyc.dryerStartedAt && !!cyc.dryerDurationMinutes;
          if (!dryerStarted) {
            // 2026-05-20 PER-FILTER DURATION: each queued filter has its own
            // duration dropdown rendered inline in the queue list. The user
            // selects per-filter, then a single Submit-All drives the batch.
            // We get here only when handleSubmitQueue is called with at least
            // one filter still missing a duration — surface a clear error.
            const dur = dryerDurations[item.filterId];
            if (!dur) {
              failed.push(`${item.filterName}: pick a dryer duration in the queue row first`);
              continue;
            }
            // Task 3 (online): accumulate the SET_DURATION advance into the batch
            // instead of firing core.advance per-filter. Mirrors the offline
            // core.advance payload below exactly (targetState/cleaningAreaId/
            // dryerAction/dryerDurationMinutes/remarks) + the tapeVersion that
            // executeOrQueue would have merged from the cached filter-state row.
            // `skipChecklistDispatch` is a client-only dialog-control flag (not a
            // server field) so it's intentionally omitted. The post-loop
            // runBulkOnline dispatch owns successCount / setRecentOps /
            // serverActionsByFilter for these.
            if (online) {
              bulkOps.push({
                clientOpId: crypto.randomUUID(),
                filterId: item.filterId,
                kind: 'advance',
                payload: {
                  targetState: 'DRY_IN',
                  cleaningAreaId: selectedBlock?.id,
                  dryerAction: 'SET_DURATION',
                  dryerDurationMinutes: dur,
                  remarks: remarks || `Dryer started (${dur} min) - ${item.filterName}`,
                  ...(typeof cachedState.tapeVersion === 'number' ? { tapeVersion: cachedState.tapeVersion } : {}),
                },
              });
              continue;
            }
            // Has duration: fire the SET_DURATION advance for this filter. (The
            // tablet has no per-filter Set-Dryer-Duration dialog: the duration
            // comes from the queue header, one for the whole selection.)
            try {
              // 2026-05-26: skip the in-core dispatch entirely for
              // multi-filter DRY_IN SET_DURATION. The post-loop unified-
              // batch dispatch below groups every filter with a pending
              // gate into ONE dialog (filterName="N filter(s)") so the
              // operator answers once, then handleChecklistSubmit's batch
              // branch loops core.submitChecklist for each. If we let
              // core.advance dispatch per-filter inside the loop, filter
              // 2's dispatch trips assertOpenable on filter 1's
              // awaiting_checklist state. Also stash server actions so
              // the post-loop resolver uses authoritative server tape.
              const dryerRes = await core.advance({
                filterId: item.filterId,
                filterName: item.filterName,
                targetState: 'DRY_IN',
                cleaningAreaId: selectedBlock?.id,
                dryerAction: 'SET_DURATION',
                dryerDurationMinutes: dur,
                remarks: remarks || `Dryer started (${dur} min) - ${item.filterName}`,
                skipChecklistDispatch: true,
              });
              const dryerExec = dryerRes.executed;
              if (dryerExec && Array.isArray((dryerRes.result as any)?.actions)) {
                serverActionsByFilter.set(item.filterId, (dryerRes.result as any).actions);
              }
              setRecentOps(prev => [{ stage: 'Dryer Started', filter: item.filterName, time: formatTime(new Date()), queued: !dryerExec }, ...prev].slice(0, 200));
              // 2026-05-20 explicit IDB filters-store write — guarantees the
              // Currently Drying panel sees DRY_IN for this filter regardless
              // of whether core.advance's recomputeAndCacheFilterState ran
              // (it only runs on the offline-queued path; the online path
              // skips it). Without this, online batch dryer-start populated
              // the panel only after the next SWR refresh (15s polling
              // window) — operator saw nothing immediately.
              try {
                const { updateFilterStateLocally } = await import('@/lib/offline-store');
                await updateFilterStateLocally(item.filterId, 'DRY_IN', false);
              } catch { /* IDB write failure is non-fatal; SWR mutate is the fallback */ }
              // Cache the dryer timing + the equipment group (offline Dry Out and the
              // drying panel read them; recomputeAndCacheFilterState does not).
              try {
                const cached = await getCache<any>(`filter-state-${item.filterId}`) ?? {};
                let eqGroup = cached.equipmentGroup ?? null;
                if (!eqGroup && selectedBlock?.id) {
                  const allGroups = await getCache<any[]>('equipment-groups') ?? [];
                  const blockGroups = allGroups.filter((g: any) => g.blockId === selectedBlock.id);
                  if (blockGroups.length === 1) eqGroup = blockGroups[0];
                }
                cache(`filter-state-${item.filterId}`, {
                  ...cached,
                  currentState: 'DRY_IN',
                  equipmentGroup: eqGroup,
                  currentCycle: {
                    ...(cached.currentCycle ?? {}),
                    status: 'IN_PROGRESS',
                    dryerDurationMinutes: dur,
                    dryerStartedAt: new Date().toISOString(),
                    cleaningAreaId: selectedBlock?.id ?? cached.currentCycle?.cleaningAreaId ?? null,
                  },
                }, 24 * 60 * 60 * 1000);
              } catch { /* ignore cache errors */ }
              successCount++;
            } catch (e: any) {
              failed.push(`${item.filterName}: ${e?.message ?? 'dryer start failed'}`);
            }
            continue;
          }
        }

        // Task 3 (online): accumulate the mid-cycle advance into the batch
        // instead of calling executeOrQueue per-filter. The payload mirrors the
        // offline executeOrQueue call below exactly (targetState/cleaningAreaId/
        // remarks) plus the tapeVersion executeOrQueue would have merged from the
        // cached filter-state row (only when it is a number — same guard as
        // use-offline.ts). Post-loop runBulkOnline owns successCount /
        // setRecentOps / serverActionsByFilter for these.
        // Dialog-first for the batch (2026-07-16). Resolve THIS filter's
        // post-stage checklist BEFORE the advance is dispatched. If one fires,
        // park the advance instead of sending it: the dialog opens after the
        // loop and each parked advance commits atomically with the answers as a
        // single `advance-with-checklist` item. Pre-fix, all N advances were
        // dispatched here and only THEN did the dialog open — an operator who
        // closed it left N committed stage transitions whose mandatory
        // checklists were never answered.
        //
        // Empty => no checklist here, or it couldn't be resolved. Both fall
        // through to the unchanged path below; the server re-validates either
        // way, and the post-loop resolver still catches the latter case.
        const advancePayload = {
          targetState: activeStage.key,
          cleaningAreaId: selectedBlock?.id,
          remarks: remarks || `${activeStage.label} - ${item.filterName}`,
          // Operator's A/B/All pick from the AHU pre-flight before this loop.
          // Only set when this advance completes the cycle; scopes the server
          // INTERLOCK gate to the roster the popup showed (mirrors the
          // submit-checklist payload). Absent when the pre-flight didn't run.
          ...(ahuSetChoiceRef.current ? { filterSet: ahuSetChoiceRef.current } : {}),
          // Readings collected once for the queue (see stageReadings above).
          ...(stageReadings ? { equipmentGroupId: stageReadings.equipmentGroupId, instrumentReadings: stageReadings.instrumentReadings } : {}),
        };
        const preChecklists = await resolveChecklistForTargetStage(
          item.filterId,
          activeStage.key,
          online,
        );
        if (preChecklists.length > 0) {
          deferredAdvances.set(item.filterId, {
            item: { filterId: item.filterId, filterName: item.filterName },
            payload: advancePayload,
            checklists: preChecklists,
          });
          continue;
        }

        if (online) {
          bulkOps.push({
            clientOpId: crypto.randomUUID(),
            filterId: item.filterId,
            kind: 'advance',
            payload: {
              ...advancePayload,
              ...(typeof cachedState.tapeVersion === 'number' ? { tapeVersion: cachedState.tapeVersion } : {}),
            },
          });
          continue;
        }
        const { executed, result } = await executeOrQueue('advance', item.filterId, item.filterName, {
          ...advancePayload,
        }, activeStage.key);
        if (!executed) {
          // Perf (2026-07-09): recompute this filter's cache row per item, but do
          // NOT refreshOfflineData() here. That call re-reads the whole IDB
          // filter store and setState-repaints the entire filter list; firing it
          // once per queued tag meant 50–100 full re-renders for an offline
          // batch. A single refreshOfflineData() after the loop (below) repaints
          // everything once.
          await recomputeAndCacheFilterState(item.filterId, activeStage.key, false, selectedBlock?.id ?? null);
        }
        // 2026-05-26: stash server tape so post-loop dispatch passes the
        // authoritative actions to resolvePendingChecklistDialog. The
        // earlier code relied solely on local recompute which was failing
        // for mid-cycle advances on profiles where every stage has a
        // checklist gate (the cache row's pendingChecklist field gets
        // clobbered by the trailing per-filter /current-state prime).
        if (executed && Array.isArray(result?.actions)) {
          serverActionsByFilter.set(item.filterId, result.actions);
        }
        successCount++;
        setRecentOps(prev => [{ stage: activeStage.key, filter: item.filterName, time: formatTime(new Date()), queued: !executed }, ...prev].slice(0, 200));
      } catch (e: any) {
        // Deep-review fix D6 (2026-05-17): REAUTH errors must NOT be swallowed
        // into the per-filter failure list — the reauth dialog needs to stay
        // open with the inline "Incorrect password" message and let the
        // operator retry, instead of closing on a generic batch-failure popup.
        // The two shapes (`.error` from REAUTH_REQUIRED / REAUTH_FAILED raw
        // re-throws in api-client.ts:67, `.code` from the constructed-Error
        // branch at line 104) cover both paths. Matches desktop L820-832.
        const errCode = e?.error ?? e?.code;
        if (errCode === 'REAUTH_FAILED' || errCode === 'REAUTH_REQUIRED') {
          throw e;
        }
        // Also let offline-cache recompute failures escape so the operator
        // sees a clear "offline state corrupted" error instead of silently
        // proceeding against stale cache (see D3b in offline-cache.ts).
        if (errCode === 'OFFLINE_CACHE_RECOMPUTE_FAILED') {
          throw e;
        }
        failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
        // B3/C2: record failures too so they render in the Failure section.
        setRecentOps(prev => [{ stage: activeStage.key, filter: item.filterName, time: formatTime(new Date()), status: 'failed' as const, msg: e.message ?? 'failed' }, ...prev].slice(0, 200));
      }
    }
    // Task 3: dispatch every ONLINE advance accumulated above in ONE
    // /bulk-operate POST (one reauth prompt for the whole batch). Runs AFTER the
    // loop but BEFORE the post-loop checklist dispatch, and feeds
    // serverActionsByFilter from the response so that block keeps working
    // unchanged. A wholesale transport failure keeps the scanQueue intact for
    // retry (per-item STALE_TAPE/validation failures surface as `failures`).
    if (online && bulkOps.length > 0) {
      const out = await runBulkOnline(bulkOps, withStageAction(['ADVANCE_FILTER_STAGE'], batchTargetState(bulkOps)));
      if (out === 'cancelled') return; // operator declined reauth — keep queue, no error banner
      if (out === 'transport_error') {
        setError('Could not reach the server to submit the batch. Please try Submit again.');
        return; // keep scanQueue intact for retry — do NOT clear it (finally clears loading)
      }
      successCount += out.okCount;
      for (const [fid, actions] of out.actionsByFilter) serverActionsByFilter.set(fid, actions);
      for (const r of out.results) {
        // Surface the operator-facing filter NAME (not the raw UUID) in both the
        // recent-ops list and the failure banner, matching every other message
        // in this handler. BulkClientItem carries no name, so map via the queue.
        const fname = scanQueueSnapshot.find(q => q.filterId === r.filterId)?.filterName ?? r.filterId;
        if (r.status === 'ok') {
          // DRY_IN SET_DURATION entries read as "Dryer Started" like every other
          // dryer-start path (offline batch + single) so the recent-ops icon +
          // per-stage list stay consistent online and offline.
          const op = bulkOps.find(o => o.filterId === r.filterId);
          const stageLabel = op?.payload?.dryerAction === 'SET_DURATION' ? 'Dryer Started' : activeStage.key;
          setRecentOps(prev => [{ stage: stageLabel, filter: fname, time: formatTime(new Date()), queued: false, status: 'ok' as const }, ...prev].slice(0, 200));
        } else {
          failed.push(`${fname}: ${r.error?.message ?? 'failed'}`);
          // OQ-02: the server's interlock refusal (423). Its message already
          // names the approver role; the banner reads the live state once, for
          // the first such filter only.
          if (!interlockHit && INTERLOCK_REFUSAL_CODES.has(r.error?.code ?? '')) {
            try {
              const held = blockingInterlock(await apiClient.get<any>(`/api/filters/${r.filterId}/current-state`));
              if (held) noteInterlock(held);
            } catch { /* the failure line above already carries the reason */ }
          }
          // B3/C2: record failures too so they render in the Failure section.
          setRecentOps(prev => [{ stage: activeStage.key, filter: fname, time: formatTime(new Date()), status: 'failed' as const, msg: r.error?.message ?? 'failed' }, ...prev].slice(0, 200));
        }
      }
    }
    // Offline parity: if any advanced item now has a pending checklist (per
    // the cleaning profile), open the dialog for the FIRST such filter and
    // stash the rest of the batch in `pendingChecklistBatch`. The cycle is
    // resumed inside `handleChecklistSubmit` after each successful submit.
    //
    // Pre-fix bug (PHASE_5_RECENT_WORK.md § 11, session 04-20): the original
    // `for…break` opened the dialog for the first matching filter and then
    // never iterated to the rest of the batch — every other pending filter
    // silently skipped the checklist gate.
    // 2026-05-20: open the checklist dialog whenever ANY queued filter has
    // a pending checklist — not just when at least one advance succeeded.
    // Pre-fix the gate was `if (successCount > 0)`, which meant batch-DRY_IN
    // submits where ALL filters needed a pre-DRY_IN checklist (every one
    // pushed to `failed` with "checklist required first") never opened the
    // dialog. Operator only saw the error toast and couldn't proceed.
    // 2026-07-16: dialog-first batch. Any filter whose advance was PARKED gets
    // its dialog opened here with nothing written yet. This runs BEFORE the
    // legacy post-advance resolver below and returns, because the two are
    // mutually exclusive: a parked filter has no committed advance for that
    // resolver to find, and dispatching twice would trip assertOpenable.
    if (deferredAdvances.size > 0) {
      const sigOfDeferred = (rows: any[]) =>
        rows.map((r: any) => `${r.checklistProfileId}@${r.profileVersion ?? 0}`).sort().join('|');
      // Same grouping rule as the legacy path: ONE dialog for the largest
      // same-signature group so the operator answers identical checklists once.
      const groups = new Map<string, Array<{ filterId: string; filterName: string }>>();
      for (const [, d] of deferredAdvances) {
        const sig = sigOfDeferred(d.checklists);
        const arr = groups.get(sig) ?? [];
        arr.push(d.item);
        groups.set(sig, arr);
      }
      let chosen: Array<{ filterId: string; filterName: string }> = [];
      for (const arr of groups.values()) {
        if (arr.length > chosen.length) chosen = arr;
      }
      // Filters in a SMALLER signature group are neither advanced nor parked —
      // they stay in the scan queue for a re-submit, matching the legacy path's
      // "the rest can be triggered on the next scan" behaviour.
      const primary = deferredAdvances.get(chosen[0].filterId)!;
      // AHU pre-flight BEFORE the (terminal) checklist opens. Dialog-first means
      // NOTHING is written yet, so the filter is still at the previous stage —
      // the gate must test the TARGET stage, not `currentState`. Using the
      // current-state variant here is exactly what silently disabled the popup
      // at Storage Out after 2026-07-16.
      if ((await gateAhuBeforeDeferredChecklist(chosen.map(m => m.filterId), activeStage.key)) === 'proceed') {
        const parked = new Map<string, { targetState: string; payload: Record<string, unknown> }>();
        for (const m of chosen) {
          const d = deferredAdvances.get(m.filterId)!;
          parked.set(m.filterId, { targetState: activeStage.key, payload: d.payload });
        }
        setPendingBatch(chosen);
        setPendingBatchDeferred(parked);
        core.dispatch({
          type: 'open_checklist',
          filterId: primary.item.filterId,
          filterName: chosen.length > 1 ? `${chosen.length} filter(s)` : primary.item.filterName,
          checklists: primary.checklists,
        });
        setChecklistAnswers({});
      }
      // Keep ONLY the parked filters in the queue. They were NOT advanced, so if
      // the operator closes the dialog nothing was written and the queue must
      // survive for a retry rather than making them re-scan 50-100 tags. The
      // checklist submit clears it.
      //
      // Mixed batch: filters that DID advance (bulkOps above) must be dropped —
      // leaving them in would let a re-submit advance them a second time.
      setScanQueue(prev => prev.filter(q => deferredAdvances.has(q.filterId) || !submittedIds.has(q.filterId)));
      setDryerDurations({});
      setRemarks('');
      if (successCount > 0) setSuccess(`${successCount} filter(s) → ${activeStage.label}${failed.length > 0 ? ` (${failed.length} failed)` : ''}`);
      if (failed.length > 0) setError(failed.join('\n'));
      if (online) await mutate('/api/assets/instances', undefined, { revalidate: true });
      refreshOfflineData();
      // Skip the legacy post-advance resolver + the unconditional queue clear.
      // eslint-disable-next-line no-useless-return
      return;
    }

    if (successCount > 0 || failed.length > 0) {
      try {
        // 2026-05-26: unified-batch post-advance dialog dispatch. Replaces the
        // per-filter cycling via `findNextPendingChecklist`+`remainingBatch`
        // (which made the operator re-answer the same checklist N times for
        // a same-block batch). Walk every filter that landed on a checklist
        // gate, group by signature, dispatch ONE dialog for the largest
        // group. Same answers POSTed to each member of the group on submit
        // (see handleChecklistSubmit batch branch).
        const sigOf = (rows: any[]) =>
          rows.map((r: any) => `${r.checklistProfileId}@${r.profileVersion ?? 0}`).sort().join('|');
        type Pending = { item: { filterId: string; filterName: string }; checklists: any[]; signature: string };
        const pending: Pending[] = [];
        for (const q of scanQueueSnapshot) {
          // 2026-05-26: skip filters whose dialog was already dispatched
          // by core.advance/startAndAdvance inside the loop (e.g. DRY_IN
          // SET_DURATION path). A second open_checklist from awaiting_
          // checklist trips assertOpenable.
          if (dialogDispatchedInLoop.has(q.filterId)) continue;
          if (stationRefused.has(q.filterId)) continue;
          try {
            // 2026-05-26: prefer server tape captured during the inner-loop
            // advance over a cache-driven local recompute. The local path
            // is fragile because the per-filter /current-state prime fires
            // AFTER this dispatch and overwrites the cache with the raw
            // response (which has no pendingChecklist field). Server tape
            // is authoritative.
            const serverActions = serverActionsByFilter.get(q.filterId);
            // A filter that did not advance here still sits at its own stage:
            // its pending checklist follows the same station rule.
            if (!serverActions) {
              const qs = await getCache<any>(`filter-state-${q.filterId}`) ?? {};
              const qAt = pendingChecklistStage(await getCurrentActions(q.filterId, qs.actions)) ?? qs.currentState ?? null;
              if (!checklistMayBeAnsweredAt(activeStage.key, qAt, qs.stageLookup, q.filterName, qs.pipelineGraph).ok) continue;
            }
            const checklists = await resolvePendingChecklistDialog(q.filterId, serverActions ?? undefined);
            if (checklists && checklists.length > 0) {
              pending.push({
                item: { filterId: q.filterId, filterName: q.filterName },
                checklists,
                signature: sigOf(checklists),
              });
            }
          } catch { /* per-filter resolver failure shouldn't poison the batch */ }
        }
        if (pending.length > 0) {
          // Pick the largest same-signature group; the rest (mixed signature
          // case) can be triggered on the next scan if they need attention —
          // matches today's "re-scan to retry" muscle memory.
          const groups = new Map<string, Pending[]>();
          for (const p of pending) {
            const arr = groups.get(p.signature) ?? [];
            arr.push(p);
            groups.set(p.signature, arr);
          }
          let chosen: Pending[] = [];
          for (const arr of groups.values()) {
            if (arr.length > chosen.length) chosen = arr;
          }
          const primary = chosen[0];
          const batchMembers = chosen.map(p => p.item);
          // AHU pre-flight BEFORE the (terminal) checklist opens.
          if ((await gateAhuBeforeChecklist(batchMembers.map(m => m.filterId))) === 'proceed') {
            setPendingBatch(batchMembers);
            core.dispatch({
              type: 'open_checklist',
              filterId: primary.item.filterId,
              filterName: batchMembers.length > 1 ? `${batchMembers.length} filter(s)` : primary.item.filterName,
              checklists: primary.checklists,
            });
            setChecklistAnswers({});
          }
        }
      } catch { /* ignore — user can re-scan to trigger */ }
    }
    clearSubmittedFromQueue(heldBack);
    // B1 (2026-07-10): clear the remarks box after a stage submit completes so the
    // note doesn't linger and get silently reused on the operator's next op (which
    // also surfaced as a checklist-gated advance carrying stale remarks).
    setRemarks('');
    if (successCount > 0) setSuccess(`${successCount} filter(s) → ${activeStage.label}${failed.length > 0 ? ` (${failed.length} failed)` : ''}`);
    if (failed.length > 0) setError(failed.join('\n'));
    // 2026-05-20: refresh BOTH the SWR cache (so allFilters sees the new
    // currentLifecycleState) AND the offline filter cache (so the
    // Currently Drying panel populates immediately for batch dryer-start
    // on DRY_IN stage). Pre-fix: tablet running offline after batch submit
    // didn't see the panel until the next reload because offlineFilters
    // was stale; the per-filter cache write was correct but allFilters
    // doesn't pull from there.
    //
    // Task 3: the old per-filter /current-state prime is gone. Each ok filter's
    // filter-state cache was already written from its server snapshot inside
    // runBulkOnline (the bulk snapshot IS the /current-state response — the
    // service returns getCurrentState(...) for each ok item), so re-fetching
    // /current-state per filter would be redundant work + a rate-limit risk.
    // Just force a hard revalidation of the instances list so allFilters sees
    // the new lifecycle states.
    if (online) await mutate('/api/assets/instances', undefined, { revalidate: true });
    refreshOfflineData();
    } catch (e: any) {
      // REAUTH bubbled out of the inner loop — the reauth dialog stays open
      // (managed by useReauth at the executeOrQueue site). Surface a clear
      // error so the operator knows the batch was interrupted; do NOT
      // pretend successCount items "succeeded" since the queue state is
      // ambiguous (some items may have been advanced, others not).
      const errCode = e?.error ?? e?.code;
      if (errCode === 'REAUTH_REQUIRED' || errCode === 'REAUTH_FAILED') {
        setError('Re-authentication required — please enter your password and re-submit the batch.');
      } else if (errCode === 'OFFLINE_CACHE_RECOMPUTE_FAILED') {
        setError(`Offline state recompute failed: ${e?.message ?? 'unknown'}. Re-scan to refresh the cache before continuing.`);
      } else {
        setError(e?.message ?? 'Batch submission failed');
      }
    } finally {
      setLoading(false);
      // Readings apply to ONE submit of the queue; the next submit asks again.
      if (!queueReadingsModeRef.current) queueReadingsRef.current = null;
      if (profileNotes.length > 0) {
        toast.warning('Cleaning profile changed', `${profileNotes.join('\n')}\nEach cycle finishes on the profile it started with — terminate and restart only to switch.`);
      }
      if (groupNotes.length > 0) {
        toast.warning('Equipment group changed', `${groupNotes.join('\n')}\nReadings still validate against the version each cycle started with.`);
      }
    }
  };

  // The equipment dialog closed without a queue-readings submit (Cancel) - the
  // next Submit must ask again rather than stash into a stale mode.
  useEffect(() => {
    if (core.dialogState.kind !== 'awaiting_equipment') queueReadingsModeRef.current = false;
  }, [core.dialogState.kind]);

  // A START checklist's context lives only while its dialog is open: closed any
  // way (Close, Android back, a refusal), nothing of it is written or kept.
  useEffect(() => {
    if (core.dialogState.kind !== 'awaiting_checklist') startChecklistRef.current = null;
  }, [core.dialogState.kind]);

  // 2026-05-20: batch-replay effect. When handleSubmitQueue's pre-DRY_IN
  // checklist gate opens a dialog, it sets pendingBatchReplayRef=true and
  // keeps scanQueue + dryerDurations populated. core.submitChecklist walks
  // the remaining batch (one dialog per filter that needs a checklist), then
  // closes when remainingBatch is empty (dialogState.kind transitions from
  // awaiting_checklist → none). This effect fires handleSubmitQueue again
  // on that transition — the gate is now cleared, so the loop reaches the
  // SET_DURATION advance for every queued filter.
  useEffect(() => {
    const prev = prevDialogKindRef.current;
    const curr = core.dialogState.kind;
    prevDialogKindRef.current = curr;
    if (
      prev === 'awaiting_checklist' &&
      curr === 'none' &&
      pendingBatchReplayRef.current &&
      scanQueue.length > 0 &&
      !loading
    ) {
      pendingBatchReplayRef.current = false;
      // Defer one tick so dialog close + SWR refresh land before replay.
      setTimeout(() => { handleSubmitQueue(); }, 50);
    }
    // handleSubmitQueue intentionally omitted — the ref guards re-entry and
    // including a function from this same component would force a new
    // closure each render and re-fire the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core.dialogState.kind, scanQueue.length, loading]);

  // SPIS: single-source offline gate. Implementation lives in
  // `apps/web/src/lib/filter-ops/validate-offline-gate.ts`, shared with the
  // desktop page so the two cannot drift. See `feedback_batch_single_parity.md`
  // — desktop's `handleSubmitBatch` previously inlined the same logic; the
  // Phase 8.7 Wave-5 split lifted both copies into one.



  // Pending cycle payload — saved when reason is selected, used by equipment dialog for offline compound queue
  const [pendingCyclePayload, setPendingCyclePayload] = useState<Record<string, any> | null>(null);

  /**
   * Start a cleaning cycle through `run`, answering the missed-PM question when
   * it comes up. ONE implementation for every single-filter start on this page
   * (2026-10-01): the question used to live only in the no-equipment branch of
   * handleReasonSubmit, so a start that went through the Equipment Readings
   * dialog was refused by the server (409 PM_PREVIOUS_TASK_PENDING) with no way
   * to answer it.
   *
   *   offline — there is no 409 to react to, so the question is answered from
   *             the cached map and the reasons ride in the queued payload (the
   *             server exempts offline replay from re-asking);
   *   online  — the server's 409 carries the outstanding visits; ask, then
   *             retry the same start with the answers attached.
   *
   * `cancelled: true` = the operator dismissed the OFFLINE question: nothing was
   * started or queued, and there is no error to show. Dismissing the ONLINE
   * question re-throws the server's refusal, which the caller must display.
   */
  const startWithPmGate = async <T,>(
    filterId: string,
    run: (extraCycleFields: Record<string, any>) => Promise<T>,
  ): Promise<{ cancelled: true } | { cancelled: false; result: T }> => {
    let offlineSkips: Array<{ entryId: string; reason: string }> | null = null;
    if (!online) {
      const cachedPending = await getCachedPendingPmTasksForFilter(filterId);
      if (cachedPending.length > 0) {
        const answers = await askPmSkipReasons(cachedPending, 5);
        if (!answers) return { cancelled: true };
        offlineSkips = answers;
        // Don't ask again for these in the same offline session.
        await forgetCachedPmTasks(answers.map((a) => a.entryId));
      }
    }
    try {
      return { cancelled: false, result: await run(offlineSkips ? { pmSkips: offlineSkips } : {}) };
    } catch (startErr: any) {
      const code = startErr?.error ?? startErr?.code;
      const pending = startErr?.connectionInfo?.pendingPmTasks;
      if (code !== 'PM_PREVIOUS_TASK_PENDING' || !Array.isArray(pending) || pending.length === 0) throw startErr;
      const answers = await askPmSkipReasons(pending, startErr?.connectionInfo?.minReasonLength ?? 5);
      if (!answers) throw startErr; // cancelled — the cleaning does not start
      const result = await run({ pmSkips: answers });
      // Keep the offline map in step with what the server just cleared,
      // otherwise going offline right after would re-ask for the same visits.
      await forgetCachedPmTasks(answers.map((a) => a.entryId));
      return { cancelled: false, result };
    }
  };

  /**
   * Dryer fields for the ADVANCE half of a cycle START whose first stage is
   * DRY_IN (2026-10-06). A profile that begins with Dry In (live "DRY STORAGE")
   * used to start straight into the stage with no duration: every start payload
   * on this page was built without dryer fields, the server accepted the entry,
   * and the dryer phase was skipped silently. The duration comes from the queue
   * header (ONE value for the selection, mirrored per filter in `dryerDurations`
   * when the row was scanned on the Dry In stage). Empty for any other stage.
   */
  const dryerFieldsForStart = (stage: string, filterId: string): Record<string, any> => {
    if (stage !== 'DRY_IN') return {};
    const minutes = dryerDurations[filterId] ?? dryerBatchDuration;
    return { dryerAction: 'SET_DURATION', dryerDurationMinutes: minutes };
  };

  /**
   * A cycle-start batch split by its checklist BEFORE the first stage (a START
   * checklist, 2026-10-22), decided per filter on its own state and before
   * anything is written. Returns the filters that start as before (their
   * profile has none) in the reason dialog's shape, or null when this submit is
   * the START checklist's: its dialog is open, nothing written. One dialog per
   * distinct START checklist (the largest group); a START-checklist group in a
   * submit that also starts plain filters is asked on its own submit. Every
   * filter left out goes back in the queue, ticked, with the reason. A START
   * checklist is never sent as part of a compound start-and-advance: an offline
   * replay exempts START_CHECKLIST, so it would be skipped silently.
   */
  /**
   * The justification goes only with a reason that requires one (D03-07,
   * 2026-10-22; the server now ignores it otherwise, 5fa2b28): a text typed for
   * such a reason used to ride along after a switch to one that needs none.
   */
  const justificationToSend = (): string | undefined =>
    cleaningReasons.find((r: any) => r.key === selectedReason)?.requiresJustification ? (justification || undefined) : undefined;

  const splitReasonBatchByStartChecklist = async (rdIn: NonNullable<typeof reasonDialog>) => {
    const all = [{ filterId: rdIn.filterId, filterName: rdIn.filterName }, ...(rdIn.remainingBatch ?? [])];
    const states = new Map<string, any>();
    for (const f of all) {
      let st = await getCache<any>(`filter-state-${f.filterId}`).catch(() => null);
      // Online, a filter this tablet never opened is read once (as the scan loop
      // does for the first one) — its profile decides, never another filter's.
      if (online && !st?.pipelineGraph?.stages) {
        try {
          const cs = await apiClient.get<any>(`/api/filters/${f.filterId}/current-state${selectedBlock?.id ? `?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}` : ''}`);
          if (cs) { await cacheServerStateResponse(f.filterId, cs); st = cs; }
        } catch { /* transient read failure — decided on what is cached */ }
      }
      states.set(f.filterId, st);
    }
    // Offline, a filter with no pipeline graph cached cannot tell whether its
    // profile asks a checklist before the first stage — it is not started blind
    // (fail CLOSED: the replay would skip that checklist). Online the server
    // decides the start and refuses the first entry without it.
    const noGraph: LeftItem[] = online ? [] : all
      .filter((f) => states.get(f.filterId) && !states.get(f.filterId)?.pipelineGraph?.stages)
      .map((item) => ({ item, note: 'its cleaning profile is not on this tablet — go online, then submit it again' }));
    const known = all.filter((f) => !noGraph.some((n) => n.item.filterId === f.filterId));
    const stateOf = (id: string) => states.get(id) ?? null;
    // Only a filter with no cycle, whose cleaning can start at this stage, is
    // started: sent to another, the start was written and its entry refused.
    const startable = splitNewCycleBatch(known, stateOf, rdIn.stage, (st) => firstStagesFromGraph(st?.pipelineGraph));
    const plan = await planStartChecklistBatch(startable.ride, stateOf, (id) => resolveStartChecklists(stateOf(id), online));
    const left: LeftItem[] = [...noGraph, ...startable.left, ...plan.left];
    if (plan.none.length > 0) {
      left.push(...plan.ask.map(item => ({ item, note: 'its first checklist is asked on its own — submit it again' })));
    }
    requeueLeft(left);
    // Straight to the message queue: a later message of this submit must not
    // replace it before it renders.
    if (left.length > 0) toast.error('Error', leftInQueueMessage(left));
    if (plan.none.length > 0) {
      const [first, ...others] = plan.none;
      return { ...rdIn, filterId: first.filterId, filterName: first.filterName, remainingBatch: others.length > 0 ? others : undefined };
    }
    core.dispatch({ type: 'close' }); // the reason dialog
    if (plan.ask.length > 0) {
      startChecklistRef.current = {
        stage: rdIn.stage,
        cyclePayload: { cleaningReasonKey: selectedReason, cleaningJustification: justificationToSend(), cleaningAreaId: selectedBlock?.id },
        batch: plan.ask.map(b => ({ filterId: b.filterId, filterName: b.filterName })),
        checklistProfileIds: [...new Set(plan.checklists.map((c: PendingChecklist) => c.checklistProfileId))],
        remarks,
      };
      setPendingBatch(startChecklistRef.current.batch);
      setChecklistStage(null);
      core.dispatch({
        type: 'open_checklist',
        filterId: plan.ask[0].filterId,
        filterName: plan.ask.length > 1 ? `${plan.ask.length} filter(s)` : plan.ask[0].filterName,
        checklists: plan.checklists,
      });
      setChecklistAnswers({});
    }
    return null;
  };

  const handleReasonSubmit = async () => {
    if (!reasonDialog || !selectedReason) return;
    setLoading(true); setError('');
    const rd = await splitReasonBatchByStartChecklist(reasonDialog);
    if (!rd) { setLoading(false); return; }
    const cyclePayload = { cleaningReasonKey: selectedReason, cleaningJustification: justificationToSend(), cleaningAreaId: selectedBlock?.id, acknowledgeBlockChange: ackedBlockFiltersRef.current.has(rd.filterId) };
    const advancePayload = { targetState: rd.stage, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${rd.stage.replace(/_/g, ' ')} - ${rd.filterName}`, ...dryerFieldsForStart(rd.stage, rd.filterId) };

    // Check for equipment groups BEFORE executing — works for both online and offline.
    // No API mutation yet, no reauth needed here.
    if (rd.stage === 'WASH_IN' && selectedBlock?.id) {
      let groups: any[] = [];
      if (online) {
        try { groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${selectedBlock.id}`) ?? []; } catch { /* fall through with empty groups → no equipment dialog */ }
      } else {
        // Offline: use cached equipment groups
        const cachedGroups = await getCache<any[]>('equipment-groups') ?? [];
        groups = cachedGroups.filter((g: any) => g.blockId === selectedBlock.id);
      }
      if (groups.length > 0) {
        // Save the cycle payload — equipment dialog will use it for the compound operation
        // (handleEquipSubmit's `if (pendingCyclePayload)` branch reauth-wraps the actual mutation)
        setPendingCyclePayload(cyclePayload);
        // 2026-05-20: thread the batch list through to equipment dialog so
        // handleEquipSubmit can iterate after the first cycle-start completes.
        const batchRest = rd.remainingBatch;
        core.dispatch({ type: 'close' }); // close reason dialog
        core.dispatch({
          type: 'open_equipment',
          filterId: rd.filterId,
          filterName: rd.filterName,
          stage: rd.stage,
          groups,
          remainingBatch: batchRest,
        });
        setSelectedEquipGroup(null); setReadings({});
        setLoading(false); return;
      }
    }

    // 2026-07-09 fix: multi-filter no-equipment-group batch cycle-start. The
    // single-filter path below only ever started `rd.filterId` and
    // DROPPED `remainingBatch` — so a Wash In batch on a block WITHOUT an
    // equipment group started only the first filter. Handle the whole batch here
    // (mirrors handleEquipSubmit's cycle-start split); the single-filter path
    // below is left untouched.
    const noEqBatch = rd.remainingBatch ?? [];
    if (noEqBatch.length > 0) {
      const allFilters = [{ filterId: rd.filterId, filterName: rd.filterName }, ...noEqBatch];
      const stageLabel = rd.stage.replace(/_/g, ' ');
      const nameById = new Map(allFilters.map(f => [f.filterId, f.filterName]));
      const cycleStartActions = new Map<string, any[]>();
      const advanceFor = (fname: string, fid: string) => ({ targetState: rd.stage, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${stageLabel} - ${fname}`, ...dryerFieldsForStart(rd.stage, fid) });
      try {
        if (online) {
          // ONE /bulk-operate covering every filter (no readings for a
          // no-equipment block). runBulkOnline handles reauth internally.
          const ops: BulkClientItem[] = allFilters.map(f => ({
            clientOpId: crypto.randomUUID(),
            filterId: f.filterId,
            kind: 'start-and-advance' as const,
            cyclePayload,
            advancePayload: advanceFor(f.filterName, f.filterId),
          }));
          const startAction = withStageAction(['START_CLEANING_CYCLE'], batchTargetState(ops));
          const firstOut = await runBulkOnline(ops, startAction);
          if (firstOut === 'cancelled') { setLoading(false); return; }
          if (firstOut === 'transport_error') { setError('Could not reach the server to start the cycles. Please try again.'); setLoading(false); return; }
          const out = await retryBulkStartsForMissedPm(ops, firstOut, startAction);
          for (const [fid, actions] of out.actionsByFilter) cycleStartActions.set(fid, actions);
          for (const r of out.results) {
            if (r.status === 'ok') setRecentOps(prev => [{ stage: rd.stage, filter: nameById.get(r.filterId) ?? r.filterId, time: formatTime(new Date()), queued: false }, ...prev].slice(0, 200));
          }
          const failMsgs = out.results.flatMap(r => r.status === 'failed' ? [`${nameById.get(r.filterId) ?? r.filterId}: ${r.error?.message ?? 'failed'}`] : []);
          if (failMsgs.length > 0) setError(failMsgs.join('; '));
          if (out.okCount > 0) { setSuccess(`Started ${out.okCount} cycle(s)`); mutate('/api/assets/instances'); }
        } else {
          // Offline: per-filter start-and-advance, skipping the in-core checklist
          // dispatch so the unified dialog below covers the whole batch. Only the
          // starts that went through are counted; each refusal is listed.
          let queuedCount = 0;
          const failures: string[] = [];
          for (const f of allFilters) {
            try {
              const res = await core.startAndAdvance({
                filterId: f.filterId,
                filterName: f.filterName,
                cyclePayload,
                advancePayload: advanceFor(f.filterName, f.filterId),
                targetState: rd.stage,
                cleaningAreaId: selectedBlock?.id,
                skipChecklistDispatch: true,
              });
              if (res.executed && Array.isArray((res.result as any)?.actions)) cycleStartActions.set(f.filterId, (res.result as any).actions);
              queuedCount++;
              setRecentOps(prev => [{ stage: rd.stage, filter: f.filterName, time: formatTime(new Date()), queued: true }, ...prev].slice(0, 200));
            } catch (e: any) {
              failures.push(`${f.filterName}: ${e?.message ?? 'cycle-start failed'}`);
            }
          }
          if (failures.length > 0) setError(failures.join('; '));
          if (queuedCount > 0) setSuccess(`Queued ${queuedCount} cycle(s)`);
        }
        setScanValue(''); setRemarks('');
        // Unified checklist dispatch — ONE dialog for all same-signature filters
        // (same pattern as handleEquipSubmit). Close the reason dialog otherwise.
        const sigOf = (rows: any[]) => rows.map((r: any) => `${r.checklistProfileId}@${r.profileVersion ?? 0}`).sort().join('|');
        type Pending = { item: { filterId: string; filterName: string }; checklists: any[]; signature: string };
        const pending: Pending[] = [];
        for (const f of allFilters) {
          try {
            const checklists = await resolvePendingChecklistDialog(f.filterId, cycleStartActions.get(f.filterId) ?? undefined);
            if (checklists && checklists.length > 0) pending.push({ item: f, checklists, signature: sigOf(checklists) });
          } catch { /* per-filter resolver failure shouldn't poison the batch */ }
        }
        if (pending.length > 0) {
          const groups = new Map<string, Pending[]>();
          for (const p of pending) { const arr = groups.get(p.signature) ?? []; arr.push(p); groups.set(p.signature, arr); }
          let chosen: Pending[] = [];
          for (const arr of groups.values()) if (arr.length > chosen.length) chosen = arr;
          const primary = chosen[0];
          const batchMembers = chosen.map(p => p.item);
          if ((await gateAhuBeforeChecklist(batchMembers.map(m => m.filterId))) === 'proceed') {
            setPendingBatch(batchMembers);
            core.dispatch({ type: 'open_checklist', filterId: primary.item.filterId, filterName: batchMembers.length > 1 ? `${batchMembers.length} filter(s)` : primary.item.filterName, checklists: primary.checklists });
            setChecklistAnswers({});
          } else {
            core.dispatch({ type: 'close' }); // AHU gate dialog is showing; drop the reason dialog
          }
        } else {
          core.dispatch({ type: 'close' }); // no checklist → close the reason dialog
        }
      } catch (e: any) {
        setError(e?.message ?? 'Failed to start cycles');
        core.dispatch({ type: 'close' });
      }
      setLoading(false);
      return;
    }

    // No equipment groups, SINGLE filter — fire the compound op. START_CLEANING_CYCLE
    // is reauth-gated for ADMIN role; wrap so the password dialog appears.
    // (+ the station row for the first stage, 2026-09-24.)
    await reauth.execute(withStageAction(['START_CLEANING_CYCLE'], rd.stage), async (password?) => {
      const runStart = (extraCycleFields: Record<string, any> = {}) =>
        core.startAndAdvance({
          filterId: rd.filterId,
          filterName: rd.filterName,
          cyclePayload: { ...cyclePayload, ...extraCycleFields },
          advancePayload,
          targetState: rd.stage,
          cleaningAreaId: selectedBlock?.id,
          password,
        });

      // Missed-PM question (offline from the cached map, online from the 409).
      const started = await startWithPmGate(rd.filterId, runStart);
      if (started.cancelled) return; // offline question dismissed — no cycle, nothing queued
      const { executed: cycleExecuted, deferred: cycleDeferred } = started.result;

      // Dialog-first (2026-07-16): the first stage has a mandatory checklist, so
      // NOTHING was written — not even the cycle start. The dialog is open and
      // the whole compound op fires on submit. Reporting "→ stage" / "(queued)"
      // here would claim a cycle + transition that have not happened and that
      // Close discards.
      if (cycleDeferred) {
        setScanValue(''); setRemarks('');
        return;
      }

      const stageLabel = rd.stage.replace(/_/g, ' ');
      setSuccess(`${rd.filterName} → ${stageLabel}${cycleExecuted ? '' : ' (queued)'}`);
      setRecentOps(prev => [{ stage: rd.stage, filter: rd.filterName, time: formatTime(new Date()), queued: !cycleExecuted }, ...prev].slice(0, 200));
      setScanValue(''); setRemarks('');
      if (cycleExecuted) mutate('/api/assets/instances');
      // core.startAndAdvance only OPENS a checklist (which replaces this dialog);
      // it never closes anything. With no checklist, the reason dialog is done
      // with — close it here, as the desktop page does (2026-10-22: it stayed
      // open over the stage view after every successful single start).
      if (!started.result.dialogOpened) core.dispatch({ type: 'close' });
    }, {
      onError: (e: any) => {
        if ((e?.code === 'BLOCK_CHANGE_CONFIRM' || e?.code === 'BLOCK_CHANGE_REQUIRED') && e?.connectionInfo) {
          core.dispatch({ type: 'close' }); // close reason dialog
          core.dispatch({ type: 'open_block_change', filterId: e.connectionInfo.filterId, filterName: rd.filterName ?? '', homeBlockId: e.connectionInfo.homeBlockId, homeBlockName: e.connectionInfo.homeBlockName, requestedBlockId: e.connectionInfo.requestedBlockId, requestedBlockName: e.connectionInfo.requestedBlockName });
          setBlockChangeReason('');
          return;
        }
        setError(e?.message ?? 'Failed');
      },
      // A dismissed password prompt is not an error (D-OPS-8): nothing started,
      // the reason dialog stays for another try.
      onCancel: () => setLoading(false),
    });
    setLoading(false);
  };

  // Mark a value the operator typed/picked. Editing an auto-filled value flips
  // provenance to AUTO_OVERRIDDEN (never silently stays AUTO).
  /**
   * A successfully auto-fetched value is LOCKED (2026-08-10, operator request) —
   * mirrors equipment-dialog.tsx; see the full rationale there. Supersedes the
   * 2026-06-13 AUTO_OVERRIDDEN decision; that state is now unreachable.
   *
   * Keyed on source === 'AUTO', not on the instrument being auto-configured, so
   * a fetch that never lands still leaves a typeable manual-fallback field.
   */
  const isEquipLocked = (instId: string): boolean => equipSource[instId] === 'AUTO';

  const setEquipReading = (instId: string, raw: string) => {
    if (isEquipLocked(instId)) return;
    setReadings(prev => {
      const next = { ...prev };
      const n = Number(raw);
      if (raw === '' || Number.isNaN(n)) delete next[instId];
      else next[instId] = n;
      return next;
    });
    setEquipSource(prev => ({ ...prev, [instId]: 'MANUAL' }));
  };

  // "Get Values": poll the SSRF-hardened server proxy, filling each auto
  // instrument as it arrives, retrying the still-pending ones for up to ~2 min,
  // then leaving them for manual entry. Aborts on dialog close (equipCancelRef).
  const handleGetValuesMobile = async () => {
    if (!equipDialog || !selectedEquipGroup || equipFetching) return;
    // Auto-fetch is online-only; offline there's nothing to poll (the button is
    // hidden too, but guard here so a stale render can't kick off a doomed loop).
    if (!online) return;
    const autoIds = (selectedEquipGroup.instruments ?? [])
      .filter((i: any) => i.stageKey === equipDialog.stage && i.autoFetchEnabled === true)
      .map((i: any) => i.id);
    if (autoIds.length === 0) return;
    equipCancelRef.current = false;
    // A retry clears the previous timeout so a transient outage doesn't strand
    // the instrument on the dropdown for the rest of the dialog's life.
    setEquipManualFallback(new Set());
    setEquipFetching(true);
    const pending = new Set<string>(autoIds);
    setEquipPending(new Set(pending));
    setEquipFetchStatus(`Fetching ${autoIds.length} reading(s)…`);
    const start = Date.now();
    try {
      // 1 minute (was 2) — operator request 2026-08-10.
      while (pending.size > 0 && (Date.now() - start) < 60_000) {
        if (equipCancelRef.current) return;
        let res: any = null;
        try {
          res = await apiClient.post<any>('/api/equipment-groups/fetch-readings', {
            filterId: equipDialog.filterId, groupId: selectedEquipGroup.id, stageKey: equipDialog.stage,
          });
        } catch { res = null; }
        if (equipCancelRef.current) return;
        for (const r of (res?.results ?? [])) {
          if (r?.ok && typeof r.value === 'number' && pending.has(r.instrumentId)) {
            setReadings(prev => ({ ...prev, [r.instrumentId]: r.value }));
            setEquipSource(prev => ({ ...prev, [r.instrumentId]: 'AUTO' }));
            pending.delete(r.instrumentId);
          }
        }
        setEquipPending(new Set(pending));
        if (pending.size === 0) break;
        setEquipFetchStatus(`Got ${autoIds.length - pending.size}/${autoIds.length}. Retrying…`);
        await new Promise(r => setTimeout(r, 5_000));
      }
    } finally {
      if (!equipCancelRef.current) {
        setEquipFetching(false);
        if (pending.size > 0) setEquipManualFallback(new Set(pending));
        setEquipFetchStatus(pending.size > 0 ? `${pending.size} reading(s) couldn't be fetched in 1 minute — select them manually.` : 'All readings fetched.');
      }
    }
  };

  const handleEquipSubmit = async () => {
    if (!equipDialog || !selectedEquipGroup) return;
    // Validate all instrument readings are filled
    const stageInstruments = (selectedEquipGroup.instruments ?? []).filter((i: any) => i.stageKey === equipDialog.stage);
    for (const inst of stageInstruments) {
      if (readings[inst.id] === undefined) {
        setError(`Please select a value for ${inst.description}`);
        return;
      }
    }
    // Out-of-range readings are allowed but must be confirmed — recorded as a
    // deviation on the server.
    const oos = stageInstruments.filter((i: any) => {
      const v = readings[i.id];
      return v !== undefined && (v < i.operatingMin || v > i.operatingMax);
    });
    if (oos.length > 0) {
      const lines = oos.map((i: any) => `• ${i.description}: ${readings[i.id]} ${i.uom} (range ${i.operatingMin}–${i.operatingMax})`).join('\n');
      if (!window.confirm(`These readings are OUTSIDE the operating range:\n\n${lines}\n\nSubmit anyway?`)) return;
    }
    // Queue readings mode (2026-10-08): the dialog was opened by
    // handleSubmitQueue for a batch of mid-cycle filters. Stash the readings and
    // re-run the queue submit, which applies them to every advance (online bulk,
    // offline queue, and checklist-deferred alike).
    if (queueReadingsModeRef.current) {
      queueReadingsModeRef.current = false;
      queueReadingsRef.current = { stage: equipDialog.stage, equipmentGroupId: selectedEquipGroup.id, instrumentReadings: { ...readings } };
      core.dispatch({ type: 'close' });
      setSelectedEquipGroup(null); setReadings({});
      setTimeout(() => { handleSubmitQueue(); }, 0);
      return;
    }
    setLoading(true); setError('');
    // Snapshot equip dialog fields before any async dispatch that clears the state
    const equipFiltId = equipDialog.filterId;
    const equipFiltName = equipDialog.filterName;
    const equipStage = equipDialog.stage;
    // 2026-05-20 batch cycle-start: stash the remaining filters before the
    // dispatch clears equipDialog. After the first cycle-start completes,
    // iterate through these applying the SAME reason + equipment + readings.
    const batchRest = equipDialog.remainingBatch ?? [];
    try {
      const isDryerReadings = equipStage === 'DRY_IN';
      const targetState = isDryerReadings ? 'DRY_IN' : equipStage;

      // If we have a pending cycle payload (from reason dialog), use compound operation.
      // The start-cycle half is reauth-gated (START_CLEANING_CYCLE for ADMIN role) — wrap.
      // The plain-advance branch is NOT reauth-gated (POST /advance has no enforceReauth).
      let executed: boolean | undefined;
      // Bulk online path only: did the FIRST scanned filter (which drives the
      // shared success toast + recent-ops entry below) specifically fail? Keyed
      // separately from `executed` because okCount>0 would paint a false
      // "Success"/"(queued)" for that filter inside a partially-failed batch.
      let firstFilterFailed = false;
      // 2026-05-26: track whether core.startAndAdvance / core.advance opened
      // a checklist dialog. The trailing "close stale equipment dialog"
      // logic at the end of this handler used to read core.dialogState.kind
      // — a stale-closure value captured at handler entry — and would fire
      // close on top of the just-opened checklist dialog, killing the gate
      // on every L1-style profile (every-stage checklist). Now we trust the
      // hook's return value.
      let dialogOpenedByCore = false;
      // 2026-07-16: the single-filter advance deferred — the checklist dialog is
      // open and NOTHING was written yet. Everything below that reports a
      // completed stage (success toast, recent-ops) must be skipped; the
      // checklist submit handler reports the combined result instead.
      let deferredHere = false;
      // 2026-05-26: capture server tape per filter so the unified-batch
      // post-loop dispatch (below) groups same-signature filters into ONE
      // dialog. Pre-fix the cycle-start used the per-filter remainingBatch
      // cycling pattern which dropped 2 of 3 checklists in the multi-filter
      // L1 batch test on tablet HA28H13Z 2026-05-26 19:00 IST.
      const cycleStartActionsByFilter = new Map<string, any[]>();
      // Cycles really started (or queued) by this submit — what the batch
      // summary reports. Set from the bulk result online, else counted per filter.
      let startedCount = 0;
      // The password the first START was signed with, reused for the rest of
      // an offline batch (undefined when START re-auth is off).
      let batchPassword: string | undefined;
      if (pendingCyclePayload) {
        const cyclePayloadSnap = pendingCyclePayload;
        if (online && batchRest.length > 0) {
          // Task 4 (2026-07-09) batch cycle-start via /bulk-operate: online
          // multi-filter fires ONE request covering the first filter + every
          // batched filter, replacing the first core.startAndAdvance PLUS the
          // per-filter batchRest loop below. runBulkOnline is reauth-capable
          // (opens the password dialog for a reauth-gated role, posts inline
          // otherwise) so NO reauth.execute wrapper is needed here. Single-filter
          // online AND all offline stay on the core.startAndAdvance path in the
          // else branch — byte-identical to before (single isn't a batch; core's
          // in-dispatch keeps opening its checklist gate).
          const allBatchFilters = [{ filterId: equipFiltId, filterName: equipFiltName }, ...batchRest];
          const ops: BulkClientItem[] = allBatchFilters.map(f => ({
            clientOpId: crypto.randomUUID(),
            filterId: f.filterId,
            kind: 'start-and-advance' as const,
            cyclePayload: cyclePayloadSnap,
            advancePayload: {
              targetState,
              cleaningAreaId: selectedBlock?.id,
              equipmentGroupId: selectedEquipGroup.id,
              instrumentReadings: readings,
              ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
              remarks: remarks || `${equipStage.replace(/_/g, ' ')} - ${f.filterName}`,
            },
          }));
          const startAction = withStageAction(['START_CLEANING_CYCLE'], batchTargetState(ops));
          const firstOut = await runBulkOnline(ops, startAction);
          // Operator declined reauth — keep the dialog + state, no error banner.
          if (firstOut === 'cancelled') { setLoading(false); return; }
          // Wholesale transport failure — keep state so the operator can retry.
          if (firstOut === 'transport_error') {
            setError('Could not reach the server to start the cycles. Please try again.');
            setLoading(false);
            return;
          }
          const out = await retryBulkStartsForMissedPm(ops, firstOut, startAction);
          setPendingCyclePayload(null);
          // `executed` gates the instances mutate below: true if ANY filter
          // succeeded. The first-filter success toast is keyed separately on that
          // filter's OWN result (firstFilterFailed) so a partial/total failure
          // doesn't falsely claim equipFiltName succeeded or was queued offline.
          executed = out.okCount > 0;
          startedCount = out.okCount;
          firstFilterFailed = out.results.find(r => r.filterId === equipFiltId)?.status === 'failed';
          // Feed the unified checklist dispatch (below) the authoritative
          // per-filter server actions, exactly as the per-filter loop did.
          for (const [fid, actions] of out.actionsByFilter) cycleStartActionsByFilter.set(fid, actions);
          // Recent-ops parity with the offline per-filter loop: one entry per
          // batched filter that succeeded (the first filter's entry is added by
          // the shared setRecentOps below). A start-and-advance that FAILS on the
          // advance half may have CREATED a cycle (server guards a re-start with
          // CYCLE_ACTIVE 409) — surface it via setError; operator re-scans to retry.
          const nameById = new Map(allBatchFilters.map(f => [f.filterId, f.filterName]));
          for (const r of out.results) {
            if (r.filterId === equipFiltId) continue;
            if (r.status === 'ok') {
              setRecentOps(prev => [{ stage: equipStage, filter: nameById.get(r.filterId) ?? r.filterId, time: formatTime(new Date()), queued: false }, ...prev].slice(0, 200));
            }
          }
          const failMsgs = out.results.flatMap(r =>
            r.status === 'failed'
              ? [`${nameById.get(r.filterId) ?? r.filterId}: ${r.error?.message ?? 'failed'}`]
              : []);
          if (failMsgs.length > 0) setError(failMsgs.join('; '));
        } else {
          // For multi-filter cycle-start: skip the in-core dispatch entirely
          // and let the post-loop unified-batch dispatch handle it. Same shape
          // as the multi-filter DRY_IN SET_DURATION path (handleSubmitQueue
          // line ~890). For single-filter, no batchRest, normal dispatch.
          const useUnifiedBatch = batchRest.length > 0;
          // 🔴 2026-10-01 — a REFUSED start used to vanish here. `reauth.execute`
          // hands a failure to `onError` and does not re-throw; with no handler
          // the server's reason was never shown, and the line after it cleared
          // `pendingCyclePayload` regardless. The dialog stayed open, so the next
          // Submit took the plain-advance branch below against a filter that has
          // no cycle — the operator saw "No active cleaning cycle" on every
          // retry and could not get out of it. Now: the real reason is shown, and
          // the start payload is only spent once the start has actually happened.
          //
          // 2026-10-22 — awaited through `executeWithResult`, not `execute`.
          // `execute` RETURNS as soon as the password prompt opens, and the start
          // then ran inside the prompt's confirm after this handler had already
          // returned: with START re-auth on, the cycle started but the dialog
          // stayed open with its start payload spent (so the next Submit was a
          // bare advance), nothing was reported, and the rest of a batch was
          // never started. The same password signs the rest of the batch below —
          // one password per batch, as the online /bulk-operate path does.
          let started: { cancelled: true } | { cancelled: false; result: AdvanceOutcome };
          try {
            started = await reauth.executeWithResult(withStageAction(['START_CLEANING_CYCLE'], targetState), (password?: string) => {
              batchPassword = password;
              return startWithPmGate(equipFiltId, (extraCycleFields) => core.startAndAdvance({
                filterId: equipFiltId,
                filterName: equipFiltName,
                cyclePayload: { ...cyclePayloadSnap, ...extraCycleFields },
                advancePayload: {
                  targetState,
                  cleaningAreaId: selectedBlock?.id,
                  equipmentGroupId: selectedEquipGroup.id,
                  instrumentReadings: readings,
                  ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
                  remarks: remarks || `${equipStage.replace(/_/g, ' ')} - ${equipFiltName}`,
                },
                targetState,
                cleaningAreaId: selectedBlock?.id,
                password,
                skipChecklistDispatch: useUnifiedBatch,
              }));
            });
          } catch (e: any) {
            // A dismissed password prompt started nothing: keep the dialog and
            // its payload with no error, as the online batch does ('cancelled').
            if (isReauthCancelled(e)) { setLoading(false); return; }
            if ((e?.code === 'BLOCK_CHANGE_CONFIRM' || e?.code === 'BLOCK_CHANGE_REQUIRED') && e?.connectionInfo) {
              core.dispatch({ type: 'close' }); // close equip dialog first (allowed → none)
              core.dispatch({
                type: 'open_block_change',
                filterId: e.connectionInfo.filterId,
                filterName: equipFiltName,
                homeBlockId: e.connectionInfo.homeBlockId,
                homeBlockName: e.connectionInfo.homeBlockName,
                requestedBlockId: e.connectionInfo.requestedBlockId,
                requestedBlockName: e.connectionInfo.requestedBlockName,
              });
              setBlockChangeReason('');
              setSelectedEquipGroup(null); setReadings({});
              setPendingCyclePayload(null);
            } else {
              // The dialog and its start payload are kept: fix the cause and
              // Submit again, and it is still a cycle START.
              setError(`${equipFiltName}: ${e?.message ?? 'The cleaning cycle could not be started.'}`);
            }
            setLoading(false);
            return;
          }
          // Missed-PM question dismissed — nothing was started, so none of the
          // "stage reached" bookkeeping below applies.
          if (started.cancelled) { setLoading(false); return; }
          const res = started.result;
          // The cycle exists (or its start is queued) — only now is the start
          // payload spent. A deferred start (first-stage checklist) carries it
          // inside the checklist dialog's parked op, so clearing is right there too.
          setPendingCyclePayload(null);
          executed = res.executed;
          startedCount = 1;
          dialogOpenedByCore = dialogOpenedByCore || res.dialogOpened;
          // Cycle-start deferred behind its first-stage checklist: nothing was
          // written (not even the cycle). Suppresses the success toast +
          // recent-ops below — the checklist submit fires the whole compound op
          // and reports. Only reachable when !useUnifiedBatch (the hook refuses
          // to defer a batch continuation).
          deferredHere = res.deferred === true;
          if (useUnifiedBatch && executed && Array.isArray((res.result as any)?.actions)) {
            cycleStartActionsByFilter.set(equipFiltId, (res.result as any).actions);
          }
        }
      } else {
        const res = await core.advance({
          filterId: equipFiltId,
          filterName: equipFiltName,
          targetState,
          cleaningAreaId: selectedBlock?.id,
          equipmentGroupId: selectedEquipGroup.id,
          instrumentReadings: readings,
          ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
          remarks: remarks || `${equipStage.replace(/_/g, ' ')} - ${equipFiltName}`,
          // Dialog-first deferral would park this advance on the checklist
          // dialog and return — skipping the batch-continuation loop below.
          // Single-filter only.
          allowDefer: batchRest.length === 0,
        });
        executed = res.executed;
        dialogOpenedByCore = dialogOpenedByCore || res.dialogOpened;
        deferredHere = res.deferred === true;
      }

      // 2026-05-25 combined-screen UX: snapshot the readings the operator just
      // sent so the checklist dialog (auto-opened by resolveAndDispatchChecklist)
      // can show them at the top. selectedEquipGroup carries the instrument
      // metadata needed to render the values with their descriptions + uoms.
      const recap = (selectedEquipGroup?.instruments ?? [])
        .filter((i: any) => i.stageKey === equipStage && readings[i.id] !== undefined)
        .map((i: any) => ({
          description: i.description as string,
          value: formatRecordedReading(readings[i.id], i.leastCount),
          uom: i.uom as string,
        }));
      // Don't show the readings recap for the first filter if it specifically
      // failed the batch (its checklist won't open; showing its recap misleads).
      if (!firstFilterFailed) {
        setStageSubmitRecap({
          stage: equipStage,
          filterName: equipFiltName,
          readings: recap,
          submittedAt: formatTime(new Date()),
        });
      }
      const queued = !executed;
      // Skip the first-filter success toast + recent-ops entry when THAT filter
      // failed in an online batch (its failure is already surfaced via setError);
      // otherwise it falsely reads as "Success"/"(queued)".
      //
      // `deferredHere` (2026-07-16): the advance was NOT written — the checklist
      // dialog is open and it commits atomically on submit. `queued` is true here
      // only because `executed` is false, so this would print a "(queued)" that is
      // doubly wrong: nothing is queued, and no stage was reached. The checklist
      // submit handler reports the real outcome. The recap above IS still set —
      // it renders the readings at the top of the open dialog.
      if (!firstFilterFailed && !deferredHere) {
        setSuccess(`${equipFiltName} → ${equipStage.replace(/_/g, ' ')}${queued ? ' (queued)' : ''}`);
        setRecentOps(prev => [{ stage: equipStage, filter: equipFiltName, time: formatTime(new Date()), queued }, ...prev].slice(0, 200));
      }

      // 2026-05-20 batch cycle-start continuation. After the first filter's
      // start-and-advance completes, replay the SAME reason payload +
      // equipment + readings for each remaining filter in the queue. Sequential
      // (not parallel) so each cycle's auditTrail row is ordered + the
      // optimistic UI state stays consistent.
      if (batchRest.length > 0 && pendingCyclePayload) {
        // OFFLINE multi-filter: replay the SAME reason payload + equipment +
        // readings per remaining filter via core.startAndAdvance. ONLINE
        // multi-filter is already fully handled by the ONE runBulkOnline call
        // above (both the first filter AND every batchRest filter), so this
        // per-filter network loop is offline-only now. The unified checklist
        // dispatch that follows runs for BOTH paths (fed by
        // cycleStartActionsByFilter, populated online from out.actionsByFilter).
        if (!online) {
          const cyclePayloadSnap = pendingCyclePayload;
          const equipGroupSnap = selectedEquipGroup;
          const readingsSnap = readings;
          const failures: string[] = [];
          for (const rest of batchRest) {
            // core.startAndAdvance THROWS on a refusal, so this catch sees it.
            // (2026-10-22: it used to sit inside reauth.execute, which hands a
            // failure to onError and never re-throws — with no handler, a refused
            // start vanished and was still counted as started.) The first
            // START's password signs these too.
            try {
              const restRes = await core.startAndAdvance({
                filterId: rest.filterId,
                filterName: rest.filterName,
                cyclePayload: cyclePayloadSnap,
                advancePayload: {
                  targetState,
                  cleaningAreaId: selectedBlock?.id,
                  equipmentGroupId: equipGroupSnap.id,
                  instrumentReadings: readingsSnap,
                  ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}),
                  remarks: remarks || `${equipStage.replace(/_/g, ' ')} - ${rest.filterName}`,
                },
                targetState,
                cleaningAreaId: selectedBlock?.id,
                password: batchPassword,
                // 2026-05-26: all batch iterations skip in-core dispatch.
                // Unified-batch dispatch fires AFTER this loop completes,
                // grouping all filters into one dialog. Replaces the old
                // per-filter remainingBatch cycling pattern that dropped
                // checklists when the operator didn't see/answer every
                // sequential dialog.
                skipChecklistDispatch: true,
              });
              if (restRes.executed && Array.isArray((restRes.result as any)?.actions)) {
                cycleStartActionsByFilter.set(rest.filterId, (restRes.result as any).actions);
              }
              startedCount++;
              setRecentOps(prev => [{ stage: equipStage, filter: rest.filterName, time: formatTime(new Date()), queued: !restRes.executed }, ...prev].slice(0, 200));
            } catch (batchErr: any) {
              // eslint-disable-next-line no-console
              console.warn(`[batch-cycle-start] ${rest.filterName} failed:`, batchErr);
              failures.push(`${rest.filterName}: ${batchErr?.message ?? 'cycle-start failed'}`);
            }
          }
          if (failures.length > 0) setError(failures.join('; '));
        }
        if (startedCount > 0) setSuccess(`Started ${startedCount} cycle${startedCount === 1 ? '' : 's'} successfully`);

        // 2026-05-26: unified-batch checklist dispatch for multi-filter
        // cycle-start. Walk every filter's server tape, group by checklist
        // signature, open ONE dialog covering all same-signature filters.
        // handleChecklistSubmit's batch branch then POSTs identical answers
        // to each member sequentially. Same pattern as the mid-cycle batch
        // path in handleSubmitQueue post-loop.
        try {
          const sigOf = (rows: any[]) =>
            rows.map((r: any) => `${r.checklistProfileId}@${r.profileVersion ?? 0}`).sort().join('|');
          type Pending = { item: { filterId: string; filterName: string }; checklists: any[]; signature: string };
          const pending: Pending[] = [];
          const allFiltersInBatch = [
            { filterId: equipFiltId, filterName: equipFiltName },
            ...batchRest.map(b => ({ filterId: b.filterId, filterName: b.filterName })),
          ];
          for (const f of allFiltersInBatch) {
            try {
              const serverActions = cycleStartActionsByFilter.get(f.filterId);
              const checklists = await resolvePendingChecklistDialog(f.filterId, serverActions ?? undefined);
              if (checklists && checklists.length > 0) {
                pending.push({ item: f, checklists, signature: sigOf(checklists) });
              }
            } catch { /* per-filter resolver failure shouldn't poison the batch */ }
          }
          if (pending.length > 0) {
            const groups = new Map<string, Pending[]>();
            for (const p of pending) {
              const arr = groups.get(p.signature) ?? [];
              arr.push(p);
              groups.set(p.signature, arr);
            }
            let chosen: Pending[] = [];
            for (const arr of groups.values()) {
              if (arr.length > chosen.length) chosen = arr;
            }
            const primary = chosen[0];
            const batchMembers = chosen.map(p => p.item);
            // AHU pre-flight BEFORE the (terminal) checklist opens.
            if ((await gateAhuBeforeChecklist(batchMembers.map(m => m.filterId))) === 'proceed') {
              setPendingBatch(batchMembers);
              core.dispatch({
                type: 'open_checklist',
                filterId: primary.item.filterId,
                filterName: batchMembers.length > 1 ? `${batchMembers.length} filter(s)` : primary.item.filterName,
                checklists: primary.checklists,
              });
              setChecklistAnswers({});
              dialogOpenedByCore = true;
            }
          }
        } catch { /* ignore — operator can re-scan to trigger */ }
      }

      setScanValue(''); setRemarks(''); setSelectedEquipGroup(null); setReadings({});
      // 2026-05-26 fix: explicit close ONLY when core did NOT open a
      // checklist dialog. Pre-fix this read `core.dialogState.kind` which is
      // a stale-closure snapshot from when the handler started ('awaiting_
      // equipment'), so the close fired AFTER open_checklist had transitioned
      // the state to 'awaiting_checklist' — killing the checklist dialog on
      // every L1-style profile where every stage has a gate. Now using the
      // hook's return-value signal so we close the equip dialog when (and
      // only when) the cycle write produced no gate transition.
      if (!dialogOpenedByCore) core.dispatch({ type: 'close' });
      if (executed) mutate('/api/assets/instances');
      // Dialog + checklist dispatch handled by core.advance / core.startAndAdvance
    } catch (e: any) {
      // B7.2: equipment-dialog flows go through `start-and-advance`, which
      // calls start-cycle → validateBlockChange. A cross-block scan there
      // can return 409 BLOCK_CHANGE_REQUIRED — pop the structured modal
      // (same shape as reason-dialog catch above) instead of swallowing
      // it as a generic "Failed" toast.
      if ((e?.code === 'BLOCK_CHANGE_CONFIRM' || e?.code === 'BLOCK_CHANGE_REQUIRED') && e?.connectionInfo) {
        core.dispatch({ type: 'close' }); // close equip dialog first (allowed → none)
        core.dispatch({
          type: 'open_block_change',
          filterId: e.connectionInfo.filterId,
          filterName: equipFiltName,
          homeBlockId: e.connectionInfo.homeBlockId,
          homeBlockName: e.connectionInfo.homeBlockName,
          requestedBlockId: e.connectionInfo.requestedBlockId,
          requestedBlockName: e.connectionInfo.requestedBlockName,
        });
        setBlockChangeReason('');
        setSelectedEquipGroup(null); setReadings({});
        setPendingCyclePayload(null);
        setLoading(false);
        return;
      }
      setError(e.message ?? 'Failed');
    }
    setLoading(false);
  };

  // 2026-07-02: AHU completion pre-flight — runs BEFORE the terminal checklist
  // opens, for BOTH modes (mirrors desktop filter-operations.tsx). Gated on
  // isTerminalChecklist so intermediate checklists are unaffected. Returns
  // 'blocked' when the operator must not open the checklist. Mobile resolves the
  // AHU as the filter's parentId (matches resolveAhuId server logic).
  const gateAhuBeforeChecklist = async (
    filterIds: string[],
    known?: { currentState?: string | null; stageLookup?: any },
  ): Promise<'proceed' | 'blocked'> => {
    // Reset any prior choice so a non-AHU / non-terminal submit carries none.
    ahuSetChoiceRef.current = null;
    if (ahuMode === 'NONE' || filterIds.length === 0) return 'proceed';
    // Terminal-checklist detection MUST use the exact state THIS checklist was
    // opened for. Single-scan passes the just-fetched /current-state (`known`) —
    // using it avoids a redundant second fetch that could return a different or
    // stale response (e.g. a prior cycle's Storage Out) and mis-fire the POPUP at
    // intermediate stages. Only when the caller has no resolved state (batch) do
    // we fetch, falling back to the IndexedDB cache when genuinely offline.
    let termState: any = known;
    if (!termState?.currentState || !termState?.stageLookup) {
      termState = await getCache<any>(`filter-state-${filterIds[0]}`).catch(() => null);
      try { termState = await apiClient.get<any>(`/api/filters/${filterIds[0]}/current-state`); }
      catch { /* genuinely offline → keep cached fallback */ }
    }
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
    known?: { stageLookup?: any },
  ): Promise<'proceed' | 'blocked'> => {
    ahuSetChoiceRef.current = null;
    if (ahuMode === 'NONE' || filterIds.length === 0 || !targetState) return 'proceed';
    let st: any = known?.stageLookup ? known : null;
    if (!st) {
      st = await getCache<any>(`filter-state-${filterIds[0]}`).catch(() => null);
      try { st = await apiClient.get<any>(`/api/filters/${filterIds[0]}/current-state`); }
      catch { /* genuinely offline → keep cached fallback */ }
    }
    if (!isCompletingAdvance(targetState, st?.stageLookup)) return 'proceed';
    return runAhuGate(filterIds);
  };

  /**
   * 2026-08-10: third entry point — the DIALOG-FIRST terminal checklist.
   *
   * The 2026-07-16 dialog-first refactor parks the advance and opens the
   * checklist BEFORE anything is written, so at this point the filter is still
   * at the PREVIOUS stage (Storage In) and `gateAhuBeforeChecklist` — which
   * tests `currentState` — could no longer recognise the terminal step. That is
   * why the AHU popup stopped appearing at Storage Out. Test the TARGET stage
   * instead; `isTerminalTargetWithChecklist` is the exact complement of
   * `isCompletingAdvance`, so the pre-loop gate and this one never both fire.
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
    // Fail-safe: a FAILED completion check must not read as "all siblings done"
    // for INTERLOCK — that silently defeats the gate. Block + surface it so the
    // operator retries rather than hitting the server 422 at submit. POPUP is
    // advisory, so a failed check there proceeds (already logged in the helper).
    if (failed && ahuMode === 'INTERLOCK') {
      setError('Could not verify AHU completion status. Check your connection and try again.');
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
   * Submit a START checklist (2026-10-22): per filter start-cycle (the missed-PM
   * question asked as on every start, the answers held through it) → the
   * answers at START → the first stage, signed ONCE for the three writes
   * (lib/filter-ops use-core startWithStartChecklist, then advance). A filter
   * whose start is refused or whose missed-PM question is closed gets nothing
   * more. One whose checklist is refused waits at START: the next scan asks it
   * again from the tape, never a second start.
   *
   * The first stage: a plain entry is made here under the same signature. An
   * entry that needs more — readings (Wash In with an equipment group) or a
   * checklist that rides on the entry — goes back through the scan queue, which
   * asks it first and enters the stage with it (a cycle at START is in a cycle).
   */
  const runStartChecklistSequence = async (
    ctx: NonNullable<typeof startChecklistRef.current>,
    checklistPayload: Record<string, any>,
  ) => {
    const stageText = stageLabel(ctx.stage);
    const single = ctx.batch.length === 1;
    const isReauthErr = (e: any) => ['REAUTH_REQUIRED', 'REAUTH_FAILED'].includes(e?.error ?? e?.code);
    // Does entering the first stage need more than a plain advance? Decided
    // before anything is written, from each filter's cached state.
    let entryNeedsMore = false;
    for (const item of ctx.batch) {
      const st = await getCache<any>(`filter-state-${item.filterId}`).catch(() => null);
      if (await stageReadingsNeed(ctx.stage, st)
        || (ctx.stage !== 'DRY_IN' && (await resolveChecklistForTargetStage(item.filterId, ctx.stage, online)).length > 0)) {
        entryNeedsMore = true;
        break;
      }
    }
    await reauth.execute(withStageAction(['START_CLEANING_CYCLE', 'SUBMIT_CHECKLIST_WITH_SIGNATURE', 'ADVANCE_FILTER_STAGE'], ctx.stage), async (password?: string) => {
      const failed: string[] = [];
      const answered: Array<{ filterId: string; filterName: string }> = [];
      let entered = 0;
      let queued = false;
      // Per filter, in order: start → the answers at START → (a plain) entry.
      for (const item of ctx.batch) {
        try {
          const out = await core.startWithStartChecklist({
            filterId: item.filterId,
            filterName: item.filterName,
            cyclePayload: { ...ctx.cyclePayload, acknowledgeBlockChange: ackedBlockFiltersRef.current.has(item.filterId) },
            checklistPayload,
            checklistProfileIds: ctx.checklistProfileIds,
            cleaningAreaId: selectedBlock?.id ?? null,
            password,
            runStart: async (start) => {
              const started = await startWithPmGate(item.filterId, start);
              return started.cancelled ? null : started.result;
            },
          });
          if (out.status === 'cancelled') {
            failed.push(`${item.filterName}: not started — the missed-PM question was closed`);
            continue;
          }
          if (out.status === 'checklist_refused') {
            failed.push(`${item.filterName}: the cycle started, but its first checklist was not recorded (${(out.error as any)?.message ?? 'refused'}). Scan it again to answer it.`);
            continue;
          }
          if (!out.startExecuted || !out.checklistExecuted) queued = true;
          answered.push(item);
        } catch (e: any) {
          if (isReauthErr(e)) throw e;
          failed.push(single ? (e?.message ?? 'Cycle start failed') : `${item.filterName}: ${e?.message ?? 'cycle start failed'}`);
          continue;
        }
        if (entryNeedsMore) continue;
        try {
          // No dialog from here (the START dialog is still open): a plain entry.
          const res = await core.advance({
            filterId: item.filterId,
            filterName: item.filterName,
            targetState: ctx.stage,
            cleaningAreaId: selectedBlock?.id,
            remarks: ctx.remarks || `${stageText} - ${item.filterName}`,
            ...dryerFieldsForStart(ctx.stage, item.filterId),
            password,
            skipChecklistDispatch: true,
            allowDefer: false,
          });
          if (!res.executed) queued = true;
          entered++;
          setRecentOps(prev => [{ stage: ctx.stage, filter: item.filterName, time: formatTime(new Date()), queued: !res.executed }, ...prev].slice(0, 200));
        } catch (e: any) {
          if (isReauthErr(e)) throw e;
          failed.push(`${item.filterName}: the cycle started and its first checklist was recorded, but it did not enter ${stageText} (${e?.message ?? 'refused'}). Scan it again at ${stageText}.`);
        }
      }
      startChecklistRef.current = null;
      setPendingBatch(null);
      setChecklistAnswers({});
      setScanValue(''); setRemarks('');
      if (answered.length > 0) mutate('/api/assets/instances');
      if (failed.length > 0) setError(failed.join('\n'));
      if (answered.length > 0 && entryNeedsMore) {
        // Back in the queue, ticked: the replay (on this dialog closing) asks the
        // readings / the checklist first and enters the stage with them.
        const ids = new Set(answered.map(r => r.filterId));
        const rows = reasonQueueRowsRef.current.filter(r => ids.has(r.filterId));
        setScanQueue(prev => [...prev, ...rows.filter(r => !prev.some(p => p.filterId === r.filterId))]);
        setSelectedQueueIds(prev => new Set([...prev, ...rows.map(r => r.filterId)]));
        setSuccess(`${single ? answered[0].filterName : `${answered.length} filter(s)`}: cycle started, first checklist recorded${queued ? ' (queued)' : ''} — now ${stageText}`);
        pendingBatchReplayRef.current = true;
        setLoading(false);
        core.dispatch({ type: 'close' });
        return;
      }
      core.dispatch({ type: 'close' });
      if (entered > 0) {
        setSuccess(`${single ? answered[0].filterName : `${entered} filter(s)`} → ${ctx.stage.replace(/_/g, ' ')}${queued ? ' (queued)' : ''}`);
      }
    }, {
      onError: (e: any) => setError(e?.message ?? 'Failed'),
      // A dismissed password prompt writes nothing: the dialog stays, answers kept.
      onCancel: () => setLoading(false),
    });
  };

  const handleChecklistSubmit = async () => {
    if (!checklistDialog) return;
    const checklists = (checklistDialog.checklists as any[]) ?? [];
    // Block an empty-questions checklist (failed/stale load) from posting an
    // empty answer set — the server rejects a real required checklist, so this
    // would dead-end the operator. Point to recovery instead. (The pipeline
    // never gates on a genuinely question-less checklist.)
    if (checklists.some((cl: any) => !Array.isArray(cl.questions) || cl.questions.length === 0)) {
      setError('This checklist could not load its questions. Reconnect and refresh, then reopen it before submitting.');
      return;
    }
    for (const cl of checklists) { for (const q of (cl.questions ?? [])) { if (q.required && (checklistAnswers[q.id] === undefined || checklistAnswers[q.id] === '')) { setError(`Answer required: "${q.question}"`); return; } } }
    setLoading(true); setError('');

    // A START checklist (2026-10-22): nothing has been written yet — the cycle
    // starts now, then these answers, then the first stage.
    const startCl = startChecklistRef.current;
    if (startCl && pendingBatch && pendingBatch.length > 0) {
      const versions: Record<string, number> = {};
      for (const cl of checklists) if (typeof cl.profileVersion === 'number') versions[cl.checklistProfileId] = cl.profileVersion;
      await runStartChecklistSequence(startCl, { answers: checklistAnswers, expectedProfileVersions: versions });
      setLoading(false);
      return;
    }

    // 2026-07-03: a TERMINAL checklist (e.g. Storage Out → cycle completes) has
    // no follow-up step, so the DRY_IN-style batch replay must NOT fire —
    // otherwise it re-runs handleSubmitQueue over the now-completed filters
    // ("not in correct stage") and the scan queue lingers showing them. Detect
    // completion up-front (fresh state, cache fallback) and suppress the replay
    // BEFORE the dialog close can schedule it; the batch branch clears the queue.
    let willComplete = false;
    try {
      let fresh: any = null;
      // Always attempt fresh (not gated on the flaky `online` flag); cache fallback.
      try { fresh = await apiClient.get<any>(`/api/filters/${checklistDialog.filterId}/current-state`); }
      catch { fresh = await getCache<any>(`filter-state-${checklistDialog.filterId}`); }
      willComplete = isTerminalChecklist(fresh?.currentState, fresh?.stageLookup);
    } catch { /* leave willComplete=false → replay behaves exactly as before */ }
    if (willComplete) pendingBatchReplayRef.current = false;

    // 2026-07-02: the AHU completion pre-flight (POPUP + INTERLOCK) now runs
    // BEFORE the checklist opens (gateAhuBeforeChecklist), so there is no
    // submit-time POPUP pre-flight here. INTERLOCK still has a server-side 422
    // safety net caught below in case state changed between open and submit.

    // Phase A.1: send the version each profile was rendered against — server
    // returns 409 SCHEMA_DRIFT if the cycle pin doesn't match.
    const expectedProfileVersions: Record<string, number> = {};
    for (const cl of checklists) {
      if (typeof cl.profileVersion === 'number') {
        expectedProfileVersions[cl.checklistProfileId] = cl.profileVersion;
      }
    }
    // 2026-07-16: captured BEFORE either branch clears pendingBatchDeferred.
    // True => this submit also performs the parked ADVANCE for each member (one
    // atomic op per filter), so the scan queue must be cleared afterwards even
    // for a non-terminal stage — the filters have moved on and a re-submit would
    // advance them twice.
    const hadDeferred = !!(pendingBatchDeferred && pendingBatchDeferred.size > 0);
    // Task 5 (2026-07-09): ONLINE batch checklist submit via /bulk-operate — ONE
    // request covering every batch member, ONE reauth prompt. runBulkOnline is
    // reauth-capable (opens the password dialog for a reauth-gated role, posts
    // inline otherwise) so NO reauth.execute wrapper is used here — nesting it
    // inside reauth.execute would double-prompt. OFFLINE batch + every single
    // submit stay on the core.submitChecklist path in the reauth.execute block
    // below (byte-identical to before). Mirrors the Task 4 cycle-start split.
    const isBatchSubmit = !!(
      pendingBatch && pendingBatch.length > 0 &&
      pendingBatch.some(p => p.filterId === checklistDialog.filterId)
    );
    if (isBatchSubmit && online) {
      const batch = pendingBatch!;
      const nameById = new Map(batch.map(b => [b.filterId, b.filterName]));
      // Mirror executeOrQueue/use-offline.ts (L114-123): submit-checklist is
      // cycle-bound, so the server needs each filter's tapeVersion (409
      // STALE_TAPE otherwise). Read it from the SAME per-filter
      // `filter-state-<id>` cache row executeOrQueue reads, guarded to a number
      // — include only when present (same source as the Task 3 advance leaf,
      // L1243). expectedProfileVersions (SCHEMA_DRIFT 409) + filterSet (AHU
      // terminal-completion scope) are carried forward exactly as the current
      // core.submitChecklist call passes them. `password` is NOT in the payload:
      // it flows through runBulkOnline → reauth.executeWithResult → bulkOperate.
      const ops: BulkClientItem[] = await Promise.all(batch.map(async (item) => {
        const cachedState = await getCache<any>(`filter-state-${item.filterId}`).catch(() => null);
        // 2026-07-16: this filter's advance was PARKED by the dialog-first batch
        // — send both writes as ONE item so the server commits them in a single
        // transaction. Sending an `advance` item + a `submit-checklist` item
        // would be two per-item transactions and re-open the orphan window.
        const parked = pendingBatchDeferred?.get(item.filterId);
        return {
          clientOpId: crypto.randomUUID(),
          filterId: item.filterId,
          kind: parked ? ('advance-with-checklist' as const) : ('submit-checklist' as const),
          payload: {
            ...(parked ? parked.payload : {}),
            answers: checklistAnswers,
            expectedProfileVersions,
            ...(ahuSetChoiceRef.current ? { filterSet: ahuSetChoiceRef.current } : {}),
            ...(typeof cachedState?.tapeVersion === 'number' ? { tapeVersion: cachedState.tapeVersion } : {}),
          },
        };
      }));
      // Both gates when any item carries an advance — runBulkOnline's action is
      // only the reauth prompt label; the server enforces both regardless
      // (reauthActionsForItems maps advance-with-checklist to BOTH).
      const out = await runBulkOnline(ops, withStageAction(['SUBMIT_CHECKLIST_WITH_SIGNATURE'], batchTargetState(ops)));
      // Operator declined reauth — keep the dialog + state, no error banner.
      if (out === 'cancelled') { setLoading(false); return; }
      if (out === 'transport_error') {
        setError('Could not reach the server to submit the checklist. Please try again.');
        setLoading(false);
        return;
      }
      // core never dispatched a close (no per-member core.submitChecklist), so
      // close the checklist dialog explicitly — same transition the loop relied
      // on. Ordering (close → state resets → mutate → setLoading) is kept
      // byte-identical to the loop branch so the batch-replay effect (L1454),
      // which keys off awaiting_checklist → none, behaves the same.
      if (core.dialogState.kind === 'awaiting_checklist') core.dispatch({ type: 'close' });
      setPendingBatch(null); setPendingBatchDeferred(null);
      setChecklistAnswers({});
      setStageSubmitRecap(null);
      setRemarks(''); // B1/B2: clear remarks after a checklist-gated submit too
      // Surface per-filter results by NAME (not the raw UUID out.failures carry)
      // — batch members carry filterName; map through it.
      const success = out.okCount;
      const failed = out.results
        .filter((r): r is Extract<BulkClientResult, { status: 'failed' }> => r.status === 'failed')
        .map(r => `${nameById.get(r.filterId) ?? r.filterId}: ${r.error?.message ?? 'failed'}`);
      if (failed.length > 0 && success === 0) {
        setError(failed.join('\n'));
      } else if (failed.length > 0) {
        setError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
      } else {
        setSuccess(`Checklist submitted for ${success} filter(s)`);
      }
      // runBulkOnline already re-primed each filter's `filter-state-<id>` cache
      // from the bulk snapshot, so the per-filter /current-state prime the loop
      // branch did is unnecessary here. Still hard-revalidate the instances list
      // so completed cycles drop out of the view immediately.
      await mutate('/api/assets/instances', undefined, { revalidate: true });
      // Terminal checklist completed the cycles → clear the scan queue so the
      // finished filters don't linger and a re-submit can't re-process them.
      // (DRY_IN / non-terminal keeps the queue for its replay — see L1454.)
      // 2026-07-16: a deferred batch just performed the ADVANCE too (one atomic op
      // per filter), so those filters have moved on — the queue must be cleared or
      // a re-submit would advance them a second time. `hadDeferred` is captured
      // before `pendingBatchDeferred` is cleared.
      if (willComplete || hadDeferred) { setScanQueue([]); setDryerDurations({}); }
      setLoading(false);
      return;
    }

    // SUBMIT_CHECKLIST_WITH_SIGNATURE is reauth-gated for ADMIN role
    // (per system_config['action-reauth']). Wrap so the password dialog
    // appears when policy demands it. OFFLINE batch reaches the batch branch
    // inside (online-batch is handled above); single submits use the else path.
    await reauth.execute('SUBMIT_CHECKLIST_WITH_SIGNATURE', async (password?) => {
      // 2026-05-26: unified-batch branch. When pendingBatch is set AND the
      // open dialog's primary filter is part of that batch, submit the same
      // answers to every member sequentially. The primary-filter check
      // protects against a stale pendingBatch left over from a prior batch
      // session colliding with a fresh single-scan dialog. Mirrors desktop
      // filter-operations.tsx handleChecklistSubmit BATCH MODE branch.
      if (pendingBatch && pendingBatch.length > 0 && pendingBatch.some(p => p.filterId === checklistDialog.filterId)) {
        const batch = pendingBatch;
        let success = 0;
        let queued = 0; // offline-queued is a NORMAL outcome, NOT a failure
        const failed: string[] = [];
        for (const item of batch) {
          try {
            const { executed } = await core.submitChecklist({
              filterId: item.filterId,
              filterName: item.filterName,
              answers: checklistAnswers,
              expectedProfileVersions,
              filterSet: ahuSetChoiceRef.current ?? undefined,
              // 2026-07-16: pass THIS member's parked advance explicitly. One
              // dialog covers N filters, so only the primary has dialog state —
              // without this, members 2..N would queue a bare submit-checklist
              // against a stage their filter never entered.
              deferredAdvance: pendingBatchDeferred?.get(item.filterId),
              password,
            });
            success++;
            // `executed === false` means "accepted + queued for offline sync"
            // — the offline happy path. Do NOT push it into `failed`; that was
            // showing each queued filter as BOTH succeeded AND failed (the
            // "3 succeeded, 3 failed" error popup the operator saw offline).
            if (!executed) queued++;
          } catch (e: any) {
            // Re-throw REAUTH so the reauth.execute wrapper surfaces it.
            const errCode = e?.error ?? e?.code;
            if (errCode === 'REAUTH_FAILED' || errCode === 'REAUTH_REQUIRED') throw e;
            failed.push(`${item.filterName}: ${e?.message ?? 'failed'}`);
          }
        }
        // The last successful submitChecklist already dispatched close (no
        // remainingBatch carried). Force-close in case every item failed so
        // the dialog doesn't get stuck open.
        if (core.dialogState.kind === 'awaiting_checklist') core.dispatch({ type: 'close' });
        setPendingBatch(null); setPendingBatchDeferred(null);
        setChecklistAnswers({});
        setStageSubmitRecap(null);
        setRemarks(''); // B1/B2: clear remarks after a checklist-gated submit too
        if (failed.length > 0 && success === 0) {
          setError(failed.join('\n'));
        } else if (failed.length > 0) {
          setError(`${success} succeeded, ${failed.length} failed:\n${failed.join('\n')}`);
        } else if (queued > 0) {
          // Offline: everything accepted and queued — success, not an error.
          setSuccess(`Checklist queued for ${success} filter(s) — will sync when online`);
        } else {
          setSuccess(`Checklist submitted for ${success} filter(s)`);
        }
        // (Online batch submits are handled by the earlier runBulkOnline branch,
        // which returns before reaching here — so this branch is offline-only and
        // needs no online /current-state re-prime.)
        // Terminal checklist completed the cycles → nothing left to do. Clear the
        // scan queue so the finished filters don't linger and a re-submit can't
        // re-process them. (DRY_IN / non-terminal keeps the queue for its replay.)
        // 2026-07-16: a deferred batch just performed the ADVANCE too (one atomic op
      // per filter), so those filters have moved on — the queue must be cleared or
      // a re-submit would advance them a second time. `hadDeferred` is captured
      // before `pendingBatchDeferred` is cleared.
      if (willComplete || hadDeferred) { setScanQueue([]); setDryerDurations({}); }
        return;
      }

      try {
        const submitOnce = (extraCycleFields: Record<string, any> = {}) => core.submitChecklist({
          filterId: checklistDialog.filterId,
          filterName: checklistDialog.filterName,
          answers: checklistAnswers,
          expectedProfileVersions,
          filterSet: ahuSetChoiceRef.current ?? undefined,
          password,
          ...(Object.keys(extraCycleFields).length > 0 ? { extraCycleFields } : {}),
        });
        // A checklist on the FIRST stage parks the whole cycle START on this
        // dialog, so this submit is where the start actually happens — and
        // where the missed-PM question has to be answered (2026-10-01).
        let executed: boolean;
        if (checklistDialog.deferredAdvance?.cyclePayload) {
          const started = await startWithPmGate(checklistDialog.filterId, submitOnce);
          if (started.cancelled) return; // offline question dismissed — nothing sent or queued
          executed = started.result.executed;
        } else {
          executed = (await submitOnce()).executed;
        }
        setSuccess(`Checklist submitted${executed ? '' : ' (queued)'}`);
        setChecklistAnswers({});
        setRemarks(''); // B1/B2: clear remarks after a checklist-gated submit too
        // Combined-screen UX: once the checklist is submitted, the stage flow
        // for this filter is fully complete — drop the recap so the next stage
        // doesn't show last cycle's data.
        setStageSubmitRecap(null);
        // Dialog close + offline cache-clear + batch walking handled by core.submitChecklist.
        // Robust refresh (see batch branch): hard revalidate + re-prime this
        // filter's /current-state so a completed cycle drops out of the view now.
        if (executed && online) {
          await mutate('/api/assets/instances', undefined, { revalidate: true });
          try {
            const st = await apiClient.get<any>(`/api/filters/${checklistDialog.filterId}/current-state`);
            if (st) await cache(`filter-state-${checklistDialog.filterId}`, st, 24 * 60 * 60 * 1000);
          } catch { /* best-effort prime */ }
        }
      } catch (e: any) {
        // INTERLOCK: server returns 422 AHU_INTERLOCK_PENDING only at the terminal
        // checklist (when shouldComplete=true). Show the blocking dialog; the
        // operator must click Close, then wait for siblings to finish.
        if (e?.code === 'AHU_INTERLOCK_PENDING' && ahuMode === 'INTERLOCK') {
          const info = e?.connectionInfo ?? {};
          const pending = (info.pendingFilters as { id: string; name: string; stage: string }[]) ?? [];
          const filters = (info.filters as { id: string; name: string; stage: string; done: boolean }[])
            ?? pending.map((p: any) => ({ ...p, done: false }));
          // Clear the page loading spinner BEFORE showing the blocking dialog so
          // the checklist Submit button doesn't spin behind the interlock modal.
          setLoading(false);
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
        // Re-throw so reauth.execute's onError handler displays the message.
        throw e;
      }
    }, {
      onError: (e: any) => setError(e?.message ?? 'Failed'),
      // A dismissed password prompt is not an error (D-OPS-8): nothing was
      // submitted, the checklist stays open with its answers.
      onCancel: () => setLoading(false),
    });
    setLoading(false);
  };

  // 2026-06-09: block-change approval removed → operator self-confirm. Mark the
  // filter acknowledged; the next start sends acknowledgeBlockChange=true.
  const handleBlockChangeRequest = async () => {
    if (!blockChangeDialog || blockChangeSubmitting) return;
    if (blockChangeMode === 'APPROVAL') {
      if (!online) { setError('Block change requests need an internet connection.'); return; }
      setBlockChangeSubmitting(true);
      // REQUEST_BLOCK_CHANGE is a configurable re-auth row (2026-09-24).
      const body = {
        filterId: blockChangeDialog.filterId, filterName: blockChangeDialog.filterName,
        fromBlockId: blockChangeDialog.homeBlockId, fromBlockName: blockChangeDialog.homeBlockName,
        toBlockId: blockChangeDialog.requestedBlockId, toBlockName: blockChangeDialog.requestedBlockName,
        reason: blockChangeReason.trim() || undefined,
      };
      await reauth.execute('REQUEST_BLOCK_CHANGE', async (password?) => {
        if (password) await apiClient.postWithReauth('/api/block-change-requests', body, password);
        else await apiClient.post('/api/block-change-requests', body);
      }, {
        onSuccess: () => {
          setSuccess('Block change request submitted. Waiting for approval.');
          core.dispatch({ type: 'close' }); setScanValue('');
          setBlockChangeSubmitting(false);
        },
        onError: (e: any) => { setError(e?.message ?? 'Failed to submit request'); setBlockChangeSubmitting(false); },
        onCancel: () => setBlockChangeSubmitting(false),
      });
      return;
    }
    // CONFIRM mode: self-confirm.
    ackedBlockFiltersRef.current.add(blockChangeDialog.filterId);
    core.dispatch({ type: 'close' });
    setBlockChangeReason('');
    setSuccess(`Confirmed. Scan ${blockChangeDialog.filterName} again to clean it in this block.`);
  };

  const genOpts = (min: number, max: number, step: number): number[] => { const o: number[] = []; if (step <= 0) return o; for (let v = min, i = 0; v <= max + 1e-9 && i < 10000; v = Math.round((v + step) * 1e10) / 1e10, i++) o.push(v); return o; };

  // 2026-05-21 fix: same as mobile-wrapper.tsx — only redirect when truly
  // unauthenticated. SWR's mutate(undefined,false) at logout leaves a cache
  // entry with value=undefined; on next mount isLoading is false (cache hit)
  // while user is briefly undefined → without the token guard below, the
  // operator was bounced back to /m/login right after a successful login.
  const hasAuthTokenInStorage = !!sessionStorage.getItem('access_token');
  if (!authLoading && !user && !hasAuthTokenInStorage) {
    return <Navigate to="/m/login" replace />;
  }
  if (tabletAccess && allowedFeatures.length > 0 && !hasFeature('login')) {
    return <Navigate to="/m/login" replace />;
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 select-none overflow-hidden">
      {/* Success / error / warning all surface as toast popups (2026-05-25).
          Inline banners removed — see the useEffect block above where success,
          error and batchCacheError fan out to
          toast.error / toast.success. */}
      {batchCacheError && online && (
        <div className="mx-4 mt-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>⚠ Offline pre-cache failed. New filters may not work offline. {batchCacheError}</span>
          <button onClick={manualRecache} disabled={recaching} className="px-3 py-1 bg-amber-100 hover:bg-amber-200 disabled:opacity-50 rounded-lg text-xs font-semibold whitespace-nowrap">
            {recaching ? 'Re-caching…' : 'Retry'}
          </button>
        </div>
      )}
      {rfidError && view === 'stage' && (
        <div className="mx-4 mt-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>📡 RFID reader: {rfidError}. You can still type/scan manually into the input.</span>
          <button
            onClick={async () => {
              setRfidError(null);
              const { reconnectRfid } = await import('@/lib/rfid-bridge');
              const r = await reconnectRfid();
              if (!r.ok) setRfidError(r.error ?? 'reconnect failed');
              else setSuccess('RFID reader reconnected');
            }}
            className="px-3 py-1 bg-amber-100 hover:bg-amber-200 rounded-lg text-xs font-semibold whitespace-nowrap">
            Reconnect
          </button>
        </div>
      )}
      {/* Stage interlock — paused awaiting the configured approver (server already removed the
          advance action; this explains why). */}
      {interlock?.blocksLeaving && view === 'stage' && (
        <div className="mx-4 mt-2 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-800 flex items-start gap-2">
          <span className="text-base leading-none">🛡️</span>
          <div>
            <div className="font-semibold">{interlockBannerTitle(interlock)}</div>
            <div className="text-amber-700 mt-0.5 text-[13px]">{interlockBannerDetail(interlock)}</div>
          </div>
        </div>
      )}
      {/* RFID debug overlay — shows every keydown the WebView receives so
          operators can verify whether UKB-mode keystrokes are arriving.
          Tap the floating button bottom-right to toggle. */}
      <button
        onClick={() => setRfidDebugVisible(v => !v)}
        className="fixed bottom-4 right-4 z-[60] w-10 h-10 rounded-full bg-slate-800/80 text-white text-xs font-bold shadow-lg active:bg-slate-700"
        title="Toggle RFID debug"
      >
        {rfidDebugVisible ? '✕' : 'ⓘ'}
      </button>
      {rfidDebugVisible && (
        <div className="fixed bottom-16 right-4 z-[60] w-80 max-h-96 bg-slate-900/95 text-emerald-300 text-[11px] font-mono rounded-xl shadow-2xl border border-slate-700 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800/60">
            <span className="text-slate-300 font-bold">RFID DEBUG ({rfidDebug.length})</span>
            <button onClick={() => setRfidDebug([])} className="text-amber-400 underline">clear</button>
          </div>
          <div className="overflow-y-auto p-2 space-y-0.5">
            {rfidDebug.length === 0 ? (
              <div className="text-slate-500 italic">Waiting for keystrokes… trigger the RFID reader now.</div>
            ) : (
              rfidDebug.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>
        </div>
      )}
      {/* Error banner removed 2026-05-25 — error surfaces via toast.error()
          popup in the useEffect above so it's visible from any view. Keeping
          this comment in case the inline banner is restored later. */}

      {/* ─── CONTENT ─── */}
      <div className="flex-1 overflow-y-auto">

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
                  {/*
                    "Skip Block" is intentionally disabled for needsBlock: true stages.
                    Allowing it would set selectedBlock.id = null and bypass the offline
                    home-block vs current-block validation — non-compliant with 21 CFR Part 11
                    because a filter could then be advanced in any block without approval.
                  */}
                </div>
              </div>
            )}

            {/* Scan + Submit */}
            {(!activeStage.needsBlock || selectedBlock) && (
              <div className="space-y-3">
                {selectedBlock && (
                  <div className="flex items-center justify-between bg-cyan-50 border border-cyan-200 rounded-xl px-3 py-2">
                    <span className="text-xs text-cyan-700 font-medium">Block: {selectedBlock.name}</span>
                    <button onClick={() => {
                      setSelectedBlock(null);
                    }} className="text-[10px] text-cyan-600 underline">Change</button>
                  </div>
                )}

                <div className="flex gap-2">
                  {/* 2026-05-20: scan field is RFID-only — no manual text
                      entry. readOnly prevents the on-screen keyboard from
                      surfacing on tap AND blocks pasted/typed input from
                      appearing in the field. The global RFID-burst handler
                      above still writes the EPC into scanValue via
                      setScanValue (React state update bypasses readOnly).
                      The +Add button is gone — RFID auto-flush + Enter/Tab
                      submit are the only paths into the queue. */}
                  <input ref={scanInputRef} type="text" value={scanValue} readOnly
                    onBlur={() => {
                      if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
                      refocusTimerRef.current = setTimeout(() => {
                        refocusTimerRef.current = null;
                        const ae = document.activeElement;
                        if (!ae || ae === document.body) focusScanInput();
                      }, 50);
                    }}
                    placeholder="Scan RFID tag..."
                    aria-label="Scan RFID tag"
                    data-rfid="true"
                    className="flex-1 bg-white border-2 border-slate-200 rounded-2xl px-4 py-4 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 shadow-sm cursor-default" autoFocus />
                </div>

                {/* Scan Queue */}
                {scanQueue.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        <input type="checkbox" className="w-5 h-5 accent-cyan-600"
                          checked={scanQueue.length > 0 && scanQueue.every(q => selectedQueueIds.has(q.filterId))}
                          onChange={e => selectAllQueue(e.target.checked)} />
                        Queue ({scanQueue.length}) · {scanQueue.filter(q => selectedQueueIds.has(q.filterId)).length} selected
                      </label>
                      {/* Dry In multi-select (2026-09-04): ONE duration for every selected filter. */}
                      {activeStage?.key === 'DRY_IN' && (
                        <label className="flex items-center gap-1.5 text-xs text-slate-600">
                          Duration
                          <select value={dryerBatchDuration} onChange={e => applyBatchDuration(Number(e.target.value))}
                            className="bg-white border border-slate-300 rounded-md px-2 py-1 text-xs text-slate-700">
                            {[5, 10, 15, 30, 45, 60, 90, 120, 180, 240].map(m => <option key={m} value={m}>{m} min</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                    {scanQueue.map(q => (
                      <div key={q.filterId} className="flex items-center justify-between gap-2 py-1.5 px-2 bg-slate-50 rounded-lg">
                        <input type="checkbox" aria-label={`Select ${q.filterName}`} className="w-5 h-5 accent-cyan-600 shrink-0" checked={selectedQueueIds.has(q.filterId)} onChange={() => toggleQueueSelect(q.filterId)} />
                        <span className="text-sm font-medium text-slate-700 min-w-0 flex-1">
                          {q.filterName}
                          {q.ahuName && (
                            <span className="ml-2 text-xs font-normal text-slate-500">· {q.ahuName}</span>
                          )}
                        </span>
                        {/* per-filter duration select removed 2026-09-04: one duration for the selection lives in the header */}
                        <button onClick={() => removeFromQueue(q.filterId)} className="text-red-400 text-xs hover:text-red-600 shrink-0">Remove</button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Remarks (optional)" aria-label="Remarks" rows={2}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500" />

                {/* 2026-05-20: tablet now ALWAYS queues on scan — no single-
                    scan auto-submit. Operator can scan multiple filters and
                    confirm the queue before submitting all. The "Submit"
                    button is disabled until at least one filter is queued. */}
                <button onClick={handleSubmitQueue} disabled={loading || scanQueue.every(q => !selectedQueueIds.has(q.filterId))}
                  className={`w-full py-4 bg-gradient-to-r ${activeStage.gradient} text-white rounded-2xl font-bold text-base disabled:opacity-40 active:opacity-90 flex items-center justify-center gap-2 shadow-lg`}>
                  {loading
                    ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>Submitting{scanQueue.length > 0 ? ` ${scanQueue.length} filter${scanQueue.length === 1 ? '' : 's'}` : ''}…</span></>
                    : <>✓ Submit {scanQueue.length > 0 ? `Selected (${scanQueue.filter(q => selectedQueueIds.has(q.filterId)).length})` : ''}</>}
                </button>
              </div>
            )}

            {/* Currently Drying Panel — shows filters with active dryer timers */}
            {activeStage.key === 'DRY_IN' && selectedBlock && (() => {
              // Scope to the selected block (rows carry parentId = their AHU).
              const dryingFilters = filtersInBlock(
                allFilters
                  .filter((f: any) => f.currentLifecycleState === 'DRY_IN')
                  .map((f: any) => ({ ...f, ahuId: f.ahuId ?? f.parentId })),
                selectedBlock?.id,
                ahuBlockMap,
              );
              if (dryingFilters.length === 0) return null;
              return (
                <DryingFiltersPanel
                  filters={dryingFilters}
                  online={online}
                  executeOrQueue={executeOrQueue as any}
                  getCache={getCache}
                  cacheData={cache}
                  onSuccess={(msg) => { setSuccess(msg); mutate('/api/assets/instances'); refreshOfflineData(); }}
                  onError={setError}
                  variant="mobile"
                  overlayBackRef={overlayBackRef}
                  // The page's own AHU pre-flight (POPUP / INTERLOCK + the A/B/All
                  // chooser), once per Submit, for the readings that complete
                  // their cycle — the same wiring as the desktop page.
                  ahuPreflight={async (ids) => {
                    ahuSetChoiceRef.current = null;
                    if (ahuMode === 'NONE') return { proceed: true, filterSet: null };
                    const proceed = (await runAhuGate(ids)) === 'proceed';
                    return { proceed, filterSet: ahuSetChoiceRef.current };
                  }}
                />
              );
            })()}

            {/* Stage Recent — split into Success / Failure (B3/C2), all shown (no 20 cap) */}
            {(() => {
              const stageOps = recentOps.filter(op => op.stage === activeStage.key);
              if (stageOps.length === 0) return null;
              const successOps = stageOps.filter(op => op.status !== 'failed');
              const failureOps = stageOps.filter(op => op.status === 'failed');
              return (
                <div className="space-y-3 mt-2">
                  {successOps.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Submitted · {successOps.length}</h3>
                      {successOps.map((op, i) => (
                        <div key={`s${i}`} className="flex items-center justify-between bg-white border border-emerald-200 rounded-lg px-3 py-2">
                          <span className="text-xs text-slate-700 font-medium">{op.filter}</span>
                          <span className="text-[10px] text-slate-400">{op.time} {op.queued ? '⏳' : '✓'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {failureOps.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">Failed · {failureOps.length}</h3>
                      {failureOps.map((op, i) => (
                        <div key={`f${i}`} className="flex items-start justify-between gap-2 bg-white border border-red-200 rounded-lg px-3 py-2">
                          <div className="min-w-0">
                            <span className="block text-xs text-slate-700 font-medium">{op.filter}</span>
                            {op.msg && <span className="block text-[10px] text-red-500 truncate">{op.msg}</span>}
                          </div>
                          <span className="text-[10px] text-slate-400 shrink-0">{op.time} ✕</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
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
              {pmReasonDue && (
                <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
                  This filter is in the <span className="font-semibold">PM schedule</span>. Reason defaults to <span className="font-semibold">PM</span> — confirm to continue, or pick another reason.
                  <span className="block text-xs text-emerald-600 mt-0.5">A non-PM reason will leave this task pending in My Tasks.</span>
                </div>
              )}
              {cleaningReasons.filter((r: any) => r.isActive !== false).map((r: any) => (
                <button key={r.key} onClick={() => { if (r.key !== selectedReason) { setSelectedReason(r.key); setJustification(''); } }} className={`w-full text-left px-4 py-3 rounded-xl border-2 ${selectedReason === r.key ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200'}`}>
                  <div className="text-sm font-medium text-slate-800">{r.name}</div>
                  {r.requiresJustification && <div className="text-[10px] text-amber-600">Requires justification</div>}
                </button>
              ))}
              {cleaningReasons.find((r: any) => r.key === selectedReason)?.requiresJustification && (
                <textarea className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm" rows={2} placeholder="Justification (min 10 chars)" aria-label="Justification" value={justification} onChange={e => setJustification(e.target.value)} />
              )}
            </div>
            {(() => {
              // Match server contract at start-cycle.ts:78 — block submit when
              // the selected reason has requiresJustification=true unless the
              // operator has typed at least 10 chars. Pre-fix the button was
              // enabled and the server returned 400 JUSTIFICATION_REQUIRED,
              // which use-core.ts then misclassified as "queued" (bug fix 5/25).
              const reason = cleaningReasons.find((r: any) => r.key === selectedReason);
              const needsJustification = !!reason?.requiresJustification;
              const justificationOk = !needsJustification || justification.trim().length >= 10;
              const submitDisabled = loading || !selectedReason || !justificationOk;
              return (
                <div className="p-4 border-t border-slate-200 flex gap-3">
                  <button onClick={() => core.dispatch({ type: 'close' })} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium">Cancel</button>
                  <button onClick={handleReasonSubmit} disabled={submitDisabled} className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-bold disabled:opacity-40">{loading ? 'Starting...' : 'Start'}</button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Equipment */}
      {equipDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 rounded-t-3xl"><h2 className="text-lg font-bold text-white">{equipDialog.stage === 'DRY_IN' ? 'Dryer Temperature' : 'Equipment Readings'}</h2><p className="text-amber-100 text-sm">{equipDialog.filterName}</p></div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              {!equipDialog.cycleGroup && (equipDialog.groups as any[]).map((g: any) => (
                <button key={g.id} onClick={() => { setSelectedEquipGroup(g); setReadings({}); setEquipSource({}); setEquipFetchStatus(''); setEquipPending(new Set()); setEquipManualFallback(new Set()); }} className={`w-full text-left px-4 py-3 rounded-xl border-2 ${selectedEquipGroup?.id === g.id ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200'}`}>
                  <div className="text-sm font-medium text-slate-800">{g.name}</div>
                </button>
              ))}
              {selectedEquipGroup && (() => {
                const stageInsts = (selectedEquipGroup.instruments ?? []).filter((i: any) => i.stageKey === equipDialog.stage);
                // Auto-fetch is online-only. Offline → every instrument reverts to
                // the manual stepped-dropdown (operatingMin/Max + leastCount). P5.
                // A timed-out instrument reverts to the dropdown — but only if
                // the dropdown would actually have entries (a zero/absent
                // leastCount yields none, and an empty select is a dead end).
                const isAutoInstrument = (i: any): boolean =>
                  i.autoFetchEnabled === true
                  && online
                  && !(equipManualFallback.has(i.id) && genOpts(i.operatingMin, i.operatingMax, i.leastCount).length > 0);
                // "Get Values" + its status line follow the CONFIGURATION, not the
                // per-instrument fallback (as equipment-dialog.tsx does): when every
                // auto instrument had timed out they vanished, taking the retry and
                // the "couldn't be fetched" explanation with them (2026-10-22).
                const hasAuto = online && stageInsts.some((i: any) => i.autoFetchEnabled === true);
                return (
                  <>
                    {hasAuto && (
                      <button type="button" onClick={handleGetValuesMobile} disabled={equipFetching}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-xl bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50">
                        {equipFetching ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                        {equipFetching ? 'Fetching…' : 'Get Values'}
                      </button>
                    )}
                    {hasAuto && equipFetchStatus && <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{equipFetchStatus}</div>}
                    {stageInsts.map((inst: any) => {
                      const val = readings[inst.id];
                      const src = equipSource[inst.id];
                      const oor = val !== undefined && (val < inst.operatingMin || val > inst.operatingMax);
                      return (
                        <div key={inst.id}>
                          <div className="flex items-center gap-2">
                            <label htmlFor={`equip-reading-${inst.id}`} className="text-sm font-medium text-slate-700">{inst.description} ({inst.uom})</label>
                            {src === 'AUTO' && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700">Auto · locked</span>}
                          </div>
                          {isAutoInstrument(inst) ? (
                            <input id={`equip-reading-${inst.id}`} type="number" step="any" inputMode="decimal" value={val ?? ''} onChange={e => setEquipReading(inst.id, e.target.value)}
                              readOnly={isEquipLocked(inst.id)}
                              aria-readonly={isEquipLocked(inst.id)}
                              placeholder={equipFetching && equipPending.has(inst.id) ? 'Fetching…' : 'Enter or fetch'}
                              className={`w-full mt-1 border rounded-xl px-4 py-3 text-sm ${isEquipLocked(inst.id) ? 'bg-slate-100 text-slate-600' : 'bg-white'} ${oor ? 'border-amber-400' : 'border-slate-200'}`} />
                          ) : (
                            <select id={`equip-reading-${inst.id}`} value={val ?? ''} onChange={e => setEquipReading(inst.id, e.target.value)} className="w-full mt-1 border border-slate-200 rounded-xl px-4 py-3 text-sm bg-white">
                              <option value="">Select...</option>{genOpts(inst.operatingMin, inst.operatingMax, inst.leastCount).map(v => <option key={v} value={v}>{formatByLeastCount(v, inst.leastCount)} {inst.uom}</option>)}
                            </select>
                          )}
                          {oor && <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">Operating range ({formatByLeastCount(inst.operatingMin, inst.leastCount)}–{formatByLeastCount(inst.operatingMax, inst.leastCount)} {inst.uom}) — confirm to submit.</div>}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3"><button onClick={() => core.dispatch({ type: 'close' })} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium">Cancel</button><button onClick={handleEquipSubmit} disabled={loading || equipFetching || !selectedEquipGroup || (() => { const insts = (selectedEquipGroup?.instruments ?? []).filter((i: any) => i.stageKey === equipDialog.stage); return insts.length > 0 && insts.some((i: any) => readings[i.id] === undefined); })()} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold disabled:opacity-40">{loading ? 'Submitting...' : 'Submit'}</button></div>
          </div>
        </div>
      )}

      {/* Checklist — combined-screen UX (2026-05-25): the readings are
          already submitted server-side at this point; the dialog shows a
          ✓ confirmation banner up top with the stage info + readings recap
          (when available) so the operator sees BOTH on one screen instead
          of perceiving the checklist as an unrelated second step. The
          checklist questions themselves and the Submit button are below. */}
      {checklistDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl animate-slide-up">
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-5 py-4 rounded-t-3xl flex items-center gap-3 shrink-0">
              <svg className="w-6 h-6 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              <div><h2 className="text-lg font-bold text-white">Checklist Required</h2><p className="text-purple-100 text-sm">{checklistDialog.filterName}</p>{isStartChecklist(checklistDialog.checklists as any[])
                ? <p className="text-purple-100 text-xs">Checklist before the first stage</p>
                : (checklistStage ?? activeStage?.key) && <p className="text-purple-100 text-xs">{stageLabel((checklistStage ?? activeStage?.key)!)} stage checklist</p>}</div>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              {/* Stage-submitted recap (2026-05-25 combined-screen UX).
                  Only renders when the snapshot was actually captured during
                  the just-completed handleEquipSubmit. Pre-fix this also
                  fell back to `activeStage` which led to a misleading
                  "✓ Wash In submitted" header when the checklist opened
                  from a pending-cycle state where the operator hadn't gone
                  through the reason + equipment + readings dialogs. Now:
                  no recap → no banner. The operator's reason/equip flow
                  fires (via dispatch open_reason / open_equipment) BEFORE
                  the checklist ever auto-opens. */}
              {stageSubmitRecap && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <div className="text-sm font-semibold text-emerald-800">
                      {stageSubmitRecap.stage.replace(/_/g, ' ')} submitted
                    </div>
                    <div className="text-[10px] text-emerald-600 ml-auto">{stageSubmitRecap.submittedAt}</div>
                  </div>
                  {stageSubmitRecap.readings.length > 0 ? (
                    <div className="space-y-1">
                      {stageSubmitRecap.readings.map((r, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-emerald-700">{r.description}</span>
                          <span className="font-mono text-emerald-900 font-semibold">{r.value} {r.uom}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-700">Readings recorded. Please complete the checklist below to finalize this step.</div>
                  )}
                </div>
              )}
              {((checklistDialog.checklists as any[]) ?? []).map((cl: any) => (
                <div key={cl.pipelineNodeId}>
                  <h3 className="text-sm font-semibold text-purple-700 uppercase tracking-wider mb-3">{cl.checklistProfileName}</h3>
                  <div className="space-y-4">
                    {(!Array.isArray(cl.questions) || cl.questions.length === 0) && (
                      <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                        Couldn't load this checklist's questions. Reconnect and refresh, then reopen this checklist before submitting.
                      </div>
                    )}
                    {(cl.questions ?? []).map((q: any, qi: number, arr: any[]) => {
                      const prevSection = qi > 0 ? arr[qi - 1].section : null;
                      const showSection = q.section && q.section !== prevSection;
                      const val = checklistAnswers[q.id] ?? '';
                      const setVal = (v: any) => setChecklistAnswers(p => ({ ...p, [q.id]: v }));
                      return (
                        <div key={q.id}>
                          {showSection && <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-2 mb-1 border-b border-slate-200 pb-1">{q.section}</div>}
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="text-slate-400 text-xs font-mono mt-0.5 w-5 shrink-0">{qi + 1}.</span>
                              <div className="flex-1">
                                <p className="text-sm text-slate-700">{q.question}{q.required && <span className="text-red-600 ml-1">*</span>}</p>
                                {q.description && <p className="text-xs text-slate-400 mt-0.5">{q.description}</p>}
                              </div>
                            </div>
                            <div className="ml-7">
                              {q.questionType === 'YES_NO' ? (
                                <div className="flex gap-2">
                                  {['Yes', 'No'].map(opt => <button key={opt} type="button" onClick={() => setVal(opt)} aria-pressed={val === opt} className={`flex-1 py-2.5 rounded-xl text-sm border-2 transition-colors inline-flex items-center justify-center gap-1 ${val === opt ? 'font-bold bg-cyan-600 text-white border-cyan-600' : 'font-medium bg-white text-slate-600 border-slate-200'}`}>{val === opt && <span aria-hidden="true">✓</span>}{opt}</button>)}
                                </div>
                              ) : q.questionType === 'YES_NO_NA' ? (
                                <div className="flex gap-2">
                                  {['Yes', 'No', 'N/A'].map(opt => <button key={opt} type="button" onClick={() => setVal(opt)} aria-pressed={val === opt} className={`flex-1 py-2.5 rounded-xl text-sm border-2 transition-colors inline-flex items-center justify-center gap-1 ${val === opt ? 'font-bold bg-cyan-600 text-white border-cyan-600' : 'font-medium bg-white text-slate-600 border-slate-200'}`}>{val === opt && <span aria-hidden="true">✓</span>}{opt}</button>)}
                                </div>
                              ) : q.questionType === 'PASS_FAIL' ? (
                                <div className="flex gap-2">
                                  {['Pass', 'Fail'].map(opt => <button key={opt} type="button" onClick={() => setVal(opt)} aria-pressed={val === opt} className={`flex-1 py-2.5 rounded-xl text-sm border-2 transition-colors inline-flex items-center justify-center gap-1 ${val === opt ? `font-bold text-white ${opt === 'Pass' ? 'bg-green-600 border-green-600' : 'bg-red-600 border-red-600'}` : 'font-medium bg-white text-slate-600 border-slate-200'}`}>{val === opt && <span aria-hidden="true">✓</span>}{opt}</button>)}
                                </div>
                              ) : q.questionType === 'DROPDOWN' ? (
                                <select value={val} onChange={e => setVal(e.target.value)} aria-label={q.question} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none">
                                  <option value="">Select...</option>
                                  {(Array.isArray(q.options) ? q.options : []).map((opt: any, i: number) => <option key={i} value={typeof opt === 'string' ? opt : opt.value}>{typeof opt === 'string' ? opt : opt.label}</option>)}
                                </select>
                              ) : q.questionType === 'MULTI_SELECT' ? (
                                <div className="flex flex-wrap gap-2">
                                  {(Array.isArray(q.options) ? q.options : []).map((opt: any, i: number) => {
                                    const optVal = typeof opt === 'string' ? opt : opt.value;
                                    const optLabel = typeof opt === 'string' ? opt : opt.label;
                                    const selected = Array.isArray(val) && val.includes(optVal);
                                    return <button key={i} type="button" aria-pressed={selected} onClick={() => { const arr = Array.isArray(val) ? [...val] : []; setVal(selected ? arr.filter((v: string) => v !== optVal) : [...arr, optVal]); }} className={`px-3 py-2 rounded-xl text-sm border-2 transition-colors inline-flex items-center gap-1 ${selected ? 'font-bold bg-cyan-600 text-white border-cyan-600' : 'font-medium bg-white text-slate-600 border-slate-200'}`}>{selected && <span aria-hidden="true">✓</span>}{optLabel}</button>;
                                  })}
                                </div>
                              ) : q.questionType === 'NUMERIC' ? (
                                <div>
                                  <input type="number" value={val} onChange={e => setVal(e.target.value)} aria-label={q.question}
                                    min={q.validation?.min} max={q.validation?.max} step={q.validation?.leastCount || 'any'}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none" placeholder={q.validation?.unit ? `Enter value (${q.validation.unit})` : 'Enter value'} />
                                  {(q.validation?.min !== undefined || q.validation?.max !== undefined) && (
                                    <p className="text-xs text-slate-400 mt-1">Range: {q.validation.min ?? '—'} – {q.validation.max ?? '—'}{q.validation.unit ? ` ${q.validation.unit}` : ''}</p>
                                  )}
                                </div>
                              ) : q.questionType === 'PHOTO' ? (
                                <div>
                                  <input type="file" accept="image/*" capture="environment" aria-label={q.question} onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    const reader = new FileReader();
                                    reader.onload = () => setVal(reader.result as string);
                                    reader.readAsDataURL(file);
                                  }} className="w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100" />
                                  {val && typeof val === 'string' && val.startsWith('data:image') && (
                                    <img src={val} alt="Captured" className="mt-2 rounded-xl max-h-32 object-cover border border-slate-200" />
                                  )}
                                </div>
                              ) : (
                                // C-04 (2026-10-19): SIGNATURE falls through to the
                                // typed answer, exactly as the web checklist dialog
                                // (checklist-dialog.tsx `default:`). The tablet had
                                // a "not available" note with no input, so a
                                // REQUIRED signature question blocked the batch.
                                <textarea value={val} onChange={e => setVal(e.target.value)} rows={2} aria-label={q.question}
                                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none" placeholder="Enter answer" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* Inline error banner replaced by toast.error() popup (2026-05-25) — see useEffect above. */}
            </div>
            <div className="px-5 pt-3 pb-1 text-[11px] text-slate-500 italic">
              This checklist is mandatory under 21 CFR §11 — closing here will keep the cycle paused. The dialog will reappear on the next scan.
            </div>
            <div className="px-5 py-4 border-t border-slate-200 shrink-0 flex gap-3">
              {/* Renamed Cancel → Close (2026-05-25): operators were treating
                  Cancel as "skip the checklist" — but the server-side gate
                  refuses to advance without it, so the dialog re-opened on
                  next action. "Close" + the hint above makes the contract
                  explicit. dispatch close still actually closes the dialog. */}
              <button onClick={() => { core.dispatch({ type: 'close' }); setPendingBatch(null); setPendingBatchDeferred(null); }} disabled={loading} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-40">Close</button>
              <button onClick={handleChecklistSubmit} disabled={loading} className="flex-1 py-3 bg-purple-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-purple-500 transition-colors">
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>Submit Checklist</>}
              </button>
            </div>
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
                  <h3 className="text-lg font-bold text-slate-800">{blockChangeMode === 'APPROVAL' ? 'Block change approval needed' : 'Cleaning in a different block'}</h3>
                  <p className="text-xs text-slate-400">This filter belongs to another block</p>
                </div>
              </div>
              <div className="space-y-3 mb-5">
                <div className="bg-slate-50 rounded-xl p-3 text-sm">
                  <div className="text-slate-500">Filter: <span className="font-semibold text-slate-800">{blockChangeDialog.filterName}</span></div>
                  <div className="text-slate-500 mt-1">Belongs to: <span className="font-semibold text-slate-800">{blockChangeDialog.homeBlockName}</span></div>
                  <div className="text-slate-500 mt-1">Cleaning in: <span className="font-semibold text-amber-700">{blockChangeDialog.requestedBlockName}</span></div>
                </div>
                {blockChangeMode === 'APPROVAL' ? (
                  <div>
                    <p className="text-sm text-slate-600 mb-2">Cleaning this filter in <span className="font-semibold text-amber-700">{blockChangeDialog.requestedBlockName}</span> needs approval. Submit a request below.</p>
                    <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" rows={2}
                      value={blockChangeReason} onChange={e => setBlockChangeReason(e.target.value)}
                      placeholder="Why does this filter need to be cleaned in a different block?"
                      aria-label="Reason for cleaning in a different block" />
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">
                    This filter belongs to <span className="font-semibold">{blockChangeDialog.homeBlockName}</span>. You are cleaning it in{' '}
                    <span className="font-semibold text-amber-700">{blockChangeDialog.requestedBlockName}</span>. Continue with cleaning?
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { core.dispatch({ type: 'close' }); setScanValue(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={handleBlockChangeRequest} disabled={blockChangeSubmitting || (blockChangeMode === 'APPROVAL' && !blockChangeReason.trim())}
                  className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-cyan-500/25">
                  {blockChangeMode === 'APPROVAL' ? 'Request approval' : 'Continue with cleaning'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

      {/* Rendered here, in the MAIN component, alongside the reauth dialog —
          both are last-step confirmations over whatever screen is showing. */}
      {pmGate && (
        <PmPendingTasksDialog
          tasks={pmGate.tasks}
          minReasonLength={pmGate.minReasonLength}
          formatDate={formatDate}
          onCancel={() => { pmGate.resolve(null); setPmGate(null); }}
          onConfirm={(skips) => { pmGate.resolve(skips); setPmGate(null); }}
        />
      )}
    </div>
  );
}
