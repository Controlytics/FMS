import { describe, it, expect } from 'vitest';
import { normalizeOpForV4 } from '../offline-store';

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
