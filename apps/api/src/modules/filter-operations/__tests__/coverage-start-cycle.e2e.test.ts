/**
 * POST /api/filters/:id/start-cycle — every refusal and every binding it makes
 * (coverage suite, 2026-10-21). Also the cross-block rule as the operator meets
 * it (current-state's blockChangeStatus → start → advance BLOCK_MISMATCH), the
 * missed-PM gate, and bulk-operate's start-and-advance retry.
 *
 * Real Fastify (production error handler) + real Prisma on digilog_test_db.
 *
 * ONE mock, at the narrowest seam: `blockChangeService.getMode`. The mode lives
 * in the shared `system_config['block-change-approval']` row, which other
 * suites running against the same DB read; flipping it to APPROVAL/NONE would
 * change their outcomes mid-run. Every other block-change method (hasApproval,
 * consumeApprovalTx, the requests table) runs for real against rows this file
 * owns.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const bc = vi.hoisted(() => ({ mode: 'CONFIRM' as 'NONE' | 'CONFIRM' | 'APPROVAL' }));
vi.mock('../../block-change-requests/block-change.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../block-change-requests/block-change.service.js')>();
  return { ...actual, blockChangeService: { ...actual.blockChangeService, getMode: async () => bc.mode } };
});

import { buildApp, internalErrors, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterOperationsRoutes from '../routes.js';
import filterEventsRoutes from '../events-routes.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FOS');
let app: FastifyInstance;
let sa: { id: string; username: string };
let saH: Record<string, string>;
let grant = '';
let B1 = ''; let B2 = ''; let BEQ1 = ''; let BEQ2 = ''; let AHU1 = ''; let AHUEQ1 = ''; let AHUEQ2 = ''; let AHUPM = '';
let FP = ''; let FP_DRAFT = '';

const post = (url: string, payload: Record<string, unknown>, h = saH) =>
  app.inject({ method: 'POST', url, headers: h, payload: { _currentPassword: fx.password, ...payload } });
const start = (id: string, body: Record<string, unknown> = {}) => post(`/api/filters/${id}/start-cycle`, { cleaningReasonKey: 'ROUTINE', ...body });
const replayStart = (id: string, body: Record<string, unknown>) => app.inject({
  method: 'POST', url: `/api/filters/${id}/start-cycle`,
  headers: { ...saH, 'x-offline-replay-token': grant },
  payload: { cleaningReasonKey: 'ROUTINE', offlinePerformedAt: new Date().toISOString(), clientOpId: randomUUID(), ...body },
});
const state = async (id: string, q = '') => {
  const res = await app.inject({ method: 'GET', url: `/api/filters/${id}/current-state${q}`, headers: saH });
  expect(res.statusCode).toBe(200);
  return res.json();
};
const terminate = async (id: string) => {
  const res = await post(`/api/filters/${id}/terminate-cycle`, { justification: 'coverage teardown of this cycle', tapeVersion: (await state(id)).tapeVersion });
  expect(res.statusCode).toBe(200);
};
const cycles = (filterId: string) => prisma.cleaningCycle.findMany({ where: { filterId }, orderBy: { startedAt: 'asc' } });

beforeAll(async () => {
  app = await buildApp([
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
    { plugin: filterEventsRoutes, prefix: '/api/filters' },
  ]);
  sa = await fx.user('sa', 'SUPER_ADMIN');
  B1 = await fx.node('BLOCK', 'B1');
  B2 = await fx.node('BLOCK', 'B2');
  BEQ1 = await fx.node('BLOCK', 'BEQ1');
  BEQ2 = await fx.node('BLOCK', 'BEQ2');
  AHU1 = await fx.node('AHU', 'AHU1', B1);
  AHUEQ1 = await fx.node('AHU', 'AHUEQ1', BEQ1);
  AHUEQ2 = await fx.node('AHU', 'AHUEQ2', BEQ2);
  AHUPM = await fx.node('AHU', 'AHUPM', B1);
  ({ filterProfileId: FP } = await fx.pipeline({ name: 'ST', stages: ['WASH_IN', 'WASH_OUT', 'STORAGE_IN'] }, sa.id));
  ({ filterProfileId: FP_DRAFT } = await fx.pipeline({ name: 'DRAFT', stages: ['WASH_IN'], status: 'DRAFT' }, sa.id));
  saH = await fx.login(app, sa.username);
  grant = await obtainOfflineGrant(app, saH.authorization.slice(7), fx.password);
}, 60_000);

afterAll(async () => {
  try { await fx.cleanup(); } finally { await app?.close(); }
}, 60_000);

beforeEach(() => { internalErrors.length = 0; bc.mode = 'CONFIRM'; });

describe('start-cycle refusals', () => {
  it('a filter still in the creation workflow cannot start (FILTER_NOT_APPROVED)', async () => {
    const f = await fx.filter('PEND', AHU1, FP, { approvalStatus: 'PENDING_REVIEW' });
    const res = await start(f);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('FILTER_NOT_APPROVED');
    expect(await cycles(f)).toHaveLength(0);
  });

  it('a retired filter cannot start (FILTER_RETIRED)', async () => {
    const f = await fx.filter('RET', AHU1, FP, { stage: 'RETIRED' });
    const res = await start(f);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('FILTER_RETIRED');
  });

  it('an empty reason is REASON_REQUIRED; an unknown one INVALID_REASON; a short justification JUSTIFICATION_REQUIRED', async () => {
    const f = await fx.filter('RSN', AHU1, FP);
    const empty = await start(f, { cleaningReasonKey: '' });
    expect([empty.statusCode, empty.json().error]).toEqual([400, 'REASON_REQUIRED']);
    const unknown = await start(f, { cleaningReasonKey: 'NOT_A_REASON' });
    expect([unknown.statusCode, unknown.json().error]).toEqual([400, 'INVALID_REASON']);
    const shortJ = await start(f, { cleaningReasonKey: 'BREAKDOWN', cleaningJustification: 'too short' });
    expect([shortJ.statusCode, shortJ.json().error]).toEqual([400, 'JUSTIFICATION_REQUIRED']);
    expect(await cycles(f)).toHaveLength(0);
  });

  it('a filter whose cleaning profile is not ACTIVE cannot start (PROFILE_DISABLED)', async () => {
    const f = await fx.filter('DRF', AHU1, FP_DRAFT);
    const res = await start(f);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PROFILE_DISABLED');
  });

  it('a second start while a cycle runs is CYCLE_ACTIVE', async () => {
    const f = await fx.filter('DBL', AHU1, FP);
    expect((await start(f)).statusCode).toBe(201);
    const again = await start(f);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('CYCLE_ACTIVE');
    expect(await cycles(f)).toHaveLength(1);
  });

  it('a repeated clientOpId answers the running cycle instead of opening a second', async () => {
    const f = await fx.filter('IDEM', AHU1, FP);
    const op = randomUUID();
    const first = await start(f, { clientOpId: op, cleaningJustification: '<b>bold</b> note' });
    expect(first.statusCode).toBe(201);
    const again = await start(f, { clientOpId: op });
    expect(again.statusCode).toBe(201);
    expect(again.json().currentCycle.id).toBe(first.json().id);
    const all = await cycles(f);
    expect(all).toHaveLength(1);
    // stripHtml escapes markup (disallowedTagsMode: recursiveEscape) before it is stored.
    expect(all[0].cleaningJustification).toBe('&lt;b&gt;bold&lt;/b&gt; note');
  });

  it('an unknown or inactive equipment group is INVALID_EQUIPMENT_GROUP, and nothing is written', async () => {
    const f = await fx.filter('EQX', AHUEQ1, FP);
    const res = await start(f, { equipmentGroupId: randomUUID() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_EQUIPMENT_GROUP');
    expect(await cycles(f)).toHaveLength(0);
  });
});

describe('start-cycle bindings', () => {
  let g1 = ''; let g1version = 0; let g2a = ''; let g2b = '';
  beforeAll(async () => {
    const g = await fx.equipmentGroup(BEQ1, 'G1', [{ stageKey: 'WASH_IN' }], { version: 3 });
    g1 = g.id; g1version = g.version;
    g2a = (await fx.equipmentGroup(BEQ2, 'G2a', [{ stageKey: 'WASH_IN' }])).id;
    g2b = (await fx.equipmentGroup(BEQ2, 'G2b', [{ stageKey: 'WASH_IN' }])).id;
  }, 60_000);

  it('an explicit group is bound and its version pinned', async () => {
    const f = await fx.filter('EQE', AHUEQ1, FP);
    const res = await start(f, { equipmentGroupId: g1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ equipmentGroupId: g1, equipmentGroupVersionPin: g1version });
  });

  it('a block with exactly one active group binds it at start', async () => {
    const f = await fx.filter('EQ1', AHUEQ1, FP);
    const res = await start(f, { cleaningAreaId: BEQ1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ cleaningAreaId: BEQ1, equipmentGroupId: g1, equipmentGroupVersionPin: g1version });
  });

  it('a block with two active groups leaves the cycle unbound; current-state lists both and falls back to the oldest', async () => {
    const f = await fx.filter('EQ2', AHUEQ2, FP);
    const res = await start(f, { cleaningAreaId: BEQ2 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ equipmentGroupId: null, equipmentGroupVersionPin: null });
    const s = await state(f);
    // No bound group → the block fallback returns its first active group.
    expect([BEQ2]).toContain(s.equipmentGroup.blockId);
    expect([g2a, g2b]).toContain(s.equipmentGroup.id);
    // Fixed 2026-10-22 (was always []): an unbound cycle lists EVERY active
    // group of its block, so the client can offer the choice advance demands.
    expect(s.blockEquipmentGroups.map((g: any) => g.id).sort()).toEqual([g2a, g2b].sort());
    // Deterministic fallback: the first of the (createdAt, id)-ordered list.
    expect(s.equipmentGroup.id).toBe(s.blockEquipmentGroups[0].id);
  });

  it('a block with no group at all reports none, and an empty block list', async () => {
    const f = await fx.filter('EQ0', AHU1, FP);
    expect((await start(f, { cleaningAreaId: B1 })).statusCode).toBe(201);
    const s = await state(f);
    expect(s.equipmentGroup).toBeNull();
    expect(s.blockEquipmentGroups).toEqual([]);
  });

  it('a filter with no Block ancestor ignores the requested block for the cross-block rule', async () => {
    const f = await fx.filter('ORPH', null, FP);
    const res = await start(f, { cleaningAreaId: B2 });
    expect(res.statusCode).toBe(201);
    expect(res.json().cleaningAreaId).toBe(B2);
  });
});

describe('cross-block cleaning: CONFIRM / APPROVAL / NONE, start and mid-cycle', () => {
  it('CONFIRM: current-state says CONFIRM, the start is refused until acknowledged', async () => {
    const f = await fx.filter('XC', AHU1, FP);
    expect((await state(f, `?cleaningAreaId=${B1}`)).blockChangeStatus).toBe('MATCH');
    const s = await state(f, `?cleaningAreaId=${B2}`);
    expect(s).toMatchObject({ blockChangeStatus: 'CONFIRM', blockChangeMode: 'CONFIRM' });
    expect(s.homeBlock.id).toBe(B1);
    const refused = await start(f, { cleaningAreaId: B2 });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'BLOCK_CHANGE_CONFIRM', details: { mode: 'CONFIRM', homeBlockId: B1, requestedBlockId: B2 } });
    const ok = await start(f, { cleaningAreaId: B2, acknowledgeBlockChange: true });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().cleaningAreaId).toBe(B2);
  });

  it('a cycle frozen to its block refuses a stage in another block (BLOCK_MISMATCH), unless the mode is NONE', async () => {
    const f = await fx.filter('XM', AHU1, FP);
    expect((await start(f, { cleaningAreaId: B1 })).statusCode).toBe(201);
    const tape = (await state(f)).tapeVersion;
    const res = await post(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', cleaningAreaId: B2, tapeVersion: tape });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'BLOCK_MISMATCH', details: { cycleBlockId: B1, requestedBlockId: B2 } });
    expect(res.json().details.cycleBlockName).toContain('-B1-');
    bc.mode = 'NONE';
    const ok = await post(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', cleaningAreaId: B2, tapeVersion: tape });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().currentState).toBe('WASH_IN');
  });

  it('a requested block id that is not an asset is still a different block, named generically', async () => {
    const f = await fx.filter('XG', AHU1, FP);
    const ghostBlock = randomUUID();
    const refused = await start(f, { cleaningAreaId: ghostBlock });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'BLOCK_CHANGE_CONFIRM', details: { requestedBlockId: ghostBlock, requestedBlockName: '' } });
    expect(refused.json().message).toContain('another block');
    bc.mode = 'APPROVAL';
    expect((await start(f, { cleaningAreaId: ghostBlock })).json().message).toContain('another block');
    // Mid-cycle, a stage submitted for an unknown block is a mismatch, named generically.
    bc.mode = 'CONFIRM';
    expect((await start(f, { cleaningAreaId: B1 })).statusCode).toBe(201);
    const res = await post(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', cleaningAreaId: ghostBlock, tapeVersion: (await state(f)).tapeVersion });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'BLOCK_MISMATCH', details: { requestedBlockName: '' } });
    expect(res.json().message).toContain('a different block');
  });

  it('APPROVAL: refused without an approved request; an approval is spent by the start it allows', async () => {
    bc.mode = 'APPROVAL';
    const f = await fx.filter('XA', AHU1, FP);
    expect((await state(f, `?cleaningAreaId=${B2}`)).blockChangeStatus).toBe('REQUIRED');
    const refused = await start(f, { cleaningAreaId: B2 });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('BLOCK_CHANGE_REQUIRED');
    const reqId = await fx.blockChange(f, B1, B2, sa.id, 'APPROVED');
    expect((await state(f, `?cleaningAreaId=${B2}`)).blockChangeStatus).toBe('APPROVED');
    const ok = await start(f, { cleaningAreaId: B2 });
    expect(ok.statusCode).toBe(201);
    expect((await prisma.blockChangeRequest.findUnique({ where: { id: reqId } }))!.status).toBe('EXPIRED');
    // single use: the next start in that block needs a new approval
    await terminate(f);
    expect((await start(f, { cleaningAreaId: B2 })).json().error).toBe('BLOCK_CHANGE_REQUIRED');
  });

  it('NONE: no prompt and no refusal', async () => {
    bc.mode = 'NONE';
    const f = await fx.filter('XN', AHU1, FP);
    expect((await state(f, `?cleaningAreaId=${B2}`)).blockChangeStatus).toBe('MATCH');
    expect((await start(f, { cleaningAreaId: B2 })).statusCode).toBe(201);
  });

  it('an offline replay is never gated; the skipped gate is recorded on the event and audit row', async () => {
    const f = await fx.filter('XO', AHU1, FP);
    const res = await replayStart(f, { cleaningAreaId: B2 });
    expect(res.statusCode).toBe(201);
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: f, eventType: 'CYCLE_STARTED' } });
    expect((ev!.attributes as any).replayExemptGates).toEqual(['REAUTH', 'BLOCK_CHANGE']);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'CYCLE_STARTED', targetId: res.json().id } });
    expect(audit!.afterValue).toMatchObject({ offlineReplay: true, replayExemptGates: ['REAUTH', 'BLOCK_CHANGE'] });
  });

  it('an offline replay under NONE records only the re-auth exemption', async () => {
    bc.mode = 'NONE';
    const f = await fx.filter('XON', AHU1, FP);
    const res = await replayStart(f, { cleaningAreaId: B2 });
    expect(res.statusCode).toBe(201);
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: f, eventType: 'CYCLE_STARTED' } });
    expect((ev!.attributes as any).replayExemptGates).toEqual(['REAUTH']);
  });

  it('a replay grant without offlinePerformedAt / clientOpId is refused (OFFLINE_REPLAY_FIELDS_REQUIRED)', async () => {
    const f = await fx.filter('XF', AHU1, FP);
    const res = await app.inject({
      method: 'POST', url: `/api/filters/${f}/start-cycle`, headers: { ...saH, 'x-offline-replay-token': grant },
      payload: { cleaningReasonKey: 'ROUTINE' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'OFFLINE_REPLAY_FIELDS_REQUIRED', details: { missing: ['offlinePerformedAt', 'clientOpId'] } });
    expect(internalErrors).toEqual([]);
  });
});

describe('missed-PM gate: an earlier scheduled PM must be written off before the next cleaning', () => {
  let F = ''; let entryId = '';
  beforeAll(async () => {
    F = await fx.filter('PMF', AHUPM, FP);
    ({ entryId } = await fx.overduePm(AHUPM, sa.id));
  }, 60_000);

  it('is refused with the outstanding visit listed', async () => {
    const res = await start(F);
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('PM_PREVIOUS_TASK_PENDING');
    expect(body.details.pendingPmTasks.map((t: any) => t.entryId)).toEqual([entryId]);
    expect(body.details.pendingPmTasks[0].ahuId).toBe(AHUPM);
    expect(body.details.minReasonLength).toBeGreaterThan(0);
  });

  it('a reason shorter than the minimum is still refused', async () => {
    const res = await start(F, { pmSkips: [{ entryId, reason: 'no' }, null, { entryId: 5 }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_PREVIOUS_TASK_PENDING');
  });

  it('an offline replay is not asked: it starts, records MISSED_PM, and writes nothing off', async () => {
    const res = await replayStart(F, {});
    expect(res.statusCode).toBe(201);
    const ev = await prisma.filterEvent.findFirst({ where: { cycleId: res.json().id, eventType: 'CYCLE_STARTED' } });
    expect((ev!.attributes as any).replayExemptGates).toEqual(['REAUTH', 'MISSED_PM']);
    expect((await prisma.pmScheduleEntry.findUnique({ where: { id: entryId } }))!.skippedAt).toBeNull();
    await terminate(F);
  });

  it('with a reason the visit is written off (not completed) in the same transaction as the start', async () => {
    const reason = 'AHU was shut down for civil work';
    const res = await start(F, { pmSkips: [{ entryId, reason: `  ${reason}  ` }] });
    expect(res.statusCode).toBe(201);
    const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId } });
    expect(entry).toMatchObject({ skipReason: reason, skippedBy: sa.id });
    expect(entry!.skippedAt).not.toBeNull();
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'PM_TASK_SKIPPED', targetId: entryId } });
    expect(audit).not.toBeNull();
    expect(await prisma.pmExecution.count({ where: { scheduleEntryId: entryId } })).toBe(0);
  });
});

describe('PM due today', () => {
  it('current-state marks a filter whose AHU has a PM visit in its window today as PM-due', async () => {
    const ahu = await fx.node('AHU', 'AHUDUE', B1);
    const f = await fx.filter('DUE', ahu, FP);
    const today = new Date();
    const utc = (o: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + o));
    const s = await prisma.pmSchedule.create({
      data: {
        entityId: ahu, year: today.getUTCFullYear(), status: 'ACTIVE', createdBy: sa.id,
        entries: { create: [{ month: today.getUTCMonth() + 1, plannedDate: utc(0), toleranceDays: 3, windowStart: utc(-3), windowEnd: utc(3), approvalStatus: 'APPROVED' }] },
      },
    });
    fx.pmScheduleIds.push(s.id);
    const st = await state(f);
    expect(st.isPmDue).toBe(true);
    // The PM reason key comes from the configured catalogue (none configured in a seeded DB).
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
    const raw = cfg?.configValue as any;
    const list: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.value) ? raw.value : []);
    const pm = list.find((r) => r && r.isActive !== false && (String(r.key).toUpperCase() === 'PM' || String(r.name).toUpperCase() === 'PM'));
    expect(st.pmReasonKey).toBe(pm?.key ?? null);
    // A filter of another AHU is not.
    expect((await state(await fx.filter('NOTDUE', AHU1, FP))).isPmDue).toBe(false);
  });
});

describe('bulk-operate start-and-advance', () => {
  it('a retried item whose start already committed goes on to the advance', async () => {
    const f = await fx.filter('BLK', AHU1, FP);
    expect((await start(f)).statusCode).toBe(201);
    const res = await post('/api/filters/bulk-operate', {
      items: [{
        clientOpId: randomUUID(), filterId: f, kind: 'start-and-advance',
        cyclePayload: { cleaningReasonKey: 'ROUTINE' },
        advancePayload: { targetState: 'WASH_IN', tapeVersion: (await state(f)).tapeVersion },
      }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ status: 'ok', filterId: f });
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: f } }))!.currentLifecycleState).toBe('WASH_IN');
    expect(await cycles(f)).toHaveLength(1);
  });

  it('any other start refusal fails the item with its own code', async () => {
    const f = await fx.filter('BLKX', AHU1, FP);
    const res = await post('/api/filters/bulk-operate', {
      items: [{ clientOpId: randomUUID(), filterId: f, kind: 'start-and-advance', cyclePayload: { cleaningReasonKey: 'NOPE' }, advancePayload: { targetState: 'WASH_IN' } }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ status: 'failed', error: { code: 'INVALID_REASON' } });
    expect(await cycles(f)).toHaveLength(0);
  });
});

describe('filter-only endpoints refuse a non-filter asset', () => {
  // Fixed 2026-10-22. getFilter() / loadLocalContext() resolved ANY
  // asset_instance id, so start-cycle answered 201 and opened a cleaning cycle on
  // an AHU, retire answered 200 and retired the AHU (its child filters stayed
  // active under it) and replace answered 200 and minted a new AHU. A FILTER-only
  // endpoint now answers a non-filter id exactly like an unknown one: 404.
  let ahu = ''; let child = '';
  beforeAll(async () => {
    ahu = await fx.node('AHU', 'PROBEAHU', B1);
    child = await fx.filter('PROBECHILD', ahu, FP);
  }, 60_000);

  const expectNotAFilter = (res: Awaited<ReturnType<typeof post>>) => {
    expect([res.statusCode, res.json().error]).toEqual([404, 'NOT_FOUND']);
    expect(res.json().message).toBe('Filter not found');
  };

  it('start-cycle on an AHU id is 404 and opens no cycle', async () => {
    expectNotAFilter(await start(ahu, {}));
    expect(await prisma.cleaningCycle.count({ where: { filterId: ahu } })).toBe(0);
    expect(await prisma.filterDetails.count({ where: { assetInstanceId: ahu } })).toBe(0);
  });

  it('retire and replace on an AHU id are 404 and change nothing', async () => {
    expectNotAFilter(await post(`/api/filters/${ahu}/retire`, { remarks: 'probe' }));
    expectNotAFilter(await post(`/api/filters/${ahu}/replace`, { remarks: 'probe' }));
    const row = await prisma.assetInstance.findUnique({ where: { id: ahu } });
    expect(row).toMatchObject({ isActive: true, status: 'Active', parentId: B1 });
    expect(await prisma.assetInstance.count({ where: { parentId: B1, name: { startsWith: row!.name + '-' } } })).toBe(0);
    expect(await prisma.auditTrail.count({ where: { action: { in: ['FILTER_RETIRED', 'FILTER_REPLACED'] }, targetId: ahu } })).toBe(0);
    expect((await prisma.assetInstance.findUnique({ where: { id: child } }))!.isActive).toBe(true);
  });

  it('every other filter route answers an AHU id as an unknown filter', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, headers: saH });
    expectNotAFilter(await get(`/api/filters/${ahu}/current-state`));
    for (const q of ['events', 'cycles', 'cleaning-record', 'manual-status-changes']) {
      expectNotAFilter(await get(`/api/filters/${q}?filterId=${ahu}`));
    }
    for (const [op, body] of [
      ['advance', { targetState: 'WASH_IN', tapeVersion: 0 }],
      ['bypass', { targetState: 'WASH_IN', justification: 'not a filter probe', tapeVersion: 0 }],
      ['terminate-cycle', { justification: 'not a filter probe', tapeVersion: 0 }],
      ['submit-checklist', { answers: {}, tapeVersion: 0 }],
      ['advance-with-checklist', { targetState: 'WASH_IN', answers: {}, tapeVersion: 0 }],
    ] as const) {
      expectNotAFilter(await post(`/api/filters/${ahu}/${op}`, body));
    }
    expect(internalErrors).toEqual([]);
  });
});
