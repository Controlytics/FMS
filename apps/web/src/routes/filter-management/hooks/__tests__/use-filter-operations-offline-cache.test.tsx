import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { mockApi, type MockApi, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { usePageTestLifecycle } from '../../__tests__/fm-test-kit';
import { installFakeIndexedDB, openAppDb, cacheRow, type FakeIdb } from './fake-indexeddb';
import { useFilterOperationsOfflineCache } from '../use-filter-operations-offline-cache';

usePageTestLifecycle();
afterEach(() => { vi.useRealTimers(); });

let idb: FakeIdb;
let api: MockApi;
function serve(...routes: MockRoute[]) {
  api = mockApi([...routes, { path: '/api/health', body: { status: 'ok' } }]);
}
beforeEach(async () => {
  idb = installFakeIndexedDB();
  await openAppDb();
  serve();
});

type Input = Parameters<typeof useFilterOperationsOfflineCache>[0];
const base: Input = { online: true, instancesData: undefined, templatesData: undefined, reasonsData: undefined, equipGroupsData: undefined, identifiersData: undefined };
const render = (initial: Partial<Input> = {}) =>
  renderHook((p: Input) => useFilterOperationsOfflineCache(p), { initialProps: { ...base, ...initial } });
const cached = (key: string) => idb.rows('cache').find((r) => r.key === key)?.data;

const TEMPLATES = { data: [{ id: 't-filter', templateKind: 'FILTER' }, { id: 't-ahu', templateKind: 'AHU' }] };
const INSTANCES = {
  data: [
    { id: 'f1', name: 'FLT-1', templateId: 't-filter' },
    { id: 'f2', name: 'FLT-2', templateId: 'other', template: { templateKind: 'FILTER' } },
    { id: 'ahu1', name: 'AHU-1', templateId: 't-ahu' },
    { id: 'f3', name: 'FLT-RETIRED', templateId: 't-filter', status: 'Retired' },
    { id: 'f4', name: 'FLT-OFF', templateId: 't-filter', isActive: false },
  ],
};

describe('useFilterOperationsOfflineCache — reading the offline cache', () => {
  it('on mount loads cached instances, templates and the four typed caches, then reports loaded', async () => {
    idb.seed('filters', [{ id: 'f9', name: 'Cached filter' }]);
    idb.seed('cache', [cacheRow('templates', [{ id: 't1', templateKind: 'FILTER' }])]);
    idb.seed('cache_blocks', [{ id: 'b1', name: 'Block A' }]);
    idb.seed('cache_areas', [{ id: 'a1', name: 'Area 1', blockId: 'b1' }]);
    idb.seed('cache_ahus', [{ id: 'h1', name: 'AHU-1', areaId: 'a1' }]);
    idb.seed('cache_filters_typed', [{ id: 'f9', name: 'Cached filter', ahuId: 'h1' }]);
    const { result } = render();
    expect(result.current.offlineDataLoaded).toBe(false);
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    expect(result.current.offlineInstances).toEqual([{ id: 'f9', name: 'Cached filter' }]);
    expect(result.current.offlineTemplates).toEqual([{ id: 't1', templateKind: 'FILTER' }]);
    expect(result.current.offlineBlocks.map((b) => b.id)).toEqual(['b1']);
    expect(result.current.offlineAreas.map((b) => b.id)).toEqual(['a1']);
    expect(result.current.offlineAhus.map((b) => b.id)).toEqual(['h1']);
    expect(result.current.offlineFiltersTyped.map((b) => b.id)).toEqual(['f9']);
  });

  it('no cached templates → an empty list, not null', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    expect(result.current.offlineTemplates).toEqual([]);
    expect(result.current.offlineInstances).toEqual([]);
  });

  it('a missing typed store is tolerated (mount + refreshOfflineTyped fall back to empty)', async () => {
    idb.seed('cache_ahus', [{ id: 'h1', name: 'AHU-1' }]);
    idb.dbs.get('digilog-offline')!.stores.delete('cache_blocks');
    const { result } = render();
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    expect(result.current.offlineBlocks).toEqual([]);
    expect(result.current.offlineAhus.map((a) => a.id)).toEqual(['h1']);
    idb.seed('cache_ahus', [{ id: 'h2', name: 'AHU-2' }]);
    await act(async () => { await result.current.refreshOfflineTyped(); });
    expect(result.current.offlineBlocks).toEqual([]);
    expect(result.current.offlineAhus.map((a) => a.id).sort()).toEqual(['h1', 'h2']);
  });

  it('refreshOfflineInstances re-reads the filter store after an operation', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    idb.seed('filters', [{ id: 'f1', name: 'FLT-1', currentLifecycleState: 'WASH_IN' }]);
    await act(async () => { await result.current.refreshOfflineInstances(); });
    expect(result.current.offlineInstances).toEqual([{ id: 'f1', name: 'FLT-1', currentLifecycleState: 'WASH_IN' }]);
  });

  it('going offline reloads every cache so the fallback is current, not mount-time data', async () => {
    const { result, rerender } = render();
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    idb.seed('filters', [{ id: 'f5', name: 'Late filter' }]);
    idb.seed('cache', [cacheRow('templates', [{ id: 'tx' }])]);
    idb.seed('cache_blocks', [{ id: 'b7', name: 'Block 7' }]);
    rerender({ ...base, online: false });
    await waitFor(() => expect(result.current.offlineInstances).toEqual([{ id: 'f5', name: 'Late filter' }]));
    expect(result.current.offlineTemplates).toEqual([{ id: 'tx' }]);
    expect(result.current.offlineBlocks.map((b) => b.id)).toEqual(['b7']);
  });
});

