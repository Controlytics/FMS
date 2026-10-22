import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate } from 'swr';
import { apiClient } from '../../../lib/api-client';
import { useOffline } from '../../../hooks/use-offline';
import { onSyncEvent } from '../../../lib/sync-engine';
import { cacheServerStateResponse } from '@/lib/offline-cache';
import { SYNC_AFTER_ONLINE_DELAY_MS } from '@/lib/timing-constants';
// A-01 coupled-cluster Step 3 (2026-05-29): typed-cache reads exposed
// alongside the legacy mixed-store reads. Parent (filter-operations.tsx)
// opts into these in Step 4 — until then, additive only.
import {
  getCachedBlocks,
  getCachedAreas,
  getCachedAhus,
  getCachedFiltersTyped,
  type CachedBlock,
  type CachedArea,
  type CachedAhu,
  type CachedFilterTyped,
} from '@/lib/offline-store';

// Priming the offline cache for the block the page works in (D03-06,
// 2026-10-22). It used to GET /current-state for EVERY active filter, one after
// another, on mount and after every sync drain — 121 requests in 10 s, ~4 min
// for 3,044 filters, per open page. Now ONE /batch-states?blockId= request (the
// tablet's batch endpoint, scoped to the block), and only for the selected block:
// that is what the page can act on. A batch's filters are read live at Submit
// (loadBatchStates), so online work never depends on this cache.
//
// Module-level so it can't capture stale component state. Generation guard: the
// caller bumps `genRef.current` and passes the new value as `myGen`; nothing is
// written once a newer prime started or the page went offline.
async function primeBlockStates(
  blockId: string,
  genRef: { current: number },
  myGen: number,
): Promise<void> {
  try {
    const res = await apiClient.get<{ states?: Record<string, any> }>(
      `/api/filters/batch-states?blockId=${encodeURIComponent(blockId)}`,
    );
    for (const [filterId, st] of Object.entries(res?.states ?? {})) {
      if (myGen !== genRef.current) return;
      // Phase 8.7: route the cache write through the helper so the legacy
      // mirror field names live only in offline-cache.ts.
      await cacheServerStateResponse(filterId, st);
    }
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional structured log
    console.warn(
      '[filter-operations-offline-cache] block prime failed for',
      blockId,
      '—',
      err instanceof Error ? err.message : String(err),
    );
  }
}

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
  /** The block the page works in; its filters' states are primed for offline use (D03-06). */
  blockId?: string | null;
}

interface UseFilterOperationsOfflineCacheReturn {
  /** Cached filter instances loaded from IndexedDB on mount or offline transition. */
  offlineInstances: any[];
  /** Cached templates loaded from IndexedDB on mount or offline transition. */
  offlineTemplates: any[];
  /** A-01 cluster Step 3 (2026-05-29): typed-kind caches read from the v6
   *  IDB stores (cache_blocks / cache_areas / cache_ahus / cache_filters_typed).
   *  Populated by offline-sync-service.ts on login + sync drain. Use these
   *  instead of filtering the mixed offlineInstances array by templateId —
   *  no template-kind discrimination needed. Additive: existing consumers
   *  of offlineInstances are unaffected. */
  offlineBlocks: CachedBlock[];
  offlineAreas: CachedArea[];
  offlineAhus: CachedAhu[];
  offlineFiltersTyped: CachedFilterTyped[];
  /** True once the first mount-time load resolves (success OR failure). The
   *  parent uses this to gate its `isLoading` computation. */
  offlineDataLoaded: boolean;
  /** Re-pull offline filter instances. Called from cycle-mutation handlers
   *  after an operation succeeds so the local `offlineInstances` reflects
   *  the new lifecycle state. Replaces the previous
   *  `getOfflineFilters().then(setOfflineInstances)` inline pattern. */
  refreshOfflineInstances: () => Promise<void>;
  /** A-01 cluster Step 3: re-pull typed-kind caches after a sync drain so
   *  the consumer sees fresh data. Mirrors refreshOfflineInstances above. */
  refreshOfflineTyped: () => Promise<void>;
}

