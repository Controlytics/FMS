/**
 * Users routes (coverage, 2026-10-21) through the real stack and test DB:
 * list / stats / detail visibility rules, create / update / delete / bulk
 * delete, enable / disable / unlock / reset, password-reset requests, the
 * hierarchy guard, the re-auth gate, sessions ended by each account action,
 * and the audit + notification rows written.
 *
 * Owns every user, role and reset request it touches (prefix `cva`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authGet, authPost, authPut, authDelete, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import { verifyPassword } from '../../../lib/password.js';
import {
  cleanupAll, runSuffix, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { makeRole, auditFor, expectChained, validUserId } from './support/cva-fixtures.js';

const S = runSuffix();
const lc = (s: string) => s.toLowerCase();
const PW = 'CvaUser@2026x';
const NEW_PW = 'CvaTemp#2027y';

const SA = lc(`cva_us_sa_${S}`);
const ADM = lc(`cva_us_ad_${S}`);       // system ADMIN role (read only)
const MGR = lc(`cva_us_mg_${S}`);       // custom manager, level 4
const RAU = lc(`cva_us_ra_${S}`);       // same perms, re-auth configured
const LOW1 = lc(`cva_us_l1_${S}`);
const LOW2 = lc(`cva_us_l2_${S}`);
const LOW3 = lc(`cva_us_l3_${S}`);
const HIGH = lc(`cva_us_hi_${S}`);
const SA2 = lc(`cva_us_s2_${S}`);       // second SUPER_ADMIN, a target that may never be deleted

const R_MGR = `CVA_UM_${S}`;
const R_RAU = `CVA_UA_${S}`;
const R_LOW = `CVA_UL_${S}`;
const R_HIGH = `CVA_UH_${S}`;
const R_OFF = `CVA_UO_${S}`;            // inactive role
const MGR_PERMS = ['USER_CREATE', 'USER_READ', 'USER_UPDATE', 'USER_ENABLE_DISABLE', 'USER_UNLOCK', 'USER_RESET_PASSWORD'];

let app: FastifyInstance;
let saTok = '', admTok = '', mgrTok = '', rauTok = '';
const ids: Record<string, string> = {};
const createdUsernames: string[] = [];
const resetRequestIds: string[] = [];
let reauthAdded: ReauthGrant = [];

const allUserIds = () => Object.values(ids);
const allUsernames = () => [SA, ADM, MGR, RAU, LOW1, LOW2, LOW3, HIGH, SA2, ...createdUsernames];

describe('users routes', () => {
  beforeAll(async () => {
    await makeRole(R_MGR, 4, MGR_PERMS);
    await makeRole(R_RAU, 4, MGR_PERMS);
    await makeRole(R_LOW, 2, ['USER_READ']);
    await makeRole(R_HIGH, 6, ['USER_READ']);
    await makeRole(R_OFF, 1, [], { isActive: false });
    ids.SA = await createUser(SA, 'SUPER_ADMIN', PW);
    ids.ADM = await createUser(ADM, 'ADMIN', PW);
    ids.MGR = await createUser(MGR, R_MGR, PW);
    ids.RAU = await createUser(RAU, R_RAU, PW);
    ids.LOW1 = await createUser(LOW1, R_LOW, PW);
    ids.LOW2 = await createUser(LOW2, R_LOW, PW);
    ids.LOW3 = await createUser(LOW3, R_LOW, PW);
    ids.HIGH = await createUser(HIGH, R_HIGH, PW);
    ids.SA2 = await createUser(SA2, 'SUPER_ADMIN', PW);
    reauthAdded = await addReauth([
      'CREATE_USER', 'UPDATE_USER', 'ENABLE_USER', 'DISABLE_USER', 'UNLOCK_USER', 'RESET_PASSWORD', 'PROCESS_RESET_REQUEST',
    ].map((a) => [a, R_RAU] as [string, string]));
    app = await buildApp();
    saTok = await login(app, SA, PW);
    admTok = await login(app, ADM, PW);
    mgrTok = await login(app, MGR, PW);
    rauTok = await login(app, RAU, PW);
  }, 60_000);

  afterAll(async () => {
    const created = await prisma.user.findMany({ where: { username: { in: createdUsernames } }, select: { id: true } });
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['reset requests', () => prisma.passwordResetRequest.deleteMany({ where: { OR: [{ id: { in: resetRequestIds } }, { userId: { in: allUserIds() } }] } })],
      ['notifications', () => prisma.notification.deleteMany({ where: { OR: [{ targetUserId: { in: allUsernames() } }, { forUserId: { in: allUsernames() } }] } })],
      ['user configs', () => prisma.userConfig.deleteMany({ where: { userId: { in: allUserIds() } } })],
      ['users', () => deleteUsers([...allUserIds(), ...created.map((c) => c.id)])],
      ['roles', () => deleteRoles([R_MGR, R_RAU, R_LOW, R_HIGH, R_OFF, `CVA_UT_${S}`])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  describe('list / stats / detail', () => {
    it('SUPER_ADMIN filters by role; without an explicit limit the default page size applies', async () => {
      const res = await authGet(app, `/api/users?role=${R_LOW}`, saTok);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.map((u: any) => u.username).sort()).toEqual([LOW1, LOW2, LOW3].sort());
      expect(body).toMatchObject({ total: 3, page: 1, limit: 20, totalPages: 1 });
    });

    it('paginates with limit + search and status filters', async () => {
      const res = await authGet(app, `/api/users?search=cva_us_l&limit=2&page=2`, saTok);
      const body = res.json();
      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(body.totalPages).toBe(Math.ceil(body.total / 2));
      expect(body.page).toBe(2);
      const disabled = await authGet(app, `/api/users?search=${S.toLowerCase()}&status=DISABLED`, saTok);
      expect(disabled.json().total).toBe(0);
    });

    it('a non-admin role never sees SUPER_ADMIN or ADMIN, even when it asks for them by role', async () => {
      const all = await authGet(app, `/api/users?search=${S.toLowerCase()}&limit=100`, mgrTok);
      const names = all.json().data.map((u: any) => u.username);
      expect(names).toContain(LOW1);
      expect(names).not.toContain(SA);
      expect(names).not.toContain(ADM);
      for (const role of ['SUPER_ADMIN', 'ADMIN']) {
        const res = await authGet(app, `/api/users?role=${role}`, mgrTok);
        expect(res.json()).toMatchObject({ data: [], total: 0 });
      }
      // A role it may see narrows normally.
      expect((await authGet(app, `/api/users?role=${R_HIGH}`, mgrTok)).json().total).toBe(1);
    });

    it('ADMIN sees ADMIN accounts but not SUPER_ADMIN ones', async () => {
      const res = await authGet(app, `/api/users?search=${S.toLowerCase()}&limit=100`, admTok);
      const names = res.json().data.map((u: any) => u.username);
      expect(names).toContain(ADM);
      expect(names).not.toContain(SA);
    });

    it('400s an invalid query (zod) instead of a 500', async () => {
      const res = await authGet(app, '/api/users?page=0', saTok);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
      expect(internalErrors).toHaveLength(0);
    });

    it('stats: ADMIN counts exclude SUPER_ADMIN accounts, SUPER_ADMIN counts everyone', async () => {
      const asAdm = (await authGet(app, '/api/users/stats', admTok)).json();
      const asSa = (await authGet(app, '/api/users/stats', saTok)).json();
      const [nonSa, all] = await Promise.all([
        prisma.user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
        prisma.user.count(),
      ]);
      // Other suites create users concurrently, so compare against a fresh count
      // with slack in one direction only.
      expect(asAdm.total).toBeLessThanOrEqual(nonSa + 5);
      expect(asAdm.total).toBeGreaterThanOrEqual(nonSa - 5);
      expect(asSa.total).toBeGreaterThan(asAdm.total);
      expect(asSa.total).toBeGreaterThanOrEqual(all - 5);
      for (const k of ['enabled', 'disabled', 'locked', 'expired']) expect(typeof asSa[k]).toBe('number');
      expect(asSa.enabled + asSa.disabled + asSa.locked + asSa.expired).toBeLessThanOrEqual(asSa.total + 5);
    });

    // D-AUTH-3: stats counts only what the caller's own list may show.
    it('stats: a non-admin role counts exactly the accounts its list shows (no SUPER_ADMIN / ADMIN)', async () => {
      const listTotal = (await authGet(app, '/api/users?limit=1', mgrTok)).json().total;
      const stats = (await authGet(app, '/api/users/stats', mgrTok)).json();
      const visible = await prisma.user.count({ where: { role: { notIn: ['SUPER_ADMIN', 'ADMIN'] } } });
      // Other suites create users concurrently: slack in both directions, but far
      // below the size of the hidden SUPER_ADMIN + ADMIN population.
      expect(stats.total).toBeLessThanOrEqual(listTotal + 3);
      expect(stats.total).toBeGreaterThanOrEqual(listTotal - 3);
      expect(Math.abs(stats.total - visible)).toBeLessThanOrEqual(3);
      const hiddenLocked = await prisma.user.count({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ENABLED' } });
      expect(hiddenLocked).toBeGreaterThan(0); // the test is only meaningful while hidden accounts exist
      expect(stats.enabled).toBeLessThanOrEqual(await prisma.user.count({ where: { role: { notIn: ['SUPER_ADMIN', 'ADMIN'] }, status: 'ENABLED' } }) + 3);
    });

    it('detail hides SUPER_ADMIN from non-SA and ADMIN from non-ADMIN; unknown is 404', async () => {
      expect((await authGet(app, `/api/users/${ids.SA}`, mgrTok)).statusCode).toBe(404);
      expect((await authGet(app, `/api/users/${ids.ADM}`, mgrTok)).statusCode).toBe(404);
      expect((await authGet(app, `/api/users/${ids.SA}`, admTok)).statusCode).toBe(404);
      const admSeesAdm = await authGet(app, `/api/users/${ids.ADM}`, admTok);
      expect(admSeesAdm.statusCode).toBe(200);
      expect(admSeesAdm.json()).toMatchObject({ username: ADM, role: 'ADMIN' });
      expect(admSeesAdm.json()).not.toHaveProperty('passwordHash');
      expect((await authGet(app, `/api/users/${ids.SA}`, saTok)).statusCode).toBe(200);
      expect((await authGet(app, '/api/users/00000000-0000-4000-8000-0000000000cd', saTok)).statusCode).toBe(404);
    });
  });

  describe('create', () => {
    it('creates a user, stores a blank email as NULL, records history, audit and notification', async () => {
      const username = await validUserId();
      createdUsernames.push(username);
      const res = await authPost(app, '/api/users', saTok, {
        username, fullName: 'Cov Created', email: '', role: R_LOW, password: PW, confirmPassword: PW, department: 'QA',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ username, fullName: 'Cov Created', role: R_LOW, status: 'ENABLED', department: 'QA' });
      const row = await prisma.user.findUnique({ where: { username } });
      expect(row).toMatchObject({ email: null, forcePasswordChange: true, isTemporaryPassword: true, createdBy: SA });
      expect(await prisma.passwordHistory.count({ where: { userId: row!.id } })).toBe(1);
      const audit = await auditFor('USER_CREATED', row!.id);
      expect(audit).toMatchObject({ userId: SA, signatureMeaning: 'New user account created by administrator' });
      expect(audit?.afterValue).toMatchObject({ username, role: R_LOW });
      await expectChained(audit);
      const n = await prisma.notification.findFirst({ where: { type: 'USER_CREATED', targetUserId: username } });
      expect(n?.forRole).toBe('ADMIN');
    });

    it('400s mismatched confirmation, an invalid User ID and a policy-weak password', async () => {
      const username = await validUserId();
      const mismatch = await authPost(app, '/api/users', saTok, { username, fullName: 'X', role: R_LOW, password: PW, confirmPassword: PW + 'z' });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().error).toBe('VALIDATION_ERROR');

      const badId = await authPost(app, '/api/users', saTok, { username: 'cva-not-valid-id!', fullName: 'X', role: R_LOW, password: PW, confirmPassword: PW });
      expect(badId.statusCode).toBe(400);
      expect(badId.json().error).toBe('VALIDATION_ERROR');

      const weak = await authPost(app, '/api/users', saTok, { username, fullName: 'X', role: R_LOW, password: 'alllowercase', confirmPassword: 'alllowercase' });
      expect(weak.statusCode).toBe(400);
      expect(await prisma.user.findUnique({ where: { username } })).toBeNull();
      expect(internalErrors).toHaveLength(0);
    });

    it('400s an inactive or unknown role, 403s a role above the creator', async () => {
      const username = await validUserId();
      const off = await authPost(app, '/api/users', saTok, { username, fullName: 'X', role: R_OFF, password: PW, confirmPassword: PW });
      expect(off.statusCode).toBe(400);
      expect(off.json().message).toBe(`Role ${R_OFF} does not exist or is inactive`);
      const above = await authPost(app, '/api/users', mgrTok, { username, fullName: 'X', role: R_HIGH, password: PW, confirmPassword: PW });
      expect(above.statusCode).toBe(403);
      expect(above.json().message).toBe(`Cannot create users with role ${R_HIGH}`);
    });

    it('409s a duplicate User ID and a duplicate email, naming which', async () => {
      const taken = createdUsernames[0];
      const dupId = await authPost(app, '/api/users', saTok, { username: taken, fullName: 'X', role: R_LOW, password: PW, confirmPassword: PW });
      expect(dupId.statusCode).toBe(409);
      expect(dupId.json().message).toBe(`User ID "${taken}" already exists`);

      const email = `cva.${S.toLowerCase()}@example.com`;
      await prisma.user.update({ where: { id: ids.LOW1 }, data: { email } });
      const fresh = await validUserId();
      const dupEmail = await authPost(app, '/api/users', saTok, { username: fresh, fullName: 'X', email, role: R_LOW, password: PW, confirmPassword: PW });
      expect(dupEmail.statusCode).toBe(409);
      expect(dupEmail.json().message).toBe('Email already exists');
    });
  });

  describe('update', () => {
    it('404s an unknown user', async () => {
      const res = await authPut(app, '/api/users/00000000-0000-4000-8000-0000000000ce', saTok, { fullName: 'X' });
      expect(res.statusCode).toBe(404);
    });

    it('400s an invalid email (zod)', async () => {
      const res = await authPut(app, `/api/users/${ids.LOW2}`, saTok, { email: 'not-an-email' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    });

    it('a manager cannot touch a user above it, change its own role, or assign a role above it', async () => {
      const high = await authPut(app, `/api/users/${ids.HIGH}`, mgrTok, { fullName: 'Nope' });
      expect(high.statusCode).toBe(403);
      expect(high.json().message).toBe('You cannot manage a user whose role is higher than yours');

      const self = await authPut(app, `/api/users/${ids.MGR}`, mgrTok, { role: R_LOW });
      expect(self.statusCode).toBe(403);
      expect(self.json().message).toBe('Cannot change your own role');

      const raise = await authPut(app, `/api/users/${ids.LOW2}`, mgrTok, { role: R_HIGH });
      expect(raise.statusCode).toBe(403);
      expect(raise.json().message).toBe(`Cannot assign role ${R_HIGH}`);
      expect((await prisma.user.findUnique({ where: { id: ids.LOW2 } }))?.role).toBe(R_LOW);
    });

    it('normalises a blank email to NULL and 409s an email another user holds', async () => {
      await prisma.user.update({ where: { id: ids.LOW2 }, data: { email: `cva.l2.${S.toLowerCase()}@example.com` } });
      const blank = await authPut(app, `/api/users/${ids.LOW2}`, saTok, { email: '' });
      expect(blank.statusCode).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: ids.LOW2 } }))?.email).toBeNull();

      const taken = (await prisma.user.findUnique({ where: { id: ids.LOW1 } }))!.email!;
      const dup = await authPut(app, `/api/users/${ids.LOW2}`, saTok, { email: taken });
      expect(dup.statusCode).toBe(409);
    });

    it('a role change ends the target\'s sessions and is audited without any password', async () => {
      const tok = await login(app, LOW3, PW);
      const res = await authPut(app, `/api/users/${ids.LOW3}`, saTok, { role: R_MGR, fullName: 'Cov Promoted' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: R_MGR, fullName: 'Cov Promoted' });
      const sessions = await prisma.session.findMany({ where: { userId: ids.LOW3 } });
      expect(sessions.every((s) => !s.isActive)).toBe(true);
      expect(sessions.some((s) => s.terminationReason === 'role_changed')).toBe(true);
      expect((await authGet(app, '/api/users/stats', tok)).statusCode).toBe(401);
      const audit = await auditFor('USER_UPDATED', ids.LOW3);
      expect(audit?.beforeValue).toMatchObject({ role: R_LOW });
      expect(audit?.afterValue).toMatchObject({ role: R_MGR, username: LOW3 });
      expect(JSON.stringify(audit?.afterValue)).not.toMatch(/password/i);
      await prisma.user.update({ where: { id: ids.LOW3 }, data: { role: R_LOW } });
    });

    it('disabling through update ends sessions with reason account_disabled', async () => {
      await login(app, LOW3, PW);
      const res = await authPut(app, `/api/users/${ids.LOW3}`, saTok, { status: 'DISABLED' });
      expect(res.statusCode).toBe(200);
      const s = await prisma.session.findFirst({ where: { userId: ids.LOW3 }, orderBy: { createdAt: 'desc' } });
      expect(s).toMatchObject({ isActive: false, terminationReason: 'account_disabled' });
      await prisma.user.update({ where: { id: ids.LOW3 }, data: { status: 'ENABLED' } });
    });
  });

  describe('enable / disable / unlock / reset-password', () => {
    it('disable ends sessions, notifies admins and the user; enable restores', async () => {
      await login(app, LOW2, PW);
      const dis = await authPost(app, `/api/users/${ids.LOW2}/disable`, mgrTok);
      expect(dis.statusCode).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: ids.LOW2 } }))?.status).toBe('DISABLED');
      expect(await prisma.session.count({ where: { userId: ids.LOW2, isActive: true } })).toBe(0);
      expect(await auditFor('USER_DISABLED', ids.LOW2)).toMatchObject({ userId: MGR, afterValue: { status: 'DISABLED' } });
      expect(await prisma.notification.count({ where: { type: 'ACCOUNT_DISABLED', targetUserId: LOW2 } })).toBe(2);

      const en = await authPost(app, `/api/users/${ids.LOW2}/enable`, mgrTok);
      expect(en.statusCode).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: ids.LOW2 } }))?.status).toBe('ENABLED');
      expect(await auditFor('USER_ENABLED', ids.LOW2)).toMatchObject({ beforeValue: { status: 'DISABLED' } });
      expect(await prisma.notification.count({ where: { type: 'ACCOUNT_ENABLED', forUserId: LOW2 } })).toBe(1);
    });

    it('404s and 403s on every account action', async () => {
      const missing = '00000000-0000-4000-8000-0000000000cf';
      for (const [path, body] of [['enable', undefined], ['disable', undefined], ['unlock', { newPassword: NEW_PW }], ['reset-password', { newPassword: NEW_PW }]] as const) {
        expect((await authPost(app, `/api/users/${missing}/${path}`, saTok, body)).statusCode).toBe(404);
        const forbidden = await authPost(app, `/api/users/${ids.HIGH}/${path}`, mgrTok, body);
        expect(forbidden.statusCode).toBe(403);
      }
      expect((await prisma.user.findUnique({ where: { id: ids.HIGH } }))?.status).toBe('ENABLED');
    });

    it('unlock sets a temporary password, clears the lock and ends sessions', async () => {
      await prisma.user.update({ where: { id: ids.LOW1 }, data: { status: 'LOCKED', failedLoginAttempts: 5, lockedAt: new Date() } });
      const weak = await authPost(app, `/api/users/${ids.LOW1}/unlock`, mgrTok, { newPassword: 'weakpassword' });
      expect(weak.statusCode).toBe(400);
      const res = await authPost(app, `/api/users/${ids.LOW1}/unlock`, mgrTok, { newPassword: NEW_PW });
      expect(res.statusCode).toBe(200);
      const u = await prisma.user.findUnique({ where: { id: ids.LOW1 } });
      expect(u).toMatchObject({ status: 'ENABLED', failedLoginAttempts: 0, lockedAt: null, forcePasswordChange: true, isTemporaryPassword: true });
      expect(await verifyPassword(NEW_PW, u!.passwordHash)).toBe(true);
      expect(await auditFor('ACCOUNT_UNLOCKED', ids.LOW1)).toMatchObject({ beforeValue: { status: 'LOCKED', failedLoginAttempts: 5 } });
    });

    it('reset-password sets a temporary password and ends sessions with reason password_reset', async () => {
      await login(app, LOW2, PW);
      const res = await authPost(app, `/api/users/${ids.LOW2}/reset-password`, saTok, { newPassword: NEW_PW });
      expect(res.statusCode).toBe(200);
      const u = await prisma.user.findUnique({ where: { id: ids.LOW2 } });
      expect(u).toMatchObject({ forcePasswordChange: true, isTemporaryPassword: true, status: 'ENABLED' });
      const s = await prisma.session.findFirst({ where: { userId: ids.LOW2 }, orderBy: { createdAt: 'desc' } });
      expect(s).toMatchObject({ isActive: false, terminationReason: 'password_reset' });
      expect(await auditFor('PASSWORD_RESET', ids.LOW2)).toMatchObject({ signatureMeaning: 'Administrator reset user password' });
      const weak = await authPost(app, `/api/users/${ids.LOW2}/reset-password`, saTok, { newPassword: 'nouppercase1!' });
      expect(weak.statusCode).toBe(400);
    });
  });

  describe('password reset requests', () => {
    let reqA = '', reqB = '', reqHigh = '', reqGhost = '';
    beforeAll(async () => {
      reqA = (await prisma.passwordResetRequest.create({ data: { userId: ids.LOW1 } })).id;
      reqB = (await prisma.passwordResetRequest.create({ data: { userId: ids.LOW2 } })).id;
      reqHigh = (await prisma.passwordResetRequest.create({ data: { userId: ids.HIGH } })).id;
      reqGhost = (await prisma.passwordResetRequest.create({ data: { userId: '00000000-0000-4000-8000-0000000000d0' } })).id;
      resetRequestIds.push(reqA, reqB, reqHigh, reqGhost);
    });

    it('lists requests with the employee ID (not the uuid) and counts pending ones', async () => {
      const res = await authGet(app, '/api/users/reset-requests', mgrTok);
      expect(res.statusCode).toBe(200);
      const mine = res.json().data.find((r: any) => r.id === reqA);
      expect(mine).toMatchObject({ userId: LOW1, userFullName: `Coverage ${LOW1}`, status: 'PENDING' });
      // A request whose user row is gone falls back to the raw id.
      expect(res.json().data.find((r: any) => r.id === reqGhost)).toMatchObject({ userId: '00000000-0000-4000-8000-0000000000d0', userEmail: '' });
      const count = await authGet(app, '/api/users/reset-requests/pending', mgrTok);
      expect(count.json().count).toBeGreaterThanOrEqual(4);
    });

    it('validates before approving: unknown id 404, missing / weak password 400, ghost user 404', async () => {
      expect((await authPost(app, '/api/users/reset-requests/00000000-0000-4000-8000-0000000000d1/process', saTok, { action: 'reject', notes: 'unknown id' })).statusCode).toBe(404);
      const noPw = await authPost(app, `/api/users/reset-requests/${reqA}/process`, saTok, { action: 'approve', notes: 'no password' });
      expect(noPw.statusCode).toBe(400);
      expect(noPw.json().message).toBe('New password is required');
      const weak = await authPost(app, `/api/users/reset-requests/${reqA}/process`, saTok, { action: 'approve', newPassword: 'weakweak', notes: 'weak' });
      expect(weak.statusCode).toBe(400);
      const ghost = await authPost(app, `/api/users/reset-requests/${reqGhost}/process`, saTok, { action: 'reject', notes: 'ghost' });
      expect(ghost.statusCode).toBe(404);
      expect(ghost.json().message).toBe('User not found');
      expect((await prisma.passwordResetRequest.findUnique({ where: { id: reqA } }))?.status).toBe('PENDING');
    });

    it('a manager may not process a request for a user above it', async () => {
      const res = await authPost(app, `/api/users/reset-requests/${reqHigh}/process`, mgrTok, { action: 'reject', notes: 'above me' });
      expect(res.statusCode).toBe(403);
      expect((await prisma.passwordResetRequest.findUnique({ where: { id: reqHigh } }))?.status).toBe('PENDING');
    });

    it('approves: sets the temporary password, closes the request, audits and notifies', async () => {
      const res = await authPost(app, `/api/users/reset-requests/${reqA}/process`, mgrTok, { action: 'approve', newPassword: NEW_PW + 'a', notes: 'ok' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, message: 'Password reset approved and new password set.' });
      const r = await prisma.passwordResetRequest.findUnique({ where: { id: reqA } });
      expect(r).toMatchObject({ status: 'APPROVED', processedBy: MGR, notes: 'ok' });
      const u = await prisma.user.findUnique({ where: { id: ids.LOW1 } });
      expect(await verifyPassword(NEW_PW + 'a', u!.passwordHash)).toBe(true);
      expect(await auditFor('PASSWORD_RESET_REQUEST_APPROVED', ids.LOW1)).toMatchObject({ afterValue: { requestId: reqA, username: LOW1 } });
      expect(await prisma.notification.count({ where: { type: 'PASSWORD_RESET_APPROVED', targetUserId: LOW1 } })).toBe(2);

      const again = await authPost(app, `/api/users/reset-requests/${reqA}/process`, mgrTok, { action: 'reject', notes: 'again' });
      expect(again.statusCode).toBe(400);
      expect(again.json().message).toBe('Reset request has already been processed');
    });

    it('rejects: closes the request without touching the password', async () => {
      const before = (await prisma.user.findUnique({ where: { id: ids.LOW2 } }))!.passwordHash;
      const res = await authPost(app, `/api/users/reset-requests/${reqB}/process`, saTok, { action: 'reject', notes: 'no' });
      expect(res.json()).toEqual({ success: true, message: 'Password reset request rejected.' });
      expect((await prisma.passwordResetRequest.findUnique({ where: { id: reqB } }))?.status).toBe('REJECTED');
      expect((await prisma.user.findUnique({ where: { id: ids.LOW2 } }))!.passwordHash).toBe(before);
      expect(await auditFor('PASSWORD_RESET_REQUEST_REJECTED', reqB)).toMatchObject({ afterValue: { username: LOW2, notes: 'no' } });
      expect(await prisma.notification.count({ where: { type: 'PASSWORD_RESET_REJECTED', forUserId: LOW2 } })).toBe(1);
    });
  });

  describe('re-auth gate (role with every user action configured)', () => {
    it('401s REAUTH_REQUIRED on each gated write and changes nothing', async () => {
      const username = await validUserId();
      const calls: Array<[string, () => Promise<any>]> = [
        ['CREATE_USER', () => authPost(app, '/api/users', rauTok, { username, fullName: 'X', role: R_LOW, password: PW, confirmPassword: PW })],
        ['UPDATE_USER', () => authPut(app, `/api/users/${ids.LOW3}`, rauTok, { fullName: 'Nope' })],
        ['ENABLE_USER', () => authPost(app, `/api/users/${ids.LOW3}/enable`, rauTok)],
        ['DISABLE_USER', () => authPost(app, `/api/users/${ids.LOW3}/disable`, rauTok)],
        ['UNLOCK_USER', () => authPost(app, `/api/users/${ids.LOW3}/unlock`, rauTok, { newPassword: NEW_PW })],
        ['RESET_PASSWORD', () => authPost(app, `/api/users/${ids.LOW3}/reset-password`, rauTok, { newPassword: NEW_PW })],
        ['PROCESS_RESET_REQUEST', () => authPost(app, `/api/users/reset-requests/${resetRequestIds[2]}/process`, rauTok, { action: 'reject', notes: 'signed' })],
      ];
      for (const [action, call] of calls) {
        const res = await call();
        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action });
      }
      expect(await prisma.user.findUnique({ where: { username } })).toBeNull();
      expect((await prisma.user.findUnique({ where: { id: ids.LOW3 } }))).toMatchObject({ fullName: 'Cov Promoted', status: 'ENABLED' });
    });

    it('with the password the same update goes through', async () => {
      const res = await authPut(app, `/api/users/${ids.LOW3}`, rauTok, { fullName: 'Signed Name' }, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json().fullName).toBe('Signed Name');
    });
  });

  describe('delete / bulk delete (SUPER_ADMIN only)', () => {
    it('403s a non-SA caller', async () => {
      expect((await authDelete(app, `/api/users/${ids.LOW3}`, mgrTok)).statusCode).toBe(403);
      expect((await authPost(app, '/api/users/bulk-delete', admTok, { userIds: [ids.LOW3] })).statusCode).toBe(403);
    });

    it('refuses self-delete, an unknown id, and a SUPER_ADMIN target', async () => {
      const self = await authDelete(app, `/api/users/${ids.SA}`, saTok);
      expect(self.statusCode).toBe(400);
      expect(self.json().message).toBe('Cannot delete your own account');
      expect((await authDelete(app, '/api/users/00000000-0000-4000-8000-0000000000d2', saTok)).statusCode).toBe(404);
      const sa2 = await authDelete(app, `/api/users/${ids.SA2}`, saTok);
      expect(sa2.statusCode).toBe(403);
      expect(sa2.json().message).toBe('Cannot delete SUPER_ADMIN users');
    });

    it('deletes a user together with its user_configs row, auditing first', async () => {
      const username = await validUserId();
      createdUsernames.push(username);
      const id = await createUser(username, R_LOW, PW);
      await prisma.userConfig.create({ data: { userId: id, sidebarItems: ['users'] } });
      const res = await authDelete(app, `/api/users/${id}`, saTok);
      expect(res.statusCode).toBe(200);
      expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
      expect(await prisma.userConfig.count({ where: { userId: id } })).toBe(0);
      const audit = await auditFor('USER_DELETED', id);
      expect(audit).toMatchObject({ beforeValue: { username, role: R_LOW }, afterValue: { deleted: true } });
      await expectChained(audit);
    });

    it('bulk delete refuses self, nothing-found and SUPER_ADMIN; 400s more than 50 ids', async () => {
      const self = await authPost(app, '/api/users/bulk-delete', saTok, { userIds: [ids.SA, ids.LOW3] });
      expect(self.statusCode).toBe(400);
      const none = await authPost(app, '/api/users/bulk-delete', saTok, { userIds: ['00000000-0000-4000-8000-0000000000d3'] });
      expect(none.statusCode).toBe(404);
      const sa = await authPost(app, '/api/users/bulk-delete', saTok, { userIds: [ids.SA2, ids.LOW3] });
      expect(sa.statusCode).toBe(403);
      expect(sa.json().message).toBe(`Cannot delete SUPER_ADMIN users: ${SA2}`);
      const tooMany = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      const big = await authPost(app, '/api/users/bulk-delete', saTok, { userIds: tooMany });
      expect(big.statusCode).toBe(400);
      expect(big.json().error).toBe('VALIDATION_ERROR');
      expect(await prisma.user.findUnique({ where: { id: ids.LOW3 } })).not.toBeNull();
    });

    it('bulk deletes several users and audits each one', async () => {
      const u1 = await validUserId();
      const u2 = await validUserId();
      createdUsernames.push(u1, u2);
      const id1 = await createUser(u1, R_LOW, PW);
      const id2 = await createUser(u2, R_LOW, PW);
      const res = await authPost(app, '/api/users/bulk-delete', saTok, { userIds: [id1, id2] });
      expect(res.statusCode).toBe(200);
      expect(res.json().deletedCount).toBe(2);
      expect(res.json().deletedUsers.map((u: any) => u.username).sort()).toEqual([u1, u2].sort());
      expect(await prisma.user.count({ where: { id: { in: [id1, id2] } } })).toBe(0);
      for (const id of [id1, id2]) expect(await auditFor('BULK_USER_DELETED', id)).toMatchObject({ afterValue: { deleted: true } });
    });
  });

  describe('roles that no longer resolve (fail closed)', () => {
    it('a target whose role has no roles row cannot be managed by a non-SA (403)', async () => {
      const ghost = lc(`cva_us_gh_${S}`);
      ids.GHOST = await createUser(ghost, `CVA_GONE_${S}`, PW);
      const res = await authPost(app, `/api/users/${ids.GHOST}/disable`, mgrTok);
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe('Target user role is not recognized');
      expect((await prisma.user.findUnique({ where: { id: ids.GHOST } }))?.status).toBe('ENABLED');
    });

    it('a caller whose own role row was removed is refused by the service, even inside the permission cache window', async () => {
      const R_TMP = `CVA_UT_${S}`;
      const tmpUser = lc(`cva_us_tm_${S}`);
      await makeRole(R_TMP, 4, MGR_PERMS);
      ids.TMP = await createUser(tmpUser, R_TMP, PW);
      const tok = await login(app, tmpUser, PW);
      // Warm the auth-plugin user cache and the rbac role-permission cache…
      expect((await authGet(app, '/api/users/stats', tok)).statusCode).toBe(200);
      // …then remove the role row directly (no cache invalidation), as a restore would.
      await prisma.role.delete({ where: { name: R_TMP } });
      const upd = await authPut(app, `/api/users/${ids.LOW3}`, tok, { fullName: 'Should Not Apply' });
      const crt = await authPost(app, '/api/users', tok, { username: await validUserId(), fullName: 'X', role: R_LOW, password: PW, confirmPassword: PW });
      // The rbac cache lives 5 s; inside it the service's own role lookup is the guard.
      for (const res of [upd, crt]) {
        expect(res.statusCode).toBe(403);
        expect(['Your role is not recognized', 'Permission denied']).toContain(res.json().message);
      }
      expect((await prisma.user.findUnique({ where: { id: ids.LOW3 } }))?.fullName).not.toBe('Should Not Apply');
    });

    it('creating without any email field stores NULL; updating email to null keeps it NULL', async () => {
      const username = await validUserId();
      createdUsernames.push(username);
      const res = await authPost(app, '/api/users', saTok, { username, fullName: 'No Email', role: R_LOW, password: PW, confirmPassword: PW });
      expect(res.statusCode).toBe(201);
      const row = await prisma.user.findUnique({ where: { username } });
      expect(row?.email).toBeNull();
      const upd = await authPut(app, `/api/users/${row!.id}`, saTok, { email: null, department: 'Lab' });
      expect(upd.statusCode).toBe(200);
      expect(await prisma.user.findUnique({ where: { username } })).toMatchObject({ email: null, department: 'Lab' });
    });
  });

  describe('password-expiry sweep trigger', () => {
    it('is gated on CONFIG_UPDATE', async () => {
      expect((await authPost(app, '/api/users/password-expiry-sweep', mgrTok)).statusCode).toBe(403);
    });

    it('runs the sweep and returns exactly the counters', async () => {
      const policy = (await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } }))?.configValue as any;
      const res = await authPost(app, '/api/users/password-expiry-sweep', saTok);
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json()).sort()).toEqual(['expired', 'warned']);
      // With the warning window off (0) the sweep is a no-op by definition.
      if (!(Number(policy?.expiryNotificationDays ?? 0) > 0)) expect(res.json()).toEqual({ warned: 0, expired: 0 });
    });
  });
});
