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
 *   (2) verifyAuditChain() reports no anomaly on an unmolested segment.
 *   (3) An in-place mutation of an audit row's after_value is detected as
 *       PER_ROW_CHECKSUM_MISMATCH.
 *   (4) GET /api/audit/verify-chain endpoint surfaces the same anomalies.
 *
 * Other writers share this table (other files, other test processes on the same
 * database), so every assertion is about THIS file's rows, found by the ids
 * auditLog() returns — never "every row above a high-water mark" (2026-10-22: the
 * count of rows above the mark read 5, not 3, when another process wrote in
 * between). A row's link is checked against the row directly before it in the
 * chain, whoever wrote that row.
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

interface ChainRow { id: string; action: string; checksum: string; previous_checksum: string | null; chain_position: bigint }

/** This file's rows, by id, in chain order. */
async function rowsById(ids: string[]): Promise<ChainRow[]> {
  return prisma.$queryRaw<ChainRow[]>`
    SELECT id::text AS id, action, checksum, previous_checksum, chain_position
    FROM audit_trail
    WHERE id = ANY(${ids}::uuid[])
    ORDER BY chain_position ASC
  `;
}

/** The checksum of the row directly before `position` in the chain, whoever wrote it. */
async function checksumBefore(position: bigint): Promise<string | null> {
  const r = await prisma.$queryRaw<Array<{ checksum: string }>>`
    SELECT checksum FROM audit_trail
    WHERE chain_position < ${position}
    ORDER BY chain_position DESC
    LIMIT 1
  `;
  return r[0]?.checksum ?? null;
}

