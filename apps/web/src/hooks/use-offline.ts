/**
 * useOffline — Hook for offline-aware operations.
 * Returns online status, pending operation count, and an offline-safe API wrapper.
 */
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import {
  isOnline as checkOnline,
  onOnlineStatusChange,
  queueOperation,
  getPendingOperations,
  updateFilterStateLocally,
  cacheFilters,
  getCachedFilters,
  cacheData,
  getCachedData,
} from '@/lib/offline-store';
import { syncPendingOperations, onSyncEvent, startAutoSync } from '@/lib/sync-engine';

export function useOffline() {
  const [online, setOnline] = useState(checkOnline());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState('');

  // Track online/offline
  useEffect(() => {
    const cleanup = onOnlineStatusChange(setOnline);
    return cleanup;
  }, []);

  // Start auto-sync
  useEffect(() => {
    startAutoSync();
  }, []);

  // Track sync events
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'start') setSyncing(true);
      if (event.type === 'complete') {
        setSyncing(false);
        if (event.synced) setLastSyncMessage(`Synced ${event.synced} operation(s)`);
        refreshPendingCount();
      }
      if (event.type === 'error') setLastSyncMessage(event.error ?? 'Sync error');
    });
    return cleanup;
  }, []);

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
    type: 'advance' | 'start-cycle' | 'submit-checklist' | 'bypass' | 'terminate',
    filterId: string,
    filterName: string,
    payload: Record<string, any>,
    optimisticState?: string, // Update local state immediately
  ): Promise<{ executed: boolean; result?: any }> => {
    if (checkOnline()) {
      // Online: execute directly
      try {
        let result: any;
        switch (type) {
          case 'advance':
            result = await apiClient.post(`/api/filters/${filterId}/advance`, payload);
            break;
          case 'start-cycle':
            result = await apiClient.post(`/api/filters/${filterId}/start-cycle`, payload);
            break;
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
      } catch (e) {
        // If network error (not API error), queue it
        if (e instanceof TypeError && e.message.includes('fetch')) {
          // Network error — queue
        } else {
          throw e; // API error — throw as-is
        }
      }
    }

    // Offline or network error: queue the operation
    await queueOperation({ type, filterId, filterName, payload });
    if (optimisticState) {
      await updateFilterStateLocally(filterId, optimisticState);
    }
    await refreshPendingCount();
    return { executed: false };
  }, [refreshPendingCount]);

  // Manually trigger sync
  const manualSync = useCallback(async () => {
    if (!checkOnline()) return { synced: 0, failed: 0 };
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

  // Generic cache
  const cache = useCallback(async (key: string, data: any) => {
    await cacheData(key, data, 30 * 60 * 1000); // 30 min TTL
  }, []);

  const getCache = useCallback(async <T>(key: string): Promise<T | null> => {
    return getCachedData<T>(key);
  }, []);

  return {
    online,
    pendingCount,
    syncing,
    lastSyncMessage,
    executeOrQueue,
    manualSync,
    cacheFilterData,
    getOfflineFilters,
    cache,
    getCache,
    refreshPendingCount,
  };
}
