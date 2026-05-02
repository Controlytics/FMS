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
      getPendingTombstones: vi.fn(async () => []),
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
});
