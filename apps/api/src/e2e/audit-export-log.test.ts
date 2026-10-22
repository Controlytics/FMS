import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';
import { prisma } from '../lib/prisma.js';

/**
 * Bug fix (2026-07-08): downloading/generating any report must itself be an
 * auditable event. The exports are client-side, so POST /api/audit/report-export-log
 * is the only place they're captured. This verifies the endpoint writes a
 * REPORT_GENERATED row with the report type, format + record count.
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

describe('POST /api/audit/report-export-log', () => {
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

  it('writes a REPORT_GENERATED audit row with the username, report type, format + count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/report-export-log',
      headers: { authorization: `Bearer ${token}` },
      payload: { reportType: 'Audit Trail', format: 'PDF', recordCount: 42, period: 'All Time' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const row = await prisma.auditTrail.findFirst({
      where: { action: 'REPORT_GENERATED', targetType: 'Audit Trail', userRole: 'SUPER_ADMIN' },
      orderBy: { timestamp: 'desc' },
    });
    expect(row).toBeTruthy();
    // userId must be the human username, NOT the UUID sub (the reported bug).
    expect(row!.userId).toBe(TEST_USERNAME);
    const after = row!.afterValue as Record<string, unknown>;
    expect(after.reportType).toBe('Audit Trail');
    expect(after.format).toBe('PDF');
    expect(after.recordCount).toBe(42);
  });

  it('rejects an unauthenticated request (route is gated, not open)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/report-export-log',
      payload: { reportType: 'Filters', format: 'Excel', recordCount: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  // 2026-10-22 (functional test): the export row said `search: null` although the
  // page had a filter-name search applied, and carried no block / AHU / status at
  // all. A REPORT_GENERATED row must state every filter that produced the file.
  it('records every filter that produced the export, and names them in the reason', async () => {
    const TAG = `exp-${Date.now().toString(36)}`;
    const filters = { Search: `QA03-F1 ${TAG}`, Block: 'B1', AHU: 'PF-B5/AHU-29', Status: 'Completed', Reasons: ['PM', 'Breakdown'], 'Manual entries only': 'Yes' };
    const res = await app.inject({
      method: 'POST', url: '/api/audit/report-export-log', headers: { authorization: `Bearer ${token}` },
      payload: { reportType: 'Cleaning Record', format: 'Excel', recordCount: 3, search: `QA03-F1 ${TAG}`, startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-22T23:59:59.999Z', filters },
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await prisma.auditTrail.findFirst({
      where: { action: 'REPORT_GENERATED', targetType: 'Cleaning Record', afterValue: { path: ['search'], equals: `QA03-F1 ${TAG}` } },
      orderBy: { chainPosition: 'desc' },
    });
    expect(row).toBeTruthy();
    expect(row!.afterValue).toMatchObject({
      reportType: 'Cleaning Record', format: 'Excel', recordCount: 3, search: `QA03-F1 ${TAG}`,
      startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-22T23:59:59.999Z', filters,
    });
    expect(row!.reason).toContain(`Search: QA03-F1 ${TAG}`);
    expect(row!.reason).toContain('AHU: PF-B5/AHU-29');
    expect(row!.reason).toContain('Reasons: PM, Breakdown');
  });

  it('an export with no filters records an empty filter set, not a missing one', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/audit/report-export-log', headers: { authorization: `Bearer ${token}` },
      payload: { reportType: 'Retirement List', format: 'PDF', recordCount: 7 },
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.auditTrail.findFirst({ where: { action: 'REPORT_GENERATED', targetType: 'Retirement List', userId: TEST_USERNAME }, orderBy: { chainPosition: 'desc' } });
    expect((row!.afterValue as Record<string, unknown>).filters).toEqual({});
    expect(row!.reason).toContain('no filters');
  });

  it.each([
    ['a nested object', { Block: { id: 'x' } }],
    ['too many entries', Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, 'v']))],
    ['an over-long value', { Search: 'x'.repeat(501) }],
  ])('refuses filters with %s (400)', async (_l, filters) => {
    const res = await app.inject({
      method: 'POST', url: '/api/audit/report-export-log', headers: { authorization: `Bearer ${token}` },
      payload: { reportType: 'Filters', format: 'PDF', recordCount: 1, filters },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/audit/report-export-log',
      headers: { authorization: `Bearer ${token}` },
      payload: { reportType: 'Filters', format: 'CSV', recordCount: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
