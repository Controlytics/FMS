/**
 * Repository fallbacks when a config row is absent (coverage, 2026-10-21).
 *
 * `password-policy`, `login-security` and `session` always exist on the shared
 * test DB and must not be deleted there, so the "row missing" answers are
 * checked with the Prisma client mocked at the module boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { systemConfig: { findUnique: vi.fn() } },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../plugins/auth.js', () => ({ invalidateUserAuthCache: vi.fn(), invalidateSessionAuthCache: vi.fn() }));
vi.mock('../../../plugins/rbac.js', () => ({ invalidateRolePermsCache: vi.fn() }));

import { authRepository } from '../../auth/auth.repository.js';
import { userRepository } from '../user.repository.js';

describe('config-row fallbacks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('auth repository: no row -> empty login-security / session config, built-in password policy', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
    expect(await authRepository.getLoginSecurityConfig()).toEqual({});
    expect(await authRepository.getSessionConfig()).toEqual({});
    expect(await authRepository.getPasswordPolicyConfig()).toEqual({
      minLength: 8, maxLength: 128, requireUppercase: true, requireLowercase: true,
      requireNumbers: true, requireSpecialChars: true, minUppercase: 1, minLowercase: 1,
      minNumbers: 1, minSpecialChars: 1, preventReuseCount: 12, cannotBeUserId: true,
      cannotContainUserId: true,
    });
    expect(mockPrisma.systemConfig.findUnique.mock.calls.map((c) => c[0].where.configKey)).toEqual(['login-security', 'session', 'password-policy']);
  });

  it('user repository: password expiry date is 90 days with no policy, none when expiry is 0 or negative', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
    const d = await userRepository.getPasswordExpiresAt();
    expect(Math.round((d!.getTime() - Date.now()) / 86_400_000)).toBe(90);

    mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ configValue: { passwordExpiryDays: 0 } });
    expect(await userRepository.getPasswordExpiresAt()).toBeNull();
    mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ configValue: { passwordExpiryDays: -5 } });
    expect(await userRepository.getPasswordExpiresAt()).toBeNull();

    mockPrisma.systemConfig.findUnique.mockResolvedValueOnce({ configValue: { passwordExpiryDays: 30 } });
    const d30 = await userRepository.getPasswordExpiresAt();
    expect(Math.round((d30!.getTime() - Date.now()) / 86_400_000)).toBe(30);
  });
});
