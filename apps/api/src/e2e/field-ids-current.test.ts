/**
 * e2e — GET /api/config/field-ids/current (2026-10-01).
 *
 * Field labels are read on every page (`useFieldLabels`) and warmed by the
 * tablet. The only endpoint that served them, GET /api/config/field-ids, has
 * needed CONFIG_READ since 2026-05-26, so every role without it got a 403 on
 * each page load and never saw an admin's renamed labels. `/current` returns
 * the labels — and only the labels — to any signed-in user.
 *
 * Own role + own user (never the shared `admin`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { buildApp, loginAs, authGet } from './test-helper.js';

const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
const ROLE = `FLDCUR_${SUFFIX}`;
const USERNAME = `FLDCUR${SUFFIX}`;
const PASSWORD = 'TestPass@123';

describe('GET /api/config/field-ids/current', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await prisma.role.create({
      data: {
        name: ROLE, displayName: 'Field labels test', hierarchyLevel: 1,
        permissions: ['DASHBOARD_VIEW'], // deliberately NO CONFIG_READ
        isSystem: false, createdBy: 'field-ids-current-test',
      },
    });
    await prisma.user.create({
      data: {
        username: USERNAME, fullName: 'Field Labels Reader', email: `${USERNAME.toLowerCase()}@example.com`,
        passwordHash: await hashPassword(PASSWORD), role: ROLE, status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'field-ids-current-test',
      },
    });
    token = await loginAs(app, USERNAME, PASSWORD);
  });

  afterAll(async () => {
    await prisma.session.updateMany({
      where: { user: { username: USERNAME }, isActive: true },
      data: { isActive: false, terminationReason: 'field_ids_test_cleanup' },
    });
    await prisma.user.updateMany({ where: { username: USERNAME }, data: { status: 'DISABLED' } });
    await prisma.role.updateMany({ where: { name: ROLE }, data: { isActive: false } });
    await app.close();
  });

  it('a role WITHOUT CONFIG_READ reads the labels', async () => {
    const res = await authGet(app, '/api/config/field-ids/current', token);
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(typeof rows[0].fieldId).toBe('string');
    expect(typeof rows[0].displayName).toBe('string');
  });

  it('returns the label and nothing else — no module, description, editor or timestamps', async () => {
    const rows = JSON.parse((await authGet(app, '/api/config/field-ids/current', token)).body);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['displayName', 'fieldId']);
  });

  it('the full list still needs CONFIG_READ', async () => {
    expect((await authGet(app, '/api/config/field-ids', token)).statusCode).toBe(403);
  });

  it('is not public — a request with no token is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/field-ids/current' });
    expect(res.statusCode).toBe(401);
  });
});
