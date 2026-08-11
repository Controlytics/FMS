/**
 * AHU completion INTERLOCK on the ADVANCE path (2026-08-10).
 *
 * What this covers
 * ----------------
 * `assertAhuInterlockSatisfied` used to be called from `submit-checklist.ts`
 * ONLY. That covers pipelines shaped `… → FINAL STAGE → CHECKLIST → END`, where
 * the checklist submit completes the cycle. A pipeline shaped
 * `… → FINAL STAGE → END` auto-completes inside `advance()` with no checklist,
 * so INTERLOCK was enforced NOWHERE on the server: a filter could finish its
 * cycle while every sibling under its AHU was still mid-cleaning. `advance.ts`
 * now runs the same assert, guarded by its existing `completesCycle`.
 *
 * Why the pipeline here has NO checklist
 * --------------------------------------
 * That is the entire point — it is the shape the old gate could not see. Its
 * sibling file `terminal-checklist-advance-persistence.test.ts` uses
 * `S2 → CHECKLIST → END` and deliberately parents the filter to nothing so the
 * interlock never engages; this file is the mirror image.
 *
 * The two gates must stay mutually exclusive: `completesCycle` is false
 * whenever an ACTIVE checklist follows the target stage, which is exactly the
 * case submit-checklist owns. The final test pins that, so a future edit that
 * makes advance gate unconditionally (⇒ double 422 / gating intermediate
 * advances) fails here.
 *
 * Test-infra notes
 * ----------------
 * - Real Fastify (`inject()`), real Prisma, real auth, against
 *   `digilog_test_db` (forced by vitest.env.ts). Pattern copied from
 *   `terminal-checklist-advance-persistence.test.ts`.
 * - Unique SUPER_ADMIN per file so the shared-`admin` login race can't touch us.
 * - Reauth satisfied with `_currentPassword` in the body — NOT the
 *   offline-replay grant, which would set `isOfflineReplay=true` and take the
 *   exempt path through the gate. This test is the ONLINE operator.
 * - The filter IS parented to an AHU here (unlike the sibling file), so the
 *   gate genuinely engages. Mode is set explicitly in every test rather than
 *   inherited, since other suites share this DB and leave their own mode behind.
 * - Assertions are scoped to this file's own filterId / cycleId (membership,
 *   never ambient counts).
 * - Teardown leaves audit_trail rows: `audit_trail_no_delete` rejects deletes
 *   by design (21 CFR §11.10(e)).
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
const AIA_USERNAME = `AIAG${SUFFIX}`.slice(0, 16).toUpperCase();
const AIA_PASSWORD = 'AiaGate@Digilog#3';
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

describe('AHU INTERLOCK is enforced on the advance path (checklist-less pipeline)', () => {
  let app: FastifyInstance;
  let authHeaders: Record<string, string>;

  let ahuTemplateId = '';
  let filterTemplateId = '';
  let checklistProfileId = '';
  let ahuId = '';
  let filterId = '';          // the filter under test
  let siblingId = '';         // its AHU sibling — the one that blocks
  let noClProfileId = '';     // START → S1 → S2 → END           (S2 terminal, NO checklist)
  let withClProfileId = '';   // START → T1 → T2 → CHECKLIST → END (T2 terminal, checklist)
  let filterProfileId = '';
  let cycleId = '';

  const setMode = (mode: 'NONE' | 'POPUP' | 'INTERLOCK') =>
    prisma.systemConfig.upsert({
      where: { configKey: 'ahu-completion-process' },
      update: { configValue: { mode } as any },
      create: { configKey: 'ahu-completion-process', configValue: { mode } as any, configType: 'filter-management' },
    });

  /** Sibling has NOT reached final — under INTERLOCK it must block completion. */
  const siblingPending = () =>
    prisma.filterDetails.update({
      where: { assetInstanceId: siblingId },
      data: { currentCycleId: null, currentLifecycleState: null },
    });
  /** Sibling finished its cycle — nothing left to block on. */
  const siblingDone = () =>
    prisma.filterDetails.update({
      where: { assetInstanceId: siblingId },
      data: { currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' },
    });

  /** Live tape version — every write must carry a fresh one (409 STALE_TAPE otherwise). */
  async function freshTape(id = filterId): Promise<number> {
    const res = await app.inject({ method: 'GET', url: `/api/filters/${id}/current-state`, headers: authHeaders });
    expect(res.statusCode).toBe(200);
    return res.json().tapeVersion as number;
  }

  const advance = async (targetState: string) =>
    app.inject({
      method: 'POST',
      url: `/api/filters/${filterId}/advance`,
      headers: authHeaders,
      payload: { targetState, tapeVersion: await freshTape(), _currentPassword: AIA_PASSWORD },
    });

  /** Fresh cycle on the filter under test, parked at S1 (one advance short of terminal). */
  async function startAndParkAtS1() {
    await prisma.filterEvent.deleteMany({ where: { filterId } });
    await prisma.cleaningCycle.deleteMany({ where: { filterId } });
    await prisma.filterDetails.update({
      where: { assetInstanceId: filterId },
      data: { currentCycleId: null, currentLifecycleState: null },
    });
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterId}/start-cycle`,
      headers: authHeaders,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: AIA_PASSWORD },
    });
    expect(startRes.statusCode).toBe(201);
    cycleId = startRes.json().id as string;
    const toS1 = await advance('S1');
    expect(toS1.statusCode).toBe(200);
  }

  beforeAll(async () => {
    const passwordHash = await hashPassword(AIA_PASSWORD);
    await prisma.user.upsert({
      where: { username: AIA_USERNAME },
      update: {
        passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false,
        failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null,
      },
      create: {
        username: AIA_USERNAME,
        fullName: 'AHU Interlock Advance Gate Test',
        email: `${AIA_USERNAME.toLowerCase()}@aia-test.local`,
        passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false,
        createdBy: 'aia-test',
      },
    });

    for (const code of ['AHU', 'FILTER'] as const) {
      await prisma.templateKind.upsert({
        where: { code },
        update: {},
        create: { code, label: code, isSystem: true },
      });
    }
    ahuTemplateId = (await prisma.assetTemplate.create({
      data: { name: `AIA AHU Tpl ${SUFFIX}`, templateKind: 'AHU' },
    })).id;
    filterTemplateId = (await prisma.assetTemplate.create({
      data: { name: `AIA Filter Tpl ${SUFFIX}`, templateKind: 'FILTER' },
    })).id;

    // ── Pipeline A: START → S1 → S2 → END. No checklist anywhere. ─────────────
    // S2 is terminal AND checklist-less, so advance() itself completes the
    // cycle — the shape the old gate could not see.
    const noCl = await prisma.filterCleaningProfile.create({
      data: {
        name: `AIA No-Checklist Profile ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        cleaningReasons: [{ key: REASON_KEY, name: 'Routine', requiresJustification: false }],
        stages: {
          create: [
            { nodeType: 'START', stateKey: null, sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 2 },
            { nodeType: 'END', stateKey: null, sortOrder: 3 },
          ],
        },
      },
      include: { stages: true },
    });
    noClProfileId = noCl.id;
    {
      const n = (k: string) => noCl.stages.find(s => (s.stateKey ?? s.nodeType) === k)!;
      await prisma.filterPipelineConnection.createMany({
        data: [
          { profileId: noClProfileId, fromStageId: n('START').id, toStageId: n('S1').id },
          { profileId: noClProfileId, fromStageId: n('S1').id, toStageId: n('S2').id },
          { profileId: noClProfileId, fromStageId: n('S2').id, toStageId: n('END').id },
        ],
      });
    }

    // ── Pipeline B: START → T1 → T2 → CHECKLIST(active) → END ─────────────────
    // Used only by the mutual-exclusivity test: submit-checklist owns this one,
    // so advance must NOT gate it.
    const cpProfile = await prisma.checklistProfile.create({
      data: {
        name: `AIA Terminal CP ${SUFFIX}`,
        isActive: true,
        questions: {
          create: [{ question: 'Final inspection done?', questionType: 'YES_NO', required: true, sortOrder: 1 }],
        },
      },
    });
    checklistProfileId = cpProfile.id;
    const withCl = await prisma.filterCleaningProfile.create({
      data: {
        name: `AIA With-Checklist Profile ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        cleaningReasons: [{ key: REASON_KEY, name: 'Routine', requiresJustification: false }],
        stages: {
          create: [
            { nodeType: 'START', stateKey: null, sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'T1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'T2', sortOrder: 2 },
            { nodeType: 'CHECKLIST', stateKey: null, sortOrder: 3, configuration: { checklistProfileId } },
            { nodeType: 'END', stateKey: null, sortOrder: 4 },
          ],
        },
      },
      include: { stages: true },
    });
    withClProfileId = withCl.id;
    {
      const n = (k: string) => withCl.stages.find(s => (s.stateKey ?? s.nodeType) === k)!;
      await prisma.filterPipelineConnection.createMany({
        data: [
          { profileId: withClProfileId, fromStageId: n('START').id, toStageId: n('T1').id },
          { profileId: withClProfileId, fromStageId: n('T1').id, toStageId: n('T2').id },
          { profileId: withClProfileId, fromStageId: n('T2').id, toStageId: n('CHECKLIST').id },
          { profileId: withClProfileId, fromStageId: n('CHECKLIST').id, toStageId: n('END').id },
        ],
      });
    }

    // Direct binding — without it, resolveFilterProfile falls back to "first
    // ACTIVE cleaning profile" and could pick up another suite's fixture.
    filterProfileId = (await prisma.filterProfile.create({
      data: { name: `AIA FP ${SUFFIX}`, cleaningProfileId: noClProfileId },
    })).id;

    // ── AHU with two filters underneath ───────────────────────────────────────
    ahuId = (await prisma.assetInstance.create({
      data: { name: `AIA-AHU-${SUFFIX}`, templateId: ahuTemplateId },
    })).id;
    filterId = (await prisma.assetInstance.create({
      data: { name: `AIA-Filter-${SUFFIX}`, templateId: filterTemplateId, parentId: ahuId },
    })).id;
    siblingId = (await prisma.assetInstance.create({
      data: { name: `AIA-Sibling-${SUFFIX}`, templateId: filterTemplateId, parentId: ahuId },
    })).id;
    await prisma.filterDetails.create({
      data: { assetInstanceId: filterId, filterProfileId, currentCycleId: null, currentLifecycleState: null },
    });
    await prisma.filterDetails.create({
      data: { assetInstanceId: siblingId, filterProfileId, currentCycleId: null, currentLifecycleState: null },
    });

    app = await buildApp();
    const token = await loginAs(app, AIA_USERNAME, AIA_PASSWORD);
    authHeaders = { authorization: `Bearer ${token}` };
  }, 60_000);

  afterAll(async () => {
    try {
      await setMode('NONE');
      for (const id of [filterId, siblingId].filter(Boolean)) {
        await prisma.filterEvent.deleteMany({ where: { filterId: id } });
        await prisma.cleaningCycle.deleteMany({ where: { filterId: id } });
        await prisma.filterDetails.deleteMany({ where: { assetInstanceId: id } });
      }
      for (const id of [filterId, siblingId, ahuId].filter(Boolean)) {
        await prisma.assetInstance.delete({ where: { id } }).catch(() => undefined);
      }
      if (filterProfileId) await prisma.filterProfile.delete({ where: { id: filterProfileId } }).catch(() => undefined);
      for (const id of [noClProfileId, withClProfileId].filter(Boolean)) {
        await prisma.filterCleaningProfile.delete({ where: { id } }).catch(() => undefined);
      }
      if (checklistProfileId) await prisma.checklistProfile.delete({ where: { id: checklistProfileId } }).catch(() => undefined);
      for (const id of [filterTemplateId, ahuTemplateId].filter(Boolean)) {
        await prisma.assetTemplate.delete({ where: { id } }).catch(() => undefined);
      }
    } catch { /* swallow — cleanup must never mask a real failure */ }
    try { await app.close(); } catch { /* swallow */ }
  }, 30_000);

  // ───────────────────────────────────────────────────────────────────────────
  // THE REGRESSION. Before 2026-08-10 this advance returned 200 and completed
  // the cycle with a sibling still mid-cleaning — INTERLOCK enforced nowhere.
  // ───────────────────────────────────────────────────────────────────────────
  it('INTERLOCK: the completing advance is rejected 422 while a sibling is pending', async () => {
    await setMode('INTERLOCK');
    await siblingPending();
    await startAndParkAtS1();

    const res = await advance('S2');

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('AHU_INTERLOCK_PENDING');
    // The dialog payload the client renders from.
    const details = res.json().details ?? {};
    expect(details.pendingFilters.map((p: any) => p.id)).toContain(siblingId);
    expect(details.currentFilterId).toBe(filterId);
  });

  it('INTERLOCK: the rejected advance wrote NOTHING — gate runs before the transaction', async () => {
    // Placement matters: the assert sits in prepareAdvance, before the returned
    // plan, so a 422 cannot leave a half-applied transition behind in the
    // immutable filter_events log or move the live state.
    const evt = await prisma.filterEvent.findFirst({
      where: { filterId, cycleId, eventType: 'STATE_TRANSITION', toState: 'S2' },
    });
    expect(evt).toBeNull();

    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterId } });
    expect(details!.currentLifecycleState).toBe('S1');

    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(cycle!.status).toBe('IN_PROGRESS');
    expect(cycle!.completedAt).toBeNull();
  });

  it('INTERLOCK: an INTERMEDIATE advance is never gated, even with a sibling pending', async () => {
    // Only the advance that COMPLETES the cycle is gated. Gating S1 too would
    // deadlock the AHU — no filter could reach final, so none ever could.
    await setMode('INTERLOCK');
    await siblingPending();
    await startAndParkAtS1(); // START → S1 with the sibling pending throughout

    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterId } });
    expect(details!.currentLifecycleState).toBe('S1');
  });

  it('INTERLOCK: the same advance succeeds and completes the cycle once the sibling is done', async () => {
    await setMode('INTERLOCK');
    await siblingDone();
    await startAndParkAtS1();

    const res = await advance('S2');
    expect(res.statusCode).toBe(200);

    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(cycle!.status).toBe('COMPLETED');
    expect(cycle!.completedAt).not.toBeNull();
    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterId } });
    expect(details!.currentLifecycleState).toBe('CLEANING_CYCLE_COMPLETED');
  });

  it('POPUP: the server does NOT gate — the warning is client-side only', async () => {
    await setMode('POPUP');
    await siblingPending();
    await startAndParkAtS1();

    const res = await advance('S2');
    expect(res.statusCode).toBe(200);
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(cycle!.status).toBe('COMPLETED');
  });

  it('NONE: the server does NOT gate', async () => {
    await setMode('NONE');
    await siblingPending();
    await startAndParkAtS1();

    const res = await advance('S2');
    expect(res.statusCode).toBe(200);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Mutual exclusivity. If this ever fails, the advance gate has started firing
  // on pipelines submit-checklist owns → operators get a 422 at the terminal
  // advance AND a second one at the checklist submit.
  // ───────────────────────────────────────────────────────────────────────────
  it('INTERLOCK: an advance into a stage followed by an ACTIVE checklist is NOT gated by advance', async () => {
    await setMode('INTERLOCK');
    await siblingPending();
    // Repoint this filter at the with-checklist pipeline: T2 is terminal but a
    // live CHECKLIST sits between it and END, so `completesCycle` is false and
    // the gate belongs to submit-checklist, not here.
    await prisma.filterProfile.update({
      where: { id: filterProfileId },
      data: { cleaningProfileId: withClProfileId },
    });
    try {
      await prisma.filterEvent.deleteMany({ where: { filterId } });
      await prisma.cleaningCycle.deleteMany({ where: { filterId } });
      await prisma.filterDetails.update({
        where: { assetInstanceId: filterId },
        data: { currentCycleId: null, currentLifecycleState: null },
      });
      const startRes = await app.inject({
        method: 'POST',
        url: `/api/filters/${filterId}/start-cycle`,
        headers: authHeaders,
        payload: { cleaningReasonKey: REASON_KEY, _currentPassword: AIA_PASSWORD },
      });
      expect(startRes.statusCode).toBe(201);
      cycleId = startRes.json().id as string;

      expect((await advance('T1')).statusCode).toBe(200);
      // The terminal advance. Sibling is still pending, yet this must pass —
      // the checklist defers completion, so this advance completes nothing.
      const toT2 = await advance('T2');
      expect(toT2.statusCode).toBe(200);
      expect(toT2.json().currentState).toBe('T2');

      // ...and it genuinely did not complete: submit-checklist still owns that,
      // and its own gate will reject while the sibling is pending.
      const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
      expect(cycle!.status).toBe('IN_PROGRESS');
      expect(cycle!.completedAt).toBeNull();
    } finally {
      await prisma.filterProfile.update({
        where: { id: filterProfileId },
        data: { cleaningProfileId: noClProfileId },
      });
    }
  });
});
