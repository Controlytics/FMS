/**
 * e2e — the Retirement List / Replacement List View permissions (2026-10-01).
 *
 * Both pages used to ride on "View Filters" (ASSET_VIEW / ASSET_READ), so the
 * Permissions tab had no View toggle of their own. Each page now has one, and
 * its data feed accepts that permission:
 *
 *   GET /api/filters/retirements  — ASSET_READ or RETIREMENT_LIST_VIEW
 *   GET /api/filters/replacements — ASSET_READ or REPLACEMENT_LIST_VIEW
 *
 * ASSET_READ stays as an alternate because the Filter Lifecycle Report, the
 * cycle timeline and the tablet read the same two feeds.
 *
 * Own roles + own users (never the shared `admin`), so the file is safe under
 * single-fork and multi-fork runs alike.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import authPlugin from '../plugins/auth.js';
import rbacPlugin from '../plugins/rbac.js';
import authRoutes from '../modules/auth/routes.js';
import filterOperationsRoutes from '../modules/filter-operations/routes.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { AppError } from '../lib/errors.js';
import { loginAs } from './test-helper.js';

const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
const TEST_PASSWORD = 'TestPass@123';

// role key → the ONLY permissions that role holds.
const ROLES = {
  RET: ['RETIREMENT_LIST_VIEW'],
  REP: ['REPLACEMENT_LIST_VIEW'],
  ASSET: ['ASSET_READ'],
  NONE: ['DASHBOARD_VIEW'],
} as const;
type RoleKey = keyof typeof ROLES;

const roleName = (k: RoleKey) => `LV_${k}_${SUFFIX}`;
const userName = (k: RoleKey) => `LV${k}${SUFFIX}`;

async function buildListViewApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
  await app.ready();
  return app;
}

describe('Retirement / Replacement list View permissions', () => {
  let app: FastifyInstance;
  const tokens = {} as Record<RoleKey, string>;

  const get = (url: string, k: RoleKey) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokens[k]}` } });

  beforeAll(async () => {
    app = await buildListViewApp();
    const passwordHash = await hashPassword(TEST_PASSWORD);

    for (const k of Object.keys(ROLES) as RoleKey[]) {
      await prisma.role.create({
        data: {
          name: roleName(k),
          displayName: `List view test ${k}`,
          hierarchyLevel: 1,
          permissions: [...ROLES[k]],
          isSystem: false,
          createdBy: 'list-view-test',
        },
      });
      await prisma.user.create({
        data: {
          username: userName(k),
          fullName: `List View ${k}`,
          email: `${userName(k).toLowerCase()}@example.com`,
          passwordHash,
          role: roleName(k),
          status: 'ENABLED',
          forcePasswordChange: false,
          isTemporaryPassword: false,
          createdBy: 'list-view-test',
        },
      });
      tokens[k] = await loginAs(app, userName(k), TEST_PASSWORD);
    }
  });

  afterAll(async () => {
    const usernames = (Object.keys(ROLES) as RoleKey[]).map(userName);
    await prisma.session.updateMany({
      where: { user: { username: { in: usernames } }, isActive: true },
      data: { isActive: false, terminationReason: 'list_view_test_cleanup' },
    });
    // Users stay (deleting cascades into audit-linked tables); disable them and
    // their roles so nothing from this file is usable afterwards.
    await prisma.user.updateMany({ where: { username: { in: usernames } }, data: { status: 'DISABLED' } });
    await prisma.role.updateMany({
      where: { name: { in: (Object.keys(ROLES) as RoleKey[]).map(roleName) } },
      data: { isActive: false },
    });
    await app.close();
  });

  it('RETIREMENT_LIST_VIEW alone opens the retirement feed — and not the replacement feed', async () => {
    const ret = await get('/api/filters/retirements', 'RET');
    expect(ret.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(ret.body))).toBe(true);

    expect((await get('/api/filters/replacements', 'RET')).statusCode).toBe(403);
  });

  it('REPLACEMENT_LIST_VIEW alone opens the replacement feed — and not the retirement feed', async () => {
    const rep = await get('/api/filters/replacements', 'REP');
    expect(rep.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(rep.body))).toBe(true);

    expect((await get('/api/filters/retirements', 'REP')).statusCode).toBe(403);
  });

  it('ASSET_READ still opens both feeds (lifecycle report, cycle timeline, tablet)', async () => {
    expect((await get('/api/filters/retirements', 'ASSET')).statusCode).toBe(200);
    expect((await get('/api/filters/replacements', 'ASSET')).statusCode).toBe(200);
  });

  it('a role holding none of the three is refused on both feeds', async () => {
    expect((await get('/api/filters/retirements', 'NONE')).statusCode).toBe(403);
    expect((await get('/api/filters/replacements', 'NONE')).statusCode).toBe(403);
  });

  it('a View permission is not a write permission: retire / replace stay refused', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [k, path] of [['RET', 'retire'], ['REP', 'replace']] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/filters/${id}/${path}`,
        headers: { authorization: `Bearer ${tokens[k]}` },
        payload: { remarks: 'not allowed' },
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
