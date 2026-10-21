/**
 * Terminal checklist: a BARE advance into the final stage is refused (A-01, FIXED 2026-10-21).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The defect (2026-07-15 → 2026-10-21)
 * ------------------------------------
 * `advance()` persisted the stage transition BEFORE the operator's mandatory
 * terminal checklist: a checksummed STATE_TRANSITION `filter_events` row, the
 * FilterDetails state and a hash-chained `audit_trail` row - while Close on the
 * checklist dialog sends nothing. A §11 record of an attestation that may never
 * come. Clients moved to dialog-first `advance-with-checklist` on 2026-07-16;
 * Phase 2 of tasks/ATOMIC-ADVANCE-CHECKLIST-PLAN.md (operator decision
 * 2026-10-21) now REFUSES the bare route online: 409 CHECKLIST_REQUIRED.
 *
 * This file used to pass by asserting the bug. Its (a), (b), (d) are now flipped
 * exactly as the old header prescribed (nothing persisted); (c) and (e) are
 * unchanged; the completion test now goes through the atomic route. Not covered
 * here (separate tests): the QA-interlock final stage, where the bare advance is
 * still the correct first step (ahu/advance-with-checklist suites), and offline
 * replay, which is let through with `replayExemptGates: TERMINAL_CHECKLIST`.
 *
 * Test-infra notes
 * ----------------
 * - Real Fastify (in-process `inject()`), real Prisma, real auth. Pattern copied
 *   from `without-final-checklist.test.ts` + `ahu-completion-gate.e2e.test.ts`.
 * - Unique SUPER_ADMIN per file (filename + timestamp) so the shared-`admin`
 *   login race can't touch us. Runs against `digilog_test_db` (vitest.env.ts).
 * - Reauth is satisfied with `_currentPassword` in the body — NOT the
 *   offline-replay grant, which would set `isOfflineReplay=true` and take a
 *   different code path through advance(). This test is the ONLINE operator.
 * - The filter is deliberately parented to NOTHING, so `resolveAhuId` returns
 *   null and `assertAhuInterlockSatisfied` short-circuits regardless of whatever
 *   `ahu-completion-process` mode another suite has left in the shared test DB.
 * - Every assertion is scoped by this file's own filterId / cycleId
 *   (membership, not ambient counts) so concurrent suites cannot skew it.
 * - Teardown does NOT delete audit_trail rows: the `audit_trail_no_delete`
 *   immutability trigger rejects them by design.
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
import { loginAs, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { randomUUID } from 'node:crypto';

// ── Unique test user (file name + timestamp) ─────────────────────────────────
const SUFFIX = Date.now().toString(36).slice(-4).toUpperCase();
const TCA_USERNAME = `TCAP${SUFFIX}`.slice(0, 16).toUpperCase();
const TCA_PASSWORD = 'TcaTest@Digilog#7';

const REASON_KEY = 'ROUTINE';

async function buildApp(): Promise<FastifyInstance> {
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

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
  await app.ready();
  return app;
}

describe('a bare advance into the final stage is refused until its checklist is answered (A-01)', () => {
  let app: FastifyInstance;
  let authHeaders: Record<string, string>;

  let filterTemplateId = '';
  let checklistProfileId = '';
  let checklistQuestionId = '';
  let cleaningProfileId = '';
  let filterProfileId = '';
  let filterId = '';
  let cycleId = '';
  let sessionToken = '';

  /** GET the live tape version — every write must carry a fresh one (409 STALE_TAPE otherwise). */
  async function freshTape(): Promise<number> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/filters/${filterId}/current-state`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    return res.json().tapeVersion as number;
  }

  beforeAll(async () => {
    // ── Unique SUPER_ADMIN ────────────────────────────────────────────────────
    const passwordHash = await hashPassword(TCA_PASSWORD);
    await prisma.user.upsert({
      where: { username: TCA_USERNAME },
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
        username: TCA_USERNAME,
        fullName: 'Terminal Checklist Advance Test',
        email: `${TCA_USERNAME.toLowerCase()}@tca-test.local`,
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ENABLED',
        forcePasswordChange: false,
        isTemporaryPassword: false,
        createdBy: 'tca-test',
      },
    });

    // ── Template kind + asset template ────────────────────────────────────────
    await prisma.templateKind.upsert({
      where: { code: 'FILTER' },
      update: {},
      create: { code: 'FILTER', label: 'Filter', isSystem: true },
    });
    filterTemplateId = (await prisma.assetTemplate.create({
      data: { name: `TCA Filter Tpl ${SUFFIX}`, templateKind: 'FILTER' },
    })).id;

    // ── ACTIVE checklist profile with one REQUIRED question ───────────────────
    // isActive:true is load-bearing: advance.ts:381-385 only defers completion
    // for CHECKLIST nodes whose referenced profile is active.
    const cpProfile = await prisma.checklistProfile.create({
      data: {
        name: `TCA Terminal CP ${SUFFIX}`,
        isActive: true,
        questions: {
          create: [
            {
              question: 'Was the filter visually inspected after the final stage?',
              questionType: 'YES_NO',
              required: true,
              sortOrder: 1,
            },
          ],
        },
      },
      include: { questions: true },
    });
    checklistProfileId = cpProfile.id;
    checklistQuestionId = cpProfile.questions[0].id;

    // ── Cleaning profile: START → S1 → S2 → CHECKLIST(active) → END ───────────
    // S2 is the TERMINAL stage and carries the mandatory terminal checklist.
    const cleaning = await prisma.filterCleaningProfile.create({
      data: {
        name: `TCA Cleaning Profile ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        // Own the reason list so start-cycle doesn't depend on ambient config.
        cleaningReasons: [{ key: REASON_KEY, name: 'Routine', requiresJustification: false }],
        stages: {
          create: [
            { nodeType: 'START', stateKey: null, sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 2 },
            {
              nodeType: 'CHECKLIST',
              stateKey: null,
              sortOrder: 3,
              configuration: { checklistProfileId },
            },
            { nodeType: 'END', stateKey: null, sortOrder: 4 },
          ],
        },
      },
      include: { stages: true },
    });
    cleaningProfileId = cleaning.id;

    const start = cleaning.stages.find(s => s.nodeType === 'START')!;
    const s1 = cleaning.stages.find(s => s.stateKey === 'S1')!;
    const s2 = cleaning.stages.find(s => s.stateKey === 'S2')!;
    const cl = cleaning.stages.find(s => s.nodeType === 'CHECKLIST')!;
    const end = cleaning.stages.find(s => s.nodeType === 'END')!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId: cleaningProfileId, fromStageId: start.id, toStageId: s1.id },
        { profileId: cleaningProfileId, fromStageId: s1.id, toStageId: s2.id },
        { profileId: cleaningProfileId, fromStageId: s2.id, toStageId: cl.id },
        { profileId: cleaningProfileId, fromStageId: cl.id, toStageId: end.id },
      ],
    });

    // ── FilterProfile (binds the filter to the cleaning pipeline) ─────────────
    filterProfileId = (await prisma.filterProfile.create({
      data: { name: `TCA FP ${SUFFIX}`, cleaningProfileId },
    })).id;

    // ── Filter instance — NO parent, so the AHU interlock never engages ───────
    filterId = (await prisma.assetInstance.create({
      data: { name: `TCA-Filter-${SUFFIX}`, templateId: filterTemplateId },
    })).id;

    // Direct binding: without filterProfileId, resolveFilterProfile falls back to
    // "first ACTIVE cleaning profile, oldest first" and could pick up another
    // suite's fixture in the shared test DB.
    await prisma.filterDetails.create({
      data: {
        assetInstanceId: filterId,
        filterProfileId,
        currentCycleId: null,
        currentLifecycleState: null,
      },
    });

    app = await buildApp();
    const token = await loginAs(app, TCA_USERNAME, TCA_PASSWORD);
    authHeaders = { authorization: `Bearer ${token}` };
    sessionToken = token;
  }, 60_000);

  afterAll(async () => {
    // FK-safe order: filter_events → cleaning_cycles → filter_details →
    // asset_instance → filter_profile → filter_cleaning_profile (cascades
    // stages/connections) → checklist_profile (cascades questions) → template.
    // audit_trail rows are intentionally left: the `audit_trail_no_delete`
    // immutability trigger rejects deletes (21 CFR §11.10(e)).
    try {
      if (filterId) await prisma.filterEvent.deleteMany({ where: { filterId } });
      if (filterId) await prisma.cleaningCycle.deleteMany({ where: { filterId } });
      if (filterId) await prisma.filterDetails.deleteMany({ where: { assetInstanceId: filterId } });
      if (filterId) await prisma.assetInstance.delete({ where: { id: filterId } }).catch(() => undefined);
      if (filterProfileId) await prisma.filterProfile.delete({ where: { id: filterProfileId } }).catch(() => undefined);
      if (cleaningProfileId) await prisma.filterCleaningProfile.delete({ where: { id: cleaningProfileId } }).catch(() => undefined);
      if (checklistProfileId) await prisma.checklistProfile.delete({ where: { id: checklistProfileId } }).catch(() => undefined);
      if (filterTemplateId) await prisma.assetTemplate.delete({ where: { id: filterTemplateId } }).catch(() => undefined);
    } catch { /* swallow — cleanup must never mask a real failure */ }
    try { await app.close(); } catch { /* swallow */ }
  }, 30_000);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 1 — drive the filter to the TERMINAL stage S2 and STOP.
  // The operator sees the checklist dialog only after this advance committed,
  // and presses Close — which makes NO API call. So the test makes none either.
  // ───────────────────────────────────────────────────────────────────────────
  it('advances START → S1; the bare terminal advance to S2 is refused with 409 CHECKLIST_REQUIRED', async () => {
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterId}/start-cycle`,
      headers: authHeaders,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: TCA_PASSWORD },
    });
    expect(startRes.statusCode).toBe(201);
    cycleId = startRes.json().id as string;
    expect(cycleId).toBeTruthy();

    const toS1 = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterId}/advance`,
      headers: authHeaders,
      payload: { targetState: 'S1', tapeVersion: await freshTape(), _currentPassword: TCA_PASSWORD },
    });
    expect(toS1.statusCode).toBe(200);
    expect(toS1.json().currentState).toBe('S1');

    // The bare terminal advance. advance.ts sees S2 → CHECKLIST(active) → END
    // (hasPendingChecklistAfterTarget) and, not composed, refuses it.
    const toS2 = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterId}/advance`,
      headers: authHeaders,
      payload: { targetState: 'S2', tapeVersion: await freshTape(), _currentPassword: TCA_PASSWORD },
    });
    expect(toS2.statusCode).toBe(409);
    expect(toS2.json().error).toBe('CHECKLIST_REQUIRED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 2 — what is now permanently on record.
  // ───────────────────────────────────────────────────────────────────────────

  it('(a) FIXED: no STATE_TRANSITION FilterEvent to S2 was persisted', async () => {
    // DOCUMENTS BUGGY BEHAVIOUR.
    // advance.ts:455 wrote this row inside the tx, before the operator had any
    // opportunity to answer the mandatory terminal checklist. filter_events is
    // an immutable, checksummed 21 CFR §11 log — this row now asserts, forever,
    // that the filter entered its final cleaning stage.
    //
    // AFTER THE FIX: this must become `expect(evt).toBeNull()`.
    const evt = await prisma.filterEvent.findFirst({
      where: { filterId, cycleId, eventType: 'STATE_TRANSITION', toState: 'S2' },
    });
    expect(evt).toBeNull();
  });

  it('(b) FIXED: FilterDetails.currentLifecycleState is still S1', async () => {
    // DOCUMENTS BUGGY BEHAVIOUR.
    // advance.ts:474. The live filter state says "at the final stage" while the
    // attestation that gates that stage has never been given.
    //
    // AFTER THE FIX: this must become `expect(details!.currentLifecycleState).toBe('S1')`.
    const details = await prisma.filterDetails.findUnique({
      where: { assetInstanceId: filterId },
    });
    expect(details!.currentLifecycleState).toBe('S1');
  });

  it('(c) CORRECT: no CHECKLIST_COMPLETED event exists for this cycle', async () => {
    // DOCUMENTS CORRECT BEHAVIOUR — and is the whole point of (a),(b),(d):
    // the checklist genuinely was never answered, so the records above are
    // asserting a stage entry whose mandatory attestation does not exist.
    // Must keep passing after the fix.
    const completed = await prisma.filterEvent.count({
      where: { filterId, cycleId, eventType: 'CHECKLIST_COMPLETED' },
    });
    expect(completed).toBe(0);
  });

  it('(d) FIXED: no audit_trail STATE_TRANSITION row to S2 was written', async () => {
    // DOCUMENTS BUGGY BEHAVIOUR.
    // advance.ts:531 wrote this inside the same tx. audit_trail is hash-chained
    // and delete-protected: this §11 record cannot be withdrawn if the operator
    // never comes back to answer the checklist.
    //
    // AFTER THE FIX: this must become `expect(row).toBeNull()`.
    const row = await prisma.auditTrail.findFirst({
      where: {
        action: 'STATE_TRANSITION',
        targetType: 'filter',
        targetId: filterId,
        afterValue: { path: ['state'], equals: 'S2' },
      },
    });
    expect(row).toBeNull();
  });

  it('(e) CORRECT: the cycle stays IN_PROGRESS with completed_at NULL — completion is deferred', async () => {
    // DOCUMENTS CORRECT BEHAVIOUR. This is the half advance.ts gets right:
    // hasPendingChecklistAfterTarget (advance.ts:376-395) sees the ACTIVE
    // CHECKLIST between S2 and END → willComplete=false → the completion block
    // (:492-528) is skipped. The cycle does NOT falsely complete.
    // Asserted here so the later atomic-advance fix cannot regress it.
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(cycle!.status).toBe('IN_PROGRESS');
    expect(cycle!.completedAt).toBeNull();

    // And no CYCLE_COMPLETED event was emitted either.
    const done = await prisma.filterEvent.count({
      where: { filterId, cycleId, eventType: 'CYCLE_COMPLETED' },
    });
    expect(done).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3 — the re-scan path: the operator comes back, scans the tag again,
  // and answers the checklist. Only NOW does the cycle complete.
  // ───────────────────────────────────────────────────────────────────────────
  it('CORRECT: the atomic advance-with-checklist enters S2 AND completes the cycle in one step', async () => {
    // DOCUMENTS CORRECT BEHAVIOUR — submitChecklist owns the deferred completion.
    // Must keep passing after the fix (though under an atomic advance+checklist
    // design the transition and this submission would land in ONE transaction).
    const res = await app.inject({
      method: 'POST',
      url: `/api/filters/${filterId}/advance-with-checklist`,
      headers: authHeaders,
      payload: {
        targetState: 'S2',
        answers: { [checklistQuestionId]: 'YES' },
        tapeVersion: await freshTape(),
        _currentPassword: TCA_PASSWORD,
      },
    });
    expect(res.statusCode).toBe(200);

    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(cycle!.status).toBe('COMPLETED');
    expect(cycle!.completedAt).not.toBeNull();

    const completedEvt = await prisma.filterEvent.findFirst({
      where: { filterId, cycleId, eventType: 'CYCLE_COMPLETED' },
    });
    expect(completedEvt).not.toBeNull();

    const checklistEvt = await prisma.filterEvent.findFirst({
      where: { filterId, cycleId, eventType: 'CHECKLIST_COMPLETED' },
    });
    expect(checklistEvt).not.toBeNull();
    expect((checklistEvt!.attributes as any).afterStage).toBe('S2');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Offline replay: a queue written by an older client may still carry a bare
  // terminal advance. It is let through (losing queued operator work would be
  // worse) but the skipped rule is RECORDED on the event, like every other
  // replay exemption (CLAUDE.md 2026-09-25).
  // ───────────────────────────────────────────────────────────────────────────
  it('offline replay of a bare terminal advance is applied but records replayExemptGates TERMINAL_CHECKLIST', async () => {
    const grant = await obtainOfflineGrant(app, sessionToken, TCA_PASSWORD);
    const restart = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/start-cycle`, headers: authHeaders,
      payload: { cleaningReasonKey: REASON_KEY, _currentPassword: TCA_PASSWORD },
    });
    expect(restart.statusCode).toBe(201);
    const secondCycle = restart.json().id as string;
    const toS1 = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/advance`, headers: authHeaders,
      payload: { targetState: 'S1', tapeVersion: await freshTape(), _currentPassword: TCA_PASSWORD },
    });
    expect(toS1.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/advance`,
      headers: { ...authHeaders, 'x-offline-replay-token': grant },
      payload: {
        targetState: 'S2', tapeVersion: await freshTape(),
        offlinePerformedAt: new Date().toISOString(), clientOpId: `tca-replay-${SUFFIX}`,
      },
    });
    expect(replay.statusCode).toBe(200);
    const evt = await prisma.filterEvent.findFirst({
      where: { filterId, cycleId: secondCycle, eventType: 'STATE_TRANSITION', toState: 'S2' },
    });
    expect(evt).not.toBeNull();
    expect((evt!.attributes as any).replayExemptGates).toContain('TERMINAL_CHECKLIST');
    // Completion is still deferred to the checklist - replay does not complete the cycle.
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: secondCycle } });
    expect(cycle!.status).toBe('IN_PROGRESS');
  });
});
