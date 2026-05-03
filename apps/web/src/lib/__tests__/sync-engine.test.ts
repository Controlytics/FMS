import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Phase 8.3 — sync engine STALE_TAPE handling + backward-compat replay.
 *
 * The engine must:
 *   - On 409 STALE_TAPE: drop the queued op as `failed` (NOT pending) and
 *     surface a refresh-prompt toast. Retrying with the same stored
 *     tapeVersion would just keep failing.
 *   - On other API errors: retry up to MAX_RETRIES, then mark failed.
 *   - On a queued op that has `tapeVersion: null` (pre-8.3): replay without
 *     including a tapeVersion in the body (server-side schema accepts the
 *     missing field as no-check during 8.3 backward-compat window).
 *
 * Test pattern: mock the engine's collaborators (apiClient + offline-store +
 * connectivity), drive `syncPendingOperations()` directly.
 */

const { mockApiClient, mockOfflineStore, mockConnectivity } = vi.hoisted(() => {
  // Track which ops the store currently considers "pending".
  const opsRegistry: any[] = [];
  return {
    mockApiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    mockOfflineStore: {
      __ops: opsRegistry,
      getPendingOperations: vi.fn(async () => opsRegistry.filter(o => o.status === 'pending')),
      updateOperationStatus: vi.fn(async (id: string, status: string, error?: string) => {
        const op = opsRegistry.find(o => o.id === id);
        if (op) {
          op.status = status;
          op.error = error;
          if (status === 'failed' || (status === 'pending' && error)) op.retryCount = (op.retryCount ?? 0) + 1;
        }
      }),
      clearSyncedOperations: vi.fn(async () => {}),
      getPendingTombstones: vi.fn(async (): Promise<any[]> => []),
      updateTombstoneStatus: vi.fn(async () => {}),
      clearSyncedTombstones: vi.fn(async () => {}),
      compactSyncedOperations: vi.fn(async () => ({ removed: 0 })),
      evictLruCache: vi.fn(async () => ({ evicted: 0, total: 0 })),
    },
    mockConnectivity: {
      onConnectivityChange: vi.fn(() => () => {}),
      isOnline: vi.fn(() => true),
      startConnectivityEngine: vi.fn(),
    },
  };
});

vi.mock('../api-client', () => ({ apiClient: mockApiClient }));
vi.mock('../offline-store', () => mockOfflineStore);
vi.mock('../connectivity', () => mockConnectivity);

