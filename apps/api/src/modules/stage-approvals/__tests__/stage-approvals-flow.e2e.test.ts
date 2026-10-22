/**
 * Cleaning stage interlock, end to end (coverage suite, 2026-10-21):
 * the operator's advance raises the gate, the approver decides it through
 * /api/stage-approvals/*, and every refusal on both sides.
 *
 * Real Fastify (production error handler) + real Prisma on digilog_test_db.
 *
 * Two module mocks, each replacing ONE export and saying why:
 *  - `getInterlockConfig` (stage-interlock.js): the interlock switch and the
 *    approver roles live in the shared `system_config['stage-interlock']` row,
 *    which other suites read. The mock turns the interlock on for THIS process
 *    and routes approvals to roles this file owns. Note it replaces the export
 *    only: a caller inside stage-interlock.js (assertStageApprovedToLeave without
 *    an explicit config, as the ONLINE bypass path calls it) still reads the real
 *    row, so the online bypass leave-gate is not exercised here.
 *  - `createNotification`: passes through to the real function unless a test
 *    flips `notify.fail`, to show a notification failure never undoes a decision.
 *  - `assertAhuInterlockSatisfied` (ahu-completion-gate.js): passes through
 *    unless a test flips `ahuGate.refuse` or `ahuGate.interlock`. The
 *    AHU-completion mode lives in the shared `system_config['ahu-completion-process']`
 *    row (and the gate reads it from inside its own module, out of a mock's
 *    reach), so INTERLOCK mode is simulated at the export the approval calls:
 *    `refuse` always answers 422; `interlock` answers 422 exactly when the REAL
 *    roster computation (`computeAhuCompletionStatus`, with the set the caller
 *    passed) finds a sibling not ready — so the set choice is exercised for real.
 *
 * queue / list are only ever called as non-SUPER_ADMIN users in this file's own
 * roles: as SUPER_ADMIN, queue() supersedes EVERY orphaned PENDING approval in
 * the database, which would close other suites' rows.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const cfg = vi.hoisted(() => ({ enabled: true, washOutApproverRole: 'UNSET', dryOutApproverRole: 'UNSET' }));
const notify = vi.hoisted(() => ({ fail: false }));
const ahuGate = vi.hoisted(() => ({ refuse: false, interlock: false, calls: [] as Array<{ filterId: string; set: string | undefined }> }));
vi.mock('../../filter-operations/stage-interlock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../filter-operations/stage-interlock.js')>();
  return { ...actual, getInterlockConfig: async () => ({ ...cfg }) };
});
vi.mock('../../filter-operations/ahu-completion-gate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../filter-operations/ahu-completion-gate.js')>();
  const { AppError } = await import('../../../lib/errors.js');
  return {
    ...actual,
    assertAhuInterlockSatisfied: async (params: Parameters<typeof actual.assertAhuInterlockSatisfied>[0]) => {
      ahuGate.calls.push({ filterId: params.filterId, set: params.set });
      if (ahuGate.refuse) {
        throw new AppError(422, 'AHU_INTERLOCK_PENDING', 'All filters belonging to this AHU must be ready for the final cleaning stage before submission.');
      }
      if (ahuGate.interlock && !params.isOfflineReplay) {
        const ahuId = await actual.resolveAhuId(params.filterId);
        const status = ahuId ? await actual.computeAhuCompletionStatus(ahuId, params.filterId, params.set) : null;
        if (status && !status.allAtFinal) {
          throw new AppError(422, 'AHU_INTERLOCK_PENDING', 'All filters belonging to this AHU must be ready for the final cleaning stage before submission.', { pendingFilters: status.pending });
        }
        return { exempt: false };
      }
      return actual.assertAhuInterlockSatisfied(params);
    },
  };
});
vi.mock('../../notifications/notification.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../notifications/notification.service.js')>();
  return {
    ...actual,
    createNotification: async (...args: Parameters<typeof actual.createNotification>) => {
      if (notify.fail) throw new Error('simulated notification outage');
      return actual.createNotification(...args);
    },
  };
});

import { buildApp, internalErrors, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterOperationsRoutes from '../../filter-operations/routes.js';
import stageApprovalRoutes from '../routes.js';
import { FoFixture } from '../../filter-operations/__tests__/support/fo-fixtures.js';

const fx = new FoFixture('FSA');
let app: FastifyInstance;
let APR = ''; let OTHER = '';
let op: { id: string; username: string }; let opH: Record<string, string>;
let apr1: { id: string; username: string }; let apr1H: Record<string, string>;
let apr2H: Record<string, string>;
let otherH: Record<string, string>;
let sa: { id: string; username: string }; let saH: Record<string, string>;
let opGrant = '';
let B1 = ''; let FP = ''; let FP_BYP = ''; let FP_TERM = ''; let FP_BYP_TERM = ''; let FP_CLWO = ''; let CLQ = '';
let CP = '';

const call = (method: 'GET' | 'POST', url: string, h: Record<string, string>, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: h, ...(payload ? { payload } : {}) });
const signed = (url: string, h: Record<string, string>, payload: Record<string, unknown> = {}) =>
  call('POST', url, h, { _currentPassword: fx.password, ...payload });
const state = async (id: string, h = opH) => {
  const res = await call('GET', `/api/filters/${id}/current-state`, h);
  expect(res.statusCode).toBe(200);
  return res.json();
};
const advance = async (id: string, body: Record<string, unknown>, h = opH) =>
  signed(`/api/filters/${id}/advance`, h, { tapeVersion: (await state(id, h)).tapeVersion, ...body });
const replay = async (id: string, op: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST', url: `/api/filters/${id}/${op}`, headers: { ...opH, 'x-offline-replay-token': opGrant },
    payload: { offlinePerformedAt: new Date().toISOString(), clientOpId: randomUUID(), tapeVersion: (await state(id)).tapeVersion, ...body },
  });
const start = async (id: string, h = opH) => {
  const res = await signed(`/api/filters/${id}/start-cycle`, h, { cleaningReasonKey: 'ROUTINE' });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};
const approvals = (filterId: string) => prisma.cleaningStageApproval.findMany({ where: { filterId }, orderBy: [{ attemptSeq: 'asc' }, { requestedAt: 'asc' }] });
/** A filter in its own AHU (so no sibling can ever hold a completion gate), at WASH_OUT with a PENDING approval. */
async function atWashOut(label: string, h = opH) {
  const ahu = await fx.node('AHU', `AHU-${label}`, B1);
  const f = await fx.filter(label, ahu, FP, { attributes: { ahuType: 'Process', micronSize: '10', filterType: 'HEPA', filterSize: '  ' }, filterSet: 'SET_A' });
  const cycleId = await start(f, h);
  expect((await advance(f, { targetState: 'WASH_IN' }, h)).statusCode).toBe(200);
  expect((await advance(f, { targetState: 'WASH_OUT' }, h)).statusCode).toBe(200);
  const [row] = await approvals(f);
  return { f, ahu, cycleId, approvalId: row?.id };
}
const dry = async (f: string, cycleId: string) => {
  expect((await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 })).statusCode).toBe(200);
  await prisma.cleaningCycle.update({ where: { id: cycleId }, data: { dryerStartedAt: new Date(Date.now() - 5 * 60_000) } });
  expect((await advance(f, { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' })).statusCode).toBe(200);
};

beforeAll(async () => {
  app = await buildApp([
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
    { plugin: stageApprovalRoutes, prefix: '/api/stage-approvals' },
  ]);
  APR = await fx.role('APR', ['STAGE_APPROVAL_VIEW', 'STAGE_APPROVAL_DECIDE', 'ASSET_READ', 'FILTER_OPERATE']);
  OTHER = await fx.role('OTH', ['STAGE_APPROVAL_VIEW', 'STAGE_APPROVAL_DECIDE']);
  const OPER = await fx.role('OPR', ['FILTER_OPERATE', 'FILTER_BYPASS', 'ASSET_READ']);
  cfg.washOutApproverRole = APR; cfg.dryOutApproverRole = APR;
  op = await fx.user('op', OPER);
  apr1 = await fx.user('apr1', APR);
  const apr2 = await fx.user('apr2', APR);
  const other = await fx.user('oth', OTHER);
  sa = await fx.user('sa', 'SUPER_ADMIN');
  B1 = await fx.node('BLOCK', 'B1');
  const stages = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN'];
  ({ filterProfileId: FP, cleaningProfileId: CP } = await fx.pipeline({ name: 'INT', stages }, sa.id));
  ({ filterProfileId: FP_BYP } = await fx.pipeline({ name: 'IBYP', stages, flowMode: 'BYPASS_ENABLED' }, sa.id));
  ({ filterProfileId: FP_TERM } = await fx.pipeline({ name: 'ITERM', stages: ['WASH_IN', 'WASH_OUT'] }, sa.id));
  ({ filterProfileId: FP_BYP_TERM } = await fx.pipeline({ name: 'IBTRM', stages: ['WASH_IN', 'WASH_OUT'], flowMode: 'BYPASS_ENABLED' }, sa.id));
  const cl = await fx.checklist('WOCL', [{ question: 'Wash out inspected?' }]);
  CLQ = cl.questionIds[0];
  ({ filterProfileId: FP_CLWO } = await fx.pipeline({ name: 'ICLWO', stages: ['WASH_IN', 'WASH_OUT'], checklistAfter: { 1: cl.id } }, sa.id));
  opH = await fx.login(app, op.username);
  apr1H = await fx.login(app, apr1.username);
  apr2H = await fx.login(app, apr2.username);
  otherH = await fx.login(app, other.username);
  saH = await fx.login(app, sa.username);
  opGrant = await obtainOfflineGrant(app, opH.authorization.slice(7), fx.password);
}, 60_000);

afterAll(async () => {
  try { await fx.cleanup(); } finally { await app?.close(); }
}, 60_000);

beforeEach(() => { internalErrors.length = 0; cfg.enabled = true; notify.fail = false; ahuGate.refuse = false; ahuGate.interlock = false; ahuGate.calls.length = 0; });

describe('the operator side: entering a gated stage raises the gate', () => {
  let ctx: Awaited<ReturnType<typeof atWashOut>>;
  beforeAll(async () => { ctx = await atWashOut('GATE'); }, 60_000);

  it('entering Wash Out creates ONE pending approval routed to the configured role, with the filter frozen', async () => {
    const rows = await approvals(ctx.f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'PENDING', stageKey: 'WASH_OUT', approverRole: APR, rejectToStateKey: 'WASH_IN', attemptSeq: 1,
      requestedBy: op.id, requestedByName: op.username, cycleId: ctx.cycleId,
    });
    const snap = rows[0].detailsSnapshot as any;
    expect(snap).toMatchObject({ ahuType: 'Process', micronSize: '10', filterType: 'HEPA', filterDimensions: null, filterSet: 'SET_A', area: null });
    expect(snap.block).toContain('-B1-');
    expect(snap.ahu).toContain('-AHU-GATE-');
    const n = await prisma.notification.findFirst({ where: { forRole: APR, type: 'STAGE_APPROVAL_REQUESTED' } });
    expect(n).not.toBeNull();
  });

  it('current-state shows the gate, and leaving is refused while it is pending (423)', async () => {
    const s = await state(ctx.f);
    expect(s.interlock).toMatchObject({ gatedStage: true, stageKey: 'WASH_OUT', status: 'PENDING', approverRole: APR, blocksLeaving: true, approvalId: ctx.approvalId });
    const res = await advance(ctx.f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 });
    expect(res.statusCode).toBe(423);
    expect(res.json().error).toBe('STAGE_APPROVAL_PENDING');
    expect(res.json().message).toContain(APR);
  });
});

describe('the approver side: queue, list, detail', () => {
  let ctx: Awaited<ReturnType<typeof atWashOut>>;
  beforeAll(async () => { ctx = await atWashOut('QUE'); }, 60_000);

  it('the queue offers the row to its role only, with the stage details and a self flag', async () => {
    const res = await call('GET', '/api/stage-approvals/queue', apr1H);
    expect(res.statusCode).toBe(200);
    const row = res.json().data.find((r: any) => r.id === ctx.approvalId);
    expect(row).toMatchObject({ selfRequested: false, stageKey: 'WASH_OUT', approverRole: APR });
    expect(row.requestedBy).toBeUndefined();
    expect(row.stageDetails.cleaningReason).toBe('Routine');
    expect(row.stageDetails.washIn.by).toBe(op.username);
    const other = await call('GET', '/api/stage-approvals/queue', otherH);
    expect(other.json().data.some((r: any) => r.id === ctx.approvalId)).toBe(false);
  });

  it('the list shows the operator their own request, and filters by status / window', async () => {
    const mine = await call('GET', '/api/stage-approvals', opH);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.find((r: any) => r.id === ctx.approvalId)).toMatchObject({ selfRequested: true });
    const approved = await call('GET', '/api/stage-approvals?status=APPROVED', apr1H);
    expect(approved.json().data.some((r: any) => r.id === ctx.approvalId)).toBe(false);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const windowed = await call('GET', `/api/stage-approvals?from=${future}`, apr1H);
    expect(windowed.json().data.some((r: any) => r.id === ctx.approvalId)).toBe(true); // PENDING kept whatever its age
  });

  it('an unknown status value is a client error, not a 500', async () => {
    const res = await call('GET', '/api/stage-approvals?status=NOT_A_STATUS', apr1H);
    expect(res.statusCode).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('detail returns the full row; unknown is 404; a malformed id is a 400', async () => {
    const res = await call('GET', `/api/stage-approvals/${ctx.approvalId}`, apr1H);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: ctx.approvalId, requestedBy: op.id, status: 'PENDING' });
    expect(res.json().stageDetails.washOut.by).toBe(op.username);
    const missing = await call('GET', `/api/stage-approvals/${randomUUID()}`, apr1H);
    expect([missing.statusCode, missing.json().error]).toEqual([404, 'NOT_FOUND']);
    const bad = await call('GET', '/api/stage-approvals/not-a-uuid', apr1H);
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'VALIDATION_ERROR']);
    expect(internalErrors).toEqual([]);
  });

  it('approve and reject refuse a malformed id at the schema edge (400), before the signature', async () => {
    const approve = await call('POST', '/api/stage-approvals/not-a-uuid/approve', apr1H, { remarks: 'ok' });
    expect([approve.statusCode, approve.json().error]).toEqual([400, 'VALIDATION_ERROR']);
    const reject = await call('POST', '/api/stage-approvals/not-a-uuid/reject', apr1H, { remarks: 'not this one' });
    expect([reject.statusCode, reject.json().error]).toEqual([400, 'VALIDATION_ERROR']);
    expect(internalErrors).toEqual([]);
  });

  it('the operator cannot open the approver detail or decide (403)', async () => {
    expect((await call('GET', `/api/stage-approvals/${ctx.approvalId}`, opH)).statusCode).toBe(403);
    expect((await signed(`/api/stage-approvals/${ctx.approvalId}/approve`, opH)).statusCode).toBe(403);
  });
});

