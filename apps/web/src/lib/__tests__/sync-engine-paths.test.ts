import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * sync-engine.ts — the replay paths sync-engine.test.ts does not reach:
 * grant expiry, pre-flight bail-outs, owner-held ops, tombstones, the
 * compound start-and-advance-with-checklist op, terminal error classes,
 * cleanup failures, and the auto-sync scheduler.
 *
 * Boundaries (same as sync-engine.test.ts): `../api-client` (the HTTP
 * edge), `../offline-store` (IndexedDB — replaced by an in-memory registry
 * whose owner partition is the REAL `partitionOpsByOwner`), and
 * `../connectivity` (so a test can fire an "online" transition). Storage is
 * real jsdom session/localStorage.
 *
 * The engine keeps `syncing` and the auto-sync `cleanup` at module level, so
 * every test imports a fresh copy (vi.resetModules in beforeEach).
 */

const h = vi.hoisted(() => {
  const ops: any[] = [];
  const tombstones: any[] = [];
  return {
    ops,
    tombstones,
    connListeners: new Set<(o: boolean) => void>(),
    api: {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      refreshToken: vi.fn(async () => true),
    },
  };
});

vi.mock('../api-client', () => ({ apiClient: h.api }));
vi.mock('../connectivity', () => ({
  onConnectivityChange: (cb: (o: boolean) => void) => { h.connListeners.add(cb); return () => { h.connListeners.delete(cb); }; },
  isOnline: () => true,
}));
vi.mock('../offline-store', async () => {
  const actual = await vi.importActual<typeof import('../offline-store')>('../offline-store');
  const store = {
    partitionOpsByOwner: actual.partitionOpsByOwner,
    getPendingOperationsForUser: vi.fn(async (uid: string | null) =>
      actual.partitionOpsByOwner(h.ops.filter((o) => o.status === 'pending'), uid)),
    updateOperationStatus: vi.fn(async (id: string, status: string, error?: string) => {
      const op = h.ops.find((o) => o.id === id);
      if (!op) return;
      op.status = status;
      if (error) op.error = error;
      if (status === 'failed' || (status === 'pending' && error)) op.retryCount = (op.retryCount ?? 0) + 1;
    }),
    updateOperationTapeVersion: vi.fn(async (id: string, tv: number) => {
      const op = h.ops.find((o) => o.id === id);
      if (op) op.tapeVersion = tv;
    }),
    clearSyncedOperations: vi.fn(async () => {}),
    getPendingTombstones: vi.fn(async () => h.tombstones.filter((t) => t.status === 'pending')),
    updateTombstoneStatus: vi.fn(async (id: string, status: string, error?: string) => {
      const t = h.tombstones.find((x) => x.id === id);
      if (!t) return;
      t.status = status;
      if (error) t.error = error;
      if (status === 'failed' || (status === 'pending' && error)) t.retryCount = (t.retryCount ?? 0) + 1;
    }),
    clearSyncedTombstones: vi.fn(async () => {}),
    compactSyncedOperations: vi.fn(async () => ({ removed: 0 })),
    evictLruCache: vi.fn(async () => ({ evicted: 0, total: 0 })),
    requeueStuckSyncing: vi.fn(async () => 0),
  };
  return store;
});

import * as store from '../offline-store';
const st = store as unknown as Record<string, ReturnType<typeof vi.fn>>;

type Engine = typeof import('../sync-engine');
let engine: Engine;
let events: any[];
let warn: ReturnType<typeof vi.spyOn>;

let seq = 0;
function op(over: Record<string, any> = {}) {
  seq += 1;
  const o = {
    id: `op-${seq}`,
    clientOpId: `cli-${seq}`,
    type: 'advance',
    filterId: 'f-1',
    filterName: 'F-001',
    payload: { targetState: 'WASH_OUT' },
    createdAt: new Date(Date.UTC(2026, 9, 21, 8, 0, seq)).toISOString(),
    status: 'pending',
    retryCount: 0,
    tapeVersion: 7,
    userId: null,
    userName: null,
    ...over,
  };
  h.ops.push(o);
  return o;
}

function grant(expiresInMs = 3_600_000) {
  sessionStorage.setItem('offline_replay_token', 'grant-jwt');
  sessionStorage.setItem('offline_replay_expires', new Date(Date.now() + expiresInMs).toISOString());
}

const posts = () => h.api.post.mock.calls.map((c: any[]) => ({ url: c[0], body: c[1], headers: c[2] }));
const errorsOf = () => events.filter((e) => e.type === 'error').map((e) => e.error);

// First import of the engine + real offline-store under coverage is slow;
// warm the module graph once so per-test re-imports stay fast.
beforeAll(async () => { await import('../sync-engine'); }, 60_000);

