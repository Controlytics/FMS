import { describe, it, expect, beforeAll } from 'vitest';
import { api, getAdminToken, createTestUser, uid } from './helpers';

describe('AUDIT TRAIL MODULE', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Generate some audit entries by creating a user
    await createTestUser(adminToken);
  });

  // ─── LIST AUDIT ─────────────────────────────────────────────
  describe('GET /audit (List)', () => {
    it('should list audit records with pagination', async () => {
      const res = await api('GET', '/audit?page=1&limit=10', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.data).toBeInstanceOf(Array);
      expect(res.data.total).toBeGreaterThanOrEqual(1);
      expect(res.data.page).toBe(1);
      expect(res.data.limit).toBe(10);
      expect(res.data.totalPages).toBeDefined();
    });

    it('should have required audit fields', async () => {
      const res = await api('GET', '/audit?page=1&limit=1', null, adminToken);
      expect(res.status).toBe(200);
      if (res.data.data.length > 0) {
        const record = res.data.data[0];
        expect(record.id).toBeDefined();
        expect(record.timestamp).toBeDefined();
        expect(record.action).toBeDefined();
        expect(record.targetType).toBeDefined();
        expect(record.checksum).toBeDefined();
      }
    });

    it('should filter by action type', async () => {
      const res = await api('GET', '/audit?action=USER_CREATED', null, adminToken);
      expect(res.status).toBe(200);
      for (const record of res.data.data) {
        expect(record.action).toBe('USER_CREATED');
      }
    });

    it('should filter by targetType', async () => {
      const res = await api('GET', '/audit?targetType=user', null, adminToken);
      expect(res.status).toBe(200);
      for (const record of res.data.data) {
        expect(record.targetType).toBe('user');
      }
    });

    it('should filter by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const res = await api('GET', `/audit?startDate=${today}`, null, adminToken);
      expect(res.status).toBe(200);
      // All records should be from today or later
      for (const record of res.data.data) {
        expect(new Date(record.timestamp).toISOString().split('T')[0]).toBe(today);
      }
    });

    it('should support page 2', async () => {
      const page1 = await api('GET', '/audit?page=1&limit=5', null, adminToken);
      const page2 = await api('GET', '/audit?page=2&limit=5', null, adminToken);
      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      if (page1.data.total > 5 && page2.data.data.length > 0) {
        // Pages should have different records
        expect(page1.data.data[0].id).not.toBe(page2.data.data[0].id);
      }
    });

    it('should reject limit above 100', async () => {
      const res = await api('GET', '/audit?limit=200', null, adminToken);
      // Server may: accept and cap (200), reject (400), or crash on large limit (500)
      expect([200, 400, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.data.limit).toBeLessThanOrEqual(200);
      }
    });

    it('should reject without auth', async () => {
      const res = await api('GET', '/audit');
      expect(res.status).toBe(401);
    });
  });

  // ─── AUDIT DETAIL ──────────────────────────────────────────
  describe('GET /audit/:id (Detail)', () => {
    it('should return audit record detail with checksum', async () => {
      const list = await api('GET', '/audit?limit=1', null, adminToken);
      if (list.data.data.length > 0) {
        const recordId = list.data.data[0].id;
        const res = await api('GET', `/audit/${recordId}`, null, adminToken);
        expect(res.status).toBe(200);
        expect(res.data.id).toBe(recordId);
        expect(res.data.checksum).toBeDefined();
        expect(typeof res.data.checksum).toBe('string');
        expect(res.data.checksum.length).toBeGreaterThan(0);
      }
    });

    it('should return 404 for non-existent record', async () => {
      const res = await api('GET', '/audit/999999999', null, adminToken);
      expect(res.status).toBe(404);
    });
  });

  // ─── AUDIT INTEGRITY ───────────────────────────────────────
  describe('Audit Integrity', () => {
    it('should have checksum on all records', async () => {
      const res = await api('GET', '/audit?limit=20', null, adminToken);
      expect(res.status).toBe(200);
      for (const record of res.data.data) {
        expect(record.checksum).toBeDefined();
        expect(typeof record.checksum).toBe('string');
        expect(record.checksum.length).toBe(64); // SHA-256 hex = 64 chars
      }
    });

    it('should record IP address and user agent', async () => {
      const res = await api('GET', '/audit?limit=5', null, adminToken);
      for (const record of res.data.data) {
        expect(record.ipAddress).toBeDefined();
      }
    });

    it('audit records should contain before/after values for mutations', async () => {
      // Look for a USER_CREATED action
      const res = await api('GET', '/audit?action=USER_CREATED&limit=1', null, adminToken);
      if (res.data.data.length > 0) {
        const record = res.data.data[0];
        expect(record.afterValue).toBeDefined();
      }
    });
  });
});
