/**
 * RBAC decorators against REAL role rows (coverage, 2026-10-21).
 *
 * The existing rbac.plugin.test.ts drives requirePermission / requireRole with a
 * mocked Prisma. This file mounts the real plugin on a real Fastify instance and
 * reads permissions from roles this file creates in digilog_test_db, so what is
 * asserted is the HTTP answer a client gets: status + body for every decorator,
 * the production-mode body (no permission names leaked), the *_VIEW <- *_READ
 * fallback shared with @digilog/shared, and the 5 s role-permission cache.
 *
 * A stand-in `auth` plugin sets req.user from a test header, because rbac
 * declares a dependency on a plugin of that name and only reads req.user.role.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../../lib/prisma.js';
import rbacPlugin, { getRolePerms, invalidateRolePermsCache } from '../rbac.js';
import { cleanupAll, createRole, deleteRoles, runSuffix } from '../../e2e/support/owned-fixtures.js';

const SFX = runSuffix();
const ROLE_READ = `CVPRB${SFX}`.slice(0, 20);   // AUDIT_READ + ASSET_READ
const ROLE_NONE = `CVPRN${SFX}`.slice(0, 20);   // no permissions
const ROLE_MISSING = `CVPRX${SFX}`.slice(0, 20); // never created: no roles row

let app: FastifyInstance;

const fakeAuth = fp(async (a: FastifyInstance) => {
  a.addHook('onRequest', async (req) => {
    const role = req.headers['x-test-role'];
    (req as any).user = typeof role === 'string' ? { sub: 'u', username: 'u', role, sessionId: 's' } : undefined;
  });
}, { name: 'auth' });

async function call(url: string, role?: string) {
  return app.inject({ method: 'GET', url, headers: role ? { 'x-test-role': role } : {} });
}

/** Run `fn` with NODE_ENV=production, restoring the previous value whatever happens. */
async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { return await fn(); } finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
}

beforeAll(async () => {
  await createRole(ROLE_READ, ['AUDIT_READ', 'ASSET_READ']);
  await createRole(ROLE_NONE, []);
  app = Fastify({ logger: false });
  await app.register(fakeAuth);
  await app.register(rbacPlugin);
  app.get('/perm', { preHandler: [app.requirePermission('AUDIT_READ')] }, async () => ({ ok: true }));
  app.get('/any', { preHandler: [app.requireAnyPermission('USER_CREATE', 'AUDIT_READ')] }, async () => ({ ok: true }));
  app.get('/any-view', { preHandler: [app.requireAnyPermission('USER_CREATE', 'ASSET_VIEW')] }, async () => ({ ok: true }));
  app.get('/any-none', { preHandler: [app.requireAnyPermission('USER_CREATE', 'USER_DELETE')] }, async () => ({ ok: true }));
  app.get('/role', { preHandler: [app.requireRole('ADMIN', ROLE_READ)] }, async () => ({ ok: true }));
  app.get('/sa', { preHandler: [app.requireSuperAdmin()] }, async () => ({ ok: true }));
  await app.ready();
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['close app', async () => { await app?.close(); }],
    ['roles', () => deleteRoles([ROLE_READ, ROLE_NONE])],
  ]);
}, 60_000);