describe('useFilterOperationsOfflineCache — writing the offline cache from SWR payloads', () => {
  it('caches instances, templates, reasons ({reasons}), equipment groups ({data}) and the identifier map', async () => {
    const { result } = render({
      instancesData: INSTANCES,
      templatesData: TEMPLATES,
      reasonsData: { reasons: [{ key: 'PM' }] },
      equipGroupsData: { data: [{ id: 'g1' }] },
      identifiersData: [
        { identifierValue: 'AbC', assetId: 'f1', asset: { name: 'FLT-1', approvalStatus: 'PENDING_REVIEW' } },
        { identifierValue: 'E2', assetId: 'f2' },
        { identifierValue: 'NO-ASSET' },
        { assetId: 'f3' },
      ],
      online: false,
    });
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    await waitFor(() => expect(cached('identifier-map')).toBeDefined());
    expect(idb.rows('filters').map((f) => f.id).sort()).toEqual(['ahu1', 'f1', 'f2', 'f3', 'f4']);
    expect(cached('templates')).toEqual(TEMPLATES.data);
    expect(cached('cleaning-reasons')).toEqual([{ key: 'PM' }]);
    expect(cached('equipment-groups')).toEqual([{ id: 'g1' }]);
    const map = cached('identifier-map');
    const entry = { filterId: 'f1', filterName: 'FLT-1', approvalStatus: 'PENDING_REVIEW' };
    expect(map.AbC).toEqual(entry);
    expect(map.ABC).toEqual(entry);
    expect(map.abc).toEqual(entry);
    // no asset name → the id; no approval status → null
    expect(map.E2).toEqual({ filterId: 'f2', filterName: 'f2', approvalStatus: null });
    expect(Object.keys(map).sort()).toEqual(['ABC', 'AbC', 'E2', 'abc', 'e2']);
  });

  it('accepts bare-array reasons and equipment groups; an identifier payload with nothing usable writes no map', async () => {
    const { result, rerender } = render({ reasonsData: [{ key: 'BD' }], equipGroupsData: [{ id: 'g2' }], identifiersData: [{ identifierValue: 'x' }], online: false });
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    await waitFor(() => expect(cached('equipment-groups')).toEqual([{ id: 'g2' }]));
    expect(cached('cleaning-reasons')).toEqual([{ key: 'BD' }]);
    rerender({ ...base, online: false, identifiersData: { not: 'an array' }, equipGroupsData: { other: true } });
    await waitFor(() => expect(cached('equipment-groups')).toEqual([]));
    expect(cached('identifier-map')).toBeUndefined();
  });
});

describe('useFilterOperationsOfflineCache — /current-state priming', () => {
  const STATE = (id: string) => ({ currentState: 'WASH_IN', currentCycle: { id: `c-${id}` }, tapeVersion: 3 });

  it('2 s after the first online payload, primes every live FILTER once (template set or eager templateKind) and caches each answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({ path: /\/api\/filters\/[^/]+\/current-state/, body: (r: MockRequest) => STATE(r.path.split('/')[3]) });
    const { rerender } = render({ instancesData: INSTANCES, templatesData: TEMPLATES });
    expect(api.calls('GET', /current-state/)).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(cached('filter-state-f2')).toBeDefined());
    expect(api.calls('GET', /current-state/).map((r) => r.path)).toEqual(['/api/filters/f1/current-state', '/api/filters/f2/current-state']);
    expect(cached('filter-state-f1')).toMatchObject({ currentState: 'WASH_IN', currentCycle: { id: 'c-f1' } });
    // The 30 s SWR refresh hands in a NEW payload object: no second prime in the same online window.
    rerender({ ...base, instancesData: { data: [...INSTANCES.data] }, templatesData: TEMPLATES });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(api.calls('GET', /current-state/)).toHaveLength(2);
    // Offline → online re-opens the window and primes again.
    rerender({ ...base, online: false, instancesData: INSTANCES, templatesData: TEMPLATES });
    rerender({ ...base, online: true, instancesData: INSTANCES, templatesData: TEMPLATES });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(api.calls('GET', /current-state/)).toHaveLength(4));
  });

  it('waits for SWR: no instances yet → no prime', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({ path: /current-state/, body: {} });
    render({ templatesData: TEMPLATES });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(api.calls('GET', /current-state/)).toHaveLength(0);
  });

  it('a failing /current-state stops the loop with a warning naming the filter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serve({ path: '/api/filters/f1/current-state', status: 500, body: { error: 'INTERNAL', message: 'db timeout' } }, { path: /current-state/, body: {} });
    render({ instancesData: INSTANCES, templatesData: TEMPLATES });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[filter-operations-offline-cache] primeFilterStates stopped at', 'FLT-1', '—', 'db timeout'));
    expect(api.calls('GET', /current-state/).map((r) => r.path)).toEqual(['/api/filters/f1/current-state']);
    expect(cached('filter-state-f1')).toBeUndefined();
  });

  it('a failing filter with no name is named by id; a non-Error refusal is still logged', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    serve({ path: /current-state/, status: 401, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } });
    render({ instancesData: { data: [{ id: 'fx', template: { templateKind: 'FILTER' } }] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[filter-operations-offline-cache] primeFilterStates stopped at', 'fx', '—', expect.any(String)));
  });

  it('going offline mid-prime abandons the in-flight loop (nothing more fetched or cached)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({ path: /current-state/, body: (r: MockRequest) => STATE(r.path.split('/')[3]) });
    const harnessFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/f1/current-state')) await gate;
      return (harnessFetch as any)(input, init);
    }));
    const { rerender } = render({ instancesData: INSTANCES, templatesData: TEMPLATES });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await waitFor(() => expect(api.calls('GET', /current-state/)).toHaveLength(0)); // f1 is held at the gate
    rerender({ ...base, online: false, instancesData: INSTANCES, templatesData: TEMPLATES });
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(100); });
    await waitFor(() => expect(api.calls('GET', /current-state/)).toHaveLength(1));
    expect(api.calls('GET', /current-state/)[0].path).toBe('/api/filters/f1/current-state');
    expect(cached('filter-state-f1')).toBeUndefined();
  });
});

