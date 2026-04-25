/**
 * Sync Engine — Replays queued offline operations when back online.
 */
import { apiClient } from './api-client';
import {
  getPendingOperations,
  updateOperationStatus,
  clearSyncedOperations,
  onOnlineStatusChange,
  cacheData,
} from './offline-store';
import { dbRun, dbQueryOne } from './sqllite-db';

/**
 * Errors that are deterministic — the server will always reject these
 * given the current DB state, no amount of retrying will help. Mark the
 * op as 'failed' immediately and surface to the user via onSyncEvent.
 * Keeping retries for network / 5xx / unknown errors only.
 */
const HARD_FAIL_CODES = new Set([
  'OUT_OF_SEQUENCE',
  'READING_REQUIRED',
  'INVALID_READING',
  'READING_OUT_OF_RANGE',
  'CHECKLIST_PENDING',
  'NO_EQUIPMENT_GROUP',
  'INVALID_EQUIPMENT_GROUP',
  'MULTIPLE_EQUIPMENT_GROUPS',
  'INVALID_TARGET',
  'PARAM_REQUIRED',
  'PARAM_OUT_OF_RANGE',
  'DRYER_NOT_STARTED',
  'INVALID_DRYER_ACTION',
  'INVALID_DURATION',
  'CYCLE_COMPLETE',
  'BLOCK_CHANGE_REQUIRED',
  'NO_PROFILE',
  'PROFILE_DISABLED',
  'INVALID_REASON',
  'REASON_REQUIRED',
  'JUSTIFICATION_REQUIRED',
]);

type SyncListener = (event: { type: 'start' | 'progress' | 'complete' | 'error'; synced?: number; total?: number; error?: string; filterIds?: string[] }) => void;

let syncing = false;
const listeners: Set<SyncListener> = new Set();

