import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet } from './test-helper.js';

describe('Config endpoints', () => {
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
  // Branding (public GET)
  // =============================================
  describe('GET /api/config/branding', () => {
    it('returns branding config without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config/branding' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.appName).toBeTruthy();
    });
  });

  // =============================================
  // Datetime (public current)
  // =============================================
  describe('GET /api/config/datetime/current', () => {
    it('returns datetime config without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config/datetime/current' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.dateFormat).toBeTruthy();
      expect(body.timeFormat).toBeTruthy();
    });
  });

  // =============================================
  // Password Policy
  // =============================================
  describe('GET /api/config/password-policy', () => {
    it('returns password policy when authenticated', async () => {
      const res = await authGet(app, '/api/config/password-policy', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.minLength).toBeDefined();
      expect(body.requireUppercase).toBeDefined();
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/config/password-policy' });
      expect(res.statusCode).toBe(401);
    });
  });

  // =============================================
  // Session Config
  // =============================================
  describe('GET /api/config/session', () => {
    it('returns session config when authenticated', async () => {
      const res = await authGet(app, '/api/config/session', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessionDurationHours).toBeDefined();
    });
  });

  // =============================================
  // Datetime Config (authenticated)
  // =============================================
  describe('GET /api/config/datetime', () => {
    it('returns datetime config when authenticated', async () => {
      const res = await authGet(app, '/api/config/datetime', adminToken);
      expect(res.statusCode).toBe(200);
    });
  });

  // =============================================
  // Pagination Config
  // =============================================
  describe('GET /api/config/pagination/current', () => {
    it('returns pagination config', async () => {
      const res = await authGet(app, '/api/config/pagination/current', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.options).toBeDefined();
    });
  });

  // =============================================
  // User ID Config
  // =============================================
  describe('GET /api/config/user-id', () => {
    it('returns user ID config when authenticated', async () => {
      const res = await authGet(app, '/api/config/user-id', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.format).toBeDefined();
      expect(body.length).toBeDefined();
    });
  });

  // =============================================
  // Action Reauth Config
  // =============================================
  describe('GET /api/config/action-reauth', () => {
    it('returns action reauth config when authenticated', async () => {
      const res = await authGet(app, '/api/config/action-reauth', adminToken);
      expect(res.statusCode).toBe(200);
    });
  });

  // =============================================
  // My Actions (per-user)
  // =============================================
  describe('GET /api/config/action-reauth/my-actions', () => {
    it('returns actions for current user', async () => {
      const res = await authGet(app, '/api/config/action-reauth/my-actions', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Could be { actions: [...] } or a direct array
      const actions = body.actions || body;
      expect(actions).toBeDefined();
    });
  });

  // =============================================
  // Field IDs Config
  // =============================================
  describe('GET /api/config/field-ids', () => {
    it('returns field IDs when authenticated', async () => {
      const res = await authGet(app, '/api/config/field-ids', adminToken);
      expect(res.statusCode).toBe(200);
    });
  });
});
