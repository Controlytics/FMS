/**
 * Coverage of the generic dynamic config surface (dynamic-routes.ts), 2026-10-21.
 *
 * The 12 live defs served by `/api/config/dynamic/:key` are all
 * `requiredRole: 'SUPER_ADMIN'` with an explicit `reauthAction` and no Zod
 * schema, hooks or masked secrets, so most of the route's contract — the
 * permission-gated variant, secret masking + preservation, Zod and hook
 * validation, `onRead` / `afterUpdate`, and the derived re-auth action name —
 * is only reachable through a def that declares those things. This file
 * registers two such defs of its own (keys `cvc-probe-*`) BEFORE the routes are
 * built, exactly as `discoverAndRegisterConfigs` registers the real ones, and
 * drives them through the real routes, auth and database.
 *
 * Owns: its users / roles, the two probe config rows, and the re-auth grant for
 * its own role. All removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildApp, authGet, authPut, internalErrors } from '../../../e2e/test-helper.js';
import dynamicConfigRoutes from '../dynamic-routes.js';
import { discoverAndRegisterConfigs } from '../../../lib/config-discovery.js';
import { configRegistry, type ModuleConfigDefinition } from '../../../lib/config-registry.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, runSuffix, createRole, createUser, login, deleteUsers, deleteRoles,
  addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { stored, chainedAuditRow } from './support/config-rows.js';

const SFX = runSuffix();
const PW = 'CvcDynamic@2026';
const SA_USER = `cvcdsa${SFX}`.toLowerCase();
const ADM_USER = `cvcdadm${SFX}`.toLowerCase();
const RO_USER = `cvcdro${SFX}`.toLowerCase();
const ADM_ROLE = `CVC_DADM_${SFX}`;
const RO_ROLE = `CVC_DRO_${SFX}`;
const PROBE_KEY = `cvc-probe-${SFX.toLowerCase()}`;
const PROBE_RA_KEY = `cvc-probe-ra-${SFX.toLowerCase()}`;
const DERIVED_ACTION = `UPDATE_${PROBE_RA_KEY.toUpperCase().replace(/-/g, '_')}`;
const MASK = '••••••••';

const afterUpdateCalls: Array<{ oldValue: unknown; newValue: unknown; userId: string }> = [];

const probe: ModuleConfigDefinition = {
  moduleKey: PROBE_KEY,
  moduleName: 'CVC Probe',
  description: 'Coverage probe def (permission-gated, hooks, masked secret)',
  icon: 'flask',
  category: 'cvc-test',
  sortOrder: 99_999,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: false,
  hasCustomPage: false,
  settings: [
    { key: 'name', type: 'string', label: 'Name', maxLength: 20 },
    { key: 'apiKey', type: 'secret', label: 'API key', maskedInApi: true },
    { key: 'limit', type: 'number', label: 'Limit', min: 1, max: 10 },
  ],
  zodSchema: z.object({ name: z.string().min(2, 'name too short').optional() }).passthrough(),
  hooks: {
    validate: async (v: any) => {
      if (v.name === 'no-errors') return { valid: false };
      if (v.name === 'hook-says-no') return { valid: false, errors: ['custom says no', 'twice'] };
      return { valid: true };
    },
    onRead: (v: any) => ({ ...v, readHook: true }),
    afterUpdate: async (oldValue, newValue, ctx) => { afterUpdateCalls.push({ oldValue, newValue, userId: ctx.userId }); },
  },
};

const probeRa: ModuleConfigDefinition = {
  moduleKey: PROBE_RA_KEY,
  moduleName: 'CVC Probe RA',
  description: 'Coverage probe def (requiresReauth, no reauthAction)',
  icon: 'flask',
  category: 'cvc-test',
  sortOrder: 99_998,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: true,
  hasCustomPage: false,
  settings: [{ key: 'flag', type: 'boolean', label: 'Flag' }],
};

let app: FastifyInstance;
let saToken = '';
let admToken = '';
let roToken = '';
const userIds: string[] = [];
let reauthAdded: ReauthGrant = [];

beforeAll(async () => {
  await createRole(ADM_ROLE, ['CONFIG_READ', 'CONFIG_UPDATE']);
  await createRole(RO_ROLE, []);
  userIds.push(await createUser(SA_USER, 'SUPER_ADMIN', PW));
  userIds.push(await createUser(ADM_USER, ADM_ROLE, PW));
  userIds.push(await createUser(RO_USER, RO_ROLE, PW));
  await discoverAndRegisterConfigs();
  configRegistry.register(probe);
  configRegistry.register(probeRa);
  app = await buildApp([{ plugin: dynamicConfigRoutes, prefix: '/api/config' }]);
  saToken = await login(app, SA_USER, PW);
  admToken = await login(app, ADM_USER, PW);
  roToken = await login(app, RO_USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['re-auth grants', () => removeReauth(reauthAdded)],
    ['probe rows', () => prisma.systemConfig.deleteMany({ where: { configKey: { in: [PROBE_KEY, PROBE_RA_KEY] } } })],
    ['registry', async () => {
      // The registry is a per-process singleton; take the probes back out.
      const defs = (configRegistry as unknown as { definitions: Map<string, unknown> }).definitions;
      defs.delete(PROBE_KEY);
      defs.delete(PROBE_RA_KEY);
    }],
    ['app', async () => app?.close()],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([ADM_ROLE, RO_ROLE])],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('GET /api/config/registry/manifest', () => {
  it('SUPER_ADMIN sees every registered def, without Zod schemas or hooks', async () => {
    const res = await authGet(app, '/api/config/registry/manifest', saToken);
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<Record<string, unknown>>;
    expect(list.map((e) => e.moduleKey)).toEqual(configRegistry.getAll().map((d) => d.moduleKey));
    const entry = list.find((e) => e.moduleKey === PROBE_KEY)!;
    expect(entry).toMatchObject({
      moduleName: 'CVC Probe', requiredRole: null, requiresReauth: false, reauthAction: null,
      hasCustomPage: false, customPagePath: null, category: 'cvc-test',
    });
    expect(entry).not.toHaveProperty('zodSchema');
    expect(entry).not.toHaveProperty('hooks');
  });

  it('another role sees only defs it may read and that are not reserved to a different role', async () => {
    const res = await authGet(app, '/api/config/registry/manifest', admToken);
    expect(res.statusCode).toBe(200);
    const keys = (res.json() as Array<{ moduleKey: string }>).map((e) => e.moduleKey);
    const expected = configRegistry.getAll()
      .filter((d) => (!d.requiredRole || d.requiredRole === ADM_ROLE) && ['CONFIG_READ', 'CONFIG_UPDATE'].includes(d.permissions.read))
      .map((d) => d.moduleKey);
    expect(keys).toEqual(expected);
    expect(keys).toContain(PROBE_KEY);
    expect(keys).not.toContain('stage-interlock'); // SUPER_ADMIN-only def
  });

  it('a user whose role row does not exist sees nothing (fail-closed)', async () => {
    const ghostRole = `CVC_DGH_${SFX}`;
    const ghostUser = `cvcdgh${SFX}`.toLowerCase();
    const id = await createUser(ghostUser, ghostRole, PW);
    userIds.push(id);
    const token = await login(app, ghostUser, PW);
    const res = await authGet(app, '/api/config/registry/manifest', token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('a role with no permissions sees nothing', async () => {
    const res = await authGet(app, '/api/config/registry/manifest', roToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('dynamic GET/PUT gating', () => {
  it('a permission-gated def needs its read permission', async () => {
    const res = await authGet(app, `/api/config/dynamic/${PROBE_KEY}`, roToken);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('a SUPER_ADMIN-only def refuses a role that holds the permissions', async () => {
    expect((await authGet(app, '/api/config/dynamic/stage-interlock', admToken)).statusCode).toBe(403);
    expect((await authPut(app, '/api/config/dynamic/stage-interlock', admToken, {}, PW)).statusCode).toBe(403);
  });

  it('a permission-gated PUT needs the write permission', async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, roToken, { name: 'nope' }, PW);
    expect(res.statusCode).toBe(403);
    expect(await stored(PROBE_KEY)).toBeNull();
  });

  it('GET with nothing stored returns {} passed through the onRead hook', async () => {
    const res = await authGet(app, `/api/config/dynamic/${PROBE_KEY}`, admToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ readHook: true });
  });
});

describe('dynamic PUT validation (nothing stored on refusal)', () => {
  it('declared-setting violations are refused with every message', async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken, { limit: 50, name: 'x'.repeat(21) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(res.json().message).toBe('Name must be at most 20 characters, Limit must be at most 10');
    expect(await stored(PROBE_KEY)).toBeNull();
    expect(internalErrors).toEqual([]);
  });

  it("the def's Zod schema is enforced", async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken, { name: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'VALIDATION_ERROR', message: 'name too short' });
    expect(await stored(PROBE_KEY)).toBeNull();
  });

  it("the def's validate hook can refuse, with its own errors or a generic message", async () => {
    const withErrors = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken, { name: 'hook-says-no' });
    expect(withErrors.statusCode).toBe(400);
    expect(withErrors.json()).toEqual({ error: 'VALIDATION_ERROR', message: 'custom says no, twice' });
    const bare = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken, { name: 'no-errors' });
    expect(bare.statusCode).toBe(400);
    expect(bare.json()).toEqual({ error: 'VALIDATION_ERROR', message: 'Validation failed' });
    expect(await stored(PROBE_KEY)).toBeNull();
    expect(afterUpdateCalls).toEqual([]);
  });
});

describe('dynamic PUT write path', () => {
  it('stores the body minus transport fields, audits it with secrets removed, and runs afterUpdate', async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken,
      { name: 'first', apiKey: 's3cret-1', limit: 3, _currentPassword: PW, _clientOpId: 'op-9' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, message: 'CVC Probe updated' });

    const row = await prisma.systemConfig.findUnique({ where: { configKey: PROBE_KEY } });
    expect(row!.configValue).toEqual({ name: 'first', apiKey: 's3cret-1', limit: 3 });
    expect(row!.configType).toBe('cvc-test');
    expect(row!.requiresReauth).toBe(false);
    expect(row!.updatedBy).toBe(ADM_USER);

    const audit = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: PROBE_KEY });
    expect(audit.userId).toBe(ADM_USER);
    expect(audit.targetType).toBe('config');
    expect(audit.signatureMeaning).toBe('CVC Probe configuration updated');
    expect(audit.beforeValue).toEqual({});
    expect(audit.afterValue).toEqual({ name: 'first', limit: 3 });
    const auditText = JSON.stringify({ before: audit.beforeValue, after: audit.afterValue, reason: audit.reason });
    expect(auditText).not.toContain('s3cret-1');
    expect(auditText).not.toContain(PW);

    expect(afterUpdateCalls.at(-1)).toEqual({ oldValue: {}, newValue: { name: 'first', apiKey: 's3cret-1', limit: 3 }, userId: ADM_USER });
  });

  it('GET masks the stored secret and still applies onRead', async () => {
    const res = await authGet(app, `/api/config/dynamic/${PROBE_KEY}`, admToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'first', apiKey: MASK, limit: 3, readHook: true });
  });

  it('sending the mask back keeps the stored secret; the audit shows the old value without it', async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken, { name: 'second', apiKey: MASK, limit: 4 });
    expect(res.statusCode).toBe(200);
    expect(await stored(PROBE_KEY)).toEqual({ name: 'second', apiKey: 's3cret-1', limit: 4 });
    const audit = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: PROBE_KEY });
    expect(audit.beforeValue).toEqual({ name: 'first', limit: 3 });
    expect(audit.afterValue).toEqual({ name: 'second', limit: 4 });
  });

  it('a new secret replaces the old one', async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_KEY}`, admToken, { name: 'third', apiKey: 's3cret-2' });
    expect(res.statusCode).toBe(200);
    expect(await stored(PROBE_KEY)).toEqual({ name: 'third', apiKey: 's3cret-2' });
  });

  it('a PUT with no body at all stores {} (the route replaces, it does not merge)', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/config/dynamic/${PROBE_KEY}`, headers: { authorization: `Bearer ${admToken}` } });
    expect(res.statusCode).toBe(200);
    expect(await stored(PROBE_KEY)).toEqual({});
    expect((await authGet(app, `/api/config/dynamic/${PROBE_KEY}`, admToken)).json()).toEqual({ readHook: true });
  });
});

describe('dynamic PUT re-auth for a def with requiresReauth but no reauthAction', () => {
  it('derives UPDATE_<KEY>: a role the policy does not name saves without a password', async () => {
    const res = await authPut(app, `/api/config/dynamic/${PROBE_RA_KEY}`, admToken, { flag: true });
    expect(res.statusCode).toBe(200);
    const row = await prisma.systemConfig.findUnique({ where: { configKey: PROBE_RA_KEY } });
    expect(row!.configValue).toEqual({ flag: true });
    expect(row!.requiresReauth).toBe(true);
  });

  describe('once the policy names the role for the derived action', () => {
    beforeAll(async () => { reauthAdded = await addReauth([[DERIVED_ACTION, ADM_ROLE]]); }, 60_000);
    afterAll(async () => { await removeReauth(reauthAdded); reauthAdded = []; }, 60_000);

    it('401 REAUTH_REQUIRED (naming the derived action) without a password, and nothing stored', async () => {
      const res = await authPut(app, `/api/config/dynamic/${PROBE_RA_KEY}`, admToken, { flag: false });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: DERIVED_ACTION });
      expect(await stored(PROBE_RA_KEY)).toEqual({ flag: true });
      expect(internalErrors).toEqual([]);
    });

    it('401 REAUTH_FAILED on a wrong password, audited as a failed signature, nothing stored', async () => {
      const res = await authPut(app, `/api/config/dynamic/${PROBE_RA_KEY}`, admToken, { flag: false }, 'Wrong@Pass1');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('REAUTH_FAILED');
      expect(await stored(PROBE_RA_KEY)).toEqual({ flag: true });
      const failed = await chainedAuditRow({ action: 'REAUTH_FAILED', userId: ADM_USER });
      expect(failed.afterValue).toMatchObject({ reauthAction: DERIVED_ACTION, accountLocked: false });
      // A failed signature counts toward lockout; clear it so later tests are unaffected.
      await prisma.user.update({ where: { username: ADM_USER }, data: { failedLoginAttempts: 0 } });
    });

    it('with the password the save is signed: the change row points at the REAUTH_SUCCESS row', async () => {
      const res = await authPut(app, `/api/config/dynamic/${PROBE_RA_KEY}`, admToken, { flag: false }, PW);
      expect(res.statusCode).toBe(200);
      expect(await stored(PROBE_RA_KEY)).toEqual({ flag: false });
      const sig = await chainedAuditRow({ action: 'REAUTH_SUCCESS', userId: ADM_USER });
      expect(sig.afterValue).toMatchObject({ reauthAction: DERIVED_ACTION });
      const change = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: PROBE_RA_KEY });
      expect(change.signatureAuditId).toBe(sig.id);
      expect(change.beforeValue).toEqual({ flag: true });
      expect(change.afterValue).toEqual({ flag: false });
    });
  });

  it('a SUPER_ADMIN reads the masked-free RA probe through the SA bypass', async () => {
    const res = await authGet(app, `/api/config/dynamic/${PROBE_RA_KEY}`, saToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ flag: false });
  });
});
