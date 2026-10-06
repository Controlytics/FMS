/**
 * e2e — GET /api/config/cleaning-profile-assignment/current (2026-10-06).
 *
 * The tablet caches the block → cleaning-profile map so an OFFLINE scan can
 * resolve the profile. The only endpoint that served it, GET
 * /api/config/cleaning-profile-assignment, needs CONFIG_READ, which no operator
 * role holds — every tablet session logged a 403 on it and the offline cache
 * stayed empty. `/current` returns the same map to any signed-in user; editing
 * stays behind CONFIG_UPDATE.
 *
 * Own role + own user (never the shared `admin`). Pattern: field-ids-current.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { buildApp, loginAs, authGet } from './test-helper.js';

const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
const ROLE = `CPACUR_${SUFFIX}`;
const USERNAME = `CPACUR${SUFFIX}`;
const PASSWORD = 'TestPass@123';

describe('GET /api/config/cleaning-profile-assignment/current', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await prisma.role.create({
      data: {
        name: ROLE, displayName: 'Assignment reader test', hierarchyLevel: 1,
        permissions: ['FILTER_OPERATE'], // deliberately NO CONFIG_READ — the operator's shape
        isSystem: false, createdBy: 'cpa-current-test',
      },
    });
    await prisma.user.create({
      data: {
        username: USERNAME, fullName: 'Assignment Reader', email: `${USERNAME.toLowerCase()}@example.com`,
        passwordHash: await hashPassword(PASSWORD), role: ROLE, status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'cpa-current-test',
      },
    });
    token = await loginAs(app, USERNAME, PASSWORD);
  });

  afterAll(async () => {
    await prisma.session.updateMany({
      where: { user: { username: USERNAME }, isActive: true },
      data: { isActive: false, terminationReason: 'cpa_current_test_cleanup' },
    });
    await prisma.user.updateMany({ where: { username: USERNAME }, data: { status: 'DISABLED' } });
    await prisma.role.updateMany({ where: { name: ROLE }, data: { isActive: false } });
    await app.close();
  });

  it('a role WITHOUT CONFIG_READ reads the assignment map', async () => {
    const res = await authGet(app, '/api/config/cleaning-profile-assignment/current', token);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.mode).toBe('string');
    expect(Array.isArray(body.rules)).toBe(true);
  });

  it('the gated list still needs CONFIG_READ', async () => {
    expect((await authGet(app, '/api/config/cleaning-profile-assignment', token)).statusCode).toBe(403);
  });

  it('is not public — a request with no token is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/cleaning-profile-assignment/current' });
    expect(res.statusCode).toBe(401);
  });
});
