/**
 * e2e tests for the Backup Format public-read endpoint.
 *
 * The Backup & Restore page preselects the configured default format. The
 * caller there holds BACKUP_EXPORT / BACKUP_RESTORE, which do NOT imply
 * CONFIG_READ — so reading this from the admin-gated route would 403 for a
 * backup operator and silently fall back to the built-in default, making the
 * configuration look ignored. Hence the `/current` endpoint, and hence the
 * load-bearing assertion below: a non-SUPER_ADMIN must get 200 + the real value.
 *
 * App builder / unique-user notes follow the same pattern (and for the same
 * reasons) as block-change-approval-current.e2e.test.ts — see its header.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from '../../../plugins/auth.js';
import rbacPlugin from '../../../plugins/rbac.js';
import authRoutes from '../../auth/routes.js';
import configRoutes from '../routes.js';
import dynamicConfigRoutes from '../dynamic-routes.js';
import { discoverAndRegisterConfigs } from '../../../lib/config-discovery.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { AppError } from '../../../lib/errors.js';
import { loginAs } from '../../../e2e/test-helper.js';

const SUFFIX = Date.now().toString(36).slice(-4).toUpperCase();
const SA_USERNAME = `BFSA${SUFFIX}`.slice(0, 16).toUpperCase();
const OP_USERNAME = `BFOP${SUFFIX}`.slice(0, 16).toUpperCase();
const TEST_PASSWORD = 'BkpFmt@Test#999';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(authPlugin);
  await app.register(rbacPlugin);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: err.message || 'Internal Server Error' });
  });

  // MUST run before dynamicConfigRoutes registers — it iterates getAll() at
  // registration time, so the def must already be in the registry.
  await discoverAndRegisterConfigs();

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(configRoutes, { prefix: '/api/config' });
  await app.register(dynamicConfigRoutes, { prefix: '/api/config' });

  await app.ready();
  return app;
}

async function provision(username: string, role: string) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash, role, status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
      failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null,
    },
    create: {
      username,
      fullName: `Backup Format Test ${role}`,
      email: `${username.toLowerCase()}@bkpfmt-test.local`,
      passwordHash, role, status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
      createdBy: 'backup-format-test',
    },
  });
}

describe('Backup Format — public /current endpoint', () => {
  let app: FastifyInstance;
  let saHeaders: Record<string, string>;
  let opHeaders: Record<string, string>;
  let originalConfig: any;

  const setFormat = async (defaultFormat: string) => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/backup-format',
      headers: saHeaders,
      payload: { defaultFormat },
    });
    expect(res.statusCode).toBe(200);
  };

  beforeAll(async () => {
    app = await buildApp();
    await provision(SA_USERNAME, 'SUPER_ADMIN');
    await provision(OP_USERNAME, 'OPERATOR');

    saHeaders = { authorization: `Bearer ${await loginAs(app, SA_USERNAME, TEST_PASSWORD)}` };
    opHeaders = { authorization: `Bearer ${await loginAs(app, OP_USERNAME, TEST_PASSWORD)}` };

    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'backup-format' } });
    originalConfig = row?.configValue ?? null;
  });

  afterAll(async () => {
    // Restore the pre-test config so this doesn't leak into other suites.
    try {
      if (originalConfig) {
        await prisma.systemConfig.update({
          where: { configKey: 'backup-format' },
          data: { configValue: originalConfig },
        });
      } else {
        await prisma.systemConfig.deleteMany({ where: { configKey: 'backup-format' } });
      }
    } catch { /* best-effort — don't mask test failures */ }
    try { await app.close(); } catch { /* swallow */ }
  });

  it('defaults to dump before anything has been configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/backup-format/current',
      headers: saHeaders,
    });
    expect(res.statusCode).toBe(200);
    // 2026-08-08 made `dump` (pg_dump custom archive) the default — it is the
    // only format that carries the SCHEMA and so can rebuild from nothing. This
    // assertion still expected the old data-only default and had been failing
    // ever since; the code is right, the test was stale.
    expect(res.json().defaultFormat).toBe('dump');
  });

  // ── The load-bearing case: the Backup & Restore page's actual caller ────────
  it('a non-SUPER_ADMIN reads the real configured format from /current', async () => {
    await setFormat('bak');

    const res = await app.inject({
      method: 'GET',
      url: '/api/config/backup-format/current',
      headers: opHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().defaultFormat).toBe('bak');
  });

  it('/current tracks a change back to json', async () => {
    await setFormat('json');

    const res = await app.inject({
      method: 'GET',
      url: '/api/config/backup-format/current',
      headers: opHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().defaultFormat).toBe('json');
  });

  it('rejects a non-restorable format — sql/csv cannot be restored through the app', async () => {
    for (const bad of ['sql', 'csv', 'zip', '']) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/config/backup-format',
        headers: saHeaders,
        payload: { defaultFormat: bad },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/backup-format/current' });
    expect(res.statusCode).toBe(401);
  });
});
