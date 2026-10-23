/**
 * DB-free behaviour tests for plugins/rbac.ts, through a real Fastify instance
 * (prisma mocked). Written against the Stryker survivors of 2026-10-23: status
 * codes, error codes, the production body that must not leak the required
 * permission or the caller's role, the SUPER_ADMIN bypass, the 5-second role
 * cache and the plugin's registration contract. Listed in vitest.stryker.config.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const h = vi.hoisted(() => ({ roleFindFirst: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { role: { findFirst: h.roleFindFirst } } }));

import rbacPlugin, { getRolePerms, invalidateRolePermsCache } from '../rbac.js';

/** Role rows the mock "database" holds, answered only for a lookup BY NAME. */
const ROLES: Record<string, { permissions: string[] | null }> = {
  READER: { permissions: ['AUDIT_READ', 'ASSET_READ'] },
  EMPTY: { permissions: [] },
  NULLPERMS: { permissions: null },
};

const fakeAuth = fp(async (a: FastifyInstance) => {
  a.addHook('onRequest', async (req) => {
    const role = req.headers['x-role'];
    (req as any).user = typeof role === 'string' ? { sub: 'u', role } : undefined;
  });
}, { name: 'auth' });

let app: FastifyInstance;
const call = (url: string, role?: string) => app.inject({ method: 'GET', url, headers: role ? { 'x-role': role } : {} });

async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { return await fn(); } finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
}
const GENERIC = { error: 'FORBIDDEN', message: 'Insufficient permissions' };

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(fakeAuth);
  await app.register(rbacPlugin);
  app.get('/perm', { preHandler: [app.requirePermission('AUDIT_READ')] }, async () => ({ ok: true }));
  app.get('/view', { preHandler: [app.requirePermission('ASSET_VIEW')] }, async () => ({ ok: true }));
  app.get('/any', { preHandler: [app.requireAnyPermission('USER_CREATE', 'AUDIT_READ')] }, async () => ({ ok: true }));
  app.get('/any-none', { preHandler: [app.requireAnyPermission('USER_CREATE', 'USER_DELETE')] }, async () => ({ ok: true }));
  app.get('/role', { preHandler: [app.requireRole('ADMIN', 'READER')] }, async () => ({ ok: true }));
  app.get('/sa', { preHandler: [app.requireSuperAdmin()] }, async () => ({ ok: true }));
  await app.ready();
});
afterAll(async () => { await app.close(); });

beforeEach(() => {
  h.roleFindFirst.mockReset();
  h.roleFindFirst.mockImplementation(async (args: any) => {
    const name = args?.where?.name;
    return typeof name === 'string' && name in ROLES ? ROLES[name] : null;
  });
  invalidateRolePermsCache();
});

describe('requirePermission', () => {
  it('no user: 401 UNAUTHORIZED / Not authenticated', async () => {
    const res = await call('/perm');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
  });

  it('SUPER_ADMIN passes without any role lookup', async () => {
    expect((await call('/perm', 'SUPER_ADMIN')).statusCode).toBe(200);
    expect(h.roleFindFirst).not.toHaveBeenCalled();
  });

  it('a role holding the permission passes; the *_READ -> *_VIEW implication applies', async () => {
    expect((await call('/perm', 'READER')).statusCode).toBe(200);
    expect((await call('/view', 'READER')).statusCode).toBe(200);
  });

  it('a role without it: 403 naming the permission and role outside production', async () => {
    const res = await call('/perm', 'EMPTY');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'Permission denied', requiredPermission: 'AUDIT_READ', yourRole: 'EMPTY' });
  });

  it('in production the refusal names nothing', async () => {
    const res = await inProduction(() => call('/perm', 'EMPTY'));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(GENERIC);
  });

  it('a role with no row, or a null permission list, holds nothing', async () => {
    expect((await call('/perm', 'GHOST')).statusCode).toBe(403);
    expect((await call('/perm', 'NULLPERMS')).statusCode).toBe(403);
  });
});

