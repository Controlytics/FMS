import { useState, useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { useOffline } from '../../hooks/use-offline';
import { onSyncEvent } from '../../lib/sync-engine';
import { DryerDurationDialog } from '../filter-management/components/dryer-duration-dialog';
import { formatByLeastCount } from '@/lib/format-by-least-count';
import { subscribeRfidTags } from '@/lib/rfid-bridge';

const STAGES = [
  { key: 'WASH_IN', label: 'Wash In', icon: '🚿', gradient: 'from-sky-500 to-sky-600', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '💧', gradient: 'from-sky-400 to-sky-500', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-600', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '🌡️', gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '☀️', gradient: 'from-amber-400 to-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '📥', gradient: 'from-slate-500 to-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '📤', gradient: 'from-slate-400 to-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', needsBlock: false },
];

type View = 'home' | 'status' | 'stage' | 'my-tasks' | 'approvals';

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

export function MobileOperationsPage({ initialStageKey, hideHeader }: { initialStageKey?: string; hideHeader?: boolean } = {}) {
  const { user, isLoading: authLoading, logout: authLogout } = useAuth();
  const { formatTime } = useDatetimeFormat();
  const { online, pendingCount, syncing, lastSyncMessage, executeOrQueue, manualSync, clearQueue, getQueueDetails, cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();
  const mobileNav = useNavigate();

  if (!authLoading && !user) return <Navigate to="/m/login" replace />;

  // Tablet access control — which features are allowed for this role
  const { data: tabletAccess } = useSWR(user && online ? '/api/config/tablet-access/my-features' : null);
  const allowedFeatures: string[] = (tabletAccess as any)?.allowed ?? [];
  const hasFeature = (f: string) => allowedFeatures.length === 0 || allowedFeatures.includes(f); // empty = all allowed (backwards compat)

  // If login is disabled for this role, redirect to login
  if (tabletAccess && allowedFeatures.length > 0 && !hasFeature('login')) {
    return <Navigate to="/m/login" replace />;
  }

  const logout = async () => {
    await authLogout();
    mobileNav('/m/login', { replace: true });
  };

  const initialStage = initialStageKey ? STAGES.find(s => s.key === initialStageKey) : null;
  const [view, setView] = useState<View>(initialStage ? 'stage' : 'home');
  const [activeStage, setActiveStage] = useState<typeof STAGES[0] | null>(initialStage ?? null);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [scanQueue, setScanQueue] = useState<Array<{ filterId: string; filterName: string; tagId: string }>>([]);
  const [remarks, setRemarks] = useState('');
  const [blockChangeDialog, setBlockChangeDialog] = useState<{ filterId: string; filterName: string; homeBlockId: string; homeBlockName: string; requestedBlockId: string; requestedBlockName: string } | null>(null);
  const [blockChangeReason, setBlockChangeReason] = useState('');
  const [blockChangeSubmitting, setBlockChangeSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recentOps, setRecentOps] = useState<Array<{ stage: string; filter: string; time: string; queued?: boolean }>>([]);

  // RFID scan input ref + focus management. autoFocus only fires once on mount,
  // so after the first scan succeeds the input loses focus and subsequent RFID
  // keystrokes hit document.body — third-party apps work because they keep one
  // input permanently focused. We do the same: refocus after every successful
  // scan, dialog close, view change, AND we install a global keydown trap on
  // the stage view that pipes RFID-speed keystrokes to the input regardless
  // of where focus is. (RFID readers in UKB mode type 3-50ms between keys;
  // humans type 80-300ms — anything ≤80ms is RFID.)
  const scanInputRef = useRef<HTMLInputElement>(null);
  const focusScanInput = () => {
    // setTimeout(0) so the focus runs after React commits the next paint
    setTimeout(() => { scanInputRef.current?.focus(); }, 0);
  };

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

  // Refocus the scan input whenever we enter the stage view, all dialogs close,
  // or success flashes. autoFocus only fires once on mount, so without this
  // the operator has to manually tap the input after every successful scan
  // before the next RFID trigger does anything.
  useEffect(() => {
    if (view === 'stage' && !reasonDialog && !equipDialog && !checklistDialog && !dryerDialog && !blockChangeDialog) {
      focusScanInput();
    }
  }, [view, reasonDialog, equipDialog, checklistDialog, dryerDialog, blockChangeDialog, success]);

  // Native SDK-mode RFID bridge. When the reader is in answer/SDK mode the OS
  // does NOT inject keystrokes — Reader_Usb.jar reads tags directly via USB
  // and pushes them through Capacitor's RfidPlugin. We subscribe once on the
  // stage view and route every received tag to the scan input + auto-submit.
  // Falls back silently on web (browser) where the plugin isn't available;
  // the document-level keystroke trap below handles UKB-mode readers.
  const [rfidError, setRfidError] = useState<string | null>(null);
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
          // Defer one tick so React applies the value before submit reads it
          setTimeout(() => {
            setScanValue(epc);
            if (scanQueue.length > 0) handleAddToQueue(); else handleSubmit();
          }, 0);
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
    const RFID_INTERVAL_MS = 150;  // ≤ this gap = RFID. Used only to gate captureMode.

    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = lastKeyTime === 0 ? -1 : now - lastKeyTime;
      lastKeyTime = now;

      if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Tab') {
        pushDebug(`key="${e.key}" gap=${gap}ms target=${(e.target as HTMLElement)?.tagName ?? '?'}`);
      }

      // Enter or Tab terminates an RFID burst — most readers append CR/LF/TAB.
      // Submit immediately on terminator. Zero wait.
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (captureMode || buffer.length > 0) {
          e.preventDefault();
          if (buffer.length >= 4) {
            const toSubmit = buffer;
            pushDebug(`SUBMIT: "${toSubmit}" (len ${toSubmit.length})`);
            setScanValue(toSubmit);
            if (view === 'stage') {
              if (scanQueue.length > 0) handleAddToQueue(); else handleSubmit();
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
        // No setTimeout, no flush timer — operator sees the EPC build in real
        // time. If a slow reader doesn't send Enter/Tab, the input still shows
        // the full tag the moment the last character arrives.
        setScanValue(buffer);

        if (!isScanInput && captureMode) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else {
        // Human-speed key after a long gap — reset state in case prior buffer was stale
        buffer = '';
        captureMode = false;
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => {
      document.removeEventListener('keydown', handler, true);
    };
  }, [view, scanQueue.length]);

  // Data — always fetch when online, cache for offline
  const { data: instancesData } = useSWR(online ? '/api/assets/instances?limit=500' : null, { refreshInterval: 15000 });
  const { data: templatesData } = useSWR(online ? '/api/assets/templates?limit=100' : null);
  const { data: reasonsData } = useSWR(online ? '/api/filters/reasons' : null);
  const { data: identifiersData } = useSWR(online ? '/api/assets/identifiers?limit=1000' : null);
  const { data: equipGroupsData } = useSWR(online ? '/api/equipment-groups' : null);
  // B.5 — Cache cleaning-profile-assignment + active profiles so offline scans of
  // a brand-new filter (no filter-state-{id} cache yet) can still resolve a pipeline.
  const { data: cleaningAssignmentData } = useSWR(online ? '/api/config/cleaning-profile-assignment' : null);
  const { data: activeProfilesData } = useSWR(online ? '/api/filter-cleaning-profiles?status=ACTIVE&expand=stages,connections' : null);
  const { data: checklistProfilesData } = useSWR(online ? '/api/checklist-profiles?expand=questions' : null);
  // B.13 — Cache branding/field-ids/datetime config so offline app restart doesn't
  // flash defaults or break field labels until reconnect.
  const { data: brandingData } = useSWR(online ? '/api/config/branding' : null);
  const { data: fieldIdsData } = useSWR(online ? '/api/config/field-ids' : null);
  const { data: datetimeData } = useSWR(online ? '/api/config/datetime/current' : null);
  // B.14 — Cache approved block-change requests so an APPROVED status from a
  // recent server-side approval is visible offline before the cycle starts.
  const { data: approvedBlockChangesData } = useSWR(online ? '/api/block-change-requests?status=APPROVED&limit=200' : null);
  // B.11 — Cache reauth scope for current user so offline ops know which actions
  // need a queued password vs. immediate dialog.
  const { data: myReauthActionsData } = useSWR(online && user ? '/api/config/action-reauth/my-actions' : null);

  // My Tasks + Approvals — fetch when user opens the view, cache for offline
  const { data: dueTasksData, mutate: mutateDueTasks, isLoading: dueTasksLoading } =
    useSWR(online && view === 'my-tasks' ? '/api/pm-schedules/due' : null, { refreshInterval: 30000 });

  const isApprover = user?.role === 'SUPER_ADMIN' || (user?.permissions ?? []).includes('BLOCK_CHANGE_APPROVE');
  const [approvalsFilter, setApprovalsFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>(isApprover ? 'PENDING' : 'ALL');
  const approvalsKey = (online && view === 'approvals')
    ? `/api/block-change-requests?page=1&limit=50&status=${approvalsFilter}${!isApprover ? '&mine=true' : ''}`
    : null;
  const { data: approvalsData, mutate: mutateApprovals, isLoading: approvalsLoading } =
    useSWR<any>(approvalsKey, { refreshInterval: 30000 });

  // Cache tasks and approvals for offline use
  const [offlineTasks, setOfflineTasks] = useState<any>(null);
  const [offlineApprovals, setOfflineApprovals] = useState<any[]>([]);
  useEffect(() => { if (dueTasksData) { cache('due-tasks', dueTasksData); } }, [dueTasksData, cache]);
  useEffect(() => { if (approvalsData?.data) { cache('approvals', approvalsData.data); } }, [approvalsData, cache]);
  useEffect(() => {
    if (!online) {
      getCache<any>('due-tasks').then(t => setOfflineTasks(t));
      getCache<any[]>('approvals').then(a => setOfflineApprovals(a ?? []));
    }
  }, [online, view]);

  const approvals: any[] = online ? (approvalsData?.data ?? []) : offlineApprovals;
  const tasksSource = online ? dueTasksData : offlineTasks;

  // Expand state for My Tasks cards + processing state for Approve/Reject
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [processingApproval, setProcessingApproval] = useState<string | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [offlineFilters, setOfflineFilters] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  const [offlineReasons, setOfflineReasons] = useState<any[]>([]);
  const [dataCached, setDataCached] = useState(false);

  // Revalidate SWR data after sync completes (fixes "buffering" after sync)
  const [prevPendingCount, setPrevPendingCount] = useState(0);
  useEffect(() => {
    // When pending count drops (operations synced), refresh data
    if (prevPendingCount > 0 && pendingCount < prevPendingCount && online) {
      mutate('/api/assets/instances?limit=500');
      mutateDueTasks();
    }
    setPrevPendingCount(pendingCount);
  }, [pendingCount, online]);

  // Also listen for sync events directly
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'complete' && event.synced && event.synced > 0) {
        mutate('/api/assets/instances?limit=500');
        mutateDueTasks();
      }
    });
    return cleanup;
  }, []);

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
  useEffect(() => { if (brandingData) cache('branding-config', brandingData, 24 * 60 * 60 * 1000); }, [brandingData, cache]);
  useEffect(() => { if (fieldIdsData) cache('field-ids-config', fieldIdsData, 24 * 60 * 60 * 1000); }, [fieldIdsData, cache]);
  useEffect(() => { if (datetimeData) cache('datetime-config', datetimeData, 24 * 60 * 60 * 1000); }, [datetimeData, cache]);
  useEffect(() => {
    const list = (approvedBlockChangesData as any)?.data ?? approvedBlockChangesData;
    if (Array.isArray(list)) cache('approved-block-changes', list, 24 * 60 * 60 * 1000);
  }, [approvedBlockChangesData, cache]);
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
  useEffect(() => {
    if (!online || !instancesData?.data) return;
    const timer = setTimeout(cacheAllStates, 2000);
    return () => clearTimeout(timer);
  }, [online, instancesData]);
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

  // Track when all data is cached and ready for offline
  useEffect(() => {
    if (online && instancesData?.data && templatesData?.data && identifiersData && reasonsData) {
      setDataCached(true);
    }
  }, [online, instancesData, templatesData, identifiersData, reasonsData]);

  // Load cached data when offline
  const refreshOfflineData = () => {
    getOfflineFilters().then(setOfflineFilters);
    getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? []));
    getCache<any[]>('cleaning-reasons').then(r => setOfflineReasons(r ?? []));
  };
  useEffect(() => {
    if (!online) refreshOfflineData();
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

  const goHome = () => { setView('home'); setActiveStage(null); setReasonDialog(null); setEquipDialog(null); setChecklistDialog(null); setError(''); setSuccess(''); setScanQueue([]); };

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

  // Add scanned filter to queue (batch mode)
  const handleAddToQueue = async () => {
    if (!scanValue.trim()) return;
    setError('');
    const resolved = await resolveFilter();
    if (!resolved) return;
    if (scanQueue.some(q => q.filterId === resolved.filterId)) {
      setError('Filter already in queue');
      setScanValue('');
      return;
    }
    setScanQueue(prev => [...prev, { ...resolved, tagId: scanValue.trim() }]);
    setScanValue('');
  };

  const removeFromQueue = (filterId: string) => {
    setScanQueue(prev => prev.filter(q => q.filterId !== filterId));
  };

  // Submit all queued filters for the active stage (batch advance for mid-cycle stages).
  // Each item is validated against the cached pipeline graph + block assignment BEFORE
  // being queued — this is the same strict offline gate applied in handleSubmit.
  const handleSubmitQueue = async () => {
    if (scanQueue.length === 0 || !activeStage || loading) return;
    setLoading(true); setError(''); setSuccess('');
    let successCount = 0;
    const failed: string[] = [];
    for (const item of scanQueue) {
      try {
        const cachedFilters = await getOfflineFilters();
        const cached = cachedFilters.find((f: any) => f.id === item.filterId);
        const cachedState = await getCache<any>(`filter-state-${item.filterId}`) ?? {};
        const currentLifecycle = cached?.currentLifecycleState || cachedState.currentState || null;
        let itemNextAllowed: string[] = cachedState.nextAllowedStages ?? [];
        if (itemNextAllowed.length === 0 && cachedState.pipelineGraph) {
          itemNextAllowed = computeNextStages(cachedState.pipelineGraph, currentLifecycle);
        }
        const cycleInProgress = !!(cachedState.currentCycle?.id || cached?.currentCycleId);

        const gate = validateOfflineGate({
          activeStageKey: activeStage.key,
          activeStageLabel: activeStage.label,
          online,
          currentLifecycle,
          nextAllowed: itemNextAllowed,
          hasGraph: !!cachedState.pipelineGraph?.stages,
          hasLinearPipeline: (cachedState.pipelineStages?.length ?? 0) > 0,
          pipelineGraph: cachedState.pipelineGraph,
          cycleInProgress,
          hasPendingChecklist: (cachedState.pendingChecklist?.length ?? 0) > 0,
          dryerReadingsSubmitted: cachedState.currentCycle?.dryerReadingsSubmitted,
          homeBlockId: cachedState.homeBlock?.id,
          blockChangeStatus: cachedState.blockChangeStatus,
          selectedBlockId: selectedBlock?.id,
        });
        if (!gate.ok) {
          failed.push(`${item.filterName}: ${gate.reason}`);
          continue;
        }
        // Batch path: cannot handle interactive reason dialog for new cycles
        if (!cycleInProgress) {
          failed.push(`${item.filterName}: no active cycle — use single scan to start a cycle`);
          continue;
        }

        const { executed } = await executeOrQueue('advance', item.filterId, item.filterName, {
          targetState: activeStage.key, cleaningAreaId: selectedBlock?.id,
          remarks: remarks || `${activeStage.label} - ${item.filterName}`,
        }, activeStage.key);
        if (!executed) await updateOfflineState(item.filterId, activeStage.key, false);
        successCount++;
        setRecentOps(prev => [{ stage: activeStage.key, filter: item.filterName, time: formatTime(new Date()), queued: !executed }, ...prev].slice(0, 20));
      } catch (e: any) {
        failed.push(`${item.filterName}: ${e.message ?? 'failed'}`);
      }
    }
    // Offline parity: if any advanced item now has a pending checklist (per the
    // cleaning profile), open the dialog for the first such filter. Treating
    // CHECKLIST nodes as a stage ensures post-stage questions are never skipped.
    if (successCount > 0) {
      try {
        for (const item of scanQueue) {
          const cs = await getCache<any>(`filter-state-${item.filterId}`);
          if (cs?.pendingChecklist?.length > 0) {
            setChecklistDialog({ filterId: item.filterId, filterName: item.filterName, checklists: cs.pendingChecklist });
            setChecklistAnswers({});
            break;
          }
        }
      } catch { /* ignore — user can re-scan to trigger */ }
    }
    setScanQueue([]);
    if (successCount > 0) setSuccess(`${successCount} filter(s) → ${activeStage.label}${failed.length > 0 ? ` (${failed.length} failed)` : ''}`);
    if (failed.length > 0) setError(failed.join('\n'));
    setLoading(false);
    if (online) mutate('/api/assets/instances?limit=500');
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

  // Compute nextAllowedStages using the FULL pipeline graph (same logic as server's getNextStageKeys)
  const computeNextStages = (graph: any, currentStageKey: string | null): string[] => {
    if (!graph?.stages || !graph?.connections) return [];
    // Find the current node by stateKey
    let currentNode = currentStageKey
      ? graph.stages.find((s: any) => s.stateKey === currentStageKey)
      : graph.stages.find((s: any) => s.nodeType === 'START');
    if (!currentNode) return [];

    // Walk connections from current node, skipping CHECKLIST nodes to find reachable STAGE nodes
    const reachable: string[] = [];
    const visited = new Set<string>();
    const walk = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const outConns = graph.connections.filter((c: any) => c.fromStageId === nodeId);
      for (const conn of outConns) {
        const next = graph.stages.find((s: any) => s.id === conn.toStageId);
        if (!next) continue;
        if (next.nodeType === 'STAGE' && next.stateKey) reachable.push(next.stateKey);
        else if (next.nodeType === 'CHECKLIST') walk(next.id); // skip checklist nodes
      }
    };
    walk(currentNode.id);
    return reachable;
  };

  // SPIS: single-source offline gate shared by handleSubmit (single scan) and
  // handleSubmitQueue (batch). Every offline/online validation rule lives HERE
  // — both callers must go through this. See memory: feedback_batch_single_parity.md.
  type GateInput = {
    activeStageKey: string;
    activeStageLabel: string;
    online: boolean;
    currentLifecycle: string | null;
    nextAllowed: string[];
    hasGraph: boolean;
    hasLinearPipeline: boolean;
    pipelineGraph: any;
    cycleInProgress: boolean;
    hasPendingChecklist: boolean;
    dryerReadingsSubmitted?: boolean;
    homeBlockId?: string | null;
    blockChangeStatus?: string | null;
    selectedBlockId?: string | null;
  };
  type GateResult = { ok: true } | { ok: false; reason: string; blockChangeRequired?: boolean };
  const validateOfflineGate = (g: GateInput): GateResult => {
    const hasValidation = g.hasGraph || g.hasLinearPipeline || g.nextAllowed.length > 0;
    if (!g.online && !hasValidation) {
      return { ok: false, reason: 'offline data not cached — sync first' };
    }
    // Block assignment: home-block mismatch without approval
    const homeMismatch = !!(g.homeBlockId && g.selectedBlockId && g.homeBlockId !== g.selectedBlockId && g.blockChangeStatus !== 'APPROVED');
    if (!g.online && homeMismatch) {
      return { ok: false, reason: 'block change approval required', blockChangeRequired: true };
    }
    // First-stage validation for brand-new cycles
    if (!g.cycleInProgress && g.hasGraph) {
      const firstStages = computeNextStages(g.pipelineGraph, null);
      if (firstStages.length > 0 && !firstStages.includes(g.activeStageKey)) {
        return { ok: false, reason: `cannot start cycle at ${g.activeStageLabel} — start at ${firstStages.map(s => s.replace(/_/g, ' ')).join(', ')}` };
      }
    }
    // In-cycle: activeStage must be in nextAllowed
    if (g.cycleInProgress && g.nextAllowed.length > 0 && !g.nextAllowed.includes(g.activeStageKey)) {
      return { ok: false, reason: `is at ${(g.currentLifecycle ?? 'START').replace(/_/g, ' ')} — next allowed ${g.nextAllowed.map(s => s.replace(/_/g, ' ')).join(', ')}` };
    }
    // Offline: cycle-in-progress + empty nextAllowed is stale cache (unless checklist blocks)
    if (!g.online && g.cycleInProgress && g.nextAllowed.length === 0 && !g.hasPendingChecklist) {
      return { ok: false, reason: 'in-cycle but no next stage cached — re-sync' };
    }
    // DRY_IN guard
    if (g.activeStageKey === 'DRY_IN' && g.dryerReadingsSubmitted) {
      return { ok: false, reason: 'dry-in already recorded — scan on Dry Out' };
    }
    return { ok: true };
  };

  // Find CHECKLIST nodes immediately after a stage in the pipeline graph
  const findChecklistsAfterStage = (graph: any, stageKey: string): any[] => {
    if (!graph?.stages || !graph?.connections) return [];
    const stageNode = graph.stages.find((s: any) => s.stateKey === stageKey);
    if (!stageNode) return [];
    const outConns = graph.connections.filter((c: any) => c.fromStageId === stageNode.id);
    return outConns
      .map((c: any) => graph.stages.find((s: any) => s.id === c.toStageId))
      .filter((n: any) => n?.nodeType === 'CHECKLIST' && n?.configuration?.checklistProfileId);
  };

  // Build pendingChecklist from cached checklist profiles for CHECKLIST nodes
  const buildOfflineChecklist = async (checklistNodes: any[]): Promise<any[]> => {
    const cachedProfiles = await getCache<any[]>('checklist-profiles') ?? [];
    const result: any[] = [];
    for (const node of checklistNodes) {
      const profileId = node.configuration?.checklistProfileId;
      if (!profileId) continue;
      const profile = cachedProfiles.find((p: any) => p.id === profileId && p.isActive !== false);
      if (!profile) continue;
      result.push({
        pipelineNodeId: node.id,
        checklistProfileId: profileId,
        checklistProfileName: profile.name,
        questions: (profile.questions ?? []).sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
      });
    }
    return result;
  };

  // Update cached filter state + IndexedDB after offline operation
  const updateOfflineState = async (filterId: string, newStage: string, cycleStarted: boolean, blockId?: string) => {
    try {
      const { updateFilterStateLocally, cacheData } = await import('@/lib/offline-store');
      await updateFilterStateLocally(filterId, newStage, cycleStarted);

      const cachedState = await getCache<any>(`filter-state-${filterId}`) ?? {};
      const graph = cachedState.pipelineGraph;

      // Check if pipeline has CHECKLIST nodes after the new stage
      const checklistNodes = graph ? findChecklistsAfterStage(graph, newStage) : [];
      const pendingChecklist = checklistNodes.length > 0
        ? await buildOfflineChecklist(checklistNodes)
        : [];

      // If checklist is pending, block advancement (nextAllowedStages = [])
      let nextAllowed: string[] = [];
      let hasGraphData = false;
      if (pendingChecklist.length > 0) {
        nextAllowed = []; // blocked until checklist answered
      } else if (graph) {
        nextAllowed = computeNextStages(graph, newStage);
        hasGraphData = true;
      } else {
        const pipeline: any[] = (cachedState.pipelineStages ?? [])
          .filter((s: any) => s.stateKey)
          .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const idx = pipeline.findIndex((s: any) => s.stateKey === newStage);
        nextAllowed = (idx >= 0 && idx < pipeline.length - 1) ? [pipeline[idx + 1].stateKey] : [];
        hasGraphData = pipeline.length > 0;
      }

      // Only mark cycle complete if we have pipeline data to verify it AND there are truly no next stages
      const cycleComplete = hasGraphData && nextAllowed.length === 0 && pendingChecklist.length === 0 && !cycleStarted;
      // Write the filter-state with a 24-hour TTL (matches the sync service).
      // The default `cache()` helper uses 30 min, which is too short for long offline shifts —
      // combined with navigator.onLine sometimes flipping to true on Capacitor Android WebViews,
      // that shorter TTL caused the offline cycle state to appear "expired" and return null,
      // which in turn made the pipeline appear unstarted after the user's first advance.
      await cacheData(`filter-state-${filterId}`, {
        ...cachedState,
        currentState: cycleComplete ? null : newStage,
        nextAllowedStages: cycleComplete ? [] : nextAllowed,
        pendingChecklist,
        currentCycle: cycleComplete ? null : (cachedState.currentCycle ?? (cycleStarted ? { id: `offline-${Date.now()}`, status: 'IN_PROGRESS', cleaningAreaId: blockId ?? selectedBlock?.id ?? null } : null)),
      }, 24 * 60 * 60 * 1000);
      // Clear both currentCycleId and currentLifecycleState in filters store when cycle completes
      if (cycleComplete) {
        const { clearOfflineCycleId } = await import('@/lib/offline-store');
        await clearOfflineCycleId(filterId);
      }
    } catch { /* ignore */ }
    refreshOfflineData();
  };

  const handleSubmit = async () => {
    if (!scanValue.trim() || !activeStage || loading) return;
    setLoading(true); setError(''); setSuccess('');
    try {
      const resolved = await resolveFilter();
      if (!resolved) { setLoading(false); return; }
      const { filterId, filterName } = resolved;

      let state: any;

      // === UNIFIED STATE RESOLUTION ===
      // Always try API first (works online), fall back to cache (works offline).
      // Single code path — no divergence between online/offline.
      const buildOfflineState = async () => {
        const cachedFilters = await getOfflineFilters();
        const cached = cachedFilters.find((f: any) => f.id === filterId);
        const cachedState = await getCache<any>(`filter-state-${filterId}`) ?? {};

        const currentLifecycle = cached?.currentLifecycleState || cachedState.currentState || null;
        let nextAllowed: string[] = cachedState.nextAllowedStages ?? [];
        if (nextAllowed.length === 0 && cachedState.pipelineGraph) {
          nextAllowed = computeNextStages(cachedState.pipelineGraph, currentLifecycle);
        }

        // Active cycle: server returns currentCycle with id+status, offline has cached version
        const cycle = cachedState.currentCycle ?? null;
        const hasCycle = cycle ? !!(cycle.status === 'IN_PROGRESS' || cycle.id) : !!cached?.currentCycleId;

        return {
          filterId,
          filterName: cached?.name || filterName,
          currentState: currentLifecycle,
          currentCycle: hasCycle ? (cycle ?? { id: cached?.currentCycleId, status: 'IN_PROGRESS' }) : null,
          nextAllowedStages: nextAllowed,
          pendingChecklist: cachedState.pendingChecklist ?? [],
          pipelineStages: cachedState.pipelineStages ?? [],
          pipelineGraph: cachedState.pipelineGraph ?? null,
          equipmentGroup: cachedState.equipmentGroup ?? null,
          isPmDue: cachedState.isPmDue ?? false,
          pmReasonKey: cachedState.pmReasonKey ?? null,
          blockChangeStatus: cachedState.blockChangeStatus ?? null,
          homeBlock: cachedState.homeBlock ?? null,
        };
      };

      if (online) {
        try {
          const csUrl = `/api/filters/${filterId}/current-state${selectedBlock?.id ? `?cleaningAreaId=${encodeURIComponent(selectedBlock.id)}` : ''}`;
          state = await apiClient.get<any>(csUrl);
          // Cache full server response for offline use
          cache(`filter-state-${filterId}`, {
            equipmentGroup: state.equipmentGroup ?? null,
            blockEquipmentGroups: state.blockEquipmentGroups ?? [],
            pendingChecklist: state.pendingChecklist ?? [],
            pipelineStages: state.pipelineStages ?? [],
            pipelineGraph: state.pipelineGraph ?? null,
            nextAllowedStages: state.nextAllowedStages ?? [],
            isPmDue: state.isPmDue ?? false,
            pmReasonKey: state.pmReasonKey ?? null,
            currentCycle: state.currentCycle ?? null,
            currentState: state.currentState ?? null,
            homeBlock: state.homeBlock ?? null,
            blockChangeStatus: state.blockChangeStatus ?? null,
          }, 24 * 60 * 60 * 1000);
        } catch (e: any) {
          if (isNetworkError(e)) {
            state = await buildOfflineState();
          } else {
            throw e;
          }
        }
      } else {
        state = await buildOfflineState();
      }

      // Block duplicate submission
      const currentLifecycle = state.currentState;
      const nextAllowed = state.nextAllowedStages ?? [];

      // Shared SPIS gate (same helper used by handleSubmitQueue).
      // Only enforced offline — online callers get richer server-side validation.
      if (!online) {
        const gate = validateOfflineGate({
          activeStageKey: activeStage.key,
          activeStageLabel: activeStage.label,
          online,
          currentLifecycle,
          nextAllowed,
          hasGraph: !!state.pipelineGraph?.stages,
          hasLinearPipeline: (state.pipelineStages?.length ?? 0) > 0,
          pipelineGraph: state.pipelineGraph,
          cycleInProgress: !!state.currentCycle,
          hasPendingChecklist: (state.pendingChecklist?.length ?? 0) > 0,
          dryerReadingsSubmitted: state.currentCycle?.dryerReadingsSubmitted,
          homeBlockId: state.homeBlock?.id,
          blockChangeStatus: state.blockChangeStatus,
          selectedBlockId: selectedBlock?.id,
        });
        if (!gate.ok) {
          if (gate.blockChangeRequired) {
            // Let the existing block-change dialog flow below handle this
            state.blockChangeStatus = 'REQUIRED';
          } else {
            setError(gate.reason);
            setLoading(false); return;
          }
        }
      }

      // B.10 — stale profile detection: if the in-progress cycle is bound to a
      // profile that no longer matches the live block-assigned profile, surface
      // a clear instruction instead of letting the user hit "next stage = wrong"
      // confusion. Operator must terminate-and-restart to pick up the new profile.
      if (state.profileSyncWarning) {
        const w = state.profileSyncWarning;
        setError(
          `This filter's active cycle is on profile "${w.cycleProfileName ?? w.cycleProfileId}", but the configured profile for this block is now "${w.expectedProfileName ?? w.expectedProfileId}". Terminate the current cycle and rescan to start fresh on the live profile.`
        );
        setLoading(false); return;
      }

      // DRY_IN: if temperature already recorded, direct user to Dry Out stage
      // (runs BEFORE generic nextAllowed check so the user gets a clear instruction
      // instead of the confusing "Already at DRY IN. Next: Dry Out")
      if (activeStage.key === 'DRY_IN' && state.currentCycle?.dryerReadingsSubmitted) {
        setError('Dry In complete — temperature already recorded. Scan on Dry Out stage to advance.');
        setLoading(false); return;
      }

      if (currentLifecycle === activeStage.key && nextAllowed.length > 0) {
        setError(`Already at ${activeStage.label}. Next: ${nextAllowed.map((k: string) => k.replace(/_/g, ' ')).join(', ')}`);
        setLoading(false); return;
      }

      // Up-front block verification. If the filter belongs to a different
      // block and there is no standing approval, show the request-block-change
      // popup now and stop.
      // Offline: if homeBlock is cached and doesn't match selected block, block the operation
      if (!online && state.homeBlock && selectedBlock?.id && state.homeBlock.id !== selectedBlock.id && state.blockChangeStatus !== 'APPROVED') {
        state.blockChangeStatus = 'REQUIRED';
      }
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
      if (nextAllowed.length > 0 && !nextAllowed.includes(activeStage.key)) {
        const atLabel = (currentLifecycle ?? 'START').replace(/_/g, ' ');
        setError(`Filter is at "${atLabel}". Next allowed: ${nextAllowed.map((k: string) => k.replace(/_/g, ' ')).join(', ')}`);
        setLoading(false); return;
      }
      // Check if there's an active cycle — no cycle means we need to start one (reason dialog)
      const hasActiveCycle = !!state.currentCycle;
      if (!hasActiveCycle) {
        // PM auto-start: if the filter's AHU is currently in a PM schedule
        // window and a "PM" cleaning reason is configured, skip the reason
        // dialog and start the cycle with PM as the reason. Falls through
        // to the normal equipment-group / advance flow below.
        if (state.isPmDue && state.pmReasonKey) {
          try {
            const fName = filterName || state.filterName;
            const cyclePayload = { cleaningReasonKey: state.pmReasonKey, cleaningAreaId: selectedBlock?.id };
            const advancePayload = { targetState: activeStage.key, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${activeStage.label} - ${fName} (PM auto)` };

            const { executed: cycleStarted, result } = await executeOrQueue(
              'start-and-advance', filterId, fName,
              { cyclePayload, advancePayload } as any, activeStage.key
            );

            if (!cycleStarted) {
              await updateOfflineState(filterId, activeStage.key, true, selectedBlock?.id);
              setSuccess(`${fName} → ${activeStage.label} (PM auto, queued)`);
              setRecentOps(prev => [{ stage: activeStage.key, filter: fName, time: formatTime(new Date()), queued: true }, ...prev].slice(0, 20));
              setScanValue(''); setRemarks(''); setLoading(false); return;
            }

            // If WASH_IN and a block is selected, the equipment-group dialog
            // may be required before advance — mirror handleReasonSubmit.
            if (activeStage.key === 'WASH_IN' && selectedBlock?.id) {
              let groups: any[] = [];
              if (online) {
                try { groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${selectedBlock.id}`) ?? []; } catch {}
              } else {
                const cachedGroups = await getCache<any[]>('equipment-groups') ?? [];
                groups = cachedGroups.filter((g: any) => g.blockId === selectedBlock.id);
              }
              if (groups.length > 0) {
                setEquipDialog({ filterId, filterName: fName, stage: activeStage.key, groups });
                setSelectedEquipGroup(null); setReadings({});
                setLoading(false); return;
              }
            }
            setSuccess(`${fName} → ${activeStage.label} (PM auto)`);
            setRecentOps(prev => [{ stage: activeStage.key, filter: fName, time: formatTime(new Date()) }, ...prev].slice(0, 20));
            setScanValue(''); setRemarks(''); mutate('/api/assets/instances?limit=500');
            if (result?.pendingChecklist?.length > 0) { setChecklistDialog({ filterId, filterName: fName, checklists: result.pendingChecklist }); setChecklistAnswers({}); }
            setLoading(false); return;
          } catch (e: any) {
            if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
              setBlockChangeDialog({ filterId: e.connectionInfo.filterId, filterName: filterName || state.filterName, homeBlockId: e.connectionInfo.homeBlockId, homeBlockName: e.connectionInfo.homeBlockName, requestedBlockId: e.connectionInfo.requestedBlockId, requestedBlockName: e.connectionInfo.requestedBlockName });
              setBlockChangeReason(''); setLoading(false); return;
            }
            setError(e.message ?? 'Failed to auto-start PM cycle');
            setLoading(false); return;
          }
        }

        // No PM match — ask for a wash-in reason as before
        setReasonDialog({ filterId, filterName: filterName || state.filterName, stage: activeStage.key });
        setSelectedReason(''); setJustification(''); setLoading(false); return;
      }
      if (activeStage.key === 'DRY_IN') {
        const cyc = state.currentCycle ?? {};
        if (cyc.dryerReadingsSubmitted) {
          setError('Dry In complete — temperature already recorded. Scan on Dry Out stage to advance.');
          setLoading(false); return;
        }
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

      const { executed, result } = await executeOrQueue('advance', filterId, filterName || state.filterName, { targetState: activeStage.key, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${activeStage.label} - ${filterName}` }, activeStage.key);
      setSuccess(`${filterName || state.filterName} → ${activeStage.label}${executed ? '' : ' (queued)'}`);
      setRecentOps(prev => [{ stage: activeStage.key, filter: filterName || state.filterName, time: formatTime(new Date()), queued: !executed }, ...prev].slice(0, 20));
      setScanValue(''); setRemarks('');
      if (executed) {
        mutate('/api/assets/instances?limit=500');
        if (result?.pendingChecklist?.length > 0) { setChecklistDialog({ filterId, filterName: filterName || state.filterName, checklists: result.pendingChecklist }); setChecklistAnswers({}); }
      } else {
        await updateOfflineState(filterId, activeStage.key, false);
        // Offline parity: if the pipeline graph says this stage is followed by a checklist,
        // compute it from cached profiles and pop the dialog immediately (same as online).
        const cs = await getCache<any>(`filter-state-${filterId}`) ?? {};
        if (cs.pendingChecklist?.length > 0) {
          setChecklistDialog({ filterId, filterName: filterName || state.filterName, checklists: cs.pendingChecklist });
          setChecklistAnswers({});
        }
      }
    } catch (e: any) {
      if (e.code === 'BLOCK_CHANGE_REQUIRED' && e.connectionInfo) {
        setBlockChangeDialog({ filterId: e.connectionInfo.filterId, filterName: scanValue, homeBlockId: e.connectionInfo.homeBlockId, homeBlockName: e.connectionInfo.homeBlockName, requestedBlockId: e.connectionInfo.requestedBlockId, requestedBlockName: e.connectionInfo.requestedBlockName });
        setBlockChangeReason(''); setLoading(false); return;
      }
      setError(e.message ?? 'Failed');
    }
    setLoading(false);
  };

  // Pending cycle payload — saved when reason is selected, used by equipment dialog for offline compound queue
  const [pendingCyclePayload, setPendingCyclePayload] = useState<Record<string, any> | null>(null);

  const handleReasonSubmit = async () => {
    if (!reasonDialog || !selectedReason) return;
    setLoading(true); setError('');
    try {
      const cyclePayload = { cleaningReasonKey: selectedReason, cleaningJustification: justification || undefined, cleaningAreaId: selectedBlock?.id };
      const advancePayload = { targetState: reasonDialog.stage, cleaningAreaId: selectedBlock?.id, remarks: remarks || `${reasonDialog.stage.replace(/_/g, ' ')} - ${reasonDialog.filterName}` };

      // Check for equipment groups BEFORE executing — works for both online and offline
      if (reasonDialog.stage === 'WASH_IN' && selectedBlock?.id) {
        let groups: any[] = [];
        if (online) {
          try { groups = await apiClient.get<any[]>(`/api/equipment-groups/by-block/${selectedBlock.id}`) ?? []; } catch {}
        } else {
          // Offline: use cached equipment groups
          const cachedGroups = await getCache<any[]>('equipment-groups') ?? [];
          groups = cachedGroups.filter((g: any) => g.blockId === selectedBlock.id);
        }
        if (groups.length > 0) {
          // Save the cycle payload — equipment dialog will use it for the compound operation
          setPendingCyclePayload(cyclePayload);
          setReasonDialog(null);
          setEquipDialog({ filterId: reasonDialog.filterId, filterName: reasonDialog.filterName, stage: reasonDialog.stage, groups });
          setSelectedEquipGroup(null); setReadings({});
          setLoading(false); return;
        }
      }

      // No equipment groups needed — queue compound operation directly
      const { executed: cycleExecuted, result } = await executeOrQueue(
        'start-and-advance', reasonDialog.filterId, reasonDialog.filterName,
        { cyclePayload, advancePayload } as any, reasonDialog.stage
      );

      if (!cycleExecuted) {
        await updateOfflineState(reasonDialog.filterId, reasonDialog.stage, true, selectedBlock?.id);
        setSuccess(`${reasonDialog.filterName} → ${reasonDialog.stage.replace(/_/g, ' ')} (queued)`);
        setRecentOps(prev => [{ stage: reasonDialog.stage, filter: reasonDialog.filterName, time: formatTime(new Date()), queued: true }, ...prev].slice(0, 20));
        const filterIdSnap = reasonDialog.filterId;
        const filterNameSnap = reasonDialog.filterName;
        setScanValue(''); setRemarks(''); setReasonDialog(null);
        // Offline parity: pop checklist dialog if pipeline prescribes one after this stage
        const cs = await getCache<any>(`filter-state-${filterIdSnap}`) ?? {};
        if (cs.pendingChecklist?.length > 0) {
          setChecklistDialog({ filterId: filterIdSnap, filterName: filterNameSnap, checklists: cs.pendingChecklist });
          setChecklistAnswers({});
        }
        setLoading(false); return;
      }
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
      // Cache dryer timing + equipmentGroup (offline + navigation persistence)
      try {
        const cached = await getCache<any>(`filter-state-${dryerDialog.filterId}`) ?? {};
        // Resolve equipment group for offline temperature dropdown
        let eqGroup = cached.equipmentGroup ?? null;
        if (!eqGroup && selectedBlock?.id) {
          const allGroups = await getCache<any[]>('equipment-groups') ?? [];
          const blockGroups = allGroups.filter((g: any) => g.blockId === selectedBlock.id);
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
            cleaningAreaId: selectedBlock?.id ?? cached.currentCycle?.cleaningAreaId ?? null,
          },
        }, 24 * 60 * 60 * 1000);
      } catch { /* ignore cache errors */ }
      // Update offline state (nextAllowedStages, etc.) when queued
      if (!executed) {
        await updateOfflineState(dryerDialog.filterId, 'DRY_IN', false);
      }
      setScanValue(''); setRemarks(''); setDryerDialog(null);
      if (executed) mutate('/api/assets/instances?limit=500');
    } catch (e: any) {
      setDryerError(e.message ?? 'Failed to start dryer');
    }
    setDryerLoading(false);
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
    setLoading(true); setError('');
    try {
      const isDryerReadings = equipDialog.stage === 'DRY_IN';
      const advancePayload = { targetState: isDryerReadings ? 'DRY_IN' : equipDialog.stage, cleaningAreaId: selectedBlock?.id, equipmentGroupId: selectedEquipGroup.id, instrumentReadings: readings, ...(isDryerReadings ? { dryerAction: 'SUBMIT_READINGS' } : {}), remarks: remarks || `${equipDialog.stage.replace(/_/g, ' ')} - ${equipDialog.filterName}` };

      // If we have a pending cycle payload (from reason dialog), use compound operation
      let executed: boolean;
      let result: any;
      if (pendingCyclePayload) {
        const res = await executeOrQueue(
          'start-and-advance', equipDialog.filterId, equipDialog.filterName,
          { cyclePayload: pendingCyclePayload, advancePayload } as any, equipDialog.stage
        );
        executed = res.executed;
        result = res.result;
        setPendingCyclePayload(null);
      } else {
        const res = await executeOrQueue('advance', equipDialog.filterId, equipDialog.filterName, advancePayload, equipDialog.stage);
        executed = res.executed;
        result = res.result;
      }

      const queued = !executed;
      if (queued) await updateOfflineState(equipDialog.filterId, isDryerReadings ? 'DRY_IN' : equipDialog.stage, !!pendingCyclePayload, selectedBlock?.id);
      setSuccess(`${equipDialog.filterName} → ${equipDialog.stage.replace(/_/g, ' ')}${queued ? ' (queued)' : ''}`);
      setRecentOps(prev => [{ stage: equipDialog.stage, filter: equipDialog.filterName, time: formatTime(new Date()), queued }, ...prev].slice(0, 20));
      const equipDialogSnapshot = equipDialog;
      setScanValue(''); setRemarks(''); setEquipDialog(null); setSelectedEquipGroup(null); setReadings({});
      if (executed) mutate('/api/assets/instances?limit=500');
      if (result?.pendingChecklist?.length > 0) {
        setChecklistDialog({ filterId: equipDialogSnapshot.filterId, filterName: equipDialogSnapshot.filterName, checklists: result.pendingChecklist });
        setChecklistAnswers({});
      } else if (queued) {
        // Offline parity: pop checklist dialog using locally-computed pending checklist
        const cs = await getCache<any>(`filter-state-${equipDialogSnapshot.filterId}`) ?? {};
        if (cs.pendingChecklist?.length > 0) {
          setChecklistDialog({ filterId: equipDialogSnapshot.filterId, filterName: equipDialogSnapshot.filterName, checklists: cs.pendingChecklist });
          setChecklistAnswers({});
        }
      }
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
      // After checklist answered, update cached state: clear pendingChecklist, compute next stages
      if (!executed) {
        try {
          const cs = await getCache<any>(`filter-state-${checklistDialog.filterId}`) ?? {};
          const currentStage = cs.currentState;
          // Walk past checklist nodes to find next STAGE nodes
          const nextAllowed = cs.pipelineGraph ? computeNextStages(cs.pipelineGraph, currentStage) : [];
          cache(`filter-state-${checklistDialog.filterId}`, { ...cs, pendingChecklist: [], nextAllowedStages: nextAllowed }, 24 * 60 * 60 * 1000);
        } catch { /* ignore */ }
      }
      setChecklistDialog(null); setChecklistAnswers({});
      if (executed) mutate('/api/assets/instances?limit=500');
    } catch (e: any) { setError(e.message ?? 'Failed'); }
    setLoading(false);
  };

  // ─── My Tasks handlers ───────────────────────────────
  const toggleTaskExpand = (entryId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  /**
   * Mobile "Perform" flow — unlike desktop (which deep-links into a filter
   * list), mobile operators scan physical RFID tags. So "Perform" just tells
   * them "go clean filters from AHU X now", auto-opens the Wash In stage,
   * and pre-fills the selected block to whatever block the AHU belongs to.
   * The existing scan flow takes over from there — backend block-change
   * validation still applies, so a mis-scan from a wrong AHU surfaces
   * normally.
   */
  const performTask = (task: any) => {
    // Jump straight into the Wash In stage scan view
    const washIn = STAGES.find(s => s.key === 'WASH_IN');
    if (!washIn) return;
    setActiveStage(washIn);
    setView('stage');
    setScanValue(''); setRemarks(''); setError(''); setSelectedBlock(null);
    setSuccess(`Ready to clean filters from ${task.ahuName}. Scan each filter now.`);
  };

  // ─── Approvals handlers ──────────────────────────────
  const handleApprovalAction = async (requestId: string, action: 'approve' | 'reject') => {
    setProcessingApproval(requestId);
    setError('');
    try {
      await apiClient.post(`/api/block-change-requests/${requestId}/${action}`, { comment: approvalComment.trim() || undefined });
      setSuccess(`Request ${action === 'approve' ? 'approved' : 'rejected'}`);
      setApprovalComment('');
      await mutateApprovals();
    } catch (e: any) {
      setError(e.message ?? `Failed to ${action} request`);
    }
    setProcessingApproval(null);
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
      {!hideHeader && <div className="bg-white/80 backdrop-blur-lg border-b border-slate-200/60 px-4 py-3 flex items-center justify-between shrink-0 z-10">
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
            <div className="flex items-center gap-1">
              <button onClick={async () => {
                const r = await manualSync();
                if (r.synced > 0) setSuccess(`Synced ${r.synced} operation(s)`);
                if (r.failed > 0) {
                  const ops = await getQueueDetails();
                  const details = ops.filter((o: any) => o.status !== 'synced').map((o: any) => `${o.type}: ${o.filterName} — ${o.error || 'pending'}`).join('\n');
                  setError(details || lastSyncMessage || 'Sync failed');
                }
              }} disabled={syncing} className="px-2 py-1 bg-amber-50 border border-amber-200 rounded-full text-[10px] text-amber-700 font-medium">
                {syncing ? '⟳ Syncing...' : `${pendingCount} pending — sync`}
              </button>
              <button onClick={async () => { if (confirm('Clear all pending operations? They will not be synced.')) { await clearQueue(); setSuccess('Queue cleared'); } }} className="px-1.5 py-1 bg-red-50 border border-red-200 rounded-full text-[10px] text-red-600 font-medium">
                ✕
              </button>
            </div>
          )}
        </div>
      </div>}

      {/* Offline Banner */}
      {!hideHeader && !online && <div className="mx-4 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700 flex items-center gap-2"><span>📡</span> Working offline — operations queued for sync</div>}

      {/* Toast */}
      {success && <div className="mx-4 mt-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium shadow-sm">✓ {success}</div>}
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
      {error && <div className="mx-4 mt-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 shadow-sm">{error}</div>}

      {/* ─── CONTENT ─── */}
      <div className="flex-1 overflow-y-auto">

        {/* ═══ HOME VIEW ═══ */}
        {view === 'home' && !reasonDialog && !equipDialog && !checklistDialog && (
          <div className="p-4 space-y-4">
            {/* Status Card */}
            {hasFeature('filter_status') && <button onClick={() => setView('status')} className="w-full bg-white rounded-2xl border border-slate-200 p-5 shadow-sm active:shadow-none active:bg-slate-50 transition-all">
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
            </button>}

            {/* Quick access: My Tasks + Approvals */}
            {(hasFeature('my_tasks') || hasFeature('approvals')) && (
            <div className="grid grid-cols-2 gap-3">
              {hasFeature('my_tasks') && (
              <button onClick={() => setView('my-tasks')} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:shadow-none active:scale-[0.98] transition-all text-left">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center mb-3 shadow-lg shadow-cyan-500/20">
                  <span className="text-2xl">🎯</span>
                </div>
                <div className="text-sm font-bold text-slate-800">My Tasks</div>
                <div className="text-xs text-slate-400 mt-0.5">Filters due for cleaning</div>
              </button>
              )}
              {hasFeature('approvals') && (
              <button onClick={() => setView('approvals')} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:shadow-none active:scale-[0.98] transition-all text-left">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mb-3 shadow-lg shadow-amber-500/20">
                  <span className="text-2xl">✅</span>
                </div>
                <div className="text-sm font-bold text-slate-800">Approvals</div>
                <div className="text-xs text-slate-400 mt-0.5">{isApprover ? 'Review requests' : 'Track your requests'}</div>
              </button>
              )}
            </div>
            )}

            {/* Stage Cards Grid */}
            {hasFeature('filter_cleaning') && (
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
            )}

            {/* Logout */}
            {hasFeature('logout') && (
            <button onClick={logout} className="w-full py-3 bg-white border border-red-200 rounded-2xl text-sm font-medium text-red-600 active:bg-red-50 flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Logout
            </button>
            )}

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

        {/* ═══ MY TASKS VIEW ═══ */}
        {view === 'my-tasks' && (
          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800">My Tasks</h2>
              <p className="text-xs text-slate-500 mt-0.5">AHUs currently due for cleaning based on PM schedules</p>
            </div>

            {!online && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-500">
                My Tasks requires an internet connection.
              </div>
            )}

            {online && dueTasksLoading && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-2xl h-24 animate-pulse" />
                ))}
              </div>
            )}

            {!dueTasksLoading && (!tasksSource?.tasks?.length && !tasksSource?.overdue?.length) && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
                <div className="p-10 text-center">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center">
                    <span className="text-3xl">🎯</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">Nothing due right now</div>
                  <div className="text-xs text-slate-400 mt-1">Tasks appear when a schedule window opens</div>
                </div>
              </div>
            )}

            {(tasksSource?.tasks ?? []).map((task: any) => {
              const expanded = expandedTasks.has(task.entryId);
              const statusColor =
                task.overallStatus === 'complete' ? { bar: 'from-emerald-400 to-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' }
                : task.overallStatus === 'in_progress' ? { bar: 'from-cyan-400 to-cyan-500', badge: 'bg-cyan-50 text-cyan-700 border-cyan-100', dot: 'bg-cyan-500' }
                : { bar: 'from-amber-400 to-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-500' };
              const progressPct = task.totalFilters > 0 ? Math.round((task.cleanedCount / task.totalFilters) * 100) : 0;
              return (
                <div key={task.entryId} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className={`h-1.5 bg-gradient-to-r ${statusColor.bar}`} />
                  <div className="p-4">
                    <button onClick={() => toggleTaskExpand(task.entryId)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-bold text-slate-800 truncate">{task.ahuName}</h3>
                            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${statusColor.badge}`}>
                              <span className={`w-1 h-1 rounded-full ${statusColor.dot}`} />
                              {task.overallStatus === 'complete' ? 'Complete' : task.overallStatus === 'in_progress' ? 'In Progress' : 'Pending'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {formatTime(new Date(task.plannedDate))} • {task.cleanedCount}/{task.totalFilters} cleaned
                          </div>
                          {task.totalFilters > 0 && (
                            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-teal-400 to-cyan-500 transition-all" style={{ width: `${progressPct}%` }} />
                            </div>
                          )}
                        </div>
                        <svg className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        {task.filters.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic">No active child filters.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {task.filters.map((f: any) => {
                              const cls =
                                f.status === 'cleaned_in_window' ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : f.status === 'in_progress' ? 'bg-cyan-50 text-cyan-700 border-cyan-100'
                                : 'bg-amber-50 text-amber-700 border-amber-100';
                              return (
                                <span key={f.filterId} className={`inline-flex text-[10px] px-2 py-1 rounded-md border font-semibold ${cls}`}>
                                  {f.filterName}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {task.overallStatus === 'complete' ? (
                      <div className="mt-3 w-full py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm font-semibold text-center flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        Completed
                      </div>
                    ) : (
                      <button
                        onClick={() => performTask(task)}
                        className="mt-3 w-full py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-cyan-500/25 active:shadow-none"
                      >
                        Perform →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {(tasksSource?.overdue ?? []).length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-rose-600 text-sm">⚠</span>
                  <h3 className="text-sm font-bold text-slate-800">Overdue</h3>
                </div>
                {((tasksSource?.overdue ?? []) as any[]).map((task: any) => (
                  <div key={task.entryId} className="bg-white border border-rose-200 rounded-2xl overflow-hidden shadow-sm">
                    <div className="h-1.5 bg-gradient-to-r from-rose-400 to-rose-500" />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-bold text-slate-800 truncate">{task.ahuName}</h3>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            Window closed {formatTime(new Date(task.windowEnd))} • {task.cleanedCount}/{task.totalFilters} cleaned
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-rose-50 text-rose-700 border-rose-100">
                          <span className="w-1 h-1 rounded-full bg-rose-500" />
                          Overdue
                        </span>
                      </div>
                      <button
                        onClick={() => performTask(task)}
                        className="mt-3 w-full py-2.5 bg-gradient-to-r from-rose-600 to-rose-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-rose-500/25 active:shadow-none"
                      >
                        Perform (overdue) →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ APPROVALS VIEW ═══ */}
        {view === 'approvals' && (
          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Approvals</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isApprover ? 'Review and act on pending block change requests' : 'Track the status of requests you submitted'}
              </p>
            </div>

            {/* Status filter pills */}
            {online && (
              <div className="bg-slate-100 rounded-xl p-1 flex gap-1 overflow-x-auto">
                {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => setApprovalsFilter(opt)}
                    className={`flex-1 min-w-[70px] px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      approvalsFilter === opt
                        ? 'bg-white text-cyan-700 shadow-sm'
                        : 'text-slate-500 active:bg-slate-200'
                    }`}
                  >
                    {opt === 'ALL' ? 'All' : opt[0] + opt.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            )}

            {!online && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-xs text-slate-500">
                Approvals requires an internet connection.
              </div>
            )}

            {online && approvalsLoading && (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-2xl h-32 animate-pulse" />
                ))}
              </div>
            )}

            {online && !approvalsLoading && approvals.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-amber-400 to-orange-500" />
                <div className="p-10 text-center">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
                    <span className="text-3xl">✅</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">
                    {approvalsFilter === 'ALL'
                      ? (isApprover ? 'No requests' : 'No requests submitted yet')
                      : `No ${approvalsFilter.toLowerCase()} requests`}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {isApprover ? 'Change the filter above to see other statuses' : 'Block change requests you submit will appear here'}
                  </div>
                </div>
              </div>
            )}

            {online && approvals.map((req: any) => {
              const processing = processingApproval === req.id;
              // Per-status styling — each DB status gets its own badge + accent
              const statusMeta =
                req.status === 'APPROVED'
                  ? { label: 'Approved', badge: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500', bar: 'from-emerald-400 to-emerald-500' }
                : req.status === 'REJECTED'
                  ? { label: 'Rejected', badge: 'bg-rose-50 text-rose-700 border-rose-100',        dot: 'bg-rose-500',    bar: 'from-rose-400 to-rose-500' }
                : req.status === 'EXPIRED'
                  ? { label: 'Used',     badge: 'bg-slate-100 text-slate-600 border-slate-200',    dot: 'bg-slate-400',   bar: 'from-slate-400 to-slate-500' }
                  : { label: 'Pending',  badge: 'bg-amber-50 text-amber-700 border-amber-100',     dot: 'bg-amber-500',   bar: 'from-amber-400 to-orange-500' };
              return (
                <div key={req.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className={`h-1.5 bg-gradient-to-r ${statusMeta.bar}`} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-bold text-slate-800 truncate">{req.filterName}</h3>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Requested by {req.requestedByName ?? req.requestedBy} • {req.createdAt ? formatTime(new Date(req.createdAt)) : ''}
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${statusMeta.badge}`}>
                        <span className={`w-1 h-1 rounded-full ${statusMeta.dot}`} />
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-3 text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-16">From:</span>
                        <span className="font-semibold text-slate-700">{req.fromBlockName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-16">To:</span>
                        <span className="font-semibold text-cyan-700">{req.toBlockName}</span>
                      </div>
                      {req.reason && (
                        <div className="flex items-start gap-2 pt-1">
                          <span className="text-slate-500 w-16">Reason:</span>
                          <span className="text-slate-600 flex-1">{req.reason}</span>
                        </div>
                      )}
                      {/* Surface approval/rejection metadata when present */}
                      {(req.status === 'APPROVED' || req.status === 'REJECTED') && (req.processedByName || req.processedAt) && (
                        <div className="flex items-start gap-2 pt-1 border-t border-slate-200 mt-2">
                          <span className="text-slate-500 w-16">{req.status === 'APPROVED' ? 'Approved by:' : 'Rejected by:'}</span>
                          <span className="text-slate-600 flex-1">
                            {req.processedByName ?? '—'}
                            {req.processedAt ? ` • ${formatTime(new Date(req.processedAt))}` : ''}
                          </span>
                        </div>
                      )}
                      {req.processedComment && (
                        <div className="flex items-start gap-2 pt-1">
                          <span className="text-slate-500 w-16">Comment:</span>
                          <span className="text-slate-600 flex-1 italic">{req.processedComment}</span>
                        </div>
                      )}
                    </div>

                    {/* Only show Approve/Reject for rows that are still pending */}
                    {isApprover && req.status === 'PENDING' && (
                      <div className="space-y-2">
                        <input
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-cyan-400 outline-none"
                          placeholder="Comment (required) *"
                          value={processingApproval === req.id ? approvalComment : ''}
                          onChange={e => { setProcessingApproval(req.id); setApprovalComment(e.target.value); }}
                        />
                        <div className="flex gap-2">
                        <button
                          onClick={() => handleApprovalAction(req.id, 'reject')}
                          disabled={processing || !(processingApproval === req.id && approvalComment.trim())}
                          className="flex-1 py-2.5 bg-white border border-rose-200 text-rose-700 rounded-xl text-sm font-semibold active:bg-rose-50 disabled:opacity-50"
                        >
                          {processing ? '…' : 'Reject'}
                        </button>
                        <button
                          onClick={() => handleApprovalAction(req.id, 'approve')}
                          disabled={processing || !(processingApproval === req.id && approvalComment.trim())}
                          className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/25 active:shadow-none disabled:opacity-50"
                        >
                          {processing ? '…' : 'Approve'}
                        </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
                    <button onClick={() => setSelectedBlock(null)} className="text-[10px] text-cyan-600 underline">Change</button>
                  </div>
                )}

                <div className="flex gap-2">
                  <input ref={scanInputRef} type="text" value={scanValue} onChange={e => { setScanValue(e.target.value); setError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); scanQueue.length > 0 ? handleAddToQueue() : handleSubmit(); } }}
                    onBlur={() => {
                      // If focus drifted to body or a non-input element, snap back.
                      // Lets buttons and the submit flow steal focus, but never lets
                      // focus end up on document.body where RFID keystrokes get lost.
                      setTimeout(() => {
                        const ae = document.activeElement;
                        if (!ae || ae === document.body) focusScanInput();
                      }, 50);
                    }}
                    placeholder="Scan or type filter name..."
                    data-rfid="true"
                    className="flex-1 bg-white border-2 border-slate-200 rounded-2xl px-4 py-4 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 shadow-sm" autoFocus />
                  <button onClick={handleAddToQueue} disabled={!scanValue.trim()}
                    className="px-4 py-4 bg-white border-2 border-cyan-500 text-cyan-700 rounded-2xl font-bold text-sm disabled:opacity-40 active:bg-cyan-50 shrink-0">
                    + Add
                  </button>
                </div>

                {/* Scan Queue */}
                {scanQueue.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Queue ({scanQueue.length})</div>
                    {scanQueue.map(q => (
                      <div key={q.filterId} className="flex items-center justify-between py-1.5 px-2 bg-slate-50 rounded-lg">
                        <span className="text-sm font-medium text-slate-700">{q.filterName}</span>
                        <button onClick={() => removeFromQueue(q.filterId)} className="text-red-400 text-xs hover:text-red-600">Remove</button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Remarks (optional)" rows={2}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500" />

                {/* Single submit (when no queue) or Submit All (when queue has items) */}
                {scanQueue.length === 0 ? (
                  <button onClick={handleSubmit} disabled={loading || !scanValue.trim()}
                    className={`w-full py-4 bg-gradient-to-r ${activeStage.gradient} text-white rounded-2xl font-bold text-base disabled:opacity-40 active:opacity-90 flex items-center justify-center gap-2 shadow-lg`}>
                    {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>✓ Submit</>}
                  </button>
                ) : (
                  <button onClick={handleSubmitQueue} disabled={loading}
                    className={`w-full py-4 bg-gradient-to-r ${activeStage.gradient} text-white rounded-2xl font-bold text-base disabled:opacity-40 active:opacity-90 flex items-center justify-center gap-2 shadow-lg`}>
                    {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <>✓ Submit All ({scanQueue.length})</>}
                  </button>
                )}
              </div>
            )}

            {/* Currently Drying Panel — shows filters with active dryer timers */}
            {activeStage.key === 'DRY_IN' && (() => {
              const dryingFilters = allFilters.filter((f: any) => f.currentLifecycleState === 'DRY_IN');
              if (dryingFilters.length === 0) return null;
              return (
                <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5">
                    <h3 className="text-sm font-bold text-white">Currently Drying ({dryingFilters.length})</h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {dryingFilters.map((f: any) => (
                      <DryingFilterCard
                        key={f.id}
                        filterId={f.id}
                        filterName={f.name}
                        online={online}
                        getCache={getCache}
                        executeOrQueue={executeOrQueue}
                        updateOfflineState={updateOfflineState}
                        onSuccess={(msg) => { setSuccess(msg); mutate('/api/assets/instances?limit=500'); refreshOfflineData(); }}
                        onError={setError}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

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
                    <option value="">Select...</option>{genOpts(inst.operatingMin, inst.operatingMax, inst.leastCount).map(v => <option key={v} value={v}>{formatByLeastCount(v, inst.leastCount)} {inst.uom}</option>)}
                  </select></div>
              ))}
            </div>
            <div className="p-4 border-t border-slate-200 flex gap-3"><button onClick={() => setEquipDialog(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium">Cancel</button><button onClick={handleEquipSubmit} disabled={loading || !selectedEquipGroup || (() => { const insts = (selectedEquipGroup?.instruments ?? []).filter((i: any) => i.stageKey === equipDialog.stage); return insts.length > 0 && insts.some((i: any) => readings[i.id] === undefined); })()} className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold disabled:opacity-40">{loading ? 'Submitting...' : 'Submit'}</button></div>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50">
          <div className="bg-white rounded-t-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl animate-slide-up">
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-5 py-4 rounded-t-3xl flex items-center gap-3 shrink-0">
              <svg className="w-6 h-6 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
              <div><h2 className="text-lg font-bold text-white">Checklist Required</h2><p className="text-purple-100 text-sm">{checklistDialog.filterName}</p></div>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              {checklistDialog.checklists.map((cl: any) => (
                <div key={cl.pipelineNodeId}>
                  <h3 className="text-sm font-semibold text-purple-700 uppercase tracking-wider mb-3">{cl.checklistProfileName}</h3>
                  <div className="space-y-4">
                    {cl.questions.map((q: any, qi: number, arr: any[]) => {
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
                                  {['Yes', 'No'].map(opt => <button key={opt} onClick={() => setVal(opt)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${val === opt ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{opt}</button>)}
                                </div>
                              ) : q.questionType === 'YES_NO_NA' ? (
                                <div className="flex gap-2">
                                  {['Yes', 'No', 'N/A'].map(opt => <button key={opt} onClick={() => setVal(opt)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${val === opt ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{opt}</button>)}
                                </div>
                              ) : q.questionType === 'PASS_FAIL' ? (
                                <div className="flex gap-2">
                                  {['Pass', 'Fail'].map(opt => <button key={opt} onClick={() => setVal(opt)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${val === opt ? (opt === 'Pass' ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600') : 'bg-white text-slate-600 border-slate-200'}`}>{opt}</button>)}
                                </div>
                              ) : q.questionType === 'DROPDOWN' ? (
                                <select value={val} onChange={e => setVal(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none">
                                  <option value="">Select...</option>
                                  {(Array.isArray(q.options) ? q.options : []).map((opt: any, i: number) => <option key={i} value={typeof opt === 'string' ? opt : opt.value}>{typeof opt === 'string' ? opt : opt.label}</option>)}
                                </select>
                              ) : q.questionType === 'MULTI_SELECT' ? (
                                <div className="flex flex-wrap gap-2">
                                  {(Array.isArray(q.options) ? q.options : []).map((opt: any, i: number) => {
                                    const optVal = typeof opt === 'string' ? opt : opt.value;
                                    const optLabel = typeof opt === 'string' ? opt : opt.label;
                                    const selected = Array.isArray(val) && val.includes(optVal);
                                    return <button key={i} onClick={() => { const arr = Array.isArray(val) ? [...val] : []; setVal(selected ? arr.filter((v: string) => v !== optVal) : [...arr, optVal]); }} className={`px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${selected ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{optLabel}</button>;
                                  })}
                                </div>
                              ) : q.questionType === 'NUMERIC' ? (
                                <div>
                                  <input type="number" value={val} onChange={e => setVal(e.target.value)}
                                    min={q.validation?.min} max={q.validation?.max} step={q.validation?.leastCount || 'any'}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none" placeholder={q.validation?.unit ? `Enter value (${q.validation.unit})` : 'Enter value'} />
                                  {(q.validation?.min !== undefined || q.validation?.max !== undefined) && (
                                    <p className="text-xs text-slate-400 mt-1">Range: {q.validation.min ?? '—'} – {q.validation.max ?? '—'}{q.validation.unit ? ` ${q.validation.unit}` : ''}</p>
                                  )}
                                </div>
                              ) : q.questionType === 'PHOTO' ? (
                                <div>
                                  <input type="file" accept="image/*" capture="environment" onChange={e => {
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
                              ) : q.questionType === 'SIGNATURE' ? (
                                <p className="text-xs text-slate-400 italic">Signature capture not available on tablet — will be collected online</p>
                              ) : (
                                <textarea value={val} onChange={e => setVal(e.target.value)} rows={2}
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
              {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 shrink-0 flex gap-3">
              <button onClick={() => setChecklistDialog(null)} disabled={loading} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-40">Cancel</button>
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
                <button onClick={() => { setBlockChangeDialog(null); setScanValue(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={handleBlockChangeRequest} disabled={blockChangeSubmitting || !blockChangeReason.trim()}
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

/**
 * DryingFilterCard — Shows a single filter's dryer status with countdown + temperature selection.
 * Works both online (SWR polling) and offline (cached state).
 */
function DryingFilterCard({
  filterId, filterName, online, getCache, executeOrQueue, updateOfflineState, onSuccess, onError,
}: {
  filterId: string; filterName: string; online: boolean;
  getCache: <T>(key: string) => Promise<T | null>;
  executeOrQueue: any; updateOfflineState: any;
  onSuccess: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [temp, setTemp] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [cycleData, setCycleData] = useState<any>(null);
  const [equipGroup, setEquipGroup] = useState<any>(null);

  // Live timer — tick every second
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Restore previously selected temperature from cache (survives navigation)
  useEffect(() => {
    getCache<number>(`dryer-temp-${filterId}`).then(saved => {
      if (saved !== null && saved !== undefined) setTemp(saved);
    }).catch(() => {});
  }, [filterId]);

  // Load dryer data from API (online) or cache (offline)
  useEffect(() => {
    const load = async () => {
      if (online) {
        try {
          const st = await import('../../lib/api-client').then(m => m.apiClient.get<any>(`/api/filters/${filterId}/current-state`));
          setCycleData(st?.currentCycle);
          setEquipGroup(st?.equipmentGroup);
          return;
        } catch { /* fall through to cache */ }
      }
      // Offline: use cached state
      const cached = await getCache<any>(`filter-state-${filterId}`);
      setCycleData(cached?.currentCycle);
      let grp = cached?.equipmentGroup ?? null;
      // Fallback: resolve from cached equipment groups
      if (!grp) {
        const allGroups = await getCache<any[]>('equipment-groups') ?? [];
        if (cached?.currentCycle?.cleaningAreaId) {
          const blockGroups = allGroups.filter((g: any) => g.blockId === cached.currentCycle.cleaningAreaId);
          if (blockGroups.length >= 1) grp = blockGroups[0];
        }
        // Last resort: if only one equipment group exists, use it
        if (!grp && allGroups.length === 1) grp = allGroups[0];
      }
      setEquipGroup(grp);
    };
    load();
    // Refresh every 15s when online
    if (online) {
      const interval = setInterval(load, 15000);
      return () => clearInterval(interval);
    }
  }, [filterId, online]);

  const startedAt = cycleData?.dryerStartedAt ? new Date(cycleData.dryerStartedAt).getTime() : null;
  const durationMin: number | null = cycleData?.dryerDurationMinutes ?? null;

  if (!startedAt || !durationMin) {
    return (
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{filterName}</span>
        <span className="text-[10px] text-slate-400">waiting for dryer start...</span>
      </div>
    );
  }

  const halfMs = (durationMin * 60_000) / 2;
  const totalMs = durationMin * 60_000;
  const elapsedMs = now - startedAt;
  const halfReached = elapsedMs >= halfMs;
  const remainingSec = Math.max(0, Math.ceil((halfMs - elapsedMs) / 1000));
  const remainingMin = Math.floor(remainingSec / 60);
  const remainingSecPart = remainingSec % 60;
  const progressPct = Math.min(100, (elapsedMs / totalMs) * 100);

  // Find dryer temperature instrument
  const dryerInstrument = (equipGroup?.instruments ?? []).find(
    (i: any) => i.stageKey === 'DRY_IN' && /temp/i.test(i.description ?? ''),
  );
  const tempOptions: number[] = [];
  if (dryerInstrument) {
    const { operatingMin, operatingMax, leastCount } = dryerInstrument;
    const step = leastCount > 0 ? leastCount : 1;
    for (let v = operatingMin; v <= operatingMax + 0.001; v = Math.round((v + step) * 100) / 100) {
      tempOptions.push(v);
    }
  }
  const tempUom = dryerInstrument?.uom ?? '°C';

  const handleTempSubmit = async () => {
    if (!temp || submitting || !equipGroup) return;
    setSubmitting(true);
    try {
      const dryInInstruments = (equipGroup.instruments ?? []).filter((i: any) => i.stageKey === 'DRY_IN');
      const readings: Record<string, number> = {};
      for (const inst of dryInInstruments) {
        readings[inst.id] = (dryerInstrument && inst.id === dryerInstrument.id) ? Number(temp) : inst.operatingMin;
      }
      const { executed } = await executeOrQueue('advance', filterId, filterName, {
        targetState: 'DRY_IN',
        dryerAction: 'SUBMIT_READINGS',
        equipmentGroupId: equipGroup.id,
        instrumentReadings: readings,
        remarks: `Dryer temperature ${temp}${tempUom} - ${filterName}`,
      }, 'DRY_IN');
      if (!executed) await updateOfflineState(filterId, 'DRY_IN', false);
      // Mark readings as submitted in cache (read AFTER updateOfflineState to get latest) + clear persisted temp
      try {
        const freshState = await getCache<any>(`filter-state-${filterId}`) ?? {};
        const { cacheData } = await import('@/lib/offline-store');
        cacheData(`filter-state-${filterId}`, { ...freshState, currentCycle: { ...(freshState.currentCycle ?? {}), dryerReadingsSubmitted: true } });
        cacheData(`dryer-temp-${filterId}`, null, 0);
      } catch {}
      // Update local component state so UI shows "Complete" immediately
      setCycleData((prev: any) => ({ ...(prev ?? {}), dryerReadingsSubmitted: true }));
      setTemp('');
      onSuccess(`${filterName} → Dry In complete (${temp}${tempUom})${executed ? '' : ' (queued)'}`);
    } catch (e: any) {
      onError(e.message ?? 'Failed');
    }
    setSubmitting(false);
  };

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-800">{filterName}</div>
          <div className="text-[10px] text-slate-500">{durationMin} min total</div>
        </div>
        <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${cycleData?.dryerReadingsSubmitted ? 'bg-green-50 text-green-700 border border-green-200' : halfReached ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
          {cycleData?.dryerReadingsSubmitted ? 'Complete' : halfReached ? 'Ready' : `${remainingMin}:${String(remainingSecPart).padStart(2, '0')}`}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${halfReached ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${progressPct}%` }} />
      </div>

      {/* Temperature already recorded */}
      {cycleData?.dryerReadingsSubmitted && (
        <div className="flex items-center gap-2 pt-1 px-1">
          <div className="flex-1 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-700 font-medium flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            Temperature recorded
          </div>
        </div>
      )}
      {/* Temperature selection — only when half-time reached and not yet submitted */}
      {halfReached && !cycleData?.dryerReadingsSubmitted && tempOptions.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <select
            value={temp}
            onChange={e => {
              const val = e.target.value ? Number(e.target.value) : '';
              setTemp(val);
              if (val !== '') {
                import('@/lib/offline-store').then(({ cacheData }) => {
                  cacheData(`dryer-temp-${filterId}`, val, 24 * 60 * 60 * 1000);
                }).catch(() => {});
              }
            }}
            disabled={submitting}
            className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:border-amber-400 outline-none"
          >
            <option value="">Select {tempUom}...</option>
            {tempOptions.map(v => <option key={v} value={v}>{formatByLeastCount(v, dryerInstrument?.leastCount)} {tempUom}</option>)}
          </select>
          <button
            onClick={handleTempSubmit}
            disabled={!temp || submitting}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-bold disabled:opacity-40 active:opacity-90"
          >
            {submitting ? '...' : 'Submit'}
          </button>
        </div>
      )}
      {halfReached && !cycleData?.dryerReadingsSubmitted && tempOptions.length === 0 && (
        <div className="text-[10px] text-red-500">No temperature instrument configured for this equipment group</div>
      )}
    </div>
  );
}
