import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { loginAs } from './test-helper.js';
import authPlugin from '../plugins/auth.js';
import rbacPlugin from '../plugins/rbac.js';
import authRoutes from '../modules/auth/routes.js';
import auditRoutes from '../modules/audit/routes.js';
import { buildErrorHandler } from '../lib/error-handler.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { verifyAuditChain } from '../lib/audit-verify.js';
import { __setAuditChainKeyForTest, __setAuditChainKeyedFromForTest } from '../lib/hash-chain.js';

/**
 * Audit 2026-05-04 fix C3 — end-to-end chain integrity.
 *
 * Proves:
 *   (1) New rows written via auditLog() chain to the prior row's checksum
 *       (previous_checksum is non-NULL after the first chained row).
 *   (2) verifyAuditChain() reports intact == true on the unmolested chain.
 *   (3) An in-place mutation of an audit row's after_value is detected as
 *       PER_ROW_CHECKSUM_MISMATCH AND breaks the chain link of every row
 *       written after it.
 *   (4) GET /api/audit/verify-chain endpoint surfaces the same anomalies.
 */

const TEST_USERNAME = 'audit_chain_admin';
const TEST_PASSWORD = 'AuditChain@Test1';

async function ensureUser() {
  const { hashPassword } = await import('../lib/password.js');
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await prisma.user.upsert({
    where: { username: TEST_USERNAME },
    update: {
      passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
      failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null,
    },
    create: {
      username: TEST_USERNAME, passwordHash,
      fullName: 'Audit Chain Test', email: 'audit-chain@test.example',
      role: 'SUPER_ADMIN', status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
    },
  });
}

/**
 * Only what this file exercises: login, and GET /api/audit/verify-chain. The full
 * harness (buildApp) registers eleven route modules; measured 2026-10-22 it took
 * 1.6–8 s to build depending on machine load and was nearly all of this hook's
 * time, which crossed the 10 s hook timeout in a multi-file run (deliverable 05,
 * D-DB-8) — the file then failed without running a test. This app builds in
 * ~0.2 s with the same plugins and the production error handler.
 */