describe('approve: guards and the decision record', () => {
  let ctx: Awaited<ReturnType<typeof atWashOut>>;
  beforeAll(async () => { ctx = await atWashOut('APV'); }, 60_000);

  it('needs the password every time (REAUTH_REQUIRED)', async () => {
    const res = await call('POST', `/api/stage-approvals/${ctx.approvalId}/approve`, apr1H, { remarks: 'ok' });
    expect([res.statusCode, res.json().error]).toEqual([401, 'REAUTH_REQUIRED']);
  });

  it('a decider outside the approval role is refused (WRONG_APPROVER_ROLE)', async () => {
    const res = await signed(`/api/stage-approvals/${ctx.approvalId}/approve`, otherH);
    expect([res.statusCode, res.json().error]).toEqual([403, 'WRONG_APPROVER_ROLE']);
  });

  it('an unknown approval is 404', async () => {
    expect((await signed(`/api/stage-approvals/${randomUUID()}/approve`, apr1H)).statusCode).toBe(404);
    expect((await signed(`/api/stage-approvals/${randomUUID()}/reject`, apr1H, { remarks: 'not found' })).statusCode).toBe(404);
  });

  it('approves: event, signed audit row, the operator is told, and released', async () => {
    const res = await signed(`/api/stage-approvals/${ctx.approvalId}/approve`, apr1H, { remarks: '  looks clean  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ctx.approvalId, status: 'APPROVED' });
    const row = await prisma.cleaningStageApproval.findUnique({ where: { id: ctx.approvalId } });
    expect(row).toMatchObject({ status: 'APPROVED', decidedBy: apr1.id, decidedByName: apr1.username, decisionRemarks: 'looks clean' });
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: ctx.f, eventType: 'APPROVAL_GRANTED' } });
    expect(ev!.attributes).toMatchObject({ kind: 'STAGE_INTERLOCK_APPROVED', stageKey: 'WASH_OUT', approvalId: ctx.approvalId });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_APPROVED', targetId: ctx.approvalId } });
    expect(audit!.signatureMeaning).toContain('Wash Out approved');
    expect(audit!.afterValue).toMatchObject({ remarks: 'looks clean' });
    expect(await prisma.notification.findFirst({ where: { forUserId: op.username, type: 'STAGE_APPROVAL_APPROVED' } })).not.toBeNull();
    expect((await state(ctx.f)).interlock).toMatchObject({ status: 'APPROVED', blocksLeaving: false });
    expect((await advance(ctx.f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 })).statusCode).toBe(200);
  });

  it('a decided approval cannot be decided again (INVALID_STATUS)', async () => {
    expect((await signed(`/api/stage-approvals/${ctx.approvalId}/approve`, apr1H)).json().error).toBe('INVALID_STATUS');
    expect((await signed(`/api/stage-approvals/${ctx.approvalId}/reject`, apr1H, { remarks: 'too late' })).json().error).toBe('INVALID_STATUS');
  });

  it('the performer of the stage cannot approve it, and the queue says so up front', async () => {
    const own = await atWashOut('SELF', apr1H);
    const q = (await call('GET', '/api/stage-approvals/queue', apr1H)).json().data.find((r: any) => r.id === own.approvalId);
    expect(q.selfRequested).toBe(true);
    const res = await signed(`/api/stage-approvals/${own.approvalId}/approve`, apr1H);
    expect([res.statusCode, res.json().error]).toEqual([403, 'SELF_APPROVAL_FORBIDDEN']);
    expect((await signed(`/api/stage-approvals/${own.approvalId}/approve`, apr2H)).statusCode).toBe(200);
  });

  it('a notification outage never undoes a decision', async () => {
    const c = await atWashOut('NOTIFY');
    notify.fail = true;
    const res = await signed(`/api/stage-approvals/${c.approvalId}/approve`, apr1H);
    expect(res.statusCode).toBe(200);
    expect((await prisma.cleaningStageApproval.findUnique({ where: { id: c.approvalId } }))!.status).toBe('APPROVED');
    expect(internalErrors).toEqual([]);
  });
});

