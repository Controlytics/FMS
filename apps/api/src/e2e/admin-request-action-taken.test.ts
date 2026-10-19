/**
 * OQ-19 follow-up (QA 2026-10-19): approving an ENABLE_ACCOUNT request for an
 * account that is already enabled must answer with a TOP-LEVEL
 * `actionTaken: false`, which the Admin Requests page reads to say "no action
 * was required" instead of showing a success dialog. The service always returned
 * it, but the route only placed it inside `data`, so the page never saw it.
 * Owns its SUPER_ADMIN approver, its target user and its request row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs, authPost } from './test-helper.js';
import adminRequestRoutes from '../modules/admin-requests/routes.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

const APPROVER = 'qa_oq19_approver';
const TARGET = `qa_oq19_t${Date.now().toString(36)}`;
const PASSWORD = 'QaOq19@Test2026';
let app: FastifyInstance;
let token = '';
let requestId = '';

describe('admin request approval reports actionTaken (OQ-19)', () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.upsert({
      where: { username: APPROVER },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: APPROVER, fullName: 'QA OQ-19 approver', passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-oq19-test' },
    });
    await prisma.user.create({ data: { username: TARGET, fullName: 'QA OQ-19 target', passwordHash, role: 'OPERATOR', status: 'ENABLED', createdBy: 'qa-oq19-test' } });
    requestId = (await prisma.adminRequest.create({
      data: { requestType: 'ENABLE_ACCOUNT', requesterName: 'QA', requestData: { username: TARGET }, remarks: 'qa test' },
    })).id;
    app = await buildApp([{ plugin: adminRequestRoutes, prefix: '/api/admin-requests' }]);
    token = await loginAs(app, APPROVER, PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await prisma.adminRequest.deleteMany({ where: { id: requestId } });
    await prisma.user.deleteMany({ where: { username: TARGET } });
    await app?.close();
  });

  it('an already-enabled account answers actionTaken:false at the top level', async () => {
    const res = await authPost(app, `/api/admin-requests/${requestId}/process`, token, { action: 'approve', adminRemarks: 'qa approve' }, PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.actionTaken).toBe(false);
    expect(body.message).toMatch(/already enabled/);
  });
});