beforeEach(async () => {
  seq = 0;
  h.ops.length = 0;
  h.tombstones.length = 0;
  h.connListeners.clear();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem('access_token', 'jwt');
  grant();
  vi.clearAllMocks();
  h.api.refreshToken.mockResolvedValue(true);
  h.api.get.mockImplementation(async (url: string) => {
    if (url === '/api/health') return { status: 'ok' };
    if (url.endsWith('/current-state')) return { currentCycle: { id: 'c-1' }, tapeVersion: 11 };
    return {};
  });
  h.api.post.mockResolvedValue({});
  h.api.delete.mockResolvedValue({});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.resetModules();
  engine = await import('../sync-engine');
  events = [];
  engine.onSyncEvent((e) => events.push(e));
});

afterEach(() => {
  engine.stopAutoSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('offline-replay grant header', () => {
  it('sends the session grant as x-offline-replay-token plus the op clientOpId', async () => {
    op();
    await engine.syncPendingOperations();
    expect(posts()[0].headers).toEqual({ 'x-offline-replay-token': 'grant-jwt', 'x-client-op-id': 'cli-1' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the localStorage backup copy after a tab reload', async () => {
    sessionStorage.removeItem('offline_replay_token');
    sessionStorage.removeItem('offline_replay_expires');
    localStorage.setItem('offline_replay_token_backup', 'backup-jwt');
    localStorage.setItem('offline_replay_expires_backup', new Date(Date.now() + 3_600_000).toISOString());
    op();
    await engine.syncPendingOperations();
    expect(posts()[0].headers['x-offline-replay-token']).toBe('backup-jwt');
  });

  it('an unparseable expiry does not discard the grant', async () => {
    sessionStorage.setItem('offline_replay_expires', 'not-a-date');
    op();
    await engine.syncPendingOperations();
    expect(posts()[0].headers['x-offline-replay-token']).toBe('grant-jwt');
  });

  it('a grant inside the 60 s expiry buffer is cleared from both storages and the drain asks for re-auth instead of sending', async () => {
    grant(30_000);
    localStorage.setItem('offline_replay_token_backup', 'grant-jwt');
    localStorage.setItem('offline_replay_expires_backup', 'x');
    op();
    op();
    const r = await engine.syncPendingOperations();
    expect(r).toEqual({ synced: 0, failed: 0 });
    expect(h.api.post).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('offline_replay_token')).toBeNull();
    expect(sessionStorage.getItem('offline_replay_expires')).toBeNull();
    expect(localStorage.getItem('offline_replay_token_backup')).toBeNull();
    expect(localStorage.getItem('offline_replay_expires_backup')).toBeNull();
    expect(events).toContainEqual({ type: 'needs-reauth', pendingCount: 2, reason: 'missing' });
    expect(errorsOf()).toContain('2 queued op(s) waiting on re-authentication. Tap to enter password.');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline-replay grant expired at'), expect.any(String), expect.any(String));
    expect(h.ops.every((o) => o.status === 'pending' && o.retryCount === 0)).toBe(true);
  });

  it('no grant at all: ops stay pending with their retry budget, ribbon told needs-reauth', async () => {
    sessionStorage.removeItem('offline_replay_token');
    op();
    await engine.syncPendingOperations();
    expect(h.api.post).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'needs-reauth')).toEqual({ type: 'needs-reauth', pendingCount: 1, reason: 'missing' });
    expect(events).toContainEqual({ type: 'stage', stage: 'idle' });
  });
});

describe('pre-flight bail-outs (queue untouched)', () => {
  it('nothing queued → no network at all', async () => {
    expect(await engine.syncPendingOperations()).toEqual({ synced: 0, failed: 0 });
    expect(h.api.get).not.toHaveBeenCalled();
  });

  it('reading the queue fails → returns zero counts without throwing', async () => {
    st.getPendingOperationsForUser.mockRejectedValueOnce(new Error('IDB locked'));
    expect(await engine.syncPendingOperations()).toEqual({ synced: 0, failed: 0 });
  });

  it('server unreachable (health throws) → nothing replayed', async () => {
    op();
    h.api.get.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await engine.syncPendingOperations()).toEqual({ synced: 0, failed: 0 });
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.ops[0].status).toBe('pending');
  });

  it('no access token → "Token refresh failed: No token in storage" and nothing sent', async () => {
    sessionStorage.removeItem('access_token');
    op();
    await engine.syncPendingOperations();
    expect(h.api.refreshToken).not.toHaveBeenCalled();
    expect(errorsOf()).toContain('Token refresh failed: No token in storage. Re-login required to sync.');
    expect(h.api.post).not.toHaveBeenCalled();
  });

  it('refresh refused → "Token refresh failed" and nothing sent', async () => {
    h.api.refreshToken.mockResolvedValueOnce(false);
    op();
    await engine.syncPendingOperations();
    expect(errorsOf()).toContain('Token refresh failed: Token refresh failed. Re-login required to sync.');
    expect(events.filter((e) => e.type === 'stage').map((e) => e.stage)).toEqual(['token-refresh', 'idle']);
  });
});

