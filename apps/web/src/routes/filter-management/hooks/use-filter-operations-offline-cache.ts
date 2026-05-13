import { useCallback, useEffect, useState } from 'react';
import { mutate } from 'swr';
import { apiClient } from '../../../lib/api-client';
import { useOffline } from '../../../hooks/use-offline';
import { onSyncEvent } from '../../../lib/sync-engine';
import { cacheServerStateResponse } from '@/lib/offline-cache';
import { SYNC_AFTER_ONLINE_DELAY_MS } from '@/lib/timing-constants';

interface UseFilterOperationsOfflineCacheInput {
  /** Capacitor-aware online flag, from the parent's useOffline() destructure. */
  online: boolean;
  /** SWR responses passed in by the parent; the hook re-caches them whenever
   *  they refresh, so the offline path always sees the freshest payload. */
  instancesData: any | undefined;
  templatesData: any | undefined;
  reasonsData: any | undefined;
  equipGroupsData: any | undefined;
  identifiersData: any | undefined;
}

interface UseFilterOperationsOfflineCacheReturn {
  /** Cached filter instances loaded from IndexedDB on mount or offline transition. */
  offlineInstances: any[];
  /** Cached templates loaded from IndexedDB on mount or offline transition. */
  offlineTemplates: any[];
  /** True once the first mount-time load resolves (success OR failure). The
   *  parent uses this to gate its `isLoading` computation. */
  offlineDataLoaded: boolean;
  /** Re-pull offline filter instances. Called from cycle-mutation handlers
   *  after an operation succeeds so the local `offlineInstances` reflects
   *  the new lifecycle state. Replaces the previous
   *  `getOfflineFilters().then(setOfflineInstances)` inline pattern. */
  refreshOfflineInstances: () => Promise<void>;
}

/**
 * Phase 2 of the filter-operations.tsx extraction. Owns:
 *
 *   - The three local state slots (offlineInstances, offlineTemplates,
 *     offlineDataLoaded) that the parent renders against when the SWR
 *     responses haven't arrived yet.
 *   - The 8 useEffects that prime / drain the offline cache:
 *       1. instances     -> cacheFilterData
 *       2. templates     -> cache('templates', ...)
 *       3. reasons       -> cache('cleaning-reasons', ...)
 *       4. equipGroups   -> cache('equipment-groups', ...)
 *       5. filter-states -> per-filter /current-state pre-warm (debounced)
 *       6. identifiers   -> cache('identifier-map', ...)
 *       7. mount         -> load offline filters + templates
 *       8. offline flip  -> re-load offline filters + templates
 *       9. post-sync     -> mutate('/api/assets/instances?limit=500')
 *
 * No behavior change vs the inline effects in filter-operations.tsx
 * pre-refactor — pure relocation. The handlers (Phase 3) still own all
 * the mutation logic; this hook is read-side caching only.
 */
