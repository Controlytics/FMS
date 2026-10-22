/**
 * Admin requests are decisions, and "approval/decision flows require remarks"
 * (CLAUDE.md). POST /api/admin-requests/:id/process used to accept an approve or
 * a reject with no adminRemarks (only the web page asked for them, 2026-10-22).
 * It now refuses blank remarks — after the per-action permission gate, before the
 * re-auth gate, so no signature is spent on a decision that will be refused.
 *
 * Owns every user, role and admin request it touches (prefix `arr`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authPost, internalErrors } from './test-helper.js';
import adminRequestRoutes from '../modules/admin-requests/routes.js';
import { prisma } from '../lib/prisma.js';
import {
  cleanupAll, runSuffix, createUser, createRole, login, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant,
} from './support/owned-fixtures.js';

const S = runSuffix();
const lc = (s: string) => s.toLowerCase();
const PW = 'ArrUser@2026x';

const SA = lc(`arr_sa_${S}`);
const SIGNER = lc(`arr_sg_${S}`);
const APPROVE_ONLY = lc(`arr_ap_${S}`);
const TARGET = lc(`arr_tg_${S}`);
const R_TARGET = `ARR_T_${S}`;
const R_SIGNER = `ARR_S_${S}`;
const R_APO = `ARR_A_${S}`;
const MESSAGE = 'Remarks are required to approve or reject an admin request.';

let app: FastifyInstance;
let saTok = '', signerTok = '', apoTok = '';
const ids: Record<string, string> = {};
const requestIds: string[] = [];
let reauthAdded: ReauthGrant = [];

const seed = async () => {
  await prisma.user.update({ where: { id: ids.TARGET }, data: { status: 'DISABLED' } });
  const r = await prisma.adminRequest.create({
    data: { requestType: 'ENABLE_ACCOUNT', requesterName: 'Arr Seed', requestData: { username: TARGET } as any, remarks: 'back from leave' },
  });
  requestIds.push(r.id);
  return r.id;
};
const row = (id: string) => prisma.adminRequest.findUnique({ where: { id } });
const targetStatus = async () => (await prisma.user.findUnique({ where: { id: ids.TARGET } }))?.status;
const proc = (id: string, tok: string, body: Record<string, unknown>, pw?: string) =>
  authPost(app, `/api/admin-requests/${id}/process`, tok, body, pw);

describe('admin request decisions need remarks', () => {
  beforeAll(async () => {
    await createRole(R_TARGET, ['USER_READ']);
    await createRole(R_SIGNER, ['ADMIN_REQUEST_APPROVE', 'ADMIN_REQUEST_REJECT']);
    await createRole(R_APO, ['ADMIN_REQUEST_APPROVE']);
    ids.SA = await createUser(SA, 'SUPER_ADMIN', PW);
    ids.SIGNER = await createUser(SIGNER, R_SIGNER, PW);
    ids.APO = await createUser(APPROVE_ONLY, R_APO, PW);
    ids.TARGET = await createUser(TARGET, R_TARGET, PW);
    reauthAdded = await addReauth([['APPROVE_ADMIN_REQUEST', R_SIGNER]]);
    app = await buildApp([{ plugin: adminRequestRoutes, prefix: '/api/admin-requests' }]);
    saTok = await login(app, SA, PW);
    signerTok = await login(app, SIGNER, PW);
    apoTok = await login(app, APPROVE_ONLY, PW);
  }, 60_000);

  afterAll(async () => {
    const usernames = [SA, SIGNER, APPROVE_ONLY, TARGET];
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['admin requests', () => prisma.adminRequest.deleteMany({ where: { id: { in: requestIds } } })],
      ['notifications', () => prisma.notification.deleteMany({ where: { OR: [{ targetUserId: { in: usernames } }, { forUserId: { in: usernames } }] } })],
      ['user configs', () => prisma.userConfig.deleteMany({ where: { userId: { in: Object.values(ids) } } })],
      ['users', () => deleteUsers(Object.values(ids))],
      ['roles', () => deleteRoles([R_TARGET, R_SIGNER, R_APO])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  it('an approve without remarks is refused and changes nothing', async () => {
    const id = await seed();
    const res = await proc(id, saTok, { action: 'approve' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION', message: MESSAGE });
    expect(await row(id)).toMatchObject({ status: 'PENDING', processedBy: null });
    expect(await targetStatus()).toBe('DISABLED');
    expect(internalErrors).toEqual([]);
  });

  it('a reject with blank (whitespace) remarks is refused', async () => {
    const id = await seed();
    const res = await proc(id, saTok, { action: 'reject', adminRemarks: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe(MESSAGE);
    expect((await row(id))?.status).toBe('PENDING');
  });

  it('with remarks, a reject closes the request and stores the remarks trimmed', async () => {
    const id = await seed();
    const res = await proc(id, saTok, { action: 'reject', adminRemarks: '  Not an employee  ' });
    expect(res.statusCode).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'REJECTED', adminRemarks: 'Not an employee' });
    expect(await targetStatus()).toBe('DISABLED');
  });

  it('with remarks, an approve runs the request', async () => {
    const id = await seed();
    const res = await proc(id, saTok, { action: 'approve', adminRemarks: 'Confirmed with HR' });
    expect(res.statusCode).toBe(200);
    expect(await row(id)).toMatchObject({ status: 'APPROVED', adminRemarks: 'Confirmed with HR' });
    expect(await targetStatus()).toBe('ENABLED');
  });

  it('the per-action permission gate still answers first: a missing permission is a 403, not a remarks error', async () => {
    const id = await seed();
    const res = await proc(id, apoTok, { action: 'reject' });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('ADMIN_REQUEST_REJECT');
  });

  it('the remarks check comes before the re-auth gate: no signature is asked for (or recorded) for a refused decision', async () => {
    const id = await seed();
    const reauthRows = () => prisma.auditTrail.count({ where: { userId: SIGNER, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } });
    const before = await reauthRows();
    const refused = await proc(id, signerTok, { action: 'approve' }, PW);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toBe(MESSAGE);
    expect(await reauthRows()).toBe(before);
    const unsigned = await proc(id, signerTok, { action: 'approve', adminRemarks: 'ok' });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'APPROVE_ADMIN_REQUEST' });
    const signed = await proc(id, signerTok, { action: 'approve', adminRemarks: 'ok' }, PW);
    expect(signed.statusCode).toBe(200);
    expect(await targetStatus()).toBe('ENABLED');
  });
});