describe('owner partition (21 CFR §11 attribution)', () => {
  it("another operator's ops are held and named; mine and owner-less ops replay", async () => {
    localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-me', fullName: 'Me' }));
    op({ userId: 'u-other', userName: 'Asha' });
    op({ userId: 'u-other2', userName: 'Asha' });
    op({ userId: 'u-me', userName: 'Me', filterId: 'f-2' });
    op({ userId: null, filterId: 'f-3' });
    const r = await engine.syncPendingOperations();
    expect(r).toEqual({ synced: 2, failed: 0 });
    expect(posts().map((p) => p.url)).toEqual(['/api/filters/f-2/advance', '/api/filters/f-3/advance']);
    expect(errorsOf()[0]).toBe('2 queued operation(s) were recorded by Asha and can only be submitted by them. Ask them to sign in on this tablet.');
    expect(h.ops.filter((o) => o.userId?.startsWith('u-other')).every((o) => o.status === 'pending' && o.retryCount === 0)).toBe(true);
  });

  it('held ops with no recorded name say "another user"', async () => {
    localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-me' }));
    op({ userId: 'u-other', userName: null });
    await engine.syncPendingOperations();
    expect(errorsOf()[0]).toContain('were recorded by another user');
    expect(h.api.post).not.toHaveBeenCalled();
  });
});

describe('op shapes on replay', () => {
  it('terminate replays to /terminate-cycle with tapeVersion and offlinePerformedAt', async () => {
    const o = op({ type: 'terminate', payload: { justification: 'Damaged filter media' } });
    await engine.syncPendingOperations();
    expect(posts()[0]).toMatchObject({
      url: '/api/filters/f-1/terminate-cycle',
      body: { justification: 'Damaged filter media', tapeVersion: 7, offlinePerformedAt: o.createdAt, clientOpId: 'cli-1' },
    });
  });

  it('start-cycle is not cycle-bound: no current-state check and no tapeVersion in the body', async () => {
    op({ type: 'start-cycle', payload: { reason: 'PM' }, tapeVersion: 3 });
    await engine.syncPendingOperations();
    expect(h.api.get.mock.calls.map((c: any[]) => c[0])).not.toContain('/api/filters/f-1/current-state');
    expect(posts()[0].body).not.toHaveProperty('tapeVersion');
  });

  it('an op without a clientOpId sends no x-client-op-id header', async () => {
    op({ clientOpId: undefined });
    await engine.syncPendingOperations();
    expect(posts()[0].headers).toEqual({ 'x-offline-replay-token': 'grant-jwt' });
  });

  it('start-and-advance-with-checklist: start, then a FRESH tape on the atomic advance-with-checklist', async () => {
    const o = op({
      type: 'start-and-advance-with-checklist',
      tapeVersion: null,
      payload: { cyclePayload: { reason: 'PM' }, advancePayload: { targetState: 'WASH_IN', checklist: { answers: [1] } } },
    });
    await engine.syncPendingOperations();
    expect(posts()).toEqual([
      {
        url: '/api/filters/f-1/start-cycle',
        body: { reason: 'PM', offlinePerformedAt: o.createdAt, clientOpId: 'cli-1:start' },
        headers: { 'x-offline-replay-token': 'grant-jwt', 'x-client-op-id': 'cli-1:start' },
      },
      {
        url: '/api/filters/f-1/advance-with-checklist',
        body: { targetState: 'WASH_IN', checklist: { answers: [1] }, tapeVersion: 11, offlinePerformedAt: o.createdAt, clientOpId: 'cli-1:advance' },
        headers: { 'x-offline-replay-token': 'grant-jwt', 'x-client-op-id': 'cli-1:advance' },
      },
    ]);
    expect(h.ops[0].status).toBe('synced');
  });

  it('start-and-advance-with-checklist: CYCLE_ACTIVE on the start half is benign; no fresh tape → advance omits tapeVersion', async () => {
    op({ type: 'start-and-advance-with-checklist', clientOpId: undefined, payload: { cyclePayload: {}, advancePayload: { targetState: 'WASH_IN' } } });
    h.api.post.mockImplementationOnce(async () => { throw Object.assign(new Error('active'), { error: 'CYCLE_ACTIVE' }); });
    h.api.get.mockImplementation(async (url: string) => {
      if (url === '/api/health') return {};
      throw new Error('current-state down');
    });
    await engine.syncPendingOperations();
    const adv = posts()[1];
    expect(adv.url).toBe('/api/filters/f-1/advance-with-checklist');
    expect(adv.body).not.toHaveProperty('tapeVersion');
    expect(adv.body.clientOpId).toBeUndefined();
    expect(adv.headers).toEqual({ 'x-offline-replay-token': 'grant-jwt' });
    expect(h.ops[0].status).toBe('synced');
  });

  it('start-and-advance-with-checklist: a refused START marks the filter so its queued checklist step is skipped', async () => {
    op({ type: 'start-and-advance-with-checklist', payload: { cyclePayload: {}, advancePayload: {} } });
    op({ type: 'submit-checklist' });
    op({ type: 'bypass' });
    h.api.post.mockImplementationOnce(async () => { throw Object.assign(new Error('Block change required'), { code: 'BLOCK_CHANGE_REQUIRED', status: 409 }); });
    const r = await engine.syncPendingOperations();
    expect(posts()).toHaveLength(1);
    expect(r.failed).toBe(3);
    expect(h.ops[1].error).toMatch(/^Skipped — the cleaning cycle was never started/);
    expect(h.ops[2].error).toMatch(/^Skipped/);
  });

  it('start-and-advance without a fresh tape posts the advance with no tapeVersion and no client op id', async () => {
    op({ type: 'start-and-advance', clientOpId: undefined, payload: { cyclePayload: {}, advancePayload: { targetState: 'WASH_IN' } } });
    h.api.get.mockImplementation(async (url: string) => (url === '/api/health' ? {} : { currentCycle: { id: 'c' } }));
    await engine.syncPendingOperations();
    expect(posts()[0].headers).toEqual({ 'x-offline-replay-token': 'grant-jwt' });
    expect(posts()[1]).toMatchObject({ url: '/api/filters/f-1/advance', headers: { 'x-offline-replay-token': 'grant-jwt' } });
    expect(posts()[1].body).not.toHaveProperty('tapeVersion');
  });
});

