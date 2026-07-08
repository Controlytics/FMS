import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';
import { prisma } from '../lib/prisma.js';

/**
 * Bug fix (2026-07-08): downloading/exporting the audit trail must itself be an
 * auditable event. The export is client-side, so POST /api/audit/export-log is
 * the only place it's captured. This verifies the endpoint writes a
 * DATA_EXPORTED row with the format + record count.
 */
const TEST_USERNAME = 'audit_export_admin';
const TEST_PASSWORD = 'AuditExport@Test1';

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
      fullName: 'Audit Export Test', email: 'audit-export@test.example',
      role: 'SUPER_ADMIN', status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
    },
  });
}

describe('POST /api/audit/export-log', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await ensureUser();
    token = await loginAs(app, TEST_USERNAME, TEST_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes a DATA_EXPORTED audit row capturing format + record count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/export-log',
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'PDF', recordCount: 42, period: 'All Time' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const row = await prisma.auditTrail.findFirst({
      where: { action: 'DATA_EXPORTED', targetType: 'audit_trail', userRole: 'SUPER_ADMIN' },
      orderBy: { timestamp: 'desc' },
    });
    expect(row).toBeTruthy();
    const after = row!.afterValue as Record<string, unknown>;
    expect(after.format).toBe('PDF');
    expect(after.recordCount).toBe(42);
  });

  it('rejects an unauthenticated request (route is gated, not open)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/export-log',
      payload: { format: 'Excel', recordCount: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/export-log',
      headers: { authorization: `Bearer ${token}` },
      payload: { format: 'CSV', recordCount: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