describe('requireAnyPermission', () => {
  it('no user: 401 UNAUTHORIZED', async () => {
    const res = await call('/any');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
  });

  it('SUPER_ADMIN passes with no lookup; a role holding ONE of them passes', async () => {
    expect((await call('/any', 'SUPER_ADMIN')).statusCode).toBe(200);
    expect(h.roleFindFirst).not.toHaveBeenCalled();
    expect((await call('/any', 'READER')).statusCode).toBe(200);
  });

  it('holding none: 403 listing them outside production, generic in production', async () => {
    const dev = await call('/any-none', 'READER');
    expect(dev.statusCode).toBe(403);
    expect(dev.json()).toEqual({ error: 'FORBIDDEN', message: 'Permission denied', requiredPermissions: ['USER_CREATE', 'USER_DELETE'], yourRole: 'READER' });
    const prod = await inProduction(() => call('/any-none', 'READER'));
    expect(prod.statusCode).toBe(403);
    expect(prod.json()).toEqual(GENERIC);
  });
});

describe('requireRole', () => {
  it('a listed role passes, and SUPER_ADMIN passes though it is not listed', async () => {
    expect((await call('/role', 'READER')).statusCode).toBe(200);
    expect((await call('/role', 'SUPER_ADMIN')).statusCode).toBe(200);
  });

  it('an unlisted role: 403 naming the roles outside production, generic in production', async () => {
    const dev = await call('/role', 'EMPTY');
    expect(dev.statusCode).toBe(403);
    expect(dev.json()).toEqual({ error: 'FORBIDDEN', message: 'Permission denied', requiredRoles: ['ADMIN', 'READER'], yourRole: 'EMPTY' });
    const prod = await inProduction(() => call('/role', 'EMPTY'));
    expect(prod.json()).toEqual(GENERIC);
  });

  it('no user at all is refused (403), never let through', async () => {
    const res = await call('/role');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});

describe('requireSuperAdmin', () => {
  it('SUPER_ADMIN only', async () => {
    expect((await call('/sa', 'SUPER_ADMIN')).statusCode).toBe(200);
    const dev = await call('/sa', 'ADMIN');
    expect(dev.statusCode).toBe(403);
    expect(dev.json()).toEqual({ error: 'FORBIDDEN', message: 'Super Admin access required', yourRole: 'ADMIN' });
    const prod = await inProduction(() => call('/sa', 'ADMIN'));
    expect(prod.json()).toEqual(GENERIC);
    expect((await call('/sa')).statusCode).toBe(403);
  });
});

describe('getRolePerms — a 5-second per-role cache', () => {
  it('looks the role up by name, asking only for its permissions; a missing role holds []', async () => {
    expect(await getRolePerms('READER')).toEqual(['AUDIT_READ', 'ASSET_READ']);
    expect(h.roleFindFirst).toHaveBeenCalledWith({ where: { name: 'READER' }, select: { permissions: true } });
    expect(await getRolePerms('GHOST')).toEqual([]);
  });

  it('serves the cached list inside 5 s and re-reads after', async () => {
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(5_000_000);
      await getRolePerms('READER');
      now.mockReturnValue(5_000_000 + 4_999);
      await getRolePerms('READER');
      expect(h.roleFindFirst).toHaveBeenCalledTimes(1);
      now.mockReturnValue(5_000_000 + 5_000);
      await getRolePerms('READER');
      expect(h.roleFindFirst).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it('invalidating one role drops only that role; invalidating with no name drops all', async () => {
    await getRolePerms('READER');
    await getRolePerms('EMPTY');
    invalidateRolePermsCache('READER');
    await getRolePerms('READER');
    await getRolePerms('EMPTY');
    expect(h.roleFindFirst.mock.calls.map((c) => c[0].where.name)).toEqual(['READER', 'EMPTY', 'READER']);
    invalidateRolePermsCache();
    await getRolePerms('EMPTY');
    expect(h.roleFindFirst).toHaveBeenCalledTimes(4);
  });
});

describe('plugin registration', () => {
  it('declares its dependency on the auth plugin: without it, registration fails', async () => {
    const bare = Fastify({ logger: false });
    await expect(bare.register(rbacPlugin).ready()).rejects.toThrow(/auth/);
    await bare.close().catch(() => undefined);
  });

  it('registers under the name "rbac", so plugins that depend on it can load', async () => {
    const a = Fastify({ logger: false });
    await a.register(fakeAuth);
    await a.register(rbacPlugin);
    await a.register(fp(async () => undefined, { name: 'needs-rbac', dependencies: ['rbac'] }));
    await expect(a.ready()).resolves.toBeDefined();
    expect(typeof a.requireAnyPermission).toBe('function');
    expect(typeof a.requireSuperAdmin).toBe('function');
    await a.close();
  });
});
