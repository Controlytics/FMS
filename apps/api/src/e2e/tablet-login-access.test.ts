// 2026-10-13: a tablet login for a role without tablet access must be refused
// BEFORE the server touches the user's existing session. The tablet's
// SESSION_CONFLICT auto-retry signs in with force:true, so the old order
// (sign in, then ask /tablet-access/my-features) ended the user's WEB session
// and only then refused the tablet.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { buildApp, authGet } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

const PW = 'Tablet@Test1';
const QA_USER = 'e2e_tab_qa';
const OP_USER = 'e2e_tab_op';

async function login(app: FastifyInstance, username: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: PW, ...extra } });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

describe('tablet login refuses a role without tablet access before touching sessions', () => {
  let app: FastifyInstance;
  let savedConfig: unknown;

  beforeAll(async () => {
    app = await buildApp();
    const hash = await hashPassword(PW);
    for (const [username, role] of [[QA_USER, 'QA'], [OP_USER, 'OPERATOR']]) {
      await prisma.user.upsert({
        where: { username },
        update: { passwordHash: hash, role, status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockoutUntil: null },
        create: { username, fullName: username, passwordHash: hash, role, forcePasswordChange: false, isTemporaryPassword: false },
      });
    }
    await prisma.session.updateMany({
      where: { isActive: true, user: { username: { in: [QA_USER, OP_USER] } } },
      data: { isActive: false, terminationReason: 'test_cleanup' },
    });
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
    savedConfig = row?.configValue ?? null;
    // The live shape: QA configured with no features, OPERATOR allowed to log in.
    const value = { QA: [], OPERATOR: ['login', 'filter_cleaning', 'logout'] };
    await prisma.systemConfig.upsert({
      where: { configKey: 'tablet-access' },
      update: { configValue: value },
      create: { configKey: 'tablet-access', configValue: value, configType: 'security' },
    });
  });

  afterAll(async () => {
    if (savedConfig === null) await prisma.systemConfig.deleteMany({ where: { configKey: 'tablet-access' } });
    else await prisma.systemConfig.update({ where: { configKey: 'tablet-access' }, data: { configValue: savedConfig as object } });
    await prisma.session.updateMany({
      where: { isActive: true, user: { username: { in: [QA_USER, OP_USER] } } },
      data: { isActive: false, terminationReason: 'test_cleanup' },
    });
    await prisma.user.updateMany({ where: { username: { in: [QA_USER, OP_USER] } }, data: { status: 'DISABLED' } });
    await app.close();
  });

  it('QA signed in on the web keeps the web session when the tablet (force) is refused', async () => {
    const web = await login(app, QA_USER);
    expect(web.status).toBe(200);

    const before = (await prisma.auditTrail.aggregate({ _max: { chainPosition: true } }))._max.chainPosition ?? 0n;
    // Exactly what the tablet sends on its SESSION_CONFLICT auto-retry.
    const tab = await login(app, QA_USER, { force: true, client: 'tablet' });
    expect(tab.status).toBe(403);
    expect(tab.body.error).toBe('TABLET_ACCESS_DENIED');
    expect(tab.body.message).toBe("You don't have access to log in on the tablet.");
    expect(tab.body.token).toBeUndefined();

    const me = await authGet(app, '/api/auth/me', web.body.token);
    expect(me.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { username: QA_USER } });
    // Only rows written by the tablet attempt itself.
    const rows = await prisma.auditTrail.findMany({
      where: { userId: QA_USER, chainPosition: { gt: before } }, orderBy: { chainPosition: 'asc' },
    });
    expect(rows.map((r) => r.action)).toEqual(['LOGIN_FAILED']);
    expect((rows[0].afterValue as any)?.reason).toBe('TABLET_ACCESS_DENIED');
    expect(user.status).toBe('ENABLED');
  });

  it('QA with no web session is refused too, without a SESSION_CONFLICT first', async () => {
    await prisma.session.updateMany({ where: { isActive: true, user: { username: QA_USER } }, data: { isActive: false, terminationReason: 'test_cleanup' } });
    const tab = await login(app, QA_USER, { client: 'tablet' });
    expect(tab.status).toBe(403);
    expect(tab.body.error).toBe('TABLET_ACCESS_DENIED');
    expect(await prisma.session.count({ where: { isActive: true, user: { username: QA_USER } } })).toBe(0);
  });

  it('an allowed role (OPERATOR) still signs in on the tablet', async () => {
    const tab = await login(app, OP_USER, { client: 'tablet' });
    expect(tab.status).toBe(200);
    expect(tab.body.token).toBeTruthy();
  });

  it('a web login (no client) is not affected by tablet access', async () => {
    await prisma.session.updateMany({ where: { isActive: true, user: { username: QA_USER } }, data: { isActive: false, terminationReason: 'test_cleanup' } });
    const web = await login(app, QA_USER);
    expect(web.status).toBe(200);
  });
});
