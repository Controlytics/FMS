/**
 * Cycle writes after the start: advance (equipment-group readings, dryer,
 * completion retry), bypass, terminate, the two checklist paths, and the
 * retire / replace write sets (coverage suite, 2026-10-21).
 *
 * Real Fastify (production error handler) + real Prisma on digilog_test_db, no
 * mocks. The stage interlock and the cross-block rule stay at their stored
 * values (interlock off, CONFIRM) — this file never crosses blocks and never
 * enters a gated stage, so it reads those rows without depending on them.
 * Filters that complete a cycle are parented to NOTHING, so the AHU-completion
 * gate (a shared config row other suites may flip) cannot engage.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterOperationsRoutes from '../routes.js';
import { toLocalDateString } from '../helpers.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FOA');
let app: FastifyInstance;
let sa: { id: string; username: string };
let saH: Record<string, string>;
let grant = '';
let B1 = ''; let AHU1 = '';
let FP_MAIN = ''; let FP_BYP = ''; let FP_DRY = ''; let FP_CL = ''; let FP_CLEND = '';
let CL1 = ''; let qLive = ''; const qSnap = randomUUID();
let CL2 = ''; let q2 = '';
const extraFilterIds: string[] = [];

const post = (url: string, payload: Record<string, unknown>, h = saH) =>
  app.inject({ method: 'POST', url, headers: h, payload: { _currentPassword: fx.password, ...payload } });
const replay = (url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST', url, headers: { ...saH, 'x-offline-replay-token': grant },
    payload: { offlinePerformedAt: new Date().toISOString(), clientOpId: randomUUID(), ...payload },
  });
const state = async (id: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/filters/${id}/current-state`, headers: saH });
  expect(res.statusCode).toBe(200);
  return res.json();
};
const tape = async (id: string) => (await state(id)).tapeVersion as number;
const start = async (id: string, body: Record<string, unknown> = {}) => {
  const res = await post(`/api/filters/${id}/start-cycle`, { cleaningReasonKey: 'ROUTINE', ...body });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
};
const advance = async (id: string, body: Record<string, unknown>) =>
  post(`/api/filters/${id}/advance`, { tapeVersion: await tape(id), ...body });
const fd = (id: string) => prisma.filterDetails.findUnique({ where: { assetInstanceId: id } });
const events = (filterId: string, eventType: string) => prisma.filterEvent.findMany({ where: { filterId, eventType: eventType as any }, orderBy: { performedAt: 'asc' } });

beforeAll(async () => {
  app = await buildApp([{ plugin: filterOperationsRoutes, prefix: '/api/filters' }]);
  sa = await fx.user('sa', 'SUPER_ADMIN');
  B1 = await fx.node('BLOCK', 'B1');
  AHU1 = await fx.node('AHU', 'AHU1', B1);
  const stages = ['WASH_IN', 'WASH_OUT', 'STORAGE_IN'];
  ({ filterProfileId: FP_MAIN } = await fx.pipeline({ name: 'MAIN', stages }, sa.id));
  ({ filterProfileId: FP_BYP } = await fx.pipeline({ name: 'BYP', stages, flowMode: 'BYPASS_ENABLED' }, sa.id));
  ({ filterProfileId: FP_DRY } = await fx.pipeline({ name: 'DRY', stages: ['DRY_IN', 'DRY_OUT', 'STORAGE_IN'] }, sa.id));
  const cl1 = await fx.checklist('CL1', [{ question: 'Live question (must not be asked of a pinned cycle)' }]);
  CL1 = cl1.id; qLive = cl1.questionIds[0];
  // The cycle pins CL1 at version 1; this is what version 1 asked.
  await prisma.checklistProfileVersion.create({
    data: { profileId: CL1, versionNumber: cl1.version, snapshot: { name: 'CL1 v1', questions: [{ id: qSnap, question: 'Pinned question', questionType: 'YES_NO', required: true, sortOrder: 1 }] } },
  });
  ({ filterProfileId: FP_CL } = await fx.pipeline({ name: 'CL', stages: ['S1', 'S2'], checklistAfter: { 0: CL1 } }, sa.id));
  const cl2 = await fx.checklist('CL2', [{ question: 'Final check' }]);
  CL2 = cl2.id; q2 = cl2.questionIds[0];
  ({ filterProfileId: FP_CLEND } = await fx.pipeline({ name: 'CLEND', stages: ['T1'], checklistAfter: { 0: CL2 } }, sa.id));
  saH = await fx.login(app, sa.username);
  grant = await obtainOfflineGrant(app, saH.authorization.slice(7), fx.password);
}, 60_000);

afterAll(async () => {
  try { await fx.cleanup({ filterIds: extraFilterIds }); } finally { await app?.close(); }
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('advance: cycle-state guards', () => {
  it('no cycle at all → NO_CYCLE', async () => {
    const f = await fx.filter('NOC', AHU1, FP_MAIN);
    const res = await post(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', tapeVersion: 0 });
    expect([res.statusCode, res.json().error]).toEqual([400, 'NO_CYCLE']);
  });

  it('a pointer to a finished cycle → NO_ACTIVE_CYCLE on advance and on submit-checklist', async () => {
    const f = await fx.filter('FIN', AHU1, FP_MAIN);
    const c = await fx.rawCycle(f, (await prisma.filterProfile.findUnique({ where: { id: FP_MAIN } }))!.cleaningProfileId, { status: 'COMPLETED' });
    await prisma.filterDetails.update({ where: { assetInstanceId: f }, data: { currentCycleId: c.id } });
    const a = await post(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', tapeVersion: 0 });
    expect([a.statusCode, a.json().error]).toEqual([400, 'NO_ACTIVE_CYCLE']);
    const s = await post(`/api/filters/${f}/submit-checklist`, { answers: {}, tapeVersion: 0 });
    expect([s.statusCode, s.json().error]).toEqual([400, 'NO_ACTIVE_CYCLE']);
  });

  it('a stale tape → 409 STALE_TAPE naming the live version', async () => {
    const f = await fx.filter('STALE', AHU1, FP_MAIN);
    await start(f);
    const live = await tape(f);
    const res = await post(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', tapeVersion: live + 7 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'STALE_TAPE', details: { currentTapeVersion: live } });
  });

  it('with no equipment group and no block, Wash In needs no readings', async () => {
    const f = await fx.filter('NOGRP', AHU1, FP_MAIN);
    await start(f);
    const res = await advance(f, { targetState: 'WASH_IN' });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentState).toBe('WASH_IN');
  });
});

describe('advance: equipment-group readings (pin → snapshot / live / legacy / lazy / ambiguous)', () => {
  it('a bound group demands its Wash In readings, each of them', async () => {
    const blk = await fx.node('BLOCK', 'BEQA');
    const ahu = await fx.node('AHU', 'AHUEQA', blk);
    const g = await fx.equipmentGroup(blk, 'GA', [{ stageKey: 'WASH_IN' }, { stageKey: 'WASH_IN' }, { stageKey: 'DRY_IN' }]);
    const f = await fx.filter('EQA', ahu, FP_MAIN);
    await start(f, { equipmentGroupId: g.id });
    const none = await advance(f, { targetState: 'WASH_IN' });
    expect([none.statusCode, none.json().error]).toEqual([400, 'WASH_IN_READINGS_REQUIRED']);
    const half = await advance(f, { targetState: 'WASH_IN', instrumentReadings: { [g.instruments[0].id]: 12 } });
    expect([half.statusCode, half.json().error]).toEqual([400, 'READING_REQUIRED']);
  });

  it('a pinned cycle validates against the version snapshot, not the live ranges; out-of-range is recorded, not refused', async () => {
    const blk = await fx.node('BLOCK', 'BEQS');
    const ahu = await fx.node('AHU', 'AHUEQS', blk);
    const g = await fx.equipmentGroup(blk, 'GS', [{ stageKey: 'WASH_IN', min: 10, max: 20 }, { stageKey: 'WASH_IN', min: 10, max: 20 }]);
    const [i0, i1] = g.instruments;
    await prisma.equipmentGroupVersion.create({
      data: {
        groupId: g.id, versionNumber: g.version,
        snapshot: {
          name: 'Snapshot GS', blockId: blk, isActive: true,
          instruments: [
            { ...i0, operatingMin: 50, operatingMax: 60, sortOrder: 1 },
            { ...i1, operatingMin: 50, operatingMax: 60, sortOrder: 0 },
          ],
        },
      },
    });
    const f = await fx.filter('EQS', ahu, FP_MAIN);
    await start(f, { equipmentGroupId: g.id });
    const s = await state(f);
    expect(s.equipmentGroup).toMatchObject({ id: g.id, name: 'Snapshot GS', version: g.version });
    expect(s.equipmentGroup.instruments.map((i: any) => i.id)).toEqual([i1.id, i0.id]); // snapshot sortOrder
    const res = await advance(f, {
      targetState: 'WASH_IN', instrumentReadings: { [i0.id]: 15, [i1.id]: 55 }, readingSources: { [i0.id]: 'AUTO_OVERRIDDEN' },
    });
    expect(res.statusCode).toBe(200);
    const ev = (await events(f, 'STATE_TRANSITION')).find((e) => e.toState === 'WASH_IN')!;
    const readings = (ev.attributes as any).instrumentReadings as any[];
    const r0 = readings.find((r) => r.instrumentId === i0.id);
    const r1 = readings.find((r) => r.instrumentId === i1.id);
    expect(r0).toMatchObject({ value: 15, outOfRange: true, operatingMin: 50, operatingMax: 60, source: 'AUTO_OVERRIDDEN' });
    expect(r1.outOfRange).toBeUndefined();
    expect(r1.source).toBeUndefined();
  });

  it('a pin with no snapshot row and a live group that moved on → snapshotMissing in current-state, GROUP_VERSION_MISSING on advance', async () => {
    const blk = await fx.node('BLOCK', 'BEQM');
    const ahu = await fx.node('AHU', 'AHUEQM', blk);
    const g = await fx.equipmentGroup(blk, 'GM', [{ stageKey: 'WASH_IN' }]);
    const f = await fx.filter('EQM', ahu, FP_MAIN);
    await start(f, { equipmentGroupId: g.id });
    await prisma.equipmentGroup.update({ where: { id: g.id }, data: { version: g.version + 1 } });
    const s = await state(f);
    expect(s.equipmentGroup).toMatchObject({ id: g.id, snapshotMissing: true, pinnedVersion: g.version, liveVersion: g.version + 1 });
    const res = await advance(f, { targetState: 'WASH_IN', instrumentReadings: { [g.instruments[0].id]: 12 } });
    expect([res.statusCode, res.json().error]).toEqual([409, 'GROUP_VERSION_MISSING']);
  });

  it('a pin with no snapshot row but the same live version validates against the live row', async () => {
    const blk = await fx.node('BLOCK', 'BEQL');
    const ahu = await fx.node('AHU', 'AHUEQL', blk);
    const g = await fx.equipmentGroup(blk, 'GL', [{ stageKey: 'WASH_IN', min: 10, max: 20 }]);
    const f = await fx.filter('EQL', ahu, FP_MAIN);
    await start(f, { equipmentGroupId: g.id });
    const res = await advance(f, { targetState: 'WASH_IN', instrumentReadings: { [g.instruments[0].id]: 25 } });
    expect(res.statusCode).toBe(200);
    const ev = (await events(f, 'STATE_TRANSITION'))[0];
    expect((ev.attributes as any).instrumentReadings[0]).toMatchObject({ value: 25, outOfRange: true, operatingMin: 10, operatingMax: 20 });
  });

  it('a legacy cycle (no pin) reads the live group, in current-state and on advance', async () => {
    const blk = await fx.node('BLOCK', 'BEQG');
    const ahu = await fx.node('AHU', 'AHUEQG', blk);
    const g = await fx.equipmentGroup(blk, 'GG', [{ stageKey: 'WASH_IN', min: 10, max: 20 }]);
    const f = await fx.filter('EQG', ahu, FP_MAIN);
    const c = await start(f, { equipmentGroupId: g.id });
    await prisma.cleaningCycle.update({ where: { id: c.id }, data: { equipmentGroupVersionPin: null } });
    const s = await state(f);
    expect(s.equipmentGroup).toMatchObject({ id: g.id, version: g.version });
    expect(s.equipmentGroup.snapshotMissing).toBeUndefined();
    const res = await advance(f, { targetState: 'WASH_IN', instrumentReadings: { [g.instruments[0].id]: 15 } });
    expect(res.statusCode).toBe(200);
    const r = (await events(f, 'STATE_TRANSITION'))[0].attributes as any;
    expect(r.instrumentReadings[0]).toMatchObject({ value: 15, uom: 'bar' });
    expect(r.instrumentReadings[0].outOfRange).toBeUndefined();
  });

  it('a group added to the block after the start is bound (and pinned) by the first readings', async () => {
    const blk = await fx.node('BLOCK', 'BLZ');
    const ahu = await fx.node('AHU', 'AHULZ', blk);
    const f = await fx.filter('LZ', ahu, FP_MAIN);
    const c = await start(f, { cleaningAreaId: blk });
    expect((await prisma.cleaningCycle.findUnique({ where: { id: c.id } }))!.equipmentGroupId).toBeNull();
    const g = await fx.equipmentGroup(blk, 'GLZ', [{ stageKey: 'WASH_IN' }], { version: 4 });
    const res = await advance(f, { targetState: 'WASH_IN', instrumentReadings: { [g.instruments[0].id]: 12 } });
    expect(res.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.id } })).toMatchObject({ equipmentGroupId: g.id, equipmentGroupVersionPin: 4 });
  });

  it('a block with two groups: readings need a choice; a chosen group is validated and bound', async () => {
    const blk = await fx.node('BLOCK', 'BAMB');
    const ahu = await fx.node('AHU', 'AHUAMB', blk);
    const ga = await fx.equipmentGroup(blk, 'GAMB1', [{ stageKey: 'WASH_IN' }]);
    await fx.equipmentGroup(blk, 'GAMB2', [{ stageKey: 'WASH_IN' }]);
    const f = await fx.filter('AMB', ahu, FP_MAIN);
    const c = await start(f, { cleaningAreaId: blk });
    const none = await advance(f, { targetState: 'WASH_IN' });
    expect([none.statusCode, none.json().error]).toEqual([400, 'WASH_IN_READINGS_REQUIRED']);
    const ambiguous = await advance(f, { targetState: 'WASH_IN', instrumentReadings: { [ga.instruments[0].id]: 12 } });
    expect([ambiguous.statusCode, ambiguous.json().error]).toEqual([400, 'MULTIPLE_EQUIPMENT_GROUPS']);
    const unknown = await advance(f, { targetState: 'WASH_IN', equipmentGroupId: randomUUID(), instrumentReadings: { [ga.instruments[0].id]: 12 } });
    expect([unknown.statusCode, unknown.json().error]).toEqual([400, 'INVALID_EQUIPMENT_GROUP']);
    const ok = await advance(f, { targetState: 'WASH_IN', equipmentGroupId: ga.id, instrumentReadings: { [ga.instruments[0].id]: 12 } });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.cleaningCycle.findUnique({ where: { id: c.id } }))!.equipmentGroupId).toBe(ga.id);
  });
});

describe('advance: the dryer', () => {
  let f = ''; let cycleId = '';
  beforeAll(async () => {
    f = await fx.filter('DRY', AHU1, FP_DRY);
    cycleId = (await start(f)).id;
  }, 60_000);

  it('Dry In cannot be entered without a duration', async () => {
    const res = await advance(f, { targetState: 'DRY_IN' });
    expect([res.statusCode, res.json().error]).toEqual([400, 'DRYER_DURATION_REQUIRED']);
  });

  it('SET_DURATION enters Dry In and starts the dryer on the cycle (one event, labelled)', async () => {
    const res = await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 4 });
    expect(res.statusCode).toBe(200);
    const c = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
    expect(c!.dryerDurationMinutes).toBe(4);
    expect(c!.dryerStartedAt).not.toBeNull();
    const ev = await events(f, 'STATE_TRANSITION');
    expect(ev).toHaveLength(1);
    expect(ev[0].remarks).toBe('Dryer started for 4 minute(s)');
    expect((ev[0].attributes as any).action).toBe('DRYER_STARTED');
  });

  it('readings before half-time are refused; leaving Dry In without readings is refused', async () => {
    const early = await advance(f, { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect([early.statusCode, early.json().error]).toEqual([400, 'DRYER_NOT_READY']);
    await prisma.cleaningCycle.update({ where: { id: cycleId }, data: { dryerStartedAt: new Date(Date.now() - 10 * 60_000) } });
    const leave = await advance(f, { targetState: 'DRY_OUT' });
    expect([leave.statusCode, leave.json().error]).toEqual([400, 'DRYER_READINGS_REQUIRED']);
  });

  it('SUBMIT_READINGS after half-time is recorded in place, then Dry Out is allowed', async () => {
    const res = await advance(f, { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect(res.statusCode).toBe(200);
    expect((await prisma.cleaningCycle.findUnique({ where: { id: cycleId } }))!.dryerReadingsSubmitted).toBe(true);
    const inPlace = (await events(f, 'STATE_TRANSITION'))[1];
    expect(inPlace).toMatchObject({ fromState: null, toState: 'DRY_IN' });
    expect((inPlace.attributes as any).action).toBe('DRYER_READINGS_SUBMITTED');
    const out = await advance(f, { targetState: 'DRY_OUT' });
    expect(out.statusCode).toBe(200);
    expect((await fd(f))!.currentLifecycleState).toBe('DRY_OUT');
  });
});

describe('advance: completing the cycle, and a retry of that completion', () => {
  it('the completing advance closes the cycle, stamps Last Cleaned, and a retry with the same op id is a no-op', async () => {
    const f = await fx.filter('CMP', null, FP_MAIN);
    const c = await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    expect((await advance(f, { targetState: 'WASH_OUT' })).statusCode).toBe(200);
    const op = randomUUID();
    // filterSet scopes the AHU-completion roster exactly as on submit-checklist.
    const body = { targetState: 'STORAGE_IN', clientOpId: op, tapeVersion: await tape(f), remarks: 'final <i>stage</i>', filterSet: 'SET_B' };
    const done = await post(`/api/filters/${f}/advance`, body);
    expect(done.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'COMPLETED' });
    expect(await fd(f)).toMatchObject({ currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' });
    const typed = await prisma.filter.findUnique({ where: { id: f } });
    expect((typed!.attributes as any).lastCleaningDate).toBe(toLocalDateString(new Date()));
    expect(await prisma.auditTrail.count({ where: { action: 'CYCLE_COMPLETED', targetId: f } })).toBe(1);
    const retry = await post(`/api/filters/${f}/advance`, body);
    expect(retry.statusCode).toBe(200);
    expect(await events(f, 'CYCLE_COMPLETED')).toHaveLength(1);
    expect((await events(f, 'STATE_TRANSITION')).filter((e) => e.toState === 'STORAGE_IN')).toHaveLength(1);
  });

  it('an offline advance carries the operator\'s instant and is marked as offline', async () => {
    const f = await fx.filter('OFFA', AHU1, FP_MAIN);
    await start(f);
    const at = new Date(Date.now() + 1000).toISOString();
    const res = await replay(`/api/filters/${f}/advance`, { targetState: 'WASH_IN', offlinePerformedAt: at, tapeVersion: await tape(f) });
    expect(res.statusCode).toBe(200);
    const ev = (await events(f, 'STATE_TRANSITION'))[0];
    expect(ev.performedAt.toISOString()).toBe(at);
    expect(ev.attributes).toMatchObject({ __offlineEntry: true, replayExemptGates: ['REAUTH'] });
  });
});

describe('bypass', () => {
  let f = ''; const op = randomUUID();

  it('a STRICT profile forbids it (403 BYPASS_FORBIDDEN)', async () => {
    const strict = await fx.filter('STR', AHU1, FP_MAIN);
    await start(strict);
    const res = await post(`/api/filters/${strict}/bypass`, { targetState: 'STORAGE_IN', justification: 'skip the wash stages', tapeVersion: await tape(strict) });
    expect([res.statusCode, res.json().error]).toEqual([403, 'BYPASS_FORBIDDEN']);
  });

  it('an unknown target is INVALID_TARGET', async () => {
    f = await fx.filter('BYP', AHU1, FP_BYP);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const res = await post(`/api/filters/${f}/bypass`, { targetState: 'GHOST_STAGE', justification: 'not a real stage here', tapeVersion: await tape(f) });
    expect([res.statusCode, res.json().error]).toEqual([400, 'INVALID_TARGET']);
  });

  it('records a deviation event + audit row and moves the filter', async () => {
    const res = await post(`/api/filters/${f}/bypass`, { targetState: 'STORAGE_IN', justification: 'wash line down for repair', clientOpId: op, tapeVersion: await tape(f) });
    expect(res.statusCode).toBe(200);
    expect(res.json().currentState).toBe('STORAGE_IN');
    const ev = await events(f, 'BYPASS_DEVIATION');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromState: 'WASH_IN', toState: 'STORAGE_IN', remarks: 'wash line down for repair' });
    expect(ev[0].deviationDetails).toMatchObject({ type: 'BYPASS', fromState: 'WASH_IN', toState: 'STORAGE_IN' });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'BYPASS_DEVIATION', targetId: f } });
    expect(audit!.afterValue).toMatchObject({ state: 'STORAGE_IN', justification: 'wash line down for repair' });
  });

  it('a retry with the same op id is a no-op, also after the cycle has ended', async () => {
    const again = await post(`/api/filters/${f}/bypass`, { targetState: 'STORAGE_IN', justification: 'wash line down for repair', clientOpId: op, tapeVersion: 0 });
    expect(again.statusCode).toBe(200);
    const term = await post(`/api/filters/${f}/terminate-cycle`, { justification: 'cycle abandoned after bypass', tapeVersion: await tape(f) });
    expect(term.statusCode).toBe(200);
    const late = await post(`/api/filters/${f}/bypass`, { targetState: 'STORAGE_IN', justification: 'wash line down for repair', clientOpId: op, tapeVersion: 0 });
    expect(late.statusCode).toBe(200);
    expect(await events(f, 'BYPASS_DEVIATION')).toHaveLength(1);
  });

  it('an offline bypass is applied with its instant, marked offline, and the skipped re-auth recorded', async () => {
    const g = await fx.filter('BYPO', AHU1, FP_BYP);
    await start(g);
    const at = new Date(Date.now() + 500).toISOString();
    const res = await replay(`/api/filters/${g}/bypass`, { targetState: 'WASH_OUT', justification: 'offline deviation on the floor', offlinePerformedAt: at, tapeVersion: await tape(g) });
    expect(res.statusCode).toBe(200);
    const ev = (await events(g, 'BYPASS_DEVIATION'))[0];
    expect(ev.performedAt.toISOString()).toBe(at);
    expect(ev.attributes).toMatchObject({ __offlineEntry: true, replayExemptGates: ['REAUTH'] });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'BYPASS_DEVIATION', targetId: g } });
    expect(audit!.afterValue).toMatchObject({ offlineReplay: true, replayExemptGates: ['REAUTH'] });
  });
});

describe('terminate-cycle', () => {
  it('no cycle → NO_CYCLE', async () => {
    const f = await fx.filter('TNC', AHU1, FP_MAIN);
    const res = await post(`/api/filters/${f}/terminate-cycle`, { justification: 'nothing to terminate here', tapeVersion: 0 });
    expect([res.statusCode, res.json().error]).toEqual([400, 'NO_CYCLE']);
  });

  it('ends the cycle with event + audit, and a retry of the same op is a no-op', async () => {
    const f = await fx.filter('TRM', AHU1, FP_MAIN);
    const c = await start(f);
    const op = randomUUID();
    const body = { justification: 'filter damaged mid-cycle', clientOpId: op, tapeVersion: await tape(f) };
    expect((await post(`/api/filters/${f}/terminate-cycle`, body)).statusCode).toBe(200);
    const cyc = await prisma.cleaningCycle.findUnique({ where: { id: c.id } });
    expect(cyc!.status).toBe('TERMINATED');
    expect(cyc!.terminatedAt).not.toBeNull();
    expect(await fd(f)).toMatchObject({ currentCycleId: null, currentLifecycleState: null });
    expect((await events(f, 'CYCLE_TERMINATED'))[0].attributes).toMatchObject({ justification: 'filter damaged mid-cycle', clientOpId: op });
    expect((await post(`/api/filters/${f}/terminate-cycle`, body)).statusCode).toBe(200);
    expect(await events(f, 'CYCLE_TERMINATED')).toHaveLength(1);
  });

  it('an offline terminate records the replay exemption', async () => {
    const f = await fx.filter('TRO', AHU1, FP_MAIN);
    await start(f);
    const res = await replay(`/api/filters/${f}/terminate-cycle`, { justification: 'terminated while offline', tapeVersion: await tape(f) });
    expect(res.statusCode).toBe(200);
    expect((await events(f, 'CYCLE_TERMINATED'))[0].attributes).toMatchObject({ replayExemptGates: ['REAUTH'] });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'CYCLE_TERMINATED', targetId: f } });
    expect(audit!.afterValue).toMatchObject({ offlineReplay: true, replayExemptGates: ['REAUTH'] });
  });
});

describe('checklists: pinned versions, the composed op and completion retries', () => {
  it('a cycle answers the checklist version it pinned at start, not the live questions', async () => {
    const f = await fx.filter('PIN', null, FP_CL);
    await start(f);
    const live = await post(`/api/filters/${f}/advance-with-checklist`, { targetState: 'S1', answers: { [qLive]: 'YES' }, tapeVersion: await tape(f) });
    // The required question is the PINNED version's (qSnap), not the live one.
    expect([live.statusCode, live.json().error]).toEqual([400, 'VALIDATION_ERROR']);
    expect(live.json().message).toContain(qSnap);
    const op = randomUUID();
    const body = { targetState: 'S1', answers: { [qSnap]: 'YES' }, clientOpId: op, tapeVersion: await tape(f) };
    const ok = await post(`/api/filters/${f}/advance-with-checklist`, body);
    expect(ok.statusCode).toBe(200);
    const cl = (await events(f, 'CHECKLIST_COMPLETED'))[0].attributes as any;
    expect(cl.afterStage).toBe('S1');
    expect(cl.checklists[0]).toMatchObject({ checklistProfileId: CL1, profileVersion: 1, checklistProfileName: 'CL1 v1' });
    expect(cl.checklists[0].questionsSnapshot.map((q: any) => q.question)).toEqual(['Pinned question']);
    // A retry of the composed op is a no-op.
    expect((await post(`/api/filters/${f}/advance-with-checklist`, body)).statusCode).toBe(200);
    expect(await events(f, 'CHECKLIST_COMPLETED')).toHaveLength(1);
  });

  it('the composed op refuses a stage with no checklist after it (NO_CHECKLIST_AT_TARGET) and writes nothing', async () => {
    const f = await fx.filter('NOCL', null, FP_CL);
    await start(f);
    expect((await post(`/api/filters/${f}/advance-with-checklist`, { targetState: 'S1', answers: { [qSnap]: 'YES' }, tapeVersion: await tape(f) })).statusCode).toBe(200);
    const res = await post(`/api/filters/${f}/advance-with-checklist`, { targetState: 'S2', answers: {}, tapeVersion: await tape(f) });
    expect([res.statusCode, res.json().error]).toEqual([400, 'NO_CHECKLIST_AT_TARGET']);
    expect((await events(f, 'STATE_TRANSITION')).map((e) => e.toState)).toEqual(['S1']);
  });

  it('the composed op that completes the cycle, retried, is a no-op', async () => {
    const f = await fx.filter('CLEND', null, FP_CLEND);
    await start(f);
    const body = { targetState: 'T1', answers: { [q2]: 'YES' }, clientOpId: randomUUID(), tapeVersion: await tape(f) };
    expect((await post(`/api/filters/${f}/advance-with-checklist`, body)).statusCode).toBe(200);
    expect((await fd(f))!.currentLifecycleState).toBe('CLEANING_CYCLE_COMPLETED');
    expect((await post(`/api/filters/${f}/advance-with-checklist`, body)).statusCode).toBe(200);
    expect(await events(f, 'CYCLE_COMPLETED')).toHaveLength(1);
  });

  it('a submit-checklist that completed the cycle, retried, is a no-op (not NO_CYCLE)', async () => {
    const f = await fx.filter('CLSUB', null, FP_CLEND);
    await start(f);
    // Older offline queues entered the final stage with a bare advance; replay applies it.
    expect((await replay(`/api/filters/${f}/advance`, { targetState: 'T1', tapeVersion: await tape(f) })).statusCode).toBe(200);
    const body = { answers: { [q2]: 'YES' }, clientOpId: randomUUID(), tapeVersion: await tape(f) };
    expect((await post(`/api/filters/${f}/submit-checklist`, body)).statusCode).toBe(200);
    expect((await fd(f))!.currentCycleId).toBeNull();
    const retry = await post(`/api/filters/${f}/submit-checklist`, body);
    expect(retry.statusCode).toBe(200);
    expect(await events(f, 'CHECKLIST_COMPLETED')).toHaveLength(1);
  });
});

describe('retire / replace write sets', () => {
  it('retire ends the running cycle as RETIRED, keeps other custom attributes, and detaches the filter', async () => {
    const f = await fx.filter('RTW', AHU1, FP_MAIN);
    await prisma.assetInstance.update({ where: { id: f }, data: { customAttributes: { keep: 'me' } } });
    // CONTAINS + CONTAINED_IN must be written together (trg_asset_relationship_pair).
    await prisma.assetRelationship.createMany({ data: [
      { sourceAssetId: AHU1, targetAssetId: f, relationshipType: 'CONTAINS' },
      { sourceAssetId: f, targetAssetId: AHU1, relationshipType: 'CONTAINED_IN' },
    ] });
    const c = await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const res = await post(`/api/filters/${f}/retire`, { remarks: 'cracked frame' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'TERMINATED', terminationReason: 'RETIRED' });
    const term = (await events(f, 'CYCLE_TERMINATED'))[0];
    expect(term).toMatchObject({ fromState: 'WASH_IN', remarks: 'cracked frame' });
    expect(term.attributes).toMatchObject({ terminationReason: 'RETIRED', justification: 'cracked frame' });
    const inst = await prisma.assetInstance.findUnique({ where: { id: f } });
    expect(inst).toMatchObject({ status: 'Retired', isActive: false, parentId: null, customAttributes: { keep: 'me', _preRetireParentId: AHU1 } });
    expect(await fd(f)).toMatchObject({ currentLifecycleState: 'RETIRED', currentCycleId: null });
    expect(await prisma.assetRelationship.count({ where: { OR: [{ sourceAssetId: f }, { targetAssetId: f }] } })).toBe(0);
  });

  it('replace ends the running cycle as REPLACED, re-parents the new filter and moves the tag', async () => {
    const f = await fx.filter('RPW', AHU1, FP_MAIN, { filterSet: 'SET_B' });
    const tag = `TAG-${fx.tag}-${randomUUID().slice(0, 8)}`;
    await prisma.assetIdentifier.create({ data: { assetId: f, identifierType: 'RFID', identifierValue: tag } });
    const c = await start(f);
    const res = await post(`/api/filters/${f}/replace`, { remarks: 'scheduled swap' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    extraFilterIds.push(body.newFilterId);
    expect(body).toMatchObject({ success: true, oldFilterId: f, identifiersMoved: 1 });
    expect(await prisma.cleaningCycle.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'TERMINATED', terminationReason: 'REPLACED' });
    expect((await prisma.assetIdentifier.findUnique({ where: { identifierValue: tag } }))!.assetId).toBe(body.newFilterId);
    const rels = await prisma.assetRelationship.findMany({ where: { OR: [{ sourceAssetId: body.newFilterId }, { targetAssetId: body.newFilterId }] } });
    expect(rels.map((r) => r.relationshipType).sort()).toEqual(['CONTAINED_IN', 'CONTAINS']);
    expect(await prisma.assetInstance.findUnique({ where: { id: body.newFilterId } })).toMatchObject({ parentId: AHU1, isActive: true, name: body.newFilterName });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'FILTER_REPLACED', targetId: f } });
    expect(audit!.afterValue).toMatchObject({ newFilterId: body.newFilterId, identifiersMoved: 1, remarks: 'scheduled swap' });
  });

  it('replace refuses a name that an active filter already has (DUPLICATE_FILTER_NAME) and changes nothing', async () => {
    const f = await fx.filter('DUP', AHU1, FP_MAIN);
    const name = (await prisma.assetInstance.findUnique({ where: { id: f } }))!.name;
    const n = Number(name.match(/-(\d+)$/)![1]) + 1;
    const clash = await fx.filter('DUPX', AHU1, FP_MAIN);
    await prisma.assetInstance.update({ where: { id: clash }, data: { name: name.replace(/-\d+$/, '-' + String(n).padStart(2, '0')) } });
    const res = await post(`/api/filters/${f}/replace`, { remarks: 'swap' });
    expect([res.statusCode, res.json().error]).toEqual([409, 'DUPLICATE_FILTER_NAME']);
    expect((await prisma.assetInstance.findUnique({ where: { id: f } }))!.isActive).toBe(true);
  });

  it('a filter still under review can be neither retired nor replaced; an unknown one is 404', async () => {
    const f = await fx.filter('REV', AHU1, FP_MAIN, { approvalStatus: 'PENDING_REVIEW' });
    expect((await post(`/api/filters/${f}/retire`, { remarks: 'x' })).json().error).toBe('FILTER_NOT_APPROVED');
    expect((await post(`/api/filters/${f}/replace`, { remarks: 'x' })).json().error).toBe('FILTER_NOT_APPROVED');
    expect((await post(`/api/filters/${randomUUID()}/retire`, { remarks: 'x' })).statusCode).toBe(404);
  });
});

describe('Dry In readings through each equipment-group resolution path', () => {
  /** DRY pipeline cycle bound to a fresh group with one DRY_IN instrument, dryer started and past half-time. */
  async function dryingWithGroup(label: string, mutate?: (cycleId: string, groupId: string, inst: any) => Promise<void>) {
    const blk = await fx.node('BLOCK', `B${label}`);
    const ahu = await fx.node('AHU', `A${label}`, blk);
    const g = await fx.equipmentGroup(blk, `G${label}`, [{ stageKey: 'DRY_IN', min: 60, max: 80 }]);
    const f = await fx.filter(label, ahu, FP_DRY);
    const c = await start(f, { equipmentGroupId: g.id });
    if (mutate) await mutate(c.id, g.id, g.instruments[0]);
    expect((await advance(f, { targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2 })).statusCode).toBe(200);
    await prisma.cleaningCycle.update({ where: { id: c.id }, data: { dryerStartedAt: new Date(Date.now() - 5 * 60_000) } });
    return { f, inst: g.instruments[0] };
  }
  const submit = async (f: string, instId: string, value: number) => {
    const res = await advance(f, { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', instrumentReadings: { [instId]: value } });
    expect(res.statusCode).toBe(200);
    const ev = (await events(f, 'STATE_TRANSITION')).find((e) => (e.attributes as any).action === 'DRYER_READINGS_SUBMITTED')!;
    return (ev.attributes as any).instrumentReadings[0];
  };

  it('pinned to the live version: the temperature is checked against the DRY_IN instrument', async () => {
    const { f, inst } = await dryingWithGroup('DRL');
    expect(await submit(f, inst.id, 90)).toMatchObject({ instrumentId: inst.id, value: 90, outOfRange: true, operatingMin: 60, operatingMax: 80 });
  });

  it('pinned to a snapshot: the snapshot range is used', async () => {
    const { f, inst } = await dryingWithGroup('DRS', async (_c, groupId, i) => {
      await prisma.equipmentGroupVersion.create({ data: { groupId, versionNumber: 1, snapshot: { instruments: [{ ...i, operatingMin: 85, operatingMax: 95 }] } } });
    });
    // 90 is outside the live 60–80 range but inside the pinned 85–95: not flagged.
    const r = await submit(f, inst.id, 90);
    expect(r).toMatchObject({ value: 90 });
    expect(r.outOfRange).toBeUndefined();
  });

  it('a legacy cycle (no pin) uses the live group', async () => {
    const { f, inst } = await dryingWithGroup('DRG', async (cycleId) => {
      await prisma.cleaningCycle.update({ where: { id: cycleId }, data: { equipmentGroupVersionPin: null } });
    });
    const r = await submit(f, inst.id, 70);
    expect(r).toMatchObject({ value: 70 });
    expect(r.outOfRange).toBeUndefined();
  });

  it('current-state of a snapshot with no fields falls back to neutral values', async () => {
    const blk = await fx.node('BLOCK', 'BSNAP0');
    const ahu = await fx.node('AHU', 'ASNAP0', blk);
    const g = await fx.equipmentGroup(blk, 'GSNAP0', [{ stageKey: 'WASH_IN' }]);
    await prisma.equipmentGroupVersion.create({ data: { groupId: g.id, versionNumber: g.version, snapshot: {} } });
    const f = await fx.filter('SNAP0', ahu, FP_MAIN);
    await start(f, { equipmentGroupId: g.id });
    expect((await state(f)).equipmentGroup).toEqual({ id: g.id, name: null, blockId: null, isActive: true, version: g.version, instruments: [] });
  });
});