describe('terminal and pausing error classes', () => {
  it('cycle ended on the server (current-state has no cycle) → failed once, neutral "no data lost" toast, drain continues', async () => {
    op();
    op({ filterId: 'f-2', filterName: 'F-002' });
    h.api.get.mockImplementation(async (url: string) => {
      if (url === '/api/health') return {};
      if (url === '/api/filters/f-1/current-state') return { currentCycle: null };
      return { currentCycle: { id: 'c' } };
    });
    const r = await engine.syncPendingOperations();
    expect(r).toEqual({ synced: 1, failed: 1 });
    expect(h.ops[0]).toMatchObject({ status: 'failed', retryCount: 1 });
    expect(h.ops[0].error).toContain('already ended on the server');
    expect(errorsOf()).toContain("F-001: cycle already ended — queued action skipped (no data lost; verify the filter's status)");
    expect(posts().map((p) => p.url)).toEqual(['/api/filters/f-2/advance']);
  });

  it('current-state lookup failing does not block the replay (the POST surfaces the real error)', async () => {
    op();
    h.api.get.mockImplementation(async (url: string) => {
      if (url === '/api/health') return {};
      throw Object.assign(new Error('Filter not found'), { status: 404 });
    });
    await engine.syncPendingOperations();
    expect(posts()).toHaveLength(1);
    expect(h.ops[0].status).toBe('synced');
  });

  it('NO_CYCLE from the server is terminal too (no 5-retry loop)', async () => {
    op();
    h.api.post.mockRejectedValueOnce(Object.assign(new Error('No active cleaning cycle'), { code: 'NO_CYCLE', status: 400 }));
    await engine.syncPendingOperations();
    expect(h.ops[0].status).toBe('failed');
  });

  it.each([
    ['error code REAUTH_REQUIRED', { error: 'REAUTH_REQUIRED', message: 'Grant rejected' }],
    ['error code REAUTH_FAILED', { error: 'REAUTH_FAILED', message: 'bad grant' }],
    ['a "re-authentication" message', { message: 'Re-authentication required for this action' }],
  ])('%s pauses the drain: op back to pending, later ops untouched, needs-reauth(rejected)', async (_l, err) => {
    op();
    op({ filterId: 'f-2' });
    h.api.post.mockRejectedValueOnce(Object.assign(new Error(err.message), err));
    const r = await engine.syncPendingOperations();
    expect(r).toEqual({ synced: 0, failed: 1 });
    expect(h.api.post).toHaveBeenCalledTimes(1);
    expect(h.ops[0].status).toBe('pending');
    expect(h.ops[1]).toMatchObject({ status: 'pending', retryCount: 0 });
    expect(events).toContainEqual({ type: 'needs-reauth', pendingCount: 2, reason: 'rejected' });
    expect(errorsOf()).toContain(`Sync paused: ${err.message}. Re-enter password to resume.`);
  });

  it('a generic API error on the 5th attempt is marked failed (retry budget exhausted)', async () => {
    op({ retryCount: 4 });
    h.api.post.mockRejectedValueOnce(Object.assign(new Error('Validation failed'), { status: 400 }));
    await engine.syncPendingOperations();
    expect(h.ops[0]).toMatchObject({ status: 'failed', error: 'Validation failed', retryCount: 5 });
    expect(errorsOf()).toContain('F-001: Validation failed');
  });

  it('an error object with only `.error` (no message) still produces a readable failure', async () => {
    op();
    h.api.post.mockRejectedValueOnce({ error: 'SOMETHING_ODD' });
    await engine.syncPendingOperations();
    expect(h.ops[0]).toMatchObject({ status: 'pending', error: 'SOMETHING_ODD' });
  });

  it('an empty rejection falls back to "Sync failed"', async () => {
    op();
    h.api.post.mockRejectedValueOnce({});
    await engine.syncPendingOperations();
    expect(h.ops[0].error).toBe('Sync failed');
  });

  it.each([['ECONNREFUSED'], ['Load failed'], ['The operation was aborted'], ['Network request failed']])(
    'transport error "%s" pauses without burning budget',
    async (message) => {
      op();
      op({ filterId: 'f-2' });
      h.api.post.mockRejectedValueOnce(new Error(message));
      await engine.syncPendingOperations();
      expect(h.api.post).toHaveBeenCalledTimes(1);
      expect(events).toContainEqual({ type: 'interrupted', error: 'Sync interrupted — will retry in 30s' });
      expect(h.ops[1].status).toBe('pending');
    },
  );

  // Same defect class as OFF-5 (2026-10-22): the transport words are matched only
  // when the server never answered. A 4xx that merely mentions one (a filter
  // named NETWORK-F1) used to stop the drain with the op still pending, so every
  // drain stopped at the same op and nothing queued behind it ever went out.
  it('a 4xx whose message mentions "network" is an API refusal: retry counted, the drain goes on', async () => {
    op({ filterId: 'f-net', filterName: 'NETWORK-F1' });
    op({ filterId: 'f-2', filterName: 'F-002' });
    h.api.post.mockRejectedValueOnce(Object.assign(new Error('Filter NETWORK-F1 is retired'), { status: 409, code: 'FILTER_RETIRED' }));
    expect(await engine.syncPendingOperations()).toEqual({ synced: 1, failed: 1 });
    expect(h.ops[0]).toMatchObject({ status: 'pending', retryCount: 1, error: 'Filter NETWORK-F1 is retired' });
    expect(h.ops[1].status).toBe('synced');
    expect(events.some((e) => e.type === 'interrupted')).toBe(false);
  });

  it('a 429 is a server-side condition: op stays pending and the drain pauses', async () => {
    op();
    h.api.post.mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { status: 429 }));
    await engine.syncPendingOperations();
    expect(h.ops[0].status).toBe('pending');
    expect(events).toContainEqual({ type: 'interrupted', error: 'Sync interrupted — will retry in 30s' });
  });
});

