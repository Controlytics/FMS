import { describe, it, expect, beforeAll } from 'vitest';
import { api, getAdminToken, createTestUser, loginTestUser, uid } from './helpers';

describe('CONFIG MODULE', () => {
  let adminToken: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
  });

  // ─── PASSWORD POLICY ────────────────────────────────────────
  describe('GET/PUT /config/password-policy', () => {
    it('should read password policy', async () => {
      const res = await api('GET', '/config/password-policy', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.minLength).toBeDefined();
      expect(typeof res.data.minLength).toBe('number');
    });

    it('should update password policy with valid data', async () => {
      // Read current first
      const current = await api('GET', '/config/password-policy', null, adminToken);

      const res = await api('PUT', '/config/password-policy', {
        ...current.data,
        minLength: 10,
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Verify update
      const verify = await api('GET', '/config/password-policy', null, adminToken);
      expect(verify.data.minLength).toBe(10);

      // Restore
      await api('PUT', '/config/password-policy', current.data, adminToken);
    });

    it('should reject minLength below 8', async () => {
      const res = await api('PUT', '/config/password-policy', {
        minLength: 3,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        minUppercase: 1,
        minLowercase: 1,
        minNumbers: 1,
        minSpecialChars: 1,
        preventReuseCount: 12,
        cannotBeUserId: true,
        cannotContainUserId: true,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject minLength above 32', async () => {
      const res = await api('PUT', '/config/password-policy', {
        minLength: 50,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        minUppercase: 1,
        minLowercase: 1,
        minNumbers: 1,
        minSpecialChars: 1,
        preventReuseCount: 12,
        cannotBeUserId: true,
        cannotContainUserId: true,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject preventReuseCount above 24', async () => {
      const res = await api('PUT', '/config/password-policy', {
        minLength: 8,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        minUppercase: 1,
        minLowercase: 1,
        minNumbers: 1,
        minSpecialChars: 1,
        preventReuseCount: 30,
        cannotBeUserId: true,
        cannotContainUserId: true,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should deny non-admin access', async () => {
      const operator = await createTestUser(adminToken, { role: 'OPERATOR' });
      const loginRes = await loginTestUser(operator.username, operator.password, 'OpConfig@Pass1');
      const opToken = loginRes.data.token;

      const res = await api('GET', '/config/password-policy', null, opToken);
      expect(res.status).toBe(403);
    });
  });

  // ─── LOGIN SECURITY ────────────────────────────────────────
  describe('GET/PUT /config/login-security', () => {
    it('should read login security config', async () => {
      const res = await api('GET', '/config/login-security', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.maxFailedAttempts).toBeDefined();
      expect(res.data.lockoutType).toBeDefined();
    });

    it('should update login security', async () => {
      const current = await api('GET', '/config/login-security', null, adminToken);

      const res = await api('PUT', '/config/login-security', {
        maxFailedAttempts: 5,
        lockoutType: 'TEMPORARY',
        lockoutDurationMinutes: 30,
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Restore
      await api('PUT', '/config/login-security', current.data, adminToken);
    });

    it('should reject maxFailedAttempts below 3', async () => {
      const res = await api('PUT', '/config/login-security', {
        maxFailedAttempts: 1,
        lockoutType: 'TEMPORARY',
        lockoutDurationMinutes: 30,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject maxFailedAttempts above 10', async () => {
      const res = await api('PUT', '/config/login-security', {
        maxFailedAttempts: 20,
        lockoutType: 'TEMPORARY',
        lockoutDurationMinutes: 30,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject invalid lockoutType', async () => {
      const res = await api('PUT', '/config/login-security', {
        maxFailedAttempts: 5,
        lockoutType: 'INVALID',
        lockoutDurationMinutes: 30,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject lockoutDuration below 15', async () => {
      const res = await api('PUT', '/config/login-security', {
        maxFailedAttempts: 5,
        lockoutType: 'TEMPORARY',
        lockoutDurationMinutes: 5,
      }, adminToken);
      expect(res.status).toBe(400);
    });
  });

  // ─── SESSION CONFIG ─────────────────────────────────────────
  describe('GET/PUT /config/session', () => {
    it('should read session config', async () => {
      const res = await api('GET', '/config/session', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.autoLogoutEnabled).toBeDefined();
      expect(res.data.idleTimeoutMinutes).toBeDefined();
    });

    it('should update session config', async () => {
      const current = await api('GET', '/config/session', null, adminToken);

      const res = await api('PUT', '/config/session', {
        autoLogoutEnabled: true,
        idleTimeoutMinutes: 15,
        warningMinutes: 2,
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Restore
      await api('PUT', '/config/session', current.data, adminToken);
    });

    it('should reject idleTimeout below 5', async () => {
      const res = await api('PUT', '/config/session', {
        autoLogoutEnabled: true,
        idleTimeoutMinutes: 2,
        warningMinutes: 1,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject idleTimeout above 60', async () => {
      const res = await api('PUT', '/config/session', {
        autoLogoutEnabled: true,
        idleTimeoutMinutes: 120,
        warningMinutes: 1,
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject warningMinutes above 5', async () => {
      const res = await api('PUT', '/config/session', {
        autoLogoutEnabled: true,
        idleTimeoutMinutes: 15,
        warningMinutes: 10,
      }, adminToken);
      expect(res.status).toBe(400);
    });
  });

  // ─── DATETIME CONFIG ───────────────────────────────────────
  describe('GET/PUT /config/datetime', () => {
    it('should read datetime config', async () => {
      const res = await api('GET', '/config/datetime', null, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.dateFormat).toBeDefined();
      expect(res.data.timeFormat).toBeDefined();
    });

    it('should update datetime config', async () => {
      const current = await api('GET', '/config/datetime', null, adminToken);

      const res = await api('PUT', '/config/datetime', {
        dateFormat: 'YYYY-MM-DD',
        timeFormat: '24-hour',
        timezone: 'UTC',
      }, adminToken);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);

      // Restore
      await api('PUT', '/config/datetime', current.data, adminToken);
    });

    it('should accept all valid date formats', async () => {
      const formats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'MMM DD, YYYY'];
      for (const fmt of formats) {
        const res = await api('PUT', '/config/datetime', {
          dateFormat: fmt,
          timeFormat: '24-hour',
          timezone: 'UTC',
        }, adminToken);
        expect(res.status).toBe(200);
      }
      // Restore default
      await api('PUT', '/config/datetime', {
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '24-hour',
        timezone: 'UTC',
      }, adminToken);
    });

    it('should reject invalid date format', async () => {
      const res = await api('PUT', '/config/datetime', {
        dateFormat: 'INVALID-FORMAT',
        timeFormat: '24-hour',
        timezone: 'UTC',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('should reject invalid time format', async () => {
      const res = await api('PUT', '/config/datetime', {
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '48-hour',
        timezone: 'UTC',
      }, adminToken);
      expect(res.status).toBe(400);
    });
  });

  // ─── FIELD IDS ──────────────────────────────────────────────
  describe('GET /config/field-ids', () => {
    it('should list all field IDs', async () => {
      const res = await api('GET', '/config/field-ids', null, adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      if (res.data.length > 0) {
        expect(res.data[0].fieldId).toBeDefined();
        expect(res.data[0].defaultName).toBeDefined();
      }
    });

    it('should be accessible by all authenticated users', async () => {
      const viewer = await createTestUser(adminToken, { role: 'VIEWER' });
      const loginRes = await loginTestUser(viewer.username, viewer.password, 'ViewField@Pass1');
      const viewerToken = loginRes.data.token;

      const res = await api('GET', '/config/field-ids', null, viewerToken);
      expect(res.status).toBe(200);
    });
  });
});