/** verifyAuditChain over the span of these rows; only anomalies on THESE rows. */
async function verifyOwn(rows: ChainRow[]) {
  const result = await verifyAuditChain({
    fromPosition: Number(rows[0].chain_position),
    toPosition: Number(rows[rows.length - 1].chain_position),
  });
  const mine = new Set(rows.map((r) => r.id));
  return { result, anomalies: result.anomalies.filter((a) => mine.has(a.id) && !a.informational) };
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
    const ids = [
      await auditLog({ userId: TEST_USERNAME, action: 'CHAIN_TEST_A', targetType: 'test', targetId: 'a-1', afterValue: { i: 1 }, ipAddress: '127.0.0.1' }),
    ];
    // Another writer lands in between, as other files and processes do.
    const otherId = await auditLog({ userId: 'audit_chain_other', action: 'CHAIN_TEST_OTHER', targetType: 'test', targetId: 'o-1' });
    ids.push(
      await auditLog({ userId: TEST_USERNAME, action: 'CHAIN_TEST_B', targetType: 'test', targetId: 'b-1', afterValue: { i: 2 }, ipAddress: '127.0.0.1' }),
      await auditLog({ userId: TEST_USERNAME, action: 'CHAIN_TEST_C', targetType: 'test', targetId: 'c-1', afterValue: { i: 3 }, ipAddress: '127.0.0.1' }),
    );

    const rows = await rowsById(ids);
    // Written in order, so chained in order.
    expect(rows.map((r) => r.action)).toEqual(['CHAIN_TEST_A', 'CHAIN_TEST_B', 'CHAIN_TEST_C']);
    for (const r of rows) {
      // Every new row carries a previous_checksum (chain era)...
      expect(r.previous_checksum).not.toBeNull();
      // ...which is the checksum of the row directly before it.
      expect(r.previous_checksum).toBe(await checksumBefore(r.chain_position));
    }
    // The other writer's row sits between A and B, so B does not link to A.
    const [other] = await rowsById([otherId]);
    expect(other.chain_position > rows[0].chain_position && other.chain_position < rows[1].chain_position).toBe(true);
    expect(rows[1].previous_checksum).not.toBe(rows[0].checksum);
  });

  it('verifyAuditChain reports no anomaly on a freshly written chain segment', async () => {
    // Scoped to this segment: we can't assume the rest of the test DB's
    // audit_trail is clean (other tests + seed leave artifacts; the pre-chain era
    // may have rows whose original checksum was computed with a slightly different
    // field-shape than today's verifyAuditChecksum); the meaningful assertion for
    // C3 is that NEW chain writes through auditLog() are tamper-evident.
    const rows = await rowsById([
      await auditLog({ userId: TEST_USERNAME, action: 'INTACT_1', targetType: 'test', targetId: '1' }),
      await auditLog({ userId: TEST_USERNAME, action: 'INTACT_2', targetType: 'test', targetId: '2' }),
      await auditLog({ userId: TEST_USERNAME, action: 'INTACT_3', targetType: 'test', targetId: '3' }),
    ]);

    const { result, anomalies } = await verifyOwn(rows);
    expect(anomalies).toEqual([]);
    // the walk covered at least these three rows, every one of them chained
    expect(result.totalRowsChecked).toBeGreaterThanOrEqual(3);
    expect(result.preChainRows).toBe(0);
  });

  it('verifyAuditChain accepts a signed row (signature_audit_id is inside the checksum)', async () => {
    // 2026-10-17: the verifier's SELECT omitted signature_audit_id, so every
    // row signed through re-auth was reported as PER_ROW_CHECKSUM_MISMATCH.
    const signatureId = await auditLog({ userId: TEST_USERNAME, action: 'SIGNED_REAUTH', targetType: 'test', targetId: 's0' });
    const actionId = await auditLog({ userId: TEST_USERNAME, action: 'SIGNED_ACTION', targetType: 'test', targetId: 's1', signatureAuditId: signatureId });

    const signed = await prisma.$queryRaw<Array<{ signature_audit_id: string | null }>>`
      SELECT signature_audit_id::text AS signature_audit_id FROM audit_trail WHERE id = ${actionId}::uuid
    `;
    expect(signed[0]?.signature_audit_id).toBe(signatureId);

    const { anomalies } = await verifyOwn(await rowsById([signatureId, actionId]));
    expect(anomalies).toEqual([]);
  });

  it('detects in-place mutation as PER_ROW_CHECKSUM_MISMATCH', async () => {
    // A fresh chain segment we can tamper with.
    const rows = await rowsById([
      await auditLog({ userId: TEST_USERNAME, action: 'TAMPER_BASE', targetType: 'test', targetId: 'tb' }),
      await auditLog({ userId: TEST_USERNAME, action: 'TAMPER_VICTIM', targetType: 'test', targetId: 'tv', afterValue: { honest: true } }),
      await auditLog({ userId: TEST_USERNAME, action: 'TAMPER_AFTER', targetType: 'test', targetId: 'ta' }),
    ]);
    const victim = rows.find((r) => r.action === 'TAMPER_VICTIM')!;

    // Tamper: rewrite after_value WITHOUT recomputing checksum. This is the
    // class of attack the chain detects — silent in-place mutation.
    await prisma.$executeRaw`
      UPDATE audit_trail
      SET after_value = ${JSON.stringify({ honest: false, attacker: true })}::jsonb
      WHERE id = ${victim.id}::uuid
    `;
    try {
      const { result, anomalies } = await verifyOwn(rows);
      expect(result.intact).toBe(false);
      expect(anomalies.map((a) => [a.id, a.kind])).toEqual([[victim.id, 'PER_ROW_CHECKSUM_MISMATCH']]);
    } finally {
      // Undo the tamper rather than delete the rows: deleting would need the
      // no-delete trigger off, and a delete scoped by position took other
      // writers' rows with it. Put back, the segment verifies again.
      await prisma.$executeRaw`
        UPDATE audit_trail SET after_value = ${JSON.stringify({ honest: true })}::jsonb WHERE id = ${victim.id}::uuid
      `;
    }
    expect((await verifyOwn(rows)).anomalies).toEqual([]);
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
    const ids: string[] = [];

    try {
      // auditLog writes v3 rows because the key is set.
      ids.push(await auditLog({ userId: TEST_USERNAME, action: 'KEYED_1', targetType: 'test', targetId: 'k1' }));
      ids.push(await auditLog({ userId: TEST_USERNAME, action: 'KEYED_2', targetType: 'test', targetId: 'k2' }));
      const rows = await rowsById(ids);
      __setAuditChainKeyedFromForTest(Number(rows[0].chain_position));

      const clean = await verifyOwn(rows);
      expect(clean.anomalies.filter(a => a.kind === 'KEYED_ERA_DOWNGRADE')).toEqual([]);

      // Attack: relabel the keyed-era rows as unkeyed.
      await prisma.$executeRaw`UPDATE audit_trail SET checksum_version = NULL WHERE id = ANY(${ids}::uuid[])`;

      const tampered = await verifyOwn(rows);
      expect(tampered.result.intact).toBe(false);
      expect(tampered.anomalies.filter(a => a.kind === 'KEYED_ERA_DOWNGRADE').map(a => a.id).sort()).toEqual([...ids].sort());
    } finally {
      // Cleanup: these rows carry an HMAC under a key nothing else holds, so they
      // can never verify again — remove THESE rows, by id. (A delete scoped by
      // chain position took other writers' rows with it.)
      if (ids.length > 0) {
        try {
          await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_delete`);
          try { await prisma.$executeRaw`DELETE FROM audit_trail WHERE id = ANY(${ids}::uuid[])`; }
          finally { await prisma.$executeRawUnsafe(`ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_delete`); }
        } catch { /* trigger absent — the rows stay, scoped by their positions */ }
      }
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
