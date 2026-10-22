/**
 * Route-level gates of /api/filters and /api/stage-approvals that the other
 * coverage suites pass through without exercising (coverage suite, 2026-10-21):
 *  - the per-action re-auth signature on every cycle write, for a role whose
 *    policy demands it (missing password, wrong password, right password);
 *  - unknown filters, filters with no profile, the batch-states fan-out and the
 *    AHU completion-status query options;
 *  - bulk-operate's start half with and without its own payload.
 *
 * Re-auth policy: keys are MERGED into the shared `action-reauth` row for a role
 * this file creates, and removed again by re-reading the row (owned-fixtures'
 * addReauth / removeReauth), so no other role's policy changes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import { addReauth, removeReauth, type ReauthGrant } from '../../../e2e/support/owned-fixtures.js';
import filterOperationsRoutes from '../routes.js';
import filterEventsRoutes from '../events-routes.js';
import stageApprovalRoutes from '../../stage-approvals/routes.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FOG');
let app: FastifyInstance;
let GATE = '';
let gateH: Record<string, string>;
let saH: Record<string, string>;
const GATED_ACTIONS = ['START_CLEANING_CYCLE', 'ADVANCE_FILTER_STAGE', 'SUBMIT_CHECKLIST_WITH_SIGNATURE', 'BYPASS_FILTER_STAGE',
  'TERMINATE_CLEANING_CYCLE', 'RETIRE_FILTER', 'REPLACE_FILTER'];
/** This file's role on every gated action. The role is ours alone, so removing all of it is safe. */
const policy = (): ReauthGrant => GATED_ACTIONS.map((a) => [a, GATE] as [string, string]);
let B1 = ''; let AHU1 = ''; let FP = ''; let FP_BYP = ''; let FP_CL = ''; let CLQ = '';

const call = (method: 'GET' | 'POST', url: string, h: Record<string, string>, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: h, ...(payload ? { payload } : {}) });
const state = async (id: string, h = saH) => (await call('GET', `/api/filters/${id}/current-state`, h)).json();

beforeAll(async () => {
  app = await buildApp([
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
    { plugin: filterEventsRoutes, prefix: '/api/filters' },
    { plugin: stageApprovalRoutes, prefix: '/api/stage-approvals' },
  ]);
  GATE = await fx.role('GATE', ['FILTER_OPERATE', 'FILTER_BYPASS', 'FILTER_RETIRE', 'FILTER_REPLACE', 'ASSET_READ', 'STAGE_APPROVAL_DECIDE']);
  const gate = await fx.user('gate', GATE);
  const sa = await fx.user('sa', 'SUPER_ADMIN');
  B1 = await fx.node('BLOCK', 'B1');
  AHU1 = await fx.node('AHU', 'AHU1', B1);
  ({ filterProfileId: FP } = await fx.pipeline({ name: 'G', stages: ['WASH_IN', 'WASH_OUT'] }, sa.id));
  ({ filterProfileId: FP_BYP } = await fx.pipeline({ name: 'GB', stages: ['WASH_IN', 'WASH_OUT'], flowMode: 'BYPASS_ENABLED' }, sa.id));
  const cl = await fx.checklist('GCL', [{ question: 'ok?' }]);
  CLQ = cl.questionIds[0];
  ({ filterProfileId: FP_CL } = await fx.pipeline({ name: 'GCL', stages: ['WASH_IN', 'WASH_OUT'], checklistAfter: { 0: cl.id } }, sa.id));
  gateH = await fx.login(app, gate.username);
  saH = await fx.login(app, sa.username);
}, 60_000);