describe('reject: sends the filter back; a Dry Out reject clears the dryer', () => {
  let ctx: Awaited<ReturnType<typeof atWashOut>>;
  let dryOutApproval = '';
  beforeAll(async () => {
    ctx = await atWashOut('REJ');
    expect((await signed(`/api/stage-approvals/${ctx.approvalId}/approve`, apr1H)).statusCode).toBe(200);
    await dry(ctx.f, ctx.cycleId);
    expect((await advance(ctx.f, { targetState: 'DRY_OUT' })).statusCode).toBe(200);
    dryOutApproval = (await approvals(ctx.f)).find((a) => a.stageKey === 'DRY_OUT')!.id;
  }, 60_000);

  it('remarks are mandatory (REMARKS_REQUIRED)', async () => {
    const res = await signed(`/api/stage-approvals/${dryOutApproval}/reject`, apr1H, { remarks: ' x ' });
    expect([res.statusCode, res.json().error]).toEqual([400, 'REMARKS_REQUIRED']);
  });

  it('a Dry Out reject moves the filter back to Dry In, records the deviation and clears the dryer', async () => {
    const res = await signed(`/api/stage-approvals/${dryOutApproval}/reject`, apr1H, { remarks: 'temperature log incomplete' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REJECTED');
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: ctx.f } }))!.currentLifecycleState).toBe('DRY_IN');
    expect(await prisma.cleaningCycle.findUnique({ where: { id: ctx.cycleId } })).toMatchObject({ dryerStartedAt: null, dryerDurationMinutes: null, dryerReadingsSubmitted: false });
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: ctx.f, fromState: 'DRY_OUT', toState: 'DRY_IN' } });
    expect(ev!.deviationDetails).toMatchObject({ type: 'STAGE_APPROVAL_REJECTED', remarks: 'temperature log incomplete', rejectedBy: apr1.username });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_REJECTED', targetId: dryOutApproval } });
    expect(audit!.signatureMeaning).toContain('restart from Dry In');
    expect(await prisma.notification.findFirst({ where: { forUserId: op.username, type: 'STAGE_APPROVAL_REJECTED' } })).not.toBeNull();
  });

  it('re-entering Dry Out offline after a reject is not gated there, but the latest REJECTED blocks leaving online (423)', async () => {
    await dry(ctx.f, ctx.cycleId);
    const off = await replay(ctx.f, 'advance', { targetState: 'DRY_OUT' });
    expect(off.statusCode).toBe(200);
    const ev = (await prisma.filterEvent.findMany({ where: { filterId: ctx.f, toState: 'DRY_OUT' }, orderBy: { performedAt: 'desc' } }))[0];
    expect((ev.attributes as any).replayExemptGates).toEqual(['REAUTH', 'INTERLOCK_ENTRY']);
    expect((await approvals(ctx.f)).filter((a) => a.stageKey === 'DRY_OUT')).toHaveLength(1); // no new request offline
    const res = await advance(ctx.f, { targetState: 'STORAGE_IN' });
    expect([res.statusCode, res.json().error]).toEqual([423, 'STAGE_APPROVAL_REJECTED']);
  });

  it('a reject on a cycle that is no longer running is refused (CYCLE_NOT_ACTIVE)', async () => {
    const ahu = await fx.node('AHU', 'AHU-CNA', B1);
    const f = await fx.filter('CNA', ahu, FP);
    const c = await fx.rawCycle(f, CP, { status: 'COMPLETED' });
    await prisma.filterDetails.update({ where: { assetInstanceId: f }, data: { currentCycleId: c.id, currentLifecycleState: 'WASH_OUT' } });
    const row = await prisma.cleaningStageApproval.create({
      data: { cycleId: c.id, filterId: f, stageKey: 'WASH_OUT', approverRole: APR, rejectToStateKey: 'WASH_IN', detailsSnapshot: {}, requestedBy: op.id, requestedByName: op.username },
    });
    const res = await signed(`/api/stage-approvals/${row.id}/reject`, apr1H, { remarks: 'cycle already ended' });
    expect([res.statusCode, res.json().error]).toEqual([409, 'CYCLE_NOT_ACTIVE']);
  });
});