describe('in-flight guard', () => {
  it('a drain started while another is mid-replay returns zero counts without touching the queue', async () => {
    op();
    let release!: () => void;
    h.api.post.mockImplementationOnce(() => new Promise((r) => { release = () => r({}); }));
    const first = engine.syncPendingOperations();
    await vi.waitFor(() => expect(h.api.post).toHaveBeenCalledTimes(1)); // first drain is now inside the loop
    expect(await engine.syncPendingOperations()).toEqual({ synced: 0, failed: 0 });
    release();
    expect(await first).toEqual({ synced: 1, failed: 0 });
    expect(h.api.post).toHaveBeenCalledTimes(1);
  });

  // OFF-2 (2026-10-22): the guard used to be taken only after the health
  // check, the token refresh and the tombstone phase, so two drains started
  // together (the online event + the retry tick) both passed it and both
  // replayed the same queued ops.
  it('two drains started together replay each op once', async () => {
    op();
    const results = await Promise.all([engine.syncPendingOperations(), engine.syncPendingOperations()]);
    expect(h.api.post).toHaveBeenCalledTimes(1);
    expect(results).toContainEqual({ synced: 1, failed: 0 });
    expect(results).toContainEqual({ synced: 0, failed: 0 });
  });

  // OFF-3 (2026-10-22): an exception escaping the drain left `syncing` true
  // for the life of the app, so no queued op was ever sent again.
  it('a drain that throws releases the guard; the next drain replays the op', async () => {
    op();
    st.updateOperationStatus
      .mockRejectedValueOnce(new Error('IDB write failed'))   // marking the op 'syncing'
      .mockRejectedValueOnce(new Error('IDB write failed'));  // recording the failure
    await expect(engine.syncPendingOperations()).rejects.toThrow('IDB write failed');
    expect(events.filter((e) => e.type === 'stage').at(-1)).toEqual({ type: 'stage', stage: 'idle' });
    expect(await engine.syncPendingOperations()).toEqual({ synced: 1, failed: 0 });
    expect(h.ops[0].status).toBe('synced');
  });

  it('start-and-advance: a failing current-state lookup after the start still sends the advance (without a tape)', async () => {
    op({ type: 'start-and-advance', payload: { cyclePayload: {}, advancePayload: { targetState: 'WASH_IN' } } });
    h.api.get.mockImplementation(async (url: string) => {
      if (url === '/api/health') return {};
      throw new Error('current-state down');
    });
    await engine.syncPendingOperations();
    expect(posts().map((p) => p.url)).toEqual(['/api/filters/f-1/start-cycle', '/api/filters/f-1/advance']);
    expect(posts()[1].body).not.toHaveProperty('tapeVersion');
  });

  it('non-Error rejections from the store are logged as strings', async () => {
    vi.useFakeTimers();
    st.requeueStuckSyncing.mockRejectedValueOnce('idb-gone');
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(warn).toHaveBeenCalledWith('[sync-engine] requeueStuckSyncing failed —', 'idb-gone');
    st.getPendingOperationsForUser.mockRejectedValueOnce('tick-gone');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(warn).toHaveBeenCalledWith('[sync-engine] retry tick: getPendingOperations failed —', 'tick-gone');
  });

  it('tombstone cleanup rejecting with an Error logs its message', async () => {
    h.tombstones.push({ id: 'ts-1', clientOpId: 't', entityType: 'block-change-request', entityId: 'b', createdAt: 'x', status: 'pending', retryCount: 0 });
    op();
    st.clearSyncedTombstones.mockRejectedValueOnce(new Error('locked db'));
    await engine.syncPendingOperations();
    expect(warn).toHaveBeenCalledWith('[sync-engine] clearSyncedTombstones failed —', 'locked db');
  });
});

