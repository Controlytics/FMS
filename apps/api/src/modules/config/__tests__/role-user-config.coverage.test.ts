/**
 * Coverage of the Role / User configuration surface (static-routes/roles.routes.ts
 * + configService.{get,update}{Role,User}Config + getMyConfig), 2026-10-21.
 *
 * What a client and the database observe: the role's `permissions` array
 * rebuilt from the feature toggles + sidebar selection, the `role_configs` /
 * `user_configs` rows, the reason / privilege / re-auth refusals, and the
 * CONFIG_CHANGED audit row (with its chain link and reason).
 *
 * Owns: three roles (caller, target, higher), its users, their role/user config
 * rows, and a re-auth grant for its caller role. `qnn-notifications` is changed
 * only by ADDING this file's target role, and restored in a finally.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { FEATURE_TO_PERMISSION_MAP, FEATURE_PRIVILEGES } from '@digilog/shared';
import { buildApp, authGet, authPut, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import { invalidateRolePermsCache } from '../../../plugins/rbac.js';
import {
  cleanupAll, runSuffix, createUser, login, deleteUsers, deleteRoles,
  addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { chainedAuditRow, snapshotRows, restoreRows } from './support/config-rows.js';

const SFX = runSuffix();
const PW = 'CvcRoles@2026';
const CALLER_ROLE = `CVC_RCA_${SFX}`; // hierarchy 5
const TARGET_ROLE = `CVC_RCT_${SFX}`; // hierarchy 1
const HIGH_ROLE = `CVC_RCH_${SFX}`;   // hierarchy 9
const BARE_ROLE = `CVC_RCB_${SFX}`;   // no perms, no config
const SA_USER = `cvcrsa${SFX}`.toLowerCase();
const CALLER_USER = `cvcrca${SFX}`.toLowerCase();
const TARGET_USER = `cvcrct${SFX}`.toLowerCase();
const BARE_USER = `cvcrcb${SFX}`.toLowerCase();
const REASON = 'Coverage test: role privilege change';

const CALLER_PERMS = ['CONFIG_READ', 'CONFIG_UPDATE', 'ROLE_MANAGE', 'USER_READ'];

let app: FastifyInstance;
let saToken = '';
let callerToken = '';
let targetToken = '';
let bareToken = '';
const userIds: string[] = [];
let targetUserId = '';
let bareUserId = '';
let reauthAdded: ReauthGrant = [];

async function makeRole(name: string, level: number, permissions: string[]) {
  await prisma.role.create({ data: { name, displayName: name, hierarchyLevel: level, permissions, isSystem: false, isActive: true, createdBy: 'coverage-test' } });
  invalidateRolePermsCache(name);
}

const rolePerms = async (name: string) =>
  ((await prisma.role.findUnique({ where: { name }, select: { permissions: true } }))?.permissions as string[]) ?? [];

/** Every shared config row this file writes; put back exactly (value + metadata) in afterAll. */
const TOUCHED_KEYS = ['qnn-notifications'];
let originalRows: Awaited<ReturnType<typeof snapshotRows>> = new Map();

