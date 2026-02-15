import { describe, it, expect, beforeAll } from 'vitest';
import { api, getAdminToken, getAdminPassword, createTestUser, loginTestUser, uid } from './helpers';

describe('AUTH MODULE', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  // ─── LOGIN ──────────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      // Use a test user to avoid killing the admin session with forceLogin
      const user = await createTestUser(adminToken);
      const res = await api('POST', '/auth/login', {
        username: user.username,
        password: user.password,
        forceLogin: true,
      });
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.token).toBeDefined();
      expect(res.data.user).toBeDefined();
      expect(res.data.user.username).toBe(user.username);
      expect(res.data.expiresIn).toBe('8h');
    });

    it('should reject empty username', async () => {
      const res = await api('POST', '/auth/login', { username: '', password: 'anything' });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe('VALIDATION_ERROR');
    });

    it('should reject empty password', async () => {
      const res = await api('POST', '/auth/login', { username: 'admin', password: '' });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe('VALIDATION_ERROR');
    });

    it('should reject missing body fields', async () => {
      const res = await api('POST', '/auth/login', {});
      expect(res.status).toBe(400);
    });

    it('should return 401 for wrong password', async () => {
      const res = await api('POST', '/auth/login', {
        username: 'admin',
        password: 'WrongPassword@123',
      });
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for non-existent user (no user enumeration)', async () => {
      const res = await api('POST', '/auth/login', {
        username: uid(),
        password: 'SomePass@123',
      });
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('INVALID_CREDENTIALS');
      // Should NOT have attemptsRemaining (prevents user enumeration)
      expect(res.data.attemptsRemaining).toBeUndefined();
    });

    it('should show attemptsRemaining on wrong password for existing user', async () => {
      // Create a fresh user to test
      const user = await createTestUser(adminToken);
      const userPwd = 'FreshUserPass@1';
      await loginTestUser(user.username, user.password, userPwd);

      const res = await api('POST', '/auth/login', {
        username: user.username,
        password: 'TotallyWrong@1',
      });
      expect(res.status).toBe(401);
      expect(res.data.attemptsRemaining).toBeDefined();
      expect(typeof res.data.attemptsRemaining).toBe('number');
    });

    it('should return user info including role', async () => {
      // Check role via /auth/me to avoid killing admin session with forceLogin
      const res = await api('GET', '/auth/me', null, adminToken);
      expect(res.data.role).toBeDefined();
      expect(['SUPER_ADMIN', 'ADMIN']).toContain(res.data.role);
    });
  });

  // ─── ME ─────────────────────────────────────────────────────
  describe('GET /auth/me', () => {
    it('should return current user info with valid token', async () => {
      const res = await api('GET', '/auth/me', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.username).toBe('admin');
      expect(res.data.id).toBeDefined();
      expect(res.data.role).toBeDefined();
      expect(res.data.email).toBeDefined();
      expect(res.data.status).toBe('ENABLED');
    });

    it('should return 401 without token', async () => {
      const res = await api('GET', '/auth/me');
      expect(res.status).toBe(401);
    });

    it('should return 401 with invalid token', async () => {
      const res = await api('GET', '/auth/me', null, 'invalid.jwt.token');
      expect(res.status).toBe(401);
    });

    it('should return 401 with expired/tampered token', async () => {
      const tamperedToken = adminToken.slice(0, -5) + 'xxxxx';
      const res = await api('GET', '/auth/me', null, tamperedToken);
      expect(res.status).toBe(401);
    });

    it('should NOT return passwordHash in response', async () => {
      const res = await api('GET', '/auth/me', null, adminToken);
      expect(res.data.passwordHash).toBeUndefined();
      expect(res.data.password).toBeUndefined();
    });
  });

  // ─── LOGOUT ─────────────────────────────────────────────────
  describe('POST /auth/logout', () => {
    it('should logout and invalidate session', async () => {
      // Use a test user to avoid killing the admin session
      const user = await createTestUser(adminToken);
      const loginRes = await loginTestUser(user.username, user.password, 'LogoutTest@1');
      expect(loginRes.ok).toBe(true);
      const tempToken = loginRes.data.token;

      // Logout
      const logoutRes = await api('POST', '/auth/logout', null, tempToken);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.data.success).toBe(true);

      // Token should no longer work
      const meRes = await api('GET', '/auth/me', null, tempToken);
      expect(meRes.status).toBe(401);
    });

    it('should reject logout without token', async () => {
      const res = await api('POST', '/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  // ─── CHANGE PASSWORD ───────────────────────────────────────
  describe('POST /auth/change-password', () => {
    it('should change password with valid data', async () => {
      const user = await createTestUser(adminToken);
      const tempPwd = user.password;
      const newPwd = 'NewSecure@Pass1';

      // Login (will have forcePasswordChange)
      const loginRes = await api('POST', '/auth/login', {
        username: user.username,
        password: tempPwd,
        forceLogin: true,
      });
      expect(loginRes.ok).toBe(true);
      const token = loginRes.data.token;

      const res = await api('POST', '/auth/change-password', {
        currentPassword: tempPwd,
        newPassword: newPwd,
        confirmPassword: newPwd,
      }, token);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Login with new password
      const reLogin = await api('POST', '/auth/login', {
        username: user.username,
        password: newPwd,
        forceLogin: true,
      });
      expect(reLogin.ok).toBe(true);
    });

    it('should reject when current password is wrong', async () => {
      const res = await api('POST', '/auth/change-password', {
        currentPassword: 'WrongOldPass@1',
        newPassword: 'NewPass@12345',
        confirmPassword: 'NewPass@12345',
      }, adminToken);
      expect(res.status).toBe(400);
      expect(res.data.error).toBe('INVALID_PASSWORD');
    });

    it('should reject when passwords do not match', async () => {
      const res = await api('POST', '/auth/change-password', {
        currentPassword: getAdminPassword(),
        newPassword: 'NewPass@12345',
        confirmPassword: 'DifferentPass@12345',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject password shorter than 8 chars', async () => {
      const res = await api('POST', '/auth/change-password', {
        currentPassword: getAdminPassword(),
        newPassword: 'Sh@1t',
        confirmPassword: 'Sh@1t',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject without auth token', async () => {
      const res = await api('POST', '/auth/change-password', {
        currentPassword: 'old',
        newPassword: 'NewPass@12345',
        confirmPassword: 'NewPass@12345',
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── VERIFY (re-auth) ──────────────────────────────────────
  describe('POST /auth/verify', () => {
    it('should return verification token with correct password', async () => {
      const res = await api('POST', '/auth/verify', {
        password: getAdminPassword(),
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.verificationToken).toBeDefined();
    });

    it('should reject with wrong password', async () => {
      const res = await api('POST', '/auth/verify', {
        password: 'TotallyWrong@1',
      }, adminToken);
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('INVALID_PASSWORD');
    });

    it('should reject without password field', async () => {
      const res = await api('POST', '/auth/verify', {}, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject without auth token', async () => {
      const res = await api('POST', '/auth/verify', {
        password: 'anything',
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── ACCOUNT LOCKOUT ───────────────────────────────────────
  describe('Account Lockout', () => {
    it('should lock account after max failed attempts', async () => {
      const user = await createTestUser(adminToken);
      // First change password so user is fully set up
      const loginRes = await loginTestUser(user.username, user.password, 'LockTest@Pass1');
      expect(loginRes.ok).toBe(true);

      // Fail login multiple times (default max = 5)
      // Use retries=0 to avoid rate-limit retries inflating the attempt count
      for (let i = 0; i < 5; i++) {
        await api('POST', '/auth/login', {
          username: user.username,
          password: 'WrongPass@999',
        }, null, 0);
      }

      // Next attempt should show locked
      const res = await api('POST', '/auth/login', {
        username: user.username,
        password: 'WrongPass@999',
      }, null, 0);
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('ACCOUNT_LOCKED');
    });

    it('should not allow login even with correct password when locked', async () => {
      const user = await createTestUser(adminToken);
      const newPwd = 'LockedTest@Pass1';
      await loginTestUser(user.username, user.password, newPwd);

      // Lock the account with retries=0 to avoid rate-limit interference
      for (let i = 0; i < 6; i++) {
        await api('POST', '/auth/login', {
          username: user.username,
          password: 'WrongPass@999',
        }, null, 0);
      }

      // Try correct password — should still be locked
      const res = await api('POST', '/auth/login', {
        username: user.username,
        password: newPwd,
      }, null, 0);
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('ACCOUNT_LOCKED');
    });
  });

  // ─── DISABLED ACCOUNT ──────────────────────────────────────
  describe('Disabled Account', () => {
    it('should reject login for disabled user', async () => {
      const user = await createTestUser(adminToken);

      // Disable user
      await api('POST', `/users/${user.id}/disable`, { reason: 'Test disable' }, adminToken);

      const res = await api('POST', '/auth/login', {
        username: user.username,
        password: user.password,
      });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe('ACCOUNT_DISABLED');
    });
  });
});