describe('chained tape refresh', () => {
  it('a failing IDB tape write is logged but the in-memory tape still goes out on the next op', async () => {
    op();
    op();
    st.updateOperationTapeVersion.mockRejectedValueOnce(new Error('QuotaExceeded'));
    await engine.syncPendingOperations();
    expect(posts()[1].body.tapeVersion).toBe(11);
    expect(warn).toHaveBeenCalledWith(
      '[sync-engine] updateOperationTapeVersion failed for', 'op-2',
      '— in-memory tape rewrite still applies for this drain', 'QuotaExceeded',
    );
  });

  it('a non-numeric tape from current-state leaves the stored tape alone', async () => {
    op();
    op();
    h.api.get.mockImplementation(async (url: string) => (url === '/api/health' ? {} : { currentCycle: { id: 'c' }, tapeVersion: 'x' }));
    await engine.syncPendingOperations();
    expect(posts()[1].body.tapeVersion).toBe(7);
    expect(st.updateOperationTapeVersion).not.toHaveBeenCalled();
  });

  it('the refresh fetch failing after a success is non-fatal (stored tape used)', async () => {
    op();
    op();
    let n = 0;
    h.api.get.mockImplementation(async (url: string) => {
      if (url === '/api/health') return {};
      n += 1;
      if (n === 2) throw new Error('flaky'); // the post-success refresh
      return { currentCycle: { id: 'c' } };
    });
    const r = await engine.syncPendingOperations();
    expect(r.synced).toBe(2);
    expect(posts()[1].body.tapeVersion).toBe(7);
  });
});