beforeAll(async () => {
  originalRows = await snapshotRows(TOUCHED_KEYS);
  await makeRole(CALLER_ROLE, 5, CALLER_PERMS);
  // ENTITY_ASSIGN is granted by no feature toggle: a permissions save must keep it.
  await makeRole(TARGET_ROLE, 1, ['ENTITY_ASSIGN']);
  await makeRole(HIGH_ROLE, 9, []);
  await makeRole(BARE_ROLE, 1, []);
  userIds.push(await createUser(SA_USER, 'SUPER_ADMIN', PW));
  userIds.push(await createUser(CALLER_USER, CALLER_ROLE, PW));
  targetUserId = await createUser(TARGET_USER, TARGET_ROLE, PW);
  bareUserId = await createUser(BARE_USER, BARE_ROLE, PW);
  userIds.push(targetUserId, bareUserId);
  app = await buildApp();
  saToken = await login(app, SA_USER, PW);
  callerToken = await login(app, CALLER_USER, PW);
  targetToken = await login(app, TARGET_USER, PW);
  bareToken = await login(app, BARE_USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['config row metadata', () => restoreRows(originalRows)],
    ['re-auth grants', () => removeReauth(reauthAdded)],
    ['user configs', () => prisma.userConfig.deleteMany({ where: { userId: { in: userIds } } })],
    ['app', async () => app?.close()],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([CALLER_ROLE, TARGET_ROLE, HIGH_ROLE, BARE_ROLE])],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('GET /api/config/roles[/:role]', () => {
  it('needs CONFIG_READ', async () => {
    expect((await authGet(app, '/api/config/roles', bareToken)).statusCode).toBe(403);
    expect((await authGet(app, `/api/config/roles/${TARGET_ROLE}`, bareToken)).statusCode).toBe(403);
  });

  it('a role that does not exist gets the empty default', async () => {
    const ghost = `CVC_NOPE_${SFX}`;
    const res = await authGet(app, `/api/config/roles/${ghost}`, callerToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: ghost, sidebarItems: [], homeWidgets: [], permissions: {} });
  });

  it('a role with neither config nor permissions gets the empty default', async () => {
    const res = await authGet(app, `/api/config/roles/${BARE_ROLE}`, callerToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: BARE_ROLE, sidebarItems: [], homeWidgets: [], permissions: {} });
  });

  it('a role with permissions but no config gets toggles reverse-mapped from its permissions', async () => {
    await prisma.role.update({ where: { name: BARE_ROLE }, data: { permissions: ['USER_READ'] } });
    try {
      const res = await authGet(app, `/api/config/roles/${BARE_ROLE}`, callerToken);
      expect(res.statusCode).toBe(200);
      const { permissions, sidebarItems, homeWidgets } = res.json();
      expect(sidebarItems).toEqual([]);
      expect(homeWidgets).toEqual([]);
      for (const f of FEATURE_PRIVILEGES) {
        const mapped = FEATURE_TO_PERMISSION_MAP[f.id];
        if (!mapped) continue;
        expect(permissions[f.id], f.id).toBe(mapped.includes('USER_READ'));
      }
      expect(permissions['users.view']).toBe(true);
    } finally {
      await prisma.role.update({ where: { name: BARE_ROLE }, data: { permissions: [] } });
      invalidateRolePermsCache(BARE_ROLE);
    }
  });
});

describe('PUT /api/config/roles/:role — refusals', () => {
  it('needs ROLE_MANAGE', async () => {
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, bareToken, { homeWidgets: [] }, PW);
    expect(res.statusCode).toBe(403);
  });

  it('a permission change without a reason is refused before anything is written', async () => {
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, saToken, { permissions: { 'users.view': true } }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_REQUIRED');
    const short = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, saToken, { sidebarItems: ['users'], reason: 'abc' }, PW);
    expect(short.json().error).toBe('REASON_REQUIRED');
    const long = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, saToken, { sidebarItems: ['users'], reason: 'x'.repeat(501) }, PW);
    expect(long.statusCode).toBe(400);
    expect(await prisma.roleConfig.findUnique({ where: { role: TARGET_ROLE } })).toBeNull();
    expect(await rolePerms(TARGET_ROLE)).toEqual(['ENTITY_ASSIGN']);
    expect(internalErrors).toEqual([]);
  });

  it('an unknown role is 404 and leaves no config row', async () => {
    const ghost = `CVC_GHOST_${SFX}`;
    const res = await authPut(app, `/api/config/roles/${ghost}`, saToken, { homeWidgets: ['x'] }, PW);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND', message: 'Role not found' });
    expect(await prisma.roleConfig.findUnique({ where: { role: ghost } })).toBeNull();
  });

  it('a caller cannot edit its own role, or a role at or above its level', async () => {
    const own = await authPut(app, `/api/config/roles/${CALLER_ROLE}`, callerToken, { homeWidgets: ['x'] }, PW);
    expect(own.statusCode).toBe(403);
    expect(own.json().message).toBe('You cannot modify your own role');
    const high = await authPut(app, `/api/config/roles/${HIGH_ROLE}`, callerToken, { homeWidgets: ['x'] }, PW);
    expect(high.statusCode).toBe(403);
    expect(high.json().message).toBe('You cannot modify a role at or above your own hierarchy level');
    expect(await prisma.roleConfig.findUnique({ where: { role: HIGH_ROLE } })).toBeNull();
  });

  it('a caller cannot grant a permission its own role does not hold, and the role keeps its permissions', async () => {
    const before = await rolePerms(TARGET_ROLE);
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken,
      { permissions: { 'audit.delete': true }, reason: REASON }, PW);
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toContain('You cannot grant permissions your own role does not hold');
    expect(res.json().message).toContain('AUDIT_DELETE');
    expect(await rolePerms(TARGET_ROLE)).toEqual(before);
    // Clean up whatever the refused save may have left behind (see the defect log).
    await prisma.roleConfig.deleteMany({ where: { role: TARGET_ROLE } });
  });
});

