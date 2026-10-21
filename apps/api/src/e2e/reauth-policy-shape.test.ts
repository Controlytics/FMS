/**
 * BR-086 + A-02 (operator decisions 2026-10-21) — the re-authentication policy.
 *
 * 1. A policy stored in the LEGACY nested shape ({actions:[{action,roles}]}, e.g.
 *    after restoring an old backup) used to be treated as {} — every §11
 *    password prompt silently OFF. It is now CONVERTED to the rules it describes
 *    and enforced; the deployment check WARNs (re-save to store the new shape).
 * 2. Saving the policy refuses unknown action names and unknown roles (a typo
 *    was stored and simply never matched — a gate the operator believed was on).
 * 3. Action names the code no longer has are hidden from the editing page (it
 *    echoed them back on every save, so they could never be refused).
 *
 * Real Prisma on digilog_test_db; the action-reauth row is snapshot and restored.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { isReauthRequired, getReauthHealth, invalidateReauthCache } from '../lib/reauth-check.js';

const USERNAME = `qa_rpol_${Date.now()}`;
const PASSWORD = 'QaRpol@Test2026';
let app: FastifyInstance;
let token: string;
let existed = false;
let original: unknown;

async function store(value: unknown) {
  await prisma.systemConfig.upsert({
    where: { configKey: 'action-reauth' },
    update: { configValue: value as any },
    create: { configKey: 'action-reauth', configValue: value as any, configType: 'security', requiresReauth: true },
  });
  invalidateReauthCache();
}

describe('re-auth policy shape and validation (BR-086, A-02)', () => {
  beforeAll(async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } });
    existed = !!row; original = row?.configValue;
    await prisma.user.create({
      data: { username: USERNAME, fullName: 'QA reauth policy', passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-rpol-test' },
    });
    app = await buildApp();
    await store({}); // no gate on the save itself while we set up
    token = await loginAs(app, USERNAME, PASSWORD);
  });

  afterAll(async () => {
    if (existed) await store(original);
    else { await prisma.systemConfig.deleteMany({ where: { configKey: 'action-reauth' } }); invalidateReauthCache(); }
    const u = await prisma.user.findUnique({ where: { username: USERNAME } });
    if (u) {
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.passwordHistory.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await app?.close();
  });

  it('a legacy-shape policy is converted and ENFORCED (was: every gate off)', async () => {
    await store({ actions: [
      { action: 'DELETE_USER', roles: ['ADMIN'] },
      { action: 'CREATE_USER', roles: ['ADMIN', 'SUPERVISOR'] },
    ] });
    expect(await isReauthRequired('DELETE_USER', 'ADMIN')).toBe(true);
    expect(await isReauthRequired('CREATE_USER', 'SUPERVISOR')).toBe(true);
    expect(await isReauthRequired('DELETE_USER', 'OPERATOR')).toBe(false);
    const health = await getReauthHealth();
    expect(health).toMatchObject({ legacyShape: true, effectivelyDisabled: false, actionsConfigured: 2 });
  });

  it('the editing page sees the converted policy, without action names the code no longer has', async () => {
    await store({ DELETE_USER: ['ADMIN'], SIGN_REPORT: ['QA'], GENERATE_REPORT: ['QA'] });
    const res = await app.inject({ method: 'GET', url: '/api/config/action-reauth', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const cfg = body.data ?? body;
    expect(cfg.DELETE_USER).toEqual(['ADMIN']);
    expect(cfg).not.toHaveProperty('SIGN_REPORT');
    expect(cfg).not.toHaveProperty('GENERATE_REPORT');
  });

  it('saving refuses unknown action names and unknown roles, and stores nothing', async () => {
    await store({ DELETE_USER: ['ADMIN'] });
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/config/action-reauth', headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PASSWORD }, payload });

    const badAction = await put({ DELETE_USER: ['ADMIN'], DELET_USER: ['ADMIN'] });
    expect(badAction.statusCode).toBe(400);
    expect(badAction.json().message).toMatch(/unknown action\(s\): DELET_USER/);

    const badRole = await put({ DELETE_USER: ['ADMIN', 'GHOST_ROLE'] });
    expect(badRole.statusCode).toBe(400);
    expect(badRole.json().message).toMatch(/unknown role\(s\): GHOST_ROLE/);

    const stored = await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } });
    expect(stored!.configValue).toEqual({ DELETE_USER: ['ADMIN'] });

    const ok = await put({ DELETE_USER: ['ADMIN', 'SUPERVISOR'] });
    expect(ok.statusCode).toBe(200);
  });
});

describe('tablet access validation (A-02)', () => {
  let tApp: FastifyInstance;
  let tToken: string;
  let tExisted = false;
  let tOriginal: unknown;
  const TUSER = `qa_tacc_${Date.now()}`;

  beforeAll(async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
    tExisted = !!row; tOriginal = row?.configValue;
    await prisma.user.create({
      data: { username: TUSER, fullName: 'QA tablet access', passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-tacc-test' },
    });
    tApp = await buildApp();
    tToken = await loginAs(tApp, TUSER, PASSWORD);
  });

  afterAll(async () => {
    if (tExisted) await prisma.systemConfig.update({ where: { configKey: 'tablet-access' }, data: { configValue: tOriginal as any } });
    else await prisma.systemConfig.deleteMany({ where: { configKey: 'tablet-access' } });
    const u = await prisma.user.findUnique({ where: { username: TUSER } });
    if (u) {
      await prisma.session.deleteMany({ where: { userId: u.id } });
      await prisma.passwordHistory.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
    await tApp?.close();
  });

  const put = (payload: unknown) => tApp.inject({ method: 'PUT', url: '/api/config/tablet-access', headers: { authorization: `Bearer ${tToken}`, 'x-reauth-password': PASSWORD }, payload });

  it('refuses a wrong shape, an unknown role, SUPER_ADMIN and unknown features — and stores nothing', async () => {
    await prisma.systemConfig.upsert({
      where: { configKey: 'tablet-access' },
      update: { configValue: { OPERATOR: ['login'] } },
      create: { configKey: 'tablet-access', configValue: { OPERATOR: ['login'] }, configType: 'security' },
    });
    for (const [body, pattern] of [
      [{ OPERATOR: 'yes' }, /OPERATOR must be a list/],
      [{ GHOST_ROLE: ['login'] }, /unknown role GHOST_ROLE/],
      [{ SUPER_ADMIN: ['login'] }, /SUPER_ADMIN cannot be configured/],
      [{ OPERATOR: ['login', 'approvals'] }, /unknown feature\(s\) approvals/],
    ] as const) {
      const res = await put(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().message).toMatch(pattern);
    }
    const stored = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
    expect(stored!.configValue).toEqual({ OPERATOR: ['login'] });
  });

  it('accepts a valid allowlist, and the page never sees roles that no longer exist', async () => {
    expect((await put({ OPERATOR: ['login', 'filter_cleaning', 'logout'], SUPERVISOR: [] })).statusCode).toBe(200);
    await prisma.systemConfig.update({ where: { configKey: 'tablet-access' }, data: { configValue: { OPERATOR: ['login'], DELETED_ROLE: ['login'] } } });
    const res = await tApp.inject({ method: 'GET', url: '/api/config/tablet-access', headers: { authorization: `Bearer ${tToken}` } });
    expect(res.json()).toEqual({ OPERATOR: ['login'] });
  });
});