describe('advance from a non-cleaning state on a running cycle', () => {
  it('a manual move to INSTALLED keeps the cycle; the next advance starts again from the first stage', async () => {
    const f = await fx.filter('INST', AHU1, FP_MAIN);
    await start(f);
    expect((await advance(f, { targetState: 'WASH_IN' })).statusCode).toBe(200);
    const moved = await app.inject({
      method: 'PATCH', url: `/api/assets/instances/${f}/lifecycle-state`, headers: saH,
      payload: { lifecycleState: 'INSTALLED', remarks: 'reinstalled mid-clean', _currentPassword: fx.password },
    });
    expect(moved.statusCode).toBe(200);
    const res = await advance(f, { targetState: 'WASH_IN' });
    expect(res.statusCode).toBe(200);
    const last = (await events(f, 'STATE_TRANSITION')).filter((e) => !(e.attributes as any).manual).pop()!;
    expect(last).toMatchObject({ fromState: 'INSTALLED', toState: 'WASH_IN' });
  });
});

describe('a checklist node whose checklist no longer exists', () => {
  let FP_DANGLING = '';
  beforeAll(async () => {
    // Cannot be built through the API (delete refuses a referenced checklist; save
    // refuses a node without one) — this is the shape a direct DB edit leaves.
    ({ filterProfileId: FP_DANGLING } = await fx.pipeline({ name: 'DANG', stages: ['S1', 'S2'], checklistAfter: { 0: randomUUID() } }, sa.id));
  }, 60_000);

  it('the composed op refuses to record an attestation of nothing (NO_CHECKLIST_AT_TARGET)', async () => {
    const f = await fx.filter('DANG', null, FP_DANGLING);
    await start(f);
    const res = await post(`/api/filters/${f}/advance-with-checklist`, { targetState: 'S1', answers: {}, tapeVersion: await tape(f) });
    expect([res.statusCode, res.json().error]).toEqual([400, 'NO_CHECKLIST_AT_TARGET']);
    expect(await events(f, 'STATE_TRANSITION')).toHaveLength(0);
  });

  // Fixed 2026-10-22: the BARE submit used to answer 200 here and write a
  // CHECKLIST_COMPLETED event with checklists: [] (an attestation of nothing).
  // Both ops now share ONE rule in prepareChecklist (submit-checklist.ts).
  it('the bare submit-checklist refuses it too, and records nothing', async () => {
    const f = await fx.filter('DANG2', null, FP_DANGLING);
    await start(f);
    expect((await advance(f, { targetState: 'S1' })).statusCode).toBe(200);
    const res = await post(`/api/filters/${f}/submit-checklist`, { answers: {}, tapeVersion: await tape(f) });
    expect([res.statusCode, res.json().error]).toEqual([400, 'NO_CHECKLIST_AT_TARGET']);
    expect(await events(f, 'CHECKLIST_COMPLETED')).toHaveLength(0);
    expect(await prisma.auditTrail.count({ where: { action: 'CHECKLIST_COMPLETED', targetId: f } })).toBe(0);
  });
});