describe('PUT /api/config/roles/:role — saves', () => {
  it('a homeWidgets-only save needs no reason, creates the config row and leaves permissions alone', async () => {
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken, { homeWidgets: ['quick_actions'] }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ role: TARGET_ROLE, sidebarItems: [], homeWidgets: ['quick_actions'], permissions: {} });
    expect(await rolePerms(TARGET_ROLE)).toEqual(['ENTITY_ASSIGN']);
    const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'role_config', targetId: TARGET_ROLE });
    expect(row.userId).toBe(CALLER_USER);
    expect(row.beforeValue).toBeNull();
    expect(row.reason).toBeNull();
    expect(row.afterValue).toEqual({ sidebarItems: [], homeWidgets: ['quick_actions'], permissions: {} });
  });

  it('a permissions save rebuilds the role permissions from the toggles and keeps unmapped grants', async () => {
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken,
      { permissions: { 'users.view': true, 'config.view': false }, reason: REASON }, PW);
    expect(res.statusCode).toBe(200);
    expect(new Set(await rolePerms(TARGET_ROLE))).toEqual(new Set(['ENTITY_ASSIGN', ...FEATURE_TO_PERMISSION_MAP['users.view']]));
    const cfg = await prisma.roleConfig.findUnique({ where: { role: TARGET_ROLE } });
    expect(cfg!.homeWidgets).toEqual(['quick_actions']); // untouched by a permissions save
    expect(cfg!.permissions).toEqual({ 'users.view': true, 'config.view': false });
    const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'role_config', targetId: TARGET_ROLE });
    expect(row.reason).toBe(REASON);
    expect(row.signatureMeaning).toBe(`Role configuration updated for ${TARGET_ROLE}`);
    expect(row.beforeValue).toEqual({ sidebarItems: [], homeWidgets: ['quick_actions'], permissions: {} });
  });

  it('a sidebar save is additive: each enabled item grants its primary permission, none are revoked', async () => {
    const snapshot = (await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } }))?.configValue ?? null;
    try {
      // users -> USER_READ; admin-requests opts out; quality-notifications has no
      // privilege section; dashboard has no privileges.
      const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, saToken,
        { sidebarItems: ['users', 'admin-requests', 'quality-notifications', 'dashboard'], reason: REASON }, PW);
      expect(res.statusCode).toBe(200);
      const perms = await rolePerms(TARGET_ROLE);
      expect(new Set(perms)).toEqual(new Set(['ENTITY_ASSIGN', 'USER_READ']));
      expect(perms).not.toContain('ADMIN_REQUEST_APPROVE');
      // Enabling the QNN report adds the role to the report's own visibility list.
      const qnn = (await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } }))!.configValue as { visibleRoles: string[] };
      expect(qnn.visibleRoles).toContain(TARGET_ROLE);
      const before = (snapshot as { visibleRoles?: string[] } | null)?.visibleRoles ?? ['ADMIN'];
      for (const r of before) expect(qnn.visibleRoles).toContain(r);

      // Saving the same sidebar again is a no-op for the QNN list (no duplicate).
      const again = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, saToken,
        { sidebarItems: ['users', 'quality-notifications'], reason: REASON }, PW);
      expect(again.statusCode).toBe(200);
      const qnn2 = (await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } }))!.configValue as { visibleRoles: string[] };
      expect(qnn2.visibleRoles.filter((r) => r === TARGET_ROLE)).toHaveLength(1);
    } finally {
      if (snapshot === null) await prisma.systemConfig.deleteMany({ where: { configKey: 'qnn-notifications' } });
      else await prisma.systemConfig.update({ where: { configKey: 'qnn-notifications' }, data: { configValue: snapshot as Prisma.InputJsonValue } });
    }
  });

  it('a permissions-only save re-applies the STORED sidebar, so it cannot strip a sidebar-granted permission', async () => {
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken,
      { permissions: { 'users.view': false }, reason: REASON }, PW);
    expect(res.statusCode).toBe(200);
    // users.view is off, but the stored sidebar still lists `users`, whose primary permission is USER_READ.
    expect(new Set(await rolePerms(TARGET_ROLE))).toEqual(new Set(['ENTITY_ASSIGN', 'USER_READ']));
  });

  it('the list includes the saved config; the target role sees it as its own effective config', async () => {
    const list = await authGet(app, '/api/config/roles', callerToken);
    expect(list.statusCode).toBe(200);
    const mine = (list.json() as Array<{ role: string }>).find((r) => r.role === TARGET_ROLE);
    expect(mine).toMatchObject({ role: TARGET_ROLE, sidebarItems: ['users', 'quality-notifications'], homeWidgets: ['quick_actions'] });

    const my = await authGet(app, '/api/config/my-config', targetToken);
    expect(my.statusCode).toBe(200);
    expect(my.json()).toEqual({ sidebarItems: ['users', 'quality-notifications'], homeWidgets: ['quick_actions'], permissions: { 'users.view': false } });
  });

  it('my-config falls back to the empty default for a role with no config', async () => {
    const res = await authGet(app, '/api/config/my-config', bareToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sidebarItems: [], homeWidgets: [], permissions: {} });
  });
});