describe('orphans: a filter that moved past the gate offline', () => {
  let ctx: Awaited<ReturnType<typeof atWashOut>>;
  beforeAll(async () => {
    ctx = await atWashOut('ORPH');
    const off = await replay(ctx.f, 'advance', { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 });
    expect(off.statusCode).toBe(200);
    expect(((await prisma.filterEvent.findFirst({ where: { filterId: ctx.f, toState: 'DRY_IN' } }))!.attributes as any).replayExemptGates)
      .toEqual(['REAUTH', 'INTERLOCK_LEAVE']);
  }, 60_000);

  it('approve and reject both refuse a stale approval (APPROVAL_STALE)', async () => {
    expect((await signed(`/api/stage-approvals/${ctx.approvalId}/approve`, apr1H)).json().error).toBe('APPROVAL_STALE');
    expect((await signed(`/api/stage-approvals/${ctx.approvalId}/reject`, apr1H, { remarks: 'stale one' })).json().error).toBe('APPROVAL_STALE');
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: ctx.f } }))!.currentLifecycleState).toBe('DRY_IN');
  });

  it('the queue closes it as SUPERSEDED, with an audit row saying why, and stops offering it', async () => {
    const q = await call('GET', '/api/stage-approvals/queue', apr1H);
    expect(q.json().data.some((r: any) => r.id === ctx.approvalId)).toBe(false);
    expect((await prisma.cleaningStageApproval.findUnique({ where: { id: ctx.approvalId } }))!.status).toBe('SUPERSEDED');
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_SUPERSEDED', targetId: ctx.approvalId } });
    expect(audit!.afterValue).toMatchObject({ status: 'SUPERSEDED', currentState: 'DRY_IN', stageKey: 'WASH_OUT' });
    expect(audit!.signatureMeaning).toBeNull();
  });
});

