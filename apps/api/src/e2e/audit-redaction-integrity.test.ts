/**
 * Security assessment P1 (2026-10-22): a redacted audit row escaped tamper
 * detection. verifyAuditChecksum held a redacted row only to "both payloads are
 * NULL"; who / what / when (user, action, timestamp, target, reason, …) were not
 * checked, and audit_trail has no UPDATE trigger. A DB-level actor could set
 * redacted_at on ANY row, null its payload, rewrite the rest - and verify-chain
 * passed, keyed chain or not.
 *
 * The fix: the redaction's own meta row (AUDIT_RECORD_REDACTED /
 * AUDIT_RECORDS_BULK_REDACTED), itself hash-chained, records every non-payload
 * field of the row it redacted; verification checks the row against it. A
 * redacted row with no such record is reported, never passed as valid.
 *
 * Real Fastify + Prisma on digilog_test_db. Every forged row is this file's own
 * fresh row and is restored column-for-column in `finally`, so the shared chain
 * is left exactly as it was. (The keyed-chain variant is a unit test on crafted
 * rows - v3 rows written here would be unverifiable for every other process.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { verifyAuditChain } from '../lib/audit-verify.js';
import { verifyAuditChecksum } from '../lib/hash-chain.js';
import { runSuffix, createUser, login, deleteUsers } from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `cv_redact_${SUF}`.toLowerCase();
const PW = 'CovRedact@2026x';
const REASON = 'coverage: redaction integrity';

let app: FastifyInstance;
let token = '';
let saId = '';

type RawRow = Record<string, any>;
const COLS = `id, timestamp, user_id, user_name, user_role, action, target_type, target_id, before_value, after_value,
  reason, ip_address, user_agent, session_id, signature_meaning, signature_audit_id, checksum, previous_checksum,
  chain_position, checksum_version, redacted_at, redacted_by, redaction_reason`;
const raw = async (id: string): Promise<RawRow> => (await prisma.$queryRawUnsafe<RawRow[]>(`SELECT ${COLS} FROM audit_trail WHERE id = $1::uuid`, id))[0];

/** Put every mutable column of a row back exactly as it was. */
const restore = async (s: RawRow) => {
  await prisma.$executeRawUnsafe(
    `UPDATE audit_trail SET timestamp = $2, user_id = $3, user_name = $4, user_role = $5, action = $6, target_type = $7,
       target_id = $8, before_value = $9::jsonb, after_value = $10::jsonb, reason = $11, redacted_at = $12, redacted_by = $13,
       redaction_reason = $14 WHERE id = $1::uuid`,
    s.id, s.timestamp, s.user_id, s.user_name, s.user_role, s.action, s.target_type, s.target_id,
    s.before_value == null ? null : JSON.stringify(s.before_value), s.after_value == null ? null : JSON.stringify(s.after_value),
    s.reason, s.redacted_at, s.redacted_by, s.redaction_reason,
  );
};

/** A fresh, ordinary audit row of this file's own. */
const freshRow = async (tag: string) =>
  auditLog({
    userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'CV_REDACTION_PROBE', targetType: 'probe', targetId: `${SUF}-${tag}`,
    beforeValue: { secret: `before-${tag}` }, afterValue: { secret: `after-${tag}` }, reason: `probe ${tag}`,
    ipAddress: '10.9.8.7', userAgent: 'vitest', sessionId: `sess-${SUF}`,
    signatureMeaning: `probe row ${tag}`,
  });

