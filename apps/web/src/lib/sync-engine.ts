/**
 * Sync Engine — Replays queued offline operations when back online.
 */
import { apiClient } from './api-client';
import {
  getPendingOperations,
  updateOperationStatus,
  clearSyncedOperations,
  isOnline,
  onOnlineStatusChange,
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

async function executeOperation(op: { type: string; filterId: string; payload: Record<string, any> }): Promise<void> {
  switch (op.type) {
    case 'advance':
      await apiClient.post(`/api/filters/${op.filterId}/advance`, op.payload);
      break;
    case 'start-cycle':
      await apiClient.post(`/api/filters/${op.filterId}/start-cycle`, op.payload);
      break;
    case 'submit-checklist':
      await apiClient.post(`/api/filters/${op.filterId}/submit-checklist`, op.payload);
      break;
    case 'bypass':
      await apiClient.post(`/api/filters/${op.filterId}/bypass`, op.payload);
      break;
    case 'terminate':
      await apiClient.post(`/api/filters/${op.filterId}/terminate-cycle`, op.payload);
      break;
    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

export async function syncPendingOperations(): Promise<{ synced: number; failed: number }> {
  if (syncing || !isOnline()) return { synced: 0, failed: 0 };

  const pending = await getPendingOperations();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  syncing = true;
  notify({ type: 'start', total: pending.length });

  let synced = 0;
  let failed = 0;

  // Execute in order (chronological)
  for (const op of pending) {
    if (!isOnline()) break; // Stop if went offline again

    try {
      await updateOperationStatus(op.id, 'syncing');
      await executeOperation(op);
      await updateOperationStatus(op.id, 'synced');
      synced++;
      notify({ type: 'progress', synced, total: pending.length });
    } catch (e: any) {
      const errMsg = e?.message ?? 'Sync failed';
      await updateOperationStatus(op.id, op.retryCount >= 2 ? 'failed' : 'pending', errMsg);
      failed++;
      notify({ type: 'error', error: `${op.filterName}: ${errMsg}` });
    }
  }

  // Clean up synced ops
  await clearSyncedOperations();

  syncing = false;
  notify({ type: 'complete', synced, total: pending.length });

  return { synced, failed };
}

// Auto-sync when coming back online
let cleanup: (() => void) | null = null;

export function startAutoSync(): void {
  if (cleanup) return;

  cleanup = onOnlineStatusChange(async (online) => {
    if (online) {
      // Small delay to let network stabilize
      setTimeout(() => syncPendingOperations(), 2000);
    }
  });

  // Also try syncing on start
  if (isOnline()) {
    setTimeout(() => syncPendingOperations(), 3000);
  }
}

export function stopAutoSync(): void {
  if (cleanup) { cleanup(); cleanup = null; }
}