describe('bulk-decide', () => {
  it('a reject batch with short remarks is refused before the signature', async () => {
    const res = await call('POST', '/api/stage-approvals/bulk-decide', apr1H, { ids: [randomUUID()], action: 'reject', remarks: 'no' });
    expect([res.statusCode, res.json().error]).toEqual([400, 'REMARKS_REQUIRED']);
  });

  it('decides each item on its own: partial success', async () => {
    const a = await atWashOut('BLK1');
    const b = await atWashOut('BLK2');
    const ghost = randomUUID();
    const res = await signed('/api/stage-approvals/bulk-decide', apr1H, { ids: [a.approvalId, ghost], action: 'approve' });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([
      { id: a.approvalId, status: 'ok' },
      { id: ghost, status: 'failed', error: { code: 'NOT_FOUND', message: 'Stage approval not found.' } },
    ]);
    const rej = await signed('/api/stage-approvals/bulk-decide', apr1H, { ids: [b.approvalId], action: 'reject', remarks: 'rewash needed' });
    expect(rej.json().results).toEqual([{ id: b.approvalId, status: 'ok' }]);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: b.f } }))!.currentLifecycleState).toBe('WASH_IN');
  });
});

describe('self-heal: a filter parked at a gated stage with no approval', () => {
  it('enabling the interlock after the filter entered Wash Out raises the approval on the next poll, attributed to the operator', async () => {
    cfg.enabled = false;
    const ahu = await fx.node('AHU', 'AHU-HEAL', B1);
    const f = await fx.filter('HEAL', ahu, FP);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    expect(await approvals(f)).toHaveLength(0);
    cfg.enabled = true;
    const s = await state(f, saH);
    expect(s.interlock).toMatchObject({ status: 'PENDING', blocksLeaving: true });
    const [row] = await approvals(f);
    expect(row).toMatchObject({ requestedBy: op.id, requestedByName: op.username, approverRole: APR });
    await state(f, saH);
    expect(await approvals(f)).toHaveLength(1); // fires once
  });

  it('a stage reached OFFLINE is never self-healed', async () => {
    const ahu = await fx.node('AHU', 'AHU-OFFH', B1);
    const f = await fx.filter('OFFH', ahu, FP);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const off = await replay(f, 'advance', { targetState: 'WASH_OUT' });
    expect(off.statusCode).toBe(200);
    const s = await state(f, saH);
    expect(s.interlock).toMatchObject({ status: null, approvalId: null, blocksLeaving: true });
    expect(await approvals(f)).toHaveLength(0);
  });

  it('with no entry event the cycle starter is credited; with no events at all nothing is fabricated', async () => {
    const ahu = await fx.node('AHU', 'AHU-STR', B1);
    const f = await fx.filter('STR', ahu, FP);
    const cycleId = await start(f);
    await prisma.filterDetails.update({ where: { assetInstanceId: f }, data: { currentLifecycleState: 'WASH_OUT' } });
    await state(f, saH);
    expect((await approvals(f))[0]).toMatchObject({ requestedBy: op.id, cycleId });

    const g = await fx.filter('NOEV', ahu, FP);
    const raw = await fx.rawCycle(g, CP, { status: 'IN_PROGRESS', completedAt: null });
    await prisma.filterDetails.update({ where: { assetInstanceId: g }, data: { currentCycleId: raw.id, currentLifecycleState: 'DRY_OUT' } });
    const s = await state(g, saH);
    expect(s.interlock).toMatchObject({ stageKey: 'DRY_OUT', status: null });
    expect(await approvals(g)).toHaveLength(0);
  });
});

