import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Security assessment P1 (2026-10-22) - redacted audit rows and their evidence.
 * Pure: crafted rows only (no database). The real-database reproduction is
 * e2e/audit-redaction-integrity.test.ts; the keyed-chain case lives HERE because
 * v3 rows written to the shared test DB are unverifiable for every other process.
 */
vi.mock('../prisma.js', () => ({ prisma: {} }));

import {
  verifyAuditChecksum, verifyRedactedRow, checksumCoverage, computeChainedChecksumV2, computeChainedChecksumV3,
  __setAuditChainKeyForTest, type AuditChecksumRecord, type RedactionEvidence,
} from '../hash-chain.js';
import {
  redactionSnapshot, buildRedactionIndex, evidenceFor, rawRowToChecksumRecord,
  AUDIT_META_ACTIONS, REDACTION_META_ACTIONS, isRedactionMetaAction,
} from '../audit-redaction.js';

const KEY = 'p1-test-audit-chain-key-0123456789';
const TS = '2026-10-01T08:00:00.000Z';
const REDACTED_AT = new Date('2026-10-02T09:00:00.000Z');

/** Every persisted column of a row, as the writer hashes them (expanded set). */
const expanded = (r: Record<string, unknown>) => ({
  timestamp: r.timestamp, userId: r.user_id ?? undefined, userName: r.user_name ?? undefined, userRole: r.user_role ?? undefined,
  action: r.action, targetType: r.target_type ?? undefined, targetId: r.target_id ?? undefined, beforeValue: r.before_value ?? undefined,
  afterValue: r.after_value ?? undefined, reason: r.reason ?? undefined, ipAddress: r.ip_address ?? undefined, userAgent: r.user_agent ?? undefined,
  sessionId: r.session_id ?? undefined, signatureMeaning: r.signature_meaning ?? undefined,
});
const reduced = (r: Record<string, unknown>) => ({
  timestamp: r.timestamp, userId: r.user_id ?? undefined, action: r.action, targetType: r.target_type ?? undefined,
  targetId: r.target_id ?? undefined, afterValue: r.after_value ?? undefined,
});

/** An ordinary row, checksummed over the expanded set (or HMAC'd when keyed). */
function rawRow(id: string, position: number, prev: string, over: Record<string, unknown> = {}, keyed = false) {
  const r: Record<string, unknown> = {
    id, chain_position: BigInt(position), timestamp: TS, user_id: 'alice', user_name: 'alice', user_role: 'OPERATOR',
    action: 'FILTER_RETIRED', target_type: 'filter', target_id: 'f-1', before_value: { a: 1 }, after_value: { b: 2 },
    reason: 'worn', ip_address: '10.0.0.1', user_agent: 'ua', session_id: 's-1', signature_meaning: 'retired',
    signature_audit_id: null, previous_checksum: prev, redacted_at: null, redacted_by: null, redaction_reason: null,
    checksum_version: keyed ? 3 : null, ...over,
  };
  r.checksum = keyed ? computeChainedChecksumV3(expanded(r), prev, KEY) : computeChainedChecksumV2(expanded(r), prev);
  return r;
}
/** The redact handler's effect on a row: payload gone, redaction columns set, checksum kept. */
const redact = (r: Record<string, unknown>) => ({ ...r, before_value: null, after_value: null, redacted_at: REDACTED_AT, redacted_by: 'sa-uuid', redaction_reason: 'privacy' });
/** A redaction meta row for `target`, its own checksum valid (expanded, or reduced = pre-2026-07-04). */
function metaRow(id: string, position: number, prev: string, beforeValue: unknown, over: Record<string, unknown> = {}, coverage: 'expanded' | 'reduced' = 'expanded') {
  const r: Record<string, unknown> = {
    id, chain_position: BigInt(position), timestamp: '2026-10-02T09:00:00.000Z', user_id: 'sa', user_name: null, user_role: 'SUPER_ADMIN',
    action: 'AUDIT_RECORD_REDACTED', target_type: 'audit_trail', target_id: null, before_value: beforeValue, after_value: null,
    reason: 'privacy', ip_address: null, user_agent: null, session_id: null, signature_meaning: null, signature_audit_id: null,
    previous_checksum: prev, redacted_at: null, checksum_version: null, ...over,
  };
  r.checksum = computeChainedChecksumV2(coverage === 'expanded' ? expanded(r) : reduced(r), prev);
  return r;
}

afterEach(() => __setAuditChainKeyForTest(undefined));

