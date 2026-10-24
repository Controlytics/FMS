/**
 * Super Admin's own work is not held by the QA stage interlock (operator
 * decision 2026-10-24, lib/super-admin-own-work.ts), end to end through the
 * real routes on digilog_test_db.
 *
 * The rule is keyed on who ENTERED the gated stage:
 *   - a Super Admin's own entry into Wash Out / Dry Out raises no approval, is
 *     recorded (`superAdminExemptGates: ['INTERLOCK_ENTRY']` on the event + the
 *     audit row) and may be left by anyone;
 *   - an operator's entry still raises the approval, and a Super Admin scanning
 *     that held filter is refused like anyone else (segregation of duties and
 *     the approval itself are unchanged).
 *
 * Same module mock as stage-approvals-flow.e2e.test.ts, for the same reason:
 * `getInterlockConfig` reads the shared `system_config['stage-interlock']` row;
 * the mock turns the interlock on for THIS process and routes approvals to a
 * role this file owns. queue / list are never called as SUPER_ADMIN here (as
 * SUPER_ADMIN, queue() supersedes every orphaned PENDING in the database).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const cfg = vi.hoisted(() => ({ enabled: true, washOutApproverRole: 'UNSET', dryOutApproverRole: 'UNSET' }));
vi.mock('../stage-interlock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stage-interlock.js')>();
  return { ...actual, getInterlockConfig: async () => ({ ...cfg }) };
});

import { buildApp, internalErrors, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterOperationsRoutes from '../routes.js';
import stageApprovalRoutes from '../../stage-approvals/routes.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FSAO');
let app: FastifyInstance;
let opH: Record<string, string>;
let apr1H: Record<string, string>;
let saH: Record<string, string>;
let saGrant = '';
let B1 = ''; let FP = ''; let FP_TERM = ''; let FP_CLWO = ''; let CLQ = '';

const call = (method: 'GET' | 'POST', url: string, h: Record<string, string>, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: h, ...(payload ? { payload } : {}) });
const signed = (url: string, h: Record<string, string>, payload: Record<string, unknown> = {}) =>
  call('POST', url, h, { _currentPassword: fx.password, ...payload });
const APPROVE = { remarks: 'released' };
const state = async (id: string, h: Record<string, string>) => {
  const res = await call('GET', `/api/filters/${id}/current-state`, h);
  expect(res.statusCode).toBe(200);
  return res.json();
};
const advance = async (id: string, body: Record<string, unknown>, h: Record<string, string>) =>
  signed(`/api/filters/${id}/advance`, h, { tapeVersion: (await state(id, h)).tapeVersion, ...body });
const start = async (id: string, h: Record<string, string>) => {
  const res = await signed(`/api/filters/${id}/start-cycle`, h, { cleaningReasonKey: 'ROUTINE' });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};
const approvals = (filterId: string) => prisma.cleaningStageApproval.findMany({ where: { filterId }, orderBy: [{ attemptSeq: 'asc' }, { requestedAt: 'asc' }] });
const entryInto = (filterId: string, toState: string) => prisma.filterEvent.findFirst({
  where: { filterId, eventType: { in: ['STATE_TRANSITION', 'BYPASS_DEVIATION'] }, toState }, orderBy: { performedAt: 'desc' },
});
const lastTransitionAudit = (filterId: string) => prisma.auditTrail.findFirst({
  where: { action: 'STATE_TRANSITION', targetId: filterId }, orderBy: { chainPosition: 'desc' },
});
const lifecycle = async (filterId: string) => (await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterId } }))!.currentLifecycleState;
const actionTypes = (s: any) => (s.actions ?? []).map((a: any) => `${a.type}:${a.params?.targetState ?? ''}`);

/** A filter in its own AHU (no sibling can hold a completion gate), at Wash In. */
async function atWashIn(label: string, h: Record<string, string>, profile = FP) {
  const ahu = await fx.node('AHU', `AHU-${label}`, B1);
  const f = await fx.filter(label, ahu, profile);
  const cycleId = await start(f, h);
  expect((await advance(f, { targetState: 'WASH_IN' }, h)).statusCode).toBe(200);
  return { f, cycleId };
}

