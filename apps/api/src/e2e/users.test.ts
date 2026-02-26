import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPost, authPut, authDelete, ADMIN_PASSWORD } from './test-helper.js';

// Unique suffix to avoid collisions between test runs.
// Used to build a 6-char uppercase alphanumeric username that satisfies
// the default User ID config (format LETTERS_NUMBERS, length 6, UPPERCASE).
const SUFFIX = Date.now().toString(36).toUpperCase().slice(-4);

describe('Users endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // =============================================
  // Existing tests — list, stats, reset-requests
  // =============================================

  describe('GET /api/users', () => {
    it('returns paginated user list for admin', async () => {
      const res = await authGet(app, '/api/users', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.page).toBeDefined();
      expect(body.limit).toBeDefined();
      expect(body.totalPages).toBeDefined();
    });

    it('supports pagination query params', async () => {
      const res = await authGet(app, '/api/users?page=1&limit=5', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.limit).toBe(5);
    });
  });

  describe('GET /api/users/stats', () => {
    it('returns user statistics', async () => {
      const res = await authGet(app, '/api/users/stats', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.total).toBeDefined();
    });
  });

  describe('GET /api/users/reset-requests', () => {
    it('returns reset requests', async () => {
      const res = await authGet(app, '/api/users/reset-requests', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // May be { data: [...] } or direct array
      const data = body.data || body;
      expect(data).toBeDefined();
    });
  });

  describe('GET /api/users/reset-requests/pending', () => {
    it('returns pending reset requests info', async () => {
      const res = await authGet(app, '/api/users/reset-requests/pending', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // May be { count: N } or plain array
      expect(body).toBeDefined();
    });
  });

  describe('Access control', () => {
    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/users' });
      expect(res.statusCode).toBe(401);
    });
  });

  // =============================================
  // New tests — CRUD lifecycle for a single user
  // =============================================

  describe('User CRUD lifecycle', () => {
    const TEST_USERNAME = `TS${SUFFIX}`;  // e.g. "TS1A2B" — 6 uppercase alphanumeric chars
    const TEST_PASSWORD = 'TestPass@123';
    const TEST_EMAIL = `testuser-${SUFFIX.toLowerCase()}@example.com`;
    let createdUserId: string;

    // ---- 1. POST /api/users — Create user ----
    describe('POST /api/users', () => {
      it('creates a new user', async () => {
        const res = await authPost(app, '/api/users', adminToken, {
          username: TEST_USERNAME,
          fullName: 'Test User E2E',
          email: TEST_EMAIL,
          role: 'OPERATOR',
          password: TEST_PASSWORD,
          confirmPassword: TEST_PASSWORD,
        }, ADMIN_PASSWORD);

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.id).toBeTruthy();
        expect(body.username).toBe(TEST_USERNAME);
        expect(body.fullName).toBe('Test User E2E');
        expect(body.email).toBe(TEST_EMAIL);
        expect(body.role).toBe('OPERATOR');
        expect(body.status).toBe('ENABLED');
        createdUserId = body.id;
      });

      it('rejects duplicate username', async () => {
        const res = await authPost(app, '/api/users', adminToken, {
          username: TEST_USERNAME,
          fullName: 'Duplicate User',
          email: `dup-${SUFFIX.toLowerCase()}@example.com`,
          role: 'OPERATOR',
          password: TEST_PASSWORD,
          confirmPassword: TEST_PASSWORD,
        }, ADMIN_PASSWORD);

        expect(res.statusCode).toBe(409);
      });
    });

    // ---- 2. GET /api/users/:id — Get user by ID ----
    describe('GET /api/users/:id', () => {
      it('returns full user detail', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authGet(app, `/api/users/${createdUserId}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe(createdUserId);
        expect(body.username).toBe(TEST_USERNAME);
        expect(body.fullName).toBe('Test User E2E');
        expect(body.email).toBe(TEST_EMAIL);
        expect(body.role).toBe('OPERATOR');
        expect(body.status).toBe('ENABLED');
        expect(body.createdAt).toBeDefined();
        expect(body.updatedAt).toBeDefined();
      });

      it('returns 404 for non-existent user', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const res = await authGet(app, `/api/users/${fakeId}`, adminToken);
        expect(res.statusCode).toBe(404);
      });
    });

    // ---- 3. PUT /api/users/:id — Update user ----
    describe('PUT /api/users/:id', () => {
      it('updates user fullName', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authPut(app, `/api/users/${createdUserId}`, adminToken, {
          fullName: 'Updated Test User',
        }, ADMIN_PASSWORD);

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.fullName).toBe('Updated Test User');
      });

      it('verifies update persisted via GET', async () => {
        const res = await authGet(app, `/api/users/${createdUserId}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.fullName).toBe('Updated Test User');
      });
    });

    // ---- 4. POST /api/users/:id/disable — Disable user ----
    describe('POST /api/users/:id/disable', () => {
      it('disables the user', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authPost(app, `/api/users/${createdUserId}/disable`, adminToken, {}, ADMIN_PASSWORD);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
      });

      it('verifies user is disabled via GET', async () => {
        const res = await authGet(app, `/api/users/${createdUserId}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('DISABLED');
      });
    });

    // ---- 5. POST /api/users/:id/enable — Enable user ----
    describe('POST /api/users/:id/enable', () => {
      it('re-enables the user', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authPost(app, `/api/users/${createdUserId}/enable`, adminToken, {}, ADMIN_PASSWORD);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
      });

      it('verifies user is enabled via GET', async () => {
        const res = await authGet(app, `/api/users/${createdUserId}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('ENABLED');
      });
    });

    // ---- 6. POST /api/users/:id/unlock — Unlock user ----
    describe('POST /api/users/:id/unlock', () => {
      it('unlocks the user with a new temporary password', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authPost(app, `/api/users/${createdUserId}/unlock`, adminToken, {
          newPassword: 'Unlocked@123',
        }, ADMIN_PASSWORD);

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.message).toBeDefined();
      });
    });

    // ---- 7. POST /api/users/:id/reset-password — Admin reset password ----
    describe('POST /api/users/:id/reset-password', () => {
      it('resets the user password', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authPost(app, `/api/users/${createdUserId}/reset-password`, adminToken, {
          newPassword: 'ResetPass@123',
        }, ADMIN_PASSWORD);

        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
        expect(body.message).toBeDefined();
      });
    });

    // ---- 8. DELETE /api/users/:id — Delete user ----
    describe('DELETE /api/users/:id', () => {
      it('deletes the user', async () => {
        expect(createdUserId).toBeTruthy();
        const res = await authDelete(app, `/api/users/${createdUserId}`, adminToken, ADMIN_PASSWORD);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(true);
      });

      it('returns 404 after deletion', async () => {
        const res = await authGet(app, `/api/users/${createdUserId}`, adminToken);
        expect(res.statusCode).toBe(404);
      });
    });
  });
});
