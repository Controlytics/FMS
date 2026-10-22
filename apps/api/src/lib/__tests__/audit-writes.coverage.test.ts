/**
 * auditLog (lib/audit.ts) — what the hash-chained writer actually stores.
 *
 * Real Prisma on digilog_test_db: rows are found by the unique targetId this
 * file stamps, and each chain link is checked against the row immediately
 * before it in chain order (never "the whole chain is valid"; other suites
 * write between our calls). Rows written here stay, like every audit row (§11;
 * the no-delete trigger is never touched). Whether those rows are keyed (V3)
 * follows the environment's AUDIT_CHAIN_KEY, exactly as in production.
 *
 * The keyed-vs-unkeyed choice and the genesis case are checked through a
 * stand-in transaction client, which lets the test fix the key and the
 * predecessor instead of inheriting them from the shared chain.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import { auditLog, boundSignatureMeaning, SIGNATURE_MEANING_MAX } from '../audit.js';
import { runWithRequestStore } from '../request-store.js';
import {
  verifyAuditChecksum, computeChainedChecksumV3, computeChainedChecksumV2, __setAuditChainKeyForTest, getAuditChainKey,
} from '../hash-chain.js';

const RUN = randomUUID().slice(0, 8);
const target = (n: string) => `cvl-${RUN}-${n}`;
const byTarget = (t: string) => prisma.auditTrail.findFirst({ where: { targetId: t } });
async function linkedToPredecessor(row: { chainPosition: bigint | null; previousChecksum: string | null }) {
  const prior = await prisma.auditTrail.findFirst({ where: { chainPosition: { lt: row.chainPosition! } }, orderBy: { chainPosition: 'desc' } });
  return row.previousChecksum === prior?.checksum;
}
const verifies = (r: any) => verifyAuditChecksum({ ...r, checksumVersion: r.checksumVersion });

afterEach(() => { __setAuditChainKeyForTest(undefined); });

describe('auditLog — attribution and timestamps', () => {
  it('refuses a user action with no user (§11.10(e))', async () => {
    await expect(auditLog({ action: 'CVL_ANONYMOUS_EDIT', targetType: 'cvl', targetId: target('anon') }))
      .rejects.toThrow("audit.userId required for action='CVL_ANONYMOUS_EDIT'");
    expect(await byTarget(target('anon'))).toBeNull();
  });

  it('allows an allow-listed system action without a user, as a valid chained row', async () => {
    const id = await auditLog({ action: 'SYSTEM_HEALTH_CHECK', targetType: 'cvl', targetId: target('sys'), afterValue: { ok: true } });
    const row = await byTarget(target('sys'));
    expect(row!.id).toBe(id);
    expect(row).toMatchObject({ userId: null, action: 'SYSTEM_HEALTH_CHECK', checksumVersion: getAuditChainKey() ? 3 : null, signatureAuditId: null });
    expect(verifies(row)).toBe(true);
    expect(await linkedToPredecessor(row!)).toBe(true);
  });

  it('stores a back-dated record with that date, inside the checksum', async () => {
    const when = '2025-12-31T23:59:58.000Z';
    await auditLog({ userId: 'cvl_user', userRole: 'OPERATOR', action: 'MANUAL_RECORD_CREATED', targetType: 'cvl', targetId: target('dated'), timestamp: when, reason: 'entered from paper', beforeValue: { a: 1, skip: undefined }, afterValue: { b: [1, { c: undefined }] } });
    const row = await byTarget(target('dated'));
    expect(row!.timestamp.toISOString()).toBe(when);
    expect(row!.beforeValue).toEqual({ a: 1 });
    expect(row!.afterValue).toEqual({ b: [1, {}] });
    expect(verifies(row)).toBe(true);
    // Changing the stored date breaks verification: the date is covered.
    expect(verifies({ ...row, timestamp: new Date('2026-01-01T00:00:00Z') })).toBe(false);
  });

  it('refuses an unparseable timestamp', async () => {
    await expect(auditLog({ userId: 'cvl_user', action: 'CVL_X', targetId: target('baddate'), timestamp: 'yesterday-ish' }))
      .rejects.toThrow("audit.timestamp is not a valid date for action='CVL_X'");
  });

  it('bounds an over-long signature meaning before hashing and storing it', async () => {
    const long = `Approved ${'x'.repeat(400)} by the reviewer`;
    await auditLog({ userId: 'cvl_user', action: 'CVL_SIGNED', targetId: target('meaning'), signatureMeaning: long });
    const row = await byTarget(target('meaning'));
    expect(row!.signatureMeaning).toBe(boundSignatureMeaning(long));
    expect(row!.signatureMeaning!.length).toBe(SIGNATURE_MEANING_MAX);
    expect(row!.signatureMeaning).toMatch(/^Approved x+…x+ by the reviewer$/);
    expect(verifies(row)).toBe(true);
    expect(boundSignatureMeaning(undefined)).toBeUndefined();
    expect(boundSignatureMeaning('short')).toBe('short');
  });
});

describe('auditLog — transactions and the signature link', () => {
  it("writes inside the caller's transaction: rolled back with it, kept when it commits", async () => {
    await expect(prisma.$transaction(async (tx) => {
      await auditLog({ userId: 'cvl_user', action: 'CVL_TX', targetId: target('rollback') }, tx);
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(await byTarget(target('rollback'))).toBeNull();

    const id = await prisma.$transaction((tx) => auditLog({ userId: 'cvl_user', action: 'CVL_TX', targetId: target('commit') }, tx));
    const row = await byTarget(target('commit'));
    expect(row!.id).toBe(id);
    expect(await linkedToPredecessor(row!)).toBe(true);
  });

  it('stamps the request\'s e-signature id, and an explicit id wins', async () => {
    const sigA = await auditLog({ userId: 'cvl_user', action: 'REAUTH_SUCCESS', targetId: target('sigA') });
    const sigB = await auditLog({ userId: 'cvl_user', action: 'REAUTH_SUCCESS', targetId: target('sigB') });
    await runWithRequestStore({ reauthAuditId: sigA }, async () => {
      await auditLog({ userId: 'cvl_user', action: 'CVL_SIGNED_WRITE', targetId: target('signed') });
      await auditLog({ userId: 'cvl_user', action: 'CVL_SIGNED_WRITE', targetId: target('explicit'), signatureAuditId: sigB });
    });
    const signed = await byTarget(target('signed'));
    expect(signed!.signatureAuditId).toBe(sigA);
    expect(verifies(signed)).toBe(true);
    // The link is inside the checksum: pointing it elsewhere fails verification.
    expect(verifies({ ...signed, signatureAuditId: sigB })).toBe(false);
    expect((await byTarget(target('explicit')))!.signatureAuditId).toBe(sigB);
  });
});

describe('auditLog — keyed (V3) chain, through a stand-in transaction client', () => {
  function fakeTx(prior: Array<{ checksum: string | null }>, inserted: Array<{ id: string }>) {
    const calls: { exec: unknown[][]; query: unknown[][] } = { exec: [], query: [] };
    const tx = {
      $executeRaw: async (...args: unknown[]) => { calls.exec.push(args); return 0; },
      $queryRaw: async (...args: unknown[]) => { calls.query.push(args); return calls.query.length === 1 ? prior : inserted; },
    };
    return { tx: tx as any, calls };
  }
  const KEY = 'cvl-audit-chain-key-for-coverage-0001';

  it('with AUDIT_CHAIN_KEY set, writes an HMAC checksum stamped version 3, linked to the prior row', async () => {
    __setAuditChainKeyForTest(KEY);
    const { tx, calls } = fakeTx([{ checksum: 'p'.repeat(64) }], [{ id: 'new-row-id' }]);
    const at = '2026-10-21T00:00:00.000Z';
    const id = await auditLog({ userId: 'cvl_user', userRole: 'QA', action: 'CVL_KEYED', targetType: 'cvl', targetId: 't-keyed', afterValue: { v: 1 }, timestamp: at }, tx);
    expect(id).toBe('new-row-id');
    // The chain lock is taken first.
    expect(calls.exec).toHaveLength(1);
    const values = calls.query[1].slice(1);
    const [checksum, previousChecksum, , version] = values.slice(13, 17);
    const expected = computeChainedChecksumV3({
      timestamp: at, userId: 'cvl_user', userName: undefined, userRole: 'QA', action: 'CVL_KEYED', targetType: 'cvl', targetId: 't-keyed',
      beforeValue: undefined, afterValue: { v: 1 }, reason: undefined, ipAddress: undefined, userAgent: undefined, sessionId: undefined, signatureMeaning: undefined,
    }, 'p'.repeat(64), KEY);
    expect({ checksum, previousChecksum, version }).toEqual({ checksum: expected, previousChecksum: 'p'.repeat(64), version: 3 });
    // And the verifier accepts exactly that row with the key, and not without it.
    const row = { timestamp: at, userId: 'cvl_user', userRole: 'QA', action: 'CVL_KEYED', targetType: 'cvl', targetId: 't-keyed', afterValue: { v: 1 }, checksum: expected, previousChecksum: 'p'.repeat(64), checksumVersion: 3 };
    expect(verifyAuditChecksum(row)).toBe(true);
    __setAuditChainKeyForTest(null);
    expect(verifyAuditChecksum(row)).toBe(false);
  });

  it('the very first row has no predecessor, and an INSERT that returns nothing yields an empty id', async () => {
    __setAuditChainKeyForTest(null);
    const { tx, calls } = fakeTx([], []);
    const id = await auditLog({ userId: 'cvl_user', action: 'CVL_GENESIS', timestamp: '2026-01-01T00:00:00.000Z' }, tx);
    expect(id).toBe('');
    const values = calls.query[1].slice(1);
    expect(values[14]).toBeNull();
    expect(values[16]).toBeNull();
    expect(values[13]).toBe(computeChainedChecksumV2({
      timestamp: '2026-01-01T00:00:00.000Z', userId: 'cvl_user', userName: undefined, userRole: undefined, action: 'CVL_GENESIS',
      targetType: undefined, targetId: undefined, beforeValue: undefined, afterValue: undefined, reason: undefined,
      ipAddress: undefined, userAgent: undefined, sessionId: undefined, signatureMeaning: undefined,
    }, null));
  });
});