/** Per-row anomalies the chain walk reports for these rows (link / gap kinds are about neighbours). */
const rowAnomalies = async (ids: string[]) => {
  const rows = await Promise.all(ids.map(raw));
  const positions = rows.map((r) => Number(r.chain_position));
  const res = await verifyAuditChain({ fromPosition: Math.min(...positions), toPosition: Math.max(...positions) });
  return res.anomalies.filter((a) => ids.includes(a.id) && a.kind !== 'CHAIN_LINK_MISMATCH' && a.kind !== 'CHAIN_POSITION_GAP');
};
const metaFor = (id: string) => prisma.auditTrail.findFirst({ where: { action: 'AUDIT_RECORD_REDACTED', targetId: id }, orderBy: { chainPosition: 'desc' } });
const redactViaApi = (id: string, reason = REASON) => app.inject({
  method: 'POST', url: `/api/audit/${id}/redact`, payload: { reason },
  headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PW },
});
const detailValid = async (id: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/audit/${id}`, headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode).toBe(200);
  return res.json().integrityValid as boolean;
};

beforeAll(async () => {
  app = await buildApp();
  saId = await createUser(SA, 'SUPER_ADMIN', PW);
  token = await login(app, SA, PW);
}, 120_000);

afterAll(async () => {
  try { await deleteUsers([saId]); } finally { await app?.close(); }
}, 120_000);

describe('P1 reproduction: a row "redacted" directly in the database', () => {
  it('a forged redaction that rewrites who/what is NOT accepted (no redaction record exists for it)', async () => {
    const id = await freshRow('forge');
    const original = await raw(id);
    try {
      // The attack: set redacted_at, null the payload, rewrite the actor and the action.
      await prisma.$executeRawUnsafe(
        `UPDATE audit_trail SET redacted_at = now(), before_value = NULL, after_value = NULL,
           user_id = 'someone-else', user_name = 'someone-else', action = 'USER_LOGIN' WHERE id = $1::uuid`, id);
      const forged = await raw(id);

      const anomalies = await rowAnomalies([id]);
      expect(anomalies.map((a) => [a.kind, a.informational ?? false])).toEqual([['REDACTION_UNRECORDED', false]]);
      const res = await verifyAuditChain({ fromPosition: Number(forged.chain_position), toPosition: Number(forged.chain_position) });
      expect(res.intact).toBe(false);

      // The per-row verifier on its own (no redaction evidence) must not call it valid either.
      expect(verifyAuditChecksum({
        timestamp: forged.timestamp, userId: forged.user_id, userName: forged.user_name, userRole: forged.user_role,
        action: forged.action, targetType: forged.target_type, targetId: forged.target_id, reason: forged.reason,
        checksum: forged.checksum, previousChecksum: forged.previous_checksum, redactedAt: forged.redacted_at,
      })).toBe(false);
      expect(await detailValid(id)).toBe(false);
    } finally {
      await restore(original);
    }
    expect(await rowAnomalies([id])).toEqual([]);
  });
});

describe('a legitimate redaction is verifiable, and tampering with it afterwards is caught', () => {
  it('the redaction record carries every non-payload field of the row; the redacted row verifies against it', async () => {
    const id = await freshRow('legit');
    const before = await raw(id);
    const res = await redactViaApi(id);
    expect(res.statusCode, res.body).toBe(200);

    const after = await raw(id);
    expect(after).toMatchObject({ before_value: null, after_value: null, redacted_by: saId, redaction_reason: REASON });
    const meta = await metaFor(id);
    expect(meta).not.toBeNull();
    expect(meta!.beforeValue).toMatchObject({
      snapshotVersion: 2, id, action: 'CV_REDACTION_PROBE', userId: SA, userName: SA, userRole: 'SUPER_ADMIN',
      targetType: 'probe', targetId: `${SUF}-legit`, reason: 'probe legit', ipAddress: '10.9.8.7', userAgent: 'vitest',
      sessionId: `sess-${SUF}`, signatureMeaning: 'probe row legit', checksum: before.checksum, previousChecksum: before.previous_checksum,
      chainPosition: String(before.chain_position), timestamp: new Date(before.timestamp).toISOString(),
      redactedBy: saId, redactionReason: REASON, redactedAt: new Date(after.redacted_at).toISOString(),
    });
    // The payload itself is NOT copied into the record of its removal.
    expect(JSON.stringify(meta!.beforeValue)).not.toContain('before-legit');
    expect(JSON.stringify(meta!.beforeValue)).not.toContain('after-legit');

    expect(await rowAnomalies([id, meta!.id])).toEqual([]);
    expect(await detailValid(id)).toBe(true);
    const list = await app.inject({ method: 'GET', url: `/api/audit?search=${SUF}-legit&limit=50`, headers: { authorization: `Bearer ${token}` } });
    expect(list.json().data.find((r: any) => r.id === id)).toMatchObject({ integrityValid: true });
  });

  it.each([
    ['the actor', `user_id = 'mallory'`],
    ['the action', `action = 'USER_LOGIN'`],
    ['the timestamp', `timestamp = timestamp - interval '1 day'`],
    ['the target', `target_id = 'elsewhere'`],
    ['the row\'s reason', `reason = 'nothing to see'`],
    ['who redacted it', `redacted_by = 'someone-else'`],
    ['why it was redacted', `redaction_reason = 'forged reason'`],
  ])('rewriting %s of a legitimately redacted row is caught', async (_what, setSql) => {
    const id = await freshRow(`t-${_what.replace(/\W+/g, '')}`);
    expect((await redactViaApi(id)).statusCode).toBe(200);
    const redacted = await raw(id);
    const metaId = (await metaFor(id))!.id;
    try {
      await prisma.$executeRawUnsafe(`UPDATE audit_trail SET ${setSql} WHERE id = $1::uuid`, id);
      const anomalies = await rowAnomalies([id, metaId]);
      expect(anomalies.map((a) => [a.id, a.kind, a.informational ?? false])).toEqual([[id, 'REDACTED_ROW_MISMATCH', false]]);
      expect(await detailValid(id)).toBe(false);
    } finally {
      await restore(redacted);
    }
    expect(await rowAnomalies([id, metaId])).toEqual([]);
  });
});

describe('redactions made before this fix (5-field record)', () => {
  it('verifies the fields that record holds and says, informationally, that the rest cannot be verified', async () => {
    const id = await freshRow('legacy');
    const original = await raw(id);
    try {
      // Exactly what the redact handler wrote until 2026-10-22.
      await prisma.$executeRawUnsafe(
        `UPDATE audit_trail SET before_value = NULL, after_value = NULL, redacted_at = now(), redacted_by = $2, redaction_reason = 'legacy' WHERE id = $1::uuid`,
        id, saId);
      const metaId = await auditLog({
        userId: SA, userRole: 'SUPER_ADMIN', action: 'AUDIT_RECORD_REDACTED', targetType: 'audit_trail', targetId: id,
        beforeValue: { id, action: original.action, timestamp: original.timestamp, userId: original.user_id, targetType: original.target_type, targetId: original.target_id },
        reason: 'legacy', signatureMeaning: `Audit record ${id} payload redacted; chain link preserved`,
      });
      const anomalies = await rowAnomalies([id, metaId]);
      expect(anomalies.map((a) => [a.id, a.kind, a.informational ?? false])).toEqual([[id, 'REDACTION_PARTIALLY_VERIFIED', true]]);
      expect(await detailValid(id)).toBe(true);

      // A field the old record DID hold is still checked.
      await prisma.$executeRawUnsafe(`UPDATE audit_trail SET action = 'USER_LOGIN' WHERE id = $1::uuid`, id);
      expect((await rowAnomalies([id, metaId])).map((a) => [a.kind, a.informational ?? false])).toEqual([['REDACTED_ROW_MISMATCH', false]]);
    } finally {
      await restore(original);
    }
  });
});

describe('the record of a redaction is itself protected', () => {
  it('a redaction meta row cannot be redacted (single or bulk)', async () => {
    const id = await freshRow('meta');
    expect((await redactViaApi(id)).statusCode).toBe(200);
    const metaId = (await metaFor(id))!.id;
    const single = await redactViaApi(metaId);
    expect(single.statusCode).toBe(409);
    expect(single.json().error).toBe('META_AUDIT_IMMUTABLE');
    const other = await freshRow('meta2');
    const bulk = await app.inject({
      method: 'POST', url: '/api/audit/bulk-redact', payload: { ids: [other, metaId], reason: REASON },
      headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PW },
    });
    expect(bulk.statusCode).toBe(409);
    expect(bulk.json().error).toBe('META_AUDIT_IMMUTABLE');
    expect((await raw(other)).redacted_at).toBeNull(); // nothing redacted
    expect((await raw(metaId)).redacted_at).toBeNull();
  });

  // 2026-10-22 (approved with P1): EVERY record of a change to the audit trail is
  // refused - the same five actions the edit refusal (PUT /api/audit/:id) uses.
  // An AUDIT_RECORD_DELETED row's beforeValue is the only surviving copy of the
  // row it deleted; redacting it would erase that copy.
  it.each(['AUDIT_RECORD_DELETED', 'AUDIT_RECORDS_BULK_DELETED', 'AUDIT_RECORD_UPDATED'])(
    'a %s row cannot be redacted either (single or bulk), and its payload survives', async (action) => {
      const surviving = { survivingCopy: `probe-${action}-${SUF}` };
      const metaId = await auditLog({
        userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action, targetType: 'audit_trail', targetId: `${SUF}-${action}`,
        beforeValue: surviving, reason: 'coverage probe: the record of an audit-trail change',
        ipAddress: '10.9.8.7', userAgent: 'vitest', sessionId: `sess-${SUF}`,
      });
      const single = await redactViaApi(metaId);
      expect(single.statusCode, single.body).toBe(409);
      expect(single.json().error).toBe('META_AUDIT_IMMUTABLE');

      const other = await freshRow(`meta-${action}`);
      const bulk = await app.inject({
        method: 'POST', url: '/api/audit/bulk-redact', payload: { ids: [other, metaId], reason: REASON },
        headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PW },
      });
      expect(bulk.statusCode, bulk.body).toBe(409);
      expect(bulk.json().error).toBe('META_AUDIT_IMMUTABLE');
      expect((await raw(other)).redacted_at).toBeNull(); // the whole request was refused
      const after = await raw(metaId);
      expect(after.redacted_at).toBeNull();
      expect(after.before_value).toEqual(surviving);
    });

  it('bulk redaction records a full snapshot of every row it redacts', async () => {
    const a = await freshRow('bulk-a');
    const b = await freshRow('bulk-b');
    const res = await app.inject({
      method: 'POST', url: '/api/audit/bulk-redact', payload: { ids: [a, b], reason: REASON },
      headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PW },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().count).toBe(2);
    const meta = await prisma.auditTrail.findFirst({ where: { action: 'AUDIT_RECORDS_BULK_REDACTED', beforeValue: { path: ['records'], array_contains: [{ id: a }] } }, orderBy: { chainPosition: 'desc' } });
    expect(meta).not.toBeNull();
    const records = (meta!.beforeValue as any).records as any[];
    expect(records.map((r) => r.id).sort()).toEqual([a, b].sort());
    for (const r of records) expect(r).toMatchObject({ snapshotVersion: 2, userName: SA, reason: expect.stringMatching(/^probe bulk-/), redactionReason: REASON });
    expect(await rowAnomalies([a, b, meta!.id])).toEqual([]);
  });

  it('two simultaneous redactions of one row: exactly one succeeds and exactly one record is written', async () => {
    const id = await freshRow('race');
    const results = await Promise.all(Array.from({ length: 6 }, () => redactViaApi(id)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error === 'ALREADY_REDACTED')).toBe(true);
    expect(await prisma.auditTrail.count({ where: { action: 'AUDIT_RECORD_REDACTED', targetId: id } })).toBe(1);
    expect(await rowAnomalies([id])).toEqual([]);
  });
});
