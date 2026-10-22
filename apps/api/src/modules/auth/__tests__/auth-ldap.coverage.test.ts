/**
 * authService.login — the LDAP branches (coverage, 2026-10-21).
 *
 * No directory server exists in the test environment, and switching the shared
 * `ldap` config row on would change login for every other suite. The LDAP
 * service is therefore mocked at its module boundary, together with the auth
 * repository and the crypto/JWT helpers (the same boundary the sibling
 * auth.service unit test uses). Each test asserts what the caller observes:
 * the thrown code, whether a session is created, and which LDAP calls happen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRepo, mockLdap, mockVerify, mockSign, mockAudit } = vi.hoisted(() => ({
  mockRepo: {
    findUserByUsername: vi.fn(), updateUser: vi.fn(), findActiveSessions: vi.fn(), createSession: vi.fn(),
    getSessionConfig: vi.fn(), getPasswordPolicyRow: vi.fn(), getLoginSecurityConfig: vi.fn(), getPasswordPolicyConfig: vi.fn(),
    terminateActiveSessions: vi.fn(),
  },
  mockLdap: { getConfig: vi.fn(), authenticateUser: vi.fn(), provisionUser: vi.fn(), syncUserAttributes: vi.fn() },
  mockVerify: vi.fn(),
  mockSign: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('../auth.repository.js', () => ({ authRepository: mockRepo }));
vi.mock('../../ldap/ldap.service.js', () => ({ ldapService: mockLdap }));
vi.mock('../../../lib/password.js', () => ({ hashPassword: vi.fn(), verifyPassword: mockVerify }));
vi.mock('../../../lib/jwt.js', () => ({ signToken: mockSign, signVerificationToken: vi.fn(), verifyToken: vi.fn() }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAudit }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: vi.fn() }));
vi.mock('../../notification-delivery/notification-dispatcher.js', () => ({ dispatchNotification: vi.fn().mockResolvedValue(undefined) }));

import { authService } from '../auth.service.js';

const ldapUser = (over: Record<string, unknown> = {}) => ({
  id: 'u-ldap', username: 'jdoe', fullName: 'J Doe', role: 'OPERATOR', status: 'ENABLED',
  passwordHash: 'LDAP_EXTERNAL_AUTH', authSource: 'ldap', failedLoginAttempts: 0,
  forcePasswordChange: false, isTemporaryPassword: false, lockoutUntil: null,
  passwordChangedAt: new Date(), createdAt: new Date(), ...over,
});

const ON = { enabled: true, url: 'ldaps://dir.example', roleMappings: [] };
const OFF = { enabled: false };

describe('authService.login — LDAP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findActiveSessions.mockResolvedValue([]);
    mockRepo.createSession.mockResolvedValue({ id: 'sess-1' });
    mockRepo.getSessionConfig.mockResolvedValue({ sessionDurationHours: 4 });
    mockRepo.getPasswordPolicyRow.mockResolvedValue({ configValue: { passwordExpiryDays: 90 }, updatedAt: new Date(0) });
    mockRepo.getLoginSecurityConfig.mockResolvedValue({});
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ maxFailedAttempts: 5 });
    mockSign.mockResolvedValue('jwt-token');
    mockVerify.mockResolvedValue(false);
  });

  it('an unknown user is not provisioned while LDAP is off', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(null);
    mockLdap.getConfig.mockResolvedValue(OFF);
    await expect(authService.login('jdoe', 'pw', '1.2.3.4', 'ua')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(mockLdap.authenticateUser).not.toHaveBeenCalled();
    expect(mockRepo.createSession).not.toHaveBeenCalled();
  });

  it('an unknown user whose LDAP bind succeeds is provisioned and signed in', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(null);
    mockLdap.getConfig.mockResolvedValue(ON);
    mockLdap.authenticateUser.mockResolvedValue({ dn: 'cn=jdoe', groups: [] });
    mockLdap.provisionUser.mockResolvedValue(ldapUser());
    mockVerify.mockResolvedValue(true); // never consulted: the bind already authenticated
    const r = await authService.login('jdoe', 'pw', '1.2.3.4', 'ua');
    expect(r).toMatchObject({ success: true, token: 'jwt-token', user: { username: 'jdoe', role: 'OPERATOR' }, expiresIn: '4h' });
    expect(mockLdap.provisionUser).toHaveBeenCalledWith('jdoe', { dn: 'cn=jdoe', groups: [] }, ON);
    expect(mockLdap.syncUserAttributes).toHaveBeenCalledWith('u-ldap', { dn: 'cn=jdoe', groups: [] }, ON);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_SUCCESS', sessionId: 'sess-1' }));
  });

  it('an unknown user whose LDAP bind fails, or whose LDAP lookup throws, gets the unified 401', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(null);
    mockLdap.getConfig.mockResolvedValue(ON);
    mockLdap.authenticateUser.mockResolvedValue(null);
    await expect(authService.login('jdoe', 'pw', 'ip', 'ua')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(mockLdap.provisionUser).not.toHaveBeenCalled();

    mockLdap.getConfig.mockRejectedValue(new Error('directory unreachable'));
    await expect(authService.login('jdoe', 'pw', 'ip', 'ua')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(mockRepo.createSession).not.toHaveBeenCalled();
  });

  it('an LDAP-sourced user is authenticated by the bind and synced, never by the local hash', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(ldapUser());
    mockLdap.getConfig.mockResolvedValue(ON);
    mockLdap.authenticateUser.mockResolvedValue({ dn: 'cn=jdoe' });
    const r = await authService.login('jdoe', 'pw', 'ip', 'ua');
    expect(r.success).toBe(true);
    expect(mockVerify).not.toHaveBeenCalledWith('pw', 'LDAP_EXTERNAL_AUTH');
    expect(mockLdap.syncUserAttributes).toHaveBeenCalledWith('u-ldap', { dn: 'cn=jdoe' }, ON);
  });

  it('an LDAP-sourced user with a failed bind is refused like any wrong password', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(ldapUser());
    mockLdap.getConfig.mockResolvedValue(ON);
    mockLdap.authenticateUser.mockResolvedValue(null);
    await expect(authService.login('jdoe', 'pw', 'ip', 'ua')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(mockRepo.createSession).not.toHaveBeenCalled();
  });

  it('a directory error for an LDAP-sourced user is reported as LDAP_ERROR, not as bad credentials', async () => {
    mockRepo.findUserByUsername.mockResolvedValue(ldapUser());
    mockLdap.getConfig.mockResolvedValue(ON);
    mockLdap.authenticateUser.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(authService.login('jdoe', 'pw', 'ip', 'ua')).rejects.toMatchObject({ code: 'LDAP_ERROR', statusCode: 401 });
  });

  it('the LDAP sentinel hash is never a free pass: LDAP off, or a SUPER_ADMIN, is refused', async () => {
    mockLdap.getConfig.mockResolvedValue(OFF);
    mockRepo.findUserByUsername.mockResolvedValue(ldapUser());
    mockVerify.mockResolvedValue(true); // even if a hash comparison would "pass"
    await expect(authService.login('jdoe', 'anything', 'ip', 'ua')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    mockLdap.getConfig.mockResolvedValue(ON);
    mockRepo.findUserByUsername.mockResolvedValue(ldapUser({ role: 'SUPER_ADMIN' }));
    await expect(authService.login('jdoe', 'anything', 'ip', 'ua')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    // The SA path skips the directory entirely.
    expect(mockLdap.authenticateUser).not.toHaveBeenCalled();
    expect(mockRepo.createSession).not.toHaveBeenCalled();
  });
});