describe('user-specific config', () => {
  it('GET needs CONFIG_READ and returns the empty default for a user with none', async () => {
    expect((await authGet(app, `/api/config/users/${bareUserId}`, bareToken)).statusCode).toBe(403);
    const res = await authGet(app, `/api/config/users/${bareUserId}`, callerToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: bareUserId, sidebarItems: [], homeWidgets: [], permissions: {} });
  });

  it('a permissions change needs a reason', async () => {
    const res = await authPut(app, `/api/config/users/${targetUserId}`, callerToken, { permissions: { 'users.view': true } }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_REQUIRED');
    expect(await prisma.userConfig.findUnique({ where: { userId: targetUserId } })).toBeNull();
  });

  it('a homeWidgets-only save creates the row with empty defaults and audits it without a reason', async () => {
    const res = await authPut(app, `/api/config/users/${targetUserId}`, callerToken, { homeWidgets: ['audit_trail'] }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ userId: targetUserId, sidebarItems: [], homeWidgets: ['audit_trail'], permissions: {} });
    const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'user_config', targetId: targetUserId });
    expect(row.beforeValue).toBeNull();
    expect(row.reason).toBeNull();
    expect(row.signatureMeaning).toBe(`User-specific configuration updated for ${targetUserId}`);
  });

  it('a user config with only home widgets does not override the role config in my-config', async () => {
    const my = await authGet(app, '/api/config/my-config', targetToken);
    expect(my.json().sidebarItems).toEqual(['users', 'quality-notifications']);
  });

  it('a permissions save updates the row in place, keeps home widgets, and records the reason', async () => {
    const res = await authPut(app, `/api/config/users/${targetUserId}`, callerToken,
      { sidebarItems: ['audit'], permissions: { 'audit.view': true }, reason: REASON }, PW);
    expect(res.statusCode).toBe(200);
    const cfg = await prisma.userConfig.findUnique({ where: { userId: targetUserId } });
    expect(cfg).toMatchObject({ sidebarItems: ['audit'], homeWidgets: ['audit_trail'], permissions: { 'audit.view': true } });
    const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'user_config', targetId: targetUserId });
    expect(row.reason).toBe(REASON);
    expect(row.beforeValue).toEqual({ sidebarItems: [], homeWidgets: ['audit_trail'], permissions: {} });
  });

  it('once the user config has sidebar items, my-config returns it instead of the role config', async () => {
    const my = await authGet(app, '/api/config/my-config', targetToken);
    expect(my.json()).toEqual({ sidebarItems: ['audit'], homeWidgets: ['audit_trail'], permissions: { 'audit.view': true } });
  });

  it('a GET returns the stored user config', async () => {
    const res = await authGet(app, `/api/config/users/${targetUserId}`, callerToken);
    expect(res.json()).toMatchObject({ userId: targetUserId, sidebarItems: ['audit'], homeWidgets: ['audit_trail'] });
  });

  it('a save for a user id that does not exist is not reported as a server error', async () => {
    const ghost = randomUUID();
    try {
      const res = await authPut(app, `/api/config/users/${ghost}`, callerToken, { homeWidgets: ['x'] }, PW);
      expect(res.statusCode).toBeLessThan(500);
      expect(internalErrors).toEqual([]);
    } finally {
      await prisma.userConfig.deleteMany({ where: { userId: ghost } });
    }
  });
});

