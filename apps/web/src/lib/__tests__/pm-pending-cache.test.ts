import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockApi, type MockApi, type MockRequest } from '@/test-utils/page-harness';
import { installFakeIndexedDB } from '@/routes/filter-management/hooks/__tests__/fake-indexeddb';

/**
 * pm-pending-cache.ts — the tablet's offline answer to "does this AHU still
 * owe an earlier PM?".
 *
 * Real: apiClient (over a stubbed global `fetch` via mockApi) and offline-store
 * on an in-memory IndexedDB (jsdom has none; the fake replaces only the
 * browser `indexedDB` global). Connectivity is mocked because offline-store
 * consults it to decide whether to honour cache expiry — the test flips it.
 */
const conn = vi.hoisted(() => ({ online: true }));
vi.mock('../connectivity', () => ({ isOnline: () => conn.online, onConnectivityChange: () => () => {} }));

import {
  refreshPmPendingCache, getCachedPmPendingMap, getCachedPendingPmTasksForFilter, forgetCachedPmTasks,
} from '../pm-pending-cache';
import { cacheFilters, getCachedData } from '../offline-store';

const task = (entryId: string, ahuName = 'AHU-1') => ({
  entryId, ahuName, plannedDate: '2026-09-10', windowStart: '2026-08-26', windowEnd: '2026-09-25', overdueDays: 26,
});
const filterRow = (id: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({
  id, name: id, templateId: 't', filterSet: null, currentLifecycleState: null, currentCycleId: null,
  attributes: {}, parentId, isActive: true, status: 'Active', ...extra,
});

let api: MockApi;
beforeEach(() => {
  installFakeIndexedDB();
  conn.online = true;
  sessionStorage.setItem('access_token', 'jwt');
  api = mockApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('refreshPmPendingCache', () => {
  it('stores the server map under pm-pending-tasks-map', async () => {
    api.add({ path: '/api/pm-schedules/pending-tasks-map', body: (_r: MockRequest) => ({ 'ahu-1': [task('e1')] }) });
    await refreshPmPendingCache();
    expect(api.calls('GET', '/api/pm-schedules/pending-tasks-map')[0].headers.authorization).toBe('Bearer jwt');
    expect(await getCachedData('pm-pending-tasks-map')).toEqual({ 'ahu-1': [task('e1')] });
    expect(await getCachedPmPendingMap()).toEqual({ 'ahu-1': [task('e1')] });
  });

  it('a failed refresh (403 / offline) never throws and keeps the previous snapshot', async () => {
    api.add({ path: '/api/pm-schedules/pending-tasks-map', times: 1, body: { 'ahu-1': [task('e1')] } });
    await refreshPmPendingCache();
    api.add({ path: '/api/pm-schedules/pending-tasks-map', status: 403, body: { error: 'FORBIDDEN', message: 'Missing PM_READ' } });
    await expect(refreshPmPendingCache()).resolves.toBeUndefined();
    expect(await getCachedPmPendingMap()).toEqual({ 'ahu-1': [task('e1')] });
  });

  it('a null body is stored as an empty map', async () => {
    api.add({ path: '/api/pm-schedules/pending-tasks-map', body: null });
    await refreshPmPendingCache();
    expect(await getCachedPmPendingMap()).toEqual({});
  });
});

describe('getCachedPendingPmTasksForFilter', () => {
  beforeEach(async () => {
    api.add({ path: '/api/pm-schedules/pending-tasks-map', body: { 'ahu-1': [task('e1'), task('e2')], 'ahu-2': [task('e3', 'AHU-2')] } });
    await refreshPmPendingCache();
  });

  it('resolves the filter\'s AHU from the cached filter rows (parentId) — works with no network', async () => {
    await cacheFilters([filterRow('f-1', 'ahu-1'), filterRow('f-2', 'ahu-2')] as any);
    conn.online = false;
    expect((await getCachedPendingPmTasksForFilter('f-1')).map((t) => t.entryId)).toEqual(['e1', 'e2']);
    expect((await getCachedPendingPmTasksForFilter('f-2')).map((t) => t.entryId)).toEqual(['e3']);
  });

  it('prefers an explicit ahuId over parentId', async () => {
    await cacheFilters([filterRow('f-1', 'ahu-1', { ahuId: 'ahu-2' })] as any);
    expect((await getCachedPendingPmTasksForFilter('f-1')).map((t) => t.entryId)).toEqual(['e3']);
  });

  it.each([
    ['an unknown filter', 'f-unknown', [filterRow('f-1', 'ahu-1')]],
    ['a filter with no AHU', 'f-1', [filterRow('f-1', null)]],
    ['an AHU that owes nothing', 'f-1', [filterRow('f-1', 'ahu-9')]],
  ])('%s → [] (an unknown AHU must not block cleaning)', async (_l, id, rows) => {
    await cacheFilters(rows as any);
    expect(await getCachedPendingPmTasksForFilter(id)).toEqual([]);
  });
});

describe('getCachedPendingPmTasksForFilter with nothing cached', () => {
  it('returns [] without needing filter rows', async () => {
    await cacheFilters([filterRow('f-1', 'ahu-1')] as any);
    expect(await getCachedPendingPmTasksForFilter('f-1')).toEqual([]);
    expect(await getCachedPmPendingMap()).toEqual({});
  });
});

describe('forgetCachedPmTasks', () => {
  beforeEach(async () => {
    api.add({ path: '/api/pm-schedules/pending-tasks-map', body: { 'ahu-1': [task('e1'), task('e2')], 'ahu-2': [task('e3', 'AHU-2')] } });
    await refreshPmPendingCache();
  });

  it('drops written-off entries, and an AHU left with none disappears from the map', async () => {
    await forgetCachedPmTasks(['e1', 'e3']);
    expect(await getCachedPmPendingMap()).toEqual({ 'ahu-1': [task('e2')] });
  });

  it('an empty list is a no-op (no write)', async () => {
    const before = await getCachedPmPendingMap();
    await forgetCachedPmTasks([]);
    expect(await getCachedPmPendingMap()).toEqual(before);
  });

  it('unknown ids leave the map as it was', async () => {
    await forgetCachedPmTasks(['nope']);
    expect(Object.keys(await getCachedPmPendingMap()).sort()).toEqual(['ahu-1', 'ahu-2']);
  });
});
