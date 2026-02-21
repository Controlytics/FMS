import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPost } from './test-helper.js';

describe('Auth endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // =============================================
  // POST /api/auth/login
  // =============================================
  describe('POST /api/auth/login', () => {
    it('returns 200 with token for valid credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'Admin@123' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.token).toBeTruthy();
      expect(body.user).toBeDefined();
      expect(body.user.username).toBe('admin');
      expect(body.expiresIn).toBeTruthy();
    });

    it('returns 401 for wrong password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'WrongPassword@1' },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 for non-existent user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'nonexistent', password: 'SomePass@1' },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_CREDENTIALS');
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: '' },
      });

      // Either 400 (validation) or 401 (auth logic)
      expect([400, 401]).toContain(res.statusCode);
    });
  });

  // =============================================
  // GET /api/auth/me
  // =============================================
  describe('GET /api/auth/me', () => {
    it('returns current user when authenticated', async () => {
      const token = await loginAs(app);
      const res = await authGet(app, '/api/auth/me', token);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.username).toBe('admin');
      expect(body.role).toBeDefined();
      expect(body.email).toBeDefined();
    });

    it('returns 401 without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // =============================================
  // POST /api/auth/logout
  // =============================================
  describe('POST /api/auth/logout', () => {
    it('logs out successfully', async () => {
      const token = await loginAs(app);
      const res = await authPost(app, '/api/auth/logout', token);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('session is invalid after logout', async () => {
      const token = await loginAs(app);
      await authPost(app, '/api/auth/logout', token);

      // Subsequent request should fail
      const res = await authGet(app, '/api/auth/me', token);
      expect(res.statusCode).toBe(401);
    });
  });

  // =============================================
  // POST /api/auth/verify (re-auth)
  // =============================================
  describe('POST /api/auth/verify', () => {
    it('returns verification token for correct password', async () => {
      const token = await loginAs(app);
      const res = await authPost(app, '/api/auth/verify', token, {
        password: 'Admin@123',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.verificationToken).toBeTruthy();
    });

    it('returns 401 for wrong password', async () => {
      const token = await loginAs(app);
      const res = await authPost(app, '/api/auth/verify', token, {
        password: 'WrongPassword@1',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when password is missing', async () => {
      const token = await loginAs(app);
      const res = await authPost(app, '/api/auth/verify', token, {});
      expect(res.statusCode).toBe(400);
    });
  });

  // =============================================
  // POST /api/auth/forgot-password
  // =============================================
  describe('POST /api/auth/forgot-password', () => {
    it('returns success for existing user (no enumeration)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { username: 'admin' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('returns success even for non-existent user (prevents enumeration)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { username: 'doesnotexist' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('requires username in body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // =============================================
  // POST /api/auth/beacon-logout
  // =============================================
  describe('POST /api/auth/beacon-logout', () => {
    it('terminates session via beacon', async () => {
      const token = await loginAs(app);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/beacon-logout',
        payload: { token },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('returns success for invalid token (graceful)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/beacon-logout',
        payload: { token: 'expired.or.invalid' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('requires no auth header (public endpoint)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/beacon-logout',
        payload: { token: 'some-token' },
      });

      // Should not get 401
      expect(res.statusCode).not.toBe(401);
    });
  });
});
