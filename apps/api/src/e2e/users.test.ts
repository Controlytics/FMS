import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet } from './test-helper.js';

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
});