afterAll(async () => {
  try {
    if (GATE) await removeReauth(policy());
    await fx.cleanup();
  } finally { await app?.close(); }
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('every cycle write demands the signature when the role\'s policy says so', () => {
  let f = '';
  beforeAll(async () => { f = await fx.filter('SIG', AHU1, FP_BYP); }, 60_000);
  // Applied before EACH test, not once: other suites running against the same
  // DB read-modify-write this shared row, and a stale write can drop our keys.
  // The merge is idempotent and touches only this file's role.
  beforeEach(async () => { await addReauth(policy()); });

  const expectRefused = (res: Awaited<ReturnType<typeof call>>, action: string) => {
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action });
  };

  it('start-cycle: no password → refused and nothing written; wrong password → refused; right password → started', async () => {
    expectRefused(await call('POST', `/api/filters/${f}/start-cycle`, gateH, { cleaningReasonKey: 'ROUTINE' }), 'START_CLEANING_CYCLE');
    expect(await prisma.cleaningCycle.count({ where: { filterId: f } })).toBe(0);
    const wrong = await call('POST', `/api/filters/${f}/start-cycle`, gateH, { cleaningReasonKey: 'ROUTINE', _currentPassword: 'Wrong#Pass1' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).not.toBe('REAUTH_REQUIRED');
    const ok = await call('POST', `/api/filters/${f}/start-cycle`, gateH, { cleaningReasonKey: 'ROUTINE', _currentPassword: fx.password });
    expect(ok.statusCode).toBe(201);
  });

  it('advance, advance-with-checklist, submit-checklist, bypass, terminate and bulk-operate each refuse without it', async () => {
    const tapeVersion = (await state(f)).tapeVersion;
    expectRefused(await call('POST', `/api/filters/${f}/advance`, gateH, { targetState: 'WASH_IN', tapeVersion }), 'ADVANCE_FILTER_STAGE');
    expectRefused(await call('POST', `/api/filters/${f}/advance-with-checklist`, gateH, { targetState: 'WASH_IN', answers: {}, tapeVersion }), 'ADVANCE_FILTER_STAGE');
    expectRefused(await call('POST', `/api/filters/${f}/submit-checklist`, gateH, { answers: {}, tapeVersion }), 'SUBMIT_CHECKLIST_WITH_SIGNATURE');
    expectRefused(await call('POST', `/api/filters/${f}/bypass`, gateH, { targetState: 'WASH_OUT', justification: 'signature probe text', tapeVersion }), 'BYPASS_FILTER_STAGE');
    expectRefused(await call('POST', `/api/filters/${f}/terminate-cycle`, gateH, { justification: 'signature probe text', tapeVersion }), 'TERMINATE_CLEANING_CYCLE');
    const bulk = await call('POST', '/api/filters/bulk-operate', gateH, { items: [{ clientOpId: 'x', filterId: f, kind: 'advance', payload: { targetState: 'WASH_IN', tapeVersion } }] });
    expect(bulk.statusCode).toBe(401);
    // Nothing moved.
    expect(await prisma.filterEvent.count({ where: { filterId: f, eventType: { not: 'CYCLE_STARTED' } } })).toBe(0);
  });

  it('retire and replace refuse without it', async () => {
    expectRefused(await call('POST', `/api/filters/${f}/retire`, gateH, { remarks: 'probe' }), 'RETIRE_FILTER');
    expectRefused(await call('POST', `/api/filters/${f}/replace`, gateH, { remarks: 'probe' }), 'REPLACE_FILTER');
    expect((await prisma.assetInstance.findUnique({ where: { id: f } }))!.isActive).toBe(true);
  });

  it('stage-approval decisions always need the signature; a bulk reject with no remarks is refused first', async () => {
    const id = randomUUID();
    expect((await call('POST', `/api/stage-approvals/${id}/reject`, gateH, { remarks: 'not signed' })).json().error).toBe('REAUTH_REQUIRED');
    expect((await call('POST', '/api/stage-approvals/bulk-decide', gateH, { ids: [id], action: 'approve', remarks: 'released' })).json().error).toBe('REAUTH_REQUIRED');
    // an approval needs remarks too, refused before the signature (D03-13)
    const bareApprove = await call('POST', '/api/stage-approvals/bulk-decide', gateH, { ids: [id], action: 'approve' });
    expect([bareApprove.statusCode, bareApprove.json().error]).toEqual([400, 'VALIDATION']);
    const noRemarks = await call('POST', '/api/stage-approvals/bulk-decide', gateH, { ids: [id], action: 'reject' });
    expect([noRemarks.statusCode, noRemarks.json().error]).toEqual([400, 'REMARKS_REQUIRED']);
  });
});

describe('unknown filters and filters with nothing to act on', () => {
  it('every cycle write on an unknown filter is 404', async () => {
    const id = randomUUID();
    for (const [op, body] of [
      ['advance', { targetState: 'WASH_IN', tapeVersion: 0 }],
      ['bypass', { targetState: 'WASH_IN', justification: 'unknown filter probe', tapeVersion: 0 }],
      ['terminate-cycle', { justification: 'unknown filter probe', tapeVersion: 0 }],
      ['submit-checklist', { answers: {}, tapeVersion: 0 }],
      ['start-cycle', { cleaningReasonKey: 'ROUTINE' }],
    ] as const) {
      const res = await call('POST', `/api/filters/${id}/${op}`, saH, { ...body, _currentPassword: fx.password });
      expect([op, res.statusCode, res.json().error]).toEqual([op, 404, 'NOT_FOUND']);
    }
    expect((await call('GET', `/api/filters/${id}/current-state`, saH)).statusCode).toBe(404);
  });

  it('a filter with no cleaning profile and no cycle answers NO_CYCLE to a write, not a crash', async () => {
    const f = await fx.filter('NOPROF', AHU1, null);
    const res = await call('POST', `/api/filters/${f}/terminate-cycle`, saH, { justification: 'nothing running here', tapeVersion: 0, _currentPassword: fx.password });
    expect([res.statusCode, res.json().error]).toEqual([400, 'NO_CYCLE']);
    expect(internalErrors).toEqual([]);
  });
});

describe('read helpers: batch-states and AHU completion options', () => {
  it('batch-states returns this file\'s filters for its block, with their tape', async () => {
    const f = await fx.filter('BATCH', AHU1, FP);
    const res = await call('GET', `/api/filters/batch-states?cleaningAreaId=${B1}`, saH);
    expect(res.statusCode).toBe(200);
    const s = res.json().states[f];
    expect(s).toMatchObject({ filterId: f, blockChangeStatus: 'MATCH' });
    expect(typeof s.tapeVersion).toBe('number');
  });

  it('completion-status honours exclude= and set=', async () => {
    const a = await fx.filter('CSA', AHU1, FP, { filterSet: 'SET_A', stage: 'CLEANING_CYCLE_COMPLETED' });
    const b = await fx.filter('CSB', AHU1, FP, { filterSet: 'SET_B' });
    const res = await call('GET', `/api/filters/ahu/${AHU1}/completion-status?exclude=${b}&set=SET_A`, saH);
    expect(res.statusCode).toBe(200);
    const ids = res.json().filters.map((x: any) => x.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
    const batch = await call('POST', '/api/filters/ahu-completion-status/batch', saH, { filterIds: [a, b], set: 'SET_B' });
    expect(batch.statusCode).toBe(200);
    expect(batch.json().ahus.map((x: any) => x.ahuId)).toEqual([AHU1]);
    const avail = await call('POST', '/api/filters/ahu-set-availability', saH, { filterIds: [a, b] });
    expect(avail.json()).toEqual({ hasBothSets: true });
  });
});

describe('bulk-operate: the start half of start-and-advance', () => {
  it('with no start payload the item fails REASON_REQUIRED and nothing starts', async () => {
    const f = await fx.filter('BNP', AHU1, FP);
    const res = await call('POST', '/api/filters/bulk-operate', saH, {
      _currentPassword: fx.password,
      items: [{ clientOpId: randomUUID(), filterId: f, kind: 'start-and-advance', advancePayload: { targetState: 'WASH_IN' } }],
    });
    expect(res.json().results[0]).toMatchObject({ status: 'failed', error: { code: 'REASON_REQUIRED' } });
    expect(await prisma.cleaningCycle.count({ where: { filterId: f } })).toBe(0);
  });

  it('the start half keeps the caller\'s own clientOpId when one is given', async () => {
    const f = await fx.filter('BOP', AHU1, FP);
    const startOp = randomUUID();
    const res = await call('POST', '/api/filters/bulk-operate', saH, {
      _currentPassword: fx.password,
      items: [{ clientOpId: randomUUID(), filterId: f, kind: 'start-and-advance', cyclePayload: { cleaningReasonKey: 'ROUTINE', clientOpId: startOp }, advancePayload: { targetState: 'WASH_IN' } }],
    });
    expect(res.json().results[0].status).toBe('ok');
    const started = await prisma.filterEvent.findFirst({ where: { filterId: f, eventType: 'CYCLE_STARTED' } });
    expect((started!.attributes as any).clientOpId).toBe(startOp);
  });

  it('a checklist kind without a tape version fails TAPE_VERSION_REQUIRED', async () => {
    const f = await fx.filter('BTV', AHU1, FP_CL);
    const res = await call('POST', '/api/filters/bulk-operate', saH, {
      _currentPassword: fx.password,
      items: [{ clientOpId: randomUUID(), filterId: f, kind: 'advance-with-checklist', payload: { targetState: 'WASH_IN', answers: { [CLQ]: 'YES' } } }],
    });
    expect(res.json().results[0]).toMatchObject({ status: 'failed', error: { code: 'TAPE_VERSION_REQUIRED' } });
  });
});
