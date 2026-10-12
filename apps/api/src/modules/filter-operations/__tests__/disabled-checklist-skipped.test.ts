/**
 * A DISABLED checklist is skipped wherever it sits in the pipeline, and a
 * checklist a live cleaning profile uses cannot be disabled (2026-10-12,
 * operator decision "A and C").
 *
 * Before: a disabled checklist BETWEEN two stages was still demanded
 * (CHECKLIST_PENDING) while the same checklist right before END was skipped
 * and the cycle completed. Now both are skipped, the skip is named on the
 * stage event (`skippedChecklists`), and the guards stop the state arising:
 *   - PUT /api/checklist-profiles/:id {isActive:false}  → 409 CHECKLIST_IN_USE
 *   - a cleaning profile using a disabled checklist     → 400 CHECKLIST_DISABLED
 *
 * The cycle part disables the checklists straight in the DB, standing in for
 * the cases the guards cannot prevent (a cycle running on an archived profile
 * version, or a checklist disabled before the guard existed).
 *
 * Real Fastify + Prisma against digilog_test_db; unique SUPER_ADMIN; the
 * filter has no parent so the AHU completion interlock never engages.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from '../../../plugins/auth.js';
import rbacPlugin from '../../../plugins/rbac.js';
import authRoutes from '../../auth/routes.js';
import filterOperationsRoutes from '../routes.js';
import checklistProfileRoutes from '../../checklist-profiles/routes.js';
import cleaningProfileRoutes from '../../cleaning-profiles/routes.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { AppError } from '../../../lib/errors.js';
import { loginAs, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { randomUUID } from 'node:crypto';

const SUFFIX = Date.now().toString(36).slice(-4).toUpperCase();
const USERNAME = `DCLS${SUFFIX}`.slice(0, 16).toUpperCase();
const PASSWORD = 'DclsTest@Digilog#9';
const REASON_KEY = 'ROUTINE';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if ((err as any).code === 'FST_ERR_VALIDATION' || (err as any).validation) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: err.message });
    }
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
  await app.register(checklistProfileRoutes, { prefix: '/api/checklist-profiles' });
  await app.register(cleaningProfileRoutes, { prefix: '/api/filter-cleaning-profiles' });
  await app.ready();
  return app;
}

describe('disabled checklist is skipped everywhere; in-use checklist cannot be disabled', () => {
  let app: FastifyInstance;
  let headers: Record<string, string>;
  let token = '';
  let templateId = '';
  let midId = '';   // checklist between S1 and S2
  let endId = '';   // checklist between S2 and END
  let cleaningProfileId = '';
  let filterProfileId = '';
  let filterId = '';
  let cycleId = '';
  const extraCleaningProfiles: string[] = [];

  async function state() {
    const res = await app.inject({ method: 'GET', url: `/api/filters/${filterId}/current-state`, headers });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    const flags = { passwordHash, role: 'SUPER_ADMIN' as const, status: 'ENABLED' as const, forcePasswordChange: false, isTemporaryPassword: false };
    await prisma.user.upsert({
      where: { username: USERNAME },
      update: { ...flags, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { ...flags, username: USERNAME, fullName: 'Disabled Checklist Test', email: `${USERNAME.toLowerCase()}@dcls-test.local`, createdBy: 'dcls-test' },
    });

    await prisma.templateKind.upsert({ where: { code: 'FILTER' }, update: {}, create: { code: 'FILTER', label: 'Filter', isSystem: true } });
    templateId = (await prisma.assetTemplate.create({ data: { name: `DCLS Tpl ${SUFFIX}`, templateKind: 'FILTER' } })).id;

    const question = { question: 'Checked?', questionType: 'YES_NO', required: true, sortOrder: 1 };
    midId = (await prisma.checklistProfile.create({ data: { name: `DCLS Mid ${SUFFIX}`, isActive: true, questions: { create: [question] } } })).id;
    endId = (await prisma.checklistProfile.create({ data: { name: `DCLS End ${SUFFIX}`, isActive: true, questions: { create: [question] } } })).id;

    // START → S1 → CHECKLIST(mid) → S2 → CHECKLIST(end) → END
    const cp = await prisma.filterCleaningProfile.create({
      data: {
        name: `DCLS Profile ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        cleaningReasons: [{ key: REASON_KEY, name: 'Routine', requiresJustification: false }],
        stages: {
          create: [
            { nodeType: 'START', stateKey: null, sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'CHECKLIST', stateKey: null, sortOrder: 2, configuration: { checklistProfileId: midId } },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 3 },
            { nodeType: 'CHECKLIST', stateKey: null, sortOrder: 4, configuration: { checklistProfileId: endId } },
            { nodeType: 'END', stateKey: null, sortOrder: 5 },
          ],
        },
      },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    cleaningProfileId = cp.id;
    const ids = cp.stages.map(s => s.id);
    await prisma.filterPipelineConnection.createMany({
      data: ids.slice(0, -1).map((from, i) => ({ profileId: cleaningProfileId, fromStageId: from, toStageId: ids[i + 1] })),
    });

    filterProfileId = (await prisma.filterProfile.create({ data: { name: `DCLS FP ${SUFFIX}`, cleaningProfileId } })).id;
    filterId = (await prisma.assetInstance.create({ data: { name: `DCLS-Filter-${SUFFIX}`, templateId } })).id;
    await prisma.filterDetails.create({ data: { assetInstanceId: filterId, filterProfileId, currentCycleId: null, currentLifecycleState: null } });

    app = await buildApp();
    token = await loginAs(app, USERNAME, PASSWORD);
    headers = { authorization: `Bearer ${token}` };
  }, 60_000);

  afterAll(async () => {
    // audit_trail rows stay — the immutability trigger rejects deletes.
    try {
      await prisma.filterEvent.deleteMany({ where: { filterId } });
      await prisma.cleaningCycle.deleteMany({ where: { filterId } });
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: filterId } });
      await prisma.assetInstance.delete({ where: { id: filterId } }).catch(() => undefined);
      await prisma.filterProfile.delete({ where: { id: filterProfileId } }).catch(() => undefined);
      for (const id of [cleaningProfileId, ...extraCleaningProfiles]) {
        await prisma.filterCleaningProfile.delete({ where: { id } }).catch(() => undefined);
      }
      for (const id of [midId, endId]) await prisma.checklistProfile.delete({ where: { id } }).catch(() => undefined);
      await prisma.assetTemplate.delete({ where: { id: templateId } }).catch(() => undefined);
    } catch { /* cleanup must never mask a real failure */ }
    await app.close().catch(() => undefined);
  }, 30_000);

  // ── C: guards ───────────────────────────────────────────────────────────────

  it('C: refuses to disable a checklist a live cleaning profile uses (409 CHECKLIST_IN_USE, names the profile)', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/checklist-profiles/${midId}`, headers,
      payload: { isActive: false, _currentPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('CHECKLIST_IN_USE');
    expect(res.json().message).toContain(`DCLS Profile ${SUFFIX}`);
    const row = await prisma.checklistProfile.findUnique({ where: { id: midId } });
    expect(row!.isActive).toBe(true);
  });

  it('C: other edits to an in-use checklist still save', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/checklist-profiles/${midId}`, headers,
      payload: { description: 'renamed while in use', _currentPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });

  it('C: refuses to create a cleaning profile that uses a disabled checklist (400 CHECKLIST_DISABLED)', async () => {
    const off = await prisma.checklistProfile.create({ data: { name: `DCLS Off ${SUFFIX}`, isActive: false } });
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/filter-cleaning-profiles', headers,
        payload: {
          name: `DCLS Bad ${SUFFIX}`,
          _currentPassword: PASSWORD,
          stages: [
            { nodeType: 'START', sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'CHECKLIST', sortOrder: 2, configuration: { checklistProfileId: off.id } },
            { nodeType: 'END', sortOrder: 3 },
          ],
          connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 2 }, { fromIndex: 2, toIndex: 3 }],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CHECKLIST_DISABLED');
      const created = await prisma.filterCleaningProfile.findFirst({ where: { name: `DCLS Bad ${SUFFIX}` } });
      if (created) extraCleaningProfiles.push(created.id);
      expect(created).toBeNull();
    } finally {
      await prisma.checklistProfile.delete({ where: { id: off.id } }).catch(() => undefined);
    }
  });

  // ── A: cycle behaviour ──────────────────────────────────────────────────────

  it('A: while enabled, the mid-pipeline checklist is asked', async () => {
    const start = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/start-cycle`, headers,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: PASSWORD },
    });
    expect(start.statusCode).toBe(201);
    cycleId = start.json().id;

    const toS1 = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/advance`, headers,
      payload: { targetState: 'S1', tapeVersion: (await state()).tapeVersion, _currentPassword: PASSWORD },
    });
    expect(toS1.statusCode).toBe(200);

    const st = await state();
    expect(st.actions.some((a: any) => a.type === 'SUBMIT_CHECKLIST')).toBe(true);
    expect(st.stageLookup.S1.pendingChecklistProfileIds).toEqual([midId]);
    expect(st.disabledChecklistProfileIds).toEqual([]);
  });

  it('A: once disabled, neither checklist is asked and the tablet is told which are skipped', async () => {
    await prisma.checklistProfile.updateMany({ where: { id: { in: [midId, endId] } }, data: { isActive: false } });
    const st = await state();
    expect(st.actions.some((a: any) => a.type === 'SUBMIT_CHECKLIST')).toBe(false);
    expect(st.actions.some((a: any) => a.type === 'ADVANCE_TO_STAGE' && a.params?.targetState === 'S2')).toBe(true);
    expect(st.stageLookup.S1.pendingChecklistProfileIds).toEqual([]);
    expect(st.stageLookup.S2.pendingChecklistProfileIds).toEqual([]);
    expect([...st.disabledChecklistProfileIds].sort()).toEqual([midId, endId].sort());
  });

  it('A: answering a disabled checklist online is refused (400 CHECKLIST_DISABLED), nothing written', async () => {
    const qid = (await prisma.checklistQuestion.findFirst({ where: { profileId: midId } }))!.id;
    const res = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/submit-checklist`, headers,
      payload: { answers: { [qid]: 'YES' }, tapeVersion: (await state()).tapeVersion, _currentPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('CHECKLIST_DISABLED');
    expect(await prisma.filterEvent.count({ where: { filterId, cycleId, eventType: 'CHECKLIST_COMPLETED' } })).toBe(0);
  });

  it('A: advancing past both disabled checklists completes the cycle and names each skip on the event', async () => {
    const toS2 = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/advance`, headers,
      payload: { targetState: 'S2', tapeVersion: (await state()).tapeVersion, _currentPassword: PASSWORD },
    });
    expect(toS2.statusCode).toBe(200);

    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(cycle!.status).toBe('COMPLETED');

    const evt = await prisma.filterEvent.findFirst({ where: { filterId, cycleId, eventType: 'STATE_TRANSITION', toState: 'S2' } });
    const skipped = (evt!.attributes as any).skippedChecklists as any[];
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ checklistProfileId: midId, checklistProfileName: `DCLS Mid ${SUFFIX}`, afterStage: 'S1', reason: 'DISABLED' }),
      expect.objectContaining({ checklistProfileId: endId, checklistProfileName: `DCLS End ${SUFFIX}`, afterStage: 'S2', reason: 'DISABLED' }),
    ]));
    expect(skipped).toHaveLength(2);
  });

  it('C: re-enabling a checklist is always allowed', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/checklist-profiles/${midId}`, headers,
      payload: { isActive: true, _currentPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().isActive).toBe(true);
  });

  it('A: an OFFLINE replay of an answer given before the checklist was disabled is kept, and the bypass is named', async () => {
    // New cycle, stopped at S1 with the (re-enabled) mid checklist pending.
    const start = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/start-cycle`, headers,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: PASSWORD },
    });
    expect(start.statusCode).toBe(201);
    cycleId = start.json().id;
    const toS1 = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/advance`, headers,
      payload: { targetState: 'S1', tapeVersion: (await state()).tapeVersion, _currentPassword: PASSWORD },
    });
    expect(toS1.statusCode).toBe(200);
    const tapeVersion = (await state()).tapeVersion;

    // The tablet answered offline; meanwhile an admin disabled the checklist.
    await prisma.checklistProfile.update({ where: { id: midId }, data: { isActive: false } });
    const qid = (await prisma.checklistQuestion.findFirst({ where: { profileId: midId } }))!.id;
    const grant = await obtainOfflineGrant(app, token, PASSWORD);
    const res = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/submit-checklist`,
      headers: { ...headers, 'x-offline-replay-token': grant },
      payload: { answers: { [qid]: 'YES' }, tapeVersion, offlinePerformedAt: new Date().toISOString(), clientOpId: randomUUID() },
    });
    expect([200, 201]).toContain(res.statusCode);

    const evt = await prisma.filterEvent.findFirst({ where: { filterId, cycleId, eventType: 'CHECKLIST_COMPLETED' } });
    expect(evt).not.toBeNull();
    expect((evt!.attributes as any).replayExemptGates).toContain('CHECKLIST_DISABLED');
  });
});
