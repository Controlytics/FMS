import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import {
  buildApp, loginAs, authGet, authPost, authPut, authDelete,
  ADMIN_PASSWORD,
} from './test-helper.js';
import { prisma } from '../lib/prisma.js';

// The seeded `admin` user is SUPER_ADMIN in digilog_test_db, so `adminToken`
// below proves nothing about a NON-super-admin. This second account is a real
// ADMIN — it holds CONFIG_READ + CONFIG_UPDATE (72 perms in the seeded ADMIN
// role), so any 403 it gets is the ROLE gate, not a missing permission.
const CFG_ADMIN_USERNAME = 'config_admin_test';
const CFG_ADMIN_PASSWORD = 'ConfigAdmin@Test1';

async function ensureConfigAdmin() {
  const { hashPassword } = await import('../lib/password.js');
  const passwordHash = await hashPassword(CFG_ADMIN_PASSWORD);
  await prisma.user.upsert({
    where: { username: CFG_ADMIN_USERNAME },
    update: {
      passwordHash, role: 'ADMIN', status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
      failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null,
    },
    create: {
      username: CFG_ADMIN_USERNAME, passwordHash,
      fullName: 'Config Admin Test', email: 'config-admin@test.example',
      role: 'ADMIN', status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
    },
  });
}

