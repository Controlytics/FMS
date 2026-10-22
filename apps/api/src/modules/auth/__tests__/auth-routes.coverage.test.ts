/**
 * Auth routes (coverage, 2026-10-21) through the real stack and test DB:
 * login (every account-state branch, lockout, session conflict / force,
 * password expiry), logout reasons, refresh, beacon logout, profile,
 * change-password policy checks, /verify, forgot-password and the
 * offline-replay grant — asserting status, body, the rows written (sessions,
 * history, reset requests, notifications) and the audit rows.
 *
 * Owns every user and role it touches (prefix `cva`). The password policy and
 * login-security settings are only READ, to compute expectations.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp, authGet, authPost, authPut, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../../lib/password.js';
import { cleanupAll, runSuffix, createUser, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant } from '../../../e2e/support/owned-fixtures.js';
import { makeRole, auditFor, expectChained } from '../../users/__tests__/support/cva-fixtures.js';

const S = runSuffix();
const lc = (s: string) => s.toLowerCase();
const PW = 'CvaAuth@2026x';
const R_USER = `CVA_AU_${S}`;
const R_RAU = `CVA_AV_${S}`;

let app: FastifyInstance;
const users: Record<string, string> = {};           // username -> id
let policy: Record<string, any> = {};
let policyUpdatedAt: Date | null = null;
let maxAttempts = 5;
let reauthAdded: ReauthGrant = [];

/** Create an owned user; returns its username. */
async function mk(tag: string, role = R_USER, extra: Record<string, unknown> = {}) {
  const username = lc(`cva_au_${tag}_${S}`);
  users[username] = await createUser(username, role, PW, `Cov ${tag}`);
  if (Object.keys(extra).length) await prisma.user.update({ where: { username }, data: extra as any });
  return username;
}

const loginReq = (username: string, password = PW, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password, ...extra } });

