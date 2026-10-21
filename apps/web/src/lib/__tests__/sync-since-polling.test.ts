import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * sync-since.ts — the triggers (60 s poll / visibility / online), teardown,
 * the error path, and the cursor edge cases sync-since.test.ts does not hit.
 *
 * Boundaries: `../api-client` (HTTP edge), `../offline-store` (IndexedDB —
 * in-memory versionState + per-store row capture), `../connectivity` (so a
 * test controls isOnline() and fires online transitions). The sync-engine's
 * stage emitter is REAL — the ribbon contract is asserted through
 * onSyncEvent.
 */

const h = vi.hoisted(() => ({
  online: true,
  connListeners: new Set<(o: boolean) => void>(),
  state: null as any,
  cached: {} as Record<string, any[]>,
  get: vi.fn(),
}));

vi.mock('../api-client', () => ({ apiClient: { get: h.get, post: vi.fn(), refreshToken: vi.fn() } }));
vi.mock('../connectivity', () => ({
  isOnline: () => h.online,
  onConnectivityChange: (cb: (o: boolean) => void) => { h.connListeners.add(cb); return () => { h.connListeners.delete(cb); }; },
}));
vi.mock('../offline-store', () => ({
  cacheEntities: vi.fn(async (name: string, rows: any[]) => {
    if (rows.length) h.cached[name] = [...(h.cached[name] ?? []), ...rows];
  }),
  getVersionState: vi.fn(async () => ({ ...h.state })),
  setVersionState: vi.fn(async (v: any) => { h.state = { ...v }; }),
  // sync-engine (imported for emitSyncStage) pulls these names in; unused here.
  getPendingOperationsForUser: vi.fn(), updateOperationStatus: vi.fn(), updateOperationTapeVersion: vi.fn(),
  clearSyncedOperations: vi.fn(), getPendingTombstones: vi.fn(), updateTombstoneStatus: vi.fn(),
  clearSyncedTombstones: vi.fn(), compactSyncedOperations: vi.fn(), evictLruCache: vi.fn(), requeueStuckSyncing: vi.fn(),
}));

import {
  syncSince, triggerSync, startSyncPolling, stopSyncPolling,
  __resetSyncSinceForTest, __isSyncBusyForTest,
} from '../sync-since';
import { onSyncEvent } from '../sync-engine';

const fresh = () => ({
  key: 'current', profileVersion: 3, filterProfileVersion: 0, equipmentGroupVersion: 0,
  checklistVersion: 0, assetTemplateVersion: 0, filterUpdatedSince: null, lastSyncedAt: null,
});
const empty = (over: Record<string, unknown> = {}) => ({
  filterCleaningProfiles: [], filterProfiles: [], equipmentGroups: [], checklistProfiles: [],
  assetTemplates: [], filters: [], serverTimestamp: '2026-10-21T08:00:00.000Z', hasMore: false, ...over,
});

let warn: ReturnType<typeof vi.spyOn>;
let stages: string[];
let offEvents: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  h.online = true;
  h.connListeners.clear();
  h.state = fresh();
  h.cached = {};
  h.get.mockReset().mockResolvedValue(empty());
  __resetSyncSinceForTest();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  stages = [];
  offEvents = onSyncEvent((e) => { if (e.type === 'stage') stages.push(e.stage); });
});

afterEach(() => {
  stopSyncPolling();
  offEvents();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('syncSince — failure path', () => {
  it('a failed request rethrows, leaves the cursor untouched, and still returns the ribbon to idle', async () => {
    h.get.mockRejectedValueOnce(Object.assign(new Error('Server busy'), { status: 503 }));
    await expect(syncSince()).rejects.toThrow('Server busy');
    expect(h.state).toEqual(fresh());
    expect(stages).toEqual(['fetching-snapshot', 'idle']);
    expect(__isSyncBusyForTest()).toBe(false); // in-flight slot released
  });

  it('a later call after a failure makes a new request', async () => {
    h.get.mockRejectedValueOnce(new Error('x'));
    await expect(syncSince()).rejects.toThrow();
    await syncSince();
    expect(h.get).toHaveBeenCalledTimes(2);
  });
});

describe('syncSince — cursor edge cases', () => {
  it('rows with a missing or non-numeric version never move a cursor backwards', async () => {
    h.get.mockResolvedValueOnce(empty({ filterCleaningProfiles: [{ id: 'a' }, { id: 'b', version: 'nine' }, null] }));
    const r = await syncSince();
    expect(r.versionState.profileVersion).toBe(3);
    expect(r.rowsAdded.filterCleaningProfiles).toBe(3);
  });

  it('filter updatedAt values given as Date objects are converted to ISO and compared', async () => {
    h.get.mockResolvedValueOnce(empty({
      filters: [
        { id: 'f1', updatedAt: new Date('2026-10-20T10:00:00.000Z') },
        { id: 'f2', filterDetailsUpdatedAt: new Date('2026-10-21T07:59:00.000Z'), updatedAt: null },
      ],
    }));
    const r = await syncSince();
    expect(r.versionState.filterUpdatedSince).toBe('2026-10-21T07:59:00.000Z');
  });

  it('a response missing entity arrays is treated as empty; hasMore is coerced to boolean', async () => {
    h.get.mockResolvedValueOnce({ serverTimestamp: 't', hasMore: 1 });
    const r = await syncSince();
    expect(r.rowsAdded).toEqual({ filterCleaningProfiles: 0, filterProfiles: 0, equipmentGroups: 0, checklistProfiles: 0, assetTemplates: 0, filters: 0 });
    expect(r.hasMore).toBe(true);
    expect(r.serverTimestamp).toBe('t');
  });
});

describe('triggerSync', () => {
  it('a failed background sync is logged with its trigger reason, never thrown', async () => {
    const err = new Error('boom');
    h.get.mockRejectedValueOnce(err);
    triggerSync('visibility');
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledWith('[syncSince] failed (reason=visibility)', err);
  });

  it('defaults the reason to "unspecified"', async () => {
    h.get.mockRejectedValueOnce('down');
    triggerSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledWith('[syncSince] failed (reason=unspecified)', 'down');
  });
});

describe('startSyncPolling / stopSyncPolling', () => {
  it('polls every 60 s while online (debounced 1 s), and skips the poll while offline', async () => {
    startSyncPolling();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.get).not.toHaveBeenCalled();          // still inside the 1 s debounce
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get.mock.calls[0][0]).toMatch(/^\/api\/sync\/since\?profileVersion=3&/);

    h.online = false;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('foregrounding the app triggers a sync only when visible AND online', async () => {
    startSyncPolling();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    h.online = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get).not.toHaveBeenCalled();

    h.online = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('a network-recovered transition triggers a sync; going offline does not', async () => {
    startSyncPolling();
    for (const l of h.connListeners) l(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get).not.toHaveBeenCalled();
    for (const l of h.connListeners) l(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a second start adds no second poller/listener and returns a working teardown', async () => {
    const stop1 = startSyncPolling();
    const stop2 = startSyncPolling();
    expect(h.connListeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.get).toHaveBeenCalledTimes(1);
    stop2();
    expect(h.connListeners.size).toBe(0);
    stop1(); // stopping twice is harmless
  });

  it('teardown removes every trigger AND cancels a pending debounced sync', async () => {
    const stop = startSyncPolling();
    for (const l of h.connListeners) l(true);      // debounce armed
    expect(__isSyncBusyForTest()).toBe(true);
    stop();
    expect(__isSyncBusyForTest()).toBe(false);
    await vi.advanceTimersByTimeAsync(130_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.get).not.toHaveBeenCalled();
  });
});
