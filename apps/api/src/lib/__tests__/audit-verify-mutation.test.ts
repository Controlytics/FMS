import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * lib/audit-verify.ts - the behaviour mutation testing (Stryker, 2026-10-23)
 * showed no test pinned: which rows the legacy key-order classifier admits and
 * how it proves them, the anomaly each redaction verdict produces (kind,
 * informational flag, message), when the redaction records are read, the
 * `maxAnomalies` cap at every anomaly site, and the position / message details.
 *
 * DB-free: the one database read (`prisma.$queryRaw`) returns rows built here
 * with the writer's own checksum functions. Everything after it runs for real.
 */
const db = vi.hoisted(() => ({ walk: [] as unknown[], meta: [] as unknown[], queryRaw: vi.fn() }));
vi.mock('../prisma.js', () => ({ prisma: { $queryRaw: db.queryRaw } }));

import { verifyAuditChain, classifyLegacyKeyOrderRow, V2_WRITE_CUTOVER } from '../audit-verify.js';
import { redactionSnapshot, REDACTION_META_ACTIONS } from '../audit-redaction.js';
import {
  computeChainedChecksum, computeChainedChecksumV2, computeChecksum,
  __setAuditChainKeyForTest, __setAuditChainKeyedFromForTest,
} from '../hash-chain.js';

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  db.walk = []; db.meta = [];
  db.queryRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray) =>
    (strings.join('?').includes('action IN') ? db.meta : db.walk));
  __setAuditChainKeyForTest(undefined);
  __setAuditChainKeyedFromForTest(null);
});
afterEach(() => {
  __setAuditChainKeyForTest(undefined);
  __setAuditChainKeyedFromForTest(undefined);
});

// ---------------------------------------------------------------------------
// classifyLegacyKeyOrderRow (pure)
// ---------------------------------------------------------------------------
const OLD = '2026-05-01T08:00:00.000Z'; // before the V2 write cut-over
const fieldsOf = (ts: string, afterValue: unknown) => ({ timestamp: ts, userId: 'u', action: 'A', targetType: 't', targetId: 'id', afterValue });
/** A legacy V1 row whose checksum was computed with `written` and whose stored payload is `stored`. */
const legacy = (written: unknown, stored: unknown, opts: { ts?: string; prev?: string | null; genesisFormula?: 'chained' | 'plain' } = {}) => {
  const ts = opts.ts ?? OLD;
  const prev = opts.prev === undefined ? 'prev-0' : opts.prev;
  const checksum = prev != null
    ? computeChainedChecksum(fieldsOf(ts, written), prev)
    : opts.genesisFormula === 'plain' ? computeChecksum(fieldsOf(ts, written)) : computeChainedChecksum(fieldsOf(ts, written), null);
  return { timestamp: ts, checksumVersion: null, checksum, previousChecksum: prev, userId: 'u', action: 'A', targetType: 't', targetId: 'id', afterValue: stored };
};

