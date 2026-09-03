import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPut, ADMIN_PASSWORD } from './test-helper.js';
import { prisma } from '../lib/prisma.js';

/**
 * Four config writes that were gated on a permission alone and took no
 * electronic signature (2026-09-03). Each decides something an operator should
 * not be able to change unsigned:
 *
 *   tablet-access       which roles may log in on the tablet at all
 *   audit-templates     how every 21 CFR §11 audit row renders to an inspector
 *   report-signatories  who is NAMED as signing each report
 *   field-ids           the field labels operators read on every record
 *
 * All four use `enforceReauthAlways`. The config-driven `enforceReauth` could
 * not gate them: the actions are newly registered, so they are absent from
 * `system_config['action-reauth']` and `isReauthRequired` returns false for
 * every role — a gate that reads as present and stops nobody.
 */

interface Target {
  name: string;
  url: string;
  configKey: string;
  /** A payload that is a no-op if it ever DID get through, so a leak is still safe. */
  payload: () => Promise<unknown>;
}

describe('config writes that require a signature', () => {
  let app: FastifyInstance;
  let token: string;
  const saved = new Map<string, unknown>();

  const TARGETS: Target[] = [
    {
      name: 'tablet-access', url: '/api/config/tablet-access', configKey: 'tablet-access',
      payload: async () => (await current('tablet-access')) ?? {},
    },
    {
      name: 'audit-templates', url: '/api/config/audit-templates', configKey: 'audit-templates',
      payload: async () => (await current('audit-templates')) ?? {},
    },
    {
      name: 'report-signatories', url: '/api/config/report-signatories', configKey: 'report-signatories',
      payload: async () => (await current('report-signatories')) ?? {},
    },
  ];

  async function current(key: string) {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: key } });
    return row?.configValue ?? null;
  }

  beforeAll(async () => {
    app = await buildApp();
    token = await loginAs(app);
    for (const t of TARGETS) saved.set(t.configKey, await current(t.configKey));
  });

  afterAll(async () => {
    // Leave no policy behind — these are live security configs.
    for (const [key, value] of saved) {
      if (value === null || value === undefined) continue;
      await prisma.systemConfig.update({ where: { configKey: key }, data: { configValue: value as any } });
    }
    await app.close();
  });

  for (const t of TARGETS) {
    describe(t.name, () => {
      it('401s REAUTH_REQUIRED without a password, and writes nothing', async () => {
        const before = await current(t.configKey);

        const res = await app.inject({
          method: 'PUT', url: t.url,
          headers: { authorization: `Bearer ${token}` },
          payload: (await t.payload()) as any,
        });

        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).error).toBe('REAUTH_REQUIRED');
        // The gate must run BEFORE the write.
        expect(await current(t.configKey)).toEqual(before);
      });

      it('401s REAUTH_FAILED on a wrong password, and still writes nothing', async () => {
        const before = await current(t.configKey);

        const res = await app.inject({
          method: 'PUT', url: t.url,
          headers: { authorization: `Bearer ${token}`, 'x-reauth-password': 'Definitely@Wrong9' },
          payload: (await t.payload()) as any,
        });

        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).error).toBe('REAUTH_FAILED');
        expect(await current(t.configKey)).toEqual(before);
      });

      it('succeeds with the password', async () => {
        const res = await authPut(app, t.url, token, (await t.payload()) as any, ADMIN_PASSWORD);
        expect(res.statusCode).toBe(200);
      });

      it('still serves GET without a password', async () => {
        // Reading the config is not a signed act; only changing it is.
        const res = await authGet(app, t.url, token);
        expect(res.statusCode).toBe(200);
      });
    });
  }

  /**
   * field-ids is the one worth its own block: it takes a `:fieldId` param and
   * the page calls it from TWO places (Save and Reset-to-default), so a gate
   * that only covered one would leave the other dead.
   */
  describe('field-ids/:fieldId', () => {
    let fieldId: string;
    let originalName: string;

    beforeAll(async () => {
      const res = await authGet(app, '/api/config/field-ids', token);
      const list = JSON.parse(res.body);
      const rows = Array.isArray(list) ? list : (list.data ?? []);
      fieldId = rows[0]?.fieldId;
      originalName = rows[0]?.displayName;
    });

    it('has a field to act on (guards against a vacuous suite)', () => {
      // A silent `return` on an empty table would let every assertion below
      // pass without running. digilog_test_db seeds 64 rows; if that ever stops
      // being true this fails loudly instead of going quiet.
      expect(fieldId).toBeTruthy();
      expect(originalName).toBeTruthy();
    });

    it('401s REAUTH_REQUIRED without a password, and does not rename the field', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/config/field-ids/${fieldId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { displayName: 'SHOULD-NOT-STICK' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('REAUTH_REQUIRED');

      const after = JSON.parse((await authGet(app, '/api/config/field-ids', token)).body);
      const rows = Array.isArray(after) ? after : (after.data ?? []);
      expect(rows.find((r: any) => r.fieldId === fieldId)?.displayName).toBe(originalName);
    });

    it('401s REAUTH_FAILED on a wrong password, and does not rename the field', async () => {
      const res = await app.inject({
        method: 'PUT', url: `/api/config/field-ids/${fieldId}`,
        headers: { authorization: `Bearer ${token}`, 'x-reauth-password': 'Definitely@Wrong9' },
        payload: { displayName: 'SHOULD-NOT-STICK' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('REAUTH_FAILED');

      const after = JSON.parse((await authGet(app, '/api/config/field-ids', token)).body);
      const rows = Array.isArray(after) ? after : (after.data ?? []);
      expect(rows.find((r: any) => r.fieldId === fieldId)?.displayName).toBe(originalName);
    });

    it('succeeds with the password and restores', async () => {
      const res = await authPut(
        app, `/api/config/field-ids/${fieldId}`, token,
        { displayName: originalName }, ADMIN_PASSWORD,
      );
      expect(res.statusCode).toBe(200);
    });
  });
});