/**
 * Phase 2 of the filter-operations.tsx extraction. Owns:
 *
 *   - The three local state slots (offlineInstances, offlineTemplates,
 *     offlineDataLoaded) that the parent renders against when the SWR
 *     responses haven't arrived yet.
 *   - The 9 useEffects that prime / drain the offline cache:
 *       1. instances     -> cacheFilterData
 *       2. templates     -> cache('templates', ...)
 *       3. reasons       -> cache('cleaning-reasons', ...)
 *       4. equipGroups   -> cache('equipment-groups', ...)
 *       5. filter-states -> the selected block's states, one /batch-states
 *                           request (trigger-only: block chosen, online flip,
 *                           post-sync — see effect 5 body)
 *       6. identifiers   -> cache('identifier-map', ...)
 *       7. mount         -> load offline filters + templates
 *       8. offline flip  -> re-load offline filters + templates
 *       9. post-sync     -> mutate('/api/assets/instances') + re-prime the block
 *
 * A-01 Wave 5 migration note (2026-05-29): this hook has NO legacy
 * /api/assets/* API calls to migrate. The only legacy reference is the
 * `mutate('/api/assets/instances')` SWR cache-key invalidation in
 * effect 9. That key MUST match the SWR fetcher key in filter-operations.tsx
 * (line ~59), mobile-operations.tsx (line ~328), and mobile-wrapper.tsx
 * (line ~182) — all of which are carve-outs not migrated in Wave 5. Changing
 * the mutate key here without coordinating those files would silently break
 * cross-component invalidation (post-sync drain would no longer trigger
 * filter-operations.tsx to revalidate). Migration is gated on those three
 * carve-out files moving their SWR keys first.
 *
 * Hook is read-side caching only. Mutation handlers remain in
 * filter-operations.tsx (Phase 3 of the extraction was explicitly declined —
 * see [[filter-ops-extraction-2026-05-14]] memory).
 */