export function useFilterOperationsOfflineCache(
  input: UseFilterOperationsOfflineCacheInput,
): UseFilterOperationsOfflineCacheReturn {
  const { online, instancesData, templatesData, reasonsData, equipGroupsData, identifiersData } = input;
  const { cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();

  const [offlineInstances, setOfflineInstances] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  const [offlineDataLoaded, setOfflineDataLoaded] = useState(false);

  // 1. Cache filter instances for offline use
  useEffect(() => { if (instancesData?.data) cacheFilterData(instancesData.data); }, [instancesData, cacheFilterData]);
  // 2. Cache templates
  useEffect(() => { if (templatesData?.data) cache('templates', templatesData.data); }, [templatesData, cache]);
  // 3. Cache cleaning reasons for offline cycle start
  useEffect(() => {
    const r = (reasonsData as any)?.reasons ?? reasonsData;
    if (r) cache('cleaning-reasons', r);
  }, [reasonsData, cache]);
  // 4. Cache equipment groups for offline equipment/limits selection
  useEffect(() => {
    if (equipGroupsData) cache('equipment-groups', Array.isArray(equipGroupsData) ? equipGroupsData : equipGroupsData?.data ?? []);
  }, [equipGroupsData, cache]);

  // 5. Pre-cache /current-state for every FILTER instance so offline ops have
  //    a complete snapshot. Debounced ~2s after the instances payload arrives
  //    to avoid hammering the API during page-load and to coalesce the SWR
  //    refresh cadence. The SYNC_AFTER_ONLINE_DELAY_MS constant carries the
  //    same 2000ms value used elsewhere for online-flip sync debounce.
  useEffect(() => {
    if (!online || !instancesData?.data) return;
    const cacheFilterTemplateIds = new Set(
      ((templatesData?.data ?? []) as any[])
        .filter((t: any) => t.templateKind === 'FILTER')
        .map((t: any) => t.id),
    );
    const filters = instancesData.data.filter((f: any) => {
      // Templates-loaded path: Set membership. First-paint fallback: the
      // instance carries its eager-loaded `template.templateKind` per
      // assets/instance.repository.ts — so we can still classify an instance
      // before the templates SWR settles. Both branches are stable under
      // admin renames (templateKind is the schema-stable signal, not name).
      if (!cacheFilterTemplateIds.has(f.templateId) && f.template?.templateKind !== 'FILTER') return false;
      return f.isActive !== false && f.status !== 'Retired';
    });
    const primeFilterStates = async () => {
      // Per-filter /current-state fetches. We stop on first failure to avoid
      // hammering the API during a partial outage — but the original code
      // silenced WHY the loop broke, making "offline state mysteriously
      // missing for filter N+1" undiagnosable. Surface the cause; the
      // outer `setTimeout(.., 2000)` will re-prime on the next SWR refresh.
      for (const f of filters) {
        try {
          const st = await apiClient.get<any>(`/api/filters/${f.id}/current-state`);
          // Phase 8.7: route the cache write through the helper so the legacy
          // mirror field names live only in offline-cache.ts.
          await cacheServerStateResponse(f.id, st);
        } catch (err) {
          // eslint-disable-next-line no-console -- intentional structured log
          console.warn(
            '[filter-operations-offline-cache] primeFilterStates stopped at',
            f.name ?? f.id,
            '—',
            err instanceof Error ? err.message : String(err),
          );
          break;
        }
      }
    };
    const timer = setTimeout(primeFilterStates, SYNC_AFTER_ONLINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [online, instancesData, templatesData]);

  // 6. Build + cache identifier map (RFID tag lookup, name lookup)
  useEffect(() => {
    if (!identifiersData) return;
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
  }, [identifiersData, cache]);

  // 7. Load cached data on mount — first render needs SOMETHING to show
  //    while the SWR responses are still in flight.
  useEffect(() => {
    Promise.all([
      getOfflineFilters().then(setOfflineInstances),
      getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? [])),
    ]).finally(() => setOfflineDataLoaded(true));
    // Mount-only — getOfflineFilters / getCache are stable closures from
    // useOffline; including them re-runs the load needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 8. Re-load offline filters + templates whenever connectivity drops.
  //    Without this, the offline fallback shows stale (mount-time) data
  //    if the operator was online for hours before disconnecting.
  useEffect(() => {
    if (!online) {
      Promise.all([
        getOfflineFilters().then(setOfflineInstances),
        getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? [])),
      ]).finally(() => setOfflineDataLoaded(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // 9. After a successful sync drain, force the instances SWR to refetch
  //    so the parent re-renders with whatever the server records now show.
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'complete' && event.synced && event.synced > 0) {
        mutate('/api/assets/instances?limit=500');
      }
    });
    return cleanup;
  }, []);

  const refreshOfflineInstances = useCallback(async () => {
    const fresh = await getOfflineFilters();
    setOfflineInstances(fresh);
  }, [getOfflineFilters]);

  return {
    offlineInstances,
    offlineTemplates,
    offlineDataLoaded,
    refreshOfflineInstances,
  };
}
