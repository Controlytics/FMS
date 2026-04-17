/**
 * Sync Engine — Replays queued offline operations when back online.
 */
import { apiClient } from './api-client';
import {
  getPendingOperations,
  updateOperationStatus,
  clearSyncedOperations,
  onOnlineStatusChange,
  clearFilterStateCaches,
} from './offline-store';

type SyncListener = (event: { type: 'start' | 'progress' | 'complete' | 'error'; synced?: number; total?: number; error?: string }) => void;

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

  for (const op of pending) {
    try {
      await updateOperationStatus(op.id, 'syncing');
      await executeOperation(op);
      await updateOperationStatus(op.id, 'synced');
      synced++;
      notify({ type: 'progress', synced, total: pending.length });
    } catch (e: any) {
      // Extract error message — apiClient throws plain objects for API errors
      const errMsg = e?.message ?? e?.error ?? 'Sync failed';
      const msg = String(errMsg).toLowerCase();

      // Network error: server went away mid-sync, stop trying
      const isNetErr = msg.includes('fetch') || msg.includes('network')
        || msg.includes('econnrefused') || msg.includes('load failed')
        || msg.includes('abort');
      if (isNetErr) {
        await updateOperationStatus(op.id, 'pending', errMsg);
        failed++;
        break;
      }

      // API error: retry up to 3 times, then mark as permanently failed
      await updateOperationStatus(op.id, op.retryCount >= 2 ? 'failed' : 'pending', errMsg);
      failed++;
      notify({ type: 'error', error: `${op.filterName}: ${errMsg}` });
    }
  }

  await clearSyncedOperations().catch(() => {});
  // Clear stale filter-state caches so next online fetch gets fresh server data
  if (synced > 0) {
    await clearFilterStateCaches().catch(() => {});
  }

  syncing = false;
  notify({ type: 'complete', synced, total: pending.length });

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
