import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet } from './test-helper.js';

describe('Roles endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/roles', () => {
    it('returns all roles for admin', async () => {
      const res = await authGet(app, '/api/roles', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Check default system roles exist
      const names = body.map((r: any) => r.name);
      expect(names).toContain('SUPER_ADMIN');
      expect(names).toContain('ADMIN');
      expect(names).toContain('VIEWER');
    });
  });

  describe('GET /api/roles/active', () => {
    it('returns active roles', async () => {
      const res = await authGet(app, '/api/roles/active', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Each role should have basic fields
      for (const role of body) {
        expect(role.name).toBeTruthy();
        expect(role.displayName).toBeTruthy();
      }
    });
  });

  describe('GET /api/roles/:name', () => {
    it('returns a specific role', async () => {
      const res = await authGet(app, '/api/roles/ADMIN', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('ADMIN');
      expect(body.permissions).toBeDefined();
    });

    it('returns 404 for non-existent role', async () => {
      const res = await authGet(app, '/api/roles/NONEXISTENT', adminToken);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/roles/permissions/all', () => {
    it('returns all available permissions', async () => {
      const res = await authGet(app, '/api/roles/permissions/all', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Response may be { permissions: [...] } or plain array
      const perms = body.permissions || body;
      if (Array.isArray(perms)) {
        expect(perms.length).toBeGreaterThan(0);
      } else {
        // It's an object with permission keys
        expect(Object.keys(perms).length).toBeGreaterThan(0);
      }
    });
  });

  describe('GET /api/roles/:name/creatable', () => {
    it('returns creatable roles for SUPER_ADMIN', async () => {
      const res = await authGet(app, '/api/roles/SUPER_ADMIN/creatable', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
    });
  });
});