export function useFilterOperationsOfflineCache(
  input: UseFilterOperationsOfflineCacheInput,
): UseFilterOperationsOfflineCacheReturn {
  const { online, instancesData, templatesData, reasonsData, equipGroupsData, identifiersData, blockId } = input;
  const { cacheFilterData, getOfflineFilters, cache, getCache } = useOffline();

  const [offlineInstances, setOfflineInstances] = useState<any[]>([]);
  const [offlineTemplates, setOfflineTemplates] = useState<any[]>([]);
  // A-01 cluster Step 3: typed-kind caches alongside the legacy mixed cache.
  const [offlineBlocks, setOfflineBlocks] = useState<CachedBlock[]>([]);
  const [offlineAreas, setOfflineAreas] = useState<CachedArea[]>([]);
  const [offlineAhus, setOfflineAhus] = useState<CachedAhu[]>([]);
  const [offlineFiltersTyped, setOfflineFiltersTyped] = useState<CachedFilterTyped[]>([]);
  const [offlineDataLoaded, setOfflineDataLoaded] = useState(false);

  // The selected block, mirrored to a ref so the sync-complete handler primes
  // the CURRENT block without re-subscribing.
  const blockRef = useRef<string | null>(blockId ?? null);
  useEffect(() => { blockRef.current = blockId ?? null; });

  // Prime generation counter. Bumping it tells an in-flight prime to write
  // nothing (concurrent-prime guard). Bumped on offline flip too — keeps an
  // in-flight batch from writing IDB after the operator disconnects.
  const primeGenRef = useRef(0);

  // The block primed in this online window: each block at most once per window
  // (reset on offline flip, so the next online flip re-primes). A refreshed SWR
  // payload is not a reason to prime again (the post-sync trigger below handles
  // "data just changed").
  const primedBlockRef = useRef<string | null>(null);

  const triggerPrime = useCallback(() => {
    const block = blockRef.current;
    if (!block) return;
    primeGenRef.current += 1;
    void primeBlockStates(block, primeGenRef, primeGenRef.current);
  }, []);

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

  // 5. Prime the selected block's filter states for offline use, ONE batch
  //    request (D03-06). Fires when a block is chosen and on each offline→online
  //    flip, at most once per block per online window; a post-sync re-prime is
  //    effect 9. `SYNC_AFTER_ONLINE_DELAY_MS` (2 s) debounces it so the first
  //    paint isn't competing with the page's own SWR loads.
  useEffect(() => {
    if (!online) {
      // Offline transition: reset the window and stop an in-flight prime
      // from writing IDB after disconnect.
      primedBlockRef.current = null;
      primeGenRef.current += 1;
      return;
    }
    if (!blockId || primedBlockRef.current === blockId) return;
    primedBlockRef.current = blockId;
    const timer = setTimeout(triggerPrime, SYNC_AFTER_ONLINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [online, blockId, triggerPrime]);

  // 6. Build + cache identifier map (RFID tag lookup, name lookup)
  useEffect(() => {
    if (!identifiersData) return;
    const list = Array.isArray(identifiersData) ? identifiersData : [];
    // approvalStatus (2026-09-25, audit web F3): lets an OFFLINE scan refuse a
    // tag on a filter still in the creation workflow (see resolveFilter).
    const map: Record<string, { filterId: string; filterName: string; approvalStatus?: string | null }> = {};
    for (const ident of list) {
      if (ident.identifierValue && ident.assetId) {
        const entry = { filterId: ident.assetId, filterName: ident.asset?.name || ident.assetId, approvalStatus: ident.asset?.approvalStatus ?? null };
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
      // A-01 cluster Step 3: typed-kind caches.
      getCachedBlocks().then(setOfflineBlocks).catch(() => {}),
      getCachedAreas().then(setOfflineAreas).catch(() => {}),
      getCachedAhus().then(setOfflineAhus).catch(() => {}),
      getCachedFiltersTyped().then(setOfflineFiltersTyped).catch(() => {}),
    ]).finally(() => setOfflineDataLoaded(true));
    // Mount-only — getOfflineFilters / getCache are stable closures from
    // useOffline; including them re-runs the load needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 8. Re-load offline filters + templates + typed caches whenever
  //    connectivity drops. Without this, the offline fallback shows stale
  //    (mount-time) data if the operator was online for hours before
  //    disconnecting.
  useEffect(() => {
    if (!online) {
      Promise.all([
        getOfflineFilters().then(setOfflineInstances),
        getCache<any[]>('templates').then(t => setOfflineTemplates(t ?? [])),
        getCachedBlocks().then(setOfflineBlocks).catch(() => {}),
        getCachedAreas().then(setOfflineAreas).catch(() => {}),
        getCachedAhus().then(setOfflineAhus).catch(() => {}),
        getCachedFiltersTyped().then(setOfflineFiltersTyped).catch(() => {}),
      ]).finally(() => setOfflineDataLoaded(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // 9. After a successful sync drain, force the instances SWR to refetch
  //    so the parent re-renders, AND re-prime the selected block so cached
  //    cycle/checklist data reflects the just-drained ops (one batch request).
  useEffect(() => {
    const cleanup = onSyncEvent((event) => {
      if (event.type === 'complete' && event.synced && event.synced > 0) {
        mutate('/api/assets/instances');
        triggerPrime();
      }
    });
    return cleanup;
  }, [triggerPrime]);

  const refreshOfflineInstances = useCallback(async () => {
    const fresh = await getOfflineFilters();
    setOfflineInstances(fresh);
  }, [getOfflineFilters]);

  // A-01 cluster Step 3: refresh the typed-kind caches in parallel. Called
  // by parent after sync drain (post-sync hook in effect 9 below would also
  // call this, but kept separate so callers can refresh independently).
  const refreshOfflineTyped = useCallback(async () => {
    const [blocks, areas, ahus, filtersTyped] = await Promise.all([
      getCachedBlocks().catch(() => []),
      getCachedAreas().catch(() => []),
      getCachedAhus().catch(() => []),
      getCachedFiltersTyped().catch(() => []),
    ]);
    setOfflineBlocks(blocks);
    setOfflineAreas(areas);
    setOfflineAhus(ahus);
    setOfflineFiltersTyped(filtersTyped);
  }, []);

  return {
    offlineInstances,
    offlineTemplates,
    offlineBlocks,
    offlineAreas,
    offlineAhus,
    offlineFiltersTyped,
    offlineDataLoaded,
    refreshOfflineInstances,
    refreshOfflineTyped,
  };
}