describe('requireAnyPermission', () => {
  it('401s when the request carries no user', async () => {
    const res = await call('/any');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
  });

  it('lets SUPER_ADMIN through without reading any role row', async () => {
    const res = await call('/any-none', 'SUPER_ADMIN');
    expect(res.statusCode).toBe(200);
  });

  it('admits a role that holds ONE of the listed permissions', async () => {
    const res = await call('/any', ROLE_READ);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('applies the shared *_VIEW <- *_READ implication (ASSET_READ satisfies ASSET_VIEW)', async () => {
    expect((await call('/any-view', ROLE_READ)).statusCode).toBe(200);
    // ...and a role holding neither is still refused on the same route.
    expect((await call('/any-view', ROLE_NONE)).statusCode).toBe(403);
  });

  it('403s a role holding none of them, naming the permissions outside production', async () => {
    const res = await call('/any-none', ROLE_READ);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: 'FORBIDDEN', message: 'Permission denied',
      requiredPermissions: ['USER_CREATE', 'USER_DELETE'], yourRole: ROLE_READ,
    });
  });

  it('a role with no roles row at all holds nothing', async () => {
    const res = await call('/any', ROLE_MISSING);
    expect(res.statusCode).toBe(403);
    expect(res.json().yourRole).toBe(ROLE_MISSING);
  });

  it('in production the refusal names no permission and no role', async () => {
    const res = await inProduction(() => call('/any-none', ROLE_READ));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'Insufficient permissions' });
  });
});

describe('requirePermission in production', () => {
  it('answers the generic refusal (no requiredPermission / yourRole leak)', async () => {
    const res = await inProduction(() => call('/perm', ROLE_NONE));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'Insufficient permissions' });
  });

  it('still admits a role that holds the permission', async () => {
    const res = await inProduction(() => call('/perm', ROLE_READ));
    expect(res.statusCode).toBe(200);
  });
});

describe('requireRole', () => {
  it('admits a listed role and SUPER_ADMIN', async () => {
    expect((await call('/role', ROLE_READ)).statusCode).toBe(200);
    expect((await call('/role', 'SUPER_ADMIN')).statusCode).toBe(200);
  });

  it('refuses an unlisted role with the generic body in production', async () => {
    const res = await inProduction(() => call('/role', ROLE_NONE));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'Insufficient permissions' });
  });

  it('refuses a request with no user, naming the required roles outside production', async () => {
    const res = await call('/role');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', requiredRoles: ['ADMIN', ROLE_READ] });
  });
});

describe('requireSuperAdmin', () => {
  it('admits SUPER_ADMIN only', async () => {
    expect((await call('/sa', 'SUPER_ADMIN')).statusCode).toBe(200);
  });

  it('refuses ADMIN, naming the caller role outside production', async () => {
    const res = await call('/sa', 'ADMIN');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'Super Admin access required', yourRole: 'ADMIN' });
  });

  it('refuses a request with no user at all', async () => {
    const res = await call('/sa');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('answers the generic refusal in production', async () => {
    const res = await inProduction(() => call('/sa', 'ADMIN'));
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'Insufficient permissions' });
  });
});

describe('role-permission cache', () => {
  it('serves the cached permissions until the role is invalidated, then re-reads the row', async () => {
    invalidateRolePermsCache(ROLE_NONE);
    expect(await getRolePerms(ROLE_NONE)).toEqual([]);
    await prisma.role.update({ where: { name: ROLE_NONE }, data: { permissions: ['AUDIT_READ'] } });
    try {
      // Within the 5 s TTL the stale (empty) set is still served: the route refuses.
      expect((await call('/perm', ROLE_NONE)).statusCode).toBe(403);
      invalidateRolePermsCache(ROLE_NONE);
      expect((await call('/perm', ROLE_NONE)).statusCode).toBe(200);
    } finally {
      await prisma.role.update({ where: { name: ROLE_NONE }, data: { permissions: [] } });
      invalidateRolePermsCache(ROLE_NONE);
    }
  });

  it('invalidateRolePermsCache() with no name clears every role', async () => {
    await getRolePerms(ROLE_NONE);
    await prisma.role.update({ where: { name: ROLE_NONE }, data: { permissions: ['USER_CREATE'] } });
    try {
      expect(await getRolePerms(ROLE_NONE)).toEqual([]);
      invalidateRolePermsCache();
      expect(await getRolePerms(ROLE_NONE)).toEqual(['USER_CREATE']);
    } finally {
      await prisma.role.update({ where: { name: ROLE_NONE }, data: { permissions: [] } });
      invalidateRolePermsCache(ROLE_NONE);
    }
  });
});