beforeAll(async () => {
  app = await buildApp([
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
    { plugin: stageApprovalRoutes, prefix: '/api/stage-approvals' },
  ]);
  const APR = await fx.role('APR', ['STAGE_APPROVAL_VIEW', 'STAGE_APPROVAL_DECIDE', 'ASSET_READ', 'FILTER_OPERATE']);
  const OPER = await fx.role('OPR', ['FILTER_OPERATE', 'FILTER_BYPASS', 'ASSET_READ']);
  cfg.washOutApproverRole = APR; cfg.dryOutApproverRole = APR;
  const op = await fx.user('op', OPER);
  const apr1 = await fx.user('apr1', APR);
  const sa = await fx.user('sa', 'SUPER_ADMIN');
  B1 = await fx.node('BLOCK', 'B1');
  const stages = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN'];
  ({ filterProfileId: FP } = await fx.pipeline({ name: 'SAI', stages }, sa.id));
  ({ filterProfileId: FP_TERM } = await fx.pipeline({ name: 'SATRM', stages: ['WASH_IN', 'WASH_OUT'] }, sa.id));
  const cl = await fx.checklist('SAWOCL', [{ question: 'Wash out inspected?' }]);
  CLQ = cl.questionIds[0];
  ({ filterProfileId: FP_CLWO } = await fx.pipeline({ name: 'SACLWO', stages: ['WASH_IN', 'WASH_OUT'], checklistAfter: { 1: cl.id } }, sa.id));
  opH = await fx.login(app, op.username);
  apr1H = await fx.login(app, apr1.username);
  saH = await fx.login(app, sa.username);
  saGrant = await obtainOfflineGrant(app, saH.authorization.slice(7), fx.password);
}, 60_000);

afterAll(async () => {
  try { await fx.cleanup(); } finally { await app?.close(); }
}, 60_000);

beforeEach(() => { internalErrors.length = 0; cfg.enabled = true; });

describe('a Super Admin\'s own entry into a gated stage', () => {
  it('raises no approval, records the skip on the event + audit row, and is not held', async () => {
    const { f } = await atWashIn('OWN', saH);
    expect((await advance(f, { targetState: 'WASH_OUT' }, saH)).statusCode).toBe(200);

    expect(await approvals(f)).toEqual([]);
    const entry = await entryInto(f, 'WASH_OUT');
    expect((entry!.attributes as any).superAdminExemptGates).toEqual(['INTERLOCK_ENTRY']);
    expect((await lastTransitionAudit(f))!.afterValue).toMatchObject({ state: 'WASH_OUT', superAdminExemptGates: ['INTERLOCK_ENTRY'] });

    // current-state: not blocking, no self-healed approval, Dry In offered.
    const s = await state(f, saH);
    expect(s.interlock).toMatchObject({ gatedStage: true, stageKey: 'WASH_OUT', blocksLeaving: false });
    expect(actionTypes(s)).toContain('SET_DRYER_DURATION:DRY_IN');
    expect(await approvals(f)).toEqual([]);

    const leave = await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 }, saH);
    expect(leave.statusCode).toBe(200);
    expect(await lifecycle(f)).toBe('DRY_IN');
    expect(internalErrors).toEqual([]);
  });

  it('may be continued by an operator — the gate is keyed on who ENTERED the stage', async () => {
    const { f } = await atWashIn('HANDOVER', saH);
    expect((await advance(f, { targetState: 'WASH_OUT' }, saH)).statusCode).toBe(200);
    const s = await state(f, opH);
    expect(s.interlock.blocksLeaving).toBe(false);
    expect((await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 }, opH)).statusCode).toBe(200);
    expect(await approvals(f)).toEqual([]);
  });

  it('a last gated stage with nothing after it completes the cycle on the entry, recorded INTERLOCK_TERMINAL', async () => {
    const { f, cycleId } = await atWashIn('TERM', saH, FP_TERM);
    const res = await advance(f, { targetState: 'WASH_OUT' }, saH);
    expect(res.statusCode).toBe(200);
    expect(await approvals(f)).toEqual([]);
    expect((await prisma.cleaningCycle.findUnique({ where: { id: cycleId } }))!.status).toBe('COMPLETED');
    expect(((await entryInto(f, 'WASH_OUT'))!.attributes as any).superAdminExemptGates).toEqual(['INTERLOCK_TERMINAL']);
  });

  it('a last gated stage with a checklist after it: bare entry (same call shape as everyone), then the checklist completes the cycle', async () => {
    const { f } = await atWashIn('CLWO', saH, FP_CLWO);
    expect((await advance(f, { targetState: 'WASH_OUT' }, saH)).statusCode).toBe(200);
    expect(await approvals(f)).toEqual([]);
    const s = await state(f, saH);
    expect(s.interlock.blocksLeaving).toBe(false);
    expect(actionTypes(s).some((t: string) => t.startsWith('SUBMIT_CHECKLIST'))).toBe(true);
    const done = await signed(`/api/filters/${f}/submit-checklist`, saH, { answers: { [CLQ]: 'YES' }, tapeVersion: s.tapeVersion });
    expect(done.statusCode).toBe(200);
    expect(await lifecycle(f)).toBe('CLEANING_CYCLE_COMPLETED');
  });

  it('AHU INTERLOCK: a Super Admin\'s completing checklist is not held by a pending sibling, and records AHU_COMPLETION', async () => {
    // The AHU-completion mode is the shared system_config row, which the gate reads
    // from inside its own module; set it for this test and put it back after.
    const before = await prisma.systemConfig.findUnique({ where: { configKey: 'ahu-completion-process' } });
    await prisma.systemConfig.upsert({
      where: { configKey: 'ahu-completion-process' },
      update: { configValue: { mode: 'INTERLOCK' } as any },
      create: { configKey: 'ahu-completion-process', configValue: { mode: 'INTERLOCK' } as any, configType: 'filter-management' },
    });
    try {
      const ahu = await fx.node('AHU', 'AHU-AHUCL', B1);
      const f = await fx.filter('AHUCL', ahu, FP_CLWO);
      await fx.filter('AHUCL-SIB', ahu, FP_CLWO); // never started: a pending sibling
      await start(f, saH);
      expect((await advance(f, { targetState: 'WASH_IN' }, saH)).statusCode).toBe(200);
      expect((await advance(f, { targetState: 'WASH_OUT' }, saH)).statusCode).toBe(200);
      const s = await state(f, saH);
      const done = await signed(`/api/filters/${f}/submit-checklist`, saH, { answers: { [CLQ]: 'YES' }, tapeVersion: s.tapeVersion });
      expect(done.statusCode).toBe(200);
      expect(await lifecycle(f)).toBe('CLEANING_CYCLE_COMPLETED');
      const cl = await prisma.filterEvent.findFirst({ where: { filterId: f, eventType: 'CHECKLIST_COMPLETED' } });
      expect((cl!.attributes as any).superAdminExemptGates).toEqual(['AHU_COMPLETION']);
      const audit = await prisma.auditTrail.findFirst({ where: { action: 'CHECKLIST_COMPLETED', targetId: f }, orderBy: { chainPosition: 'desc' } });
      expect(audit!.afterValue).toMatchObject({ superAdminExemptGates: ['AHU_COMPLETION'] });
    } finally {
      if (before) await prisma.systemConfig.update({ where: { configKey: 'ahu-completion-process' }, data: { configValue: before.configValue as any } });
      else await prisma.systemConfig.delete({ where: { configKey: 'ahu-completion-process' } });
    }
  });

  it('a re-entry after an operator\'s REJECTED attempt is not held by that old rejection', async () => {
    const { f } = await atWashIn('REJ', opH);
    expect((await advance(f, { targetState: 'WASH_OUT' }, opH)).statusCode).toBe(200);
    const [row] = await approvals(f);
    expect((await signed(`/api/stage-approvals/${row.id}/reject`, apr1H, { remarks: 'not clean' })).statusCode).toBe(200);
    expect(await lifecycle(f)).toBe('WASH_IN');
    expect((await advance(f, { targetState: 'WASH_OUT' }, saH)).statusCode).toBe(200);
    expect((await approvals(f)).map((a) => a.status)).toEqual(['REJECTED']);
    expect((await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 }, saH)).statusCode).toBe(200);
  });
});

