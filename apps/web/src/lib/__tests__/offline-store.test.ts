import { describe, it, expect } from 'vitest';
import { normalizeOpForV4, markSyncingRowPending, partitionOpsByOwner } from '../offline-store';

/**
 * Phase 8.4 M-3 — IDB v3 -> v4 migration policy.
 *
 * The migration normalizes pre-8.3 / pre-tightening rows that have
 * `tapeVersion === undefined` to explicit `null`, so every on-disk row has
 * a deterministic shape and the TypeScript interface (`tapeVersion: number
 * | null`) matches reality. This file tests the pure-function policy
 * directly; a full IDB integration test would require fake-indexeddb,
 * which the workspace doesn't currently install.
 */

describe('offline-store — Phase 8.4 M-3 v4 migration', () => {
  it('1. v3 row with undefined tapeVersion is normalized to null and signals a write', () => {
    const row: Record<string, unknown> = {
      id: 'op-old-1',
      type: 'advance',
      filterId: 'f-1',
      // No tapeVersion key at all — this is a v3 row from before 8.3 shipped.
    };
    const wrote = normalizeOpForV4(row as { tapeVersion?: number | null });
    expect(wrote).toBe(true);
    expect(row.tapeVersion).toBeNull();
  });

  it('2. row with explicit null tapeVersion is left alone (no write)', () => {
    const row: { tapeVersion: number | null; id: string } = { id: 'op-1', tapeVersion: null };
    const wrote = normalizeOpForV4(row);
    expect(wrote).toBe(false);
    expect(row.tapeVersion).toBeNull();
  });

  it('3. row with numeric tapeVersion is left alone', () => {
    const row: { tapeVersion: number | null; id: string } = { id: 'op-2', tapeVersion: 1005 };
    const wrote = normalizeOpForV4(row);
    expect(wrote).toBe(false);
    expect(row.tapeVersion).toBe(1005);
  });
});

describe('offline-store — requeue stuck syncing (audit #8, silent-data-loss fix)', () => {
  it('flips syncing -> pending', () => {
    const row = { id: 'op-1', status: 'syncing' };
    expect(markSyncingRowPending(row).status).toBe('pending');
  });

  it('does NOT bump retryCount (an interrupted replay is not a failure)', () => {
    const row = { id: 'op-2', status: 'syncing', retryCount: 2 };
    markSyncingRowPending(row);
    expect(row.status).toBe('pending');
    expect(row.retryCount).toBe(2); // retry budget preserved — the crash wasn't the op's fault
  });
});

/**
 * 21 CFR Part 11 attribution — the owner partition (2026-09-02).
 *
 * The server stamps `performedBy` from the JWT at REPLAY time, and the queue
 * lives in IndexedDB, which survives logout AND an app kill. Before this rule,
 * operator A could work offline, log out, hand the tablet over, and operator
 * B's login would drain A's work into the permanent record under B's name.
 *
 * The rule is HOLD, not re-attribute — sending the server an
 * "offlinePerformedBy" would be an unbounded forgery channel into the §11
 * record (unlike `offlinePerformedAt`, which offline-time-window.ts bounds).
 */
describe('offline-store — owner partition (§11 attribution)', () => {
  const op = (id: string, userId: string | null) =>
    ({ id, userId, userName: userId ? `user-${userId}` : null }) as any;

  it('1. replays the current user OWN operations', () => {
    const { syncable, held } = partitionOpsByOwner([op('a', 'u1'), op('b', 'u1')], 'u1');
    expect(syncable.map((o) => o.id)).toEqual(['a', 'b']);
    expect(held).toEqual([]);
  });

  it('2. HOLDS another user operations — the mis-attribution this exists to stop', () => {
    const { syncable, held } = partitionOpsByOwner([op('mine', 'u1'), op('theirs', 'u2')], 'u1');
    expect(syncable.map((o) => o.id)).toEqual(['mine']);
    expect(held.map((o) => o.id)).toEqual(['theirs']);
  });

  it('3. replays UNKNOWN-owner rows (pre-v7): holding them forever is guaranteed data loss', () => {
    const { syncable, held } = partitionOpsByOwner([op('legacy', null)], 'u1');
    expect(syncable.map((o) => o.id)).toEqual(['legacy']);
    expect(held).toEqual([]);
  });

  it('4. with no cached user, only unknown-owner rows replay — owned rows wait for their owner', () => {
    const { syncable, held } = partitionOpsByOwner([op('legacy', null), op('owned', 'u1')], null);
    expect(syncable.map((o) => o.id)).toEqual(['legacy']);
    expect(held.map((o) => o.id)).toEqual(['owned']);
  });

  it('5. an empty-string current user never matches an owned row', () => {
    // readCachedUserIdentity returns null (not '') precisely so this cannot
    // happen, but the partition must not treat '' as a wildcard either.
    const { syncable, held } = partitionOpsByOwner([op('owned', 'u1')], '');
    expect(syncable).toEqual([]);
    expect(held.map((o) => o.id)).toEqual(['owned']);
  });

  it('6. every operation lands in exactly one bucket', () => {
    const ops = [op('a', 'u1'), op('b', 'u2'), op('c', null), op('d', 'u1')];
    const { syncable, held } = partitionOpsByOwner(ops, 'u1');
    expect(syncable.length + held.length).toBe(ops.length);
    expect(new Set([...syncable, ...held]).size).toBe(ops.length);
  });
});