describe('a FINAL gated stage with nothing after it: the approval completes the cycle (2026-10-22)', () => {
  /** WASH_IN → WASH_OUT (gated, last, no checklist) → END, parked at Wash Out with its approval PENDING. */
  async function atFinalWashOut(label: string, opts: { ahu?: string; ownSet?: 'SET_A' | 'SET_B'; chosenSet?: 'SET_A' | 'SET_B' | 'ALL' } = {}) {
    const ahu = opts.ahu ?? await fx.node('AHU', `AHU-${label}`, B1);
    const f = await fx.filter(label, ahu, FP_TERM, opts.ownSet ? { filterSet: opts.ownSet } : {});
    const cycleId = await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    // Used to be 422 INTERLOCK_TERMINAL_STAGE: such a pipeline could never complete online.
    const entered = await advance(f, { targetState: 'WASH_OUT', ...(opts.chosenSet ? { filterSet: opts.chosenSet } : {}) });
    expect(entered.statusCode).toBe(200);
    expect(entered.json().currentState).toBe('WASH_OUT');
    expect((await state(f)).interlock).toMatchObject({ status: 'PENDING', blocksLeaving: true });
    expect((await prisma.cleaningCycle.findUnique({ where: { id: cycleId } }))!.status).toBe('IN_PROGRESS');
    const [row] = await approvals(f);
    expect(row).toMatchObject({ status: 'PENDING', stageKey: 'WASH_OUT' });
    return { f, cycleId, approvalId: row.id };
  }

  it('the bare advance enters it and raises the approval; approving completes the cycle as the approver, under the approval signature', async () => {
    const c = await atFinalWashOut('FIN');
    const res = await signed(`/api/stage-approvals/${c.approvalId}/approve`, apr1H, { remarks: 'final wash ok' });
    expect(res.statusCode).toBe(200);
    expect(ahuGate.calls).toEqual([{ filterId: c.f, set: undefined }]);

    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.cycleId } })).toMatchObject({ status: 'COMPLETED' });
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: c.f } }))
      .toMatchObject({ currentLifecycleState: 'CLEANING_CYCLE_COMPLETED', currentCycleId: null });
    const done = await prisma.filterEvent.findMany({ where: { cycleId: c.cycleId, eventType: 'CYCLE_COMPLETED' } });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ performedBy: apr1.id });
    expect(done[0].attributes).toMatchObject({ approvalId: c.approvalId });

    // The completion's audit row is the approver's and carries the approval's
    // signature (the same REAUTH_SUCCESS row as the approval decision itself).
    const decision = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_APPROVED', targetId: c.approvalId } });
    const completion = await prisma.auditTrail.findFirst({ where: { action: 'CYCLE_COMPLETED', targetId: c.f } });
    expect(decision!.signatureAuditId).toBeTruthy();
    expect(completion).toMatchObject({ userId: apr1.username, signatureAuditId: decision!.signatureAuditId });
    expect(completion!.afterValue).toMatchObject({ cycleId: c.cycleId, finalStage: 'WASH_OUT' });
    const sig = await prisma.auditTrail.findUnique({ where: { id: decision!.signatureAuditId! } });
    expect(sig).toMatchObject({ action: 'REAUTH_SUCCESS', userId: apr1.username });

    const note = await prisma.notification.findFirst({ where: { forUserId: op.username, type: 'STAGE_APPROVAL_APPROVED', metadata: { path: ['stageApprovalId'], equals: c.approvalId } } });
    expect(note!.message).toContain('The cleaning cycle is complete.');
    expect(internalErrors).toEqual([]);
  });

  it('a refused AHU-completion gate (422) refuses the approval and writes nothing', async () => {
    const c = await atFinalWashOut('FINAHU');
    ahuGate.refuse = true;
    const res = await signed(`/api/stage-approvals/${c.approvalId}/approve`, apr1H, { remarks: 'try to finish' });
    expect([res.statusCode, res.json().error]).toEqual([422, 'AHU_INTERLOCK_PENDING']);
    expect(await prisma.cleaningStageApproval.findUnique({ where: { id: c.approvalId } })).toMatchObject({ status: 'PENDING', decidedBy: null });
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.cycleId } })).toMatchObject({ status: 'IN_PROGRESS' });
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: c.f } })).toMatchObject({ currentLifecycleState: 'WASH_OUT', currentCycleId: c.cycleId });
    expect(await prisma.filterEvent.count({ where: { cycleId: c.cycleId, eventType: { in: ['APPROVAL_GRANTED', 'CYCLE_COMPLETED'] } } })).toBe(0);
    expect(await prisma.auditTrail.count({ where: { action: 'STAGE_APPROVAL_APPROVED', targetId: c.approvalId } })).toBe(0);

    // Once the AHU is ready the same approval goes through and completes.
    ahuGate.refuse = false;
    expect((await signed(`/api/stage-approvals/${c.approvalId}/approve`, apr1H)).statusCode).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.cycleId } })).toMatchObject({ status: 'COMPLETED' });
  });

  it('the AHU gate at approval uses the set the OPERATOR chose on the entering advance, not the filter\'s own set', async () => {
    // AHU with a SET_A sibling that never started a cycle: it is NOT ready, so it
    // blocks an AHU-completion check over ALL filters or over SET_A.
    const ahu = await fx.node('AHU', 'AHU-SETS', B1);
    await fx.filter('SIB-A', ahu, FP_TERM, { filterSet: 'SET_A' });
    ahuGate.interlock = true;

    // The filter's own set is SET_A; at the entering advance the operator chose SET_B.
    const chose = await atFinalWashOut('SETB', { ahu, ownSet: 'SET_A', chosenSet: 'SET_B' });
    const row = await prisma.cleaningStageApproval.findUnique({ where: { id: chose.approvalId } });
    expect((row!.detailsSnapshot as any).completionFilterSet).toBe('SET_B');
    const ok = await signed(`/api/stage-approvals/${chose.approvalId}/approve`, apr1H);
    expect(ok.statusCode).toBe(200);
    expect(ahuGate.calls).toEqual([{ filterId: chose.f, set: 'SET_B' }]);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: chose.cycleId } })).toMatchObject({ status: 'COMPLETED' });

    // Control: no choice on the advance → the whole roster → the SET_A sibling blocks.
    ahuGate.calls.length = 0;
    const none = await atFinalWashOut('SETNONE', { ahu, ownSet: 'SET_A' });
    const refused = await signed(`/api/stage-approvals/${none.approvalId}/approve`, apr1H);
    expect([refused.statusCode, refused.json().error]).toEqual([422, 'AHU_INTERLOCK_PENDING']);
    expect(ahuGate.calls).toEqual([{ filterId: none.f, set: undefined }]);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: none.cycleId } })).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('a BYPASS into the final gated stage raises the approval with the bypass (and its set choice); the approval completes the cycle', async () => {
    const ahu = await fx.node('AHU', 'AHU-BYPFIN', B1);
    const f = await fx.filter('BYPFIN', ahu, FP_BYP_TERM, { filterSet: 'SET_A' });
    const cycleId = await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const byp = await signed(`/api/filters/${f}/bypass`, opH, {
      targetState: 'WASH_OUT', justification: 'wash line deviation recorded', filterSet: 'SET_B', tapeVersion: (await state(f)).tapeVersion,
    });
    expect(byp.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: cycleId } })).toMatchObject({ status: 'IN_PROGRESS' });
    const [row] = await approvals(f);
    // Raised by the bypass itself (a self-healed one could not know the operator's choice).
    expect(row).toMatchObject({ status: 'PENDING', stageKey: 'WASH_OUT', requestedBy: op.id });
    expect((row.detailsSnapshot as any).completionFilterSet).toBe('SET_B');
    expect((await signed(`/api/stage-approvals/${row.id}/approve`, apr1H)).statusCode).toBe(200);
    expect(ahuGate.calls).toEqual([{ filterId: f, set: 'SET_B' }]);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: cycleId } })).toMatchObject({ status: 'COMPLETED' });
    expect(await prisma.filterEvent.count({ where: { cycleId, eventType: 'CYCLE_COMPLETED' } })).toBe(1);
  });

  it('bulk-decide (the page\'s select-all) completes it the same way', async () => {
    const c = await atFinalWashOut('FINBULK');
    const res = await signed('/api/stage-approvals/bulk-decide', apr1H, { ids: [c.approvalId], action: 'approve' });
    expect(res.json().results).toEqual([{ id: c.approvalId, status: 'ok' }]);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.cycleId } })).toMatchObject({ status: 'COMPLETED' });
    expect(await prisma.filterEvent.count({ where: { cycleId: c.cycleId, eventType: 'CYCLE_COMPLETED' } })).toBe(1);
  });

  it('a gated stage with more stages after it is NOT completed by its approval (the operator is released, as before)', async () => {
    const c = await atWashOut('MIDFIN');
    expect((await signed(`/api/stage-approvals/${c.approvalId}/approve`, apr1H)).statusCode).toBe(200);
    expect(ahuGate.calls).toEqual([]);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.cycleId } })).toMatchObject({ status: 'IN_PROGRESS' });
    expect(await prisma.filterEvent.count({ where: { cycleId: c.cycleId, eventType: 'CYCLE_COMPLETED' } })).toBe(0);
  });

  it('the composed advance-with-checklist into a final gated stage keeps its 422 (the checklist waits for QA)', async () => {
    const ahu = await fx.node('AHU', 'AHU-CLWO-C', B1);
    const f = await fx.filter('CLWOC', ahu, FP_CLWO);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const res = await signed(`/api/filters/${f}/advance-with-checklist`, opH, { targetState: 'WASH_OUT', answers: { [CLQ]: 'YES' }, tapeVersion: (await state(f)).tapeVersion });
    expect([res.statusCode, res.json().error]).toEqual([422, 'INTERLOCK_TERMINAL_STAGE']);
  });
});

