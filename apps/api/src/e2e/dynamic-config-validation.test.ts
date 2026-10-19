/**
 * QA-D003 (2026-10-19) route-level regression: PUT /api/config/dynamic/:key must
 * refuse a body that breaks the def's declared settings, and store nothing.
 *
 * Before the fix, `stage-interlock` accepted `{ enabled: 'yes' }` (the gate then
 * read a truthy string) and `export-limit` accepted `{ maxRecords: -5 }`.
 * Owns its SUPER_ADMIN user; restores both config rows afterwards (digilog_test_db).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs, authPut } from './test-helper.js';
import dynamicConfigRoutes from '../modules/config/dynamic-routes.js';
import { discoverAndRegisterConfigs } from '../lib/config-discovery.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

const USERNAME = 'qa_d003_dyncfg';
const PASSWORD = 'QaD003@Test2026';
const KEYS = ['stage-interlock', 'export-limit'] as const;

let app: FastifyInstance;
let token = '';
const originals = new Map<string, unknown>();

const stored = async (key: string) =>
  (await prisma.systemConfig.findUnique({ where: { configKey: key } }))?.configValue ?? null;

describe('PUT /api/config/dynamic/:key validates declared settings (QA-D003)', () => {
  beforeAll(async () => {
    for (const k of KEYS) originals.set(k, await stored(k));
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: USERNAME, fullName: 'QA D003 dynamic config', passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-d003-test' },
    });
    await discoverAndRegisterConfigs();
    app = await buildApp([{ plugin: dynamicConfigRoutes, prefix: '/api/config' }]);
    token = await loginAs(app, USERNAME, PASSWORD);
  }, 60_000);

  afterAll(async () => {
    for (const [k, v] of originals) {
      if (v === null) await prisma.systemConfig.deleteMany({ where: { configKey: k } });
      else await prisma.systemConfig.update({ where: { configKey: k }, data: { configValue: v as any } });
    }
    await app?.close();
  });

  it('refuses a non-boolean stage-interlock switch and stores nothing', async () => {
    const before = await stored('stage-interlock');
    const res = await authPut(app, '/api/config/dynamic/stage-interlock', token, { ...(before as object ?? {}), enabled: 'yes' }, PASSWORD);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(await stored('stage-interlock')).toEqual(before);
  });

  it('refuses an out-of-range export limit and stores nothing', async () => {
    const before = await stored('export-limit');
    const res = await authPut(app, '/api/config/dynamic/export-limit', token, { ...(before as object ?? {}), maxRecords: -5 }, PASSWORD);
    expect(res.statusCode).toBe(400);
    expect(await stored('export-limit')).toEqual(before);
  });

  it('still saves a valid body', async () => {
    const body = { enabled: false, requireDifferentApprover: true, washOutApproverRole: 'ADMIN', dryOutApproverRole: 'ADMIN' };
    const res = await authPut(app, '/api/config/dynamic/stage-interlock', token, body, PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(await stored('stage-interlock')).toMatchObject(body);
  });
});
