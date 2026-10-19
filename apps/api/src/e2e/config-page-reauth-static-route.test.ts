/**
 * R-02 (QA 2026-10-19): PUT /api/config/pagination (and export-limit /
 * backup-format, the other defs served by the static configEndpoint) must
 * enforce the def's declared re-auth row, UPDATE_CONFIG_PAGE.
 *
 * Those defs declare `requiresReauth: true, reauthAction: 'UPDATE_CONFIG_PAGE'`
 * and the DYNAMIC route enforces it, but the static route only knew four keys,
 * so with the row switched on the same setting was saved unsigned here.
 *
 * Owns its SUPER_ADMIN user; switches the UPDATE_CONFIG_PAGE row on for
 * SUPER_ADMIN and restores the action-reauth + pagination rows afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs, authPut } from './test-helper.js';
import { discoverAndRegisterConfigs } from '../lib/config-discovery.js';
import { invalidateReauthCache } from '../lib/reauth-check.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

const USERNAME = 'qa_r02_cfgpage';
const PASSWORD = 'QaR02@Test2026';
let app: FastifyInstance;
let token = '';
let savedReauth: unknown = null;
let savedPagination: unknown = null;

const row = async (k: string) => (await prisma.systemConfig.findUnique({ where: { configKey: k } }))?.configValue ?? null;
async function put(k: string, v: unknown) {
  if (v === null) await prisma.systemConfig.deleteMany({ where: { configKey: k } });
  else await prisma.systemConfig.upsert({ where: { configKey: k }, update: { configValue: v as any }, create: { configKey: k, configValue: v as any, configType: 'security' } });
}

describe('static config PUT enforces the def re-auth row (R-02)', () => {
  beforeAll(async () => {
    savedReauth = await row('action-reauth');
    savedPagination = await row('pagination');
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: USERNAME, fullName: 'QA R-02 config page', passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-r02-test' },
    });
    const base = (savedReauth && typeof savedReauth === 'object' && !Array.isArray(savedReauth) && !('actions' in (savedReauth as any))) ? savedReauth as Record<string, unknown> : {};
    await put('action-reauth', { ...base, UPDATE_CONFIG_PAGE: ['SUPER_ADMIN'] });
    invalidateReauthCache();
    await discoverAndRegisterConfigs();
    app = await buildApp();
    token = await loginAs(app, USERNAME, PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await put('action-reauth', savedReauth);
    await put('pagination', savedPagination);
    invalidateReauthCache();
    await app?.close();
  });

  const body = { limit: 100, count: 3, options: [10, 25, 50] };

  it('refuses an unsigned save with 401 REAUTH_REQUIRED and writes nothing', async () => {
    const before = await row('pagination');
    const res = await authPut(app, '/api/config/pagination', token, body);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('REAUTH_REQUIRED');
    expect(await row('pagination')).toEqual(before);
  });

  it('saves with the password', async () => {
    const res = await authPut(app, '/api/config/pagination', token, body, PASSWORD);
    expect(res.statusCode).toBe(200);
  });

  // C-01: the def says requiredRole SUPER_ADMIN; the static route let any
  // CONFIG_UPDATE holder (ADMIN) save it.
  it('refuses an ADMIN (def requiredRole SUPER_ADMIN) and writes nothing', async () => {
    const ADMIN_USER = 'qa_c01_admin';
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.upsert({
      where: { username: ADMIN_USER },
      update: { passwordHash, role: 'ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: ADMIN_USER, fullName: 'QA C-01 admin', passwordHash, role: 'ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-c01-test' },
    });
    const adminToken = await loginAs(app, ADMIN_USER, PASSWORD);
    const before = await row('pagination');
    for (const url of ['/api/config/pagination', '/api/config/export-limit', '/api/config/backup-format']) {
      const res = await authPut(app, url, adminToken, {}, PASSWORD);
      expect(res.statusCode, url).toBe(403);
    }
    expect(await row('pagination')).toEqual(before);
  });
});