describe('interlock exemptions recorded on offline work', () => {
  it('offline, an advance into a final gated stage completes the cycle and records the skipped gate', async () => {
    const ahu = await fx.node('AHU', 'AHU-TRM', B1);
    const f = await fx.filter('TRM', ahu, FP_TERM);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const off = await replay(f, 'advance', { targetState: 'WASH_OUT' });
    expect(off.statusCode).toBe(200);
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: f, toState: 'WASH_OUT' } });
    expect((ev!.attributes as any).replayExemptGates).toEqual(['REAUTH', 'INTERLOCK_TERMINAL']);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: f } }))!.currentLifecycleState).toBe('CLEANING_CYCLE_COMPLETED');
    expect(await approvals(f)).toEqual([]);
  });

  it('a final checklist after Wash Out: online it waits for QA, then completes; offline it records the skipped leave-gate', async () => {
    const ahu = await fx.node('AHU', 'AHU-CLWO', B1);
    const f = await fx.filter('CLWO', ahu, FP_CLWO);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    // The QA-interlock final stage is entered with a bare advance (two-step design).
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    const [row] = await approvals(f);
    const pending = await signed(`/api/filters/${f}/submit-checklist`, opH, { answers: { [CLQ]: 'YES' }, tapeVersion: (await state(f)).tapeVersion });
    expect([pending.statusCode, pending.json().error]).toEqual([423, 'STAGE_APPROVAL_PENDING']);
    expect((await signed(`/api/stage-approvals/${row.id}/approve`, apr1H)).statusCode).toBe(200);
    const done = await signed(`/api/filters/${f}/submit-checklist`, opH, { answers: { [CLQ]: 'YES' }, tapeVersion: (await state(f)).tapeVersion });
    expect(done.statusCode).toBe(200);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: f } }))!.currentLifecycleState).toBe('CLEANING_CYCLE_COMPLETED');

    const g = await fx.filter('CLWO2', ahu, FP_CLWO);
    await start(g);
    expect((await advance(g, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    expect((await advance(g, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    const off = await replay(g, 'submit-checklist', { answers: { [CLQ]: 'YES' } });
    expect(off.statusCode).toBe(200);
    const cl = await prisma.filterEvent.findFirst({ where: { filterId: g, eventType: 'CHECKLIST_COMPLETED' } });
    expect((cl!.attributes as any).replayExemptGates).toEqual(['REAUTH', 'INTERLOCK_LEAVE']);
  });

  it('an offline bypass out of a gated stage records the skipped leave-gate', async () => {
    const ahu = await fx.node('AHU', 'AHU-BYP', B1);
    const f = await fx.filter('BYP', ahu, FP_BYP);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    const off = await replay(f, 'bypass', { targetState: 'STORAGE_IN', justification: 'gate skipped while offline' });
    expect(off.statusCode).toBe(200);
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: f, eventType: 'BYPASS_DEVIATION' } });
    expect((ev!.attributes as any).replayExemptGates).toEqual(['REAUTH', 'INTERLOCK_LEAVE']);
  });
});

