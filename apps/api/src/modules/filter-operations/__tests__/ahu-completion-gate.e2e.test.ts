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
import { computeAhuCompletionStatus, assertAhuInterlockSatisfied, resolveAhuId } from '../ahu-completion-gate.js';
import filterOperationsRoutes from '../routes.js';

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

  // ── Task 4: assertAhuInterlockSatisfied + completion-status endpoint ─────────
  describe('Task 4 — assertAhuInterlockSatisfied + completion-status endpoint', () => {
    let app4: FastifyInstance;
    let authHeaders4: Record<string, string>;

    // Non-AHU parent fixture for the templateKind !== 'AHU' branch test.
    let nonAhuTemplateId: string;
    let nonAhuParentId: string;
    let nonAhuChildId: string;

    beforeAll(async () => {
      // Set mode to INTERLOCK in DB (upsert in case first describe's afterAll
      // has already run and the row exists with NONE; or the row doesn't exist yet).
      await prisma.systemConfig.upsert({
        where: { configKey: 'ahu-completion-process' },
        update: { configValue: { mode: 'INTERLOCK' } as any },
        create: {
          configKey: 'ahu-completion-process',
          configValue: { mode: 'INTERLOCK' } as any,
          configType: 'filter-management',
        },
      });

      // Build a minimal Fastify app with filter-operations routes (for endpoint test).
      app4 = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
      await app4.register(cors, { origin: true, credentials: true });
      await app4.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
      await app4.register(authPlugin);
      await app4.register(rbacPlugin);
      app4.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({
            error: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          });
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
      await app4.register(authRoutes, { prefix: '/api/auth' });
      await app4.register(filterOperationsRoutes, { prefix: '/api/filters' });
      await app4.ready();

      // ── Non-AHU parent fixture (for templateKind !== 'AHU' branch) ──────────
      // Upsert BLOCK kind (seeded in seed.ts, upsert is safe on a test DB).
      await prisma.templateKind.upsert({
        where: { code: 'BLOCK' },
        update: {},
        create: { code: 'BLOCK', label: 'Block', isSystem: true },
      });
      const nonAhuTpl = await prisma.assetTemplate.create({
        data: { name: `Block Tpl T4 ${SUFFIX}`, templateKind: 'BLOCK' },
      });
      nonAhuTemplateId = nonAhuTpl.id;

      const nonAhuParent = await prisma.assetInstance.create({
        data: { name: `Block Parent T4 ${SUFFIX}`, templateId: nonAhuTemplateId },
      });
      nonAhuParentId = nonAhuParent.id;

      // Child whose parent EXISTS but is a BLOCK (not AHU) — exercises the
      // `templateKind !== 'AHU'` return-null branch in resolveAhuId.
      const nonAhuChild = await prisma.assetInstance.create({
        data: {
          name: `Child of Block T4 ${SUFFIX}`,
          templateId: filterTemplateId,
          parentId: nonAhuParentId,
        },
      });
      nonAhuChildId = nonAhuChild.id;

      // Login as the SUPER_ADMIN provisioned in the first describe's beforeAll.
      // That user persists in the DB across all describes in this file.
      const token = await loginAs(app4, AHU_GATE_USERNAME, AHU_GATE_PASSWORD);
      authHeaders4 = { authorization: `Bearer ${token}` };
    }, 30_000);

    afterAll(async () => {
      // Reset config to NONE so we leave no state leakage.
      try {
        await prisma.systemConfig.updateMany({
          where: { configKey: 'ahu-completion-process' },
          data: { configValue: { mode: 'NONE' } as any },
        });
      } catch { /* swallow */ }
      // Tear down non-AHU fixture (FK-safe: child → parent → template).
      try {
        if (nonAhuChildId) await prisma.assetInstance.delete({ where: { id: nonAhuChildId } });
        if (nonAhuParentId) await prisma.assetInstance.delete({ where: { id: nonAhuParentId } });
        if (nonAhuTemplateId) await prisma.assetTemplate.delete({ where: { id: nonAhuTemplateId } });
      } catch { /* swallow */ }
      try { await app4.close(); } catch { /* swallow */ }
    }, 10_000);

    // ── resolveAhuId coverage (Task 3 follow-through) ───────────────────────
    it('resolveAhuId returns the AHU id when the immediate parent is an AHU', async () => {
      const resolved = await resolveAhuId(filterAId);
      expect(resolved).toBe(ahuId);
    });

    it('resolveAhuId returns null when the filter has no parent (early-return null guard)', async () => {
      // ahuId itself has parentId = null → hits `if (!self?.parentId) return null;`.
      // This covers the no-parent guard, NOT the templateKind branch.
      const resolved = await resolveAhuId(ahuId);
      expect(resolved).toBeNull();
    });

    it('resolveAhuId returns null when the immediate parent exists but is not an AHU (templateKind !== AHU branch)', async () => {
      // nonAhuChildId has parentId → nonAhuParentId whose templateKind is 'BLOCK'.
      // resolveAhuId: self.parentId is non-null (skips early guard) → fetches parent
      // → parent.template.templateKind === 'BLOCK' !== 'AHU' → returns null.
      // This is the only test that exercises the `return parent?.template?.templateKind === 'AHU' ? parent.id : null`
      // branch when templateKind is NOT 'AHU'.
      const resolved = await resolveAhuId(nonAhuChildId);
      expect(resolved).toBeNull();
    });

    // ── assertAhuInterlockSatisfied ─────────────────────────────────────────
    it('assertAhuInterlockSatisfied passes on offline replay regardless of mode', async () => {
      // isOfflineReplay = true → immediate return, no DB reads.
      await expect(assertAhuInterlockSatisfied({ filterId: filterAId, isOfflineReplay: true }))
        .resolves.toBeUndefined();
    });

    it('assertAhuInterlockSatisfied passes when mode is NONE', async () => {
      // Temporarily set mode to NONE.
      await prisma.systemConfig.updateMany({
        where: { configKey: 'ahu-completion-process' },
        data: { configValue: { mode: 'NONE' } as any },
      });
      try {
        await expect(assertAhuInterlockSatisfied({ filterId: filterAId, isOfflineReplay: false }))
          .resolves.toBeUndefined();
      } finally {
        // Restore INTERLOCK for the throw test below.
        await prisma.systemConfig.updateMany({
          where: { configKey: 'ahu-completion-process' },
          data: { configValue: { mode: 'INTERLOCK' } as any },
        });
      }
    });

    it('assertAhuInterlockSatisfied throws 422 AHU_INTERLOCK_PENDING when a sibling is not at final stage', async () => {
      // mode = INTERLOCK; filter A is at S2 (final) but filter B is at S1 (not final).
      // Calling with filterAId (exclude A): B is pending → should throw.
      await expect(assertAhuInterlockSatisfied({ filterId: filterAId, isOfflineReplay: false }))
        .rejects.toMatchObject({ statusCode: 422, code: 'AHU_INTERLOCK_PENDING' });
    });

    // ── GET /api/filters/ahu/:ahuId/completion-status ───────────────────────
    it('GET completion-status returns 200 with allAtFinal=false and B in pending', async () => {
      const res = await app4.inject({
        method: 'GET',
        url: `/api/filters/ahu/${ahuId}/completion-status`,
        headers: authHeaders4,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.allAtFinal).toBe(false);
      expect(body.pending.map((p: { id: string }) => p.id)).toContain(filterBId);
    });
  });

  // ── Task 5: submit-checklist HTTP route integration ──────────────────────────
  // Verifies that the assertAhuInterlockSatisfied gate is wired into the
  // submit-checklist completion path and fires BEFORE any DB write.
  //
  // Fixture (inherited from outer beforeAll):
  //   Filter A — at S2 (final), cycleAId IN_PROGRESS.
  //   Filter B — at S1 (not final), cycleBId IN_PROGRESS.
  //   Profile:  S1 → S2 → [CHECKLIST, no checklistProfileId] → END.
  //   CHECKLIST node has no checklistProfileId → resolveChecklistQuestions
  //   returns [] → answers:{} is valid for all three tests.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Task 5 — submit-checklist interlock gate (HTTP route)', () => {
    let app5: FastifyInstance;
    let authHeaders5: Record<string, string>;

    beforeAll(async () => {
      // Set mode to INTERLOCK (Task 4 afterAll already reset it to NONE).
      await prisma.systemConfig.upsert({
        where: { configKey: 'ahu-completion-process' },
        update: { configValue: { mode: 'INTERLOCK' } as any },
        create: {
          configKey: 'ahu-completion-process',
          configValue: { mode: 'INTERLOCK' } as any,
          configType: 'filter-management',
        },
      });

      // Build a minimal Fastify app mirroring app4 (same error handler is
      // required — without it AppError.code is swallowed by the default handler
      // and res.json().error becomes 'Unprocessable Entity', not 'AHU_INTERLOCK_PENDING').
      app5 = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
      await app5.register(cors, { origin: true, credentials: true });
      await app5.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
      await app5.register(authPlugin);
      await app5.register(rbacPlugin);
      app5.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
        if (err instanceof AppError) {
          return reply.code(err.statusCode).send({
            error: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
          });
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
      await app5.register(authRoutes, { prefix: '/api/auth' });
      await app5.register(filterOperationsRoutes, { prefix: '/api/filters' });
      await app5.ready();

      const token = await loginAs(app5, AHU_GATE_USERNAME, AHU_GATE_PASSWORD);
      authHeaders5 = { authorization: `Bearer ${token}` };
    }, 30_000);

    afterAll(async () => {
      // Reset mode unconditionally — runs even if tests were skipped or failed.
      try {
        await prisma.systemConfig.updateMany({
          where: { configKey: 'ahu-completion-process' },
          data: { configValue: { mode: 'NONE' } as any },
        });
      } catch { /* swallow */ }
      // Remove FilterEvents written by these tests so the outer afterAll's
      // cleaningCycle.deleteMany / assetInstance.deleteMany can succeed without
      // FK violations (FilterEvent.cycleId and FilterEvent.filterId are FK cols).
      try {
        await prisma.filterEvent.deleteMany({
          where: { filterId: { in: [filterAId, filterBId].filter(Boolean) } },
        });
      } catch { /* swallow */ }
      try { await app5.close(); } catch { /* swallow */ }
    }, 10_000);

    it('submit-checklist at final stage is blocked (422) when a sibling is not at final', async () => {
      // Fixture state: A at S2, B at S1, mode=INTERLOCK.
      // The gate fires before any transaction → no DB write on 422.
      const stateRes = await app5.inject({
        method: 'GET',
        url: `/api/filters/${filterAId}/current-state`,
        headers: authHeaders5,
      });
      expect(stateRes.statusCode).toBe(200);
      const { tapeVersion } = stateRes.json();

      const res = await app5.inject({
        method: 'POST',
        url: `/api/filters/${filterAId}/submit-checklist`,
        headers: authHeaders5,
        payload: { answers: {}, tapeVersion, _currentPassword: AHU_GATE_PASSWORD },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toContain('AHU_INTERLOCK_PENDING');
    });

    it('submit-checklist completes the cycle when all siblings are at final', async () => {
      // Move B to its final stage (S2) via direct DB update so the gate sees
      // all siblings at final and allows A's completion.
      await prisma.filterDetails.update({
        where: { assetInstanceId: filterBId },
        data: { currentLifecycleState: 'S2' },
      });

      // Re-fetch tapeVersion: test 1 threw 422 (no write occurred), so
      // cycle events are unchanged — but re-fetching is more robust.
      const stateRes = await app5.inject({
        method: 'GET',
        url: `/api/filters/${filterAId}/current-state`,
        headers: authHeaders5,
      });
      expect(stateRes.statusCode).toBe(200);
      const { tapeVersion } = stateRes.json();

      const res = await app5.inject({
        method: 'POST',
        url: `/api/filters/${filterAId}/submit-checklist`,
        headers: authHeaders5,
        payload: { answers: {}, tapeVersion, _currentPassword: AHU_GATE_PASSWORD },
      });
      expect(res.statusCode).toBe(200);

      // Confirm the cycle was completed in the DB.
      const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleAId } });
      expect(cycle?.status).toBe('COMPLETED');
    });

    it('submit-checklist completes normally when mode is NONE (gate short-circuits)', async () => {
      // After test 2: Filter A is COMPLETED (no active cycle).
      // Filter B is at S2 with cycleBId still IN_PROGRESS — use it for this test.
      // Mode → NONE: gate short-circuits immediately; cycle completes normally.
      await prisma.systemConfig.updateMany({
        where: { configKey: 'ahu-completion-process' },
        data: { configValue: { mode: 'NONE' } as any },
      });

      const stateRes = await app5.inject({
        method: 'GET',
        url: `/api/filters/${filterBId}/current-state`,
        headers: authHeaders5,
      });
      expect(stateRes.statusCode).toBe(200);
      const { tapeVersion } = stateRes.json();

      const res = await app5.inject({
        method: 'POST',
        url: `/api/filters/${filterBId}/submit-checklist`,
        headers: authHeaders5,
        payload: { answers: {}, tapeVersion, _currentPassword: AHU_GATE_PASSWORD },
      });
      expect(res.statusCode).toBe(200);

      // Confirm cycle B also completed.
      const cycleB = await prisma.cleaningCycle.findUnique({ where: { id: cycleBId } });
      expect(cycleB?.status).toBe('COMPLETED');
    });
  });

  // ── Task 9 (2026-07-02 regression): count filters that resolve their profile
  //    via config-rule / default fallback — i.e. FilterDetails.filterProfileId
  //    is NULL. This is the PRODUCTION norm (0/274 filters carry a direct
  //    binding; resolveFilterProfile falls back to the block/area rule or the
  //    default active profile). The original loadCountedFilters predicate
  //    `filterDetails.filterProfileId != null` excluded EVERY such filter, so
  //    computeAhuCompletionStatus returned zero siblings and INTERLOCK/POPUP
  //    were silent no-ops system-wide. The Task 3 fixtures set filterProfileId,
  //    which is exactly why they never caught this. Fixtures here leave it NULL.
  describe('AHU interlock — counts filters with NO filterProfileId binding (regression)', () => {
    let ahu2 = '';
    let finalFilter = '';   // reached final via CLEANING_CYCLE_COMPLETED (no cycle)
    let idleFilter = '';    // never started → must be counted + block
    let ahuTpl2 = '';
    let filterTpl2 = '';

    beforeAll(async () => {
      const ahuT = await prisma.assetTemplate.create({ data: { name: `AHU Tpl T9 ${SUFFIX}`, templateKind: 'AHU' } });
      ahuTpl2 = ahuT.id;
      const filterT = await prisma.assetTemplate.create({ data: { name: `Filter Tpl T9 ${SUFFIX}`, templateKind: 'FILTER' } });
      filterTpl2 = filterT.id;

      const ahu = await prisma.assetInstance.create({ data: { name: `AHU T9 ${SUFFIX}`, templateId: ahuTpl2 } });
      ahu2 = ahu.id;

      const fFinal = await prisma.assetInstance.create({ data: { name: `Filter Final T9 ${SUFFIX}`, templateId: filterTpl2, parentId: ahu2 } });
      finalFilter = fFinal.id;
      const fIdle = await prisma.assetInstance.create({ data: { name: `Filter Idle T9 ${SUFFIX}`, templateId: filterTpl2, parentId: ahu2 } });
      idleFilter = fIdle.id;

      // The crux: NO direct binding — both clean via config/default resolution.
      await prisma.filterDetails.create({ data: { assetInstanceId: finalFilter, filterProfileId: null, currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' } });
      await prisma.filterDetails.create({ data: { assetInstanceId: idleFilter, filterProfileId: null, currentCycleId: null, currentLifecycleState: null } });
    }, 30_000);

    afterAll(async () => {
      try {
        await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: [finalFilter, idleFilter].filter(Boolean) } } });
        for (const id of [finalFilter, idleFilter, ahu2].filter(Boolean)) {
          await prisma.assetInstance.delete({ where: { id } }).catch(() => undefined);
        }
        for (const id of [filterTpl2, ahuTpl2].filter(Boolean)) {
          await prisma.assetTemplate.delete({ where: { id } }).catch(() => undefined);
        }
      } catch { /* swallow cleanup errors */ }
    });

    it('counts a never-started sibling (filterProfileId=null) as pending — pre-fix it was excluded → allAtFinal=true', async () => {
      // Exclude the completed filter; the idle sibling with no binding must
      // still be counted and reported pending. Pre-fix this returned
      // { allAtFinal: true, pending: [] } because loadCountedFilters found none.
      const { allAtFinal, pending } = await computeAhuCompletionStatus(ahu2, finalFilter);
      expect(allAtFinal).toBe(false);
      expect(pending.map(p => p.id)).toContain(idleFilter);
    });
  });
});