describe('useFilterOperationsOfflineCache — after a sync drain', () => {
  const queueStart = (id: string, filterId: string) => idb.seed('operations', [{
    id, clientOpId: `cop-${id}`, type: 'start-cycle', filterId, filterName: filterId, payload: { reasonKey: 'PM' },
    status: 'pending', createdAt: new Date().toISOString(), retryCount: 0, tapeVersion: null, userId: null, userName: null,
  }]);
  const syncRoutes: MockRoute[] = [
    { method: 'POST', path: '/api/auth/refresh', body: { token: 'refreshed-token' } },
    { method: 'POST', path: /\/api\/filters\/[^/]+\/start-cycle/, body: { ok: true } },
    { path: /\/api\/filters\/[^/]+\/current-state/, body: { currentState: 'WASH_IN' } },
  ];
  beforeEach(() => {
    sessionStorage.setItem('access_token', 'test-token');
    sessionStorage.setItem('offline_replay_token', 'grant');
    sessionStorage.setItem('offline_replay_expires', new Date(Date.now() + 24 * 3600_000).toISOString());
  });

  it('a drain that synced work re-primes /current-state from the LATEST payloads (templates may still be loading)', async () => {
    serve(...syncRoutes);
    const { syncPendingOperations } = await import('@/lib/sync-engine');
    // offline: the mount/online prime never fires, so every current-state GET below comes from the drain
    const { result, rerender } = render({ online: false });
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));

    // 1) no instances known yet → the post-sync prime has nothing to walk
    queueStart('op1', 'f1');
    await act(async () => { await syncPendingOperations(); });
    expect(api.calls('POST', '/api/filters/f1/start-cycle')).toHaveLength(1);
    expect(api.calls('GET', /current-state/)).toHaveLength(0);

    // 2) instances known, templates not → classified by the eager template.templateKind only (f2)
    rerender({ ...base, online: false, instancesData: INSTANCES });
    queueStart('op2', 'f2');
    await act(async () => { await syncPendingOperations(); });
    await waitFor(() => expect(api.calls('GET', /current-state/).map((r) => r.path)).toEqual(['/api/filters/f2/current-state']));
    await waitFor(() => expect(cached('filter-state-f2')).toMatchObject({ currentState: 'WASH_IN' }));
  });

  it('a drain whose only op was refused (synced 0) does not re-prime', async () => {
    serve({ method: 'POST', path: '/api/filters/f1/start-cycle', status: 409, body: { error: 'BLOCK_CHANGE_REQUIRED', message: 'Filter belongs to another block' } }, ...syncRoutes);
    const { syncPendingOperations, onSyncEvent } = await import('@/lib/sync-engine');
    const events: any[] = [];
    const off = onSyncEvent((e) => events.push(e));
    const { result } = render({ online: false, instancesData: INSTANCES, templatesData: TEMPLATES });
    await waitFor(() => expect(result.current.offlineDataLoaded).toBe(true));
    queueStart('op3', 'f1');
    await act(async () => { await syncPendingOperations(); });
    off();
    expect(events.find((e) => e.type === 'complete')).toMatchObject({ synced: 0, total: 1 });
    expect(api.calls('POST', '/api/filters/f1/start-cycle')).toHaveLength(1);
    expect(api.calls('GET', /current-state/)).toHaveLength(0);
  });
});
