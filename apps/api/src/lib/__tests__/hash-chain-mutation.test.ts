import { describe, it, expect, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

/**
 * lib/hash-chain.ts - the behaviour mutation testing (Stryker, 2026-10-23)
 * showed no test pinned: key resolution from the environment, the exact
 * canonical form a checksum is computed over, every redaction verdict, which
 * field set a stored checksum covers, and every accepted checksum formula.
 * Pure (no database): rows are built here with the writer's own formulas or an
 * independent re-implementation of them.
 */
import {
  getAuditChainKey, getAuditChainKeyedFrom, __setAuditChainKeyForTest, __setAuditChainKeyedFromForTest,
  computeChecksum, computeChecksumV2, computeChecksumV3, computeChainedChecksum, computeChainedChecksumV2, computeChainedChecksumV3,
  verifyRedactedRow, verifyAuditChecksum, checksumCoverage, type AuditChecksumRecord, type RedactionEvidence,
} from '../hash-chain.js';

const KEY = 'hc-mutation-key-0123456789abcdef';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const env = { key: process.env.AUDIT_CHAIN_KEY, from: process.env.AUDIT_CHAIN_KEYED_FROM };

afterEach(() => {
  if (env.key === undefined) delete process.env.AUDIT_CHAIN_KEY; else process.env.AUDIT_CHAIN_KEY = env.key;
  if (env.from === undefined) delete process.env.AUDIT_CHAIN_KEYED_FROM; else process.env.AUDIT_CHAIN_KEYED_FROM = env.from;
  __setAuditChainKeyForTest(undefined);
  __setAuditChainKeyedFromForTest(undefined);
});

describe('getAuditChainKey: AUDIT_CHAIN_KEY, trimmed, blank = no key, read once', () => {
  it.each([
    ['  s3cret  ', 's3cret'],
    ['k', 'k'],
    ['   ', null],
    ['', null],
  ])('%j -> %j', (raw, expected) => {
    process.env.AUDIT_CHAIN_KEY = raw;
    __setAuditChainKeyForTest(undefined);
    expect(getAuditChainKey()).toBe(expected);
  });

  it('unset -> null; the value is cached until reset', () => {
    delete process.env.AUDIT_CHAIN_KEY;
    __setAuditChainKeyForTest(undefined);
    expect(getAuditChainKey()).toBeNull();
    process.env.AUDIT_CHAIN_KEY = 'late';
    expect(getAuditChainKey()).toBeNull(); // cached
    __setAuditChainKeyForTest(undefined);
    expect(getAuditChainKey()).toBe('late');
  });
});

describe('getAuditChainKeyedFrom: AUDIT_CHAIN_KEYED_FROM, a whole non-negative position', () => {
  it.each([
    ['12', 12], ['12.9', 12], [' 7 ', 7], ['0', 0],
    ['-1', null], ['abc', null], ['', null], ['   ', null], ['Infinity', null],
  ])('%j -> %j', (raw, expected) => {
    process.env.AUDIT_CHAIN_KEYED_FROM = raw;
    __setAuditChainKeyedFromForTest(undefined);
    expect(getAuditChainKeyedFrom()).toBe(expected);
  });

  it('unset -> null; cached until reset', () => {
    delete process.env.AUDIT_CHAIN_KEYED_FROM;
    __setAuditChainKeyedFromForTest(undefined);
    expect(getAuditChainKeyedFrom()).toBeNull();
    process.env.AUDIT_CHAIN_KEYED_FROM = '40';
    expect(getAuditChainKeyedFrom()).toBeNull();
    __setAuditChainKeyedFromForTest(undefined);
    expect(getAuditChainKeyedFrom()).toBe(40);
  });
});

describe('V2 canonical form (what a stored checksum is computed over)', () => {
  it('sorts keys at every depth, keeps array order, renders scalars like JSON and undefined / functions as null', () => {
    const data = {
      z: [3, 'b', true, false, null, undefined, { y: 1, x: [2, 1] }, []],
      a: { d: 'q"uote', c: { b: 0, a: -1.5 } },
      m: undefined,
      f: () => 1,
      e: {},
    };
    const expected = '{"a":{"c":{"a":-1.5,"b":0},"d":"q\\"uote"},"e":{},"f":null,"m":null,'
      + '"z":[3,"b",true,false,null,null,{"x":[2,1],"y":1},[]]}';
    expect(computeChecksumV2(data)).toBe(sha256(expected));
    // Key order of the input never matters; value order inside arrays does.
    expect(computeChecksumV2({ e: {}, f: () => 1, m: undefined, a: { c: { a: -1.5, b: 0 }, d: 'q"uote' }, z: data.z })).toBe(sha256(expected));
    expect(computeChecksumV2({ ...data, z: [...data.z].reverse() })).not.toBe(sha256(expected));
  });

  it('V3 is an HMAC over the same form; the chained variants add previousChecksum', () => {
    const data = { b: 2, a: 1 };
    expect(computeChecksumV3(data, KEY)).toBe(createHmac('sha256', KEY).update('{"a":1,"b":2}').digest('hex'));
    expect(computeChainedChecksumV2(data, 'p')).toBe(sha256('{"a":1,"b":2,"previousChecksum":"p"}'));
    expect(computeChainedChecksumV2(data, null)).toBe(sha256('{"a":1,"b":2,"previousChecksum":null}'));
    expect(computeChainedChecksumV3(data, 'p', KEY)).toBe(createHmac('sha256', KEY).update('{"a":1,"b":2,"previousChecksum":"p"}').digest('hex'));
  });
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
const TS = '2026-09-01T08:00:00.000Z';
const BASE: AuditChecksumRecord = {
  timestamp: TS, userId: 'u1', userName: 'User One', userRole: 'QA', action: 'FILTER_RETIRED',
  targetType: 'filter', targetId: 'f-1', beforeValue: { a: 1 }, afterValue: { b: 2 }, reason: 'worn',
  ipAddress: '10.0.0.1', userAgent: 'ua', sessionId: 's-1', signatureMeaning: 'retired',
  checksum: '', previousChecksum: 'prev-1',
};
const expandedOf = (r: AuditChecksumRecord) => ({
  timestamp: r.timestamp, userId: r.userId ?? undefined, userName: r.userName ?? undefined, userRole: r.userRole ?? undefined,
  action: r.action, targetType: r.targetType ?? undefined, targetId: r.targetId ?? undefined,
  beforeValue: r.beforeValue ?? undefined, afterValue: r.afterValue ?? undefined, reason: r.reason ?? undefined,
  ipAddress: r.ipAddress ?? undefined, userAgent: r.userAgent ?? undefined, sessionId: r.sessionId ?? undefined,
  signatureMeaning: r.signatureMeaning ?? undefined,
  ...(r.signatureAuditId ? { signatureAuditId: r.signatureAuditId } : {}),
});
const reducedOf = (r: AuditChecksumRecord) => ({
  timestamp: r.timestamp, userId: r.userId ?? undefined, action: r.action,
  targetType: r.targetType ?? undefined, targetId: r.targetId ?? undefined, afterValue: r.afterValue ?? undefined,
});

describe('checksumCoverage: which field set, under which formula, a stored checksum covers', () => {
  it('EXPANDED (every persisted column) and REDUCED (the original six) are told apart; a changed column breaks only EXPANDED', () => {
    const expanded = { ...BASE, checksum: computeChainedChecksumV2(expandedOf(BASE), 'prev-1') };
    expect(checksumCoverage(expanded)).toBe('EXPANDED');
    expect(verifyAuditChecksum(expanded)).toBe(true);
    // Every non-null column is inside the expanded hash: change any one and it no longer matches.
    for (const k of ['userId', 'userName', 'userRole', 'targetType', 'targetId', 'reason', 'ipAddress', 'userAgent', 'sessionId', 'signatureMeaning'] as const) {
      expect(checksumCoverage({ ...expanded, [k]: 'changed' }), k).toBeNull();
    }
    expect(checksumCoverage({ ...expanded, beforeValue: { a: 9 } })).toBeNull();
    expect(checksumCoverage({ ...expanded, afterValue: { b: 9 } })).toBeNull();

    const reduced = { ...BASE, checksum: computeChainedChecksumV2(reducedOf(BASE), 'prev-1') };
    expect(checksumCoverage(reduced)).toBe('REDUCED');
    // The six reduced fields ARE covered; the rest (reason, userName ...) are not.
    for (const k of ['userId', 'targetType', 'targetId'] as const) expect(checksumCoverage({ ...reduced, [k]: 'changed' }), k).toBeNull();
    expect(checksumCoverage({ ...reduced, afterValue: { b: 9 } })).toBeNull();
    expect(checksumCoverage({ ...reduced, reason: 'rewritten', userName: 'x' })).toBe('REDUCED');
  });

  it('a signed row hashes its signatureAuditId; an unsigned row never has the key at all', () => {
    const signed = { ...BASE, signatureAuditId: 'sig-1' };
    const ok = { ...signed, checksum: computeChainedChecksumV2(expandedOf(signed), 'prev-1') };
    expect(checksumCoverage(ok)).toBe('EXPANDED');
    expect(checksumCoverage({ ...ok, signatureAuditId: 'sig-2' })).toBeNull();
    expect(checksumCoverage({ ...ok, signatureAuditId: null })).toBeNull();
  });

  it('chain rows: V2-chained and V1-chained are accepted; a wrong previousChecksum is not', () => {
    const v1 = { ...BASE, checksum: computeChainedChecksum(expandedOf(BASE), 'prev-1') };
    expect(checksumCoverage(v1)).toBe('EXPANDED');
    expect(checksumCoverage({ ...v1, previousChecksum: 'other' })).toBeNull();
    const v2 = { ...BASE, checksum: computeChainedChecksumV2(expandedOf(BASE), 'prev-1') };
    expect(checksumCoverage({ ...v2, previousChecksum: 'other' })).toBeNull();
  });

  it('genesis / pre-chain rows: each of the four accepted formulas verifies; a chain-formula row with no link does not', () => {
    const g = { ...BASE, previousChecksum: null };
    const f = expandedOf(g);
    for (const checksum of [computeChainedChecksumV2(f, null), computeChainedChecksum(f, null), computeChecksumV2(f), computeChecksum(f)]) {
      expect(checksumCoverage({ ...g, checksum })).toBe('EXPANDED');
    }
    expect(checksumCoverage({ ...g, checksum: computeChainedChecksumV2(f, 'prev-1') })).toBeNull();
    expect(checksumCoverage({ ...g, checksum: sha256('nothing') })).toBeNull();
  });

  it('genesis: the plain V2 formula is accepted on its own (a payload where V1 and V2 differ)', () => {
    // Nested keys out of sorted order: V1 keeps insertion order inside, V2 sorts it.
    const g = { ...BASE, previousChecksum: null, afterValue: { y: 1, x: 2 } };
    const f = expandedOf(g);
    expect(computeChecksumV2(f)).not.toBe(computeChecksum(f));
    expect(checksumCoverage({ ...g, checksum: computeChecksumV2(f) })).toBe('EXPANDED');
    expect(checksumCoverage({ ...g, checksum: computeChecksum(f) })).toBe('EXPANDED');
  });

  it('v3 rows need the key and an HMAC match - chained, genesis-chained, or genesis without the link key', () => {
    __setAuditChainKeyForTest(KEY);
    const v3 = { ...BASE, checksumVersion: 3, checksum: computeChainedChecksumV3(expandedOf(BASE), 'prev-1', KEY) };
    expect(checksumCoverage(v3)).toBe('EXPANDED');
    expect(checksumCoverage({ ...v3, reason: 'rewritten' })).toBeNull();
    expect(checksumCoverage({ ...v3, previousChecksum: 'other' })).toBeNull();
    const v3reduced = { ...BASE, checksumVersion: 3, checksum: computeChainedChecksumV3(reducedOf(BASE), 'prev-1', KEY) };
    expect(checksumCoverage(v3reduced)).toBe('REDUCED');
    expect(checksumCoverage({ ...v3reduced, targetId: 'x' })).toBeNull();

    const g = { ...BASE, previousChecksum: null, checksumVersion: 3 };
    expect(checksumCoverage({ ...g, checksum: computeChainedChecksumV3(expandedOf(g), null, KEY) })).toBe('EXPANDED');
    expect(checksumCoverage({ ...g, checksum: computeChecksumV3(expandedOf(g), KEY) })).toBe('EXPANDED');
    // An unkeyed formula is never accepted for a v3 row (that would be a downgrade).
    expect(checksumCoverage({ ...g, checksum: computeChecksumV2(expandedOf(g)) })).toBeNull();
    __setAuditChainKeyForTest(null);
    expect(checksumCoverage(v3)).toBeNull();
  });

  it('a Date timestamp is hashed as its ISO string', () => {
    const r = { ...BASE, checksum: computeChainedChecksumV2(expandedOf(BASE), 'prev-1') };
    expect(checksumCoverage({ ...r, timestamp: new Date(TS) })).toBe('EXPANDED');
  });
});

// ---------------------------------------------------------------------------
// Redaction verdicts
// ---------------------------------------------------------------------------
const REDACTED_AT = '2026-09-02T09:00:00.000Z';
const redacted: AuditChecksumRecord = {
  ...BASE, beforeValue: undefined, afterValue: undefined, checksum: 'c-1', previousChecksum: 'p-0', chainPosition: '41',
  checksumVersion: null, redactedAt: REDACTED_AT, redactedBy: 'sa-id', redactionReason: 'privacy',
};
const fullSnapshot = {
  snapshotVersion: 2, timestamp: TS, userId: 'u1', userName: 'User One', userRole: 'QA', action: 'FILTER_RETIRED',
  targetType: 'filter', targetId: 'f-1', reason: 'worn', ipAddress: '10.0.0.1', userAgent: 'ua', sessionId: 's-1',
  signatureMeaning: 'retired', signatureAuditId: null, checksum: 'c-1', previousChecksum: 'p-0', chainPosition: '41',
  checksumVersion: null, redactedAt: REDACTED_AT, redactedBy: 'sa-id', redactionReason: 'privacy',
};
const ev = (over: Partial<RedactionEvidence> = {}, snapshot: Record<string, unknown> = fullSnapshot): RedactionEvidence =>
  ({ snapshot, recordValid: true, recordCoversSnapshot: true, metaRowId: 'm-1', ...over });

describe('verifyRedactedRow: one verdict per case, checked in order', () => {
  it('a payload that came back is PAYLOAD_PRESENT (before OR after), before any record is consulted', () => {
    expect(verifyRedactedRow({ ...redacted, beforeValue: { a: 1 } }, ev())).toEqual({ verdict: 'PAYLOAD_PRESENT' });
    expect(verifyRedactedRow({ ...redacted, afterValue: { b: 2 } }, null)).toEqual({ verdict: 'PAYLOAD_PRESENT' });
  });

  it('no record -> NO_RECORD; a record that fails its own checksum -> RECORD_INVALID; one whose checksum does not cover the snapshot -> RECORD_UNTRUSTED', () => {
    expect(verifyRedactedRow(redacted, null)).toEqual({ verdict: 'NO_RECORD' });
    expect(verifyRedactedRow(redacted, undefined)).toEqual({ verdict: 'NO_RECORD' });
    expect(verifyRedactedRow(redacted, ev({ recordValid: false, recordCoversSnapshot: false }))).toEqual({ verdict: 'RECORD_INVALID' });
    expect(verifyRedactedRow(redacted, ev({ recordCoversSnapshot: false }))).toEqual({ verdict: 'RECORD_UNTRUSTED' });
  });

  it('a full (v2) record that matches is VERIFIED; every differing field is named, in field order', () => {
    expect(verifyRedactedRow(redacted, ev())).toEqual({ verdict: 'VERIFIED' });
    expect(verifyRedactedRow({ ...redacted, userId: 'mallory', redactionReason: 'x', chainPosition: '42' }, ev()))
      .toEqual({ verdict: 'MISMATCH', mismatchedFields: ['userId', 'chainPosition', 'redactionReason'] });
  });

  it('a legacy (5-field) record checks only its five fields: PARTIAL when they match, MISMATCH when one differs', () => {
    const legacy = { id: 'r', action: 'FILTER_RETIRED', timestamp: TS, userId: 'u1', targetType: 'filter', targetId: 'f-1' };
    // A field the legacy record never held (reason) is not compared.
    expect(verifyRedactedRow({ ...redacted, reason: 'rewritten' }, ev({}, legacy))).toEqual({ verdict: 'PARTIAL' });
    expect(verifyRedactedRow({ ...redacted, action: 'USER_LOGIN' }, ev({}, legacy))).toEqual({ verdict: 'MISMATCH', mismatchedFields: ['action'] });
    // snapshotVersion other than 2 is legacy too.
    expect(verifyRedactedRow({ ...redacted, reason: 'rewritten' }, ev({}, { ...fullSnapshot, snapshotVersion: 1 }))).toEqual({ verdict: 'PARTIAL' });
  });

  it('normalisation: absent = null, times compare as instants (Date or ISO), other values as text', () => {
    // signatureAuditId: null in the record, absent on the row -> equal.
    expect(verifyRedactedRow({ ...redacted, signatureAuditId: undefined }, ev())).toEqual({ verdict: 'VERIFIED' });
    // The same instant as a Date and as an ISO string, for BOTH time fields.
    expect(verifyRedactedRow({ ...redacted, timestamp: new Date(TS), redactedAt: new Date(REDACTED_AT) }, ev())).toEqual({ verdict: 'VERIFIED' });
    // A number and its text are the same value; a different instant is not.
    expect(verifyRedactedRow({ ...redacted, chainPosition: 41n }, ev())).toEqual({ verdict: 'VERIFIED' });
    expect(verifyRedactedRow({ ...redacted, timestamp: '2026-09-01T08:00:01.000Z' }, ev())).toEqual({ verdict: 'MISMATCH', mismatchedFields: ['timestamp'] });
    // An unparseable time is compared as text, not dropped.
    expect(verifyRedactedRow({ ...redacted, redactedAt: 'not-a-date' }, ev({}, { ...fullSnapshot, redactedAt: 'not-a-date' }))).toEqual({ verdict: 'VERIFIED' });
    expect(verifyRedactedRow({ ...redacted, redactedAt: 'not-a-date' }, ev({}, { ...fullSnapshot, redactedAt: 'also-not' })).verdict).toBe('MISMATCH');
    // null on one side and a value on the other differ.
    expect(verifyRedactedRow({ ...redacted, reason: null }, ev())).toEqual({ verdict: 'MISMATCH', mismatchedFields: ['reason'] });
    // Only the two time fields compare as instants: two different texts naming
    // the same instant are DIFFERENT values anywhere else.
    expect(verifyRedactedRow({ ...redacted, userId: '2026-09-01' }, ev({}, { ...fullSnapshot, userId: '2026-09-01T00:00:00.000Z' })))
      .toEqual({ verdict: 'MISMATCH', mismatchedFields: ['userId'] });
  });

  it('verifyAuditChecksum on a redacted row: valid exactly for VERIFIED and PARTIAL', () => {
    const legacy = { id: 'r', action: 'FILTER_RETIRED', timestamp: TS, userId: 'u1', targetType: 'filter', targetId: 'f-1' };
    expect(verifyAuditChecksum(redacted, ev())).toBe(true);
    expect(verifyAuditChecksum(redacted, ev({}, legacy))).toBe(true);
    expect(verifyAuditChecksum({ ...redacted, userId: 'x' }, ev())).toBe(false);
    expect(verifyAuditChecksum(redacted, null)).toBe(false);
    expect(verifyAuditChecksum(redacted)).toBe(false);
    expect(verifyAuditChecksum(redacted, ev({ recordValid: false }))).toBe(false);
    expect(verifyAuditChecksum(redacted, ev({ recordCoversSnapshot: false }))).toBe(false);
    expect(verifyAuditChecksum({ ...redacted, afterValue: { b: 2 } }, ev())).toBe(false);
  });
});
