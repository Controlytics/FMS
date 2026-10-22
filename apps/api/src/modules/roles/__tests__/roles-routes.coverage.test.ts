/**
 * Roles routes (coverage, 2026-10-21) through the real stack and test DB:
 * the public /active list, the access matrix, CRUD with the privilege
 * boundary for a non-SUPER_ADMIN role manager, system-role restrictions,
 * the change-reason and re-auth gates, and the audit rows written.
 *
 * Owns every role and user it touches (prefix `cva` / `CVA_`). Shared system
 * roles are only read, never written.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authGet, authPost, authPut, authDelete, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import { invalidateRolePermsCache } from '../../../plugins/rbac.js';
import {
  cleanupAll, runSuffix, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { validUserId } from '../../users/__tests__/support/cva-fixtures.js';

const S = runSuffix();
const PW = 'CvaRole@2026x';
const SA = `cva_ro_sa_${S}`.toLowerCase();
const MGR = `cva_ro_mg_${S}`.toLowerCase();
const LOW = `cva_ro_lo_${S}`.toLowerCase();
// Role names: uppercase, <= 20 chars, unique per run.
const R_MGR = `CVA_RM_${S}`;      // level 5, ROLE_MANAGE + a few perms
const R_LOW = `CVA_RL_${S}`;      // level 3, target the manager may edit
const R_HIGH = `CVA_RH_${S}`;     // level 7, above the manager
const R_SYS = `CVA_RS_${S}`;      // isSystem, level 2
const R_NEW = `CVA_RN_${S}`;      // created through the API
const R_NEW2 = `CVA_RX_${S}`;     // created through the API by the manager
const ALL_ROLES = [R_MGR, R_LOW, R_HIGH, R_SYS, R_NEW, R_NEW2];

let app: FastifyInstance;
let saTok = '';
let mgrTok = '';
const userIds: string[] = [];
let reauthAdded: ReauthGrant = [];

async function makeRole(name: string, hierarchyLevel: number, permissions: string[], isSystem = false) {
  await prisma.role.create({ data: { name, displayName: name, hierarchyLevel, permissions, isSystem, isActive: true, createdBy: 'coverage-test' } });
  invalidateRolePermsCache(name);
}

async function auditFor(action: string, targetId: string) {
  return prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });
}

describe('roles routes', () => {
  beforeAll(async () => {
    await makeRole(R_MGR, 5, ['ROLE_MANAGE', 'USER_CREATE', 'USER_READ', 'CONFIG_READ']);
    await makeRole(R_LOW, 3, ['USER_READ', 'AUDIT_READ']);
    await makeRole(R_HIGH, 7, ['USER_READ']);
    await makeRole(R_SYS, 2, ['USER_READ'], true);
    await prisma.roleConfig.create({ data: { role: R_LOW, sidebarItems: ['users', 'audit'] } });
    userIds.push(await createUser(SA, 'SUPER_ADMIN', PW));
    userIds.push(await createUser(MGR, R_MGR, PW));
    userIds.push(await createUser(LOW, R_LOW, PW));
    app = await buildApp();
    saTok = await login(app, SA, PW);
    mgrTok = await login(app, MGR, PW);
  }, 60_000);

  afterAll(async () => {
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['users', () => deleteUsers(userIds)],
      ['roles', () => deleteRoles(ALL_ROLES)],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  describe('GET /active (public)', () => {
    it('hides SUPER_ADMIN from an anonymous caller', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/roles/active' });
      expect(res.statusCode).toBe(200);
      const names = res.json().map((r: any) => r.name);
      expect(names).toContain(R_LOW);
      expect(names).not.toContain('SUPER_ADMIN');
    });

    it('treats an unverifiable Bearer token as anonymous (still hidden, still 200)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/roles/active', headers: { authorization: 'Bearer not-a-jwt' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((r: any) => r.name)).not.toContain('SUPER_ADMIN');
    });

    it('shows SUPER_ADMIN to a SUPER_ADMIN token, with minimal fields only', async () => {
      const res = await authGet(app, '/api/roles/active', saTok);
      const sa = res.json().find((r: any) => r.name === 'SUPER_ADMIN');
      expect(sa).toBeTruthy();
      expect(Object.keys(sa).sort()).toEqual(['color', 'displayName', 'hierarchyLevel', 'id', 'name']);
    });
  });

  describe('GET /access-matrix', () => {
    it('returns permissions + per-role sidebar items, hiding SUPER_ADMIN from non-SA', async () => {
      const res = await authGet(app, '/api/roles/access-matrix', mgrTok);
      expect(res.statusCode).toBe(200);
      const roles = res.json().roles;
      expect(roles.map((r: any) => r.name)).not.toContain('SUPER_ADMIN');
      expect(roles.find((r: any) => r.name === R_LOW)).toEqual({
        name: R_LOW, displayName: R_LOW, hierarchyLevel: 3, color: '#6366f1',
        permissions: ['USER_READ', 'AUDIT_READ'], sidebarItems: ['users', 'audit'],
      });
      // A role with no role_configs row gets an empty sidebar list.
      expect(roles.find((r: any) => r.name === R_HIGH).sidebarItems).toEqual([]);
    });

    it('includes SUPER_ADMIN for a SUPER_ADMIN caller', async () => {
      const res = await authGet(app, '/api/roles/access-matrix', saTok);
      expect(res.json().roles.map((r: any) => r.name)).toContain('SUPER_ADMIN');
    });
  });

  describe('reads gated on ROLE_MANAGE', () => {
    it('lists roles; non-SA does not see SUPER_ADMIN', async () => {
      const asMgr = await authGet(app, '/api/roles', mgrTok);
      expect(asMgr.statusCode).toBe(200);
      expect(asMgr.json().map((r: any) => r.name)).not.toContain('SUPER_ADMIN');
      const asSa = await authGet(app, '/api/roles', saTok);
      expect(asSa.json().map((r: any) => r.name)).toContain('SUPER_ADMIN');
    });

    it('403s a role without ROLE_MANAGE', async () => {
      const lowTok = await login(app, LOW, PW);
      const res = await authGet(app, '/api/roles', lowTok);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN', requiredPermission: 'ROLE_MANAGE' });
    });

    it('returns the permission catalogue with labels and categories', async () => {
      const res = await authGet(app, '/api/roles/permissions/all', mgrTok);
      expect(res.statusCode).toBe(200);
      const perms = res.json().permissions as Array<{ key: string; label: string; category: string }>;
      expect(perms.find((p) => p.key === 'USER_CREATE')).toEqual({ key: 'USER_CREATE', label: 'Create Users', category: 'User Management' });
      // Every key has a label and a category, falling back to the key / "Other".
      for (const p of perms) { expect(p.label).toBeTruthy(); expect(p.category).toBeTruthy(); }
    });

    it('gets a role by name; SUPER_ADMIN is a 404 to a non-SA; unknown is 404', async () => {
      const ok = await authGet(app, `/api/roles/${R_LOW}`, mgrTok);
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ name: R_LOW, hierarchyLevel: 3, isSystem: false });
      expect((await authGet(app, '/api/roles/SUPER_ADMIN', mgrTok)).statusCode).toBe(404);
      expect((await authGet(app, '/api/roles/SUPER_ADMIN', saTok)).statusCode).toBe(200);
      const missing = await authGet(app, `/api/roles/CVA_NOPE_${S}`, saTok);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error).toBe('NOT_FOUND');
    });

    it('creatable roles: the caller\'s own level and below, SUPER_ADMIN only for SA', async () => {
      const asMgr = await authGet(app, '/api/roles/IGNORED/creatable', mgrTok);
      expect(asMgr.statusCode).toBe(200);
      const names = asMgr.json().map((r: any) => r.name);
      expect(names).toEqual(expect.arrayContaining([R_MGR, R_LOW, R_SYS]));
      expect(names).not.toContain(R_HIGH);
      expect(names).not.toContain('SUPER_ADMIN');
      for (const r of asMgr.json()) expect(r.hierarchyLevel).toBeLessThanOrEqual(5);

      // SUPER_ADMIN sees its own role, bounded by its own hierarchy level like everyone.
      const asSa = await authGet(app, '/api/roles/IGNORED/creatable', saTok);
      const saLevel = (await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } }))!.hierarchyLevel;
      const saNames = asSa.json().map((r: any) => r.name);
      expect(saNames).toEqual(expect.arrayContaining(['SUPER_ADMIN', R_MGR, R_LOW]));
      for (const r of asSa.json()) expect(r.hierarchyLevel).toBeLessThanOrEqual(saLevel);
    });
  });

  describe('create', () => {
    it('creates a role as SUPER_ADMIN and audits it', async () => {
      const res = await authPost(app, '/api/roles', saTok, {
        name: R_NEW, displayName: 'Coverage new', hierarchyLevel: 2, permissions: ['USER_READ'], description: 'd',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: true, data: { name: R_NEW, isSystem: false, color: '#6366f1', createdBy: SA } });
      const row = await auditFor('ROLE_CREATED', R_NEW);
      expect(row?.afterValue).toMatchObject({ name: R_NEW, permissions: ['USER_READ'] });
    });

    it('409s a duplicate name', async () => {
      const res = await authPost(app, '/api/roles', saTok, { name: R_NEW, displayName: 'dup', hierarchyLevel: 2 });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('CONFLICT');
    });

    it('400s a name that is not UPPER_SNAKE or longer than 20', async () => {
      for (const name of ['lower_case', 'CVA_' + 'X'.repeat(30)]) {
        const res = await authPost(app, '/api/roles', saTok, { name, displayName: 'bad', hierarchyLevel: 2 });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('VALIDATION_ERROR');
        expect(await prisma.role.findUnique({ where: { name } })).toBeNull();
      }
      expect(internalErrors).toHaveLength(0);
    });

    it('stops a non-SA manager from creating at/above its own level or with permissions it lacks', async () => {
      const atLevel = await authPost(app, '/api/roles', mgrTok, { name: R_NEW2, displayName: 'Cov x', hierarchyLevel: 5 });
      expect(atLevel.statusCode).toBe(403);
      expect(atLevel.json().message).toMatch(/hierarchy level at or above your own/);

      const six = ['AUDIT_DELETE', 'BACKUP_RESTORE', 'USER_DELETE', 'USER_UNLOCK', 'USER_RESET_PASSWORD', 'CONFIG_UPDATE'];
      const escal = await authPost(app, '/api/roles', mgrTok, { name: R_NEW2, displayName: 'Cov x', hierarchyLevel: 2, permissions: six });
      expect(escal.statusCode).toBe(403);
      expect(escal.json().message).toBe(`You cannot grant permissions your own role does not hold: ${six.slice(0, 5).join(', ')}, …`);

      const one = await authPost(app, '/api/roles', mgrTok, { name: R_NEW2, displayName: 'Cov x', hierarchyLevel: 2, permissions: ['AUDIT_DELETE'] });
      expect(one.json().message).toBe('You cannot grant permissions your own role does not hold: AUDIT_DELETE');
      expect(await prisma.role.findUnique({ where: { name: R_NEW2 } })).toBeNull();

      const allowed = await authPost(app, '/api/roles', mgrTok, { name: R_NEW2, displayName: 'Cov x', hierarchyLevel: 2, permissions: ['USER_READ'] });
      expect(allowed.statusCode).toBe(200);
    });
  });

  describe('update', () => {
    it('requires a reason when permissions or hierarchy level change', async () => {
      const res = await authPut(app, `/api/roles/${R_LOW}`, saTok, { permissions: ['USER_READ'] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('REASON_REQUIRED');
      const lvl = await authPut(app, `/api/roles/${R_LOW}`, saTok, { hierarchyLevel: 2, reason: 'abc' });
      expect(lvl.json().error).toBe('REASON_REQUIRED');
      expect((await prisma.role.findUnique({ where: { name: R_LOW } }))?.hierarchyLevel).toBe(3);
    });

    it('a cosmetic edit needs no reason; schema-invalid values are a 400', async () => {
      const ok = await authPut(app, `/api/roles/${R_LOW}`, saTok, { color: '#123456', displayName: 'Low role' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data).toMatchObject({ color: '#123456', displayName: 'Low role', updatedBy: SA });
      const row = await auditFor('ROLE_UPDATED', R_LOW);
      expect(row?.reason).toBeNull();
      expect(row?.beforeValue).toMatchObject({ displayName: R_LOW });

      const bad = await authPut(app, `/api/roles/${R_LOW}`, saTok, { displayName: 'x' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toBe('VALIDATION_ERROR');
    });

    it('records the reason on the audit row when permissions change', async () => {
      const res = await authPut(app, `/api/roles/${R_LOW}`, saTok, { permissions: ['USER_READ', 'AUDIT_READ', 'CONFIG_READ'], reason: 'coverage: add config read' });
      expect(res.statusCode).toBe(200);
      const row = await auditFor('ROLE_UPDATED', R_LOW);
      expect(row?.reason).toBe('coverage: add config read');
      expect(row?.afterValue).toMatchObject({ permissions: ['USER_READ', 'AUDIT_READ', 'CONFIG_READ'] });
    });

    it('404s an unknown role', async () => {
      const res = await authPut(app, `/api/roles/CVA_NONE_${S}`, saTok, { color: '#000' });
      expect(res.statusCode).toBe(404);
    });

    it('a system role only takes permissions / color / displayName / description', async () => {
      const res = await authPut(app, `/api/roles/${R_SYS}`, saTok, {
        // 5, not 9: a level above SUPER_ADMIN's own is refused before the
        // system-role rule is reached (D-AUTH-2); this test is about the latter.
        hierarchyLevel: 5, isActive: false, color: '#abcdef', description: 'sys desc', reason: 'coverage: system role edit',
      });
      expect(res.statusCode).toBe(200);
      const row = await prisma.role.findUnique({ where: { name: R_SYS } });
      expect(row).toMatchObject({ hierarchyLevel: 2, isActive: true, color: '#abcdef', description: 'sys desc' });
    });

    it('stops a non-SA manager editing its own role, a role above it, or granting what it lacks', async () => {
      const own = await authPut(app, `/api/roles/${R_MGR}`, mgrTok, { color: '#111111' });
      expect(own.statusCode).toBe(403);
      expect(own.json().message).toBe('You cannot modify your own role');

      const high = await authPut(app, `/api/roles/${R_HIGH}`, mgrTok, { color: '#111111' });
      expect(high.json().message).toMatch(/at or above your own hierarchy level/);

      const raise = await authPut(app, `/api/roles/${R_LOW}`, mgrTok, { hierarchyLevel: 6, reason: 'coverage raise' });
      expect(raise.json().message).toMatch(/hierarchy level at or above your own/);

      // AUDIT_READ is already on R_LOW (grandfathered), USER_DELETE is new and not held.
      const esc = await authPut(app, `/api/roles/${R_LOW}`, mgrTok, { permissions: ['AUDIT_READ', 'USER_DELETE'], reason: 'coverage escalate' });
      expect(esc.statusCode).toBe(403);
      expect(esc.json().message).toBe('You cannot grant permissions your own role does not hold: USER_DELETE');

      const keep = await authPut(app, `/api/roles/${R_LOW}`, mgrTok, { permissions: ['AUDIT_READ', 'USER_READ'], reason: 'coverage keep grandfathered' });
      expect(keep.statusCode).toBe(200);
      expect((await prisma.role.findUnique({ where: { name: R_LOW } }))?.permissions).toEqual(['AUDIT_READ', 'USER_READ']);

      // Clearing every permission grants nothing, so it needs no subset check.
      const clear = await authPut(app, `/api/roles/${R_NEW2}`, mgrTok, { permissions: [], reason: 'coverage clear all' });
      expect(clear.statusCode).toBe(200);
      expect((await prisma.role.findUnique({ where: { name: R_NEW2 } }))?.permissions).toEqual([]);
    });

    it('the access matrix shows [] for a role whose stored permissions are not a list', async () => {
      await prisma.role.update({ where: { name: R_HIGH }, data: { permissions: { legacy: true } } });
      const res = await authGet(app, '/api/roles/access-matrix', saTok);
      expect(res.json().roles.find((r: any) => r.name === R_HIGH).permissions).toEqual([]);
      await prisma.role.update({ where: { name: R_HIGH }, data: { permissions: ['USER_READ'] } });
    });
  });

  describe('delete', () => {
    it('refuses a system role (409 SYSTEM_ROLE), even with no users', async () => {
      const res = await authDelete(app, `/api/roles/${R_SYS}`, saTok);
      expect(res.statusCode).toBe(409);
      expect(await prisma.role.findUnique({ where: { name: R_SYS } })).not.toBeNull();
    });

    it('refuses a role with users, reporting the count', async () => {
      const res = await authDelete(app, `/api/roles/${R_LOW}`, saTok);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'Cannot delete role with assigned users', usersCount: 1 });
    });

    it('404s an unknown role', async () => {
      expect((await authDelete(app, `/api/roles/CVA_GONE_${S}`, saTok)).statusCode).toBe(404);
    });

    it('stops a non-SA manager deleting a role above it', async () => {
      const res = await authDelete(app, `/api/roles/${R_HIGH}`, mgrTok);
      expect(res.statusCode).toBe(403);
      expect(await prisma.role.findUnique({ where: { name: R_HIGH } })).not.toBeNull();
    });

    it('deletes an unused custom role with its role_configs row and audits it', async () => {
      await prisma.roleConfig.create({ data: { role: R_NEW, sidebarItems: ['users'] } });
      const res = await authDelete(app, `/api/roles/${R_NEW}`, saTok);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(await prisma.role.findUnique({ where: { name: R_NEW } })).toBeNull();
      expect(await prisma.roleConfig.findUnique({ where: { role: R_NEW } })).toBeNull();
      const row = await auditFor('ROLE_DELETED', R_NEW);
      expect(row?.beforeValue).toMatchObject({ name: R_NEW, hierarchyLevel: 2, permissions: ['USER_READ'] });
      expect(row?.signatureMeaning).toBe('Custom role "Coverage new" permanently deleted');
    });
  });

  describe('a role above SUPER_ADMIN', () => {
    const R_TOP = `CVA_RT_${S}`;
    const R_TOP2 = `CVA_RU_${S}`;
    const R_EQ = `CVA_RE_${S}`;
    afterAll(async () => { await deleteRoles([R_TOP, R_TOP2, R_EQ]); });

    // D-AUTH-2: no caller — SUPER_ADMIN included — may create or raise a role
    // above the caller's own level. SUPER_ADMIN's level is read from its role row.
    it('POST refuses a level above SUPER_ADMIN\'s own (400) and writes nothing', async () => {
      const saLevel = (await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } }))!.hierarchyLevel;
      const res = await authPost(app, '/api/roles', saTok, { name: R_TOP2, displayName: 'Above SA', hierarchyLevel: saLevel + 2 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
      expect(res.json().message).toBe(`Hierarchy level ${saLevel + 2} is above your own role's level (${saLevel}); no user could ever be given that role`);
      expect(await prisma.role.findUnique({ where: { name: R_TOP2 } })).toBeNull();
      expect(await auditFor('ROLE_CREATED', R_TOP2)).toBeFalsy();
      expect(internalErrors).toHaveLength(0);
    });

    it('PUT refuses raising a role above SUPER_ADMIN\'s level; the role keeps its level', async () => {
      const saLevel = (await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } }))!.hierarchyLevel;
      const res = await authPut(app, `/api/roles/${R_LOW}`, saTok, { hierarchyLevel: saLevel + 1, reason: 'raise it above the top level' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
      expect((await prisma.role.findUnique({ where: { name: R_LOW } }))?.hierarchyLevel).toBe(3);
      expect(internalErrors).toHaveLength(0);
    });

    it('a role AT SUPER_ADMIN\'s level is still allowed (the bound is "not above")', async () => {
      const saLevel = (await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } }))!.hierarchyLevel;
      const res = await authPost(app, '/api/roles', saTok, { name: R_EQ, displayName: 'At SA level', hierarchyLevel: saLevel });
      expect(res.statusCode).toBe(200);
      expect((await prisma.role.findUnique({ where: { name: R_EQ } }))?.hierarchyLevel).toBe(saLevel);
    });

    // A row above SA can still exist from before the fix (made directly here):
    it('can never be given to a user, not even by SUPER_ADMIN, and is never "creatable"', async () => {
      const saLevel = (await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } }))!.hierarchyLevel;
      await makeRole(R_TOP, saLevel + 2, ['USER_READ']);
      const res = await authPost(app, '/api/users', saTok, { username: await validUserId(), fullName: 'Top', role: R_TOP, password: PW, confirmPassword: PW });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe(`Cannot create users with role ${R_TOP}`);
      expect(await prisma.user.count({ where: { role: R_TOP } })).toBe(0);
      const creatable = await authGet(app, '/api/roles/IGNORED/creatable', saTok);
      expect(creatable.json().map((r: any) => r.name)).not.toContain(R_TOP);
    });
  });

  describe('re-auth gate on the manager role', () => {
    beforeAll(async () => {
      reauthAdded = await addReauth([['CREATE_ROLE', R_MGR], ['UPDATE_ROLE', R_MGR], ['DELETE_ROLE', R_MGR]]);
    });

    it('401s create / update / delete without a password and changes nothing', async () => {
      const c = await authPost(app, '/api/roles', mgrTok, { name: `CVA_RZ_${S}`, displayName: 'Cov z', hierarchyLevel: 1 });
      expect(c.statusCode).toBe(401);
      expect(c.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_ROLE' });
      const u = await authPut(app, `/api/roles/${R_NEW2}`, mgrTok, { color: '#222222' });
      expect(u.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPDATE_ROLE' });
      const d = await authDelete(app, `/api/roles/${R_NEW2}`, mgrTok);
      expect(d.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'DELETE_ROLE' });
      expect(await prisma.role.findUnique({ where: { name: R_NEW2 } })).toMatchObject({ color: '#6366f1' });
    });

    it('a wrong password is REAUTH_FAILED and is audited', async () => {
      const res = await authDelete(app, `/api/roles/${R_NEW2}`, mgrTok, 'Wrong@Pass1');
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('REAUTH_FAILED');
      const row = await prisma.auditTrail.findFirst({ where: { action: 'REAUTH_FAILED', userId: MGR }, orderBy: { chainPosition: 'desc' } });
      expect(row?.afterValue).toMatchObject({ reauthAction: 'DELETE_ROLE' });
      // reset the failure streak this attempt added
      await prisma.user.update({ where: { username: MGR }, data: { failedLoginAttempts: 0 } });
    });

    it('signed with the password, the delete goes through', async () => {
      const res = await authDelete(app, `/api/roles/${R_NEW2}`, mgrTok, PW);
      expect(res.statusCode).toBe(200);
      expect(await prisma.role.findUnique({ where: { name: R_NEW2 } })).toBeNull();
    });
  });
});