describe('P1 reproduction on a KEYED chain (crafted v3 rows)', () => {
  it('a v3 row marked redacted with its who/what rewritten is not valid without a matching redaction record', () => {
    __setAuditChainKeyForTest(KEY);
    const original = rawRow('r1', 10, 'p9', {}, true);
    expect(verifyAuditChecksum(rawRowToChecksumRecord(original))).toBe(true); // a sound keyed row
    // The attack: no key needed - just mark it redacted and rewrite the rest.
    const forged = { ...redact(original), user_id: 'mallory', action: 'USER_LOGIN' };
    // Before 2026-10-22 the redaction branch returned true here, ahead of the HMAC path.
    expect(verifyAuditChecksum(rawRowToChecksumRecord(forged))).toBe(false);
    expect(verifyRedactedRow(rawRowToChecksumRecord(forged), null).verdict).toBe('NO_RECORD');
  });
});

describe('verifyRedactedRow verdicts', () => {
  const row = rawRow('r1', 10, 'p9');
  const snap = redactionSnapshot(row, { redactedAt: REDACTED_AT, redactedBy: 'sa-uuid', redactionReason: 'privacy' });
  const ev = (snapshot: Record<string, unknown>, o: Partial<RedactionEvidence> = {}): RedactionEvidence =>
    ({ snapshot, recordValid: true, recordCoversSnapshot: true, metaRowId: 'm', ...o });
  const rec = (r: Record<string, unknown>) => rawRowToChecksumRecord(r);

  it('VERIFIED when every recorded field matches; the payload is never in the record', () => {
    expect(verifyRedactedRow(rec(redact(row)), ev(snap))).toEqual({ verdict: 'VERIFIED' });
    expect(JSON.stringify(snap)).not.toMatch(/"a":1|"b":2/);
  });

  it('MISMATCH names every rewritten field, including the redaction\'s own columns', () => {
    const tampered = { ...redact(row), user_name: 'bob', redacted_by: 'someone', redaction_reason: 'other', chain_position: 11n };
    expect(verifyRedactedRow(rec(tampered), ev(snap))).toEqual({ verdict: 'MISMATCH', mismatchedFields: ['userName', 'chainPosition', 'redactedBy', 'redactionReason'] });
  });

  it('PAYLOAD_PRESENT / NO_RECORD / RECORD_INVALID / RECORD_UNTRUSTED', () => {
    expect(verifyRedactedRow(rec({ ...redact(row), after_value: { b: 2 } }), ev(snap)).verdict).toBe('PAYLOAD_PRESENT');
    expect(verifyRedactedRow(rec(redact(row)), undefined).verdict).toBe('NO_RECORD');
    expect(verifyRedactedRow(rec(redact(row)), ev(snap, { recordValid: false })).verdict).toBe('RECORD_INVALID');
    expect(verifyRedactedRow(rec(redact(row)), ev(snap, { recordCoversSnapshot: false })).verdict).toBe('RECORD_UNTRUSTED');
  });

  it('PARTIAL for a pre-2026-10-22 record: its five fields are checked, the rest cannot be', () => {
    const legacy = { id: 'r1', action: 'FILTER_RETIRED', timestamp: TS, userId: 'alice', targetType: 'filter', targetId: 'f-1' };
    expect(verifyRedactedRow(rec({ ...redact(row), user_name: 'anything' }), ev(legacy)).verdict).toBe('PARTIAL');
    expect(verifyRedactedRow(rec({ ...redact(row), target_id: 'f-2' }), ev(legacy))).toEqual({ verdict: 'MISMATCH', mismatchedFields: ['targetId'] });
  });

  it('normalises representations: Date vs ISO string, bigint vs string position, null vs absent', () => {
    const r = { ...redact(row), timestamp: new Date(TS), chain_position: '10', redacted_at: REDACTED_AT.toISOString(), signature_audit_id: undefined };
    expect(verifyRedactedRow(rec(r), ev(snap)).verdict).toBe('VERIFIED');
  });
});