describe('tombstones', () => {
  function tomb(over: Record<string, any> = {}) {
    const t = { id: `ts-${h.tombstones.length + 1}`, clientOpId: `tcli-${h.tombstones.length + 1}`, entityType: 'cycle', entityId: 'c-9', payload: { filterId: 'f-9' }, createdAt: '2026-10-21T07:00:00.000Z', status: 'pending', retryCount: 0, ...over };
    h.tombstones.push(t);
    return t;
  }

  it('drain tombstones BEFORE ops; legacy `reason` and the default justification are used when needed', async () => {
    tomb({ payload: { filterId: 'f-9', reason: 'Legacy reason text' } });
    tomb({ payload: { filterId: 'f-8' }, tapeVersion: 4 });
    op();
    await engine.syncPendingOperations();
    expect(posts().map((p) => p.url)).toEqual(['/api/filters/f-9/terminate-cycle', '/api/filters/f-8/terminate-cycle', '/api/filters/f-1/advance']);
    expect(posts()[0].body).toEqual({ justification: 'Legacy reason text', clientOpId: 'tcli-1', offlinePerformedAt: '2026-10-21T07:00:00.000Z' });
    expect(posts()[1].body).toEqual({ justification: 'Offline terminate', tapeVersion: 4, clientOpId: 'tcli-2', offlinePerformedAt: '2026-10-21T07:00:00.000Z' });
    expect(posts()[0].headers).toEqual({ 'x-offline-replay-token': 'grant-jwt', 'x-client-op-id': 'tcli-1' });
    expect(h.tombstones.map((t) => t.status)).toEqual(['synced', 'synced']);
    expect(st.clearSyncedTombstones).toHaveBeenCalled();
  });

  it('a block-change-request tombstone replays as DELETE /api/block-change-requests/:id', async () => {
    tomb({ entityType: 'block-change-request', entityId: 'bcr-1', payload: undefined });
    op();
    await engine.syncPendingOperations();
    expect(h.api.delete).toHaveBeenCalledWith('/api/block-change-requests/bcr-1');
    expect(h.tombstones[0].status).toBe('synced');
  });

  it('a failing tombstone retries, then is marked failed on the 5th attempt', async () => {
    tomb({ retryCount: 0 });
    tomb({ retryCount: 4 });
    op();
    h.api.post.mockImplementation(async (url: string) => {
      if (url.endsWith('terminate-cycle')) throw { error: 'TERMINATE_REFUSED' };
      return {};
    });
    await engine.syncPendingOperations();
    expect(h.tombstones[0]).toMatchObject({ status: 'pending', error: 'TERMINATE_REFUSED', retryCount: 1 });
    expect(h.tombstones[1]).toMatchObject({ status: 'failed', retryCount: 5 });
  });

  it('a tombstone error with nothing readable falls back to "Tombstone sync failed"', async () => {
    tomb();
    op();
    h.api.post.mockImplementationOnce(async () => { throw {}; });
    await engine.syncPendingOperations();
    expect(h.tombstones[0].error).toBe('Tombstone sync failed');
  });

  it('reading tombstones failing skips the tombstone phase but the ops still drain', async () => {
    st.getPendingTombstones.mockRejectedValueOnce(new Error('no store'));
    op();
    await engine.syncPendingOperations();
    expect(h.ops[0].status).toBe('synced');
    expect(st.clearSyncedTombstones).not.toHaveBeenCalled();
  });

  it('clearSyncedTombstones failing is logged, not thrown', async () => {
    tomb();
    op();
    st.clearSyncedTombstones.mockRejectedValueOnce('locked');
    await engine.syncPendingOperations();
    expect(warn).toHaveBeenCalledWith('[sync-engine] clearSyncedTombstones failed —', 'locked');
  });
});

describe('post-drain housekeeping failures are surfaced, never thrown', () => {
  it('clear / compact / evict failures each warn and the drain still completes', async () => {
    op();
    st.clearSyncedOperations.mockRejectedValueOnce(new Error('A'));
    st.compactSyncedOperations.mockRejectedValueOnce(new Error('B'));
    st.evictLruCache.mockRejectedValueOnce('C');
    const r = await engine.syncPendingOperations();
    expect(r).toEqual({ synced: 1, failed: 0 });
    expect(warn).toHaveBeenCalledWith('[sync-engine] clearSyncedOperations failed —', 'A');
    expect(warn).toHaveBeenCalledWith('[sync-engine] compactSyncedOperations failed —', 'B');
    expect(warn).toHaveBeenCalledWith('[sync-engine] evictLruCache failed —', 'C');
    expect(events[events.length - 1]).toEqual({ type: 'complete', synced: 1, total: 1 });
  });
});

describe('stage events', () => {
  it('emits token-refresh → tombstone-drain → sending-ops (with filter name) → idle, then complete', async () => {
    op({ filterName: 'AHU-1 F-3' });
    await engine.syncPendingOperations();
    const stages = events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', stage: 'token-refresh' },
      { type: 'stage', stage: 'tombstone-drain' },
      { type: 'stage', stage: 'sending-ops', current: 0, total: 1 },
      { type: 'stage', stage: 'sending-ops', current: 1, total: 1, message: 'AHU-1 F-3' },
      { type: 'stage', stage: 'idle' },
    ]);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['start', 'progress', 'complete']));
  });

  it('emitSyncStage forwards to subscribers; unsubscribe stops delivery', () => {
    const seen: any[] = [];
    const off = engine.onSyncEvent((e) => seen.push(e));
    engine.emitSyncStage('fetching-snapshot', { message: 'profiles' });
    off();
    engine.emitSyncStage('idle');
    expect(seen).toEqual([{ type: 'stage', stage: 'fetching-snapshot', message: 'profiles' }]);
  });
});