export function onSyncEvent(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(event: Parameters<SyncListener>[0]) {
  listeners.forEach(l => l(event));
}

/**
 * Execute a single queued operation.
 * Sends x-offline-replay header so the backend skips re-authentication.
 * For 'start-and-advance' compound ops: runs start-cycle first, then advance.
 */
async function executeOperation(op: { type: string; filterId: string; payload: Record<string, any>; createdAt: string }): Promise<void> {
  const headers: Record<string, string> = { 'x-offline-replay': 'true' };
  // Inject the original offline timestamp so the backend records the correct time
  const offlineTime = op.createdAt;

  if (op.type === 'start-and-advance') {
    const { cyclePayload, advancePayload } = op.payload as { cyclePayload: Record<string, any>; advancePayload: Record<string, any> };
    try {
      await apiClient.post(`/api/filters/${op.filterId}/start-cycle`, { ...cyclePayload, offlinePerformedAt: offlineTime }, headers);
    } catch (e: any) {
      const code = e?.code || e?.error || '';
      if (code !== 'CYCLE_ACTIVE') throw e;
    }
    await apiClient.post(`/api/filters/${op.filterId}/advance`, { ...advancePayload, offlinePerformedAt: offlineTime }, headers);
    return;
  }

  const url = op.type === 'terminate'
    ? `/api/filters/${op.filterId}/terminate-cycle`
    : `/api/filters/${op.filterId}/${op.type}`;

  await apiClient.post(url, { ...op.payload, offlinePerformedAt: offlineTime }, headers);
}

export async function syncPendingOperations(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };

  let pending: any[];
  try {
    pending = await getPendingOperations();
  } catch {
    return { synced: 0, failed: 0 };
  }
  if (pending.length === 0) return { synced: 0, failed: 0 };

  // Quick connectivity test: use apiClient (supports CapacitorHttp for self-signed certs)
  try {
    await apiClient.get('/api/health');
  } catch {
    // Server not reachable — skip sync
    return { synced: 0, failed: 0 };
  }

  syncing = true;
  notify({ type: 'start', total: pending.length });

  let synced = 0;
  let failed = 0;

  // Track per-filter outcome so after the loop we only refresh caches
  // for filters whose ops ALL succeeded. Filters with failures keep their
  // cached state so the operator can review/retry without losing context.
  const opsByFilter = new Map<string, { ok: number; fail: number }>();
  const bump = (fid: string, key: 'ok' | 'fail') => {
    const s = opsByFilter.get(fid) ?? { ok: 0, fail: 0 };
    s[key]++;
    opsByFilter.set(fid, s);
  };

  for (const op of pending) {
    try {
      await updateOperationStatus(op.id, 'syncing');
      await executeOperation(op);
      await updateOperationStatus(op.id, 'synced');
      synced++;
      bump(op.filterId, 'ok');
      notify({ type: 'progress', synced, total: pending.length });
    } catch (e: any) {
      // Extract error message + code — apiClient throws plain objects for API errors
      const errMsg = e?.message ?? e?.error ?? 'Sync failed';
      const code = e?.code || e?.error || '';
      const msg = String(errMsg).toLowerCase();

      // Network error: server went away mid-sync, stop trying
      const isNetErr = msg.includes('fetch') || msg.includes('network')
        || msg.includes('econnrefused') || msg.includes('load failed')
        || msg.includes('abort');
      if (isNetErr) {
        await updateOperationStatus(op.id, 'pending', errMsg);
        failed++;
        bump(op.filterId, 'fail');
        break;
      }

      // Deterministic server validation error — no amount of retry will
      // fix it. Mark as 'failed' immediately so it stops clogging the queue
      // and surface a readable [CODE] message for the UI / logs.
      if (code && HARD_FAIL_CODES.has(code)) {
        await updateOperationStatus(op.id, 'failed', `[${code}] ${errMsg}`);
        failed++;
        bump(op.filterId, 'fail');
        notify({ type: 'error', error: `${op.filterName}: ${errMsg}` });
        continue;
      }

      // Transient / unknown error: retry up to 3 times (existing behaviour)
      await updateOperationStatus(op.id, op.retryCount >= 2 ? 'failed' : 'pending', errMsg);
      failed++;
      bump(op.filterId, 'fail');
      notify({ type: 'error', error: `${op.filterName}: ${errMsg}` });
    }
  }

  await clearSyncedOperations().catch(() => {});

  // After sync, reconcile local state with server truth for EVERY filter
  // that had an op in this batch — both clean AND failed. Reason:
  // `updateFilterStateLocally` writes the optimistic target stage to
  // `filters.current_lifecycle_state` the moment we queue. If the op later
  // fails at sync (hard-fail code), that optimistic value is WRONG and the
  // next offline scan will offer the wrong next stage. We must fetch the
  // authoritative server state and overwrite BOTH:
  //   - reference_cache['filter-state-<id>']  (pipeline graph, next allowed, etc.)
  //   - filters row's current_lifecycle_state + current_cycle_id
  const touchedFilterIds = [...opsByFilter.keys()];
  const cleanFilterIds = [...opsByFilter.entries()]
    .filter(([, v]) => v.ok > 0 && v.fail === 0)
    .map(([k]) => k);

  for (const fid of touchedFilterIds) {
    try {
      const fresh = await apiClient.get<any>(`/api/filters/${fid}/current-state`);
      await cacheData(`filter-state-${fid}`, fresh, 24 * 60 * 60 * 1000);

      // Reconcile the `filters` table so offline scans read the right state
      // even if this filter had a failed op and kept an optimistic value.
      const row = await dbQueryOne<{ data: string }>(
        `SELECT data FROM filters WHERE id = ?`,
        [fid],
      );
      if (row) {
        const filter = JSON.parse(row.data);
        filter.currentLifecycleState = fresh?.currentState ?? null;
        filter.currentCycleId = fresh?.currentCycle?.id ?? null;
        await dbRun(
          `UPDATE filters
           SET current_lifecycle_state = ?, current_cycle_id = ?, data = ?, updated_at = ?
           WHERE id = ?`,
          [
            fresh?.currentState ?? null,
            fresh?.currentCycle?.id ?? null,
            JSON.stringify(filter),
            new Date().toISOString(),
            fid,
          ],
        ).catch(() => {});
      }
    } catch {
      // Server refresh failed — drop the cache so next scan refetches fresh
      await dbRun(`DELETE FROM reference_cache WHERE key = ?`, [`filter-state-${fid}`]).catch(() => {});
    }
  }

  if (synced > 0) {
    // Force SWR to revalidate cleaning-cycle / event / asset endpoints so
    // pages like Cleaning Cycle History, Timeline, and Filter Traceability
    // reflect the synced operations without a manual refresh.
    try {
      const swr = await import('swr');
      await Promise.all([
        swr.mutate((key: any) => typeof key === 'string' && key.startsWith('/api/filter/cycles')),
        swr.mutate((key: any) => typeof key === 'string' && key.startsWith('/api/filter/events')),
        swr.mutate((key: any) => typeof key === 'string' && key.startsWith('/api/assets/instances')),
        swr.mutate((key: any) => typeof key === 'string' && key.startsWith('/api/filters/')),
      ]);
    } catch { /* swr not available in some contexts — harmless */ }

    // Fire-and-forget refresh of cached master data (cleaning profiles
    // including pipeline graphs, equipment groups, etc.) so pipeline edits
    // admin made online while operator was offline become visible after sync.
    try {
      const { syncAllDataForOffline } = await import('./offline-sync-service');
      void syncAllDataForOffline();
    } catch { /* harmless */ }
  }

  syncing = false;
  notify({ type: 'complete', synced, total: pending.length, filterIds: cleanFilterIds });

  return { synced, failed };
}

// Auto-sync: online event + periodic retry + visibilitychange
let cleanup: (() => void) | null = null;
let retryInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(): void {
  if (cleanup) return;

  // 1. Browser online/offline events
  const onlineCleanup = onOnlineStatusChange(async (online) => {
    if (online) setTimeout(() => syncPendingOperations(), 2000);
  });

  // 2. Periodic retry every 30 seconds
  retryInterval = setInterval(async () => {
    try {
      const pending = await getPendingOperations();
      if (pending.length > 0) syncPendingOperations();
    } catch {}
  }, 30_000);

  // 3. Sync when user returns to the app
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => syncPendingOperations(), 1000);
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  cleanup = () => {
    onlineCleanup();
    if (retryInterval) { clearInterval(retryInterval); retryInterval = null; }
    document.removeEventListener('visibilitychange', handleVisibility);
  };

  // Initial sync attempt
  setTimeout(() => syncPendingOperations(), 3000);
}

export function stopAutoSync(): void {
  if (cleanup) { cleanup(); cleanup = null; }
}