describe('buildRedactionIndex / evidenceFor', () => {
  const a = rawRow('a', 10, 'p9');
  const b = rawRow('b', 11, a.checksum as string);
  const snapA = redactionSnapshot(a, { redactedAt: REDACTED_AT, redactedBy: 'sa-uuid', redactionReason: 'privacy' });
  const snapB = redactionSnapshot(b, { redactedAt: REDACTED_AT, redactedBy: 'sa-uuid', redactionReason: 'privacy' });

  it('indexes single and bulk records, ignores other rows and redacted records, and checks each record\'s own checksum', () => {
    const single = metaRow('m1', 12, 'x', snapA, { target_id: 'a' });
    const bulk = metaRow('m2', 13, 'y', { recordCount: 1, records: [snapB] }, { action: 'AUDIT_RECORDS_BULK_REDACTED' });
    const forgedRecord = { ...metaRow('m3', 14, 'z', snapA, { target_id: 'a' }), user_id: 'mallory' }; // edited after writing
    const preCoverage = metaRow('m4', 15, 'w', snapB, { target_id: 'b' }, 'reduced');
    const redactedRecord = { ...metaRow('m5', 16, 'v', snapA, { target_id: 'a' }), before_value: null, redacted_at: REDACTED_AT };
    const index = buildRedactionIndex([a, b, single, bulk, forgedRecord, preCoverage, redactedRecord]);

    expect([...index.keys()].sort()).toEqual(['a', 'b']);
    expect(index.get('a')!.map((e) => [e.metaRowId, e.recordValid, e.recordCoversSnapshot])).toEqual([['m1', true, true], ['m3', false, false]]);
    expect(index.get('b')!.map((e) => [e.metaRowId, e.recordValid, e.recordCoversSnapshot])).toEqual([['m2', true, true], ['m4', true, false]]);
    expect(checksumCoverage(rawRowToChecksumRecord(preCoverage))).toBe('REDUCED');

    // Latest record after the row wins (deterministic when a pre-fix race left several).
    expect(evidenceFor(index, 'a', 10n)?.metaRowId).toBe('m3');
    expect(evidenceFor(index, 'b', '11')?.metaRowId).toBe('m4');
    // A record cannot predate what it redacts.
    expect(evidenceFor(index, 'a', 20)).toBeNull();
    expect(evidenceFor(index, 'nope', 1)).toBeNull();
  });

  it('only REDACTION records are evidence: the record of an edit or a deletion is never read as one', () => {
    // Shaped exactly like redaction records (target_id + snapshot; records[]), but they record an
    // edit / a deletion. Refused for redaction like a redaction record, yet never evidence.
    const edit = metaRow('m6', 17, 'u', snapA, { action: 'AUDIT_RECORD_UPDATED', target_id: 'a' });
    const del = metaRow('m7', 18, 't', snapA, { action: 'AUDIT_RECORD_DELETED', target_id: 'a' });
    const bulkDel = metaRow('m8', 19, 's', { recordCount: 1, records: [snapB] }, { action: 'AUDIT_RECORDS_BULK_DELETED' });
    expect(buildRedactionIndex([edit, del, bulkDel]).size).toBe(0);
  });

  it('every record of a change to the audit trail is refused for redaction; ordinary rows are not', () => {
    expect([...AUDIT_META_ACTIONS].sort()).toEqual([
      'AUDIT_RECORDS_BULK_DELETED', 'AUDIT_RECORDS_BULK_REDACTED', 'AUDIT_RECORD_DELETED', 'AUDIT_RECORD_REDACTED', 'AUDIT_RECORD_UPDATED',
    ]);
    for (const action of AUDIT_META_ACTIONS) expect(isRedactionMetaAction(action)).toBe(true);
    for (const action of REDACTION_META_ACTIONS) expect(AUDIT_META_ACTIONS).toContain(action);
    for (const action of ['FILTER_RETIRED', 'USER_LOGIN', 'MANUAL_RECORD_DELETED', '', null, undefined]) {
      expect(isRedactionMetaAction(action as string | null | undefined)).toBe(false);
    }
  });

  it('is exactly the list the EDIT refusal uses (modules/audit/routes.ts PUT /:id)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../modules/audit/routes.ts', import.meta.url)), 'utf-8');
    const m = src.match(/const META_AUDIT_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
    expect(m, 'the edit refusal list was not found in audit/routes.ts').not.toBeNull();
    const editList = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect([...AUDIT_META_ACTIONS].sort()).toEqual(editList);
  });

  it('end to end: a sound redaction verifies; with a tampered record it does not', () => {
    const index = buildRedactionIndex([metaRow('m1', 12, 'x', snapA, { target_id: 'a' })]);
    const r: AuditChecksumRecord = rawRowToChecksumRecord(redact(a));
    expect(verifyAuditChecksum(r, evidenceFor(index, 'a', 10n))).toBe(true);
    const bad = buildRedactionIndex([{ ...metaRow('m1', 12, 'x', snapA, { target_id: 'a' }), reason: 'edited' }]);
    expect(verifyRedactedRow(r, evidenceFor(bad, 'a', 10n)).verdict).toBe('RECORD_INVALID');
  });
});