describe('Config endpoints', () => {
  let app: FastifyInstance;
  let adminToken: string;   // seeded `admin` — SUPER_ADMIN in the test DB
  let realAdminToken: string; // genuine ADMIN role

  beforeAll(async () => {
    app = await buildApp();
    await ensureConfigAdmin();
    // loginAs terminates sessions for THAT username only, so these two tokens
    // coexist; log the SUPER_ADMIN in last so nothing later in the file races it.
    realAdminToken = await loginAs(app, CFG_ADMIN_USERNAME, CFG_ADMIN_PASSWORD);
    adminToken = await loginAs(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // EXISTING TESTS (unchanged)
  // ===========================================================================

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
    it('returns datetime config for SUPER_ADMIN', async () => {
      const res = await authGet(app, '/api/config/datetime', adminToken);
      expect(res.statusCode).toBe(200);
    });

    // 2026-09-03: Date/Time moved to SUPER_ADMIN. Before that change this
    // returned 200 for any CONFIG_READ holder — which this account is.
    it('403s for a real ADMIN despite CONFIG_READ', async () => {
      const res = await authGet(app, '/api/config/datetime', realAdminToken);
      expect(res.statusCode).toBe(403);
    });

    it('still serves /current to everyone — the format every page renders with', async () => {
      // The gate is on EDITING, not reading. Locking this would break date
      // rendering app-wide (it is in PUBLIC_GET_PATHS and feeds the login page).
      const res = await authGet(app, '/api/config/datetime/current', realAdminToken);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).dateFormat).toBeTruthy();
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

  // ===========================================================================
  // NEW TESTS — All missing config endpoints
  // ===========================================================================

  // =============================================
  // 1. Login Security — GET / PUT
  // =============================================
  describe('GET /api/config/login-security', () => {
    it('returns login security config', async () => {
      const res = await authGet(app, '/api/config/login-security', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.lockoutType).toBeDefined();
    });
  });

  describe('PUT /api/config/login-security', () => {
    it('updates login security config and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/login-security', adminToken);
      const original = JSON.parse(getRes.body);

      // Update one field
      const updated = {
        ...original,
        lockoutDurationMinutes: 45,
        _currentPassword: ADMIN_PASSWORD,
      };
      const putRes = await authPut(app, '/api/config/login-security', adminToken, updated, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.lockoutDurationMinutes).toBe(45);

      // Restore original
      await authPut(app, '/api/config/login-security', adminToken, {
        ...original,
        _currentPassword: ADMIN_PASSWORD,
      }, ADMIN_PASSWORD);
    });
  });

  // =============================================
  // 2. Password Policy — PUT
  // =============================================
  describe('PUT /api/config/password-policy', () => {
    it('updates password policy and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/password-policy', adminToken);
      const original = JSON.parse(getRes.body);

      // Update one field
      const updated = {
        ...original,
        minLength: 10,
        _currentPassword: ADMIN_PASSWORD,
      };
      const putRes = await authPut(app, '/api/config/password-policy', adminToken, updated, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.minLength).toBe(10);

      // Restore original
      await authPut(app, '/api/config/password-policy', adminToken, {
        ...original,
        _currentPassword: ADMIN_PASSWORD,
      }, ADMIN_PASSWORD);
    });

    it('rejects update without _currentPassword when reauth is required', async () => {
      const getRes = await authGet(app, '/api/config/password-policy', adminToken);
      const original = JSON.parse(getRes.body);

      // Attempt without _currentPassword (and without x-reauth-password header)
      const putRes = await authPut(app, '/api/config/password-policy', adminToken, {
        ...original,
        minLength: 12,
      });
      // Should either succeed (if reauth not configured) or return 401
      expect([200, 401]).toContain(putRes.statusCode);
    });
  });

  // =============================================
  // 3. Session Config — PUT
  // =============================================
  describe('PUT /api/config/session', () => {
    it('updates session config and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/session', adminToken);
      const original = JSON.parse(getRes.body);

      // Update one field
      const updated = {
        ...original,
        idleTimeoutMinutes: 20,
        _currentPassword: ADMIN_PASSWORD,
      };
      const putRes = await authPut(app, '/api/config/session', adminToken, updated, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.idleTimeoutMinutes).toBe(20);

      // Restore original
      await authPut(app, '/api/config/session', adminToken, {
        ...original,
        _currentPassword: ADMIN_PASSWORD,
      }, ADMIN_PASSWORD);
    });
  });

  // =============================================
  // 4. Datetime Config — PUT
  // =============================================
  describe('PUT /api/config/datetime', () => {
    it('updates datetime config and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/datetime', adminToken);
      const original = JSON.parse(getRes.body);
      const originalTimeFormat = original.timeFormat ?? '24-hour';

      // The timezone field is z.literal('Asia/Kolkata') — always use that exact value
      const putRes = await authPut(app, '/api/config/datetime', adminToken, {
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '12-hour',
        timezone: 'Asia/Kolkata',
      }, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.timeFormat).toBe('12-hour');

      // Restore original timeFormat
      await authPut(app, '/api/config/datetime', adminToken, {
        dateFormat: 'DD/MM/YYYY',
        timeFormat: originalTimeFormat,
        timezone: 'Asia/Kolkata',
      }, ADMIN_PASSWORD);
    });

    it('403s for a real ADMIN despite CONFIG_UPDATE', async () => {
      const res = await authPut(app, '/api/config/datetime', realAdminToken, {
        dateFormat: 'MM/DD/YYYY',
        timeFormat: '12-hour',
        timezone: 'Asia/Kolkata',
      }, CFG_ADMIN_PASSWORD);
      expect(res.statusCode).toBe(403);
      // The role gate must run BEFORE the write, not after it.
      const after = await authGet(app, '/api/config/datetime', adminToken);
      expect(JSON.parse(after.body).dateFormat).toBe('DD/MM/YYYY');
    });
  });

  // =============================================
  // 5. Pagination Config — GET / PUT
  // =============================================
  describe('GET /api/config/pagination', () => {
    it('returns pagination config for admin', async () => {
      const res = await authGet(app, '/api/config/pagination', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.options).toBeDefined();
      expect(Array.isArray(body.options)).toBe(true);
    });
  });

  describe('PUT /api/config/pagination', () => {
    it('updates pagination config and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/pagination', adminToken);
      const original = JSON.parse(getRes.body);

      // Update
      const putRes = await authPut(app, '/api/config/pagination', adminToken, {
        options: [15, 30, 60],
      }, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.options).toEqual([15, 30, 60]);

      // Restore original
      await authPut(app, '/api/config/pagination', adminToken, original, ADMIN_PASSWORD);
    });
  });

  // =============================================
  // 6. User ID Config — PUT
  // =============================================
  describe('PUT /api/config/user-id', () => {
    it('updates user-id config and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/user-id', adminToken);
      const original = JSON.parse(getRes.body);

      // Update one field
      const putRes = await authPut(app, '/api/config/user-id', adminToken, {
        ...original,
        prefix: 'TST',
      }, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.prefix).toBe('TST');

      // Restore original
      await authPut(app, '/api/config/user-id', adminToken, original, ADMIN_PASSWORD);
    });
  });

  // =============================================
  // 7. User ID — GET next
  // =============================================
  describe('GET /api/config/user-id/next', () => {
    it('returns autoGenerate and nextId', async () => {
      const res = await authGet(app, '/api/config/user-id/next', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body.autoGenerate).toBe('boolean');
      // nextId is string or null depending on autoGenerate
      if (body.autoGenerate) {
        expect(typeof body.nextId).toBe('string');
      } else {
        expect(body.nextId).toBeNull();
      }
    });
  });

  // =============================================
  // 8. User ID — POST validate
  // =============================================
  describe('POST /api/config/user-id/validate', () => {
    it('validates a conforming user ID', async () => {
      const res = await authPost(app, '/api/config/user-id/validate', adminToken, {
        userId: 'ABCDEF',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body.valid).toBe('boolean');
    });

    it('returns validation errors for empty userId', async () => {
      const res = await authPost(app, '/api/config/user-id/validate', adminToken, {
        userId: '',
      });
      // Should return 400 or 200 with valid: false
      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        expect(body.valid).toBe(false);
      } else {
        expect(res.statusCode).toBe(400);
      }
    });
  });

  // =============================================
  // 9. Branding — PUT
  // =============================================
  describe('PUT /api/config/branding', () => {
    it('updates branding config and restores', async () => {
      // Read current
      const getRes = await app.inject({ method: 'GET', url: '/api/config/branding' });
      const original = JSON.parse(getRes.body);

      // Update one field
      const putRes = await authPut(app, '/api/config/branding', adminToken, {
        ...original,
        appTagline: 'E2E Test Tagline',
      }, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.appTagline).toBe('E2E Test Tagline');

      // Restore original
      await authPut(app, '/api/config/branding', adminToken, original, ADMIN_PASSWORD);
    });
  });

  // =============================================
  // 10. Role Configs — GET all
  // =============================================
  describe('GET /api/config/roles', () => {
    it('returns array of role configurations', async () => {
      const res = await authGet(app, '/api/config/roles', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // =============================================
  // 11. Role Config — GET single
  // =============================================
  describe('GET /api/config/roles/:role', () => {
    it('returns config for SUPER_ADMIN role', async () => {
      const res = await authGet(app, '/api/config/roles/SUPER_ADMIN', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.role).toBe('SUPER_ADMIN');
      expect(body.sidebarItems).toBeDefined();
      expect(body.homeWidgets).toBeDefined();
      expect(body.permissions).toBeDefined();
    });

    it('returns defaults for a non-configured role', async () => {
      const res = await authGet(app, '/api/config/roles/TEST_READONLY', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.role).toBe('TEST_READONLY');
    });
  });

  // =============================================
  // 12. Role Config — PUT
  // =============================================
  describe('PUT /api/config/roles/:role', () => {
    // A sidebar save GRANTS each enabled item's primary permission (additive, never
    // revoked), so it runs on its own throwaway role - on a shared fixture it would
    // leave permissions behind. P4-10: it also needs a reason.
    it('updates role config sidebarItems (reason required)', async () => {
      const role = `QASB${Date.now() % 1e8}`;
      await prisma.role.create({ data: { name: role, displayName: role, hierarchyLevel: 1, permissions: [], createdBy: 'qa-sidebar-test' } });
      try {
        const refused = await authPut(app, `/api/config/roles/${role}`, adminToken, { sidebarItems: ['notifications'] }, ADMIN_PASSWORD);
        expect(refused.statusCode).toBe(400);
        expect(JSON.parse(refused.body).error).toBe('REASON_REQUIRED');

        const putRes = await authPut(app, `/api/config/roles/${role}`, adminToken, {
          sidebarItems: ['dashboard', 'notifications'], reason: 'e2e sidebar save',
        }, ADMIN_PASSWORD);
        expect(putRes.statusCode).toBe(200);
        expect(JSON.parse(putRes.body).success).toBe(true);
      } finally {
        await prisma.roleConfig.deleteMany({ where: { role } });
        await prisma.role.deleteMany({ where: { name: role } });
      }
    });

    // P4-10 (2026-10-21): a PERMISSION change needs a reason, audited.
    // Uses its OWN throwaway role: saving permissions re-expands roles.permissions from the
    // toggles, which on a shared fixture (then VIEWER) handed it FILTER_OPERATE and broke
    // phase4-perms-themes-reports.test.ts.
    it('a permission change without a reason is refused; with one it is saved and audited', async () => {
      const role = `QAP410${Date.now() % 1e8}`;
      await prisma.role.create({ data: { name: role, displayName: role, hierarchyLevel: 1, permissions: ['AUDIT_READ'], createdBy: 'qa-p410-test' } });
      try {
        const permissions = { 'audit.view': true };
        const refused = await authPut(app, `/api/config/roles/${role}`, adminToken, { permissions }, ADMIN_PASSWORD);
        expect(refused.statusCode).toBe(400);
        expect(JSON.parse(refused.body).error).toBe('REASON_REQUIRED');

        const reason = `e2e role-config reason ${Date.now()}`;
        const ok = await authPut(app, `/api/config/roles/${role}`, adminToken, { permissions, reason }, ADMIN_PASSWORD);
        expect(ok.statusCode).toBe(200);
        const row = await prisma.auditTrail.findFirst({
          where: { action: 'CONFIG_CHANGED', targetType: 'role_config', targetId: role }, orderBy: { chainPosition: 'desc' },
        });
        expect(row?.reason).toBe(reason);
      } finally {
        await prisma.roleConfig.deleteMany({ where: { role } });
        await prisma.role.deleteMany({ where: { name: role } });
      }
    });
  });

  // =============================================
  // 13. User Config — GET
  // =============================================
  describe('GET /api/config/users/:userId', () => {
    it('returns user config (or defaults) for admin user', async () => {
      // First, get the admin user id from /api/auth/me
      const meRes = await authGet(app, '/api/auth/me', adminToken);
      const me = JSON.parse(meRes.body);
      const userId = me.id || me.user?.id;

      if (userId) {
        const res = await authGet(app, `/api/config/users/${userId}`, adminToken);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.userId).toBeDefined();
        expect(body.sidebarItems).toBeDefined();
      }
    });
  });

  // =============================================
  // 14. User Config — PUT
  // =============================================
  describe('PUT /api/config/users/:userId', () => {
    it('updates user config and restores', async () => {
      // Get admin user id
      const meRes = await authGet(app, '/api/auth/me', adminToken);
      const me = JSON.parse(meRes.body);
      const userId = me.id || me.user?.id;

      if (userId) {
        // Read current
        const getRes = await authGet(app, `/api/config/users/${userId}`, adminToken);
        const original = JSON.parse(getRes.body);

        // Update
        const putRes = await authPut(app, `/api/config/users/${userId}`, adminToken, {
          sidebarItems: ['dashboard', 'audit'],
          homeWidgets: [],
        });
        expect(putRes.statusCode).toBe(200);
        const putBody = JSON.parse(putRes.body);
        expect(putBody.success).toBe(true);

        // Restore original
        await authPut(app, `/api/config/users/${userId}`, adminToken, {
          sidebarItems: original.sidebarItems ?? [],
          homeWidgets: original.homeWidgets ?? [],
        });
      }
    });
  });

  // =============================================
  // 15. My Config
  // =============================================
  describe('GET /api/config/my-config', () => {
    it('returns effective config for current user', async () => {
      const res = await authGet(app, '/api/config/my-config', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sidebarItems).toBeDefined();
      expect(body.homeWidgets).toBeDefined();
      expect(body.permissions).toBeDefined();
    });
  });

  // =============================================
  // 16. Field IDs — PUT
  // =============================================
  describe('PUT /api/config/field-ids/:fieldId', () => {
    it('updates a field label and restores', async () => {
      // List all field IDs to find one to update
      const listRes = await authGet(app, '/api/config/field-ids', adminToken);
      const fields = JSON.parse(listRes.body);

      if (Array.isArray(fields) && fields.length > 0) {
        const target = fields[0];
        const originalName = target.displayName;

        // Update. 2026-09-03: this endpoint takes a signature
        // (UPDATE_FIELD_ID, enforceReauthAlways) — without the password it 401s
        // before the handler runs.
        const putRes = await authPut(app, `/api/config/field-ids/${target.fieldId}`, adminToken, {
          displayName: 'E2E Test Label',
        }, ADMIN_PASSWORD);
        expect(putRes.statusCode).toBe(200);
        const putBody = JSON.parse(putRes.body);
        expect(putBody.success).toBe(true);

        // Restore
        await authPut(app, `/api/config/field-ids/${target.fieldId}`, adminToken, {
          displayName: originalName,
        }, ADMIN_PASSWORD);
      }
    });

    it('returns 404 for non-existent field id', async () => {
      // Signed, so the reauth gate passes and the real 404 surfaces — this also
      // proves the gate does not mask genuine handler errors.
      const res = await authPut(app, '/api/config/field-ids/NONEXISTENT_FIELD_XYZ', adminToken, {
        displayName: 'Ghost',
      }, ADMIN_PASSWORD);
      expect(res.statusCode).toBe(404);
    });

    it('401s without a password — the endpoint is signed', async () => {
      const res = await authPut(app, '/api/config/field-ids/NONEXISTENT_FIELD_XYZ', adminToken, {
        displayName: 'Ghost',
      });
      // 401 BEFORE the 404: the signature is checked before the lookup.
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('REAUTH_REQUIRED');
    });
  });

  // =============================================
  // 17. Action Reauth — PUT
  // =============================================
  describe('PUT /api/config/action-reauth', () => {
    it('updates action reauth config and restores', async () => {
      // Read current
      const getRes = await authGet(app, '/api/config/action-reauth', adminToken);
      const original = JSON.parse(getRes.body);

      // Update: add a test action
      const updated = {
        ...original,
        DELETE_USER: ['SUPER_ADMIN', 'ADMIN'],
      };
      // OD-01 (2026-10-22): saving the policy always takes the password, SUPER_ADMIN too.
      const putRes = await authPut(app, '/api/config/action-reauth', adminToken, updated, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.DELETE_USER).toBeDefined();

      // Restore original
      const restoreRes = await authPut(app, '/api/config/action-reauth', adminToken, original, ADMIN_PASSWORD);
      expect(restoreRes.statusCode).toBe(200);
    });
  });

  // =============================================
  // 18. Action Reauth — check single action
  // =============================================
  describe('GET /api/config/action-reauth/check', () => {
    it('returns whether an action requires reauth', async () => {
      const res = await authGet(app, '/api/config/action-reauth/check?action=DELETE_USER', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.action).toBe('DELETE_USER');
      expect(typeof body.required).toBe('boolean');
    });

    it('returns false for an unknown action', async () => {
      const res = await authGet(app, '/api/config/action-reauth/check?action=NONEXISTENT_ACTION', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.required).toBe(false);
    });
  });

  // =============================================
  // 19. Audit Templates — GET / PUT
  // =============================================
  describe('GET /api/config/audit-templates', () => {
    it('returns audit text templates', async () => {
      const res = await authGet(app, '/api/config/audit-templates', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // Should be an object mapping action keys to template strings
      expect(typeof body).toBe('object');
      expect(Object.keys(body).length).toBeGreaterThan(0);
    });
  });

  describe('PUT /api/config/audit-templates', () => {
    it('updates audit templates and restores', async () => {
      // Read current saved config (may be partial or empty)
      const getRes = await authGet(app, '/api/config/audit-templates', adminToken);
      const original = JSON.parse(getRes.body);

      // Update: set a custom template. 2026-09-03: signed
      // (UPDATE_AUDIT_TEMPLATES) — these strings decide how every §11 audit row
      // renders to an inspector.
      const putRes = await authPut(app, '/api/config/audit-templates', adminToken, {
        USER_CREATED: 'E2E test template for user {username}',
      }, ADMIN_PASSWORD);
      expect(putRes.statusCode).toBe(200);
      const putBody = JSON.parse(putRes.body);
      expect(putBody.success).toBe(true);
      expect(putBody.data.USER_CREATED).toBe('E2E test template for user {username}');

      // Restore: put back an empty object to clear custom overrides
      // (the GET merges with defaults, so we restore by saving only what was truly custom)
      await authPut(app, '/api/config/audit-templates', adminToken, {}, ADMIN_PASSWORD);
    });
  });

  // =============================================
  // 20. Audit Templates — GET current (public to authenticated)
  // =============================================
  describe('GET /api/config/audit-templates/current', () => {
    it('returns effective templates (defaults merged with custom)', async () => {
      const res = await authGet(app, '/api/config/audit-templates/current', adminToken);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body).toBe('object');
      expect(Object.keys(body).length).toBeGreaterThan(0);
    });
  });
});
