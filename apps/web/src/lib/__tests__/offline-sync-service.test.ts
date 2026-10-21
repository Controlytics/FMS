import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockApi, type MockApi, type MockRequest } from '@/test-utils/page-harness';
import { installFakeIndexedDB, openAppDb, type FakeIdb } from '@/routes/filter-management/hooks/__tests__/fake-indexeddb';

/**
 * offline-sync-service.ts — the full "download everything for offline" run,
 * end to end: real apiClient (over a stubbed global `fetch` via mockApi),
 * real offline-store + offline-cache on an in-memory IndexedDB (jsdom has
 * none; the fake replaces only the browser `indexedDB` global). Assertions
 * read back what landed in the store. Connectivity is mocked because
 * offline-store consults it for cache expiry.
 *
 * offline-sync-eviction.test.ts covers the eviction RULE with a mocked
 * store; this file covers every step, the soft-failure bookkeeping and the
 * progress reporting.
 */
vi.mock('../connectivity', () => ({ isOnline: () => true, onConnectivityChange: () => () => {} }));

import { syncAllDataForOffline, filterIdsWithUnsyncedWork, buildIdentifierMap, type SyncProgress } from '../offline-sync-service';
import {
  getCachedData, getCachedFilters, getCachedBlocks, getCachedAreas, getCachedAhus, getCachedFiltersTyped,
  queueOperation, queueTombstone, cacheData,
} from '../offline-store';

const tpl = [{ id: 't-filter', templateKind: 'FILTER' }, { id: 't-ahu', templateKind: 'AHU' }];
const inst = [
  { id: 'f-1', name: 'F-1', templateId: 't-filter', template: { templateKind: 'FILTER' }, parentId: 'ahu-1', isActive: true, status: 'Active' },
  { id: 'f-2', name: 'F-2', templateId: 't-filter', parentId: 'ahu-1', isActive: true, status: 'Active' }, // no template projection
  { id: 'f-ret', name: 'F-R', templateId: 't-filter', isActive: true, status: 'Retired' },
  { id: 'f-off', name: 'F-O', templateId: 't-filter', isActive: false, status: 'Active' },
  { id: 'ahu-1', name: 'AHU-1', templateId: 't-ahu', template: { templateKind: 'AHU' }, isActive: true, status: 'Active' },
];
const submitAction = {
  type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Wash', blocking: true,
  params: { checklistProfileId: 'cl-1', versionPin: 1, afterStage: 'WASH_IN', questions: [{ id: 'q', question: 'Q', questionType: 'YES_NO', required: true, section: null, description: null, options: [], validation: {}, sortOrder: 0 }] },
};

