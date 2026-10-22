/**
 * verifyAuditChain (lib/audit-verify.ts) — every anomaly class, on crafted rows.
 *
 * The shared digilog_test_db chain is written by every concurrent suite and is
 * known not to be intact, and tampering real rows would hand every other agent
 * a broken chain. So the ONE database read (`prisma.$queryRaw`) is replaced by
 * rows built here with the same checksum functions the writer uses; everything
 * downstream of that read — per-row verification, link checks, gap and
 * keyed-era detection, the legacy key-order classifier — runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ rows: [] as unknown[], queryRaw: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { $queryRaw: db.queryRaw } }));

import { verifyAuditChain, V2_WRITE_CUTOVER } from '../audit-verify.js';
import { redactionSnapshot } from '../audit-redaction.js';
import {
  computeChainedChecksum, computeChainedChecksumV2, computeChainedChecksumV3, computeChecksum,
  __setAuditChainKeyForTest, __setAuditChainKeyedFromForTest,
} from '../hash-chain.js';

const KEY = 'cvl-test-chain-key-0123456789abcdef';

interface Fields { timestamp: string; userId?: string; action: string; targetType?: string; targetId?: string; afterValue?: unknown }

/** A DB row as audit-verify reads it, checksummed like the writer would. */
function row(position: number | bigint | null, prev: string | null, f: Fields, opts: { version?: 3; checksum?: string; storedAfter?: unknown; redactedAt?: Date } = {}) {
  const fields = { timestamp: f.timestamp, userId: f.userId, action: f.action, targetType: f.targetType, targetId: f.targetId, afterValue: f.afterValue };
  const checksum = opts.checksum ?? (opts.version === 3
    ? computeChainedChecksumV3(fields, prev, KEY)
    : computeChainedChecksumV2(fields, prev));
  return {
    id: `row-${String(position)}`, chain_position: position, timestamp: new Date(f.timestamp),
    user_id: f.userId ?? null, user_name: null, user_role: null, action: f.action,
    target_type: f.targetType ?? null, target_id: f.targetId ?? null,
    before_value: null, after_value: 'storedAfter' in opts ? opts.storedAfter : (f.afterValue ?? null),
    reason: null, ip_address: null, user_agent: null, session_id: null, signature_meaning: null,
    signature_audit_id: null, checksum, previous_checksum: prev,
    redacted_at: opts.redactedAt ?? null, checksum_version: opts.version ?? null,
  };
}

const NOW = '2026-10-21T10:00:00.000Z';
const f = (n: number, extra: Partial<Fields> = {}): Fields => ({ timestamp: NOW, userId: `cvl_u${n}`, action: 'CVL_ACTION', targetType: 'probe', targetId: `t${n}`, afterValue: { n }, ...extra });

/** A clean chain of `count` rows starting at `from`, optionally after a pre-chain row. */
function chain(from: number, count: number, startPrev: string | null = 'genesis-prev') {
  const out = [];
  let prev = startPrev;
  for (let i = 0; i < count; i++) {
    const r = row(from + i, prev, f(from + i));
    out.push(r);
    prev = r.checksum;
  }
  return out;
}

beforeEach(() => {
  db.queryRaw.mockReset().mockImplementation(async () => db.rows);
  __setAuditChainKeyForTest(undefined);
  __setAuditChainKeyedFromForTest(null);
});
afterEach(() => {
  __setAuditChainKeyForTest(undefined);
  __setAuditChainKeyedFromForTest(undefined);
});