// JWT refresh path inside sync-engine reads sessionStorage. Stub it so the
// refresh succeeds and the queue drain proceeds.
beforeEach(() => {
  vi.clearAllMocks();
  mockOfflineStore.__ops.length = 0;
  // Token in storage so refreshTokenBeforeSync() proceeds.
  (globalThis as any).sessionStorage = {
    getItem: vi.fn(() => 'fake-token'),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  (globalThis as any).localStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  // Default: refresh-token + health-probe succeed. Individual tests override
  // /current-state and the cycle-bound POST.
  mockApiClient.post.mockImplementation(async (url: string) => {
    if (url === '/api/auth/refresh') return { token: 'fresh' };
    return {};
  });
  mockApiClient.get.mockImplementation(async (url: string) => {
    if (url === '/api/health') return {};
    if (url.endsWith('/current-state')) return { currentCycle: { id: 'cyc-1' } };
    return {};
  });
});

afterEach(() => {
  vi.resetModules();
});

import { syncPendingOperations } from '../sync-engine';

function queueOp(overrides: Partial<{
  type: string;
  filterId: string;
  filterName: string;
  payload: Record<string, any>;
  tapeVersion: number | null | undefined;
  retryCount: number;
}> = {}) {
  const op = {
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientOpId: `cli-${Math.random().toString(36).slice(2, 8)}`,
    type: overrides.type ?? 'advance',
    filterId: overrides.filterId ?? 'filter-1',
    filterName: overrides.filterName ?? 'F-001',
    payload: overrides.payload ?? { targetState: 'WASH_OUT' },
    createdAt: new Date('2026-05-02T10:00:00Z').toISOString(),
    status: 'pending',
    retryCount: overrides.retryCount ?? 0,
    tapeVersion: overrides.tapeVersion === undefined ? 1005 : overrides.tapeVersion,
  };
  mockOfflineStore.__ops.push(op);
  return op;
}

describe('sync-engine — Phase 8.3 tape-version handling', () => {
  it('1. queued op carries its stored tapeVersion through the replay body', async () => {
    queueOp({ type: 'advance', tapeVersion: 1005 });
    // Force a successful POST.
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      return { ok: true };
    });

    const result = await syncPendingOperations();

    expect(result.synced).toBe(1);
    // The advance POST should have been called with tapeVersion in the body.
    const advanceCall = mockApiClient.post.mock.calls.find(
      ([url]: any[]) => typeof url === 'string' && url.includes('/advance'),
    );
    expect(advanceCall).toBeTruthy();
    const body = advanceCall![1] as Record<string, any>;
    expect(body.tapeVersion).toBe(1005);
    expect(body.targetState).toBe('WASH_OUT');
  });

  it('2. pre-8.3 queued op (tapeVersion=null) replays WITHOUT a tapeVersion field — server treats as no-check', async () => {
    queueOp({ type: 'advance', tapeVersion: null });
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      return { ok: true };
    });

    const result = await syncPendingOperations();

    expect(result.synced).toBe(1);
    const advanceCall = mockApiClient.post.mock.calls.find(
      ([url]: any[]) => typeof url === 'string' && url.includes('/advance'),
    );
    const body = advanceCall![1] as Record<string, any>;
    // Critical: tapeVersion must NOT be on the body so the server skips the
    // staleness check rather than rejecting null.
    expect('tapeVersion' in body).toBe(false);
  });

  it('3. on 409 STALE_TAPE the op is marked failed (NOT pending) — no retry loop', async () => {
    const op = queueOp({ type: 'advance', tapeVersion: 1003 });
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      const err: any = new Error('Tape version mismatch');
      err.code = 'STALE_TAPE';
      err.status = 409;
      err.currentTapeVersion = 1005;
      throw err;
    });

    const result = await syncPendingOperations();

    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
    // The store-update for this op must be `failed`, not `pending`.
    const finalUpdate = mockOfflineStore.updateOperationStatus.mock.calls
      .filter(([id]: any[]) => id === op.id)
      .pop();
    expect(finalUpdate![1]).toBe('failed');
    // Op state in the registry confirms it.
    expect(op.status).toBe('failed');
    // retryCount must NOT have been incremented above 1 (single attempt).
    expect(op.retryCount).toBeLessThanOrEqual(1);
  });

  it('4. on a generic 500 error the op stays pending (regular retry path)', async () => {
    const op = queueOp({ type: 'advance', tapeVersion: 1005, retryCount: 0 });
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      const err: any = new Error('Internal server error');
      err.code = 'INTERNAL';
      err.status = 500;
      throw err;
    });

    const result = await syncPendingOperations();

    expect(result.failed).toBe(1);
    // Op status: still pending so the next tick will retry.
    expect(op.status).toBe('pending');
    expect(op.retryCount).toBe(1); // bumped exactly once
  });

  // ── Phase 8.4 I-3: dedupe STALE_TAPE toasts per filter per drain ──────
  //
  // When 5 cycle-bound ops are queued for the same filter and the cycle
  // moves on, every replay would 409 STALE_TAPE — old behavior emitted 5
  // identical toasts and made 5 wasted POSTs. New behavior: one toast,
  // remaining ops short-circuited to `failed` without hitting the network.

  it('5. I-3: 5 STALE_TAPE-bound ops on the same filter emit ONE toast', async () => {
    // Queue 5 ops for the SAME filter.
    const errorsEmitted: string[] = [];
    for (let i = 0; i < 5; i++) {
      queueOp({ type: 'advance', filterId: 'filter-A', filterName: 'Filter A', tapeVersion: 1003 });
    }

    // First POST returns 409 STALE_TAPE. Subsequent ops for filter-A should
    // be short-circuited (no network call) — but the harness will still
    // throw for any cycle-bound POST that DOES happen.
    let postCallCount = 0;
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      postCallCount++;
      const err: any = new Error('Tape version mismatch');
      err.code = 'STALE_TAPE';
      err.status = 409;
      err.currentTapeVersion = 1005;
      throw err;
    });

    // Listen via the SAME imported module syncPendingOperations came from,
    // not a fresh dynamic import (vi.resetModules() between tests would put
    // them in different module-instance spaces and the listener would be
    // attached to the wrong copy of the engine state).
    const engineMod = await import('../sync-engine');
    const off = engineMod.onSyncEvent((ev) => {
      if (ev.type === 'error' && typeof ev.error === 'string') errorsEmitted.push(ev.error);
    });

    const result = await engineMod.syncPendingOperations();
    off();

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(5);
    // Network: only one POST should have happened (the first); the other
    // four were short-circuited by the dedupe set.
    expect(postCallCount).toBe(1);
    // Toast: exactly one STALE_TAPE-themed toast for filter-A.
    const staleToasts = errorsEmitted.filter(e => /Filter A:.*another operator/.test(e));
    expect(staleToasts).toHaveLength(1);
  });

  // ── Phase 8.7 follow-up (2026-05-03): cycle-tombstone tapeVersion + ──────
  // justification field-name. The server's terminate-cycle route REQUIRES
  // tapeVersion (commit f8fae1d) and `justification` (minLength 10), not
  // `reason`. The tombstone replay path is separate from the cycle-bound
  // operations replay path (agent H's 28e574c covers the latter).

  it('7. cycle tombstone with tapeVersion forwards it on terminate-cycle replay AND uses justification', async () => {
    // syncPendingOperations() short-circuits if the operations queue is
    // empty (line 230) — tombstone draining only runs when there is also
    // at least one pending op. Queue a benign advance to drive both paths.
    queueOp({ type: 'advance', filterId: 'filter-Z', tapeVersion: 999 });

    mockOfflineStore.getPendingTombstones.mockResolvedValueOnce([
      {
        id: 'ts-1',
        clientOpId: 'cli-ts-1',
        entityType: 'cycle',
        entityId: 'cyc-1',
        payload: { filterId: 'filter-T', justification: 'Operator stopped to investigate alarm condition' },
        createdAt: new Date('2026-05-03T08:00:00Z').toISOString(),
        status: 'pending',
        retryCount: 0,
        tapeVersion: 1042,
      },
    ]);
    // Default mockApiClient.post resolves {} for both /terminate-cycle and
    // /advance (the refresh-token branch already short-circuits in beforeEach).
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      return { ok: true };
    });

    await syncPendingOperations();

    const terminateCall = mockApiClient.post.mock.calls.find(
      ([url]: any[]) => typeof url === 'string' && url.includes('/terminate-cycle'),
    );
    expect(terminateCall).toBeTruthy();
    const [url, body] = terminateCall!;
    expect(url).toBe('/api/filters/filter-T/terminate-cycle');
    // The fix: server requires `justification` (minLength 10), not `reason`.
    expect(body.justification).toBe('Operator stopped to investigate alarm condition');
    expect('reason' in body).toBe(false);
    // The fix: tapeVersion is forwarded on the body for staleness check.
    expect(body.tapeVersion).toBe(1042);
    expect(body.clientOpId).toBe('cli-ts-1');
    // Tombstone marked synced.
    expect(mockOfflineStore.updateTombstoneStatus).toHaveBeenCalledWith('ts-1', 'synced');
  });

  it('8. cycle tombstone with tapeVersion=null replays WITHOUT a tapeVersion field (legacy on-disk row)', async () => {
    // A pre-fix tombstone that was queued before tapeVersion existed on
    // the type. Replay must omit the field so the request body parses.
    // The server schema requires the field — this op WILL 400 SCHEMA_ERROR
    // on the live server, which is the documented migration cost.
    queueOp({ type: 'advance', filterId: 'filter-Z', tapeVersion: 999 });

    mockOfflineStore.getPendingTombstones.mockResolvedValueOnce([
      {
        id: 'ts-2',
        clientOpId: 'cli-ts-2',
        entityType: 'cycle',
        entityId: 'cyc-2',
        // Legacy row used `reason` field name. The fix accepts both shapes
        // so any pre-fix on-disk rows still send a syntactically valid body.
        payload: { filterId: 'filter-L', reason: 'Legacy offline terminate' },
        createdAt: new Date('2026-05-03T08:00:00Z').toISOString(),
        status: 'pending',
        retryCount: 0,
        tapeVersion: null,
      },
    ]);
    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      return { ok: true };
    });

    await syncPendingOperations();

    const terminateCall = mockApiClient.post.mock.calls.find(
      ([url]: any[]) => typeof url === 'string' && url.includes('/terminate-cycle'),
    );
    expect(terminateCall).toBeTruthy();
    const body = terminateCall![1] as Record<string, any>;
    // Critical: tapeVersion field must NOT be on the body — null is dropped.
    expect('tapeVersion' in body).toBe(false);
    // Legacy `reason` field is mapped to `justification` so the body is
    // still syntactically valid (server will accept the field; whether the
    // request succeeds depends on whether the server treats missing
    // tapeVersion as 400 — that's a migration-cost case documented in
    // sync-engine.ts).
    expect(body.justification).toBe('Legacy offline terminate');
    expect('reason' in body).toBe(false);
  });

  it('6. I-3: STALE_TAPE on different filters each emits its own toast', async () => {
    const errorsEmitted: string[] = [];
    queueOp({ type: 'advance', filterId: 'filter-X', filterName: 'Filter X', tapeVersion: 1003 });
    queueOp({ type: 'advance', filterId: 'filter-Y', filterName: 'Filter Y', tapeVersion: 1004 });

    mockApiClient.post.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') return { token: 'fresh' };
      const err: any = new Error('Tape version mismatch');
      err.code = 'STALE_TAPE';
      err.status = 409;
      err.currentTapeVersion = 1099;
      throw err;
    });

    const engineMod = await import('../sync-engine');
    const off = engineMod.onSyncEvent((ev) => {
      if (ev.type === 'error' && typeof ev.error === 'string') errorsEmitted.push(ev.error);
    });

    const result = await engineMod.syncPendingOperations();
    off();

    expect(result.failed).toBe(2);
    const xToasts = errorsEmitted.filter(e => /Filter X:.*another operator/.test(e));
    const yToasts = errorsEmitted.filter(e => /Filter Y:.*another operator/.test(e));
    expect(xToasts).toHaveLength(1);
    expect(yToasts).toHaveLength(1);
  });
});