/** Every endpoint answers successfully. Individual tests override with api.add (which takes priority). */
function happyRoutes(api: MockApi) {
  api.routes.push(
    { path: '/api/assets/templates', body: { data: tpl } },
    { path: '/api/assets/instances', body: { data: inst } },
    { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b-1', name: 'B1' }] } },
    { path: '/api/hierarchy/areas', body: { data: [{ id: 'a-1', name: 'A1', blockId: 'b-1' }] } },
    { path: '/api/hierarchy/ahus', body: { data: [{ id: 'ahu-1', name: 'AHU-1', areaId: 'a-1' }] } },
    { path: '/api/hierarchy/filters', body: { data: [{ id: 'f-1', name: 'F-1', ahuId: 'ahu-1' }] } },
    { path: '/api/filters/batch-states', body: { states: { 'f-1': { currentState: 'WASH_IN', actions: [submitAction], tapeVersion: 3 }, 'f-2': { currentState: null } }, cachedAt: 'x' } },
    { path: '/api/filters/reasons', body: { reasons: [{ key: 'PM', label: 'Preventive' }] } },
    { path: '/api/equipment-groups', body: [{ id: 'eg-1', name: 'EG' }] },
    { path: '/api/assets/identifiers', body: [{ identifierValue: 'Ca01', assetId: 'f-1', asset: { name: 'F-1', status: 'Active', isActive: true, approvalStatus: 'APPROVED' } }] },
    { path: '/api/pm-schedules/due', body: { tasks: [{ id: 'pm-1' }] } },
    { path: '/api/checklist-profiles', body: { data: [{ id: 'cl-1', name: 'Wash', questions: [] }] } },
    { path: '/api/filter-cleaning-profiles', body: { data: [{ id: 'cp-1' }, { id: 'cp-2' }] } },
    { path: '/api/filter-cleaning-profiles/cp-1', body: { id: 'cp-1', stages: [] } },
    { path: '/api/filter-cleaning-profiles/cp-2', body: { id: 'cp-2', stages: [] } },
  );
}

let api: MockApi;
let fake: FakeIdb;
let warn: ReturnType<typeof vi.spyOn>;
let progress: SyncProgress[];
const onProgress = (p: SyncProgress) => progress.push(p);
const softWarnings = () => warn.mock.calls.map((c: any[]) => c[0]);

beforeEach(async () => {
  fake = installFakeIndexedDB();
  await openAppDb();
  sessionStorage.setItem('access_token', 'jwt');
  api = mockApi();
  happyRoutes(api);
  progress = [];
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('syncAllDataForOffline — every step succeeds', () => {
  it('returns true, reports all 9 steps then "All data synced", and caches every dataset', async () => {
    expect(await syncAllDataForOffline(onProgress)).toBe(true);
    expect(progress.map((p) => p.step)).toEqual([
      'Syncing templates...', 'Syncing filters...', 'Syncing filter states...', 'Syncing cleaning reasons...',
      'Syncing equipment groups...', 'Syncing identifiers...', 'Syncing PM schedules...',
      'Syncing checklist profiles...', 'Syncing cleaning profiles...', 'All data synced',
    ]);
    expect(progress.map((p) => p.current)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(progress.at(-1)).toEqual({ step: 'All data synced', current: 9, total: 9, done: true, error: undefined, partialFailures: undefined });

    expect(await getCachedData('templates')).toEqual(tpl);
    expect(await getCachedData('instances-raw')).toEqual(inst);
    expect((await getCachedFilters()).map((f) => f.id)).toEqual(inst.map((i) => i.id));
    expect(await getCachedBlocks()).toEqual([{ id: 'b-1', name: 'B1' }]);
    expect(await getCachedAreas()).toEqual([{ id: 'a-1', name: 'A1', blockId: 'b-1' }]);
    expect(await getCachedAhus()).toEqual([{ id: 'ahu-1', name: 'AHU-1', areaId: 'a-1' }]);
    expect(await getCachedFiltersTyped()).toEqual([{ id: 'f-1', name: 'F-1', ahuId: 'ahu-1' }]);

    // filter-state rows get pendingChecklist derived from the tape (2026-07-10 regression)
    const fs1 = await getCachedData<any>('filter-state-f-1');
    expect(fs1.pendingChecklist).toEqual([expect.objectContaining({ checklistProfileId: 'cl-1', checklistProfileName: 'Wash', pipelineNodeId: 'WASH_IN-cl-1' })]);
    expect(await getCachedData('filter-state-f-2')).toEqual({ currentState: null });

    expect(await getCachedData('cleaning-reasons')).toEqual([{ key: 'PM', label: 'Preventive' }]);
    expect(await getCachedData('equipment-groups')).toEqual([{ id: 'eg-1', name: 'EG' }]);
    const idMap = await getCachedData<any>('identifier-map');
    expect(Object.keys(idMap).sort()).toEqual(['CA01', 'Ca01', 'ca01']);
    expect(idMap.CA01).toEqual({ filterId: 'f-1', filterName: 'F-1', approvalStatus: 'APPROVED' });
    expect(await getCachedData('due-tasks')).toEqual({ tasks: [{ id: 'pm-1' }] });
    expect(await getCachedData('checklist-profiles')).toEqual([{ id: 'cl-1', name: 'Wash', questions: [] }]);
    expect(await getCachedData('cleaning-profiles')).toEqual([{ id: 'cp-1' }, { id: 'cp-2' }]);
    expect(await getCachedData('cleaning-profile-cp-2')).toEqual({ id: 'cp-2', stages: [] });

    expect(api.calls('GET', '/api/checklist-profiles')[0].url).toMatch(/isActive=true&expand=questions$/);
    expect(api.calls('GET', '/api/filter-cleaning-profiles')[0].query.get('status')).toBe('ACTIVE');
    expect(api.unmatched).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('evicts cached filter-state rows /batch-states no longer returns, keeping filters with unsynced work', async () => {
    await cacheData('filter-state-gone', { currentState: 'WASH_IN' });
    await cacheData('filter-state-queued', { currentState: 'WASH_IN', tapeVersion: 9 });
    await queueOperation({ type: 'advance', filterId: 'queued', filterName: 'Q', payload: {}, userId: null, userName: null });
    await syncAllDataForOffline();
    expect(await getCachedData('filter-state-gone')).toBeNull();
    expect(await getCachedData('filter-state-queued')).toEqual({ currentState: 'WASH_IN', tapeVersion: 9 });
    expect(await getCachedData('filter-state-f-1')).not.toBeNull();
  });

  it('works without a progress callback; tolerates alternative response shapes', async () => {
    api.add(
      { path: '/api/filters/reasons', body: [{ key: 'BD' }] },          // bare array, no {reasons}
      { path: '/api/equipment-groups', body: { data: [{ id: 'eg-2' }] } }, // {data} wrapper
      { path: '/api/assets/identifiers', body: { not: 'an array' } },
      { path: '/api/filters/batch-states', body: { cachedAt: 'x' } },     // no states → nothing cached, nothing evicted
    );
    await cacheData('filter-state-old', { currentState: 'DRY_IN' });
    expect(await syncAllDataForOffline()).toBe(true);
    expect(await getCachedData('cleaning-reasons')).toEqual([{ key: 'BD' }]);
    expect(await getCachedData('equipment-groups')).toEqual([{ id: 'eg-2' }]);
    expect(await getCachedData('identifier-map')).toEqual({});
    expect(await getCachedData('filter-state-old')).toEqual({ currentState: 'DRY_IN' });
  });
  it('responses without a `data` wrapper are cached as empty lists (no crash, no soft failure)', async () => {
    for (const path of ['/api/assets/templates', '/api/assets/instances', '/api/hierarchy/blocks', '/api/hierarchy/areas',
      '/api/hierarchy/ahus', '/api/hierarchy/filters', '/api/filters/reasons', '/api/equipment-groups',
      '/api/checklist-profiles', '/api/filter-cleaning-profiles']) {
      api.add({ path, body: {} });
    }
    expect(await syncAllDataForOffline()).toBe(true);
    expect(await getCachedData('templates')).toEqual([]);
    expect(await getCachedData('instances-raw')).toEqual([]);
    expect(await getCachedBlocks()).toEqual([]);
    expect(await getCachedFiltersTyped()).toEqual([]);
    expect(await getCachedData('cleaning-reasons')).toEqual({});
    expect(await getCachedData('equipment-groups')).toEqual([]);
    expect(await getCachedData('checklist-profiles')).toEqual([]);
    expect(await getCachedData('cleaning-profiles')).toEqual([]);
  });
});

describe('buildIdentifierMap — malformed rows', () => {
  it('skips rows without a value or asset id; falls back to the asset id for the name; null approval when absent', () => {
    const map = buildIdentifierMap([
      null, { assetId: 'x' }, { identifierValue: 'V1' }, { identifierValue: 'v2', assetId: 'f-2' },
      { identifierValue: 'v3', assetId: 'f-3', asset: { status: 'Active' } },
    ]);
    expect(Object.keys(map).sort()).toEqual(['V2', 'V3', 'v2', 'v3']);
    expect(map.v2).toEqual({ filterId: 'f-2', filterName: 'f-2', approvalStatus: null });
    expect(map.v3.filterName).toBe('f-3');
  });

  it('a non-array input yields an empty map', () => {
    expect(buildIdentifierMap(null as any)).toEqual({});
    expect(buildIdentifierMap({} as any)).toEqual({});
  });
});

describe('syncAllDataForOffline — soft failures are recorded, never silent', () => {
  it('every optional step failing → returns false, final event lists each failed step, and each is logged', async () => {
    const fail = { status: 500, body: { error: 'INTERNAL', message: 'boom' } };
    api.add(
      { path: '/api/assets/templates', ...fail },
      { path: '/api/hierarchy/areas', ...fail },
      { path: '/api/filters/reasons', status: 403, body: { error: 'FORBIDDEN', message: 'Permission denied' } },
      { path: '/api/equipment-groups', ...fail },
      { path: '/api/assets/identifiers', ...fail },
      { path: '/api/pm-schedules/due', status: 403, body: { error: 'FORBIDDEN', message: 'no PM_READ' } },
      { path: '/api/checklist-profiles', ...fail },
      { path: '/api/filter-cleaning-profiles', ...fail },
    );
    expect(await syncAllDataForOffline(onProgress)).toBe(false);
    const last = progress.at(-1)!;
    expect(last).toMatchObject({ step: 'Synced with warnings: 8 step(s) failed', done: true, current: 9 });
    expect(last.partialFailures).toEqual([
      'templates', 'typed-hierarchy-caches', 'cleaning-reasons', 'equipment-groups', 'identifier-map',
      'pm-schedules', 'checklist-profiles', 'cleaning-profiles',
    ]);
    expect(softWarnings()).toContain('[offline-sync] soft failure on "cleaning-reasons":');
    expect(warn).toHaveBeenCalledWith('[offline-sync] soft failure on "cleaning-reasons":', 'Permission denied');
    // The steps after the 403 still ran (the 2026-09-02 fix).
    expect(api.calls('GET', '/api/checklist-profiles')).toHaveLength(1);
  });

  it('batch-states missing → per-filter fallback for active, non-retired FILTER instances (by templateKind OR template id)', async () => {
    api.add(
      { path: '/api/filters/batch-states', status: 404, body: { error: 'NOT_FOUND', message: 'no batch' } },
      { path: '/api/filters/f-1/current-state', body: { currentState: 'WASH_IN', actions: [submitAction] } },
      { path: '/api/filters/f-2/current-state', body: { currentState: 'DRY_IN' } },
    );
    await cacheData('filter-state-other', { currentState: 'X' });
    expect(await syncAllDataForOffline(onProgress)).toBe(false);
    expect(api.requests.filter((r) => r.path.endsWith('/current-state')).map((r) => r.path).sort())
      .toEqual(['/api/filters/f-1/current-state', '/api/filters/f-2/current-state']);
    expect((await getCachedData<any>('filter-state-f-1')).pendingChecklist).toHaveLength(1);
    expect(await getCachedData('filter-state-f-2')).toEqual({ currentState: 'DRY_IN' });
    // a partial list must never evict
    expect(await getCachedData('filter-state-other')).toEqual({ currentState: 'X' });
    expect(progress.at(-1)!.partialFailures).toEqual(['filter-states-batch']);
  });

  it.each([
    [1, 'filter-states-individual (1 miss)'],
    [2, 'filter-states-individual (2 misses)'],
  ])('per-filter fallback with %i failing filter(s) is recorded as "%s"', async (n, label) => {
    api.add(
      { path: '/api/filters/batch-states', status: 404, body: { error: 'NOT_FOUND', message: 'x' } },
      { path: '/api/filters/f-1/current-state', ...(n >= 1 ? { status: 500, body: { error: 'E', message: 'e' } } : { body: {} }) },
      { path: '/api/filters/f-2/current-state', ...(n >= 2 ? { status: 500, body: { error: 'E', message: 'e' } } : { body: {} }) },
    );
    await syncAllDataForOffline(onProgress);
    expect(progress.at(-1)!.partialFailures).toEqual(['filter-states-batch', label]);
  });

  it('per-filter fallback when the templates step also failed still finds filters by templateKind', async () => {
    api.add(
      { path: '/api/assets/templates', status: 500, body: { error: 'E', message: 'e' } },
      { path: '/api/filters/batch-states', status: 404, body: { error: 'NOT_FOUND', message: 'x' } },
      { path: '/api/filters/f-1/current-state', body: {} },
    );
    await syncAllDataForOffline();
    expect(api.requests.filter((r) => r.path.endsWith('/current-state')).map((r) => r.path)).toEqual(['/api/filters/f-1/current-state']);
  });

  it.each([
    [1, 'cleaning-profile-pipelines (1 miss)'],
    [2, 'cleaning-profile-pipelines (2 misses)'],
  ])('%i cleaning-profile pipeline fetch(es) failing → "%s"', async (n, label) => {
    api.add({ path: '/api/filter-cleaning-profiles/cp-1', status: 500, body: { error: 'E', message: 'e' } });
    if (n === 2) api.add({ path: '/api/filter-cleaning-profiles/cp-2', status: 500, body: { error: 'E', message: 'e' } });
    await syncAllDataForOffline(onProgress);
    expect(progress.at(-1)!.partialFailures).toEqual([label]);
    expect(await getCachedData('cleaning-profiles')).toEqual([{ id: 'cp-1' }, { id: 'cp-2' }]);
  });

  it('the eviction step failing is a soft failure; the identifier map is still built (queue read failure tolerated)', async () => {
    // Remove the operations store so reading the queue fails — the only way the
    // eviction (and the identifier-map keep-set) can fail short of a broken IDB.
    fake.dbs.get('digilog-offline')!.stores.delete('operations');
    expect(await syncAllDataForOffline(onProgress)).toBe(false);
    expect(progress.at(-1)!.partialFailures).toEqual(['filter-states-evict']);
    expect(Object.keys(await getCachedData<any>('identifier-map'))).toContain('CA01');
  });
});

describe('syncAllDataForOffline — a hard failure aborts', () => {
  it('the instances fetch failing reports "Sync failed: <message>" with the soft failures so far, and returns false', async () => {
    api.add(
      { path: '/api/assets/templates', status: 500, body: { error: 'E', message: 'tpl down' } },
      { path: '/api/assets/instances', status: 403, body: { error: 'FORBIDDEN', message: 'Permission denied' } },
    );
    expect(await syncAllDataForOffline(onProgress)).toBe(false);
    expect(progress.at(-1)).toEqual({ step: 'Sync failed: Permission denied', current: 1, total: 9, done: false, error: 'Permission denied', partialFailures: ['templates'] });
    expect(api.calls('GET', '/api/filters/batch-states')).toHaveLength(0);
  });

  it('a hard failure with no prior soft failures reports partialFailures undefined; an error with no message says "Unknown error"', async () => {
    api.add({ path: '/api/assets/instances', body: (_r: MockRequest) => { throw Object.assign(new Error(''), {}); } });
    expect(await syncAllDataForOffline(onProgress)).toBe(false);
    expect(progress.at(-1)).toMatchObject({ step: 'Sync failed: Unknown error', partialFailures: undefined });
  });
});

describe('filterIdsWithUnsyncedWork (real store)', () => {
  it('collects non-synced op filter ids and tombstone filter ids; ignores non-string tombstone ids', async () => {
    await queueOperation({ type: 'advance', filterId: 'a', filterName: 'A', payload: {}, userId: 'u1', userName: 'U1' });
    await queueTombstone({ entityType: 'cycle', entityId: 'c', payload: { filterId: 'b' } });
    await queueTombstone({ entityType: 'block-change-request', entityId: 'bcr', payload: { filterId: 42 } });
    expect([...await filterIdsWithUnsyncedWork()].sort()).toEqual(['a', 'b']);
  });

  it('a missing tombstones store (getPendingTombstones answers []) does not lose the operations-derived ids', async () => {
    await queueOperation({ type: 'advance', filterId: 'a', filterName: 'A', payload: {}, userId: null, userName: null });
    fake.dbs.get('digilog-offline')!.stores.delete('tombstones');
    expect([...await filterIdsWithUnsyncedWork()]).toEqual(['a']);
  });
});
