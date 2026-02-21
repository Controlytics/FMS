import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet } from './test-helper.js';

describe('Audit Trail endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/audit', () => {
    it('returns paginated audit entries', async () => {
      const res = await authGet(app, '/api/audit', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.total).toBeDefined();
      expect(body.page).toBeDefined();
    });

    it('supports search filter', async () => {
      const res = await authGet(app, '/api/audit?search=LOGIN', adminToken);
      expect(res.statusCode).toBe(200);
    });

    it('supports period filter', async () => {
      const res = await authGet(app, '/api/audit?period=today', adminToken);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/audit/:id', () => {
    it('returns a specific audit entry with integrity check', async () => {
      // First get the list
      const listRes = await authGet(app, '/api/audit?limit=1', adminToken);
      const list = JSON.parse(listRes.body);

      if (list.data && list.data.length > 0) {
        const entryId = list.data[0].id;
        const res = await authGet(app, `/api/audit/${entryId}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe(entryId);
        expect(body.integrityValid).toBeDefined();
      }
    });

    it('returns 404 for non-existent entry', async () => {
      // Audit IDs are integers — use a very large number that won't exist
      const res = await authGet(app, '/api/audit/999999999', adminToken);
      expect(res.statusCode).toBe(404);
    });
  });
});