describe('first saves that create rows', () => {
  it('a sidebar-only user save creates the row with empty home widgets and permissions (no reason needed)', async () => {
    const res = await authPut(app, `/api/config/users/${bareUserId}`, callerToken, { sidebarItems: ['audit'] }, PW);
    expect(res.statusCode).toBe(200);
    expect(await prisma.userConfig.findUnique({ where: { userId: bareUserId } }))
      .toMatchObject({ sidebarItems: ['audit'], homeWidgets: [], permissions: {} });
    const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'user_config', targetId: bareUserId });
    expect(row.reason).toBeNull();
  });

  it('enabling the QNN report with no qnn-notifications row creates it with ADMIN + the role', async () => {
    // "No row" reads as visibleRoles ['ADMIN'] everywhere (pm-schedules/qnn.ts), so
    // removing it for this test is invisible to other readers; the exact row is put back.
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } });
    if (row) await prisma.systemConfig.delete({ where: { configKey: 'qnn-notifications' } });
    try {
      const res = await authPut(app, `/api/config/roles/${HIGH_ROLE}`, saToken,
        { sidebarItems: ['quality-notifications'], reason: REASON }, PW);
      expect(res.statusCode).toBe(200);
      const created = await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } });
      expect(created).toMatchObject({
        configValue: { visibleRoles: ['ADMIN', HIGH_ROLE] }, configType: 'notification', requiresReauth: false, updatedBy: SA_USER,
      });
    } finally {
      await prisma.systemConfig.deleteMany({ where: { configKey: 'qnn-notifications' } });
      if (row) {
        await prisma.systemConfig.create({
          data: {
            id: row.id, configKey: row.configKey, configValue: row.configValue as Prisma.InputJsonValue,
            configType: row.configType, requiresReauth: row.requiresReauth, updatedAt: row.updatedAt, updatedBy: row.updatedBy,
          },
        });
      }
    }
  });
});

describe('policy-driven re-auth on role / user config saves', () => {
  beforeAll(async () => {
    reauthAdded = await addReauth([['UPDATE_ROLE_CONFIG', CALLER_ROLE], ['UPDATE_USER_CONFIG', CALLER_ROLE]]);
  }, 60_000);
  afterAll(async () => { await removeReauth(reauthAdded); reauthAdded = []; }, 60_000);

  it('a role-config save without a password is 401 REAUTH_REQUIRED and changes nothing', async () => {
    const before = await prisma.roleConfig.findUnique({ where: { role: TARGET_ROLE } });
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken, { homeWidgets: ['changed'] });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPDATE_ROLE_CONFIG' });
    expect((await prisma.roleConfig.findUnique({ where: { role: TARGET_ROLE } }))!.homeWidgets).toEqual(before!.homeWidgets);
  });

  it('the reason is checked BEFORE the signature, so a refused save leaves no signature row', async () => {
    const sigBefore = await prisma.auditTrail.count({ where: { action: 'REAUTH_SUCCESS', userId: CALLER_USER } });
    const res = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken, { permissions: { 'users.view': true } }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_REQUIRED');
    expect(await prisma.auditTrail.count({ where: { action: 'REAUTH_SUCCESS', userId: CALLER_USER } })).toBe(sigBefore);
  });

  it('a user-config save without a password is 401 REAUTH_REQUIRED and changes nothing', async () => {
    const res = await authPut(app, `/api/config/users/${targetUserId}`, callerToken, { homeWidgets: ['changed'] });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPDATE_USER_CONFIG' });
    expect((await prisma.userConfig.findUnique({ where: { userId: targetUserId } }))!.homeWidgets).toEqual(['audit_trail']);
  });

  it('with the password both saves are signed and linked to their signature rows', async () => {
    const r1 = await authPut(app, `/api/config/roles/${TARGET_ROLE}`, callerToken, { homeWidgets: ['signed'] }, PW);
    expect(r1.statusCode).toBe(200);
    const sig1 = await chainedAuditRow({ action: 'REAUTH_SUCCESS', userId: CALLER_USER });
    expect(sig1.afterValue).toMatchObject({ reauthAction: 'UPDATE_ROLE_CONFIG' });
    const ch1 = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'role_config', targetId: TARGET_ROLE });
    expect(ch1.signatureAuditId).toBe(sig1.id);

    const r2 = await authPut(app, `/api/config/users/${targetUserId}`, callerToken, { homeWidgets: ['signed'] }, PW);
    expect(r2.statusCode).toBe(200);
    const sig2 = await chainedAuditRow({ action: 'REAUTH_SUCCESS', userId: CALLER_USER });
    expect(sig2.afterValue).toMatchObject({ reauthAction: 'UPDATE_USER_CONFIG' });
    const ch2 = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetType: 'user_config', targetId: targetUserId });
    expect(ch2.signatureAuditId).toBe(sig2.id);
  });
});
