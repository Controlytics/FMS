/**
 * enforceReauthAlways (lib/reauth-check.ts) — the always-on electronic
 * signature — against real Prisma on digilog_test_db with a user this file owns.
 *
 * The gate is called directly with a minimal request/reply pair (the reply
 * object only records what the gate sent). What is asserted is the client's
 * answer, the `_currentPassword` stripping, the REAUTH_SUCCESS / REAUTH_FAILED
 * audit rows and their chain link, the failed-attempt counter, and the lockout.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma.js';
import { enforceReauthAlways } from '../reauth-check.js';
import { runWithRequestStore, getRequestStore } from '../request-store.js';
import { hashPassword } from '../password.js';
import { randomUUID } from 'node:crypto';

const SFX = randomUUID().slice(0, 6);
const USERNAME = `cvl_ra_${SFX}`;
const ROLE = 'OPERATOR';
const PW = 'Cvl@Reauth123!';
const ACTION = 'CVL_SIGNED_ACTION';
let userId = '';

function req(body: Record<string, unknown> | undefined, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return { user: { sub: userId, role: ROLE, username: USERNAME, sessionId: randomUUID() }, body, headers: { 'user-agent': 'cvl-agent', ...headers }, ip: '10.9.8.7', ...extra } as any;
}
function reply() {
  const r: any = { statusCode: 0, payload: undefined };
  r.code = (c: number) => { r.statusCode = c; return r; };
  r.send = (p: unknown) => { r.payload = p; return r; };
  return r;
}
const myRows = (action: string) => prisma.auditTrail.findMany({ where: { action, targetId: userId }, orderBy: { chainPosition: 'asc' } });

beforeAll(async () => {
  userId = (await prisma.user.create({
    data: { username: USERNAME, fullName: 'CVL Reauth', passwordHash: await hashPassword(PW), role: ROLE, status: 'ENABLED', createdBy: 'cvl-test' },
  })).id;
}, 60_000);

afterAll(async () => {
  // Audit rows are permanent by design (§11): they stay, like every other suite's.
  await prisma.notification.deleteMany({ where: { targetUserId: USERNAME } });
  await prisma.user.deleteMany({ where: { id: userId } });
}, 60_000);

describe('enforceReauthAlways', () => {
  it('without a password: 401 REAUTH_REQUIRED naming the action, and no audit row', async () => {
    const before = (await myRows('REAUTH_FAILED')).length;
    const r = reply();
    expect(await enforceReauthAlways(ACTION, req({}), r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.payload).toEqual({ error: 'REAUTH_REQUIRED', message: 'This action requires password re-authentication.', action: ACTION });
    expect((await myRows('REAUTH_FAILED')).length).toBe(before);
  });

  it('a verified offline-replay grant stands in for the password (and the body password is still stripped)', async () => {
    const body: Record<string, unknown> = { _currentPassword: 'ignored', keep: 1 };
    const r = reply();
    expect(await enforceReauthAlways(ACTION, req(body, {}, { offlineReplayVerified: true }), r)).toEqual({ ok: true });
    expect(body).toEqual({ keep: 1 });
    expect(r.statusCode).toBe(0);
  });

  it('a wrong password: 401 REAUTH_FAILED, a REAUTH_FAILED audit row, and one counted attempt', async () => {
    await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, status: 'ENABLED' } });
    const r = reply();
    expect(await enforceReauthAlways(ACTION, req({}, { 'x-reauth-password': 'not-it' }), r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.payload).toEqual({ error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' });
    expect((await prisma.user.findUnique({ where: { id: userId } }))!.failedLoginAttempts).toBe(1);
    const failed = (await myRows('REAUTH_FAILED')).at(-1)!;
    expect(failed).toMatchObject({ userId: USERNAME, userRole: ROLE, ipAddress: '10.9.8.7', userAgent: 'cvl-agent' });
    expect(failed.afterValue).toEqual({ username: USERNAME, reauthAction: ACTION, accountLocked: false });
    expect(failed.signatureMeaning).toBe(`Electronic signature attempt FAILED for ${ACTION}`);
    // The chain links to the row just before it in chain order (a rolled-back
    // write burns a sequence value, so "position - 1" may not exist).
    const prior = await prisma.auditTrail.findFirst({ where: { chainPosition: { lt: failed.chainPosition! } }, orderBy: { chainPosition: 'desc' } });
    expect(failed.previousChecksum).toBe(prior!.checksum);
  });

  it('the right password in the body: ok, field removed, streak reset, REAUTH_SUCCESS published to the request store', async () => {
    const body: Record<string, unknown> = { _currentPassword: PW, value: 'x' };
    const r = reply();
    const store: { reauthAuditId?: string } = {};
    const q = req(body);
    const res = await runWithRequestStore(store, () => enforceReauthAlways(ACTION, q, r));
    expect(res).toEqual({ ok: true });
    expect(body).toEqual({ value: 'x' });
    expect(q._reauthVerified).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: userId } }))!.failedLoginAttempts).toBe(0);
    const ok = (await myRows('REAUTH_SUCCESS')).at(-1)!;
    expect(ok.afterValue).toEqual({ username: USERNAME, reauthAction: ACTION });
    expect(ok.signatureMeaning).toBe(`Electronic signature applied for ${ACTION}`);
    expect(store.reauthAuditId).toBe(ok.id);
    expect(q._reauthAuditId).toBe(ok.id);
    expect(getRequestStore()).toBeUndefined();
  });

  it('a body password that is not a string is ignored in favour of the header', async () => {
    const body: Record<string, unknown> = { _currentPassword: 12345 };
    const r = reply();
    expect(await enforceReauthAlways(ACTION, req(body, { 'x-reauth-password': PW }), r)).toEqual({ ok: true });
    expect('_currentPassword' in body).toBe(false);
  });

  it('a request with no body object still works from the header', async () => {
    expect(await enforceReauthAlways(ACTION, req(undefined, { 'x-reauth-password': PW }), reply())).toEqual({ ok: true });
  });

  it('the attempt that reaches the lockout threshold answers 403 ACCOUNT_LOCKED and locks the account', async () => {
    const policy = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
    const max = ((policy?.configValue as { maxFailedAttempts?: number } | null)?.maxFailedAttempts) ?? 5;
    await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: max - 1 } });
    const r = reply();
    expect(await enforceReauthAlways(ACTION, req({ _currentPassword: 'wrong-again' }), r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(403);
    expect(r.payload).toEqual({ error: 'ACCOUNT_LOCKED', message: 'Account locked due to multiple failed attempts. Contact administrator.' });
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u!.status).toBe('LOCKED');
    const failed = (await myRows('REAUTH_FAILED')).at(-1)!;
    expect((failed.afterValue as Record<string, unknown>).accountLocked).toBe(true);
    expect((await myRows('ACCOUNT_LOCKED')).length).toBeGreaterThanOrEqual(1);
  });

  it('a user that no longer exists cannot sign', async () => {
    const r = reply();
    const ghost = { ...req({}, { 'x-reauth-password': PW }), user: { sub: randomUUID(), role: ROLE, username: 'ghost', sessionId: 's' } };
    expect(await enforceReauthAlways(ACTION, ghost, r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.payload).toEqual({ error: 'REAUTH_FAILED', message: 'User not found.' });
  });
});
