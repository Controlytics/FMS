import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { mockApi, type MockApi, type MockRequest } from '@/test-utils/page-harness';
import { installFakeIndexedDB } from '@/routes/filter-management/hooks/__tests__/fake-indexeddb';

/**
 * useOffline — the offline-aware write wrapper + queue/sync status.
 *
 * What runs for real: the hook, apiClient (over a stubbed global `fetch` via
 * mockApi), offline-store (on an in-memory IndexedDB — jsdom has none and
 * fake-indexeddb is not installed; the fake replaces only the browser
 * `indexedDB` global), offline-cache and local-context.
 *
 * Mocked at the narrowest boundary:
 *   - `@/lib/connectivity` — Capacitor Network plugin + /api/health poller.
 *     Faked as a switch so a test can go online/offline.
 *   - `@/lib/sync-engine` — PROTECTED surface with its own suites. Faked so no
 *     background drain timer replays the queue mid-test; the test emits sync
 *     events and observes syncPendingOperations calls.
 */

const h = vi.hoisted(() => ({
  online: true,
  connListeners: new Set<(o: boolean) => void>(),
  syncListeners: new Set<(e: any) => void>(),
  startConnectivityEngine: vi.fn(async () => {}),
  startAutoSync: vi.fn(),
  syncPendingOperations: vi.fn(async () => ({ synced: 3, failed: 0 })),
}));
vi.mock('@/lib/connectivity', () => ({
  isOnline: () => h.online,
  onConnectivityChange: (cb: (o: boolean) => void) => { h.connListeners.add(cb); return () => { h.connListeners.delete(cb); }; },
  startConnectivityEngine: h.startConnectivityEngine,
}));
vi.mock('@/lib/sync-engine', () => ({
  onSyncEvent: (cb: (e: any) => void) => { h.syncListeners.add(cb); return () => { h.syncListeners.delete(cb); }; },
  startAutoSync: h.startAutoSync,
  syncPendingOperations: h.syncPendingOperations,
  emitSyncStage: () => {},
}));

import { useOffline } from '../use-offline';
import { queueOperation, getAllOperations, cacheData, getCachedData, getCachedFilters } from '@/lib/offline-store';

const FID = 'f-1';
// async act: a 'complete' event starts an IndexedDB recount whose state update
// lands a few microtasks later.
const emitSync = (e: any) => act(async () => { for (const l of [...h.syncListeners]) l(e); await new Promise((r) => setTimeout(r, 0)); });
const netDown = (message = 'Failed to fetch') => (_r: MockRequest) => { throw new TypeError(message); };
const apiErr = (status: number, error: string, message: string) => ({ status, body: { error, message } });

let api: MockApi;
let err: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

async function mountHook() {
  const r = renderHook(() => useOffline());
  await waitFor(() => expect(h.startAutoSync).toHaveBeenCalled());
  return r;
}

beforeEach(() => {
  installFakeIndexedDB();
  h.online = true;
  h.connListeners.clear();
  h.syncListeners.clear();
  h.startConnectivityEngine.mockClear();
  h.startAutoSync.mockClear();
  h.syncPendingOperations.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('access_token', 'jwt');
  localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-me', fullName: 'Me Operator' }));
  api = mockApi();
  err = vi.spyOn(console, 'error');
  warn = vi.spyOn(console, 'warn');
});

afterEach(() => {
  // Normal use must not log: React act() warnings, store warnings, etc.
  expect(err).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function assertConsoleClean() {
  expect(err).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
}

describe('mount', () => {
  it('starts the connectivity engine and auto-sync, and mirrors connectivity changes', async () => {
    h.online = false;
    const { result } = await mountHook();
    expect(h.startConnectivityEngine).toHaveBeenCalledTimes(1);
    expect(result.current.online).toBe(false);
    act(() => { for (const l of h.connListeners) l(true); });
    expect(result.current.online).toBe(true);
    assertConsoleClean();
  });

  it('counts only ops this user may replay; another operator\'s ops are held', async () => {
    const base = { type: 'advance' as const, filterId: FID, filterName: 'F-1', payload: {} };
    await queueOperation({ ...base, userId: 'u-me', userName: 'Me' });
    await queueOperation({ ...base, userId: null, userName: null });
    await queueOperation({ ...base, userId: 'u-other', userName: 'Asha' });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.pendingCount).toBe(2));
    expect(result.current.heldOps.map((o) => o.userName)).toEqual(['Asha']);
  });
});

