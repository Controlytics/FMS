/**
 * e2e tests for AHU Cleaning Completion Process config + reader.
 *
 * Task 1 of the AHU Completion Process feature:
 *   - GET /api/config/ahu-completion-process/current → { mode } (public, auth only)
 *   - PUT /api/config/dynamic/ahu-completion-process → persists mode (SUPER_ADMIN)
 *
 * App builder note
 * ----------------
 * The shared buildApp() in test-helper.ts does NOT register dynamicConfigRoutes
 * (required for the PUT test) nor does it call discoverAndRegisterConfigs()
 * (required so the registry knows about ahu-completion-process before
 * dynamic-routes.ts iterates getAll() at registration time).
 * This file builds its own lean Fastify instance following the same pattern
 * as phase4-perms-themes-reports.test.ts.
 *
 * Unique SUPER_ADMIN
 * ------------------
 * Provisions its own user in beforeAll (username derived from this file's name)
 * to avoid contending with the shared `admin` session. Pattern from phase5 test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from '../../../plugins/auth.js';
import rbacPlugin from '../../../plugins/rbac.js';
import authRoutes from '../../auth/routes.js';
import configRoutes from '../../config/routes.js';
import dynamicConfigRoutes from '../../config/dynamic-routes.js';
import { discoverAndRegisterConfigs } from '../../../lib/config-discovery.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { AppError } from '../../../lib/errors.js';
import { loginAs } from '../../../e2e/test-helper.js';

// ── Unique test user ────────────────────────────────────────────────────────
// Derived from this file's name so it never clashes with the shared `admin`
// or any other test file's fixture user.
const SUFFIX = Date.now().toString(36).slice(-4).toUpperCase();
const AHU_GATE_USERNAME = `AHUGT${SUFFIX}`.slice(0, 16).toUpperCase();
const AHU_GATE_PASSWORD = 'AhuGate@Test#999';

// ── Local app builder ───────────────────────────────────────────────────────
async function buildAhuApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { keywords: ['example'] } },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  await app.register(authPlugin);
  await app.register(rbacPlugin);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: 'TOO_MANY_REQUESTS', message: err.message });
    }
    if ((err as any).code === 'FST_ERR_VALIDATION' || (err as any).validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: err.message,
        ...((err as any).validation ? { details: (err as any).validation } : {}),
      });
    }
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: err.message || 'Internal Server Error' });
  });

  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // MUST run before dynamicConfigRoutes registers — it iterates getAll() at
  // registration time, so the new def must already be in the registry.
  await discoverAndRegisterConfigs();

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(configRoutes, { prefix: '/api/config' });
  await app.register(dynamicConfigRoutes, { prefix: '/api/config' });

  await app.ready();
  return app;
}

describe('AHU Completion Process — config endpoint + reader', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let authHeaders: Record<string, string>;

  beforeAll(async () => {
    app = await buildAhuApp();

    // Provision unique SUPER_ADMIN — idempotent upsert so re-runs work.
    const passwordHash = await hashPassword(AHU_GATE_PASSWORD);
    await prisma.user.upsert({
      where: { username: AHU_GATE_USERNAME },
      update: {
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ENABLED',
        forcePasswordChange: false,
        isTemporaryPassword: false,
        failedLoginAttempts: 0,
        lockedAt: null,
        lockoutUntil: null,
      },
      create: {
        username: AHU_GATE_USERNAME,
        fullName: 'AHU Gate Test Admin',
        email: `${AHU_GATE_USERNAME.toLowerCase()}@ahugate-test.local`,
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ENABLED',
        forcePasswordChange: false,
        isTemporaryPassword: false,
        createdBy: 'ahu-gate-test',
      },
    });

    adminToken = await loginAs(app, AHU_GATE_USERNAME, AHU_GATE_PASSWORD);
    authHeaders = { authorization: `Bearer ${adminToken}` };
  });

  afterAll(async () => {
    // Reset config row to default so we leave no state leakage.
    // Best-effort — don't let cleanup failures mask test failures.
    try {
      await app.inject({
        method: 'PUT',
        url: '/api/config/dynamic/ahu-completion-process',
        headers: authHeaders,
        payload: { mode: 'NONE' },
      });
    } catch {
      // swallow
    }
    try {
      await app.close();
    } catch {
      // swallow
    }
  });

  it('GET /api/config/ahu-completion-process/current returns NONE by default', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/ahu-completion-process/current',
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('NONE');
  });

  it('PUT dynamic config sets mode to INTERLOCK and /current reflects it', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/config/dynamic/ahu-completion-process',
      headers: authHeaders,
      payload: { mode: 'INTERLOCK' },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/config/ahu-completion-process/current',
      headers: authHeaders,
    });
    expect(res.json().mode).toBe('INTERLOCK');
  });
});