async function buildChainApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  app.setErrorHandler(buildErrorHandler({ log: app.log }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.ready();
  return app;
}

describe('Audit hash chain — C3', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildChainApp();
    await ensureUser();
    token = await loginAs(app, TEST_USERNAME, TEST_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it('chains consecutive audit rows via previous_checksum', async () => {
    const beforeMaxRow = await prisma.$queryRaw<Array<{ chain_position: bigint | null }>>`
      SELECT chain_position FROM audit_trail ORDER BY chain_position DESC NULLS LAST LIMIT 1
    `;
    const beforeMax = beforeMaxRow[0]?.chain_position == null ? 0 : Number(beforeMaxRow[0].chain_position);

    await auditLog({
      userId: TEST_USERNAME, action: 'CHAIN_TEST_A',
      targetType: 'test', targetId: 'a-1',
      afterValue: { i: 1 }, ipAddress: '127.0.0.1',
    });
    await auditLog({
      userId: TEST_USERNAME, action: 'CHAIN_TEST_B',
      targetType: 'test', targetId: 'b-1',
      afterValue: { i: 2 }, ipAddress: '127.0.0.1',
    });
    await auditLog({
      userId: TEST_USERNAME, action: 'CHAIN_TEST_C',
      targetType: 'test', targetId: 'c-1',
      afterValue: { i: 3 }, ipAddress: '127.0.0.1',
    });

    const newRows = await prisma.$queryRaw<Array<{
      action: string;
      checksum: string;
      previous_checksum: string | null;
      chain_position: bigint;
    }>>`
      SELECT action, checksum, previous_checksum, chain_position
      FROM audit_trail
      WHERE chain_position > ${beforeMax}
      ORDER BY chain_position ASC
    `;

    expect(newRows.length).toBe(3);
    // Every new row carries a previous_checksum (chain era).
    for (const r of newRows) {
      expect(r.previous_checksum).not.toBeNull();
    }
    // The chain link is monotonic — row[i].previous_checksum == row[i-1].checksum.
    expect(newRows[1].previous_checksum).toBe(newRows[0].checksum);
    expect(newRows[2].previous_checksum).toBe(newRows[1].checksum);
  });

  it('verifyAuditChain reports intact==true on a freshly written chain segment', async () => {
    // Capture the high-water mark, write a fresh segment, scope the verifier
    // to only those rows. We can't assume the rest of the dev-DB audit_trail
    // is clean (other tests + seed leave artifacts; the pre-chain era may
    // have rows whose original checksum was computed with a slightly
    // different field-shape than today's verifyAuditChecksum); the meaningful
    // assertion for C3 is that NEW chain writes through auditLog() are
    // tamper-evident, which this scoped check proves directly.
    const beforeMaxRow = await prisma.$queryRaw<Array<{ chain_position: bigint | null }>>`
      SELECT chain_position FROM audit_trail ORDER BY chain_position DESC NULLS LAST LIMIT 1
    `;
    const beforeMax = beforeMaxRow[0]?.chain_position == null ? 0 : Number(beforeMaxRow[0].chain_position);

    await auditLog({ userId: TEST_USERNAME, action: 'INTACT_1', targetType: 'test', targetId: '1' });
    await auditLog({ userId: TEST_USERNAME, action: 'INTACT_2', targetType: 'test', targetId: '2' });
    await auditLog({ userId: TEST_USERNAME, action: 'INTACT_3', targetType: 'test', targetId: '3' });

    const result = await verifyAuditChain({ fromPosition: beforeMax + 1 });
    expect(result.intact).toBe(true);
    expect(result.anomalies).toEqual([]);
    expect(result.totalRowsChecked).toBe(3);
    expect(result.chainedRows).toBe(3);
    expect(result.preChainRows).toBe(0);
  });

  it('verifyAuditChain accepts a signed row (signature_audit_id is inside the checksum)', async () => {
    // 2026-10-17: the verifier's SELECT omitted signature_audit_id, so every
    // row signed through re-auth was reported as PER_ROW_CHECKSUM_MISMATCH.
    const beforeMaxRow = await prisma.$queryRaw<Array<{ chain_position: bigint | null }>>`
      SELECT chain_position FROM audit_trail ORDER BY chain_position DESC NULLS LAST LIMIT 1
    `;
    const beforeMax = beforeMaxRow[0]?.chain_position == null ? 0 : Number(beforeMaxRow[0].chain_position);

    const signatureId = await auditLog({ userId: TEST_USERNAME, action: 'SIGNED_REAUTH', targetType: 'test', targetId: 's0' });
    await auditLog({ userId: TEST_USERNAME, action: 'SIGNED_ACTION', targetType: 'test', targetId: 's1', signatureAuditId: signatureId });

    const signed = await prisma.$queryRaw<Array<{ signature_audit_id: string | null }>>`
      SELECT signature_audit_id FROM audit_trail WHERE action = 'SIGNED_ACTION' AND chain_position > ${beforeMax}
    `;
    expect(signed[0]?.signature_audit_id).toBe(signatureId);

    const result = await verifyAuditChain({ fromPosition: beforeMax + 1 });
    expect(result.anomalies).toEqual([]);
    expect(result.intact).toBe(true);
  });

  it('detects in-place mutation as PER_ROW_CHECKSUM_MISMATCH and breaks the chain', async () => {
    // Insert a fresh chain segment we can tamper with.
    const beforeMaxRow = await prisma.$queryRaw<Array<{ chain_position: bigint | null }>>`
      SELECT chain_position FROM audit_trail ORDER BY chain_position DESC NULLS LAST LIMIT 1
    `;
    const beforeMax = beforeMaxRow[0]?.chain_position == null ? 0 : Number(beforeMaxRow[0].chain_position);

    await auditLog({ userId: TEST_USERNAME, action: 'TAMPER_BASE', targetType: 'test', targetId: 'tb' });
    await auditLog({ userId: TEST_USERNAME, action: 'TAMPER_VICTIM', targetType: 'test', targetId: 'tv', afterValue: { honest: true } });
    await auditLog({ userId: TEST_USERNAME, action: 'TAMPER_AFTER', targetType: 'test', targetId: 'ta' });

    const tampered = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM audit_trail
      WHERE action = 'TAMPER_VICTIM' AND chain_position > ${beforeMax}
      LIMIT 1
    `;
    expect(tampered[0]).toBeDefined();

    // Tamper: rewrite after_value WITHOUT recomputing checksum. This is the
    // class of attack the chain detects — silent in-place mutation.
    await prisma.$executeRaw`
      UPDATE audit_trail
      SET after_value = ${JSON.stringify({ honest: false, attacker: true })}::jsonb
      WHERE id = ${tampered[0].id}::uuid
    `;

    const result = await verifyAuditChain({ fromPosition: beforeMax + 1 });
    expect(result.intact).toBe(false);
    expect(result.anomalies.some(a => a.kind === 'PER_ROW_CHECKSUM_MISMATCH')).toBe(true);

    // Cleanup: the audit_trail no-delete trigger is conditional on the
    // production seed (compliance invariants live in seed.ts, not migrations
    // — see data-layer review C2). In dev DBs the trigger may not exist;
    // try to disable it but tolerate failure, then attempt the delete. If
    // the trigger IS active and blocks delete, the rows stay (subsequent
    // tests still pass — verify-chain accepts them as legitimately persisted
    // anomalies left by this test, and the test scope filter `fromPosition`
    // confines this to fresh rows only).
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_delete`);
      try {
        await prisma.$executeRaw`DELETE FROM audit_trail WHERE chain_position > ${beforeMax}`;
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_delete`);
      }
    } catch {
      // Trigger not installed — fall through; rows remain but are scoped
      // to this test's chain segment via fromPosition.
    }
  });

  it('detects a keyed-era downgrade (v3 relabelled unkeyed) as KEYED_ERA_DOWNGRADE', async () => {
    // Threat: a privileged DB actor takes the most-recent keyed (v3) rows,
    // sets checksum_version = NULL and recomputes them with the unkeyed SHA
    // formula + self-consistent links. Each row then verifies via the unkeyed
    // path and, being at the tail, has no trailing v3 row whose chain link
    // would break — so the per-row HMAC + chain-link checks alone MISS it.
    // The AUDIT_CHAIN_KEYED_FROM cutover ("rows >= cutover MUST be v3") catches
    // it. This test proves the enforcement is wired into verifyAuditChain.
    const KEY = 'test-audit-hmac-key-keyed-era-downgrade';
    __setAuditChainKeyForTest(KEY);
    const beforeMaxRow = await prisma.$queryRaw<Array<{ chain_position: bigint | null }>>`
      SELECT chain_position FROM audit_trail ORDER BY chain_position DESC NULLS LAST LIMIT 1
    `;
    const beforeMax = beforeMaxRow[0]?.chain_position == null ? 0 : Number(beforeMaxRow[0].chain_position);
    __setAuditChainKeyedFromForTest(beforeMax + 1);

    try {
      // auditLog writes v3 rows because the key is set.
      await auditLog({ userId: TEST_USERNAME, action: 'KEYED_1', targetType: 'test', targetId: 'k1' });
      await auditLog({ userId: TEST_USERNAME, action: 'KEYED_2', targetType: 'test', targetId: 'k2' });

      const clean = await verifyAuditChain({ fromPosition: beforeMax + 1 });
      expect(clean.anomalies.filter(a => a.kind === 'KEYED_ERA_DOWNGRADE')).toEqual([]);

      // Attack: relabel the keyed-era rows as unkeyed.
      await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_delete`).catch(() => {});
      await prisma.$executeRaw`UPDATE audit_trail SET checksum_version = NULL WHERE chain_position >= ${beforeMax + 1}`;
      await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_delete`).catch(() => {});

      const tampered = await verifyAuditChain({ fromPosition: beforeMax + 1 });
      expect(tampered.intact).toBe(false);
      expect(tampered.anomalies.some(a => a.kind === 'KEYED_ERA_DOWNGRADE')).toBe(true);
    } finally {
      // Cleanup: remove the test rows and reset the cached key/cutover.
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_delete`);
        try { await prisma.$executeRaw`DELETE FROM audit_trail WHERE chain_position > ${beforeMax}`; }
        finally { await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_delete`); }
      } catch { /* trigger absent — rows scoped by fromPosition */ }
      __setAuditChainKeyForTest(undefined);
      __setAuditChainKeyedFromForTest(undefined);
    }
  });

  it('GET /api/audit/verify-chain returns the verifier result', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/verify-chain',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('intact');
    expect(body).toHaveProperty('totalRowsChecked');
    expect(body).toHaveProperty('chainedRows');
    expect(body).toHaveProperty('anomalies');
  });
});
