/**
 * D03-15 (team decision 2026-10-22): three configuration pages are SUPER_ADMIN
 * only, on the API as well as in the UI — aligned to what the config index has
 * always shown (all three sit in "Super Admin Settings", which no role can be
 * granted). Same call as Date/Time (2026-09-03) and Filter Data Management
 * (2026-08-27).
 *
 *  - Tablet App Access decides which roles may sign in on a tablet at all.
 *    A CONFIG_UPDATE holder (ADMIN) could open it by URL and save it.
 *  - LDAP: the group -> role mapping lets whoever edits it map their own
 *    directory group into any role, SUPER_ADMIN included. Read AND write.
 *  - AHU completion process (dynamic def, requiredRole SUPER_ADMIN): already
 *    refused on the API; locked here so the three stay in step.
 *
 * The tablet's own feature read (/tablet-access/my-features) stays open to
 * every signed-in user: the tablet decides its home screen from it.
 *
 * Own role + users; no stored config row is changed (every refused write is
 * checked to have written nothing).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authGet, authPut, authPost } from './test-helper.js';
import ldapRoutes from '../modules/ldap/routes.js';
import dynamicConfigRoutes from '../modules/config/dynamic-routes.js';
import { discoverAndRegisterConfigs } from '../lib/config-discovery.js';
import { prisma } from '../lib/prisma.js';
import { cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix } from './support/owned-fixtures.js';

const S = runSuffix();
const ADMIN_LIKE = `saOnly${S}`;          // holds every config permission ADMIN holds
const ADM_USER = `saonlyadm${S}`.toLowerCase();
const SA_USER = `saonlysa${S}`.toLowerCase();
const PW = 'SaOnly@2026!x';
let app: FastifyInstance;
let admToken = '';
let saToken = '';
const userIds: string[] = [];

const stored = async (key: string) =>
  (await prisma.systemConfig.findUnique({ where: { configKey: key } }))?.configValue ?? null;

beforeAll(async () => {
  await discoverAndRegisterConfigs();
  await createRole(ADMIN_LIKE, ['CONFIG_READ', 'CONFIG_UPDATE', 'ROLE_MANAGE']);
  userIds.push(await createUser(ADM_USER, ADMIN_LIKE, PW));
  userIds.push(await createUser(SA_USER, 'SUPER_ADMIN', PW));
  app = await buildApp([
    { plugin: ldapRoutes, prefix: '/api/ldap' },
    { plugin: dynamicConfigRoutes, prefix: '/api/config' },
  ]);
  admToken = await login(app, ADM_USER, PW);
  saToken = await login(app, SA_USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([ADMIN_LIKE])],
    ['app', async () => { await app?.close(); }],
  ]);
}, 60_000);

describe('Tablet App Access is SUPER_ADMIN-only', () => {
  it('GET refuses a CONFIG_READ holder and serves SUPER_ADMIN', async () => {
    expect((await authGet(app, '/api/config/tablet-access', admToken)).statusCode).toBe(403);
    expect((await authGet(app, '/api/config/tablet-access', saToken)).statusCode).toBe(200);
  });

  it('PUT refuses a CONFIG_UPDATE holder — even with a valid password — and writes nothing', async () => {
    const before = await stored('tablet-access');
    const res = await authPut(app, '/api/config/tablet-access', admToken, { OPERATOR: ['login'] }, PW);
    expect(res.statusCode).toBe(403);
    expect(await stored('tablet-access')).toEqual(before);
  });

  it('the tablet\'s own feature read stays open to every signed-in user', async () => {
    expect((await authGet(app, '/api/config/tablet-access/my-features', admToken)).statusCode).toBe(200);
  });
});

describe('LDAP configuration is SUPER_ADMIN-only (read and write)', () => {
  it('GET /config and /status refuse a CONFIG_READ holder and serve SUPER_ADMIN', async () => {
    expect((await authGet(app, '/api/ldap/config', admToken)).statusCode).toBe(403);
    expect((await authGet(app, '/api/ldap/status', admToken)).statusCode).toBe(403);
    expect((await authGet(app, '/api/ldap/config', saToken)).statusCode).toBe(200);
    expect((await authGet(app, '/api/ldap/status', saToken)).statusCode).toBe(200);
  });

  it('PUT /config refuses a CONFIG_UPDATE holder — the group→role mapping — and writes nothing', async () => {
    const before = await stored('ldap');
    const res = await authPut(app, '/api/ldap/config', admToken, {
      roleMappings: [{ ldapGroup: 'CN=Everyone,DC=x', role: 'SUPER_ADMIN' }],
    }, PW);
    expect(res.statusCode).toBe(403);
    expect(await stored('ldap')).toEqual(before);
  });

  it('POST /test-connection refuses a CONFIG_UPDATE holder before any connection attempt', async () => {
    const res = await authPost(app, '/api/ldap/test-connection', admToken, { serverUrl: 'ldap://127.0.0.1:1' });
    expect(res.statusCode).toBe(403);
  });
});

describe('AHU completion process is SUPER_ADMIN-only', () => {
  it('GET and PUT refuse a CONFIG holder (def requiredRole SUPER_ADMIN) and write nothing', async () => {
    expect((await authGet(app, '/api/config/dynamic/ahu-completion-process', admToken)).statusCode).toBe(403);
    const before = await stored('ahu-completion-process');
    const res = await authPut(app, '/api/config/dynamic/ahu-completion-process', admToken, { mode: 'INTERLOCK' }, PW);
    expect(res.statusCode).toBe(403);
    expect(await stored('ahu-completion-process')).toEqual(before);
    expect((await authGet(app, '/api/config/dynamic/ahu-completion-process', saToken)).statusCode).toBe(200);
  });
});

// Follow-up (func-03, 2026-10-22): two more pages that are SUPER_ADMIN-only in
// the UI (/config/filter-setup, /config/role-assignments) must refuse ADMIN on
// the API too. Their writes:
//  - Filter Setup: PUT /api/config/cleaning-profile-assignment (static route,
//    was CONFIG_UPDATE) + the dynamic filter-cleaning-reasons /
//    filter-field-options defs.
//  - Role Assignments: the eight dynamic workflow defs, block-change approval
//    mode included.
describe('Filter Setup writes are SUPER_ADMIN-only', () => {
  it('PUT /cleaning-profile-assignment refuses a CONFIG_UPDATE holder — even with a valid password — and writes nothing', async () => {
    const before = await stored('cleaning-profile-assignment');
    const res = await authPut(app, '/api/config/cleaning-profile-assignment', admToken, { mode: 'BY_BLOCK', rules: [] }, PW);
    expect(res.statusCode).toBe(403);
    expect(await stored('cleaning-profile-assignment')).toEqual(before);
  });

  it('the assignment map stays readable by every signed-in user (the tablet caches it for offline scans)', async () => {
    expect((await authGet(app, '/api/config/cleaning-profile-assignment/current', admToken)).statusCode).toBe(200);
  });

  for (const key of ['filter-cleaning-reasons', 'filter-field-options']) {
    it(`PUT /dynamic/${key} refuses a CONFIG_UPDATE holder and writes nothing`, async () => {
      const before = await stored(key);
      const res = await authPut(app, `/api/config/dynamic/${key}`, admToken, {}, PW);
      expect(res.statusCode).toBe(403);
      expect(await stored(key)).toEqual(before);
    });
  }
});

describe('Role Assignments writes are SUPER_ADMIN-only', () => {
  const KEYS = ['pm-schedule-approval', 'replacement-schedule-approval', 'filter-approval', 'qnn-notifications',
    'guest-cleaning-requests', 'block-change-approval', 'stage-interlock', 'pm-schedule-settings'];
  for (const key of KEYS) {
    it(`PUT /dynamic/${key} refuses a CONFIG_UPDATE holder and writes nothing`, async () => {
      const before = await stored(key);
      const body = key === 'block-change-approval' ? { mode: 'SELF_CONFIRM' } : { enabled: false };
      const res = await authPut(app, `/api/config/dynamic/${key}`, admToken, body, PW);
      expect(res.statusCode).toBe(403);
      expect(await stored(key)).toEqual(before);
    });
  }
});