describe('what does NOT change', () => {
  it('a Super Admin scanning an operator\'s held filter is refused until the approver signs', async () => {
    const { f } = await atWashIn('HELD', opH);
    expect((await advance(f, { targetState: 'WASH_OUT' }, opH)).statusCode).toBe(200);
    const [row] = await approvals(f);
    expect(row.status).toBe('PENDING');
    expect((await state(f, saH)).interlock.blocksLeaving).toBe(true);
    const refused = await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 }, saH);
    expect([refused.statusCode, refused.json().error]).toEqual([423, 'STAGE_APPROVAL_PENDING']);
    expect((await signed(`/api/stage-approvals/${row.id}/approve`, apr1H, APPROVE)).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 }, saH)).statusCode).toBe(200);
  });

  it('with the interlock off nothing is skipped, so nothing is recorded', async () => {
    cfg.enabled = false;
    const { f } = await atWashIn('OFF', saH);
    expect((await advance(f, { targetState: 'WASH_OUT' }, saH)).statusCode).toBe(200);
    expect((await entryInto(f, 'WASH_OUT'))!.attributes as any).not.toHaveProperty('superAdminExemptGates');
  });

  it('a Super Admin\'s OFFLINE replay keeps the replay rule (replayExemptGates), not this one', async () => {
    const { f } = await atWashIn('REPLAY', saH);
    const res = await app.inject({
      method: 'POST', url: `/api/filters/${f}/advance`, headers: { ...saH, 'x-offline-replay-token': saGrant },
      payload: { offlinePerformedAt: new Date().toISOString(), clientOpId: randomUUID(), tapeVersion: (await state(f, saH)).tapeVersion, targetState: 'WASH_OUT' },
    });
    expect(res.statusCode).toBe(200);
    const attrs = (await entryInto(f, 'WASH_OUT'))!.attributes as any;
    expect(attrs.replayExemptGates).toEqual(['REAUTH', 'INTERLOCK_ENTRY']);
    expect(attrs).not.toHaveProperty('superAdminExemptGates');
  });
});