describe('startAutoSync / stopAutoSync', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('requeues orphaned "syncing" rows FIRST, then drains after the initial delay', async () => {
    st.requeueStuckSyncing.mockResolvedValueOnce(2);
    op();
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("[sync-engine] requeued 2 operation(s) stuck in 'syncing' from a prior interrupted session");
    expect(h.api.post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(st.requeueStuckSyncing.mock.invocationCallOrder[0]).toBeLessThan(st.getPendingOperationsForUser.mock.invocationCallOrder[0]);
    expect(h.ops[0].status).toBe('synced');
  });

  it('a failing requeue is logged and the initial drain is still scheduled', async () => {
    st.requeueStuckSyncing.mockRejectedValueOnce(new Error('IDB gone'));
    op();
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(warn).toHaveBeenCalledWith('[sync-engine] requeueStuckSyncing failed —', 'IDB gone');
    expect(h.ops[0].status).toBe('synced');
  });

  it('an "online" transition schedules a drain 2 s later; "offline" does not', async () => {
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000); // initial drain (empty queue)
    op();
    for (const l of h.connListeners) l(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.ops[0].status).toBe('pending');
    for (const l of h.connListeners) l(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.ops[0].status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.ops[0].status).toBe('synced');
  });

  it('becoming visible schedules a drain 1 s later; hidden does not', async () => {
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000);
    op();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.ops[0].status).toBe('pending');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.ops[0].status).toBe('synced');
  });

  it('the 30 s retry tick drains only when this user has syncable work, and logs a failing queue read', async () => {
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000);
    localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-me' }));
    op({ userId: 'u-other', userName: 'B' });           // held — must not trigger a drain
    const healthCallsBefore = h.api.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.api.get.mock.calls.length).toBe(healthCallsBefore);

    op({ userId: 'u-me' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.ops[1].status).toBe('synced');

    st.getPendingOperationsForUser.mockRejectedValueOnce(new Error('tick read failed'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(warn).toHaveBeenCalledWith('[sync-engine] retry tick: getPendingOperations failed —', 'tick read failed');
  });

  it('is idempotent and stopAutoSync cancels every timer and listener', async () => {
    engine.startAutoSync();
    engine.startAutoSync();
    expect(h.connListeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(0); // requeue settled → initial drain timer armed
    engine.stopAutoSync();
    expect(h.connListeners.size).toBe(0);
    op();
    await vi.advanceTimersByTimeAsync(120_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.ops[0].status).toBe('pending');
    expect(h.api.post).not.toHaveBeenCalled();
    engine.stopAutoSync(); // second stop is a no-op
  });

  // OFF-1 (2026-10-22): the initial drain is armed only once the orphan
  // requeue settles, which could be AFTER stopAutoSync had cleared the timers.
  it('stopAutoSync before the orphan requeue settles cancels the initial drain', async () => {
    let settle!: (n: number) => void;
    st.requeueStuckSyncing.mockImplementationOnce(() => new Promise<number>((r) => { settle = r; }));
    op();
    engine.startAutoSync();
    engine.stopAutoSync();
    settle(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.api.post).not.toHaveBeenCalled();
    expect(h.ops[0].status).toBe('pending');
  });

  it('a retry tick still reading the queue when stopAutoSync runs does not drain', async () => {
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000); // initial drain (empty queue)
    const queued = op();
    let release!: () => void;
    st.getPendingOperationsForUser.mockImplementationOnce(() =>
      new Promise((r) => { release = () => r({ syncable: [queued], held: [] }); }));
    await vi.advanceTimersByTimeAsync(30_000); // the tick is now awaiting the queue read
    engine.stopAutoSync();
    release();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.api.post).not.toHaveBeenCalled();
    expect(queued.status).toBe('pending');
  });

  it('a drain started by a timer that throws is logged, not left as an unhandled rejection', async () => {
    op();
    st.updateOperationStatus
      .mockRejectedValueOnce(new Error('IDB write failed'))
      .mockRejectedValueOnce(new Error('IDB write failed'));
    engine.startAutoSync();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(warn).toHaveBeenCalledWith('[sync-engine] drain failed —', 'IDB write failed');
  });
});

