import { describe, it, expect, beforeAll } from 'vitest';
import { api, getAdminToken, createTestUser, loginTestUser, uid, suffix } from './helpers';

describe('USER MANAGEMENT MODULE', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  // ─── CREATE USER ────────────────────────────────────────────
  describe('POST /users (Create)', () => {
    it('should create a new user with valid data', async () => {
      const username = uid();
      const sfx = suffix();
      const res = await api('POST', '/users', {
        username,
        fullName: `New User ${sfx}`,
        email: `${sfx}@test.com`,
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
        status: 'ENABLED',
      }, adminToken);

      expect(res.status).toBe(201);
      expect(res.data.id).toBeDefined();
      expect(res.data.username).toBe(username);
      expect(res.data.role).toBe('OPERATOR');
      expect(res.data.status).toBe('ENABLED');
      expect(res.data.createdAt).toBeDefined();
    });

    it('should create user with all roles', async () => {
      const roles = ['ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'];
      for (const role of roles) {
        const sfx = suffix();
        const res = await api('POST', '/users', {
          username: uid(),
          fullName: `${role} User`,
          email: `${sfx}@test.com`,
          role,
          password: 'ValidPass@123',
          confirmPassword: 'ValidPass@123',
        }, adminToken);
        expect(res.status).toBe(201);
        expect(res.data.role).toBe(role);
      }
    });

    it('should set forcePasswordChange on new users', async () => {
      const user = await createTestUser(adminToken);
      const loginRes = await api('POST', '/auth/login', {
        username: user.username,
        password: user.password,
      });
      expect(loginRes.data.user.forcePasswordChange).toBe(true);
      expect(loginRes.data.user.isTemporaryPassword).toBe(true);
    });

    it('should reject duplicate username', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('POST', '/users', {
        username: user.username,
        fullName: 'Duplicate User',
        email: `${suffix()}@test.com`,
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      }, adminToken);
      expect(res.status).toBe(409);
      expect(res.data.error).toBe('CONFLICT');
    });

    it('should reject duplicate email', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'Dup Email User',
        email: user.email,
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      }, adminToken);
      expect(res.status).toBe(409);
      expect(res.data.error).toBe('CONFLICT');
    });

    it('should reject username shorter than 6 chars', async () => {
      const res = await api('POST', '/users', {
        username: 'ABCDE',
        fullName: 'Short Username',
        email: `${suffix()}@test.com`,
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      }, adminToken);
      expect(res.status).toBe(400);
      // Server may return VALIDATION_ERROR (Zod) or USERID_POLICY_VIOLATION (custom policy)
      expect(['VALIDATION_ERROR', 'USERID_POLICY_VIOLATION']).toContain(res.data.error);
    });

    it('should reject invalid email format', async () => {
      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'Invalid Email',
        email: 'not-an-email',
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject mismatched passwords', async () => {
      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'Mismatch User',
        email: `${suffix()}@test.com`,
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'DifferentPass@123',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject password shorter than 8 chars', async () => {
      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'Short Password',
        email: `${suffix()}@test.com`,
        role: 'OPERATOR',
        password: 'Sh@1',
        confirmPassword: 'Sh@1',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject invalid role', async () => {
      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'Bad Role',
        email: `${suffix()}@test.com`,
        role: 'NONEXISTENT_ROLE',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject without auth token', async () => {
      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'No Auth',
        email: `${suffix()}@test.com`,
        role: 'OPERATOR',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── LIST USERS ─────────────────────────────────────────────
  describe('GET /users (List)', () => {
    it('should list users with pagination', async () => {
      const res = await api('GET', '/users?page=1&limit=10', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.data).toBeInstanceOf(Array);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
      expect(res.data.page).toBe(1);
      expect(res.data.limit).toBe(10);
      expect(res.data.totalPages).toBeDefined();
    });

    it('should filter by role', async () => {
      const res = await api('GET', '/users?role=SUPER_ADMIN', null, adminToken);
      expect(res.status).toBe(200);
      for (const user of res.data.data) {
        expect(user.role).toBe('SUPER_ADMIN');
      }
    });

    it('should filter by status', async () => {
      const res = await api('GET', '/users?status=ENABLED', null, adminToken);
      expect(res.status).toBe(200);
      for (const user of res.data.data) {
        expect(user.status).toBe('ENABLED');
      }
    });

    it('should search users by username/fullName/email', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('GET', `/users?search=${user.username}`, null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThanOrEqual(1);
      expect(res.data.data.some((u: any) => u.username === user.username)).toBe(true);
    });

    it('should not expose passwordHash in list', async () => {
      const res = await api('GET', '/users?limit=5', null, adminToken);
      for (const user of res.data.data) {
        expect(user.passwordHash).toBeUndefined();
        expect(user.password).toBeUndefined();
      }
    });

    it('should reject without auth', async () => {
      const res = await api('GET', '/users');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET USER DETAIL ────────────────────────────────────────
  describe('GET /users/:id (Detail)', () => {
    it('should return user detail', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('GET', `/users/${user.id}`, null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.id).toBe(user.id);
      expect(res.data.username).toBe(user.username);
      expect(res.data.fullName).toBeDefined();
      expect(res.data.createdAt).toBeDefined();
    });

    it('should return 404 for non-existent user', async () => {
      const res = await api('GET', '/users/00000000-0000-0000-0000-000000000000', null, adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── UPDATE USER ────────────────────────────────────────────
  describe('PUT /users/:id (Update)', () => {
    it('should update user fullName', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('PUT', `/users/${user.id}`, {
        fullName: 'Updated Name',
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.fullName).toBe('Updated Name');
    });

    it('should update user email', async () => {
      const newEmail = `${suffix()}@test.com`;
      const user = await createTestUser(adminToken);
      const res = await api('PUT', `/users/${user.id}`, {
        email: newEmail,
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.email).toBe(newEmail);
    });

    it('should update user role', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('PUT', `/users/${user.id}`, {
        role: 'SUPERVISOR',
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.role).toBe('SUPERVISOR');
    });

    it('should reject duplicate email on update', async () => {
      const user1 = await createTestUser(adminToken);
      const user2 = await createTestUser(adminToken);
      const res = await api('PUT', `/users/${user2.id}`, {
        email: user1.email,
      }, adminToken);
      expect(res.status).toBe(409);
    });

    it('should return 404 for non-existent user', async () => {
      const res = await api('PUT', '/users/00000000-0000-0000-0000-000000000000', {
        fullName: 'Ghost',
      }, adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── ENABLE / DISABLE ──────────────────────────────────────
  describe('POST /users/:id/enable & /disable', () => {
    it('should disable a user', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('POST', `/users/${user.id}/disable`, { reason: 'Test disable' }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Verify status
      const detail = await api('GET', `/users/${user.id}`, null, adminToken);
      expect(detail.data.status).toBe('DISABLED');
    });

    it('should enable a disabled user', async () => {
      const user = await createTestUser(adminToken);
      await api('POST', `/users/${user.id}/disable`, { reason: 'Test disable' }, adminToken);
      const res = await api('POST', `/users/${user.id}/enable`, { reason: 'Test enable' }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      const detail = await api('GET', `/users/${user.id}`, null, adminToken);
      expect(detail.data.status).toBe('ENABLED');
    });

    it('should invalidate sessions on disable', async () => {
      const user = await createTestUser(adminToken);
      // Login as user
      const loginRes = await loginTestUser(user.username, user.password, 'DisableTest@1');
      expect(loginRes.ok).toBe(true);
      const userToken = loginRes.data.token;

      // Disable user
      await api('POST', `/users/${user.id}/disable`, { reason: 'Test disable' }, adminToken);

      // User's token should no longer work
      const meRes = await api('GET', '/auth/me', null, userToken);
      expect([401, 403]).toContain(meRes.status);
    });
  });

  // ─── UNLOCK ─────────────────────────────────────────────────
  describe('POST /users/:id/unlock', () => {
    it('should unlock a locked account', async () => {
      const user = await createTestUser(adminToken);
      const newPwd = 'UnlockTest@Pass1';
      await loginTestUser(user.username, user.password, newPwd);

      // Lock the account (retries=0 to avoid rate-limit interference)
      for (let i = 0; i < 6; i++) {
        await api('POST', '/auth/login', {
          username: user.username,
          password: 'WrongPass@999',
        }, null, 0);
      }

      // Unlock
      const res = await api('POST', `/users/${user.id}/unlock`, { reason: 'Test unlock' }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Should be able to login again
      const loginRes = await api('POST', '/auth/login', {
        username: user.username,
        password: newPwd,
        forceLogin: true,
      });
      expect(loginRes.ok).toBe(true);
    });
  });

  // ─── RESET PASSWORD ────────────────────────────────────────
  describe('POST /users/:id/reset-password', () => {
    it('should reset user password', async () => {
      const user = await createTestUser(adminToken);
      const newPwd = 'ResetNewPass@123';

      const res = await api('POST', `/users/${user.id}/reset-password`, {
        newPassword: newPwd,
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Login with new password
      const loginRes = await api('POST', '/auth/login', {
        username: user.username,
        password: newPwd,
        forceLogin: true,
      });
      expect(loginRes.ok).toBe(true);
      // Should have forcePasswordChange
      expect(loginRes.data.user.forcePasswordChange).toBe(true);
    });

    it('should reject password shorter than 8 chars on reset', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('POST', `/users/${user.id}/reset-password`, {
        newPassword: 'Sh@1',
      }, adminToken);
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE USER ────────────────────────────────────────────
  describe('DELETE /users/:id', () => {
    it('should soft-delete (disable) a user', async () => {
      const user = await createTestUser(adminToken);
      const res = await api('DELETE', `/users/${user.id}`, { reason: 'Test delete' }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Verify disabled
      const detail = await api('GET', `/users/${user.id}`, null, adminToken);
      expect(detail.data.status).toBe('DISABLED');
    });

    it('should prevent self-deletion', async () => {
      // Get admin's own ID
      const me = await api('GET', '/auth/me', null, adminToken);
      const res = await api('DELETE', `/users/${me.data.id}`, { reason: 'Test' }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent user', async () => {
      const res = await api('DELETE', '/users/00000000-0000-0000-0000-000000000000', { reason: 'Test' }, adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── RBAC: Role-Based Access Control ───────────────────────
  describe('RBAC - Role Restrictions', () => {
    it('should deny OPERATOR from creating users', async () => {
      const operator = await createTestUser(adminToken, { role: 'OPERATOR' });
      const loginRes = await loginTestUser(operator.username, operator.password, 'OperTest@Pass1');
      expect(loginRes.ok).toBe(true);
      const operatorToken = loginRes.data.token;

      const res = await api('POST', '/users', {
        username: uid(),
        fullName: 'Op Created User',
        email: `${suffix()}@test.com`,
        role: 'VIEWER',
        password: 'ValidPass@123',
        confirmPassword: 'ValidPass@123',
      }, operatorToken);
      expect(res.status).toBe(403);
    });

    it('should deny VIEWER from listing users', async () => {
      const viewer = await createTestUser(adminToken, { role: 'VIEWER' });
      const loginRes = await loginTestUser(viewer.username, viewer.password, 'ViewTest@Pass1');
      expect(loginRes.ok).toBe(true);
      const viewerToken = loginRes.data.token;

      const res = await api('GET', '/users', null, viewerToken);
      expect(res.status).toBe(403);
    });

    it('should deny SUPERVISOR from managing users', async () => {
      const supervisor = await createTestUser(adminToken, { role: 'SUPERVISOR' });
      const loginRes = await loginTestUser(supervisor.username, supervisor.password, 'SupTest@Pass1');
      expect(loginRes.ok).toBe(true);
      const supToken = loginRes.data.token;

      const res = await api('GET', '/users', null, supToken);
      expect(res.status).toBe(403);
    });
  });
});