describe('approvals without a frozen filter snapshot (legacy rows), and SUPER_ADMIN decisions', () => {
  /** A filter parked at WASH_OUT on a running cycle, with NO approval raised (interlock off on entry). */
  async function parked(label: string) {
    cfg.enabled = false;
    const ahu = await fx.node('AHU', `AHU-${label}`, B1);
    const f = await fx.filter(label, ahu, FP);
    const cycleId = await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    cfg.enabled = true;
    const row = await prisma.cleaningStageApproval.create({
      data: { cycleId, filterId: f, stageKey: 'WASH_OUT', approverRole: APR, rejectToStateKey: 'WASH_IN', detailsSnapshot: {}, requestedBy: op.id, requestedByName: op.username },
    });
    return { f, cycleId, id: row.id };
  }

  it('SUPER_ADMIN may decide any role\'s approval; no remarks and blank remarks are both stored as none', async () => {
    const a = await parked('LEGA');
    const res = await signed(`/api/stage-approvals/${a.id}/approve`, saH);
    expect(res.statusCode).toBe(200);
    expect((await prisma.cleaningStageApproval.findUnique({ where: { id: a.id } }))!.decisionRemarks).toBeNull();
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_APPROVED', targetId: a.id } });
    // No frozen name → the signature names the filter by id.
    expect(audit!.signatureMeaning).toContain(a.f);
    expect(audit!.afterValue).toMatchObject({ filterName: null, remarks: null });

    const b = await parked('LEGB');
    expect((await signed(`/api/stage-approvals/${b.id}/approve`, apr1H, { remarks: '   ' })).statusCode).toBe(200);
    expect((await prisma.cleaningStageApproval.findUnique({ where: { id: b.id } }))!.decisionRemarks).toBeNull();
  });

  it('a reject of a legacy row names the filter by id in the signature', async () => {
    const r = await parked('LEGR');
    expect((await signed(`/api/stage-approvals/${r.id}/reject`, apr1H, { remarks: 'legacy reject' })).statusCode).toBe(200);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_REJECTED', targetId: r.id } });
    expect(audit!.signatureMeaning).toContain(r.f);
    expect(audit!.afterValue).toMatchObject({ filterName: null, rejectToStateKey: 'WASH_IN' });
  });

  it('a legacy orphan is superseded with a null filter name', async () => {
    const o = await parked('LEGO');
    await prisma.filterDetails.update({ where: { assetInstanceId: o.f }, data: { currentLifecycleState: 'DRY_IN' } });
    await call('GET', '/api/stage-approvals/queue', apr1H);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'STAGE_APPROVAL_SUPERSEDED', targetId: o.id } });
    expect(audit!.afterValue).toMatchObject({ filterName: null, currentState: 'DRY_IN' });
  });
});

describe('re-entering a gated stage and notification outages on the operator side', () => {
  it('re-entering Wash Out while its request is still open does not raise a second one', async () => {
    const ahu = await fx.node('AHU', 'AHU-REENT', B1);
    const f = await fx.filter('REENT', ahu, FP_BYP);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    const [first] = await approvals(f);
    // Offline the operator went back to Wash In (not gated), then online forward again.
    expect((await replay(f, 'bypass', { targetState: 'WASH_IN', justification: 'went back to rewash offline' })).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    const all = await approvals(f);
    expect(all.map((a) => a.id)).toEqual([first.id]);
    expect(all[0].status).toBe('PENDING');
    // …and that request is actionable again (the filter is back at the gate).
    expect((await signed(`/api/stage-approvals/${first.id}/approve`, apr1H)).statusCode).toBe(200);
  });

  it('an approver-notification outage never blocks entering the gated stage', async () => {
    const ahu = await fx.node('AHU', 'AHU-NOTE', B1);
    const f = await fx.filter('NOTE', ahu, FP);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    notify.fail = true;
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    expect((await approvals(f))[0].status).toBe('PENDING');
    expect(internalErrors).toEqual([]);
  });

  it('a self-healed approval for a stage entered by a since-deleted user is attributed to that id, named "unknown"', async () => {
    cfg.enabled = false;
    const ahu = await fx.node('AHU', 'AHU-GHOST', B1);
    const f = await fx.filter('GHOST', ahu, FP);
    const cycleId = await start(f);
    const ghost = randomUUID();
    await fx.rawEvent({ filterId: f, cycleId, eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_OUT', performedBy: ghost });
    await prisma.filterDetails.update({ where: { assetInstanceId: f }, data: { currentLifecycleState: 'WASH_OUT' } });
    cfg.enabled = true;
    await state(f, saH);
    expect((await approvals(f))[0]).toMatchObject({ requestedBy: ghost, requestedByName: 'unknown' });
  });

  it('the Dry Out approval detail carries the dryer facts the approver signs against', async () => {
    const c = await atWashOut('DRYDET');
    expect((await signed(`/api/stage-approvals/${c.approvalId}/approve`, apr1H)).statusCode).toBe(200);
    await dry(c.f, c.cycleId);
    expect((await advance(c.f, { targetState: 'DRY_OUT' })).statusCode).toBe(200);
    const dryOut = (await approvals(c.f)).find((a) => a.stageKey === 'DRY_OUT')!;
    const d = (await call('GET', `/api/stage-approvals/${dryOut.id}`, apr1H)).json().stageDetails;
    expect(d.dryIn).toMatchObject({ durationMinutes: 2, startedBy: op.username, endedBy: op.username });
    expect(d.dryIn.startedAt).not.toBeNull();
    expect(d.dryOut.by).toBe(op.username);
  });
});
