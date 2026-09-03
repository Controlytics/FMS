import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Re-authentication is the 21 CFR §11 electronic signature, and until
 * 2026-09-03 it wrote NOTHING to the audit trail — success or failure. A
 * rejected signature left no record at all; only the fifth consecutive one
 * surfaced, and then as ACCOUNT_LOCKED, which says the threshold tripped but
 * not which signature was being attempted.
 *
 * `applyFailedPasswordAttempt`'s own docstring has always stated the contract:
 * "the caller owns its own action-specific audit (LOGIN_FAILED / reauth)".
 * Login implemented its half; reauth never did.
 */

const { mockPrisma, mockAuditLog, mockVerifyPassword, mockApplyFailed, mockGetConfig } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn(), update: vi.fn() }, systemConfig: { findUnique: vi.fn() } },
  mockAuditLog: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockApplyFailed: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock('../prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('../password.js', () => ({ verifyPassword: mockVerifyPassword }));
vi.mock('../../modules/auth/auth.service.js', () => ({ applyFailedPasswordAttempt: mockApplyFailed }));

import { enforceReauth, invalidateReauthCache } from '../reauth-check.js';

const USER = {
  id: 'u-1', username: 'oper7', role: 'OPERATOR',
  passwordHash: 'hash', failedLoginAttempts: 0, fullName: 'Op Seven',
};

/** action-reauth config: OPERATOR must sign UPDATE_FILTER_LIFECYCLE. */
function policy(roles: string[] = ['OPERATOR']) {
  mockPrisma.systemConfig.findUnique.mockResolvedValue({
    configValue: { UPDATE_FILTER_LIFECYCLE: roles },
  });
}

function makeReq(body: Record<string, unknown> = {}) {
  return {
    user: { sub: 'u-1', role: 'OPERATOR', username: 'oper7', sessionId: 'sess-9' },
    body,
    headers: { 'user-agent': 'vitest' },
    ip: '10.0.0.9',
  } as any;
}

function makeReply() {
  const reply: any = { statusCode: 0, payload: undefined };
  reply.code = (c: number) => { reply.statusCode = c; return reply; };
  reply.send = (p: unknown) => { reply.payload = p; return reply; };
  return reply;
}

const rows = () => mockAuditLog.mock.calls.map((c) => c[0]);

describe('re-authentication audit trail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateReauthCache();
    mockPrisma.user.findUnique.mockResolvedValue({ ...USER });
    mockApplyFailed.mockResolvedValue({ locked: false });
    policy();
  });

  it('writes REAUTH_SUCCESS naming the action that was signed', async () => {
    mockVerifyPassword.mockResolvedValue(true);

    const res = await enforceReauth('UPDATE_FILTER_LIFECYCLE', makeReq({ _currentPassword: 'right' }), makeReply());

    expect(res.ok).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      action: 'REAUTH_SUCCESS',
      userId: 'oper7',
      userRole: 'OPERATOR',
      targetType: 'user',
      targetId: 'u-1',
      ipAddress: '10.0.0.9',
      sessionId: 'sess-9',
    });
    // Naming the signed action is the point — "Re-authentication successful"
    // with no object tells an inspector nothing.
    expect(rows()[0].afterValue).toMatchObject({ reauthAction: 'UPDATE_FILTER_LIFECYCLE' });
    expect(rows()[0].signatureMeaning).toContain('UPDATE_FILTER_LIFECYCLE');
  });

  it('writes REAUTH_FAILED on a wrong password', async () => {
    mockVerifyPassword.mockResolvedValue(false);
    const reply = makeReply();

    const res = await enforceReauth('UPDATE_FILTER_LIFECYCLE', makeReq({ _currentPassword: 'wrong' }), reply);

    expect(res.ok).toBe(false);
    expect(reply.statusCode).toBe(401);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ action: 'REAUTH_FAILED', userId: 'oper7' });
    expect(rows()[0].afterValue).toMatchObject({ reauthAction: 'UPDATE_FILTER_LIFECYCLE', accountLocked: false });
  });

  it('still writes REAUTH_FAILED when the attempt LOCKS the account', async () => {
    // The ACCOUNT_LOCKED row says the threshold tripped; it does not say which
    // signature was being attempted. Both rows are needed.
    mockVerifyPassword.mockResolvedValue(false);
    mockApplyFailed.mockResolvedValue({ locked: true });
    const reply = makeReply();

    await enforceReauth('UPDATE_FILTER_LIFECYCLE', makeReq({ _currentPassword: 'wrong' }), reply);

    expect(reply.statusCode).toBe(403);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].action).toBe('REAUTH_FAILED');
    expect(rows()[0].afterValue).toMatchObject({ accountLocked: true });
  });

  it('🔴 writes NOTHING when no password was supplied', async () => {
    // REAUTH_REQUIRED is the first leg of the handshake, not a failed
    // signature: useReauth.execute deliberately fires a passwordless request
    // and pops its dialog on this 401. Auditing it would file a REAUTH_FAILED
    // for every re-auth taken on that path.
    const reply = makeReply();

    const res = await enforceReauth('UPDATE_FILTER_LIFECYCLE', makeReq({}), reply);

    expect(res.ok).toBe(false);
    expect(reply.payload).toMatchObject({ error: 'REAUTH_REQUIRED' });
    expect(mockAuditLog).not.toHaveBeenCalled();
    // …and no password was even compared.
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the action is not gated for this role', async () => {
    // No signature was requested, so there is no signature event to record.
    policy(['ADMIN']);
    const res = await enforceReauth('UPDATE_FILTER_LIFECYCLE', makeReq({}), makeReply());

    expect(res.ok).toBe(true);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('writes NOTHING for a verified offline replay', async () => {
    // The signature was captured on the tablet at scan time; the replay is not
    // a second signing event.
    const req = makeReq({ _currentPassword: 'right' });
    req.offlineReplayVerified = true;

    const res = await enforceReauth('UPDATE_FILTER_LIFECYCLE', req, makeReply());

    expect(res.ok).toBe(true);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
