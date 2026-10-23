/**
 * DB-free behaviour tests for lib/reauth-check.ts — the electronic-signature
 * gate (21 CFR §11). Written against the Stryker survivors of 2026-10-23: each
 * case pins an observable contract (status code, error CODE, the audit row that
 * IS the signature, the cache window, the request-store link), not internals.
 * Listed in vitest.stryker.config.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  verifyPassword: vi.fn(),
  applyFailed: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    systemConfig: { findUnique: h.configFindUnique },
    user: { findUnique: h.userFindUnique, update: h.userUpdate },
  },
}));
vi.mock('../password.js', () => ({ verifyPassword: h.verifyPassword }));
vi.mock('../../modules/auth/auth.service.js', () => ({ applyFailedPasswordAttempt: h.applyFailed }));
vi.mock('../audit.js', () => ({ auditLog: h.auditLog }));

import {
  enforceReauth, enforceReauthAlways, getActionReauthConfig, getReauthHealth,
  invalidateReauthCache, isReauthRequired,
} from '../reauth-check.js';
import { runWithRequestStore, type RequestStore } from '../request-store.js';

const USER = { id: 'u-1', username: 'alice', role: 'ADMIN', passwordHash: 'hash', failedLoginAttempts: 0 };

function req(o: { body?: unknown; headers?: Record<string, string>; role?: string; offline?: boolean } = {}) {
  return {
    user: { sub: 'u-1', role: o.role ?? 'ADMIN', sessionId: 'sess-1' },
    body: o.body,
    headers: { 'user-agent': 'ua/1', ...(o.headers ?? {}) },
    ip: '10.0.0.9',
    offlineReplayVerified: o.offline,
  } as any;
}
function reply() {
  const r: any = { statusCode: 0, body: undefined };
  r.code = (c: number) => { r.statusCode = c; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  return r;
}
/** The policy the config row holds (only answered for the 'action-reauth' key). */
function policy(value: unknown) {
  h.configFindUnique.mockImplementation(async (args: any) =>
    (args?.where?.configKey === 'action-reauth' ? { configValue: value } : null));
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateReauthCache();
  h.userFindUnique.mockImplementation(async (args: any) => (args?.where?.id === 'u-1' ? { ...USER } : null));
  h.verifyPassword.mockImplementation(async (pw: string, hash: string) => pw === 'right' && hash === 'hash');
  h.applyFailed.mockResolvedValue({ locked: false });
  h.auditLog.mockResolvedValue('sig-row-1');
  policy({});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('enforceReauthAlways — asks every caller, whatever the policy says', () => {
  it('no password: 401 REAUTH_REQUIRED naming the (first) action; nothing verified or audited', async () => {
    const r = reply();
    const out = await enforceReauthAlways(['DELETE_ASSET', 'DELETE_FILTER'], req(), r);
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'REAUTH_REQUIRED', message: 'This action requires password re-authentication.', action: 'DELETE_ASSET' });
    expect(h.verifyPassword).not.toHaveBeenCalled();
    expect(h.auditLog).not.toHaveBeenCalled();
  });

  it('a verified offline-replay grant passes without a password, and the body password is still stripped', async () => {
    const body: Record<string, unknown> = { _currentPassword: 'right', keep: 1 };
    const r = reply();
    expect(await enforceReauthAlways('X', req({ body, offline: true }), r)).toEqual({ ok: true });
    expect(body).toEqual({ keep: 1 });
    expect(r.statusCode).toBe(0);
    expect(h.auditLog).not.toHaveBeenCalled();
  });

  it('an offline flag that is not exactly true does not pass', async () => {
    const r = reply();
    const q = req({ offline: 'yes' as any });
    expect(await enforceReauthAlways('X', q, r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });

  it('right password from the body: ok, the field is removed, the request is marked verified', async () => {
    const body: Record<string, unknown> = { _currentPassword: 'right', name: 'n' };
    const q = req({ body });
    expect(await enforceReauthAlways('UPDATE_USER', q, reply())).toEqual({ ok: true });
    expect(body).toEqual({ name: 'n' });
    expect(q._reauthVerified).toBe(true);
    expect(q._reauthAuditId).toBe('sig-row-1');
    expect(h.verifyPassword).toHaveBeenCalledWith('right', 'hash');
  });

  it('right password from the header when the body carries none', async () => {
    const q = req({ headers: { 'x-reauth-password': 'right' } });
    expect(await enforceReauthAlways('UPDATE_USER', q, reply())).toEqual({ ok: true });
    expect(h.verifyPassword).toHaveBeenCalledWith('right', 'hash');
  });

  it('the body password wins over the header', async () => {
    const q = req({ body: { _currentPassword: 'right' }, headers: { 'x-reauth-password': 'wrong' } });
    expect(await enforceReauthAlways('UPDATE_USER', q, reply())).toEqual({ ok: true });
    expect(h.verifyPassword).toHaveBeenCalledWith('right', 'hash');
  });

  it('a non-string body password is removed and ignored in favour of the header', async () => {
    const body: Record<string, unknown> = { _currentPassword: 12345 };
    const q = req({ body, headers: { 'x-reauth-password': 'right' } });
    expect(await enforceReauthAlways('UPDATE_USER', q, reply())).toEqual({ ok: true });
    expect(body).toEqual({});
    expect(h.verifyPassword).toHaveBeenCalledWith('right', 'hash');
  });

  it('a body that is not an object is left alone and the header is used', async () => {
    const q = req({ body: 'raw text', headers: { 'x-reauth-password': 'right' } });
    expect(await enforceReauthAlways('UPDATE_USER', q, reply())).toEqual({ ok: true });
    expect(q.body).toBe('raw text');
  });

  it('the signature row: REAUTH_SUCCESS on the user, naming the action, with who/where', async () => {
    await enforceReauthAlways(['DELETE_ROLE', 'OTHER'], req({ headers: { 'x-reauth-password': 'right' } }), reply());
    expect(h.auditLog).toHaveBeenCalledTimes(1);
    expect(h.auditLog).toHaveBeenCalledWith({
      userId: 'alice', userRole: 'ADMIN', action: 'REAUTH_SUCCESS',
      targetType: 'user', targetId: 'u-1',
      afterValue: { username: 'alice', reauthAction: 'DELETE_ROLE' },
      signatureMeaning: 'Electronic signature applied for DELETE_ROLE',
      ipAddress: '10.0.0.9', userAgent: 'ua/1', sessionId: 'sess-1',
    });
  });

  it('the signature row id is published to the request store, so the signed rows can link to it', async () => {
    const store: RequestStore = {};
    await runWithRequestStore(store, () => enforceReauthAlways('UPDATE_USER', req({ headers: { 'x-reauth-password': 'right' } }), reply()));
    expect(store.reauthAuditId).toBe('sig-row-1');
  });

  it('a successful signature resets a running failed-attempt streak — and only when there is one', async () => {
    h.userFindUnique.mockResolvedValueOnce({ ...USER, failedLoginAttempts: 2 });
    await enforceReauthAlways('UPDATE_USER', req({ headers: { 'x-reauth-password': 'right' } }), reply());
    expect(h.userUpdate).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { failedLoginAttempts: 0 } });

    h.userUpdate.mockClear();
    await enforceReauthAlways('UPDATE_USER', req({ headers: { 'x-reauth-password': 'right' } }), reply());
    expect(h.userUpdate).not.toHaveBeenCalled();
  });

  it('wrong password: 401 REAUTH_FAILED, the attempt counted, a REAUTH_FAILED row, no verified mark', async () => {
    const r = reply();
    const q = req({ headers: { 'x-reauth-password': 'wrong' } });
    expect(await enforceReauthAlways('DELETE_USER', q, r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' });
    expect(h.applyFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1' }), '10.0.0.9', 'ua/1');
    expect(h.auditLog).toHaveBeenCalledWith({
      userId: 'alice', userRole: 'ADMIN', action: 'REAUTH_FAILED',
      targetType: 'user', targetId: 'u-1',
      afterValue: { username: 'alice', reauthAction: 'DELETE_USER', accountLocked: false },
      signatureMeaning: 'Electronic signature attempt FAILED for DELETE_USER',
      ipAddress: '10.0.0.9', userAgent: 'ua/1', sessionId: 'sess-1',
    });
    expect(q._reauthVerified).toBeUndefined();
  });

  it('the attempt that locks the account: 403 ACCOUNT_LOCKED, and the failed row says it locked', async () => {
    h.applyFailed.mockResolvedValueOnce({ locked: true });
    const r = reply();
    expect(await enforceReauthAlways('DELETE_USER', req({ headers: { 'x-reauth-password': 'wrong' } }), r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'ACCOUNT_LOCKED', message: 'Account locked due to multiple failed attempts. Contact administrator.' });
    expect(h.auditLog.mock.calls[0][0].afterValue).toEqual({ username: 'alice', reauthAction: 'DELETE_USER', accountLocked: true });
  });

  it('a signer whose user row is gone: 401 REAUTH_FAILED, nothing audited', async () => {
    h.userFindUnique.mockResolvedValueOnce(null);
    const r = reply();
    expect(await enforceReauthAlways('X', req({ headers: { 'x-reauth-password': 'right' } }), r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.body.error).toBe('REAUTH_FAILED');
    expect(h.auditLog).not.toHaveBeenCalled();
  });
});

describe('enforceReauth — asks only the roles the policy lists', () => {
  it('not required for this role: ok without a password, and the body password is still stripped', async () => {
    policy({ DELETE_FILTER: ['QA'] });
    const body: Record<string, unknown> = { _currentPassword: 'x', a: 1 };
    const r = reply();
    expect(await enforceReauth('DELETE_FILTER', req({ body }), r)).toEqual({ ok: true });
    expect(body).toEqual({ a: 1 });
    expect(r.statusCode).toBe(0);
  });

  it('required when ANY of several actions lists the role; the 401 names the FIRST action', async () => {
    policy({ EDIT_FILTER: ['ADMIN'] });
    const r = reply();
    expect(await enforceReauth(['UPDATE_ASSET', 'EDIT_FILTER'], req(), r)).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'REAUTH_REQUIRED', message: 'This action requires password re-authentication.', action: 'UPDATE_ASSET' });
  });

  it('a verified offline replay skips even a required signature', async () => {
    policy({ X: ['ADMIN'] });
    expect(await enforceReauth('X', req({ offline: true }), reply())).toEqual({ ok: true });
    expect(h.verifyPassword).not.toHaveBeenCalled();
  });

  it('right password: ok and verified; wrong: 401; locking: 403', async () => {
    policy({ X: ['ADMIN'] });
    const ok = req({ headers: { 'x-reauth-password': 'right' } });
    expect(await enforceReauth('X', ok, reply())).toEqual({ ok: true });
    expect(ok._reauthVerified).toBe(true);
    expect(h.auditLog.mock.calls[0][0].afterValue).toEqual({ username: 'alice', reauthAction: 'X' });

    const r1 = reply();
    expect(await enforceReauth('X', req({ headers: { 'x-reauth-password': 'wrong' } }), r1)).toEqual({ ok: false });
    expect(r1.statusCode).toBe(401);
    expect(r1.body.error).toBe('REAUTH_FAILED');

    h.applyFailed.mockResolvedValueOnce({ locked: true });
    const r2 = reply();
    await enforceReauth('X', req({ headers: { 'x-reauth-password': 'wrong' } }), r2);
    expect(r2.statusCode).toBe(403);
    expect(r2.body.error).toBe('ACCOUNT_LOCKED');
  });
});

describe('the policy read: one row, a 10-second cache, normalised', () => {
  it('reads the action-reauth row (another key holds no policy)', async () => {
    policy({ A: ['ADMIN'] });
    expect(await getActionReauthConfig()).toEqual({ A: ['ADMIN'] });
    expect(h.configFindUnique).toHaveBeenCalledWith({ where: { configKey: 'action-reauth' } });
  });

  it('serves the cached policy inside 10 s, re-reads after, and re-reads at once after invalidate', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    policy({ A: ['ADMIN'] });
    await getActionReauthConfig();
    policy({ A: ['QA'] });
    now.mockReturnValue(1_000_000 + 9_999);
    expect(await getActionReauthConfig()).toEqual({ A: ['ADMIN'] });
    now.mockReturnValue(1_000_000 + 10_000);
    expect(await getActionReauthConfig()).toEqual({ A: ['QA'] });
    policy({ A: ['OPERATOR'] });
    invalidateReauthCache();
    expect(await getActionReauthConfig()).toEqual({ A: ['OPERATOR'] });
    expect(h.configFindUnique).toHaveBeenCalledTimes(3);
  });

  it('isReauthRequired: listed role true, other role false, empty or absent action false', async () => {
    policy({ A: ['ADMIN'], B: [] });
    expect(await isReauthRequired('A', 'ADMIN')).toBe(true);
    expect(await isReauthRequired('A', 'QA')).toBe(false);
    expect(await isReauthRequired('B', 'ADMIN')).toBe(false);
    expect(await isReauthRequired('C', 'ADMIN')).toBe(false);
  });

  it('legacy nested shape is detected only with a non-null first entry carrying action AND roles', async () => {
    // Not legacy: read as the flat shape, where an (empty) string array is a valid entry.
    policy({ actions: [] });
    expect(await getActionReauthConfig()).toEqual({ actions: [] });
    expect((await getReauthHealth()).legacyShape).toBe(false);

    invalidateReauthCache();
    policy({ actions: [null] });
    expect(await getActionReauthConfig()).toEqual({});
    expect((await getReauthHealth()).legacyShape).toBe(false);

    invalidateReauthCache();
    policy({ actions: [{ action: 'A' }] });
    expect(await getActionReauthConfig()).toEqual({});

    invalidateReauthCache();
    policy({ actions: [{ roles: ['ADMIN'] }] });
    expect(await getActionReauthConfig()).toEqual({});

    invalidateReauthCache();
    policy({ actions: ['A'] });
    expect(await getActionReauthConfig()).toEqual({ actions: ['A'] });

    invalidateReauthCache();
    policy({ actions: [{ action: 'A', roles: ['ADMIN'] }, { action: 'A', roles: ['QA', 'ADMIN'] }, { action: 'B', roles: [1] }] });
    expect(await getActionReauthConfig()).toEqual({ A: ['ADMIN', 'QA'] });
    expect((await getReauthHealth()).legacyShape).toBe(true);
  });

  it('health: counts only actions with at least one role; a flat re-read clears the legacy flag', async () => {
    policy({ actions: [{ action: 'A', roles: ['ADMIN'] }] });
    expect((await getReauthHealth()).legacyShape).toBe(true);
    invalidateReauthCache();
    policy({ A: ['ADMIN'], B: [], C: ['QA', 'X'] });
    expect(await getReauthHealth()).toEqual({ actionsConfigured: 2, legacyShape: false, effectivelyDisabled: false });
    invalidateReauthCache();
    policy({ B: [] });
    expect(await getReauthHealth()).toEqual({ actionsConfigured: 0, legacyShape: false, effectivelyDisabled: true });
  });
});