/** Log in fresh (any earlier session for the user is ended first). */
async function freshLogin(username: string, password = PW) {
  await prisma.session.updateMany({ where: { user: { username }, isActive: true }, data: { isActive: false, terminationReason: 'test_cleanup' } });
  const res = await loginReq(username, password);
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

const userRow = (username: string) => prisma.user.findUnique({ where: { username } });

describe('auth routes', () => {
  beforeAll(async () => {
    await makeRole(R_USER, 2, ['USER_READ']);
    await makeRole(R_RAU, 2, ['USER_READ']);
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
    policy = (row?.configValue as Record<string, any>) ?? {};
    policyUpdatedAt = row?.updatedAt ?? null;
    maxAttempts = Number(policy.maxFailedAttempts ?? 5);
    reauthAdded = await addReauth([['UPDATE_PROFILE', R_RAU]]);
    app = await buildApp();
  }, 60_000);

  afterAll(async () => {
    const names = Object.keys(users);
    const ids = Object.values(users);
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['reset requests', () => prisma.passwordResetRequest.deleteMany({ where: { userId: { in: ids } } })],
      ['notifications', () => prisma.notification.deleteMany({ where: { OR: [{ targetUserId: { in: names } }, { forUserId: { in: names } }] } })],
      ['users', () => deleteUsers(ids)],
      ['roles', () => deleteRoles([R_USER, R_RAU])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  describe('login', () => {
    it('400s a body that fails the shared schema', async () => {
      const res = await loginReq('', 'x');
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
      expect(internalErrors).toHaveLength(0);
    });

    it('an unknown user gets the same 401 as a wrong password', async () => {
      const res = await loginReq(lc(`cva_au_nobody_${S}`));
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'INVALID_CREDENTIALS', message: 'User ID or password is incorrect.' });
    });

    it('a wrong password counts the attempt and writes LOGIN_FAILED', async () => {
      const u = await mk('wrong');
      const res = await loginReq(u, 'Nope@12345');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('INVALID_CREDENTIALS');
      expect((await userRow(u))?.failedLoginAttempts).toBe(1);
      const audit = await auditFor('LOGIN_FAILED', users[u]);
      expect(audit).toMatchObject({ userId: u, userRole: R_USER });
      await expectChained(audit);
    });

    it('the attempt that reaches the threshold locks the account, audits and notifies', async () => {
      const u = await mk('lockme', R_USER, { failedLoginAttempts: maxAttempts - 1 });
      const res = await loginReq(u, 'Nope@12345');
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('ACCOUNT_LOCKED');
      const row = await userRow(u);
      expect(row).toMatchObject({ status: 'LOCKED', failedLoginAttempts: maxAttempts });
      expect(row?.lockedAt).toBeInstanceOf(Date);
      const sec = (await prisma.systemConfig.findUnique({ where: { configKey: 'login-security' } }))?.configValue as any;
      if ((sec?.lockoutType ?? 'TEMPORARY') === 'TEMPORARY') expect(row?.lockoutUntil!.getTime()).toBeGreaterThan(Date.now());
      else expect(row?.lockoutUntil).toBeNull();
      expect(await auditFor('ACCOUNT_LOCKED', users[u])).toBeTruthy();
      expect(await prisma.notification.count({ where: { type: 'ACCOUNT_LOCKED', targetUserId: u } })).toBe(2);
    });

    it('a wrong password on a non-ENABLED account answers 401 and changes nothing', async () => {
      const u = await mk('lockedwrong', R_USER, { status: 'LOCKED', failedLoginAttempts: 7, lockoutUntil: new Date(Date.now() + 3_600_000) });
      const res = await loginReq(u, 'Nope@12345');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('INVALID_CREDENTIALS');
      expect((await userRow(u))?.failedLoginAttempts).toBe(7);
    });

    it('LOCKED + right password: still locked inside the window, auto-unlocked after it', async () => {
      const inside = await mk('lockin', R_USER, { status: 'LOCKED', lockoutUntil: new Date(Date.now() + 3_600_000) });
      const r1 = await loginReq(inside);
      expect(r1.statusCode).toBe(403);
      expect(r1.json().error).toBe('ACCOUNT_LOCKED');

      const after = await mk('lockout', R_USER, { status: 'LOCKED', failedLoginAttempts: 5, lockoutUntil: new Date(Date.now() - 60_000) });
      const r2 = await loginReq(after);
      expect(r2.statusCode).toBe(200);
      expect(await userRow(after)).toMatchObject({ status: 'ENABLED', failedLoginAttempts: 0, lockoutUntil: null });
    });

    it('SUPER_ADMIN is never locked out: a LOCKED or EXPIRED SA recovers on a correct password', async () => {
      const locked = await mk('salock', 'SUPER_ADMIN', { status: 'LOCKED', lockoutUntil: new Date(Date.now() + 3_600_000) });
      expect((await loginReq(locked)).statusCode).toBe(200);
      expect((await userRow(locked))?.status).toBe('ENABLED');

      const expired = await mk('saexp', 'SUPER_ADMIN', { status: 'EXPIRED', forcePasswordChange: true });
      expect((await loginReq(expired)).statusCode).toBe(200);
      expect(await userRow(expired)).toMatchObject({ status: 'ENABLED', forcePasswordChange: false });

      // And a wrong password on an SA never counts toward a lock.
      expect((await loginReq(locked, 'Nope@12345')).statusCode).toBe(401);
      expect((await userRow(locked))?.failedLoginAttempts).toBe(0);
    });

    it('DISABLED + right password → 403 ACCOUNT_DISABLED', async () => {
      const u = await mk('disabled', R_USER, { status: 'DISABLED' });
      const res = await loginReq(u);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('ACCOUNT_DISABLED');
    });

    it('EXPIRED: a pending temporary password is let through to change it; otherwise 403', async () => {
      const temp = await mk('exptemp', R_USER, { status: 'EXPIRED', isTemporaryPassword: true, forcePasswordChange: true });
      const r1 = await loginReq(temp);
      expect(r1.statusCode).toBe(200);
      expect(r1.json().user).toMatchObject({ forcePasswordChange: true, isTemporaryPassword: true });
      expect((await userRow(temp))?.status).toBe('ENABLED');

      const plain = await mk('expplain', R_USER, { status: 'EXPIRED' });
      const r2 = await loginReq(plain);
      expect(r2.statusCode).toBe(403);
      expect(r2.json().error).toBe('PASSWORD_EXPIRED');
    });

    it('a password older than the policy allows forces a change at login (judged against the live policy)', async () => {
      const days = Number(policy.passwordExpiryDays ?? 0);
      const old = new Date(Date.now() - (days + 30) * 86_400_000);
      const u = await mk('aged', R_USER, { passwordChangedAt: old, createdAt: old });
      const res = await loginReq(u);
      expect(res.statusCode).toBe(200);
      // The policy's own save time floors the anchor (lib/password-expiry.ts).
      const anchor = policyUpdatedAt && policyUpdatedAt > old ? policyUpdatedAt : old;
      const expected = days > 0 && anchor.getTime() + days * 86_400_000 < Date.now();
      expect(res.json().user.forcePasswordChange).toBe(expected);
      expect((await userRow(u))?.forcePasswordChange).toBe(expected);
      const audit = await auditFor('PASSWORD_EXPIRED', users[u]);
      expect(Boolean(audit)).toBe(expected);
    });

    it('a second login answers SESSION_CONFLICT (no IP disclosed); force ends the old session', async () => {
      const u = await mk('conflict');
      const first = await loginReq(u, PW, { client: 'web' });
      expect(first.statusCode).toBe(200);
      const firstSession = await prisma.session.findFirst({ where: { userId: users[u], isActive: true } });

      const second = await loginReq(u);
      expect(second.statusCode).toBe(409);
      const body = second.json();
      expect(body.error).toBe('SESSION_CONFLICT');
      expect(Object.keys(body.activeSession).sort()).toEqual(['lastActiveAt', 'loginTime']);
      expect(body.activeSession.loginTime).toBe(firstSession!.createdAt.toISOString());

      const forced = await loginReq(u, PW, { force: true });
      expect(forced.statusCode).toBe(200);
      expect(await prisma.session.findUnique({ where: { id: firstSession!.id } })).toMatchObject({ isActive: false, terminationReason: 'new_login' });
      const audit = await auditFor('FORCED_LOGOUT', firstSession!.id);
      expect(audit).toMatchObject({ userId: u, signatureMeaning: 'Previous sessions terminated by user on new login' });
      // The old token no longer authenticates.
      expect((await authGet(app, '/api/auth/me', first.json().token)).statusCode).toBe(401);
    });

    it('a successful login records the session, resets the counter, and audits LOGIN_SUCCESS', async () => {
      const u = await mk('ok', R_USER, { failedLoginAttempts: 2 });
      const res = await loginReq(u);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ success: true, user: { username: u, role: R_USER }, expiresIn: expect.stringMatching(/^\d+h$/) });
      const row = await userRow(u);
      expect(row?.failedLoginAttempts).toBe(0);
      expect(row?.lastLogin).toBeInstanceOf(Date);
      const s = await prisma.session.findFirst({ where: { userId: users[u], isActive: true } });
      expect(s).toBeTruthy();
      expect(await auditFor('LOGIN_SUCCESS', users[u])).toMatchObject({ sessionId: s!.id });
    });
  });

  describe('logout / refresh / beacon', () => {
    it('logout records the reason: idle_timeout vs manual', async () => {
      const u = await mk('logout');
      const tok = await freshLogin(u);
      const s = await prisma.session.findFirst({ where: { userId: users[u], isActive: true } });
      const res = await authPost(app, '/api/auth/logout', tok, { reason: 'idle_timeout' });
      expect(res.json()).toEqual({ success: true });
      expect(await prisma.session.findUnique({ where: { id: s!.id } })).toMatchObject({ isActive: false, terminationReason: 'idle_timeout' });
      expect((await auditFor('LOGOUT', s!.id))?.signatureMeaning).toBe(`Session ended by idle auto-logout for "${u}"`);

      const tok2 = await freshLogin(u);
      const s2 = await prisma.session.findFirst({ where: { userId: users[u], isActive: true } });
      // An empty body defaults to a manual logout. (A request with NO body at all
      // is refused 400 "body must be object" — recorded as defect D-AUTH-1.)
      const plain = await authPost(app, '/api/auth/logout', tok2, {});
      expect(plain.json()).toEqual({ success: true });
      expect((await auditFor('LOGOUT', s2!.id))?.signatureMeaning).toBe(`User "${u}" logged out`);
      expect(await prisma.session.findUnique({ where: { id: s2!.id } })).toMatchObject({ isActive: false, terminationReason: 'manual' });
      expect((await authGet(app, '/api/auth/me', tok2)).statusCode).toBe(401);
    });

    it('refresh issues a working token carrying the current role', async () => {
      const u = await mk('refresh');
      const tok = await freshLogin(u);
      const res = await authPost(app, '/api/auth/refresh', tok);
      expect(res.statusCode).toBe(200);
      expect(res.json().expiresIn).toMatch(/^\d+h$/);
      const me = await authGet(app, '/api/auth/me', res.json().token);
      expect(me.json()).toMatchObject({ username: u, role: R_USER, permissions: ['USER_READ'] });
    });

    it('refresh refuses a session ended after the auth cache read it, and a user disabled the same way', async () => {
      const u = await mk('refresh2');
      const tok = await freshLogin(u);
      expect((await authGet(app, '/api/auth/me', tok)).statusCode).toBe(200); // caches session + user
      await prisma.session.updateMany({ where: { userId: users[u] }, data: { isActive: false, terminationReason: 'cov' } });
      const r1 = await authPost(app, '/api/auth/refresh', tok);
      expect(r1.statusCode).toBe(401);
      expect(r1.json().error).toBe('SESSION_INVALID');

      const v = await mk('refresh3');
      const tok2 = await freshLogin(v);
      expect((await authGet(app, '/api/auth/me', tok2)).statusCode).toBe(200);
      await prisma.user.update({ where: { username: v }, data: { status: 'DISABLED' } });
      const r2 = await authPost(app, '/api/auth/refresh', tok2);
      expect(r2.statusCode).toBe(401);
      expect(r2.json().error).toBe('ACCOUNT_INACTIVE');
    });

    it('beacon logout ends the session once; a bad or reused token is still a quiet 200', async () => {
      const u = await mk('beacon');
      const tok = await freshLogin(u);
      const s = await prisma.session.findFirst({ where: { userId: users[u], isActive: true } });
      const res = await app.inject({ method: 'POST', url: '/api/auth/beacon-logout', payload: { token: tok } });
      expect(res.json()).toEqual({ success: true });
      expect(await prisma.session.findUnique({ where: { id: s!.id } })).toMatchObject({ isActive: false, terminationReason: 'tab_closed' });
      expect(await prisma.auditTrail.count({ where: { action: 'LOGOUT', targetId: s!.id } })).toBe(1);

      expect((await app.inject({ method: 'POST', url: '/api/auth/beacon-logout', payload: { token: tok } })).statusCode).toBe(200);
      expect(await prisma.auditTrail.count({ where: { action: 'LOGOUT', targetId: s!.id } })).toBe(1);
      expect((await app.inject({ method: 'POST', url: '/api/auth/beacon-logout', payload: { token: 'garbage' } })).statusCode).toBe(200);

      const empty = await app.inject({ method: 'POST', url: '/api/auth/beacon-logout', payload: { token: '' } });
      expect(empty.statusCode).toBe(400);
      expect(empty.json().message).toBe('Token is required');
    });
  });

  describe('profile', () => {
    let u = '';
    let tok = '';
    beforeAll(async () => {
      u = await mk('profile');
      tok = await freshLogin(u);
    });

    it('updates name, email and department; blank department is stored as NULL; audited with before/after', async () => {
      const email = `cva.prof.${S.toLowerCase()}@example.com`;
      await prisma.user.update({ where: { username: u }, data: { department: 'Old' } });
      const res = await authPut(app, '/api/auth/profile', tok, { fullName: 'Prof Name', email, department: '' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ username: u, fullName: 'Prof Name', email, department: null });
      const audit = await auditFor('PROFILE_UPDATED', users[u]);
      expect(audit?.beforeValue).toMatchObject({ department: 'Old', fullName: `Cov profile` });
      expect(audit?.afterValue).toMatchObject({ email, department: null });
    });

    it('re-checks the name length after sanitising (trim shortens, escaping lengthens)', async () => {
      // ' a ' passes the schema (3 chars) but trims to 1.
      const short = await authPut(app, '/api/auth/profile', tok, { fullName: ' a ' });
      expect(short.statusCode).toBe(400);
      expect(short.json().message).toBe('Full name must be 2-100 characters');
      // 99 chars for the schema; `<` escapes to `&lt;`, pushing it past 100.
      const long = await authPut(app, '/api/auth/profile', tok, { fullName: '<' + 'n'.repeat(98) });
      expect(long.statusCode).toBe(400);
      expect(long.json().message).toBe('Full name must be 2-100 characters');
      expect((await userRow(u))?.fullName).toBe('Prof Name');
    });

    it('accepts only an upload-generated photo path', async () => {
      for (const photoUrl of ['https://evil.example/x.png', '/uploads/photos/../../win.ini', 'abc.png']) {
        const res = await authPut(app, '/api/auth/profile', tok, { photoUrl });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/Photo must be uploaded/);
      }
      const good = `/uploads/photos/${randomUUID()}-${randomUUID()}.png`;
      const ok = await authPut(app, '/api/auth/profile', tok, { photoUrl: good });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().photoUrl).toBe(good);
    });

    it('409s an email another account holds', async () => {
      const other = await mk('profile2');
      const taken = `cva.taken.${S.toLowerCase()}@example.com`;
      await prisma.user.update({ where: { username: other }, data: { email: taken } });
      const res = await authPut(app, '/api/auth/profile', tok, { email: taken });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe('Email already in use');
    });

    it('a role with UPDATE_PROFILE re-auth must sign: 401 without the password, 200 with it', async () => {
      const r = await mk('profrau', R_RAU);
      const t = await freshLogin(r);
      const no = await authPut(app, '/api/auth/profile', t, { department: 'Signed' });
      expect(no.statusCode).toBe(401);
      expect(no.json().error).toBe('REAUTH_REQUIRED');
      const yes = await authPut(app, '/api/auth/profile', t, { department: 'Signed' }, PW);
      expect(yes.statusCode).toBe(200);
      expect(yes.json().department).toBe('Signed');
    });
  });

  describe('change-password', () => {
    const NEW = 'CvaNewPw#2031z';
    const change = (tok: string, body: Record<string, unknown>) => authPost(app, '/api/auth/change-password', tok, body);

    it('400s mismatched confirmation (zod) and a missing current password', async () => {
      const u = await mk('cpzod');
      const tok = await freshLogin(u);
      const mismatch = await change(tok, { currentPassword: PW, newPassword: NEW, confirmPassword: NEW + 'x' });
      expect(mismatch.statusCode).toBe(400);
      expect(mismatch.json().error).toBe('VALIDATION_ERROR');
      const noCurrent = await change(tok, { newPassword: NEW, confirmPassword: NEW });
      expect(noCurrent.statusCode).toBe(400);
      expect(noCurrent.json()).toMatchObject({ error: 'INVALID_PASSWORD', message: 'Current password is required' });
    });

    it('a wrong current password counts toward lockout and can lock the account', async () => {
      const u = await mk('cpwrong');
      const tok = await freshLogin(u);
      // A successful login resets the counter, so set it afterwards: two misses lock.
      await prisma.user.update({ where: { username: u }, data: { failedLoginAttempts: maxAttempts - 2 } });
      const first = await change(tok, { currentPassword: 'Nope@12345', newPassword: NEW, confirmPassword: NEW });
      expect(first.statusCode).toBe(400);
      expect(first.json()).toMatchObject({ error: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
      const second = await change(tok, { currentPassword: 'Nope@12345', newPassword: NEW, confirmPassword: NEW });
      expect(second.statusCode).toBe(403);
      expect(second.json().error).toBe('ACCOUNT_LOCKED');
      expect((await userRow(u))?.status).toBe('LOCKED');
    });

    it('enforces the live policy: length, character classes, User ID', async () => {
      // A username that itself satisfies every character class.
      const username = `Cva#${S}a1`;
      users[username] = await createUser(username, R_USER, PW);
      const tok = await freshLogin(username);
      const maxLen = Number(policy.maxLength ?? 128);
      const cases: Array<[string, RegExp]> = [
        ['Aa1!' + 'x'.repeat(maxLen), new RegExp(`at most ${maxLen}`)],
        [username, /cannot be same as User ID/],
        ['Z9!' + username, /cannot contain User ID/],
      ];
      if (policy.requireUppercase) cases.push(['lowercase1!x', /uppercase letter/]);
      if (policy.requireNumbers) cases.push(['NoDigitsHere!x', /number/]);
      if (policy.requireSpecialChars) cases.push(['NoSpecial123x', /special character/]);
      for (const [pw, msg] of cases) {
        const res = await change(tok, { currentPassword: PW, newPassword: pw, confirmPassword: pw });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('POLICY_VIOLATION');
        expect(res.json().message).toMatch(msg);
      }
      expect(await verifyPassword(PW, (await userRow(username))!.passwordHash)).toBe(true);
    });

    it('a temporary-password user needs no current password but may not reuse the temporary one', async () => {
      const u = await mk('cptemp', R_USER, { isTemporaryPassword: true, forcePasswordChange: true });
      const tok = await freshLogin(u);
      const same = await change(tok, { newPassword: PW, confirmPassword: PW });
      expect(same.statusCode).toBe(400);
      expect(same.json().message).toBe('New password cannot be same as temporary password');
      const ok = await change(tok, { newPassword: NEW, confirmPassword: NEW });
      expect(ok.statusCode).toBe(200);
      expect(await userRow(u)).toMatchObject({ isTemporaryPassword: false, forcePasswordChange: false });
    });

    it('refuses a password from the history and, on success, ends the user\'s other sessions', async () => {
      const u = await mk('cphist');
      const reused = 'CvaOldPw#2020q';
      await prisma.passwordHistory.create({ data: { userId: users[u], passwordHash: await hashPassword(reused) } });
      const tok = await freshLogin(u);
      // An extra, older session for the same account.
      const other = await prisma.session.create({ data: { userId: users[u], tokenHash: `cva-${randomUUID()}`, ipAddress: '10.0.0.9', expiresAt: new Date(Date.now() + 3_600_000) } });
      const reuse = await change(tok, { currentPassword: PW, newPassword: reused, confirmPassword: reused });
      expect(reuse.statusCode).toBe(400);
      expect(reuse.json().message).toMatch(/cannot match any of your last \d+ passwords/);

      const ok = await change(tok, { currentPassword: PW, newPassword: NEW, confirmPassword: NEW });
      expect(ok.json()).toEqual({ success: true, message: 'Password changed successfully' });
      const row = await userRow(u);
      expect(await verifyPassword(NEW, row!.passwordHash)).toBe(true);
      expect(await prisma.passwordHistory.count({ where: { userId: users[u] } })).toBe(2);
      expect(await prisma.session.findUnique({ where: { id: other.id } })).toMatchObject({ isActive: false, terminationReason: 'password_changed' });
      expect((await authGet(app, '/api/auth/me', tok)).statusCode).toBe(200);
      expect(await auditFor('PASSWORD_CHANGED', users[u])).toMatchObject({ signatureMeaning: 'User changed password' });
    });
  });

  describe('verify', () => {
    it('400s an empty password', async () => {
      const u = await mk('vempty');
      const tok = await freshLogin(u);
      const res = await authPost(app, '/api/auth/verify', tok, { password: '' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'VALIDATION', message: 'Password is required' });
    });

    it('a wrong password is audited as a failed signature and counts toward lockout', async () => {
      const u = await mk('vwrong');
      const tok = await freshLogin(u);
      // A successful login resets the counter, so set it afterwards: two misses lock.
      await prisma.user.update({ where: { username: u }, data: { failedLoginAttempts: maxAttempts - 2 } });
      const r1 = await authPost(app, '/api/auth/verify', tok, { password: 'Nope@12345' });
      expect(r1.statusCode).toBe(401);
      expect(r1.json().error).toBe('INVALID_PASSWORD');
      const audit = await auditFor('REAUTH_FAILED', users[u]);
      expect(audit?.afterValue).toMatchObject({ reauthAction: 'VERIFICATION_TOKEN', accountLocked: false });
      const r2 = await authPost(app, '/api/auth/verify', tok, { password: 'Nope@12345' });
      expect(r2.statusCode).toBe(403);
      expect(r2.json().error).toBe('ACCOUNT_LOCKED');
    });

    it('the right password returns a token, clears the failure streak and audits the signature', async () => {
      const u = await mk('vok', R_USER, { failedLoginAttempts: 2 });
      const tok = await freshLogin(u);
      await prisma.user.update({ where: { username: u }, data: { failedLoginAttempts: 2 } });
      const res = await authPost(app, '/api/auth/verify', tok, { password: PW });
      expect(res.statusCode).toBe(200);
      expect(res.json().verificationToken).toEqual(expect.any(String));
      expect((await userRow(u))?.failedLoginAttempts).toBe(0);
      expect(await auditFor('REAUTH_SUCCESS', users[u])).toMatchObject({ signatureMeaning: 'Electronic signature applied for VERIFICATION_TOKEN' });
    });
  });

  describe('forgot-password (public)', () => {
    const forgot = (username: string) => app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username } });

    it('400s an empty User ID', async () => {
      const res = await forgot('');
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe('User ID is required');
    });

    it('answers identically for unknown, new and duplicate requests; only one request row is created', async () => {
      const u = await mk('forgot');
      const unknown = await forgot(lc(`cva_au_ghost_${S}`));
      const first = await forgot(u);
      const dup = await forgot(u);
      for (const r of [unknown, first, dup]) {
        expect(r.statusCode).toBe(200);
        expect(r.json()).toEqual({ success: true, message: 'If the user ID exists, a password reset request has been submitted.' });
      }
      expect(await prisma.passwordResetRequest.count({ where: { userId: users[u], status: 'PENDING' } })).toBe(1);
      expect(await prisma.auditTrail.count({ where: { action: 'PASSWORD_RESET_REQUESTED', targetId: users[u] } })).toBe(1);
      expect(await prisma.notification.count({ where: { type: 'PASSWORD_RESET_REQUEST', targetUserId: u } })).toBe(1);
    });
  });

  describe('offline-grant', () => {
    it('401s without a password', async () => {
      const u = await mk('ognopw');
      const tok = await freshLogin(u);
      const res = await authPost(app, '/api/auth/offline-grant', tok, {});
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('PASSWORD_REQUIRED');
    });

    it('issues a grant from the header password and clears the failure streak', async () => {
      const u = await mk('ogok');
      const tok = await freshLogin(u);
      await prisma.user.update({ where: { username: u }, data: { failedLoginAttempts: 1 } });
      const res = await app.inject({ method: 'POST', url: '/api/auth/offline-grant', headers: { authorization: `Bearer ${tok}`, 'x-reauth-password': PW }, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().token).toEqual(expect.any(String));
      expect(new Date(res.json().expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect((await userRow(u))?.failedLoginAttempts).toBe(0);
      // A successful grant is deliberately not audited (2026-08-27).
      expect(await prisma.auditTrail.count({ where: { action: 'GRANT_OFFLINE_REPLAY', userId: u } })).toBe(0);
    });

    it('a wrong password is audited and locks at the threshold', async () => {
      const u = await mk('ogwrong');
      const tok = await freshLogin(u);
      // A successful login resets the counter, so set it afterwards: two misses lock.
      await prisma.user.update({ where: { username: u }, data: { failedLoginAttempts: maxAttempts - 2 } });
      const r1 = await authPost(app, '/api/auth/offline-grant', tok, { _currentPassword: 'Nope@12345' });
      expect(r1.statusCode).toBe(401);
      expect(r1.json().error).toBe('REAUTH_FAILED');
      expect((await auditFor('REAUTH_FAILED', users[u]))?.afterValue).toMatchObject({ reauthAction: 'GRANT_OFFLINE_REPLAY', accountLocked: false });
      const r2 = await authPost(app, '/api/auth/offline-grant', tok, { _currentPassword: 'Nope@12345' });
      expect(r2.statusCode).toBe(403);
      expect(r2.json().error).toBe('ACCOUNT_LOCKED');
    });

    it('401 USER_NOT_FOUND when the account row is gone while the token is still cached', async () => {
      const u = await mk('oggone');
      const tok = await freshLogin(u);
      expect((await authGet(app, '/api/auth/me', tok)).statusCode).toBe(200); // caches session + user
      await deleteUsers([users[u]]);
      delete users[u];
      const res = await authPost(app, '/api/auth/offline-grant', tok, { _currentPassword: PW });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('USER_NOT_FOUND');
      expect(internalErrors).toHaveLength(0);
    });
  });
});
