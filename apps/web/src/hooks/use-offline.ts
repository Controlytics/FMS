/**
 * useOffline — Hook for offline-aware operations.
 * Returns online status, pending operation count, and an offline-safe API wrapper.
 *
 * Connectivity comes from connectivity.ts (Capacitor Network plugin + /api/health
 * probe + window online/offline events) — NOT from raw navigator.onLine, which
 * lies on Capacitor Android WebViews.
 */
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  queueOperation,
  getPendingOperations,
  updateFilterStateLocally,
  cacheFilters,
  getCachedFilters,
  cacheData,
  getCachedData,
  clearAllOperations,
  getAllOperations,
} from '@/lib/offline-store';
import { syncPendingOperations, onSyncEvent, startAutoSync } from '@/lib/sync-engine';
import { isOnline as connIsOnline, onConnectivityChange, startConnectivityEngine } from '@/lib/connectivity';

export function useOffline() {
  const [online, setOnline] = useState(connIsOnline());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState('');

  // Connectivity is owned by lib/connectivity.ts — single source of truth
  // (Capacitor Network plugin + /api/health probe + window online/offline)
  useEffect(() => {
    startConnectivityEngine();
    const unsub = onConnectivityChange(setOnline);
    return unsub;
  }, []);

  // Start auto-sync
  useEffect(() => {
    startAutoSync();
  }, []);

  // Callback that pages can set to be notified when sync completes (for SWR revalidation)
  const [onSyncComplete, setOnSyncComplete] = useState<(() => void) | null>(null);

  // Track sync events
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'start') { setSyncing(true); setOnline(true); /* sync means API is reachable */ }
      if (event.type === 'complete') {
        setSyncing(false);
        setOnline(true);
        if (event.synced) {
          setLastSyncMessage(`Synced ${event.synced} operation(s)`);
          if (onSyncComplete) onSyncComplete();
        }
        refreshPendingCount();
      }
      if (event.type === 'error') setLastSyncMessage(event.error ?? 'Sync error');
    });
    return cleanup;
  }, [onSyncComplete]);

  // Refresh pending count
  const refreshPendingCount = useCallback(async () => {
    const ops = await getPendingOperations();
    setPendingCount(ops.length);
  }, []);

  useEffect(() => { refreshPendingCount(); }, [refreshPendingCount]);

  // === Offline-safe API calls ===

  /**
   * Execute an API call. If offline, queue the operation for later sync.
   * Returns true if executed immediately, false if queued.
   */
  const executeOrQueue = useCallback(async (
    type: 'advance' | 'start-cycle' | 'submit-checklist' | 'bypass' | 'terminate' | 'start-and-advance',
    filterId: string,
    filterName: string,
    payload: Record<string, any>,
    optimisticState?: string, // Update local state immediately
  ): Promise<{ executed: boolean; result?: any }> => {
    // Try executing online first
    try {
      let result: any;
      switch (type) {
        case 'advance':
          result = await apiClient.post(`/api/filters/${filterId}/advance`, payload);
          break;
        case 'start-cycle':
          result = await apiClient.post(`/api/filters/${filterId}/start-cycle`, payload);
          break;
        case 'start-and-advance': {
          const { cyclePayload, advancePayload } = payload as any;
          try {
            await apiClient.post(`/api/filters/${filterId}/start-cycle`, cyclePayload);
          } catch (startErr: any) {
            const code = startErr?.code || startErr?.error || '';
            if (code !== 'CYCLE_ACTIVE') throw startErr;
          }
          result = await apiClient.post(`/api/filters/${filterId}/advance`, advancePayload);
          break;
        }
        case 'submit-checklist':
          result = await apiClient.post(`/api/filters/${filterId}/submit-checklist`, payload);
          break;
        case 'bypass':
          result = await apiClient.post(`/api/filters/${filterId}/bypass`, payload);
          break;
        case 'terminate':
          result = await apiClient.post(`/api/filters/${filterId}/terminate-cycle`, payload);
          break;
      }
      return { executed: true, result };
    } catch (e: any) {
      // Determine if this is a network error (should queue) or API error (should throw)
      const msg = String(e?.message || '').toLowerCase();
      const code = e?.code || e?.error || '';
      const isNetErr = (e instanceof TypeError && msg.includes('fetch'))
        || msg.includes('failed to connect') || msg.includes('failed to fetch')
        || msg.includes('networkerror') || msg.includes('network request failed')
        || msg.includes('unable to resolve host') || msg.includes('econnrefused')
        || msg.includes('load failed') || msg.includes('tls') || msg.includes('ssl');
      // Reauth errors should also queue (sync engine sends x-offline-replay to skip reauth)
      const isReauthErr = code === 'REAUTH_REQUIRED' || code === 'REAUTH_FAILED';
      if (!isNetErr && !isReauthErr) {
        throw e; // Real API error (validation, conflict, etc.) — throw as-is
      }
      // Network error or reauth block — fall through to queue below
    }

    // Offline or network error: queue the operation
    await queueOperation({ type, filterId, filterName, payload });
    if (optimisticState) {
      // When starting a cycle offline, also mark the filter as having an active cycle
      const markCycleActive = type === 'start-and-advance' || type === 'start-cycle';
      await updateFilterStateLocally(filterId, optimisticState, markCycleActive);
    }
    await refreshPendingCount();
    return { executed: false };
  }, [refreshPendingCount]);

  // Manually trigger sync
  const manualSync = useCallback(async () => {
    if (!connIsOnline()) return { synced: 0, failed: 0 };
    return syncPendingOperations();
  }, []);

  // Cache filter data for offline use
  const cacheFilterData = useCallback(async (filters: any[]) => {
    await cacheFilters(filters);
  }, []);

  // Get cached filter data when offline
  const getOfflineFilters = useCallback(async () => {
    return getCachedFilters();
  }, []);

  // Generic cache. Default TTL is 30 min for short-lived UI caches; caller can pass
  // a longer TTL (e.g. 24h) for data that must survive long offline shifts.
  const cache = useCallback(async (key: string, data: any, ttlMs: number = 30 * 60 * 1000) => {
    await cacheData(key, data, ttlMs);
  }, []);

  const getCache = useCallback(async <T>(key: string): Promise<T | null> => {
    return getCachedData<T>(key);
  }, []);

  // Clear all stuck/failed operations from the queue
  const clearQueue = useCallback(async () => {
    await clearAllOperations();
    await refreshPendingCount();
  }, [refreshPendingCount]);

  // Get all operations for debugging
  const getQueueDetails = useCallback(async () => {
    return getAllOperations();
  }, []);

  return {
    online,
    pendingCount,
    syncing,
    lastSyncMessage,
    executeOrQueue,
    manualSync,
    clearQueue,
    getQueueDetails,
    setOnSyncComplete,
    cacheFilterData,
    getOfflineFilters,
    cache,
    getCache,
    refreshPendingCount,
  };
}
