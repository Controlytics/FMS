/**
 * authService — behaviour when a policy / config row is missing or a record
 * vanished mid-request (coverage, 2026-10-21).
 *
 * These are the fallbacks the service applies when `password-policy`,
 * `login-security` or `session` lack a key, and the "user disappeared"
 * refusals. The shared config rows cannot be blanked on the test DB (every
 * other suite reads them), so the repository is mocked at its module boundary,
 * as in the sibling auth.service unit test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRepo, mockVerify, mockHash, mockSign, mockAudit, mockNotify, mockDispatch } = vi.hoisted(() => ({
  mockRepo: {
    findUserByUsername: vi.fn(), findUserById: vi.fn(), updateUser: vi.fn(), findActiveSessions: vi.fn(), createSession: vi.fn(),
    getSessionConfig: vi.fn(), getPasswordPolicyRow: vi.fn(), getLoginSecurityConfig: vi.fn(), getPasswordPolicyConfig: vi.fn(),
    getPasswordHistory: vi.fn(), changePassword: vi.fn(), terminateOtherSessions: vi.fn(), findUserByEmail: vi.fn(), updateUserProfile: vi.fn(),
  },
  mockVerify: vi.fn(), mockHash: vi.fn(), mockSign: vi.fn(), mockAudit: vi.fn(), mockNotify: vi.fn(),
  mockDispatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../auth.repository.js', () => ({ authRepository: mockRepo }));
vi.mock('../../../lib/password.js', () => ({ hashPassword: mockHash, verifyPassword: mockVerify }));
vi.mock('../../../lib/jwt.js', () => ({ signToken: mockSign, signVerificationToken: vi.fn(), verifyToken: vi.fn() }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAudit }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: mockNotify }));
vi.mock('../../notification-delivery/notification-dispatcher.js', () => ({ dispatchNotification: mockDispatch }));

import { authService, applyFailedPasswordAttempt } from '../auth.service.js';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', username: 'opr001', fullName: null as string | null, role: 'OPERATOR', status: 'ENABLED',
  passwordHash: 'h', failedLoginAttempts: 0, forcePasswordChange: false, isTemporaryPassword: false,
  lockoutUntil: null, passwordChangedAt: new Date(), createdAt: new Date(), email: null, department: null, photoUrl: null,
  ...over,
});

describe('authService fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch.mockResolvedValue(undefined);
    mockRepo.getLoginSecurityConfig.mockResolvedValue({});
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({});
    mockRepo.getSessionConfig.mockResolvedValue({});
    mockRepo.getPasswordPolicyRow.mockResolvedValue(null);
    mockRepo.findActiveSessions.mockResolvedValue([]);
    mockRepo.createSession.mockResolvedValue({ id: 's1' });
    mockRepo.getPasswordHistory.mockResolvedValue([]);
    mockSign.mockResolvedValue('tok');
    mockHash.mockResolvedValue('new-hash');
  });

  it('lockout: with no policy values it locks on the 5th miss for 30 minutes, and names the user by username', async () => {
    const before = Date.now();
    const r = await applyFailedPasswordAttempt(user({ failedLoginAttempts: 4 }), undefined as unknown as string, 'ua');
    expect(r).toEqual({ locked: true });
    const data = mockRepo.updateUser.mock.calls[0][1];
    expect(data).toMatchObject({ failedLoginAttempts: 5, status: 'LOCKED' });
    const minutes = (data.lockoutUntil.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'USER_LOCKED',
      variables: expect.objectContaining({ username: 'opr001', fullName: 'opr001', ipAddress: 'N/A', failedAttempts: '5' }),
    }));
  });

  it('lockout: a PERMANENT lockout sets no expiry', async () => {
    mockRepo.getLoginSecurityConfig.mockResolvedValue({ lockoutType: 'PERMANENT' });
    await applyFailedPasswordAttempt(user({ failedLoginAttempts: 4 }), '1.1.1.1', 'ua');
    expect(mockRepo.updateUser.mock.calls[0][1]).not.toHaveProperty('lockoutUntil');
  });

  it('a failed dispatch of the lock notification never fails the lockout itself', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('smtp down'));
    await expect(applyFailedPasswordAttempt(user({ failedLoginAttempts: 4 }), '1.1.1.1', 'ua')).resolves.toEqual({ locked: true });
  });

  it('login: no policy row means no expiry check; no session config means 8 hours', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(user({ passwordChangedAt: new Date(0), createdAt: new Date(0) }));
    mockVerify.mockResolvedValue(true);
    const r = await authService.login('opr001', 'pw', undefined as unknown as string, undefined);
    expect(r).toMatchObject({ success: true, expiresIn: '8h', user: { forcePasswordChange: false } });
    expect(mockRepo.createSession).toHaveBeenCalledWith('u1', undefined, undefined, 8);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'USER_LOGIN', variables: expect.objectContaining({ fullName: 'opr001', ipAddress: 'N/A' }),
    }));
  });

  it('login: a password older than the policy forces a change and is audited once', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    mockRepo.getPasswordPolicyRow.mockResolvedValue({ configValue: { passwordExpiryDays: 90 }, updatedAt: new Date(Date.now() - 400 * 86_400_000) });
    mockRepo.findUserByUsername.mockResolvedValue(user({ fullName: 'Aged User', passwordChangedAt: old, createdAt: old }));
    mockVerify.mockResolvedValue(true);
    const r = await authService.login('opr001', 'pw', 'ip', 'ua');
    expect(r.user.forcePasswordChange).toBe(true);
    expect(mockRepo.updateUser).toHaveBeenCalledWith('u1', { forcePasswordChange: true });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_EXPIRED', signatureMeaning: 'System detected expired password at login' }));

    // Already flagged: nothing new is written or audited.
    vi.clearAllMocks();
    mockRepo.findActiveSessions.mockResolvedValue([]);
    mockRepo.createSession.mockResolvedValue({ id: 's2' });
    mockRepo.getSessionConfig.mockResolvedValue({});
    mockDispatch.mockResolvedValue(undefined);
    mockRepo.getPasswordPolicyRow.mockResolvedValue({ configValue: { passwordExpiryDays: 90 }, updatedAt: new Date(Date.now() - 400 * 86_400_000) });
    mockRepo.findUserByUsername.mockResolvedValue(user({ passwordChangedAt: old, createdAt: old, forcePasswordChange: true }));
    mockVerify.mockResolvedValue(true);
    await authService.login('opr001', 'pw', 'ip', 'ua');
    expect(mockRepo.updateUser).not.toHaveBeenCalledWith('u1', { forcePasswordChange: true });
    expect(mockAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_EXPIRED' }));
  });

  it('a failed login notification dispatch does not fail the login', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(user());
    mockVerify.mockResolvedValue(true);
    mockDispatch.mockRejectedValueOnce(new Error('down'));
    await expect(authService.login('opr001', 'pw', 'ip', 'ua')).resolves.toMatchObject({ success: true });
  });

  it('updateProfile / changePassword / verify refuse a user that no longer exists', async () => {
    mockRepo.findUserById.mockResolvedValue(null);
    await expect(authService.updateProfile('gone', { fullName: 'Xy' }, 'ip', 'ua', 's')).rejects.toMatchObject({ statusCode: 404 });
    await expect(authService.changePassword('gone', 'a', 'b', 'ip', 'ua', 's')).rejects.toMatchObject({ statusCode: 404 });
    await expect(authService.verify('gone', 'pw', 'ip', 'ua')).rejects.toMatchObject({ statusCode: 404 });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('changePassword with an empty policy applies the built-in limits and history depth', async () => {
    mockRepo.findUserById.mockResolvedValue(user({ isTemporaryPassword: true }));
    mockVerify.mockResolvedValue(false);
    await expect(authService.changePassword('u1', undefined, 'Ab1!xyz', 'ip', 'ua', 's')).rejects.toMatchObject({ code: 'POLICY_VIOLATION', message: 'Password must be at least 8 characters' });
    await expect(authService.changePassword('u1', undefined, 'Ab1!' + 'x'.repeat(130), 'ip', 'ua', 's')).rejects.toMatchObject({ message: 'Password must be at most 128 characters' });

    await authService.changePassword('u1', undefined, 'Fresh#Pass99', 'ip', 'ua', 's');
    expect(mockRepo.getPasswordHistory).toHaveBeenCalledWith('u1', 12);
    // Default expiry (90 days) stamps an expiry date.
    const expiresAt = mockRepo.changePassword.mock.calls[0][2] as Date;
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(90);
  });

  it('changePassword: a class flag without its count requires one; expiry 0 stores no expiry date', async () => {
    mockRepo.findUserById.mockResolvedValue(user({ isTemporaryPassword: true }));
    mockVerify.mockResolvedValue(false);
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ requireUppercase: true, passwordExpiryDays: 0 });
    await expect(authService.changePassword('u1', undefined, 'nouppercase1!', 'ip', 'ua', 's')).rejects.toMatchObject({ message: 'Password must contain at least 1 uppercase letter(s)' });
    await authService.changePassword('u1', undefined, 'Hasupper1!', 'ip', 'ua', 's');
    expect(mockRepo.changePassword).toHaveBeenCalledWith('u1', 'new-hash', null);
  });
});