describe('verifyAuditChain', () => {
  it('reports an intact chain with pre-chain and chained counts and the head position', async () => {
    const pre = { ...row(1, null, f(1)), checksum: computeChecksum({ timestamp: NOW, userId: 'cvl_u1', action: 'CVL_ACTION', targetType: 'probe', targetId: 't1', afterValue: { n: 1 } }) };
    const rest = chain(2, 3, pre.checksum).map((r, i) => (i === 1 ? { ...r, chain_position: BigInt(3) } : r));
    db.rows = [pre, ...rest];
    const res = await verifyAuditChain({ fromPosition: 1, toPosition: 4 });
    expect(res).toMatchObject({ totalRowsChecked: 4, preChainRows: 1, chainedRows: 3, highestPosition: 4, anomalies: [], intact: true, legacyKeyOrderRows: { proven: 0, unverifiable: 0 } });
    // The window reaches the query as bound parameters.
    const values = db.queryRaw.mock.calls[0].slice(1);
    expect(values).toEqual([1, 4]);
  });

  it('defaults the window to the whole table and handles an empty result', async () => {
    db.rows = [];
    const res = await verifyAuditChain();
    expect(db.queryRaw.mock.calls[0].slice(1)).toEqual([0, Number.MAX_SAFE_INTEGER]);
    expect(res).toMatchObject({ totalRowsChecked: 0, highestPosition: null, anomalies: [], intact: true });
  });

  it('flags an in-place edit as PER_ROW_CHECKSUM_MISMATCH (the next link still matches)', async () => {
    const rows = chain(10, 3);
    rows[1] = { ...rows[1], after_value: { n: 999 } };
    db.rows = rows;
    const res = await verifyAuditChain();
    expect(res.intact).toBe(false);
    expect(res.anomalies).toEqual([expect.objectContaining({ position: 11, id: 'row-11', kind: 'PER_ROW_CHECKSUM_MISMATCH' })]);
  });

  it('flags a broken link as CHAIN_LINK_MISMATCH with expected and actual', async () => {
    const rows = chain(20, 2);
    const forged = row(22, 'f'.repeat(64), f(22)); // self-consistent row, wrong predecessor
    db.rows = [...rows, forged];
    const res = await verifyAuditChain();
    expect(res.anomalies).toEqual([expect.objectContaining({ kind: 'CHAIN_LINK_MISMATCH', position: 22, expected: rows[1].checksum, actual: 'f'.repeat(64) })]);
  });

  it('flags a missing interior position as CHAIN_POSITION_GAP', async () => {
    const a = row(30, 'p', f(30));
    const b = row(33, a.checksum, f(33));
    db.rows = [a, b];
    const res = await verifyAuditChain();
    expect(res.anomalies).toEqual([expect.objectContaining({ kind: 'CHAIN_POSITION_GAP', position: 33, expected: '31', actual: '33' })]);
    expect(res.intact).toBe(false);
  });

  it('treats a NULL chain_position as -1', async () => {
    db.rows = [row(null, 'p', f(0))];
    const res = await verifyAuditChain();
    expect(res).toMatchObject({ highestPosition: null, anomalies: [], intact: true });
  });

  it('accepts a redacted row against its redaction record, and flags one with no record or whose payload came back', async () => {
    // 2026-10-22 (security assessment P1): "payload is null" alone used to pass
    // here, so marking ANY row redacted and rewriting its who/what passed too.
    const r = chain(40, 2);
    const REDACTED_AT = new Date(NOW);
    const snapshot = redactionSnapshot(r[0], { redactedAt: REDACTED_AT, redactedBy: 'sa-uuid', redactionReason: 'privacy' });
    const metaFields = {
      timestamp: NOW, userId: 'sa', userName: undefined, userRole: undefined, action: 'AUDIT_RECORD_REDACTED', targetType: 'audit_trail',
      targetId: r[0].id, beforeValue: snapshot, afterValue: undefined, reason: 'privacy', ipAddress: undefined, userAgent: undefined,
      sessionId: undefined, signatureMeaning: undefined,
    };
    const meta = {
      ...row(42, r[1].checksum, f(42)), id: 'meta-42', user_id: 'sa', action: 'AUDIT_RECORD_REDACTED', target_type: 'audit_trail',
      target_id: r[0].id, before_value: snapshot, after_value: null, reason: 'privacy',
      checksum: computeChainedChecksumV2(metaFields, r[1].checksum),
    };
    const redacted = { ...r[0], after_value: null, redacted_at: REDACTED_AT, redacted_by: 'sa-uuid', redaction_reason: 'privacy' };
    db.rows = [redacted, r[1], meta];
    expect(await verifyAuditChain()).toMatchObject({ intact: true, anomalies: [] });

    db.rows = [redacted, r[1]]; // the record of the redaction is missing
    const missing = await verifyAuditChain();
    expect(missing.anomalies.map((a) => a.kind)).toEqual(['REDACTION_UNRECORDED']);
    expect(missing.intact).toBe(false);

    db.rows = [{ ...redacted, user_id: 'mallory' }, r[1], meta]; // who was rewritten after the redaction
    expect((await verifyAuditChain()).anomalies.map((a) => a.kind)).toEqual(['REDACTED_ROW_MISMATCH']);

    db.rows = [{ ...redacted, after_value: { n: 'forged' } }, r[1], meta];
    expect((await verifyAuditChain()).anomalies.map((a) => a.kind)).toEqual(['PER_ROW_CHECKSUM_MISMATCH']);
  });

  describe('keyed era (AUDIT_CHAIN_KEYED_FROM)', () => {
    it('requires v3 rows from the cut-over position on, and verifies them with the key', async () => {
      __setAuditChainKeyForTest(KEY);
      __setAuditChainKeyedFromForTest(51);
      const r50 = row(50, 'p', f(50));
      const r51 = row(51, r50.checksum, f(51), { version: 3 });
      const r52 = row(52, r51.checksum, f(52), { version: 3 });
      db.rows = [r50, r51, r52];
      expect(await verifyAuditChain()).toMatchObject({ anomalies: [], intact: true });

      // A v3 row relabelled unkeyed and recomputed with the unkeyed formula.
      const downgraded = row(52, r51.checksum, f(52));
      db.rows = [r50, r51, downgraded];
      const res = await verifyAuditChain();
      expect(res.anomalies).toEqual([expect.objectContaining({ kind: 'KEYED_ERA_DOWNGRADE', position: 52, expected: '3', actual: 'NULL' })]);
    });

    it('cannot verify a v3 row without the key', async () => {
      __setAuditChainKeyForTest(KEY);
      const r = row(60, 'p', f(60), { version: 3 });
      __setAuditChainKeyForTest(null);
      db.rows = [r];
      expect((await verifyAuditChain()).anomalies.map((a) => a.kind)).toEqual(['PER_ROW_CHECKSUM_MISMATCH']);
    });
  });

  describe('pre-cut-over V1 rows whose keys JSONB re-ordered', () => {
    const OLD = new Date(V2_WRITE_CUTOVER.getTime() - 86_400_000).toISOString();

    it('PROVES a chained row by restoring the insertion order (nested objects and arrays too)', async () => {
      const written = { k: 'v', list: [{ y: 1, x: 2 }], empty: [] as unknown[] };
      const fields = { timestamp: OLD, userId: 'cvl_old', action: 'CVL_OLD', targetType: 'probe', targetId: 'old1', afterValue: written };
      const checksum = computeChainedChecksum(fields, 'prev-old');
      const r = row(70, 'prev-old', { ...fields }, { checksum, storedAfter: { empty: [], list: [{ x: 2, y: 1 }], k: 'v' } });
      db.rows = [r];
      const res = await verifyAuditChain();
      expect(res.anomalies).toEqual([expect.objectContaining({ kind: 'LEGACY_V1_KEY_ORDER', informational: true })]);
      expect(res.legacyKeyOrderRows).toEqual({ proven: 1, unverifiable: 0 });
      expect(res.intact).toBe(true);
    });

    it('PROVES a pre-chain genesis row (no previous checksum)', async () => {
      const fields = { timestamp: OLD, userId: 'cvl_old', action: 'CVL_OLD', targetType: 'probe', targetId: 'old2', afterValue: { b: 1, a: 2 } };
      const checksum = computeChecksum(fields);
      db.rows = [row(71, null, fields, { checksum, storedAfter: { a: 2, b: 1 } })];
      const res = await verifyAuditChain();
      expect(res.legacyKeyOrderRows.proven).toBe(1);
      expect(res.preChainRows).toBe(1);
    });

    it('PROVES a row whose payload is a top-level array of objects', async () => {
      const fields = { timestamp: OLD, action: 'CVL_OLD', afterValue: [{ b: 1, a: 2 }] };
      const checksum = computeChainedChecksum(fields, 'p');
      db.rows = [row(74, 'p', fields, { checksum, storedAfter: [{ a: 2, b: 1 }] })];
      expect((await verifyAuditChain()).legacyKeyOrderRows.proven).toBe(1);
    });

    it('an old row with a null payload that fails is plain tampering (nothing to re-order)', async () => {
      db.rows = [row(75, 'p', { timestamp: OLD, action: 'CVL_OLD' }, { checksum: 'd'.repeat(64), storedAfter: null })];
      expect((await verifyAuditChain()).anomalies.map((a) => a.kind)).toEqual(['PER_ROW_CHECKSUM_MISMATCH']);
    });

    it('marks a payload too large to permute UNVERIFIABLE, not tampering', async () => {
      const big = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 };
      db.rows = [row(72, 'p', { timestamp: OLD, action: 'CVL_OLD', afterValue: big }, { checksum: 'e'.repeat(64) })];
      const res = await verifyAuditChain();
      expect(res.anomalies).toEqual([expect.objectContaining({ kind: 'LEGACY_V1_KEY_ORDER_UNVERIFIABLE', informational: true })]);
      expect(res.legacyKeyOrderRows).toEqual({ proven: 0, unverifiable: 1 });
      expect(res.intact).toBe(true);
    });

    it('keeps a genuinely edited old row as PER_ROW_CHECKSUM_MISMATCH', async () => {
      const fields = { timestamp: OLD, action: 'CVL_OLD', afterValue: { b: 1, a: 2 } };
      const checksum = computeChainedChecksum(fields, 'p');
      db.rows = [row(73, 'p', fields, { checksum, storedAfter: { a: 2, b: 'edited' } })];
      expect((await verifyAuditChain()).anomalies.map((a) => a.kind)).toEqual(['PER_ROW_CHECKSUM_MISMATCH']);
    });
  });

  describe('maxAnomalies stops the walk at the cap', () => {
    it('stops on a per-row mismatch', async () => {
      const rows = chain(80, 3).map((r) => ({ ...r, after_value: { tampered: true } }));
      db.rows = rows;
      const res = await verifyAuditChain({ maxAnomalies: 1 });
      expect(res.anomalies).toHaveLength(1);
      expect(res.totalRowsChecked).toBe(3);
    });

    it('stops on a link mismatch', async () => {
      db.rows = [row(90, 'p', f(90)), row(91, 'x', f(91)), row(92, 'y', f(92))];
      const res = await verifyAuditChain({ maxAnomalies: 1 });
      expect(res.anomalies.map((a) => a.position)).toEqual([91]);
    });

    it('stops on a position gap', async () => {
      const a = row(100, 'p', f(100));
      const b = row(102, a.checksum, f(102));
      const c = row(104, b.checksum, f(104));
      db.rows = [a, b, c];
      expect((await verifyAuditChain({ maxAnomalies: 1 })).anomalies.map((x) => x.position)).toEqual([102]);
    });

    it('stops on a keyed-era downgrade', async () => {
      __setAuditChainKeyedFromForTest(0);
      db.rows = chain(110, 3);
      const res = await verifyAuditChain({ maxAnomalies: 1 });
      expect(res.anomalies).toEqual([expect.objectContaining({ kind: 'KEYED_ERA_DOWNGRADE', position: 110 })]);
    });
  });
});
