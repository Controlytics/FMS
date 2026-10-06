/**
 * Dry In as the FIRST stage: the dryer duration is required on the way in, and
 * a cycle that sits at DRY_IN with no dryer cannot leave it (2026-10-06).
 *
 * The live "DRY STORAGE" profile begins with DRY_IN. Until this fix the
 * start-and-advance payloads carried no dryer fields, `advance()` accepted the
 * entry, and every leaving-DRY_IN guard was a no-op without `dryerStartedAt` —
 * the cycle completed with no dryer time and no temperature reading.
 *
 * Pipeline: START → DRY_IN → DRY_OUT → END (no checklist, no equipment group,
 * no AHU parent — nothing else gates these moves).
 *
 * Test-infra notes (pattern: terminal-checklist-advance-persistence.test.ts)
 * - Real Fastify (`inject()`), real Prisma, real auth, against digilog_test_db.
 * - Unique SUPER_ADMIN per file; reauth satisfied with `_currentPassword`.
 * - Teardown leaves audit_trail rows (immutability trigger, 21 CFR §11.10(e)).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from '../../../plugins/auth.js';
import rbacPlugin from '../../../plugins/rbac.js';
import authRoutes from '../../auth/routes.js';
import filterOperationsRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { AppError } from '../../../lib/errors.js';
import { loginAs } from '../../../e2e/test-helper.js';
import { randomUUID } from 'node:crypto';

const SUFFIX = Date.now().toString(36).slice(-4).toUpperCase();
const DFS_USERNAME = `DFSG${SUFFIX}`.slice(0, 16).toUpperCase();
const DFS_PASSWORD = 'DryFirst@Digilog#6';
const REASON_KEY = 'ROUTINE';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
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
    if ((err as any).code === 'FST_ERR_VALIDATION' || (err as any).validation) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: err.message });
    }
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
  await app.ready();
  return app;
}

describe('Dry In as the first stage — duration required on entry, no silent exit', () => {
  let app: FastifyInstance;
  let authHeaders: Record<string, string>;

  let filterTemplateId = '';
  let cleaningProfileId = '';
  let filterProfileId = '';
  /** Filter A: the honest path — start → DRY_IN with SET_DURATION. */
  let filterAId = '';
  /** Filter B: a cycle forced to DRY_IN with no dryer (what the bug produced). */
  let filterBId = '';
  let cycleBId = '';

  async function freshTape(filterId: string): Promise<number> {
    const res = await app.inject({ method: 'GET', url: `/api/filters/${filterId}/current-state`, headers: authHeaders });
    expect(res.statusCode).toBe(200);
    return res.json().tapeVersion as number;
  }

  async function makeFilter(name: string): Promise<string> {
    const id = (await prisma.assetInstance.create({ data: { name, templateId: filterTemplateId } })).id;
    await prisma.filterDetails.create({
      data: { assetInstanceId: id, filterProfileId, currentCycleId: null, currentLifecycleState: null },
    });
    return id;
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(DFS_PASSWORD);
    await prisma.user.upsert({
      where: { username: DFS_USERNAME },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: DFS_USERNAME, fullName: 'Dry First Stage Test', email: `${DFS_USERNAME.toLowerCase()}@dfs-test.local`, passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'dfs-test' },
    });

    await prisma.templateKind.upsert({ where: { code: 'FILTER' }, update: {}, create: { code: 'FILTER', label: 'Filter', isSystem: true } });
    filterTemplateId = (await prisma.assetTemplate.create({ data: { name: `DFS Filter Tpl ${SUFFIX}`, templateKind: 'FILTER' } })).id;

    // START → DRY_IN → DRY_OUT → END
    const cleaning = await prisma.filterCleaningProfile.create({
      data: {
        name: `DFS Dry Storage ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        cleaningReasons: [{ key: REASON_KEY, name: 'Routine', requiresJustification: false }],
        stages: {
          create: [
            { nodeType: 'START', stateKey: null, sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'DRY_IN', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'DRY_OUT', sortOrder: 2 },
            { nodeType: 'END', stateKey: null, sortOrder: 3 },
          ],
        },
      },
      include: { stages: true },
    });
    cleaningProfileId = cleaning.id;
    const start = cleaning.stages.find(s => s.nodeType === 'START')!;
    const dryIn = cleaning.stages.find(s => s.stateKey === 'DRY_IN')!;
    const dryOut = cleaning.stages.find(s => s.stateKey === 'DRY_OUT')!;
    const end = cleaning.stages.find(s => s.nodeType === 'END')!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId: cleaningProfileId, fromStageId: start.id, toStageId: dryIn.id },
        { profileId: cleaningProfileId, fromStageId: dryIn.id, toStageId: dryOut.id },
        { profileId: cleaningProfileId, fromStageId: dryOut.id, toStageId: end.id },
      ],
    });

    filterProfileId = (await prisma.filterProfile.create({ data: { name: `DFS FP ${SUFFIX}`, cleaningProfileId } })).id;
    filterAId = await makeFilter(`DFS-A-${SUFFIX}`);
    filterBId = await makeFilter(`DFS-B-${SUFFIX}`);

    app = await buildApp();
    const token = await loginAs(app, DFS_USERNAME, DFS_PASSWORD);
    authHeaders = { authorization: `Bearer ${token}` };
  }, 60_000);

  afterAll(async () => {
    try {
      for (const filterId of [filterAId, filterBId]) {
        if (!filterId) continue;
        await prisma.filterEvent.deleteMany({ where: { filterId } });
        await prisma.cleaningCycle.deleteMany({ where: { filterId } });
        await prisma.filterDetails.deleteMany({ where: { assetInstanceId: filterId } });
        await prisma.assetInstance.delete({ where: { id: filterId } }).catch(() => undefined);
      }
      if (filterProfileId) await prisma.filterProfile.delete({ where: { id: filterProfileId } }).catch(() => undefined);
      if (cleaningProfileId) await prisma.filterCleaningProfile.delete({ where: { id: cleaningProfileId } }).catch(() => undefined);
      if (filterTemplateId) await prisma.assetTemplate.delete({ where: { id: filterTemplateId } }).catch(() => undefined);
    } catch { /* cleanup must never mask a real failure */ }
    try { await app.close(); } catch { /* swallow */ }
  }, 30_000);

  // ── Filter A: the way in ─────────────────────────────────────────────────

  it('a fresh cycle on a Dry-In-first profile offers SET_DRYER_DURATION, not a plain advance', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterAId}/start-cycle`,
      headers: authHeaders,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: DFS_PASSWORD },
    });
    expect(startRes.statusCode).toBe(201);

    const cs = await app.inject({ method: 'GET', url: `/api/filters/${filterAId}/current-state`, headers: authHeaders });
    expect(cs.statusCode).toBe(200);
    const types = (cs.json().actions as Array<{ type: string }>).map(a => a.type);
    expect(types).toContain('SET_DRYER_DURATION');
    expect(types).not.toContain('ADVANCE_TO_STAGE');
  });

  it('entering DRY_IN WITHOUT the duration is refused: 400 DRYER_DURATION_REQUIRED, nothing written', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterAId}/advance`,
      headers: authHeaders,
      payload: { targetState: 'DRY_IN', tapeVersion: await freshTape(filterAId), _currentPassword: DFS_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('DRYER_DURATION_REQUIRED');

    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterAId } });
    expect(details!.currentLifecycleState).toBeNull();
    const transitions = await prisma.filterEvent.count({ where: { filterId: filterAId, eventType: 'STATE_TRANSITION', toState: 'DRY_IN' } });
    expect(transitions).toBe(0);
  });

  it('entering DRY_IN WITH SET_DURATION starts the dryer on the cycle (the honest first-stage start)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterAId}/advance`,
      headers: authHeaders,
      payload: {
        targetState: 'DRY_IN',
        dryerAction: 'SET_DURATION',
        dryerDurationMinutes: 30,
        tapeVersion: await freshTape(filterAId),
        _currentPassword: DFS_PASSWORD,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentState).toBe('DRY_IN');

    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterAId } });
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: details!.currentCycleId! } });
    expect(cycle!.dryerDurationMinutes).toBe(30);
    expect(cycle!.dryerStartedAt).not.toBeNull();

    // ONE event carries both the entry and the dryer start.
    const evt = await prisma.filterEvent.findFirst({ where: { filterId: filterAId, cycleId: cycle!.id, eventType: 'STATE_TRANSITION', toState: 'DRY_IN' } });
    expect(evt).not.toBeNull();
    expect((evt!.attributes as any).action).toBe('DRYER_STARTED');
    expect((evt!.attributes as any).dryerDurationMinutes).toBe(30);
  });

  // ── Filter B: a cycle the bug left at DRY_IN with no dryer ───────────────

  it('a cycle sitting at DRY_IN with no dryer offers ONLY the in-place SET_DRYER_DURATION', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterBId}/start-cycle`,
      headers: authHeaders,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: DFS_PASSWORD },
    });
    expect(startRes.statusCode).toBe(201);
    cycleBId = startRes.json().id as string;
    // Reproduce the pre-fix state directly: the filter is at DRY_IN, the cycle
    // never recorded a dryer start (what the old start-and-advance produced).
    await prisma.filterDetails.update({ where: { assetInstanceId: filterBId }, data: { currentLifecycleState: 'DRY_IN' } });

    const cs = await app.inject({ method: 'GET', url: `/api/filters/${filterBId}/current-state`, headers: authHeaders });
    expect(cs.statusCode).toBe(200);
    const actions = cs.json().actions as Array<{ type: string; params?: { targetState?: string } }>;
    const setDur = actions.find(a => a.type === 'SET_DRYER_DURATION');
    expect(setDur?.params?.targetState).toBe('DRY_IN');
    expect(actions.some(a => a.type === 'ADVANCE_TO_STAGE')).toBe(false);
  });

  it('leaving DRY_IN with the dryer never started is refused (was a silent pass to completion)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterBId}/advance`,
      headers: authHeaders,
      payload: { targetState: 'DRY_OUT', tapeVersion: await freshTape(filterBId), _currentPassword: DFS_PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('DRYER_DURATION_REQUIRED');
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleBId } });
    expect(cycle!.status).toBe('IN_PROGRESS');
    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterBId } });
    expect(details!.currentLifecycleState).toBe('DRY_IN');
  });

  it('the in-place SET_DURATION recovers it: dryer starts, filter stays at DRY_IN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterBId}/advance`,
      headers: authHeaders,
      payload: {
        targetState: 'DRY_IN',
        dryerAction: 'SET_DURATION',
        dryerDurationMinutes: 45,
        tapeVersion: await freshTape(filterBId),
        _currentPassword: DFS_PASSWORD,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentState).toBe('DRY_IN');
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleBId } });
    expect(cycle!.dryerDurationMinutes).toBe(45);
    expect(cycle!.dryerStartedAt).not.toBeNull();

    // Now the ordinary dryer rules apply: readings are required before leaving.
    const leave = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterBId}/advance`,
      headers: authHeaders,
      payload: { targetState: 'DRY_OUT', tapeVersion: await freshTape(filterBId), _currentPassword: DFS_PASSWORD },
    });
    expect(leave.statusCode).toBe(400);
    expect(['DRYER_NOT_READY', 'DRYER_READINGS_REQUIRED']).toContain(leave.json().error);
  });
});