describe('classifyLegacyKeyOrderRow', () => {
  it('PROVES a row once the top-level key order is restored', () => {
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 2, b: 1 }))).toBe('PROVEN');
  });

  it('arrays of scalars add no keys: 2 keys + a 7-element array is still provable (not "too large")', () => {
    const written = { b: 1, a: [1, 2, 3, 4, 5, 6, 7] };
    expect(classifyLegacyKeyOrderRow(legacy(written, { a: [1, 2, 3, 4, 5, 6, 7], b: 1 }))).toBe('PROVEN');
  });

  it('counts the keys of objects inside arrays: 2 + 3 x 2 = 8 is UNVERIFIABLE', () => {
    const written = { b: 1, a: [{ y: 1, x: 2 }, { y: 1, x: 2 }, { y: 1, x: 2 }] };
    const stored = { a: [{ x: 2, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 1 }], b: 1 };
    expect(classifyLegacyKeyOrderRow(legacy(written, stored))).toBe('UNVERIFIABLE');
  });

  it('a key that was not in the hashed payload is an edit: never "proven" by leaving it out', () => {
    // Hashed as { b: 1 }; the stored payload gained `a` afterwards.
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1 }, { a: { x: 1, y: 2 }, b: 1 }))).toBeNull();
  });

  it('counts nested keys: 2 + 3 + 4 = 9 keys is UNVERIFIABLE even though the order could be found', () => {
    const written = { b: { s: 1, r: 2, q: 3, p: 4 }, a: { z: 1, y: 2, x: 3 } };
    const stored = { a: { x: 3, y: 2, z: 1 }, b: { p: 4, q: 3, r: 2, s: 1 } };
    expect(classifyLegacyKeyOrderRow(legacy(written, stored))).toBe('UNVERIFIABLE');
  });

  it('exactly the budget (6 keys) is still tried, and nested orders at EVERY position are explored', () => {
    // 2 + 2 + 2 = 6; the first key's nested object needs its SECOND ordering.
    const written = { a: { x: 1, y: 2 }, b: { q: 1, p: 2 } };
    const stored = { a: { y: 2, x: 1 }, b: { p: 2, q: 1 } };
    expect(classifyLegacyKeyOrderRow(legacy(written, stored))).toBe('PROVEN');
    // Arrays of objects are re-ordered element by element, and stay arrays.
    expect(classifyLegacyKeyOrderRow(legacy({ l: [{ y: 1, x: 2 }], k: 1 }, { k: 1, l: [{ x: 2, y: 1 }] }))).toBe('PROVEN');
  });

  it('only payloads JSONB could have re-ordered are in the class (an object with 2+ keys somewhere)', () => {
    // Even when the stored checksum matches the payload as stored, these are not legacy-order rows.
    for (const payload of [{ a: 1 }, { a: 'xy' }, { a: [1, 2] }, { a: [] }, { a: {} }, 'text', 5, null]) {
      expect(classifyLegacyKeyOrderRow(legacy(payload, payload)), JSON.stringify(payload)).toBeNull();
    }
    expect(classifyLegacyKeyOrderRow(legacy({ a: [{ y: 1, x: 2 }] }, { a: [{ x: 2, y: 1 }] }))).toBe('PROVEN');
  });

  it('only rows written BEFORE the cut-over, and never a versioned row', () => {
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 2, b: 1 }, { ts: V2_WRITE_CUTOVER.toISOString() }))).toBeNull();
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 2, b: 1 }, { ts: '2026-06-01T00:00:00.000Z' }))).toBeNull();
    expect(classifyLegacyKeyOrderRow({ ...legacy({ b: 1, a: 2 }, { a: 2, b: 1 }), checksumVersion: 2 })).toBeNull();
    expect(classifyLegacyKeyOrderRow({ ...legacy({ b: 1, a: 2 }, { a: 2, b: 1 }), timestamp: new Date(OLD) })).toBe('PROVEN');
  });

  it('genesis rows: the chained-null and the plain V1 formula are both accepted', () => {
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 2, b: 1 }, { prev: null, genesisFormula: 'chained' }))).toBe('PROVEN');
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 2, b: 1 }, { prev: null, genesisFormula: 'plain' }))).toBe('PROVEN');
  });

  it('a real edit is not "proven" by any order: chained and genesis', () => {
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 3, b: 1 }))).toBeNull();
    expect(classifyLegacyKeyOrderRow(legacy({ b: 1, a: 2 }, { a: 3, b: 1 }, { prev: null, genesisFormula: 'plain' }))).toBeNull();
    // The link is part of the hash: the right payload under the wrong previous checksum is an edit too.
    expect(classifyLegacyKeyOrderRow({ ...legacy({ b: 1, a: 2 }, { a: 2, b: 1 }), previousChecksum: 'prev-X' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyAuditChain on crafted rows
// ---------------------------------------------------------------------------
const NOW = '2026-10-21T10:00:00.000Z';
type Row = Record<string, any>;
/** Every persisted column of a row, as the writer hashes them (the expanded set). */
const expanded = (r: Row) => ({
  timestamp: new Date(r.timestamp).toISOString(), userId: r.user_id ?? undefined, userName: r.user_name ?? undefined, userRole: r.user_role ?? undefined,
  action: r.action, targetType: r.target_type ?? undefined, targetId: r.target_id ?? undefined, beforeValue: r.before_value ?? undefined,
  afterValue: r.after_value ?? undefined, reason: r.reason ?? undefined, ipAddress: r.ip_address ?? undefined, userAgent: r.user_agent ?? undefined,
  sessionId: r.session_id ?? undefined, signatureMeaning: r.signature_meaning ?? undefined,
  ...(r.signature_audit_id ? { signatureAuditId: r.signature_audit_id } : {}),
});
function mk(position: number | null, prev: string | null, over: Row = {}): Row {
  const r: Row = {
    id: `r${position}`, chain_position: position, timestamp: new Date(NOW), user_id: 'u1', user_name: 'User', user_role: 'QA',
    action: 'CV_ACTION', target_type: 'probe', target_id: `t${position}`, before_value: { v: 1 }, after_value: { v: 2 }, reason: 'r',
    ip_address: '10.0.0.1', user_agent: 'ua', session_id: 's', signature_meaning: 'm', signature_audit_id: null,
    previous_checksum: prev, redacted_at: null, redacted_by: null, redaction_reason: null, checksum_version: null, ...over,
  };
  r.checksum = over.checksum ?? computeChainedChecksumV2(expanded(r), prev);
  return r;
}
function chainOf(positions: number[], first: string | null = 'g') {
  let prev = first;
  return positions.map((p) => { const r = mk(p, prev); prev = r.checksum; return r; });
}
const REDACTED_AT = new Date('2026-10-21T11:00:00.000Z');
const redact = (r: Row) => ({ ...r, before_value: null, after_value: null, redacted_at: REDACTED_AT, redacted_by: 'sa-id', redaction_reason: 'privacy' });
/** A redaction record for `target`, its own checksum valid (expanded) unless `forge` edits it afterwards. */
function metaFor(target: Row, position: number, snapshot: unknown = redactionSnapshot(target, { redactedAt: REDACTED_AT, redactedBy: 'sa-id', redactionReason: 'privacy' })) {
  return mk(position, 'm-prev', { id: `meta-${target.id}`, action: 'AUDIT_RECORD_REDACTED', target_type: 'audit_trail', target_id: target.id, before_value: snapshot, after_value: null });
}

describe('verifyAuditChain: redaction anomalies', () => {
  it('each verdict becomes its own anomaly - kind, message, and informational only for PARTIAL', async () => {
    const [a, b, c, d, e, g] = chainOf([1, 2, 3, 4, 5, 6]);
    const ra = redact(a); const rb = redact(b); const rc = redact(c); const rd = redact(d); const re = redact(e);
    const rg = { ...redact(g), after_value: { back: 1 } }; // payload came back
    const forgedMeta = { ...metaFor(rc, 100), user_id: 'mallory' }; // edited after writing: fails its own checksum
    const untrusted = (() => {
      const m = metaFor(rd, 101);
      const reduced = { timestamp: new Date(m.timestamp).toISOString(), userId: m.user_id, action: m.action, targetType: m.target_type, targetId: m.target_id, afterValue: undefined };
      return { ...m, checksum: computeChainedChecksumV2(reduced, m.previous_checksum) }; // pre-2026-07-04: snapshot not covered
    })();
    const legacyMeta = metaFor(re, 102, { id: re.id, action: re.action, timestamp: re.timestamp, userId: re.user_id, targetType: re.target_type, targetId: re.target_id });
    db.walk = [ra, { ...rb, user_id: 'mallory' }, rc, rd, re, rg];
    db.meta = [/* none for ra */ metaFor(rb, 99), forgedMeta, untrusted, legacyMeta];

    const res = await verifyAuditChain();
    expect(res.anomalies.map((x) => [x.id, x.kind, x.informational ?? false])).toEqual([
      ['r1', 'REDACTION_UNRECORDED', false],
      ['r2', 'REDACTED_ROW_MISMATCH', false],
      ['r3', 'REDACTION_RECORD_INVALID', false],
      ['r4', 'REDACTION_RECORD_UNTRUSTED', false],
      ['r5', 'REDACTION_PARTIALLY_VERIFIED', true],
      ['r6', 'PER_ROW_CHECKSUM_MISMATCH', false],
    ]);
    expect(Object.prototype.hasOwnProperty.call(res.anomalies[0], 'informational')).toBe(false);
    expect(res.anomalies.map((x) => x.message)).toEqual([
      'Row r1 is marked redacted but no redaction record names it — its fields cannot be verified, so it is not accepted as valid.',
      'Row r2 differs from what its redaction recorded (userId) — tampering detected.',
      'Row r3 is redacted, but the record of that redaction fails its own checksum — tampering detected.',
      'Row r4 is redacted, but the record of that redaction predates field-level checksum coverage, so its snapshot is not protected and cannot vouch for the row.',
      'Row r5 was redacted before 2026-10-22: its action, time, actor and target match the redaction record; its other fields were not recorded and cannot be verified.',
      'Row r6 is marked redacted but its payload is present — tampering detected.',
    ]);
    expect(res.anomalies.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.intact).toBe(false);
  });

  it('a mismatch names every differing field, comma-separated', async () => {
    const [a] = chainOf([1]);
    const ra = redact(a);
    db.walk = [{ ...ra, user_id: 'mallory', reason: 'rewritten' }];
    db.meta = [metaFor(ra, 20)];
    const [x] = (await verifyAuditChain()).anomalies;
    expect(x.message).toBe('Row r1 differs from what its redaction recorded (userId, reason) — tampering detected.');
  });

  it('a chain whose only anomaly is informational is intact; a verified redaction adds nothing', async () => {
    const [a, b] = chainOf([1, 2]);
    const ra = redact(a); const rb = redact(b);
    db.walk = [ra, rb];
    db.meta = [metaFor(ra, 50), metaFor(rb, 51, { id: rb.id, action: rb.action, timestamp: rb.timestamp, userId: rb.user_id, targetType: rb.target_type, targetId: rb.target_id })];
    const res = await verifyAuditChain();
    expect(res.anomalies.map((x) => x.kind)).toEqual(['REDACTION_PARTIALLY_VERIFIED']);
    expect(res.intact).toBe(true);
  });

  it('the redaction records are read only when the walked range holds a redacted row, from the whole table, by action', async () => {
    db.walk = chainOf([1, 2]);
    await verifyAuditChain();
    expect(db.queryRaw).toHaveBeenCalledTimes(1);

    db.queryRaw.mockClear();
    const [a, b] = chainOf([1, 2]);
    db.walk = [a, redact(b)];
    db.meta = [metaFor(redact(b), 9)];
    await verifyAuditChain({ fromPosition: 1, toPosition: 2 });
    expect(db.queryRaw).toHaveBeenCalledTimes(2);
    const metaCall = db.queryRaw.mock.calls[1];
    expect(sqlOf(metaCall)).toMatch(/FROM audit_trail\s+WHERE action IN \(\?, \?\)/);
    expect(sqlOf(metaCall)).not.toMatch(/chain_position >=/);
    expect(metaCall.slice(1)).toEqual([...REDACTION_META_ACTIONS]);
  });

  it('caps redaction anomalies at maxAnomalies exactly', async () => {
    db.walk = chainOf([1, 2, 3]).map(redact); // three unrecorded redactions
    expect((await verifyAuditChain({ maxAnomalies: 2 })).anomalies).toHaveLength(2);
    expect((await verifyAuditChain()).anomalies).toHaveLength(3);
  });
});

describe('verifyAuditChain: every other anomaly, its cap and its message', () => {
  it('without a cap, EVERY anomaly of each kind is reported (none stops the walk)', async () => {
    // Two broken links, two gaps, two in-place edits.
    const [a, b, c] = chainOf([1, 2, 3]);
    const d = mk(5, 'wrong-1'); const e = mk(7, 'wrong-2');
    db.walk = [a, { ...b, reason: 'edited' }, { ...c, reason: 'edited' }, d, e];
    const res = await verifyAuditChain();
    const kinds = res.anomalies.map((x) => x.kind);
    expect(kinds.filter((k) => k === 'PER_ROW_CHECKSUM_MISMATCH')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'CHAIN_LINK_MISMATCH')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'CHAIN_POSITION_GAP')).toHaveLength(2);
  });

  it('messages and expected / actual name what was found', async () => {
    const [a, b] = chainOf([1, 2]);
    const c = mk(4, 'wrong');
    db.walk = [a, { ...b, reason: 'edited' }, c];
    const res = await verifyAuditChain();
    expect(res.anomalies).toEqual([
      { position: 2, id: 'r2', kind: 'PER_ROW_CHECKSUM_MISMATCH', message: 'Row r2 checksum does not match its current field values — in-place tampering detected.' },
      { position: 4, id: 'r4', kind: 'CHAIN_LINK_MISMATCH', message: "Row r4 previous_checksum does not match the prior row's checksum — insertion or deletion detected.", expected: b.checksum, actual: 'wrong' },
      { position: 4, id: 'r4', kind: 'CHAIN_POSITION_GAP', message: 'Gap between chain_position 2 and 4 — interior row deletion detected.', expected: '3', actual: '4' },
    ]);
  });

  it('keyed era: a row AT the cut-over must be v3; message and actual name the version (NULL); every such row is reported', async () => {
    __setAuditChainKeyedFromForTest(2);
    db.walk = chainOf([1, 2, 3]);
    const res = await verifyAuditChain();
    expect(res.anomalies.filter((x) => x.kind === 'KEYED_ERA_DOWNGRADE').map((x) => x.id)).toEqual(['r2', 'r3']);
    expect(res.anomalies[0]).toEqual({
      position: 2, id: 'r2', kind: 'KEYED_ERA_DOWNGRADE', expected: '3', actual: 'NULL',
      message: 'Row r2 at chain_position 2 is in the keyed era (>= 2) but is not a v3 keyed row (checksum_version=NULL) — downgrade or tampering detected.',
    });
  });

  it('legacy rows: messages for proven and unverifiable', async () => {
    const proven = (() => {
      const r = mk(1, 'g', { timestamp: new Date(OLD), before_value: null, user_name: null, user_role: null, reason: null, ip_address: null, user_agent: null, session_id: null, signature_meaning: null });
      const written = { b: 1, a: 2 };
      return { ...r, after_value: { a: 2, b: 1 }, checksum: computeChainedChecksum({ timestamp: OLD, userId: 'u1', action: 'CV_ACTION', targetType: 'probe', targetId: 't1', afterValue: written }, 'g') };
    })();
    const big = { ...proven, id: 'r2', chain_position: 2, previous_checksum: proven.checksum, after_value: { a: { x: 1, y: 2, z: 3 }, b: { p: 1, q: 2, r: 3, s: 4 } }, checksum: 'x'.repeat(64) };
    db.walk = [proven, big];
    const res = await verifyAuditChain();
    expect(res.anomalies.map((x) => [x.kind, x.message])).toEqual([
      ['LEGACY_V1_KEY_ORDER', 'Row r1 was written before 2026-05-30 with the V1 formula; its stored checksum is reproduced once the payload keys are put back in insertion order (JSONB re-ordered them). Not tampering.'],
      ['LEGACY_V1_KEY_ORDER_UNVERIFIABLE', 'Row r2 was written before 2026-05-30 with the V1 formula and its payload keys were re-ordered by JSONB; the payload is too large to prove by permutation, so its FIELDS cannot be verified (its chain link still is).'],
    ]);
    expect(res.legacyKeyOrderRows).toEqual({ proven: 1, unverifiable: 1 });
    expect(res.intact).toBe(true);
  });

  it('a signed row verifies with its signature link inside the hash', async () => {
    db.walk = [mk(1, 'g', { signature_audit_id: 'sig-1' })];
    expect((await verifyAuditChain()).anomalies).toEqual([]);
  });

  it('positions: the head is reported even when it is 0; a NULL position is -1 and is not the head', async () => {
    db.walk = [mk(0, null)];
    expect((await verifyAuditChain()).highestPosition).toBe(0);
    db.walk = [{ ...mk(null, null), reason: 'edited' }];
    const res = await verifyAuditChain();
    expect(res.anomalies[0].position).toBe(-1);
    expect(res.highestPosition).toBeNull();
  });
});
