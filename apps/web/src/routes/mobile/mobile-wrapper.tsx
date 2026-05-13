import { useState, useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient, api } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { useOffline } from '../../hooks/use-offline';
import { useReauth } from '@/hooks/use-reauth';
import { useBlockChangeApproval } from '@/hooks/use-block-change-approval';
import { ReauthDialog } from '@/components/reauth-dialog';
import { onSyncEvent } from '../../lib/sync-engine';
import { useOfflineConfig } from '../../hooks/use-offline-config';
import { HardCutoffBlocker } from '../../components/hard-cutoff-blocker';
import { syncAllDataForOffline, type SyncProgress } from '../../lib/offline-sync-service';
import { triggerSync, startSyncPolling } from '../../lib/sync-since';
import { MobileOperationsPage } from './mobile-operations';

const STAGES = [
  { key: 'WASH_IN', label: 'Wash In', icon: '\u{1F6BF}', gradient: 'from-sky-500 to-sky-600', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '\u{1F4A7}', gradient: 'from-sky-400 to-sky-500', bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-600', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '\u{1F321}\uFE0F', gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '\u2600\uFE0F', gradient: 'from-amber-400 to-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '\u{1F4E5}', gradient: 'from-slate-500 to-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '\u{1F4E4}', gradient: 'from-slate-400 to-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', needsBlock: false },
];

type View = 'home' | 'status' | 'my-tasks' | 'approvals' | 'operations' | 'rfid-assign';

// Build identifier->filter map from identifiers list
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

export function MobileWrapperPage() {
  const { user, isLoading: authLoading, logout: authLogout } = useAuth();
  const { formatTime } = useDatetimeFormat();
  // W2: mobile entry point bypasses AppLayout, so wire the offline-cache
  // config bootstrap here too. The hook is a no-op when the user isn't
  // authenticated yet (SWR doesn't fire on null key inside it).
  useOfflineConfig();
  const { online, pendingCount, syncing, lastSyncMessage, manualSync, clearQueue, getQueueDetails, cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();
  const reauth = useReauth();
  // Audit 2026-05-04 follow-up: shared block-change approval flow with web
  // approvals page so the two implementations can't drift again. Uses its
  // own reauth instance (the `reauth` above is for RFID assign/unassign).
  const blockChangeApproval = useBlockChangeApproval();
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

  const [view, setView] = useState<View>('home');
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ===== CENTRALIZED OFFLINE DATA SYNC =====
  // On login (while online), sync ALL master data in one go.
  // Then keep SWR for live data refresh while online.
  const [dataCached, setDataCached] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const syncStarted = useRef(false);

  // Run full sync once after login while online
  useEffect(() => {
    if (!online || !user || syncStarted.current) return;
    syncStarted.current = true;
    syncAllDataForOffline((progress) => {
      setSyncProgress(progress);
      if (progress.done) setDataCached(true);
    });
  }, [online, user]);

  // Phase 8.4b — versioned-cache sync (Option D). Runs in parallel with the
  // legacy syncAllDataForOffline above. Different cache (the v5 sync stores
  // vs. legacy `cache` key/value blobs) — additive, doesn't replace. Wires
  // up visibilitychange + online + 60s poll triggers so the cache stays
  // fresh while the tablet is foregrounded. Will replace the legacy path
  // in 8.6 once the shared executor lands.
  useEffect(() => {
    if (!user) return;
    triggerSync('mobile-app-start');
    const teardown = startSyncPolling();
    return () => teardown();
  }, [user]);

  // Re-sync after operations are synced back to server (keeps cache fresh)
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'complete' && event.synced && event.synced > 0 && online) {
        // Full re-sync after successful operation sync
        syncAllDataForOffline((progress) => {
          setSyncProgress(progress);
        });
        mutate('/api/assets/instances?limit=500');
      }
    });
    return cleanup;
  }, [online]);

  // SWR for live data while online (refresh intervals for real-time updates)
  const { data: instancesData } = useSWR(online ? '/api/assets/instances?limit=500' : null, { refreshInterval: 15000 });
  const { data: templatesData } = useSWR(online ? '/api/assets/templates?limit=1000' : null);
  const { data: identifiersData, mutate: mutateIdentifiers } = useSWR(online ? '/api/assets/identifiers?limit=1000' : null, { refreshInterval: 30000 });

  // My Tasks + Approvals
  const { data: dueTasksData, mutate: mutateDueTasks, isLoading: dueTasksLoading } =
    useSWR(online ? '/api/pm-schedules/due' : null, { refreshInterval: view === 'my-tasks' ? 30000 : 120000 });

  const isApprover = user?.role === 'SUPER_ADMIN' || (user?.permissions ?? []).includes('BLOCK_CHANGE_APPROVE');
  const [approvalsFilter, setApprovalsFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>(isApprover ? 'PENDING' : 'ALL');
  const approvalsKey = online
    ? `/api/block-change-requests?page=1&limit=50&status=${approvalsFilter}${!isApprover ? '&mine=true' : ''}`
    : null;
  const { data: approvalsData, mutate: mutateApprovals, isLoading: approvalsLoading } =
    useSWR<any>(approvalsKey, { refreshInterval: view === 'approvals' ? 30000 : 120000 });

  // Offline data from IndexedDB cache
  const [offlineTasks, setOfflineTasks] = useState<any>(null);
  const [offlineApprovals, setOfflineApprovals] = useState<any[]>([]);
  const [offlineFilters, setOfflineFilters] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  const [offlineReasons, setOfflineReasons] = useState<any[]>([]);

  // RFID Assign state
  const [rfidSearch, setRfidSearch] = useState('');
  const [rfidSelectedFilter, setRfidSelectedFilter] = useState<{ id: string; name: string } | null>(null);
  const [rfidInput, setRfidInput] = useState('');
  const [rfidSubmitting, setRfidSubmitting] = useState(false);
  const [rfidError, setRfidError] = useState('');
  const [rfidSuccess, setRfidSuccess] = useState('');

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [processingApproval, setProcessingApproval] = useState<string | null>(null);
  const [approvalComment, setApprovalComment] = useState('');

  // Cache live SWR data for offline fallback
  useEffect(() => { if (instancesData?.data) cacheFilterData(instancesData.data); }, [instancesData]);
  useEffect(() => { if (dueTasksData) cache('due-tasks', dueTasksData); }, [dueTasksData]);
  useEffect(() => { if (approvalsData?.data) cache('approvals', approvalsData.data); }, [approvalsData]);

  // Load cached data for offline use
  const refreshOfflineData = () => {
    getOfflineFilters().then(setOfflineFilters);
    getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? []));
    getCache<any[]>('cleaning-reasons').then(r => setOfflineReasons(r ?? []));
    getCache<any>('due-tasks').then(t => { if (t) setOfflineTasks(t); });
    getCache<any[]>('approvals').then(a => { if (a) setOfflineApprovals(a); });
  };
  useEffect(() => { refreshOfflineData(); }, []);
  useEffect(() => { if (!online) refreshOfflineData(); }, [online]);

  const approvals: any[] = (online ? approvalsData?.data : null) ?? offlineApprovals;
  const tasksSource = (online ? dueTasksData : null) ?? offlineTasks;

  const templates = (online ? (templatesData?.data ?? []) : offlineTemplates) as any[];
  const instances = online ? ((instancesData?.data ?? []) as any[]) : offlineFilters;
  // Multi-template support: a tenant can have several FILTER-kind templates
  // (e.g. HEPA vs ULPA with different attributeSchemas). Membership check via
  // Set; matches the pattern used in filter-list.tsx:149. The single-id
  // lookup that was here before would drop filters belonging to any FILTER
  // template after the first one returned by `.find()`.
  const filterTemplateIds = new Set(
    templates.filter((t: any) => t.templateKind === 'FILTER').map((t: any) => t.id),
  );
  const allFilters = instances.filter((f: any) =>
    (filterTemplateIds.has(f.templateId) || f.template?.templateKind === 'FILTER') &&
    f.isActive !== false && f.status !== 'Retired',
  );

  const stageCounts: Record<string, number> = {};
  allFilters.forEach((f: any) => { if (f.currentLifecycleState) stageCounts[f.currentLifecycleState] = (stageCounts[f.currentLifecycleState] ?? 0) + 1; });

  useEffect(() => { if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); } }, [success]);
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 6000); return () => clearTimeout(t); } }, [error]);

  const openStage = (stageKey: string) => {
    setSelectedStageKey(stageKey);
    setView('operations');
    setError(''); setSuccess('');
  };

  const goHome = () => {
    setView('home');
    setSelectedStageKey(null);
    setError('');
    setSuccess('');
    setRfidSearch('');
    setRfidSelectedFilter(null);
    setRfidInput('');
    setRfidError('');
    setRfidSuccess('');
  };

  // ─── RFID Assign handlers ───
  const allIdentifiers = ((identifiersData as any) ?? []) as any[];
  const rfidTagsByFilter = new Map<string, any[]>();
  for (const ident of allIdentifiers) {
    if (ident.identifierType === 'RFID' && ident.assetId) {
      const arr = rfidTagsByFilter.get(ident.assetId) ?? [];
      arr.push(ident);
      rfidTagsByFilter.set(ident.assetId, arr);
    }
  }
  const currentRfidTags = rfidSelectedFilter ? (rfidTagsByFilter.get(rfidSelectedFilter.id) ?? []) : [];

  // Audit 2026-05-04 fix (web-routes review C3): RFID assign/unassign on the
  // tablet path bypassed reauth. Web equivalents in
  // assets/hooks/use-asset-mutations.ts already wrap in reauth — tablet path
  // had drifted. CREATE_ASSET_IDENTIFIER / DELETE_ASSET_IDENTIFIER actions
  // already declared in packages/shared/src/types/reauth-actions.ts:47-48.
  const assignRfid = () => {
    if (!rfidSelectedFilter || !rfidInput.trim()) {
      setRfidError('Enter or scan a tag value.');
      return;
    }
    setRfidSubmitting(true);
    setRfidError('');
    setRfidSuccess('');
    const filterName = rfidSelectedFilter.name;
    const tagValue = rfidInput.trim();
    reauth.execute(
      'CREATE_ASSET_IDENTIFIER',
      async (password?: string) => {
        const body = {
          assetId: rfidSelectedFilter!.id,
          identifierType: 'RFID',
          identifierValue: tagValue,
        };
        if (password) {
          await api.postWithReauth('/api/assets/identifiers', body, password);
        } else {
          await apiClient.post('/api/assets/identifiers', body);
        }
      },
      {
        onSuccess: async () => {
          setRfidSuccess(`Tag assigned to "${filterName}"`);
          setRfidInput('');
          await mutateIdentifiers();
          setRfidSubmitting(false);
        },
        onError: (err: any) => {
          setRfidError(err?.message ?? 'Failed to assign tag');
          setRfidSubmitting(false);
        },
      },
    );
  };

  const unassignRfid = (identifierId: string) => {
    setRfidSubmitting(true);
    setRfidError('');
    setRfidSuccess('');
    reauth.execute(
      'DELETE_ASSET_IDENTIFIER',
      async (password?: string) => {
        if (password) {
          await api.deleteWithReauth(`/api/assets/identifiers/${identifierId}`, password);
        } else {
          await apiClient.delete(`/api/assets/identifiers/${identifierId}`);
        }
      },
      {
        onSuccess: async () => {
          setRfidSuccess('Tag removed');
          await mutateIdentifiers();
          setRfidSubmitting(false);
        },
        onError: (err: any) => {
          setRfidError(err?.message ?? 'Failed to remove tag');
          setRfidSubmitting(false);
        },
      },
    );
  };

  // ---- My Tasks handlers ----
  const toggleTaskExpand = (entryId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const performTask = (_task: any) => {
    // Jump straight into the operations view with WASH_IN pre-selected
    openStage('WASH_IN');
  };

  // ---- Approvals handlers ----
  const handleApprovalAction = (requestId: string, action: 'approve' | 'reject') => {
    setProcessingApproval(requestId);
    setError('');
    blockChangeApproval.process(requestId, action, approvalComment.trim(), {
      mutateKeys: approvalsKey ? [approvalsKey] : [],
      onSuccess: () => {
        setSuccess(`Request ${action === 'approve' ? 'approved' : 'rejected'}`);
        setApprovalComment('');
        // mutateApprovals is the SWR key-bound mutator; the hook also fires
        // mutate(approvalsKey) but we keep this for the local SWR instance.
        void mutateApprovals();
        setProcessingApproval(null);
      },
      onError: (e: any) => {
        setError(e.message ?? `Failed to ${action} request`);
        setProcessingApproval(null);
      },
    });
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 select-none overflow-hidden">
      {/* --- HEADER --- */}
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
              {dataCached ? 'Data Synced' : (syncProgress?.step?.replace('Syncing ', '').replace('...', '') || 'Syncing...')}
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
                {syncing ? '\u27F3 Syncing...' : `${pendingCount} pending \u2014 sync`}
              </button>
              <button onClick={async () => { if (confirm('Clear all pending operations? They will not be synced.')) { await clearQueue(); setSuccess('Queue cleared'); } }} className="px-1.5 py-1 bg-red-50 border border-red-200 rounded-full text-[10px] text-red-600 font-medium">
                \u2715
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Offline Banner */}
      {!online && <div className="mx-4 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-700 flex items-center gap-2">Working offline — operations queued for sync</div>}

      {/* Toast */}
      {success && <div className="mx-4 mt-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium shadow-sm">\u2713 {success}</div>}
      {error && <div className="mx-4 mt-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 shadow-sm">{error}</div>}

      {/* --- CONTENT --- */}
      <div className="flex-1 overflow-y-auto">

        {/* === HOME VIEW === */}
        {view === 'home' && (
          <div className="p-4 space-y-4">
            {/* Status Card */}
            {hasFeature('filter_status') && <button onClick={() => setView('status')} className="w-full bg-white rounded-2xl border border-slate-200 p-5 shadow-sm active:shadow-none active:bg-slate-50 transition-all">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                    <span className="text-2xl">{'\u{1F4CA}'}</span>
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
                  <span className="text-2xl">{'\u{1F3AF}'}</span>
                </div>
                <div className="text-sm font-bold text-slate-800">My Tasks</div>
                <div className="text-xs text-slate-400 mt-0.5">Filters due for cleaning</div>
              </button>
              )}
              {hasFeature('approvals') && (
              <button onClick={() => setView('approvals')} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:shadow-none active:scale-[0.98] transition-all text-left">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mb-3 shadow-lg shadow-amber-500/20">
                  <span className="text-2xl">{'\u2705'}</span>
                </div>
                <div className="text-sm font-bold text-slate-800">Approvals</div>
                <div className="text-xs text-slate-400 mt-0.5">{isApprover ? 'Review requests' : 'Track your requests'}</div>
              </button>
              )}
            </div>
            )}

            {/* RFID Assign */}
            {hasFeature('rfid_assign') && online && (
              <button onClick={() => setView('rfid-assign')} className="w-full bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:shadow-none active:bg-slate-50 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                      <span className="text-2xl">{'\u{1F4F6}'}</span>
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-bold text-slate-800">RFID Assign</div>
                      <div className="text-xs text-slate-400">Tag or untag filters</div>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </button>
            )}

            {/* Stage Cards — direct access to each cleaning stage */}
            {hasFeature('filter_cleaning') && (
            <div className="grid grid-cols-2 gap-3">
              {STAGES.map(stage => (
                <button key={stage.key} onClick={() => openStage(stage.key)}
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
          </div>
        )}

        {/* === STATUS VIEW === */}
        {view === 'status' && (
          <div className="p-4 space-y-4">
            <h2 className="text-lg font-bold text-slate-800">Filter Status</h2>
            <div className="grid grid-cols-2 gap-3">
              {STAGES.map(s => (
                <button key={s.key} onClick={() => openStage(s.key)} className={`bg-white border ${s.border} rounded-xl p-4 text-left active:scale-[0.98] transition-all`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{s.icon}</span>
                    <span className="text-xs font-semibold text-slate-600">{s.label}</span>
                  </div>
                  <div className={`text-2xl font-bold ${s.text}`}>{stageCounts[s.key] ?? 0}</div>
                </button>
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

        {/* === MY TASKS VIEW === */}
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
                    <span className="text-3xl">{'\u{1F3AF}'}</span>
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
                            {formatTime(new Date(task.plannedDate))} {'\u2022'} {task.cleanedCount}/{task.totalFilters} cleaned
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
                        Perform {'\u2192'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {(tasksSource?.overdue ?? []).length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-rose-600 text-sm">{'\u26A0'}</span>
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
                            Window closed {formatTime(new Date(task.windowEnd))} {'\u2022'} {task.cleanedCount}/{task.totalFilters} cleaned
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
                        Perform (overdue) {'\u2192'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === APPROVALS VIEW === */}
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
                    <span className="text-3xl">{'\u2705'}</span>
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
              // Per-status styling
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
                          Requested by {req.requestedByName ?? req.requestedBy} {'\u2022'} {req.createdAt ? formatTime(new Date(req.createdAt)) : ''}
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
                            {req.processedByName ?? '\u2014'}
                            {req.processedAt ? ` \u2022 ${formatTime(new Date(req.processedAt))}` : ''}
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
                          {processing ? '\u2026' : 'Reject'}
                        </button>
                        <button
                          onClick={() => handleApprovalAction(req.id, 'approve')}
                          disabled={processing || !(processingApproval === req.id && approvalComment.trim())}
                          className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/25 active:shadow-none disabled:opacity-50"
                        >
                          {processing ? '\u2026' : 'Approve'}
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

        {/* === OPERATIONS VIEW (renders MobileOperationsPage with proper offline support) === */}
        {view === 'operations' && (
          <div className="flex-1 overflow-y-auto">
            <MobileOperationsPage initialStageKey={selectedStageKey ?? undefined} hideHeader />
          </div>
        )}

        {/* === RFID ASSIGN VIEW === */}
        {view === 'rfid-assign' && (
          <div className="p-4 space-y-4">
            {!rfidSelectedFilter ? (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Select Filter</label>
                  <input
                    type="text"
                    value={rfidSearch}
                    onChange={e => setRfidSearch(e.target.value)}
                    placeholder="Search by filter name..."
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                </div>
                <div className="space-y-2">
                  {allFilters
                    .filter((f: any) => !rfidSearch || f.name?.toLowerCase().includes(rfidSearch.toLowerCase()))
                    .slice(0, 60)
                    .map((f: any) => {
                      const tags = rfidTagsByFilter.get(f.id) ?? [];
                      return (
                        <button key={f.id} onClick={() => { setRfidSelectedFilter({ id: f.id, name: f.name }); setRfidError(''); setRfidSuccess(''); }}
                          className="w-full bg-white rounded-xl border border-slate-200 p-3 active:bg-slate-50 transition-colors text-left flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-800">{f.name}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {tags.length > 0 ? `${tags.length} tag${tags.length > 1 ? 's' : ''} assigned` : 'No tag assigned'}
                            </div>
                          </div>
                          <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                      );
                    })}
                </div>
              </>
            ) : (
              <>
                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-slate-400 uppercase tracking-wider font-bold">Selected Filter</div>
                      <div className="text-base font-bold text-slate-800 mt-0.5">{rfidSelectedFilter.name}</div>
                    </div>
                    <button onClick={() => { setRfidSelectedFilter(null); setRfidInput(''); setRfidError(''); setRfidSuccess(''); }}
                      className="text-xs font-semibold text-violet-600">Change</button>
                  </div>
                </div>

                {rfidError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{rfidError}</div>
                )}
                {rfidSuccess && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">{rfidSuccess}</div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Assigned Tags</label>
                  {currentRfidTags.length === 0 ? (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center text-sm text-slate-400">No RFID tag assigned yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {currentRfidTags.map((tag: any) => (
                        <div key={tag.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between">
                          <div>
                            <div className="text-xs text-slate-400">RFID</div>
                            <div className="text-sm font-mono font-semibold text-slate-800 break-all">{tag.identifierValue}</div>
                          </div>
                          <button onClick={() => unassignRfid(tag.id)} disabled={rfidSubmitting}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 border border-red-200 bg-red-50 active:bg-red-100 disabled:opacity-50">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Assign New Tag</label>
                  <input
                    data-rfid="true"
                    type="text"
                    value={rfidInput}
                    onChange={e => setRfidInput(e.target.value)}
                    placeholder="Scan or enter tag value..."
                    autoFocus
                    className="w-full px-3 py-3 border border-slate-200 rounded-xl text-base font-mono bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                  />
                  <button onClick={assignRfid} disabled={rfidSubmitting || !rfidInput.trim()}
                    className="w-full mt-3 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-purple-600 shadow-lg shadow-violet-500/20 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed">
                    {rfidSubmitting ? 'Assigning...' : 'Assign Tag'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* --- BOTTOM NAVIGATION --- */}
      {view !== 'operations' && (
        <div className="bg-white/90 backdrop-blur-lg border-t border-slate-200/60 px-2 py-2 flex items-center justify-around shrink-0 z-10">
          <button onClick={() => setView('home')} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${view === 'home' ? 'text-cyan-600' : 'text-slate-400'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            <span className="text-[10px] font-semibold">Home</span>
          </button>
          <button onClick={() => setView('status')} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${view === 'status' ? 'text-cyan-600' : 'text-slate-400'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            <span className="text-[10px] font-semibold">Status</span>
          </button>
          <button onClick={() => setView('my-tasks')} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${view === 'my-tasks' ? 'text-cyan-600' : 'text-slate-400'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            <span className="text-[10px] font-semibold">My Tasks</span>
          </button>
          <button onClick={() => setView('approvals')} className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${view === 'approvals' ? 'text-cyan-600' : 'text-slate-400'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-[10px] font-semibold">Approvals</span>
          </button>
        </div>
      )}

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={() => { reauth.cancel(); setRfidSubmitting(false); }}
        actionLabel="RFID Tag"
      />
      <ReauthDialog
        open={blockChangeApproval.reauth.isOpen}
        password={blockChangeApproval.reauth.password}
        error={blockChangeApproval.reauth.error}
        isVerifying={blockChangeApproval.reauth.isVerifying}
        onPasswordChange={blockChangeApproval.reauth.setPassword}
        onConfirm={blockChangeApproval.reauth.confirm}
        onCancel={() => { blockChangeApproval.reauth.cancel(); setProcessingApproval(null); }}
        actionLabel="Process Block Change"
      />
      {/* W4: read-only blocker overlay when hard-cutoff window elapsed */}
      <HardCutoffBlocker />
    </div>
  );
}
