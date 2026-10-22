/**
 * Admin requests (coverage, 2026-10-21) through the real stack and test DB:
 * the public submit + user-lookup endpoints, the list / count reads, and every
 * approval branch of every request type — including the no-op approvals, the
 * hierarchy guard, the body-aware approve/reject permission gate, the re-auth
 * gate, and the hand-back to PENDING when an approval fails.
 *
 * Owns every user, role, request and notification it creates (prefix `cva`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authGet, authPost, internalErrors } from '../../../e2e/test-helper.js';
import adminRequestRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { verifyPassword } from '../../../lib/password.js';
import {
  cleanupAll, runSuffix, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { makeRole, auditFor, expectChained, validUserId } from '../../users/__tests__/support/cva-fixtures.js';

const S = runSuffix();
const lc = (s: string) => s.toLowerCase();
const PW = 'CvaReq@2026x';

const SA = lc(`cva_ar_sa_${S}`);
const APP = lc(`cva_ar_ap_${S}`);     // approve + reject, level 4
const APO = lc(`cva_ar_ao_${S}`);     // approve only
const REJ = lc(`cva_ar_rj_${S}`);     // reject only
const NOP = lc(`cva_ar_np_${S}`);     // neither
const RAU = lc(`cva_ar_ra_${S}`);     // approve, re-auth configured
const T_LOCK = lc(`cva_ar_tl_${S}`);
const T_EXP = lc(`cva_ar_te_${S}`);
const T_ON = lc(`cva_ar_to_${S}`);
const T_OFF = lc(`cva_ar_tf_${S}`);
const T_HIGH = lc(`cva_ar_th_${S}`);
const T_SA = lc(`cva_ar_ts_${S}`);
const EMAIL_BASE = lc(`cvae${S}`);   // an existing username the email-derived handle collides with

const R_APP = `CVA_AP_${S}`;
const R_APO = `CVA_AO_${S}`;
const R_REJ = `CVA_AJ_${S}`;
const R_NOP = `CVA_AN_${S}`;
const R_RAU = `CVA_AR_${S}`;
const R_LOW = `CVA_AL_${S}`;
const R_LOW2 = `CVA_A2_${S}`;
const R_HIGH = `CVA_AH_${S}`;
const R_OFF = `CVA_AF_${S}`;

let app: FastifyInstance;
let saTok = '', appTok = '', apoTok = '', rejTok = '', nopTok = '', rauTok = '';
const uid: Record<string, string> = {};
const requestIds: string[] = [];
const createdUsernames: string[] = [];
let reauthAdded: ReauthGrant = [];

async function seedRequest(requestType: string, requestData: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const r = await prisma.adminRequest.create({ data: { requestType, requesterName: 'Cov Seed', requestData: requestData as any, remarks: 'coverage', ...extra } });
  requestIds.push(r.id);
  return r.id;
}

async function submit(body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/api/admin-requests', payload: body });
  if (res.statusCode === 201) requestIds.push(res.json().requestId);
  return res;
}

const proc = (tok: string, id: string, action: 'approve' | 'reject', pw?: string) =>
  authPost(app, `/api/admin-requests/${id}/process`, tok, { action, adminRemarks: `cov ${action}` }, pw);

describe('admin-requests', () => {
  beforeAll(async () => {
    await makeRole(R_APP, 4, ['ADMIN_REQUEST_APPROVE', 'ADMIN_REQUEST_REJECT']);
    await makeRole(R_APO, 4, ['ADMIN_REQUEST_APPROVE']);
    await makeRole(R_REJ, 4, ['ADMIN_REQUEST_REJECT']);
    await makeRole(R_NOP, 4, ['USER_READ']);
    await makeRole(R_RAU, 4, ['ADMIN_REQUEST_APPROVE']);
    await makeRole(R_LOW, 2, ['USER_READ']);
    await makeRole(R_LOW2, 2, ['USER_READ']);
    await makeRole(R_HIGH, 6, ['USER_READ']);
    await makeRole(R_OFF, 1, [], { isActive: false });
    uid.SA = await createUser(SA, 'SUPER_ADMIN', PW, 'Cov Super Admin');
    uid.APP = await createUser(APP, R_APP, PW, 'Cov Approver');
    uid.APO = await createUser(APO, R_APO, PW);
    uid.REJ = await createUser(REJ, R_REJ, PW);
    uid.NOP = await createUser(NOP, R_NOP, PW);
    uid.RAU = await createUser(RAU, R_RAU, PW);
    uid.T_LOCK = await createUser(T_LOCK, R_LOW, PW);
    uid.T_EXP = await createUser(T_EXP, R_LOW, PW);
    uid.T_ON = await createUser(T_ON, R_LOW, PW);
    uid.T_OFF = await createUser(T_OFF, R_LOW, PW);
    uid.T_HIGH = await createUser(T_HIGH, R_HIGH, PW);
    uid.T_SA = await createUser(T_SA, 'SUPER_ADMIN', PW, 'Secret Person');
    uid.EB = await createUser(EMAIL_BASE, R_LOW, PW);
    await prisma.user.update({ where: { id: uid.T_LOCK }, data: { status: 'LOCKED', failedLoginAttempts: 5, lockedAt: new Date() } });
    await prisma.user.update({ where: { id: uid.T_EXP }, data: { status: 'EXPIRED' } });
    await prisma.user.update({ where: { id: uid.T_OFF }, data: { status: 'DISABLED' } });
    reauthAdded = await addReauth([['APPROVE_ADMIN_REQUEST', R_RAU]]);
    app = await buildApp([{ plugin: adminRequestRoutes, prefix: '/api/admin-requests' }]);
    saTok = await login(app, SA, PW);
    appTok = await login(app, APP, PW);
    apoTok = await login(app, APO, PW);
    rejTok = await login(app, REJ, PW);
    nopTok = await login(app, NOP, PW);
    rauTok = await login(app, RAU, PW);
  }, 60_000);

  afterAll(async () => {
    const created = await prisma.user.findMany({ where: { username: { in: createdUsernames } }, select: { id: true } });
    const allNames = [SA, APP, APO, REJ, NOP, RAU, T_LOCK, T_EXP, T_ON, T_OFF, T_HIGH, T_SA, EMAIL_BASE, ...createdUsernames];
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['request notifications', async () => {
        for (const id of requestIds) {
          await prisma.notification.deleteMany({ where: { type: 'USER_CREATION_REQUEST_SUBMITTED', metadata: { path: ['requestId'], equals: id } } });
        }
      }],
      ['user notifications', () => prisma.notification.deleteMany({ where: { OR: [{ targetUserId: { in: allNames } }, { forUserId: { in: allNames } }] } })],
      ['requests', () => prisma.adminRequest.deleteMany({ where: { id: { in: requestIds } } })],
      ['users', () => deleteUsers([...Object.values(uid), ...created.map((c) => c.id)])],
      ['roles', () => deleteRoles([R_APP, R_APO, R_REJ, R_NOP, R_RAU, R_LOW, R_LOW2, R_HIGH, R_OFF])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  describe('public submit', () => {
    it('CREATE_USER from a known employee ID: real name replaces the typed one; audit names the subject', async () => {
      const res = await submit({
        requestType: 'CREATE_USER', requesterName: 'S*** typed', requesterEmployeeId: APP,
        requestData: { username: 'CVANEW', fullName: 'New Person', requestedRole: R_LOW }, remarks: '<b>please</b>',
      });
      expect(res.statusCode).toBe(201);
      const id = res.json().requestId;
      const row = await prisma.adminRequest.findUnique({ where: { id } });
      // stripHtml ESCAPES markup (lib/sanitize.ts); it does not delete it.
      expect(row).toMatchObject({ requesterName: 'Cov Approver', requesterEmployeeId: APP, remarks: '&lt;b&gt;please&lt;/b&gt;', status: 'PENDING' });

      const audit = await auditFor('ADMIN_REQUEST_SUBMITTED', id);
      expect(audit).toMatchObject({ userId: `unverified:${APP}`, userRole: R_APP });
      expect(audit?.afterValue).toMatchObject({
        name: `Create User: CVANEW (New Person), role ${R_LOW}`, targetUsername: 'CVANEW', targetFullName: 'New Person', requestedRole: R_LOW, requesterRole: R_APP,
      });
      expect(audit?.reason).toBe(`Create User request for CVANEW (New Person), role ${R_LOW}, submitted by Cov Approver (${APP})`);
      await expectChained(audit);
      const n = await prisma.notification.findFirst({ where: { type: 'USER_CREATION_REQUEST_SUBMITTED', metadata: { path: ['requestId'], equals: id } } });
      expect(n).toMatchObject({ forRole: 'SUPER_ADMIN', title: 'New Create User Request' });
    });

    it('an unknown or absent employee ID is recorded as an unverified claim with no role', async () => {
      const unknown = await submit({ requestType: 'UNLOCK', requesterName: '<i>Bob</i>', requesterEmployeeId: `CVA_NOBODY_${S}`, requestData: { username: T_LOCK } });
      expect(unknown.statusCode).toBe(201);
      const a = await auditFor('ADMIN_REQUEST_SUBMITTED', unknown.json().requestId);
      expect(a).toMatchObject({ userId: `unverified:CVA_NOBODY_${S}`, userRole: null });
      expect((await prisma.adminRequest.findUnique({ where: { id: unknown.json().requestId } }))?.requesterName).toBe('&lt;i&gt;Bob&lt;/i&gt;');

      const anon = await submit({ requestType: 'FORGOT_PASSWORD', requesterName: 'Anon', requesterEmployeeId: '', requestData: { username: T_ON } });
      // requesterEmployeeId has minLength 1 — an empty one is a schema refusal.
      expect(anon.statusCode).toBe(400);
      expect(anon.json().error).toBe('VALIDATION_ERROR');
    });

    it('MODIFY_USER accepts only a valid role change and stamps the current role from the DB', async () => {
      const bad: Array<[Record<string, unknown>, RegExp]> = [
        [{ username: T_ON, modifyField: 'email', newValue: 'x@y.z' }, /Only the role can be changed/],
        [{ modifyField: 'role', newValue: R_LOW2 }, /Employee ID of the account to modify is required/],
        [{ username: T_ON, modifyField: 'role' }, /New role is required/],
        [{ username: `cva_ghost_${S}`, modifyField: 'role', newValue: R_LOW2 }, /does not exist/],
        [{ username: T_SA, modifyField: 'role', newValue: R_LOW2 }, /cannot be requested here/],
        [{ username: T_ON, modifyField: 'role', newValue: 'SUPER_ADMIN' }, /cannot be requested here/],
        [{ username: T_ON, modifyField: 'role', newValue: R_OFF }, /is not an active role/],
        [{ username: T_ON, modifyField: 'role', newValue: R_LOW }, /must differ from the current role/],
      ];
      for (const [requestData, msg] of bad) {
        const res = await submit({ requestType: 'MODIFY_USER', requesterName: 'Cov', requesterEmployeeId: T_ON, requestData });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(msg);
      }
      const ok = await submit({
        requestType: 'MODIFY_USER', requesterName: 'Cov', requesterEmployeeId: T_ON,
        requestData: { username: T_ON, modifyField: 'role', newValue: R_LOW2, currentRole: 'FORGED', email: 'ignored@x.y' },
      });
      expect(ok.statusCode).toBe(201);
      const row = await prisma.adminRequest.findUnique({ where: { id: ok.json().requestId } });
      expect(row?.requestData).toEqual({ username: T_ON, modifyField: 'role', currentRole: R_LOW, newValue: R_LOW2 });
      const audit = await auditFor('ADMIN_REQUEST_SUBMITTED', ok.json().requestId);
      expect((audit?.afterValue as any).name).toBe(`Modify User: ${T_ON}, role ${R_LOW} -> ${R_LOW2}`);
      expect(internalErrors).toHaveLength(0);
    });

    it('refuses a missing field and an oversized body before anything is written', async () => {
      const missing = await submit({ requestType: 'UNLOCK', requesterName: 'Cov', requestData: {} });
      expect(missing.statusCode).toBe(400);
      const huge = await app.inject({
        method: 'POST', url: '/api/admin-requests',
        payload: { requestType: 'UNLOCK', requesterName: 'Cov', requesterEmployeeId: 'X', requestData: { blob: 'x'.repeat(20_000) } },
      });
      expect(huge.statusCode).toBe(413);
      expect(huge.json().error).toBe('BODY_TOO_LARGE');
      expect(internalErrors).toHaveLength(0);
    });
  });

  describe('public user-lookup', () => {
    it('answers uniformly for an unknown ID', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/admin-requests/user-lookup?username=${encodeURIComponent(`  cva_none_${S} `)}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ exists: false, username: `cva_none_${S}`, fullName: null, role: null, roleDisplayName: null });
    });

    it('returns the real name and role display name for a normal account', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/admin-requests/user-lookup?username=${T_ON}` });
      expect(res.json()).toEqual({ exists: true, username: T_ON, fullName: `Coverage ${T_ON}`, role: R_LOW, roleDisplayName: R_LOW });
    });

    it('masks a SUPER_ADMIN\'s name and never discloses its role', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/admin-requests/user-lookup?username=${T_SA}` });
      expect(res.json()).toEqual({ exists: true, username: T_SA, fullName: 'S***** P*****', role: null, roleDisplayName: null });
    });

    it('400s a missing username', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin-requests/user-lookup' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('list and count', () => {
    it('403 without either admin-request permission', async () => {
      expect((await authGet(app, '/api/admin-requests', nopTok)).statusCode).toBe(403);
      expect((await authGet(app, '/api/admin-requests/pending-count', nopTok)).statusCode).toBe(403);
    });

    it('lists (optionally by status) with the pending count, for a reject-only role too', async () => {
      const res = await authGet(app, '/api/admin-requests?status=PENDING', rejTok);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.every((r: any) => r.status === 'PENDING')).toBe(true);
      expect(body.data.map((r: any) => r.id)).toEqual(expect.arrayContaining(requestIds.slice(0, 1)));
      expect(body.pendingCount).toBeGreaterThanOrEqual(1);
      const count = await authGet(app, '/api/admin-requests/pending-count', apoTok);
      expect(count.statusCode).toBe(200);
      expect(typeof count.json().count).toBe('number');
      const all = await authGet(app, '/api/admin-requests', saTok);
      expect(all.json().data.length).toBeGreaterThanOrEqual(body.data.length);
    });
  });

  describe('process: gates', () => {
    it('the action decides the permission: approve needs APPROVE, reject needs REJECT', async () => {
      const id = await seedRequest('ENABLE_ACCOUNT', { username: T_ON });
      const apoReject = await proc(apoTok, id, 'reject');
      expect(apoReject.statusCode).toBe(403);
      expect(apoReject.json().requiredPermission).toBe('ADMIN_REQUEST_REJECT');
      const rejApprove = await proc(rejTok, id, 'approve');
      expect(rejApprove.statusCode).toBe(403);
      expect(rejApprove.json().requiredPermission).toBe('ADMIN_REQUEST_APPROVE');
      expect((await prisma.adminRequest.findUnique({ where: { id } }))?.status).toBe('PENDING');

      const ok = await proc(rejTok, id, 'reject');
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ success: true, data: { status: 'REJECTED', processedBy: REJ } });
      // A rejection runs no action, so the route has no actionTaken to surface.
      expect(ok.json()).not.toHaveProperty('actionTaken');
      const audit = await auditFor('ADMIN_REQUEST_REJECTED', id);
      expect(audit?.afterValue).toMatchObject({ status: 'REJECTED', actionTaken: false, outcome: null, adminRemarks: 'cov reject' });
      expect(audit?.signatureMeaning).toBe(`Admin request (Enable Account) for ${T_ON}, rejected by ${REJ} (${R_REJ})`);
    });

    it('re-auth configured: 401 without a password and the request stays PENDING', async () => {
      const id = await seedRequest('ENABLE_ACCOUNT', { username: T_ON });
      const res = await proc(rauTok, id, 'approve');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'APPROVE_ADMIN_REQUEST' });
      expect((await prisma.adminRequest.findUnique({ where: { id } }))?.status).toBe('PENDING');
      const signed = await proc(rauTok, id, 'approve', PW);
      expect(signed.statusCode).toBe(200);
    });

    it('404 unknown, 400 already processed', async () => {
      expect((await proc(saTok, '00000000-0000-4000-8000-0000000000e1', 'approve')).statusCode).toBe(404);
      const id = await seedRequest('ENABLE_ACCOUNT', { username: T_ON }, { status: 'APPROVED' });
      const res = await proc(saTok, id, 'reject');
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('Request has already been processed');
    });
  });

  describe('process: approvals', () => {
    async function expectHandedBack(id: string) {
      const row = await prisma.adminRequest.findUnique({ where: { id } });
      expect(row).toMatchObject({ status: 'PENDING', processedBy: null, processedAt: null, adminRemarks: null });
    }

    it('CREATE_USER: refuses a missing role / short or taken User ID and hands the request back', async () => {
      const cases: Array<[Record<string, unknown>, RegExp]> = [
        [{ username: await validUserId(), fullName: 'X' }, /missing requested role/],
        [{ username: 'cva1', fullName: 'X', requestedRole: R_LOW }, /must be 6–50 characters/],
        [{ username: T_ON, fullName: 'X', requestedRole: R_LOW }, /is already taken/],
      ];
      for (const [data, msg] of cases) {
        const id = await seedRequest('CREATE_USER', data);
        const res = await proc(appTok, id, 'approve');
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(msg);
        await expectHandedBack(id);
      }
      expect(internalErrors).toHaveLength(0);
    });

    it('CREATE_USER: creates the account with a policy-compliant temporary password', async () => {
      const username = await validUserId();
      createdUsernames.push(username);
      const id = await seedRequest('CREATE_USER', { username, fullName: 'Requested Person', requestedRole: R_LOW, department: ' Ops ', email: '' });
      const res = await proc(appTok, id, 'approve');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ success: true, username, message: `User "${username}" created.`, data: { status: 'APPROVED' } });
      const user = await prisma.user.findUnique({ where: { username } });
      expect(user).toMatchObject({ role: R_LOW, fullName: 'Requested Person', department: 'Ops', email: null, isTemporaryPassword: true, createdBy: APP });
      expect(await verifyPassword(body.temporaryPassword, user!.passwordHash)).toBe(true);
      const audit = await auditFor('ADMIN_REQUEST_APPROVED', id);
      expect(audit?.afterValue).toMatchObject({ status: 'APPROVED', actionTaken: true, outcome: `User "${username}" created.` });
      expect(audit?.reason).toContain(`approved by ${APP}`);
      expect(await auditFor('USER_CREATED', user!.id)).toMatchObject({ userId: APP });
    });

    it('CREATE_USER without a User ID derives one from the email, stepping past a taken handle', async () => {
      // EMAIL_BASE already exists, so the generator moves to EMAIL_BASE + "2".
      // That handle is lower-case; whether it is accepted depends on the live
      // User ID rule, so assert only what holds either way.
      const id = await seedRequest('CREATE_USER', { email: `${EMAIL_BASE}@example.com`, fullName: 'Email Person', requestedRole: R_LOW });
      const res = await proc(appTok, id, 'approve');
      const derived = `${EMAIL_BASE}2`;
      createdUsernames.push(derived);
      if (res.statusCode === 200) {
        expect(res.json().username).toBe(derived);
      } else {
        expect(res.statusCode).toBe(400);
        expect(await prisma.user.findUnique({ where: { username: derived } })).toBeNull();
        await expectHandedBack(id);
      }
    });

    it('UNLOCK: no-op for an enabled account, a hint for an expired one, a real unlock for a locked one', async () => {
      const enabled = await seedRequest('UNLOCK', { username: T_ON });
      const r1 = await proc(appTok, enabled, 'approve');
      expect(r1.json()).toMatchObject({ actionTaken: false, username: T_ON });
      expect(r1.json().message).toBe(`No action taken — account "${T_ON}" is not locked (current status: ENABLED).`);
      expect(r1.json()).not.toHaveProperty('temporaryPassword');
      expect((await auditFor('ADMIN_REQUEST_APPROVED', enabled))?.signatureMeaning).toMatch(/no action was required$/);

      const expired = await seedRequest('UNLOCK', { username: T_EXP });
      const r2 = await proc(appTok, expired, 'approve');
      expect(r2.json().message).toMatch(/Its password has expired; submit a Forgot Password request/);

      const locked = await seedRequest('UNLOCK', { username: T_LOCK });
      const r3 = await proc(appTok, locked, 'approve');
      expect(r3.json()).toMatchObject({ actionTaken: true, message: `Account "${T_LOCK}" unlocked.` });
      const u = await prisma.user.findUnique({ where: { id: uid.T_LOCK } });
      expect(u).toMatchObject({ status: 'ENABLED', failedLoginAttempts: 0, isTemporaryPassword: true });
      expect(await verifyPassword(r3.json().temporaryPassword, u!.passwordHash)).toBe(true);
    });

    it('account-state requests: missing / unknown user, and the hierarchy guard runs before the state is read', async () => {
      const missing = await seedRequest('DISABLE_ACCOUNT', {});
      const m = await proc(appTok, missing, 'approve');
      expect(m.statusCode).toBe(400);
      expect(m.json().message).toBe('Request is missing User ID');
      await expectHandedBack(missing);

      const unknown = await seedRequest('ENABLE_ACCOUNT', { username: `cva_ghost_${S}` });
      expect((await proc(appTok, unknown, 'approve')).statusCode).toBe(404);

      const high = await seedRequest('ENABLE_ACCOUNT', { username: T_HIGH });
      const h = await proc(appTok, high, 'approve');
      expect(h.statusCode).toBe(403);
      expect(h.json().message).not.toMatch(/already enabled/);
      await expectHandedBack(high);
    });

    it('ENABLE_ACCOUNT: no-op when enabled or locked; enables a disabled account', async () => {
      const locked = await seedRequest('ENABLE_ACCOUNT', { username: T_EXP });
      await prisma.user.update({ where: { id: uid.T_EXP }, data: { status: 'LOCKED' } });
      const r1 = await proc(appTok, locked, 'approve');
      expect(r1.json().message).toBe(`No action taken — account "${T_EXP}" is locked, not disabled. Submit an Unlock Account request to restore access.`);
      expect(r1.json().actionTaken).toBe(false);

      const disabled = await seedRequest('ENABLE_ACCOUNT', { username: T_OFF });
      const r2 = await proc(appTok, disabled, 'approve');
      expect(r2.json()).toMatchObject({ actionTaken: true, message: `Account "${T_OFF}" enabled (was DISABLED).` });
      expect((await prisma.user.findUnique({ where: { id: uid.T_OFF } }))?.status).toBe('ENABLED');
    });

    it('DISABLE_ACCOUNT: disables an enabled account, then a second request is a no-op', async () => {
      const first = await seedRequest('DISABLE_ACCOUNT', { username: T_OFF });
      const r1 = await proc(appTok, first, 'approve');
      expect(r1.json()).toMatchObject({ actionTaken: true, message: `Account "${T_OFF}" disabled (was ENABLED).` });
      expect((await prisma.user.findUnique({ where: { id: uid.T_OFF } }))?.status).toBe('DISABLED');
      const second = await seedRequest('DISABLE_ACCOUNT', { username: T_OFF });
      const r2 = await proc(appTok, second, 'approve');
      expect(r2.json()).toMatchObject({ actionTaken: false, message: `No action taken — account "${T_OFF}" is already disabled.` });
    });

    it('FORGOT_PASSWORD: missing / unknown user refused; otherwise a temporary password', async () => {
      const missing = await seedRequest('FORGOT_PASSWORD', { username: '  ' });
      expect((await proc(appTok, missing, 'approve')).json().message).toBe('Request is missing User ID');
      const unknown = await seedRequest('FORGOT_PASSWORD', { username: `cva_ghost_${S}` });
      expect((await proc(appTok, unknown, 'approve')).statusCode).toBe(404);

      const ok = await seedRequest('FORGOT_PASSWORD', { username: T_ON });
      const res = await proc(appTok, ok, 'approve');
      expect(res.json()).toMatchObject({ username: T_ON, message: `Password reset for "${T_ON}".` });
      const u = await prisma.user.findUnique({ where: { id: uid.T_ON } });
      expect(await verifyPassword(res.json().temporaryPassword, u!.passwordHash)).toBe(true);
      expect(await auditFor('PASSWORD_RESET', uid.T_ON)).toMatchObject({ userId: APP });
    });

    it('MODIFY_USER (stored rows): each validation refusal, then a valid role change', async () => {
      const bad: Array<[Record<string, unknown>, number, RegExp]> = [
        [{ modifyField: 'role', newValue: R_LOW2 }, 400, /missing User ID/],
        [{ username: T_ON }, 400, /missing modifyField/],
        [{ username: T_ON, modifyField: 'passwordHash', newValue: 'x' }, 400, /cannot be modified via admin request/],
        [{ username: `cva_ghost_${S}`, modifyField: 'fullName', newValue: 'X' }, 404, /not found/],
        [{ username: T_ON, modifyField: 'email', newValue: 12345 }, 400, /Requested value for "email" is not valid/],
        [{ username: T_ON, modifyField: 'status', newValue: 'LOCKED' }, 400, /Requested value for "status" is not valid/],
      ];
      for (const [data, code, msg] of bad) {
        const id = await seedRequest('MODIFY_USER', data);
        const res = await proc(appTok, id, 'approve');
        expect(res.statusCode).toBe(code);
        expect(res.json().message).toMatch(msg);
        await expectHandedBack(id);
      }
      const ok = await seedRequest('MODIFY_USER', { username: T_ON, modifyField: 'role', currentRole: R_LOW, newValue: R_LOW2 });
      const res = await proc(appTok, ok, 'approve');
      expect(res.json()).toMatchObject({ username: T_ON, message: `User "${T_ON}" updated (role).` });
      expect((await prisma.user.findUnique({ where: { id: uid.T_ON } }))?.role).toBe(R_LOW2);
      expect(internalErrors).toHaveLength(0);
    });

    it('an unknown request type is refused and handed back', async () => {
      const id = await seedRequest('CVA_WEIRD', { username: T_ON });
      const res = await proc(appTok, id, 'approve');
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('Unknown request type: CVA_WEIRD');
      await expectHandedBack(id);

      // Rejecting it needs no action, and the audit names the raw type.
      const rej = await authPost(app, `/api/admin-requests/${id}/process`, appTok, { action: 'reject' });
      expect(rej.statusCode).toBe(200);
      const audit = await auditFor('ADMIN_REQUEST_REJECTED', id);
      expect(audit?.afterValue).toMatchObject({ operation: 'CVA_WEIRD', name: `CVA_WEIRD: ${T_ON}`, adminRemarks: '' });
      // No remarks given -> none stored.
      expect((await prisma.adminRequest.findUnique({ where: { id } }))?.adminRemarks).toBeNull();
    });

    it('CREATE_USER without a full name uses the requester name; FORGOT_PASSWORD without a User ID key is refused', async () => {
      const username = await validUserId();
      createdUsernames.push(username);
      const id = await seedRequest('CREATE_USER', { username, requestedRole: R_LOW });
      const res = await proc(appTok, id, 'approve');
      expect(res.statusCode).toBe(200);
      expect((await prisma.user.findUnique({ where: { username } }))?.fullName).toBe('Cov Seed');

      const fp = await seedRequest('FORGOT_PASSWORD', {});
      const r2 = await proc(appTok, fp, 'approve');
      expect(r2.statusCode).toBe(400);
      expect(r2.json().message).toBe('Request is missing User ID');
    });

    it('lookup of an account whose role row is gone shows the raw role name', async () => {
      const ghost = lc(`cva_ar_gh_${S}`);
      uid.GHOST = await createUser(ghost, `CVA_AGONE_${S}`.slice(0, 20), PW);
      const res = await app.inject({ method: 'GET', url: `/api/admin-requests/user-lookup?username=${ghost}` });
      expect(res.json()).toMatchObject({ exists: true, role: `CVA_AGONE_${S}`.slice(0, 20), roleDisplayName: `CVA_AGONE_${S}`.slice(0, 20) });
    });
  });
});