describe('sync events', () => {
  it('start → syncing; complete with synced → message + callback + recount; error text surfaces', async () => {
    const { result } = await mountHook();
    const onDone = vi.fn();
    act(() => { result.current.setOnSyncComplete(() => onDone); });

    await emitSync({ type: 'start', total: 2 });
    expect(result.current.syncing).toBe(true);
    expect(result.current.online).toBe(true);

    await emitSync({ type: 'complete', synced: 2, total: 2 });
    expect(result.current.syncing).toBe(false);
    expect(result.current.lastSyncMessage).toBe('Synced 2 operation(s)');
    expect(onDone).toHaveBeenCalledTimes(1);

    await emitSync({ type: 'error', error: 'F-1: Validation failed' });
    expect(result.current.lastSyncMessage).toBe('F-1: Validation failed');
    await emitSync({ type: 'error' });
    expect(result.current.lastSyncMessage).toBe('Sync error');
  });

  it('a complete with nothing synced leaves the message alone and does not call the callback', async () => {
    const { result } = await mountHook();
    const onDone = vi.fn();
    act(() => { result.current.setOnSyncComplete(() => onDone); });
    await emitSync({ type: 'complete', synced: 0, total: 0 });
    expect(result.current.lastSyncMessage).toBe('');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('complete with synced but no callback registered is fine', async () => {
    const { result } = await mountHook();
    await emitSync({ type: 'complete', synced: 1 });
    expect(result.current.lastSyncMessage).toBe('Synced 1 operation(s)');
  });
});

describe('executeOrQueue — online', () => {
  it.each([
    ['advance', '/api/filters/f-1/advance'],
    ['advance-with-checklist', '/api/filters/f-1/advance-with-checklist'],
    ['submit-checklist', '/api/filters/f-1/submit-checklist'],
    ['bypass', '/api/filters/f-1/bypass'],
    ['terminate', '/api/filters/f-1/terminate-cycle'],
  ] as const)('%s posts to %s with the cached tapeVersion + a clientOpId, then caches the returned state', async (type, url) => {
    await cacheData(`filter-state-${FID}`, { currentState: 'WASH_IN', tapeVersion: 41 });
    api.add({ method: 'POST', path: url, body: { currentState: 'WASH_OUT', tapeVersion: 42, actions: [] } });
    const { result } = await mountHook();
    let out: any;
    await act(async () => { out = await result.current.executeOrQueue(type, FID, 'F-1', { targetState: 'WASH_OUT' }); });
    expect(out).toEqual({ executed: true, result: { currentState: 'WASH_OUT', tapeVersion: 42, actions: [] } });
    const sent = api.calls('POST', url)[0].json;
    expect(sent).toMatchObject({ targetState: 'WASH_OUT', tapeVersion: 41 });
    expect(sent.clientOpId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getCachedData<any>(`filter-state-${FID}`))).toMatchObject({ currentState: 'WASH_OUT', tapeVersion: 42 });
    expect(await getAllOperations()).toEqual([]);
    assertConsoleClean();
  });

  it('no cached tape → no tapeVersion field; a response without a numeric tape is not cached', async () => {
    api.add({ method: 'POST', path: '/api/filters/f-1/advance', body: { ok: true } });
    const { result } = await mountHook();
    await act(async () => { await result.current.executeOrQueue('advance', FID, 'F-1', { targetState: 'WASH_OUT' }); });
    expect(api.calls('POST', '/api/filters/f-1/advance')[0].json).not.toHaveProperty('tapeVersion');
    expect(await getCachedData(`filter-state-${FID}`)).toBeNull();
  });

  it('start-cycle: no tapeVersion even if cached, then re-reads current-state to seed the cache', async () => {
    await cacheData(`filter-state-${FID}`, { tapeVersion: 5 });
    api.add(
      { method: 'POST', path: '/api/filters/f-1/start-cycle', body: { id: 'c-1' } },
      { path: '/api/filters/f-1/current-state', body: { currentState: null, tapeVersion: 1000001 } },
    );
    const { result } = await mountHook();
    await act(async () => { await result.current.executeOrQueue('start-cycle', FID, 'F-1', { reason: 'PM' }); });
    const body = api.calls('POST', '/api/filters/f-1/start-cycle')[0].json;
    expect(body).toMatchObject({ reason: 'PM' });
    expect(body).not.toHaveProperty('tapeVersion');
    expect((await getCachedData<any>(`filter-state-${FID}`)).tapeVersion).toBe(1000001);
  });

  it('start-cycle: a failing post-start cache refresh does not fail the operation', async () => {
    api.add({ method: 'POST', path: '/api/filters/f-1/start-cycle', body: { id: 'c-1' } });
    api.add({ path: '/api/filters/f-1/current-state', status: 500, body: { error: 'INTERNAL', message: 'x' } });
    const { result } = await mountHook();
    let out: any;
    await act(async () => { out = await result.current.executeOrQueue('start-cycle', FID, 'F-1', {}); });
    expect(out.executed).toBe(true);
  });

  it.each([
    ['start-and-advance', '/api/filters/f-1/advance'],
    ['start-and-advance-with-checklist', '/api/filters/f-1/advance-with-checklist'],
  ] as const)('%s: start (:start id) → fresh tape → advance half (:advance id)', async (type, advanceUrl) => {
    api.add(
      { method: 'POST', path: '/api/filters/f-1/start-cycle', body: { id: 'c-1' } },
      { path: '/api/filters/f-1/current-state', body: { tapeVersion: 77 } },
      { method: 'POST', path: advanceUrl, body: { currentState: 'WASH_IN', tapeVersion: 78 } },
    );
    const { result } = await mountHook();
    await act(async () => {
      await result.current.executeOrQueue(type, FID, 'F-1', { cyclePayload: { reason: 'PM' }, advancePayload: { targetState: 'WASH_IN' } });
    });
    const start = api.calls('POST', '/api/filters/f-1/start-cycle')[0].json;
    const adv = api.calls('POST', advanceUrl)[0].json;
    expect(start.clientOpId).toMatch(/:start$/);
    expect(adv).toMatchObject({ targetState: 'WASH_IN', tapeVersion: 77 });
    expect(adv.clientOpId).toBe(start.clientOpId.replace(/:start$/, ':advance'));
  });

  it.each(['start-and-advance', 'start-and-advance-with-checklist'] as const)(
    '%s: CYCLE_ACTIVE on start is benign; a failed tape fetch just omits tapeVersion',
    async (type) => {
      const advUrl = type === 'start-and-advance' ? '/api/filters/f-1/advance' : '/api/filters/f-1/advance-with-checklist';
      api.add(
        { method: 'POST', path: '/api/filters/f-1/start-cycle', ...apiErr(409, 'CYCLE_ACTIVE', 'Cycle already active') },
        { path: '/api/filters/f-1/current-state', status: 500, body: { error: 'X', message: 'down' } },
        { method: 'POST', path: advUrl, body: {} },
      );
      const { result } = await mountHook();
      let out: any;
      await act(async () => { out = await result.current.executeOrQueue(type, FID, 'F-1', { cyclePayload: {}, advancePayload: { targetState: 'WASH_IN' } }); });
      expect(out.executed).toBe(true);
      expect(api.calls('POST', advUrl)[0].json).not.toHaveProperty('tapeVersion');
    },
  );

  it.each(['start-and-advance', 'start-and-advance-with-checklist'] as const)(
    '%s: any other start refusal is thrown and nothing is advanced or queued',
    async (type) => {
      api.add({ method: 'POST', path: '/api/filters/f-1/start-cycle', ...apiErr(409, 'BLOCK_CHANGE_REQUIRED', 'Block change required') });
      const { result } = await mountHook();
      await act(async () => {
        await expect(result.current.executeOrQueue(type, FID, 'F-1', { cyclePayload: {}, advancePayload: {} }))
          .rejects.toMatchObject({ code: 'BLOCK_CHANGE_REQUIRED', status: 409 });
      });
      expect(api.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/api/filters/f-1/start-cycle']);
      expect(await getAllOperations()).toEqual([]);
    },
  );

  it('a password routes through the re-auth variant (header + _currentPassword) and is never queued', async () => {
    api.add({ method: 'POST', path: '/api/filters/f-1/bypass', body: {} });
    const { result } = await mountHook();
    await act(async () => { await result.current.executeOrQueue('bypass', FID, 'F-1', { reason: 'Sensor fault' }, undefined, 'S3cret!'); });
    const call = api.calls('POST', '/api/filters/f-1/bypass')[0];
    expect(call.headers['x-reauth-password']).toBe('S3cret!');
    expect(call.json._currentPassword).toBe('S3cret!');
  });

  it('a validation / conflict / REAUTH error is thrown, not queued', async () => {
    api.add({ method: 'POST', path: '/api/filters/f-1/advance', ...apiErr(401, 'REAUTH_REQUIRED', 'Re-authentication required') });
    const { result } = await mountHook();
    await act(async () => {
      await expect(result.current.executeOrQueue('advance', FID, 'F-1', {})).rejects.toMatchObject({ error: 'REAUTH_REQUIRED' });
    });
    expect(await getAllOperations()).toEqual([]);
  });
});

describe('executeOrQueue — cache read failure', () => {
  it('an unreadable filter-state cache leaves tapeVersion off the request (the server decides), and the op still runs', async () => {
    const fake = installFakeIndexedDB();
    const { openAppDb } = await import('@/routes/filter-management/hooks/__tests__/fake-indexeddb');
    await openAppDb();
    fake.dbs.get('digilog-offline')!.stores.delete('cache'); // reading filter-state-* now rejects
    api.add({ method: 'POST', path: '/api/filters/f-1/advance', body: { tapeVersion: 2 } });
    const { result } = await mountHook();
    let out: any;
    await act(async () => { out = await result.current.executeOrQueue('advance', FID, 'F-1', { targetState: 'WASH_OUT' }); });
    expect(out.executed).toBe(true);
    expect(api.calls('POST', '/api/filters/f-1/advance')[0].json).not.toHaveProperty('tapeVersion');
  });
});

describe('executeOrQueue — STALE_TAPE auto-recovery', () => {
  it('refreshes the tape from current-state and retries ONCE with it', async () => {
    await cacheData(`filter-state-${FID}`, { tapeVersion: 10 });
    api.add(
      { method: 'POST', path: '/api/filters/f-1/advance', times: 1, ...apiErr(409, 'STALE_TAPE', 'Stale tape') },
      { path: '/api/filters/f-1/current-state', body: { tapeVersion: 13 } },
    );
    api.routes.push({ method: 'POST', path: '/api/filters/f-1/advance', body: { tapeVersion: 14 } });
    const { result } = await mountHook();
    let out: any;
    await act(async () => { out = await result.current.executeOrQueue('advance', FID, 'F-1', { targetState: 'WASH_OUT' }); });
    const sent = api.calls('POST', '/api/filters/f-1/advance').map((c) => c.json.tapeVersion);
    expect(sent).toEqual([10, 13]);
    expect(out).toEqual({ executed: true, result: { tapeVersion: 14 } });
  });

  it('retry still failing → CONCURRENT_EDIT (409) with the cause, and the cache is refreshed from the fetched state', async () => {
    await cacheData(`filter-state-${FID}`, { tapeVersion: 10 });
    api.add(
      { method: 'POST', path: '/api/filters/f-1/advance', times: 1, ...apiErr(409, 'STALE_TAPE', 'Stale tape') },
      { path: '/api/filters/f-1/current-state', body: { currentState: 'WASH_OUT', tapeVersion: 13 } },
    );
    api.routes.push({ method: 'POST', path: '/api/filters/f-1/advance', ...apiErr(409, 'OUT_OF_SEQUENCE', 'Cannot move to WASH_OUT from WASH_OUT') });
    const { result } = await mountHook();
    let caught: any;
    await act(async () => {
      try { await result.current.executeOrQueue('advance', FID, 'F-1', { targetState: 'WASH_OUT' }); } catch (e) { caught = e; }
    });
    expect(caught).toMatchObject({ code: 'CONCURRENT_EDIT', status: 409 });
    expect(caught.message).toMatch(/already moved on/);
    expect(caught.cause).toMatchObject({ code: 'OUT_OF_SEQUENCE' });
    expect(await getCachedData<any>(`filter-state-${FID}`)).toMatchObject({ currentState: 'WASH_OUT', tapeVersion: 13 });
    expect(await getAllOperations()).toEqual([]);
  });

  it.each([
    ['current-state fetch fails', { status: 500, body: { error: 'X', message: 'down' } }],
    ['current-state has no numeric tape', { body: { tapeVersion: null } }],
  ])('%s → the ORIGINAL STALE_TAPE error is thrown', async (_l, route) => {
    api.add(
      { method: 'POST', path: '/api/filters/f-1/submit-checklist', ...apiErr(409, 'STALE_TAPE', 'Stale tape') },
      { path: '/api/filters/f-1/current-state', ...route },
    );
    const { result } = await mountHook();
    await act(async () => {
      await expect(result.current.executeOrQueue('submit-checklist', FID, 'F-1', {})).rejects.toMatchObject({ code: 'STALE_TAPE' });
    });
    expect(api.calls('POST', '/api/filters/f-1/submit-checklist')).toHaveLength(1);
  });
});

describe('executeOrQueue — network failure queues the op', () => {
  it('queues with the SAME clientOpId the online attempt used, the cached tape, the owner, and no password', async () => {
    await cacheData(`filter-state-${FID}`, { tapeVersion: 9 });
    api.add({ method: 'POST', path: '/api/filters/f-1/advance', body: netDown() });
    const { result } = await mountHook();
    let out: any;
    await act(async () => { out = await result.current.executeOrQueue('advance', FID, 'F-1', { targetState: 'WASH_OUT' }, undefined, 'pw'); });
    expect(out).toEqual({ executed: false });
    const [op] = await getAllOperations();
    expect(op).toMatchObject({
      type: 'advance', filterId: FID, filterName: 'F-1', payload: { targetState: 'WASH_OUT' },
      tapeVersion: 9, status: 'pending', retryCount: 0, userId: 'u-me', userName: 'Me Operator',
    });
    expect(op.clientOpId).toBe(api.calls('POST', '/api/filters/f-1/advance')[0].json.clientOpId);
    expect(JSON.stringify(op)).not.toContain('pw');
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it.each([
    'NetworkError when attempting to fetch resource.',
    'Network request failed',
    'Unable to resolve host "192.168.1.53"',
    'connect ECONNREFUSED 192.168.1.53:3000',
    'Load failed',
    'failed to connect to /192.168.1.53',
    'TLS handshake failed',
    'SSL certificate problem',
  ])('transport failure "%s" is queued', async (message) => {
    api.add({ method: 'POST', path: '/api/filters/f-1/bypass', body: (_r: MockRequest) => { throw new Error(message); } });
    const { result } = await mountHook();
    let out: any;
    await act(async () => { out = await result.current.executeOrQueue('bypass', FID, 'F-1', {}); });
    expect(out.executed).toBe(false);
    expect(await getAllOperations()).toHaveLength(1);
  });

  it('start-cycle queued offline with an optimistic state: the cache shows the new stage and the filter row gets an offline cycle id', async () => {
    const { cacheFilters } = await import('@/lib/offline-store');
    await cacheFilters([{ id: FID, name: 'F-1', templateId: 't', filterSet: null, currentLifecycleState: null, currentCycleId: null, attributes: {}, parentId: null, isActive: true, status: 'Active' }]);
    api.add({ method: 'POST', path: '/api/filters/f-1/start-cycle', body: netDown() });
    const { result } = await mountHook();
    await act(async () => { await result.current.executeOrQueue('start-cycle', FID, 'F-1', { reason: 'PM' }, 'WASH_IN'); });
    const [op] = await getAllOperations();
    expect(op).toMatchObject({ type: 'start-cycle', tapeVersion: null });
    expect((await getCachedData<any>(`filter-state-${FID}`)).currentState).toBe('WASH_IN');
    const [row] = await getCachedFilters();
    expect(row.currentLifecycleState).toBe('WASH_IN');
    expect(row.currentCycleId).toMatch(/^offline-cycle-\d+$/);
  });

  it('a cycle-bound op queued with an optimistic state does NOT invent a cycle', async () => {
    const { cacheFilters } = await import('@/lib/offline-store');
    await cacheFilters([{ id: FID, name: 'F-1', templateId: 't', filterSet: null, currentLifecycleState: 'WASH_IN', currentCycleId: null, attributes: {}, parentId: null, isActive: true, status: 'Active' }]);
    api.add({ method: 'POST', path: '/api/filters/f-1/advance', body: netDown() });
    const { result } = await mountHook();
    await act(async () => { await result.current.executeOrQueue('advance', FID, 'F-1', {}, 'WASH_OUT'); });
    const [row] = await getCachedFilters();
    expect(row).toMatchObject({ currentLifecycleState: 'WASH_OUT', currentCycleId: null });
  });
});

describe('queue utilities', () => {
  it('manualSync: offline → no drain; online → drains', async () => {
    const { result } = await mountHook();
    h.online = false;
    let r: any;
    await act(async () => { r = await result.current.manualSync(); });
    expect(r).toEqual({ synced: 0, failed: 0 });
    expect(h.syncPendingOperations).not.toHaveBeenCalled();
    h.online = true;
    await act(async () => { r = await result.current.manualSync(); });
    expect(r).toEqual({ synced: 3, failed: 0 });
  });

  it('cache/getCache, cacheFilterData/getOfflineFilters round-trip through IndexedDB', async () => {
    const { result } = await mountHook();
    const filter = { id: 'f-9', name: 'F-9', templateId: 't', filterSet: 'A', currentLifecycleState: null, currentCycleId: null, attributes: {}, parentId: null, isActive: true, status: 'Active' };
    await act(async () => {
      await result.current.cache('templates', [{ id: 't' }], 60_000);
      await result.current.cacheFilterData([filter]);
    });
    expect(await result.current.getCache('templates')).toEqual([{ id: 't' }]);
    expect(await result.current.getOfflineFilters()).toEqual([filter]);
  });

  it('getQueueDetails lists every op; clearQueue empties it and resets the count', async () => {
    await queueOperation({ type: 'advance', filterId: FID, filterName: 'F-1', payload: {}, userId: 'u-me', userName: 'Me' });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    expect(await result.current.getQueueDetails()).toHaveLength(1);
    await act(async () => { await result.current.clearQueue(); });
    expect(result.current.pendingCount).toBe(0);
    expect(await getAllOperations()).toEqual([]);
  });
});
