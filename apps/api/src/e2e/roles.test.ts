import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPost, authPut, authDelete, ADMIN_PASSWORD } from './test-helper.js';
import { prisma } from '../lib/prisma.js';

const SUFFIX = Date.now();
// Role names are capped at 20 chars (audit_trail.user_role VarChar(20)); `TEST_ROLE_<ms>` was 23.
const TEST_ROLE_NAME = `TEST_ROLE_${SUFFIX % 1e8}`;

describe('Roles endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp();
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    // Cleanup: try to delete the test role in case a test left it behind
    await authDelete(app, `/api/roles/${TEST_ROLE_NAME}`, adminToken, ADMIN_PASSWORD);
    await app.close();
  });

  // ===========================================================================
  // EXISTING TESTS (unchanged)
  // ===========================================================================

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
      expect(names).toContain('SUPERVISOR');
      // 2026-10-21 (operator): VIEWER and MAINTENANCE must not exist.
      expect(names).not.toContain('VIEWER');
      expect(names).not.toContain('MAINTENANCE');
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

  // ===========================================================================
  // NEW TESTS — POST / PUT / DELETE
  // ===========================================================================

  describe('POST /api/roles — Create role', () => {
    it('creates a new custom role', async () => {
      const res = await authPost(app, '/api/roles', adminToken, {
        name: TEST_ROLE_NAME,
        displayName: `Test Role ${SUFFIX}`,
        description: 'Role created by e2e test',
        hierarchyLevel: 1,
        permissions: ['AUDIT_READ'],
        color: '#22c55e',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe(TEST_ROLE_NAME);
      expect(body.data.displayName).toBe(`Test Role ${SUFFIX}`);
      expect(body.data.hierarchyLevel).toBe(1);
      expect(body.data.color).toBe('#22c55e');
    });

    it('returns 409 when creating a duplicate role name', async () => {
      const res = await authPost(app, '/api/roles', adminToken, {
        name: TEST_ROLE_NAME,
        displayName: 'Duplicate Role',
        hierarchyLevel: 1,
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toBeTruthy();
    });

    it('returns 400 for invalid input (missing required fields)', async () => {
      const res = await authPost(app, '/api/roles', adminToken, {
        name: 'x', // Too short and lowercase
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/roles/:name — Update role', () => {
    it('updates the displayName of the test role', async () => {
      const newDisplayName = `Updated Role ${SUFFIX}`;
      const res = await authPut(app, `/api/roles/${TEST_ROLE_NAME}`, adminToken, {
        displayName: newDisplayName,
        description: 'Updated by e2e test',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(body.data.displayName).toBe(newDisplayName);
    });

    // P4-10 (2026-10-21): changing what a role may do needs a reason, which is
    // recorded on the ROLE_UPDATED audit row. Cosmetic edits (above) need none.
    it('refuses a permission change without a reason (400 REASON_REQUIRED)', async () => {
      for (const body of [{ permissions: ['AUDIT_READ'] }, { hierarchyLevel: 2 }, { permissions: ['AUDIT_READ'], reason: 'abc' }]) {
        const res = await authPut(app, `/api/roles/${TEST_ROLE_NAME}`, adminToken, body, ADMIN_PASSWORD);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(JSON.parse(res.body).error).toBe('REASON_REQUIRED');
        expect(JSON.parse(res.body).message).toMatch(/reason/i);
      }
    });

    it('updates permissions of the test role', async () => {
      const reason = `e2e permission change ${SUFFIX}`;
      const res = await authPut(app, `/api/roles/${TEST_ROLE_NAME}`, adminToken, {
        permissions: ['AUDIT_READ', 'CONFIG_READ'],
        reason,
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const row = await prisma.auditTrail.findFirst({
        where: { action: 'ROLE_UPDATED', targetId: TEST_ROLE_NAME }, orderBy: { chainPosition: 'desc' },
      });
      expect(row?.reason).toBe(reason);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.permissions).toContain('AUDIT_READ');
      expect(body.data.permissions).toContain('CONFIG_READ');
    });

    it('can update a system role displayName and color (restricted fields)', async () => {
      // Read current SUPERVISOR (a system role) first
      const before = await authGet(app, '/api/roles/SUPERVISOR', adminToken);
      const original = JSON.parse(before.body);

      const res = await authPut(app, '/api/roles/SUPERVISOR', adminToken, {
        displayName: 'Supervisor Updated',
        color: '#ef4444',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.displayName).toBe('Supervisor Updated');

      // Restore original values
      await authPut(app, '/api/roles/SUPERVISOR', adminToken, {
        displayName: original.displayName,
        color: original.color,
      }, ADMIN_PASSWORD);
    });

    it('returns 404 for updating a non-existent role', async () => {
      const res = await authPut(app, '/api/roles/NONEXISTENT_ROLE_XYZ', adminToken, {
        displayName: 'Ghost',
      }, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/roles/:name — Delete role', () => {
    it('returns 409 SYSTEM_ROLE when deleting a system role, even one with users (SUPER_ADMIN)', async () => {
      // C-08 (QA 2026-10-19): the system-role refusal now comes FIRST, so a
      // system role with users is refused as SYSTEM_ROLE, not ROLE_HAS_USERS
      // (which implied it could be deleted once emptied). The ROLE_HAS_USERS path
      // for custom roles is covered in modules/roles/__tests__/role.service.test.ts.
      const res = await authDelete(app, '/api/roles/SUPER_ADMIN', adminToken, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('SYSTEM_ROLE');
    });

    it('deletes the test role successfully', async () => {
      const res = await authDelete(app, `/api/roles/${TEST_ROLE_NAME}`, adminToken, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('returns 404 when deleting an already-deleted role', async () => {
      const res = await authDelete(app, `/api/roles/${TEST_ROLE_NAME}`, adminToken, ADMIN_PASSWORD);

      expect(res.statusCode).toBe(404);
    });
  });
});
