import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, loginAs, authGet, authPut, ADMIN_PASSWORD } from './test-helper.js';
import { prisma } from '../lib/prisma.js';

/**
 * The configuration access matrix decides which config module each role may
 * open. The 2026-05-04 web-routes review (H1) called that out — "saving it
 * without reauth meant any user with CONFIG_UPDATE could rebind every config
 * tab to every role" — and the fix landed on the FRONTEND only
 * (`access-matrix.tsx` wraps its save in `reauth.execute`). The endpoint itself
 * checked nothing until 2026-09-03, so the electronic signature was a UI
 * convention that any direct API call skipped.
 *
 * The gate is `enforceReauthAlways`, not the config-driven `enforceReauth`,
 * because the admin-managed policy cannot cover this route: `UPDATE_ROLE_CONFIG`
 * is configured for SUPERVISOR / PROJECT_LEADER, while the roles that hold
 * CONFIG_UPDATE — and can therefore reach it — are ADMIN and SUPER_ADMIN.
 */
describe('PUT /api/config/access-matrix requires a signature', () => {
  let app: FastifyInstance;
  let token: string;
  let original: unknown;

  beforeAll(async () => {
    app = await buildApp();
    token = await loginAs(app);
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'access-matrix' } });
    original = row?.configValue ?? {};
  });

  afterAll(async () => {
    // Restore whatever the DB held, so this file leaves no policy behind.
    if (original !== undefined) {
      await prisma.systemConfig.upsert({
        where: { configKey: 'access-matrix' },
        update: { configValue: original as any },
        create: { configKey: 'access-matrix', configValue: original as any, configType: 'security' },
      });
    }
    await app.close();
  });

  const read = async () => {
    const res = await authGet(app, '/api/config/access-matrix', token);
    return JSON.parse(res.body) as Record<string, string[]>;
  };

  it('401s REAUTH_REQUIRED without a password, even for SUPER_ADMIN', async () => {
    const before = await read();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/access-matrix',
      headers: { authorization: `Bearer ${token}` },
      payload: { help: ['OPERATOR'] },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('REAUTH_REQUIRED');
    // The gate runs BEFORE the write — an unsigned call must change nothing.
    expect(await read()).toEqual(before);
  });

  it('401s REAUTH_FAILED on a wrong password and still writes nothing', async () => {
    const before = await read();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/access-matrix',
      headers: { authorization: `Bearer ${token}`, 'x-reauth-password': 'Definitely@Wrong9' },
      payload: { help: ['OPERATOR'] },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('REAUTH_FAILED');
    expect(await read()).toEqual(before);
  });

  it('succeeds with the password and applies the change', async () => {
    const before = await read();
    const next = { ...before, help: ['OPERATOR'] };

    const res = await authPut(app, '/api/config/access-matrix', token, next, ADMIN_PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(await read()).toEqual(next);

    // …and restore, so the rest of the suite sees the matrix it started with.
    await authPut(app, '/api/config/access-matrix', token, before, ADMIN_PASSWORD);
    expect(await read()).toEqual(before);
  });

  it('records the signature and the change as two audit rows', async () => {
    const before = await read();
    const at = new Date();

    await authPut(app, '/api/config/access-matrix', token, { ...before, help: ['QA'] }, ADMIN_PASSWORD);
    await authPut(app, '/api/config/access-matrix', token, before, ADMIN_PASSWORD);

    const rows = await prisma.auditTrail.findMany({
      where: { timestamp: { gte: at }, action: { in: ['REAUTH_SUCCESS', 'CONFIG_CHANGED'] } },
      select: { action: true, targetId: true },
    });

    // The signature is its own row (2026-09-03) — before that a re-auth wrote
    // nothing at all, so a signed config change looked identical to an unsigned one.
    expect(rows.some((r) => r.action === 'REAUTH_SUCCESS')).toBe(true);
    expect(rows.some((r) => r.action === 'CONFIG_CHANGED' && r.targetId === 'access-matrix')).toBe(true);
  });

  it('still serves the matrix on GET without a password', async () => {
    // Reading who may open what is not a signed act; only changing it is.
    const res = await authGet(app, '/api/config/access-matrix', token);
    expect(res.statusCode).toBe(200);
  });
});
