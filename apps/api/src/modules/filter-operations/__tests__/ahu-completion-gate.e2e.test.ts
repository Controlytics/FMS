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
import { randomUUID } from 'node:crypto';
import { computeAhuCompletionStatus } from '../ahu-completion-gate.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — DB-backed helpers: resolveAhuId, loadCountedFilters,
//           computeAhuCompletionStatus
//
// Fixture: one AHU with two child FILTER instances sharing profile S1→S2→CL→END.
//   Filter A parked at S2 (final stage).
//   Filter B mid-cleaning at S1 (not final).
// Excluded filter = A.  Expectation: B is pending, allAtFinal = false.
// ─────────────────────────────────────────────────────────────────────────────
describe('AHU Completion Status — computeAhuCompletionStatus', () => {
  let ahuTemplateId: string;
  let filterTemplateId: string;
  let cleaningProfileId: string;
  let filterProfileId: string;
  let ahuId: string;
  let filterAId: string;
  let filterBId: string;
  let cycleAId: string;
  let cycleBId: string;

  beforeAll(async () => {
    // ── Template kinds (seeded by seed.ts; upsert for safety) ───────────────
    await prisma.templateKind.upsert({
      where: { code: 'AHU' },
      update: {},
      create: { code: 'AHU', label: 'AHU', isSystem: true },
    });
    await prisma.templateKind.upsert({
      where: { code: 'FILTER' },
      update: {},
      create: { code: 'FILTER', label: 'Filter', isSystem: true },
    });

    // ── Asset templates (unique names via SUFFIX) ────────────────────────────
    const ahuTpl = await prisma.assetTemplate.create({
      data: { name: `AHU Tpl T3 ${SUFFIX}`, templateKind: 'AHU' },
    });
    ahuTemplateId = ahuTpl.id;

    const filterTpl = await prisma.assetTemplate.create({
      data: { name: `Filter Tpl T3 ${SUFFIX}`, templateKind: 'FILTER' },
    });
    filterTemplateId = filterTpl.id;

    // ── Cleaning profile: S1 → S2 → [CHECKLIST] → END ───────────────────────
    const cp = await prisma.filterCleaningProfile.create({
      data: {
        name: `CP T3 ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        stages: {
          create: [
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 2 },
            { nodeType: 'CHECKLIST', stateKey: null, sortOrder: 3 },
            { nodeType: 'END', stateKey: null, sortOrder: 4 },
          ],
        },
      },
      include: { stages: true },
    });
    cleaningProfileId = cp.id;

    // Wire connections: S1 → S2 → CHECKLIST → END
    const s1 = cp.stages.find(s => s.stateKey === 'S1')!;
    const s2 = cp.stages.find(s => s.stateKey === 'S2')!;
    const cl = cp.stages.find(s => s.nodeType === 'CHECKLIST')!;
    const end = cp.stages.find(s => s.nodeType === 'END')!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId: cleaningProfileId, fromStageId: s1.id, toStageId: s2.id },
        { profileId: cleaningProfileId, fromStageId: s2.id, toStageId: cl.id },
        { profileId: cleaningProfileId, fromStageId: cl.id, toStageId: end.id },
      ],
    });

    // ── Filter profile (links AssetInstance → CleaningProfile) ──────────────
    const fp = await prisma.filterProfile.create({
      data: { name: `FP T3 ${SUFFIX}`, cleaningProfileId },
    });
    filterProfileId = fp.id;

    // ── AHU instance (no parent) ─────────────────────────────────────────────
    const ahu = await prisma.assetInstance.create({
      data: { name: `AHU T3 ${SUFFIX}`, templateId: ahuTemplateId },
    });
    ahuId = ahu.id;

    // ── Filter A — parked at final stage (S2) ────────────────────────────────
    const fA = await prisma.assetInstance.create({
      data: { name: `Filter A T3 ${SUFFIX}`, templateId: filterTemplateId, parentId: ahuId },
    });
    filterAId = fA.id;

    // ── Filter B — mid-cleaning at S1 ────────────────────────────────────────
    const fB = await prisma.assetInstance.create({
      data: { name: `Filter B T3 ${SUFFIX}`, templateId: filterTemplateId, parentId: ahuId },
    });
    filterBId = fB.id;

    // ── Cycles (profileId = FilterCleaningProfile.id directly) ───────────────
    // loadLocalContext handles this: tries FilterProfile lookup (null), falls
    // back to treating profileId as a FilterCleaningProfile id.
    const cycleA = await prisma.cleaningCycle.create({
      data: {
        cycleCode: `CC-T3A-${SUFFIX}`,
        filterId: filterAId,
        profileId: cleaningProfileId,
        profileVersion: 1,
        sequenceNumber: 1,
        cleaningReasonKey: 'SCHEDULED',
        cleaningReasonLabel: 'Scheduled',
      },
    });
    cycleAId = cycleA.id;

    const cycleB = await prisma.cleaningCycle.create({
      data: {
        cycleCode: `CC-T3B-${SUFFIX}`,
        filterId: filterBId,
        profileId: cleaningProfileId,
        profileVersion: 1,
        sequenceNumber: 1,
        cleaningReasonKey: 'SCHEDULED',
        cleaningReasonLabel: 'Scheduled',
      },
    });
    cycleBId = cycleB.id;

    // ── FilterDetails: A at S2 (final), B at S1 (not final) ─────────────────
    await prisma.filterDetails.create({
      data: {
        assetInstanceId: filterAId,
        filterProfileId,
        currentCycleId: cycleAId,
        currentLifecycleState: 'S2',
      },
    });
    await prisma.filterDetails.create({
      data: {
        assetInstanceId: filterBId,
        filterProfileId,
        currentCycleId: cycleBId,
        currentLifecycleState: 'S1',
      },
    });
  }, 30_000);

  afterAll(async () => {
    // FK-safe teardown order:
    // FilterDetails → CleaningCycles → child instances → AHU → FilterProfile
    //   → FilterCleaningProfile (cascades stages/connections) → templates
    try {
      await prisma.filterDetails.deleteMany({
        where: { assetInstanceId: { in: [filterAId, filterBId].filter(Boolean) } },
      });
      await prisma.cleaningCycle.deleteMany({
        where: { id: { in: [cycleAId, cycleBId].filter(Boolean) } },
      });
      await prisma.assetInstance.deleteMany({
        where: { id: { in: [filterAId, filterBId].filter(Boolean) } },
      });
      if (ahuId) await prisma.assetInstance.delete({ where: { id: ahuId } });
      if (filterProfileId) await prisma.filterProfile.delete({ where: { id: filterProfileId } });
      if (cleaningProfileId)
        await prisma.filterCleaningProfile.delete({ where: { id: cleaningProfileId } });
      if (ahuTemplateId) await prisma.assetTemplate.delete({ where: { id: ahuTemplateId } });
      if (filterTemplateId) await prisma.assetTemplate.delete({ where: { id: filterTemplateId } });
    } catch {
      // Swallow cleanup errors — don't mask real test failures.
    }
  }, 30_000);

  it('computeAhuCompletionStatus reports the mid-cleaning sibling as pending', async () => {
    // Exclude A (at final S2). Only B (at S1, non-final) remains → allAtFinal false.
    const status = await computeAhuCompletionStatus(ahuId, filterAId);
    expect(status.allAtFinal).toBe(false);
    expect(status.pending.map(p => p.id)).toContain(filterBId);
  });

  it('computeAhuCompletionStatus sees only the final-stage filter as done', async () => {
    // Exclude B (at S1). Only A (at S2, final) remains.
    // If computeFinalStageKey returns null/wrong key, A is treated as pending → assertion fails.
    // This discriminating case proves the final-stage graph walk actually works.
    const done = await computeAhuCompletionStatus(ahuId, filterBId);
    expect(done.allAtFinal).toBe(true);
    expect(done.pending).toEqual([]);
  });
});
