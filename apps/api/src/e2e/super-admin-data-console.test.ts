/**
 * e2e — Filter Data Management generic console: /api/super-admin/data/*
 * (super-admin/routes.ts ~805-1545).
 *
 * For every table: list (pagination + the server-side filters the tab offers),
 * edit (all fields set, all fields blanked, enum / date / number refusals),
 * create (required-field refusals, server-side defaults, DB refusals mapped to
 * clean 4xx), delete (404, audit-before-delete in one transaction, DB refusal ->
 * DELETE_FAILED with no audit row). Every change is checked in the database AND
 * in its MANUAL_RECORD_* audit row (reason, before, after).
 *
 * Determinism: every fixture this file lists is back-dated into July 1971, so a
 * `from`/`to` on that window yields exact totals regardless of ambient rows.
 * Owns its SUPER_ADMIN, a non-SA user + role, a BLOCK -> AHU hierarchy with
 * three filters, a cleaning profile and a PM schedule; all removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { dateRangeGuard } from '../lib/date-range-guard.js';
import { computeChecksum } from '../modules/filter-operations/helpers.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, cleanupAll,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy, createCleaningProfile,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const PREFIX = `ZZSADC-${SUF}`;
const SA = `cv_sadc_sa_${SUF}`.toLowerCase();
const SA_PW = 'CovSadc@2026x';
const LOW = `cv_sadc_low_${SUF}`.toLowerCase();
const LOW_PW = 'CovSadcLow@2026x';
const LOW_ROLE = `CVSADC_${SUF}`;
const REASON = 'coverage: data console';
const WINDOW = 'from=1971-07-01&to=1971-07-31';
const d = (day: number, h = 12) => new Date(Date.UTC(1971, 6, day, h, 0, 0));

let app: FastifyInstance;
let saToken = '', lowToken = '';
let saId = '', lowId = '';
let h: Awaited<ReturnType<typeof createHierarchy>>;
let f1 = '', f2 = '', f3 = '';
let profileId = '';
let scheduleId = '';
const qnnIds: string[] = [];
const deviationIds: string[] = [];
const notificationIds: string[] = [];
const adminRequestIds: string[] = [];
const bcrIds: string[] = [];
const pmExecutionIds: string[] = [];

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, token?: string) =>
  app.inject({
    method, url,
    headers: { authorization: `Bearer ${token ?? saToken}`, 'x-reauth-password': token === lowToken ? LOW_PW : SA_PW },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
const base = '/api/super-admin/data';
const audit = (targetId: string, action: string) =>
  prisma.auditTrail.findFirst({ where: { targetId, action }, orderBy: { chainPosition: 'desc' } });
const auditCount = (targetId: string, action: string) => prisma.auditTrail.count({ where: { targetId, action } });
const mkCycle = (filterId: string, code: string, status: 'IN_PROGRESS' | 'COMPLETED' | 'TERMINATED', startedAt = d(15)) =>
  prisma.cleaningCycle.create({
    data: {
      cycleCode: `${PREFIX}-${code}`, filterId, profileId, profileVersion: 3, sequenceNumber: 1, status, startedAt,
      cleaningReasonKey: 'routine', cleaningReasonLabel: 'Routine',
    },
  });
const mkEvent = (filterId: string, eventType: any, performedAt: Date, cycleId: string | null = null, attributes: object = {}) =>
  prisma.filterEvent.create({
    data: { filterId, cycleId, eventType, performedBy: saId, performedAt, checksum: 'c'.repeat(64), ipAddress: '127.0.0.1', attributes },
  });

beforeAll(async () => {
  app = await buildApp([{
    prefix: '/api/super-admin',
    plugin: async (a) => { a.addHook('preHandler', dateRangeGuard); await a.register(superAdminRoutes); },
  }]);
  saId = await createUser(SA, 'SUPER_ADMIN', SA_PW, 'Console Super Admin');
  await createRole(LOW_ROLE, ['AUDIT_READ']);
  lowId = await createUser(LOW, LOW_ROLE, LOW_PW, 'Console Low User');
  saToken = await login(app, SA, SA_PW);
  lowToken = await login(app, LOW, LOW_PW);
  h = await createHierarchy(PREFIX);
  f1 = await createFilter(h.ahuId, `${PREFIX}-F1`);
  f2 = await createFilter(h.ahuId, `${PREFIX}-F2`);
  f3 = await createFilter(h.ahuId, `${PREFIX}-F3`);
  profileId = await createCleaningProfile(`${PREFIX} profile`, saId);
  scheduleId = (await prisma.pmSchedule.create({ data: { entityId: h.ahuId, year: 1971, createdBy: saId, status: 'ACTIVE' } })).id;
}, 120_000);

afterAll(async () => {
  try {
    await cleanupAll([
      ['pm executions', () => prisma.pmExecution.deleteMany({ where: { id: { in: pmExecutionIds } } })],
      scheduleId ? ['pm entries', () => prisma.pmScheduleEntry.deleteMany({ where: { scheduleId } })] : null,
      scheduleId ? ['pm schedule', () => prisma.pmSchedule.deleteMany({ where: { id: scheduleId } })] : null,
      ['quality notifications', () => prisma.qualityNotification.deleteMany({ where: { id: { in: qnnIds } } })],
      ['deviations', () => prisma.deviation.deleteMany({ where: { id: { in: deviationIds } } })],
      ['notifications', () => prisma.notification.deleteMany({ where: { OR: [{ id: { in: notificationIds } }, { title: { contains: PREFIX } }] } })],
      ['admin requests', () => prisma.adminRequest.deleteMany({ where: { OR: [{ id: { in: adminRequestIds } }, { requesterName: { contains: PREFIX } }] } })],
      ['block change requests', () => prisma.blockChangeRequest.deleteMany({ where: { OR: [{ id: { in: bcrIds } }, { filterName: { contains: PREFIX } }] } })],
      ['filters', () => deleteFilters([f1, f2, f3])],
      profileId ? ['cycles', () => prisma.cleaningCycle.deleteMany({ where: { profileId } })] : null,
      profileId ? ['profile', () => prisma.filterCleaningProfile.deleteMany({ where: { id: profileId } })] : null,
      ['hierarchy', () => deleteHierarchy(h)],
      ['users', () => deleteUsers([saId, lowId])],
      ['roles', () => deleteRoles([LOW_ROLE])],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('access + shared list behaviour', () => {
  it('every /data endpoint is SUPER_ADMIN-only', async () => {
    for (const path of ['cleaning-cycles', 'filter-events', 'audit-trail', 'notifications', 'admin-requests', 'block-change-requests', 'pm-schedules', 'pm-entries']) {
      expect((await call('GET', `${base}/${path}`, undefined, lowToken)).statusCode).toBe(403);
    }
    expect((await call('PUT', `${base}/notifications/${randomUUID()}`, { _changeReason: REASON }, lowToken)).statusCode).toBe(403);
    expect((await call('DELETE', `${base}/notifications/${randomUUID()}`, { _changeReason: REASON }, lowToken)).statusCode).toBe(403);
  });

  it('an inverted date range is refused (INVALID_DATE_RANGE); an unparseable side drops the range instead of failing', async () => {
    const inverted = await call('GET', `${base}/cleaning-cycles?from=1971-07-31&to=1971-07-01`);
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().error).toBe('INVALID_DATE_RANGE');
    // listWhere drops the whole date clause when either side is unparseable, so a
    // far-future sentinel (newest startedAt) comes back first despite to=1971.
    const sentinel = await mkCycle(f3, 'SENTINEL-G', 'COMPLETED', new Date('2199-01-01T00:00:00Z'));
    try {
      const garbage = await call('GET', `${base}/cleaning-cycles?from=garbage&to=1971-07-01&limit=1`);
      expect(garbage.statusCode).toBe(200);
      expect(garbage.json().data[0].id).toBe(sentinel.id);
    } finally {
      await prisma.cleaningCycle.delete({ where: { id: sentinel.id } });
    }
  });
  it('every console mutation refuses a reason that is only whitespace, before touching anything', async () => {
    const id = randomUUID();
    const routes: Array<['PUT' | 'POST' | 'DELETE', string]> = [
      ['PUT', `cleaning-cycles/${id}`], ['POST', 'cleaning-cycles'], ['DELETE', `cleaning-cycles/${id}`],
      ['PUT', `filter-events/${id}`], ['POST', 'filter-events'], ['DELETE', `filter-events/${id}`],
      ['PUT', `notifications/${id}`], ['POST', 'notifications'], ['DELETE', `notifications/${id}`],
      ['PUT', `deviations/${id}`], ['PUT', `quality-notifications/${id}`],
      ['PUT', `admin-requests/${id}`], ['POST', 'admin-requests'], ['DELETE', `admin-requests/${id}`],
      ['PUT', `block-change-requests/${id}`], ['POST', 'block-change-requests'], ['DELETE', `block-change-requests/${id}`],
      ['PUT', `pm-entries/${id}`], ['POST', 'pm-entries'], ['DELETE', `pm-entries/${id}`],
    ];
    for (const [method, path] of routes) {
      const res = await call(method, `${base}/${path}`, { _changeReason: '      ' });
      expect({ path, status: res.statusCode, error: res.json().error }).toEqual({ path, status: 400, error: 'REASON_REQUIRED' });
    }
    // A missing reason never reaches the handler: the body schema requires it.
    expect((await call('PUT', `${base}/notifications/${id}`, {})).statusCode).toBe(400);
    // Too long is refused by the schema's maxLength too.
    expect((await call('PUT', `${base}/notifications/${id}`, { _changeReason: 'x'.repeat(501) })).statusCode).toBe(400);
  });

  it('list query edge cases: blank bounds, one-sided ranges, a full ISO end, blank status, default page size', async () => {
    const a = await mkCycle(f3, 'EDGE-A', 'COMPLETED', d(28, 23));
    const sentinel = await mkCycle(f3, 'SENTINEL-E', 'TERMINATED', new Date('2199-01-02T00:00:00Z'));
    const blank = (await call('GET', `${base}/cleaning-cycles?from=&to=&status=`)).json();
    expect(blank).toMatchObject({ page: 1, limit: 25 }); // default page size
    expect(blank.data[0].id).toBe(sentinel.id); // no date and no status clause applied
    await prisma.cleaningCycle.delete({ where: { id: sentinel.id } });
    const fromOnly = (await call('GET', `${base}/cleaning-cycles?from=1971-07-28&limit=500`)).json();
    expect(fromOnly.data.some((r: any) => r.id === a.id)).toBe(true);
    const toOnly = (await call('GET', `${base}/cleaning-cycles?to=1971-07-28T22:00:00.000Z&limit=500`)).json();
    expect(toOnly.data.some((r: any) => r.id === a.id)).toBe(false); // 23:00 is after a full-ISO end of 22:00
    const isoEnd = (await call('GET', `${base}/cleaning-cycles?from=1971-07-01&to=1971-07-28T23:30:00.000Z`)).json();
    expect(isoEnd.data.map((r: any) => r.id)).toContain(a.id);
    await prisma.cleaningCycle.delete({ where: { id: a.id } });
  });

  it('GET /data/audit-trail pages the trail newest first (chain position serialised, not a 500)', async () => {
    const res = await call('GET', `${base}/audit-trail?page=2&limit=3`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 2, limit: 3 });
    expect(body.data).toHaveLength(3);
    expect(body.totalPages).toBe(Math.ceil(body.total / 3));
    const ts = body.data.map((r: any) => new Date(r.timestamp).getTime());
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    // The BIGSERIAL chain position comes back as a string of digits that
    // matches the stored value exactly (no float rounding).
    const first = body.data[0];
    expect(first.chainPosition).toMatch(/^\d+$/);
    const stored = await prisma.auditTrail.findUnique({ where: { id: first.id }, select: { chainPosition: true } });
    expect(first.chainPosition).toBe(stored!.chainPosition!.toString());
  });
});

describe('cleaning cycles', () => {
  it('lists by window, status and page', async () => {
    const a = await mkCycle(f1, 'L1', 'COMPLETED', d(10));
    const b = await mkCycle(f1, 'L2', 'TERMINATED', d(11));
    const c = await mkCycle(f2, 'L3', 'COMPLETED', d(12));
    const all = (await call('GET', `${base}/cleaning-cycles?${WINDOW}&limit=50`)).json();
    expect(all.total).toBe(3);
    expect(all.data.map((r: any) => r.id)).toEqual([c.id, b.id, a.id]); // startedAt desc
    const done = (await call('GET', `${base}/cleaning-cycles?${WINDOW}&status=COMPLETED`)).json();
    expect(done.data.map((r: any) => r.id).sort()).toEqual([a.id, c.id].sort());
    const allStatus = (await call('GET', `${base}/cleaning-cycles?${WINDOW}&status=ALL`)).json();
    expect(allStatus.total).toBe(3);
    const page2 = (await call('GET', `${base}/cleaning-cycles?${WINDOW}&page=2&limit=2`)).json();
    expect(page2).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
    expect(page2.data.map((r: any) => r.id)).toEqual([a.id]);
    await prisma.cleaningCycle.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
  });

  it('PUT sets every field, then blanks every nullable one; audited with before/after', async () => {
    const cyc = await mkCycle(f1, 'PUT', 'COMPLETED', d(5));
    const full = {
      _changeReason: REASON, status: 'TERMINATED', cycleCode: `${PREFIX}-PUT-2`, cleaningReasonKey: 'breakdown',
      cleaningReasonLabel: 'Breakdown', cleaningJustification: 'motor', terminationReason: 'operator stop',
      startedAt: '1971-07-05T01:00:00.000Z', completedAt: '1971-07-05T02:00:00.000Z', terminatedAt: '1971-07-05T03:00:00.000Z',
      dryerStartedAt: '1971-07-05T01:30:00.000Z', sequenceNumber: '7', profileVersion: 2, dryerDurationMinutes: 45,
      filterId: f1, profileId, cleaningAreaId: h.blockId, equipmentGroupId: null,
    };
    const res = await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, full);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'TERMINATED', cycleCode: `${PREFIX}-PUT-2`, sequenceNumber: 7, dryerDurationMinutes: 45, cleaningAreaId: h.blockId });
    const row = await audit(cyc.id, 'MANUAL_RECORD_UPDATED');
    expect(row).toMatchObject({ targetType: 'cleaning_cycle', reason: REASON, userName: SA });
    expect(row?.beforeValue).toMatchObject({ status: 'COMPLETED', cycleCode: `${PREFIX}-PUT` });
    expect(row?.afterValue).toMatchObject({ status: 'TERMINATED', terminationReason: 'operator stop' });

    const blank = await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, {
      _changeReason: REASON, completedAt: null, terminatedAt: '', dryerStartedAt: null, dryerDurationMinutes: null,
      cleaningAreaId: '', equipmentGroupId: null,
    });
    expect(blank.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: cyc.id } })).toMatchObject({
      completedAt: null, terminatedAt: null, dryerStartedAt: null, dryerDurationMinutes: null, cleaningAreaId: null, equipmentGroupId: null,
      status: 'TERMINATED', sequenceNumber: 7,
    });
  });

  it('PUT refuses a bad enum, date or number with a clean 400 and changes nothing', async () => {
    const cyc = await mkCycle(f1, 'PUTBAD', 'COMPLETED', d(6));
    const r1 = await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, { _changeReason: REASON, status: 'BOGUS' });
    expect(r1.statusCode).toBe(400);
    expect(r1.json()).toMatchObject({ error: 'INVALID_VALUE', message: expect.stringContaining('status must be one of: IN_PROGRESS') });
    const r2 = await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, { _changeReason: REASON, completedAt: 'not-a-date' });
    expect(r2.json()).toMatchObject({ error: 'INVALID_VALUE', message: 'completedAt must be a valid date-time' });
    const r3 = await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, { _changeReason: REASON, dryerDurationMinutes: 'abc' });
    expect(r3.json()).toMatchObject({ error: 'INVALID_VALUE', message: 'dryerDurationMinutes must be a number' });
    expect((await call('PUT', `${base}/cleaning-cycles/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
    expect(await auditCount(cyc.id, 'MANUAL_RECORD_UPDATED')).toBe(0);
  });

  it('M27: moving an IN_PROGRESS cycle out of progress clears the filter\'s current-cycle pointer and records it', async () => {
    const cyc = await mkCycle(f2, 'M27', 'IN_PROGRESS', d(7));
    await prisma.filterDetails.upsert({
      where: { assetInstanceId: f2 }, update: { currentCycleId: cyc.id, currentLifecycleState: 'WASH_IN' },
      create: { assetInstanceId: f2, currentCycleId: cyc.id, currentLifecycleState: 'WASH_IN' },
    });
    // An edit that keeps it IN_PROGRESS leaves the pointer alone.
    expect((await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, { _changeReason: REASON, cleaningJustification: 'still going' })).statusCode).toBe(200);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: f2 } }))?.currentCycleId).toBe(cyc.id);

    const res = await call('PUT', `${base}/cleaning-cycles/${cyc.id}`, { _changeReason: REASON, status: 'COMPLETED' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: f2 } })).toMatchObject({ currentCycleId: null, currentLifecycleState: null });
    const row = await audit(cyc.id, 'MANUAL_RECORD_UPDATED');
    expect((row?.afterValue as any)._sideEffects).toEqual({ clearedFilterCurrentCycle: { assetInstanceId: f2, currentLifecycleState: 'WASH_IN' } });

    // No filter pointing at it: nothing to clear, no side effect recorded.
    const lone = await mkCycle(f3, 'M27B', 'IN_PROGRESS', d(8));
    expect((await call('PUT', `${base}/cleaning-cycles/${lone.id}`, { _changeReason: REASON, status: 'TERMINATED' })).statusCode).toBe(200);
    expect(((await audit(lone.id, 'MANUAL_RECORD_UPDATED'))?.afterValue as any)._sideEffects).toBeUndefined();
  });

  it('POST requires filter, profile and reason; fills the derived NOT-NULL columns', async () => {
    const miss = async (p: object) => (await call('POST', `${base}/cleaning-cycles`, { _changeReason: REASON, ...p })).json();
    expect(await miss({ profileId, cleaningReasonLabel: 'x' })).toMatchObject({ error: 'MISSING_FIELD', message: 'A filter must be selected.' });
    expect(await miss({ filterId: f1, cleaningReasonLabel: 'x' })).toMatchObject({ message: 'A cleaning profile must be selected.' });
    expect(await miss({ filterId: f1, profileId, cleaningReasonLabel: '' })).toMatchObject({ message: 'Cleaning reason is required.' });

    const before = await prisma.cleaningCycle.count({ where: { filterId: f1 } });
    const res = await call('POST', `${base}/cleaning-cycles`, { _changeReason: REASON, filterId: f1, profileId, cleaningReasonLabel: 'Manual Wash!', status: 'COMPLETED' });
    expect(res.statusCode).toBe(200);
    const c = res.json();
    expect(c).toMatchObject({ cleaningReasonKey: 'manual_wash', profileVersion: 3, sequenceNumber: before + 1, manualEntry: true, status: 'COMPLETED' });
    expect(c.cycleCode).toMatch(new RegExp(`^MANUAL-${before + 1}-`));
    const row = await audit(c.id, 'MANUAL_RECORD_CREATED');
    expect(row).toMatchObject({ targetType: 'cleaning_cycle', reason: REASON });
    expect(row?.afterValue).toMatchObject({ id: c.id, manualEntry: true });

    // A label with no usable characters falls back to 'manual'; supplied values are kept.
    const r2 = await call('POST', `${base}/cleaning-cycles`, {
      _changeReason: REASON, filterId: f1, profileId, cleaningReasonLabel: '!!!', status: 'TERMINATED',
      profileVersion: '1', sequenceNumber: 42, cycleCode: `${PREFIX}-EXPLICIT`, startedAt: '1971-07-20T00:00:00.000Z', cleaningReasonKey: '',
    });
    expect(r2.json()).toMatchObject({ cleaningReasonKey: 'manual', profileVersion: 1, sequenceNumber: 42, cycleCode: `${PREFIX}-EXPLICIT` });
    expect(new Date(r2.json().startedAt).toISOString()).toBe('1971-07-20T00:00:00.000Z');
  });

  it('POST maps DB refusals: a second IN_PROGRESS cycle is 409 CONFLICT, a dangling profile is 400 CREATE_FAILED, both unaudited', async () => {
    await mkCycle(f3, 'BUSY', 'IN_PROGRESS', d(9));
    const dup = await call('POST', `${base}/cleaning-cycles`, { _changeReason: REASON, filterId: f3, profileId, cleaningReasonLabel: 'Again' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('CONFLICT');

    const ghostProfile = randomUUID();
    const fk = await call('POST', `${base}/cleaning-cycles`, { _changeReason: REASON, filterId: f1, profileId: ghostProfile, cleaningReasonLabel: 'Ghost', status: 'COMPLETED' });
    expect(fk.statusCode).toBe(400);
    expect(fk.json()).toMatchObject({ error: 'CREATE_FAILED', message: 'Could not create cleaning cycle.' });
    expect(await prisma.cleaningCycle.count({ where: { profileId: ghostProfile } })).toBe(0);

    const badEnum = await call('POST', `${base}/cleaning-cycles`, { _changeReason: REASON, filterId: f1, profileId, cleaningReasonLabel: 'x', status: 'NOPE' });
    expect(badEnum.json().error).toBe('INVALID_VALUE');
  });

  it('DELETE cascades events + clears pointers, recording the blast radius before the cycle dies', async () => {
    expect((await call('DELETE', `${base}/cleaning-cycles/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
    const filterId = f1;
    const cyc = await mkCycle(filterId, 'DEL', 'COMPLETED', d(3));
    const e1 = await mkEvent(filterId, 'CYCLE_STARTED', d(3, 1), cyc.id);
    const e2 = await mkEvent(filterId, 'CYCLE_COMPLETED', d(3, 2), cyc.id);
    await prisma.filterDetails.upsert({
      where: { assetInstanceId: filterId }, update: { currentCycleId: cyc.id, currentLifecycleState: 'DRY_OUT' },
      create: { assetInstanceId: filterId, currentCycleId: cyc.id, currentLifecycleState: 'DRY_OUT' },
    });
    const res = await call('DELETE', `${base}/cleaning-cycles/${cyc.id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.count({ where: { id: cyc.id } })).toBe(0);
    expect(await prisma.filterEvent.count({ where: { id: { in: [e1.id, e2.id] } } })).toBe(0);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterId } })).toMatchObject({ currentCycleId: null, currentLifecycleState: null });
    const row = await audit(cyc.id, 'MANUAL_RECORD_DELETED');
    expect(row?.beforeValue).toMatchObject({ id: cyc.id, cycleCode: `${PREFIX}-DEL` });
    const se = (row?.afterValue as any)._sideEffects;
    expect(se.deletedFilterEventCount).toBe(2);
    expect(se.deletedFilterEvents.map((e: any) => e.id).sort()).toEqual([e1.id, e2.id].sort());
    expect(se.clearedFilterDetails).toEqual([{ assetInstanceId: filterId, currentLifecycleState: 'DRY_OUT' }]);
  });
});

describe('filter events', () => {
  it('lists by window and event type', async () => {
    const a = await mkEvent(f2, 'REMARK_ADDED', d(20));
    const b = await mkEvent(f2, 'REMARK_ADDED', d(21));
    const c = await mkEvent(f2, 'PARAMETER_CAPTURE', d(22));
    const all = (await call('GET', `${base}/filter-events?${WINDOW}`)).json();
    expect(all.total).toBe(3);
    expect(all.data.map((r: any) => r.id)).toEqual([c.id, b.id, a.id]);
    const remarks = (await call('GET', `${base}/filter-events?${WINDOW}&eventType=REMARK_ADDED`)).json();
    expect(remarks.data.map((r: any) => r.id)).toEqual([b.id, a.id]);
    await prisma.filterEvent.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
  });

  it('PUT edits every editable field, MERGES attributes, never takes a client checksum', async () => {
    const cyc = await mkCycle(f2, 'EVPUT', 'COMPLETED', d(2));
    const ev = await mkEvent(f2, 'REMARK_ADDED', d(2, 3), cyc.id, { action: 'keep-me', dryerDurationMinutes: 30 });
    const res = await call('PUT', `${base}/filter-events/${ev.id}`, {
      _changeReason: REASON, eventType: 'PARAMETER_CAPTURE', fromState: 'WASH_IN', toState: 'WASH_OUT', remarks: 'fixed',
      filterId: f2, cycleId: '', performedBy: lowId, cleaningAreaId: h.blockId, equipmentId: null, blockId: h.blockId,
      performedAt: '1971-07-02T05:00:00.000Z', attributes: { instrumentReadings: [{ value: 7 }] }, checksum: 'evil',
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.filterEvent.findUnique({ where: { id: ev.id } });
    expect(after).toMatchObject({
      eventType: 'PARAMETER_CAPTURE', fromState: 'WASH_IN', toState: 'WASH_OUT', remarks: 'fixed', cycleId: null,
      performedBy: lowId, cleaningAreaId: h.blockId, equipmentId: null, blockId: h.blockId, checksum: 'c'.repeat(64),
    });
    expect(after?.attributes).toEqual({ action: 'keep-me', dryerDurationMinutes: 30, instrumentReadings: [{ value: 7 }] });
    const row = await audit(ev.id, 'MANUAL_RECORD_UPDATED');
    expect(row).toMatchObject({ targetType: 'filter_event', reason: REASON });
    expect(row?.beforeValue).toMatchObject({ eventType: 'REMARK_ADDED', cycleId: cyc.id });

    // attributes: null is ignored (no replace with null).
    expect((await call('PUT', `${base}/filter-events/${ev.id}`, { _changeReason: REASON, attributes: null })).statusCode).toBe(200);
    expect((await prisma.filterEvent.findUnique({ where: { id: ev.id } }))?.attributes).toMatchObject({ action: 'keep-me' });

    const bad = await call('PUT', `${base}/filter-events/${ev.id}`, { _changeReason: REASON, eventType: 'TELEPORTED' });
    expect(bad.json()).toMatchObject({ error: 'INVALID_VALUE', message: expect.stringContaining('eventType must be one of') });
    expect((await call('PUT', `${base}/filter-events/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
  });

  it('POST stamps performer, time, IP and a server-computed checksum; refuses missing / invalid / inconsistent input', async () => {
    const miss = async (p: object) => (await call('POST', `${base}/filter-events`, { _changeReason: REASON, ...p })).json();
    expect(await miss({ eventType: 'REMARK_ADDED' })).toMatchObject({ error: 'MISSING_FIELD', message: 'A filter must be selected.' });
    expect(await miss({ filterId: f1, eventType: '' })).toMatchObject({ message: 'Event type is required.' });
    expect(await miss({ filterId: f1, eventType: 'WARPED' })).toMatchObject({ error: 'INVALID_VALUE' });

    // The cycle belongs to another filter: trg_filter_event_consistency refuses inside the tx.
    const otherCycle = await mkCycle(f2, 'EVPOST-X', 'COMPLETED', d(1));
    const incons = await call('POST', `${base}/filter-events`, { _changeReason: REASON, filterId: f1, cycleId: otherCycle.id, eventType: 'REMARK_ADDED' });
    expect(incons.statusCode).toBe(400);
    expect(incons.json()).toMatchObject({ error: 'CREATE_FAILED', message: 'Could not create filter event.' });
    expect(await prisma.filterEvent.count({ where: { filterId: f1, cycleId: otherCycle.id } })).toBe(0);

    const res = await call('POST', `${base}/filter-events`, { _changeReason: REASON, filterId: f1, eventType: 'REMARK_ADDED', remarks: 'manual', attributes: { a: 1 }, checksum: 'evil' });
    expect(res.statusCode).toBe(200);
    const ev = res.json();
    expect(ev).toMatchObject({ performedBy: saId, manualEntry: true, remarks: 'manual', attributes: { a: 1 }, cycleId: null });
    expect(ev.checksum).toBe(computeChecksum({ filterId: f1, cycleId: null, eventType: 'REMARK_ADDED', performedBy: saId, performedAt: new Date(ev.performedAt).toISOString() }));
    expect(await auditCount(ev.id, 'MANUAL_RECORD_CREATED')).toBe(1);

    const own = await mkCycle(f1, 'EVPOST-OWN', 'COMPLETED', d(1));
    const r2 = await call('POST', `${base}/filter-events`, { _changeReason: REASON, filterId: f1, cycleId: own.id, eventType: 'CYCLE_STARTED', performedBy: lowId, performedAt: '1971-07-01T09:00:00.000Z' });
    expect(r2.json()).toMatchObject({ performedBy: lowId, cycleId: own.id });
    expect(new Date(r2.json().performedAt).toISOString()).toBe('1971-07-01T09:00:00.000Z');
  });

  it('DELETE is audited first; concurrent deletes of one row produce exactly one success and one audit row', async () => {
    expect((await call('DELETE', `${base}/filter-events/${randomUUID()}`, { _changeReason: REASON })).json()).toMatchObject({ error: 'NOT_FOUND', message: 'Filter event not found.' });
    const ev = await mkEvent(f1, 'REMARK_ADDED', d(25));
    const results = await Promise.all(Array.from({ length: 8 }, () => call('DELETE', `${base}/filter-events/${ev.id}`, { _changeReason: REASON })));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 404)).toHaveLength(7);
    expect(await prisma.filterEvent.count({ where: { id: ev.id } })).toBe(0);
    expect(await auditCount(ev.id, 'MANUAL_RECORD_DELETED')).toBe(1);
    expect((await audit(ev.id, 'MANUAL_RECORD_DELETED'))?.beforeValue).toMatchObject({ id: ev.id, eventType: 'REMARK_ADDED' });
  });
});

describe('notifications', () => {
  const mkNote = async (type: any, day: number, tag: string) => {
    const n = await prisma.notification.create({ data: { type, title: `${PREFIX} ${tag}`, message: 'm', createdAt: d(day) } });
    notificationIds.push(n.id);
    return n;
  };

  it('lists by window and type (ALL means no type filter)', async () => {
    const a = await mkNote('USER_CREATED', 10, 'a');
    const b = await mkNote('SYSTEM_ERROR', 11, 'b');
    expect((await call('GET', `${base}/notifications?${WINDOW}`)).json().data.map((r: any) => r.id)).toEqual([b.id, a.id]);
    expect((await call('GET', `${base}/notifications?${WINDOW}&type=USER_CREATED`)).json().data.map((r: any) => r.id)).toEqual([a.id]);
    expect((await call('GET', `${base}/notifications?${WINDOW}&type=all`)).json().total).toBe(2);
    await prisma.notification.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  it('PUT edits fields, read state and back-dates; refuses a bad type or date', async () => {
    const n = await mkNote('USER_CREATED', 12, 'put');
    const res = await call('PUT', `${base}/notifications/${n.id}`, {
      _changeReason: REASON, type: 'USER_UPDATED', title: `${PREFIX} put2`, message: 'm2', forUserId: LOW, forRole: LOW_ROLE,
      targetUserId: SA, createdBy: SA, isRead: 'true', readAt: '1971-07-13T00:00:00.000Z', createdAt: '1971-07-12T06:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.notification.findUnique({ where: { id: n.id } })).toMatchObject({
      type: 'USER_UPDATED', title: `${PREFIX} put2`, isRead: true, forUserId: LOW, forRole: LOW_ROLE, targetUserId: SA,
    });
    const row = await audit(n.id, 'MANUAL_RECORD_UPDATED');
    expect(row?.beforeValue).toMatchObject({ type: 'USER_CREATED', isRead: false });
    expect(row?.afterValue).toMatchObject({ type: 'USER_UPDATED', isRead: true });

    expect((await call('PUT', `${base}/notifications/${n.id}`, { _changeReason: REASON, isRead: false, readAt: '', createdAt: '' })).statusCode).toBe(200);
    expect(await prisma.notification.findUnique({ where: { id: n.id } })).toMatchObject({ isRead: false, readAt: null });

    expect((await call('PUT', `${base}/notifications/${n.id}`, { _changeReason: REASON, createdAt: 'x' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'createdAt must be a valid date-time' });
    expect((await call('PUT', `${base}/notifications/${n.id}`, { _changeReason: REASON, type: 'NOT_A_TYPE' })).json().error).toBe('INVALID_VALUE');
    expect((await call('PUT', `${base}/notifications/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
  });

  it('POST requires type/title/message, defaults the creator, maps an over-long title to CREATE_FAILED', async () => {
    const miss = async (p: object) => (await call('POST', `${base}/notifications`, { _changeReason: REASON, ...p })).json();
    expect(await miss({ title: 't', message: 'm' })).toMatchObject({ message: 'Type is required.' });
    expect(await miss({ type: 'USER_CREATED', message: 'm' })).toMatchObject({ message: 'Title is required.' });
    expect(await miss({ type: 'USER_CREATED', title: 't', message: '' })).toMatchObject({ message: 'Message is required.' });
    expect(await miss({ type: 'MADE_UP', title: 't', message: 'm' })).toMatchObject({ error: 'INVALID_VALUE' });

    const res = await call('POST', `${base}/notifications`, {
      _changeReason: REASON, type: 'SYSTEM_ERROR', title: `${PREFIX} created`, message: 'hello', isRead: true,
      readAt: '1971-07-14T00:00:00.000Z', createdAt: '1971-07-14T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const n = res.json();
    notificationIds.push(n.id);
    expect(n).toMatchObject({ createdBy: saId, manualEntry: true, isRead: true });
    expect(await auditCount(n.id, 'MANUAL_RECORD_CREATED')).toBe(1);

    const asText = await call('POST', `${base}/notifications`, { _changeReason: REASON, type: 'USER_LOGIN', title: `${PREFIX} text-bool`, message: 'm', isRead: 'true' });
    notificationIds.push(asText.json().id);
    expect(asText.json().isRead).toBe(true);

    const tooLong = await call('POST', `${base}/notifications`, { _changeReason: REASON, type: 'SYSTEM_ERROR', title: `${PREFIX} ${'x'.repeat(250)}`, message: 'm', createdBy: SA });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ error: 'CREATE_FAILED', message: 'Could not create notification.' });
  });

  it('DELETE removes it and records what it was', async () => {
    const n = await mkNote('USER_LOGIN', 15, 'del');
    const res = await call('DELETE', `${base}/notifications/${n.id}`, { _changeReason: REASON });
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.notification.count({ where: { id: n.id } })).toBe(0);
    expect((await audit(n.id, 'MANUAL_RECORD_DELETED'))?.beforeValue).toMatchObject({ id: n.id, type: 'USER_LOGIN' });
  });
});

describe('deviations + quality notifications (page edits)', () => {
  const mkDeviation = async () => {
    const dv = await prisma.deviation.create({
      data: {
        pmScheduleEntryId: randomUUID(), ahuId: h.ahuId, ahuName: `${PREFIX}-AHU`, scheduledDate: d(4), windowStart: d(2), windowEnd: d(6),
        overdueDaysAtOpen: 3,
      },
    });
    deviationIds.push(dv.id);
    return dv;
  };

  it('PUT resolves user ids to names, coerces numbers, and audits under the deviation number', async () => {
    const dv = await mkDeviation();
    const res = await call('PUT', `${base}/deviations/${dv.id}`, {
      _changeReason: REASON, status: 'CLOSED', closureKind: 'COMPLETED_LATE', closureReason: 'done late', ahuName: 'Renamed AHU',
      scheduledDate: '1971-07-04', windowStart: '', windowEnd: '1971-07-07', acknowledgedAt: '1971-07-05T00:00:00.000Z',
      completedAt: '1971-07-06T00:00:00.000Z', closedAt: '1971-07-06T01:00:00.000Z',
      overdueDaysAtOpen: '4.9', delayDays: '2', passwordVerified: 'true', acknowledgedBy: lowId, completedBy: saId,
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.deviation.findUnique({ where: { id: dv.id } })).toMatchObject({
      status: 'CLOSED', closureKind: 'COMPLETED_LATE', ahuName: 'Renamed AHU', windowStart: null, overdueDaysAtOpen: 4, delayDays: 2,
      passwordVerified: true, acknowledgedBy: lowId, acknowledgedByName: 'Console Low User', completedBy: saId, completedByName: 'Console Super Admin',
    });
    const row = await audit(dv.id, 'MANUAL_RECORD_UPDATED');
    expect(row?.signatureMeaning).toBe(`Deviation ${dv.deviationNumber} manually edited via Filter Data Management`);

    // Clearing: blank users null both columns; '' delayDays nulls it; '' overdue is skipped.
    const clr = await call('PUT', `${base}/deviations/${dv.id}`, { _changeReason: REASON, acknowledgedBy: '', completedBy: null, delayDays: '', overdueDaysAtOpen: '', closureKind: null });
    expect(clr.statusCode).toBe(200);
    expect(await prisma.deviation.findUnique({ where: { id: dv.id } })).toMatchObject({
      acknowledgedBy: null, acknowledgedByName: null, completedBy: null, completedByName: null, delayDays: null, overdueDaysAtOpen: 4, closureKind: null,
    });
  });

  it('PUT refuses blank status, bad / blank required dates, non-numbers, unknown users and bad enums', async () => {
    const dv = await mkDeviation();
    const put = async (p: object) => call('PUT', `${base}/deviations/${dv.id}`, { _changeReason: REASON, ...p });
    expect((await put({ status: '' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'status is required' });
    expect((await put({ completedAt: 'nope' })).json()).toMatchObject({ message: 'completedAt must be a valid date-time' });
    expect((await put({ windowEnd: '' })).json()).toMatchObject({ message: 'scheduledDate and windowEnd cannot be blank' });
    expect((await put({ delayDays: 'abc' })).json()).toMatchObject({ message: 'delayDays must be a number' });
    const ghost = await put({ completedBy: randomUUID() });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json().message).toBe('User for completedBy not found');
    expect((await put({ status: 'HALF_OPEN' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: expect.stringContaining('status must be one of') });
    expect((await call('PUT', `${base}/deviations/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
    expect(await auditCount(dv.id, 'MANUAL_RECORD_UPDATED')).toBe(0);
  });

  it('quality notification PUT: qnn uniqueness, blank refusals, performer resolution', async () => {
    const q1 = await prisma.qualityNotification.create({ data: { qnn: `Q-${SUF}-1`, action: 'CREATED', ahuName: 'A' } });
    const q2 = await prisma.qualityNotification.create({ data: { qnn: `Q-${SUF}-2`, action: 'CREATED' } });
    qnnIds.push(q1.id, q2.id);
    const put = async (id: string, p: object) => call('PUT', `${base}/quality-notifications/${id}`, { _changeReason: REASON, ...p });

    expect((await put(q1.id, { qnn: '   ' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'qnn cannot be blank' });
    const dupe = await put(q1.id, { qnn: `Q-${SUF}-2` });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error).toBe('CONFLICT');
    expect((await put(q1.id, { action: '  ' })).json()).toMatchObject({ message: 'action cannot be blank' });
    expect((await put(q1.id, { createdAt: 'bad' })).json()).toMatchObject({ message: 'createdAt must be a valid date-time' });
    expect((await put(q1.id, { performedBy: randomUUID() })).statusCode).toBe(404);
    expect((await call('PUT', `${base}/quality-notifications/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);

    const ok = await put(q1.id, {
      qnn: ` Q-${SUF}-1B `, action: ' APPROVED ', ahuName: '', message: 'msg', createdAt: '1971-07-08T00:00:00.000Z', performedBy: lowId,
    });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.qualityNotification.findUnique({ where: { id: q1.id } })).toMatchObject({
      qnn: `Q-${SUF}-1B`, action: 'APPROVED', ahuName: null, message: 'msg', performedBy: lowId, performedByName: 'Console Low User',
    });
    const row = await audit(q1.id, 'MANUAL_RECORD_UPDATED');
    expect(row?.signatureMeaning).toBe(`Quality notification Q-${SUF}-1 manually edited via Filter Data Management`);
    expect((await put(q1.id, { performedBy: '' })).statusCode).toBe(200);
    expect(await prisma.qualityNotification.findUnique({ where: { id: q1.id } })).toMatchObject({ performedBy: null, performedByName: null });
  });
});

describe('admin requests', () => {
  it('list / edit / create / delete with audit', async () => {
    const ar = await prisma.adminRequest.create({ data: { requestType: 'UNLOCK', requesterName: `${PREFIX} req`, requestedAt: d(3) } });
    adminRequestIds.push(ar.id);
    const list = (await call('GET', `${base}/admin-requests?limit=500`)).json();
    expect(list.data.some((r: any) => r.id === ar.id)).toBe(true);

    const put = await call('PUT', `${base}/admin-requests/${ar.id}`, {
      _changeReason: REASON, requestType: 'MODIFY_USER', status: 'APPROVED', requesterName: `${PREFIX} req2`, requesterEmployeeId: 'E1',
      requesterEmail: 'a@b.c', remarks: 'r', adminRemarks: 'ar', processedBy: SA, requestedAt: '1971-07-03T00:00:00.000Z',
      processedAt: '1971-07-04T00:00:00.000Z', requestData: { k: 1 },
    });
    expect(put.statusCode).toBe(200);
    expect(await prisma.adminRequest.findUnique({ where: { id: ar.id } })).toMatchObject({ requestType: 'MODIFY_USER', status: 'APPROVED', requestData: { k: 1 } });
    expect((await audit(ar.id, 'MANUAL_RECORD_UPDATED'))?.beforeValue).toMatchObject({ requestType: 'UNLOCK', status: 'PENDING' });
    expect((await call('PUT', `${base}/admin-requests/${ar.id}`, { _changeReason: REASON, processedAt: '' })).statusCode).toBe(200);
    expect((await prisma.adminRequest.findUnique({ where: { id: ar.id } }))?.processedAt).toBeNull();
    expect((await call('PUT', `${base}/admin-requests/${ar.id}`, { _changeReason: REASON, requestedAt: 'bad' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'requestedAt must be a valid date-time' });
    expect((await call('PUT', `${base}/admin-requests/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);

    const miss = async (p: object) => (await call('POST', `${base}/admin-requests`, { _changeReason: REASON, ...p })).json();
    expect(await miss({ requesterName: 'x' })).toMatchObject({ message: 'Request type is required.' });
    expect(await miss({ requestType: 'UNLOCK' })).toMatchObject({ message: 'Requester name is required.' });
    expect(await miss({ requestType: 'UNLOCK', requesterName: `${PREFIX} bad`, processedAt: 'x' })).toMatchObject({ error: 'INVALID_VALUE' });
    const tooLong = await call('POST', `${base}/admin-requests`, { _changeReason: REASON, requestType: 'X'.repeat(40), requesterName: `${PREFIX} long` });
    expect(tooLong.json()).toMatchObject({ error: 'CREATE_FAILED', message: 'Could not create admin request.' });

    const created = await call('POST', `${base}/admin-requests`, {
      _changeReason: REASON, requestType: 'CREATE_USER', requesterName: `${PREFIX} new`, requestedAt: '1971-07-09T00:00:00.000Z',
      processedAt: '1971-07-10T00:00:00.000Z', requestData: { fullName: 'n' },
    });
    expect(created.statusCode).toBe(200);
    const c = created.json();
    adminRequestIds.push(c.id);
    expect(c).toMatchObject({ manualEntry: true, requestData: { fullName: 'n' } });
    expect(await auditCount(c.id, 'MANUAL_RECORD_CREATED')).toBe(1);

    expect((await call('DELETE', `${base}/admin-requests/${c.id}`, { _changeReason: REASON })).statusCode).toBe(200);
    expect(await prisma.adminRequest.count({ where: { id: c.id } })).toBe(0);
    expect(await auditCount(c.id, 'MANUAL_RECORD_DELETED')).toBe(1);
  });
});

describe('block change requests (console)', () => {
  it('edits the record\'s OWN reason column while the justification goes to the audit row', async () => {
    const r = await prisma.blockChangeRequest.create({
      data: {
        filterId: f1, filterName: `${PREFIX}-F1`, fromBlockId: h.blockId, fromBlockName: 'B1', toBlockId: randomUUID(), toBlockName: 'B2',
        reason: 'operator reason', requestedBy: lowId, requestedByName: LOW,
      },
    });
    bcrIds.push(r.id);
    expect((await call('GET', `${base}/block-change-requests?limit=500`)).json().data.some((x: any) => x.id === r.id)).toBe(true);

    const res = await call('PUT', `${base}/block-change-requests/${r.id}`, {
      _changeReason: REASON, reason: 'corrected operator reason', status: 'APPROVED', processedBy: saId, processedByName: SA,
      processedComment: 'ok', processedAt: '1971-07-02T00:00:00.000Z', fromBlockName: 'B1x', toBlockId: '', createdAt: null,
    });
    // toBlockId '' -> null hits a NOT NULL column: a clean 400, nothing written.
    expect(res.statusCode).toBe(400);
    expect((await prisma.blockChangeRequest.findUnique({ where: { id: r.id } }))?.status).toBe('PENDING');

    const ok = await call('PUT', `${base}/block-change-requests/${r.id}`, {
      _changeReason: REASON, reason: 'corrected operator reason', status: 'APPROVED', processedBy: saId, processedByName: SA,
      processedComment: 'ok', processedAt: '1971-07-02T00:00:00.000Z', fromBlockName: 'B1x',
    });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.blockChangeRequest.findUnique({ where: { id: r.id } })).toMatchObject({ reason: 'corrected operator reason', status: 'APPROVED', fromBlockName: 'B1x' });
    const row = await audit(r.id, 'MANUAL_RECORD_UPDATED');
    expect(row?.reason).toBe(REASON);
    expect(row?.beforeValue).toMatchObject({ reason: 'operator reason', status: 'PENDING' });
    expect((await call('PUT', `${base}/block-change-requests/${r.id}`, { _changeReason: REASON, processedAt: '' })).statusCode).toBe(200);
    expect((await call('PUT', `${base}/block-change-requests/${r.id}`, { _changeReason: REASON, status: 'MAYBE' })).json().error).toBe('INVALID_VALUE');
    expect((await call('PUT', `${base}/block-change-requests/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
  });

  it('POST needs the full filter + block identity, defaults the requester, maps DB refusals; DELETE audits', async () => {
    const full = { filterId: f2, filterName: `${PREFIX}-F2`, fromBlockId: h.blockId, fromBlockName: 'B1', toBlockId: randomUUID(), toBlockName: 'B2' };
    for (const k of Object.keys(full)) {
      const p: Record<string, unknown> = { _changeReason: REASON, ...full, [k]: '' };
      expect((await call('POST', `${base}/block-change-requests`, p)).json()).toMatchObject({ error: 'MISSING_FIELD', message: `${k} is required.` });
    }
    expect((await call('POST', `${base}/block-change-requests`, { _changeReason: REASON, ...full, status: 'NOPE' })).json().error).toBe('INVALID_VALUE');
    const badUuid = await call('POST', `${base}/block-change-requests`, { _changeReason: REASON, ...full, filterId: 'not-a-uuid' });
    expect(badUuid.statusCode).toBe(400);
    expect(badUuid.json()).toMatchObject({ error: 'CREATE_FAILED', message: 'Could not create block change request.' });

    const res = await call('POST', `${base}/block-change-requests`, {
      _changeReason: REASON, ...full, reason: 'manual', status: 'REJECTED', processedAt: '1971-07-02T00:00:00.000Z', createdAt: '1971-07-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const c = res.json();
    bcrIds.push(c.id);
    expect(c).toMatchObject({ requestedBy: saId, requestedByName: SA, manualEntry: true, status: 'REJECTED', reason: 'manual' });
    expect((await audit(c.id, 'MANUAL_RECORD_CREATED'))?.reason).toBe(REASON);

    const del = await call('DELETE', `${base}/block-change-requests/${c.id}`, { _changeReason: REASON });
    expect(del.statusCode).toBe(200);
    expect(await prisma.blockChangeRequest.count({ where: { id: c.id } })).toBe(0);
    expect((await audit(c.id, 'MANUAL_RECORD_DELETED'))?.beforeValue).toMatchObject({ id: c.id, reason: 'manual' });
  });
});

describe('PM schedules + entries', () => {
  const mkEntry = (day: number, tol = 2, month = 7, extra: object = {}) =>
    prisma.pmScheduleEntry.create({
      data: { scheduleId, month, plannedDate: d(day, 0), toleranceDays: tol, windowStart: d(day - tol, 0), windowEnd: d(day + tol, 0), ...extra },
    });

  it('GET /data/pm-schedules resolves the owning entity name (null when the entity is gone)', async () => {
    const orphanEntity = randomUUID();
    const orphan = await prisma.pmSchedule.create({ data: { entityId: orphanEntity, year: 1971, createdBy: saId } });
    try {
      const list = (await call('GET', `${base}/pm-schedules`)).json().data;
      expect(list.find((s: any) => s.id === scheduleId)).toEqual({ id: scheduleId, entityId: h.ahuId, entityName: `${PREFIX}-AHU`, year: 1971, version: 1, status: 'ACTIVE' });
      expect(list.find((s: any) => s.id === orphan.id)).toMatchObject({ entityId: orphanEntity, entityName: null, status: 'DRAFT' });
    } finally {
      await prisma.pmSchedule.delete({ where: { id: orphan.id } });
    }
  });

  it('GET /data/pm-entries filters by planned-date window and approval status, with the schedule included', async () => {
    const e1 = await mkEntry(3, 0, 7, { approvalStatus: 'APPROVED' });
    const e2 = await mkEntry(28, 0, 7);
    const all = (await call('GET', `${base}/pm-entries?${WINDOW}`)).json();
    expect(all.data.map((r: any) => r.id)).toEqual([e2.id, e1.id]);
    expect(all.data[0].schedule).toMatchObject({ id: scheduleId, year: 1971 });
    expect((await call('GET', `${base}/pm-entries?${WINDOW}&approvalStatus=APPROVED`)).json().data.map((r: any) => r.id)).toEqual([e1.id]);
    await prisma.pmScheduleEntry.deleteMany({ where: { id: { in: [e1.id, e2.id] } } });
  });

  it('PUT validates month / tolerance / enum, enforces visit separation, audits the change', async () => {
    const a = await mkEntry(10);
    const b = await mkEntry(25);
    const put = async (id: string, p: object) => call('PUT', `${base}/pm-entries/${id}`, { _changeReason: REASON, ...p });
    expect((await put(a.id, { month: 13 })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'month must be a whole number from 1 to 12' });
    expect((await put(a.id, { toleranceDays: -1 })).json()).toMatchObject({ message: 'toleranceDays must be a whole number of 0 or more' });
    expect((await put(a.id, { toleranceDays: 1.5 })).json()).toMatchObject({ message: 'toleranceDays must be a whole number of 0 or more' });
    expect((await put(a.id, { approvalStatus: 'SORT_OF' })).json().error).toBe('INVALID_VALUE');
    const overlap = await put(b.id, { plannedDate: '1971-07-12' });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toBe('PM_VISIT_OVERLAP');
    const tolOverlap = await put(a.id, { toleranceDays: 15 });
    expect(tolOverlap.json().error).toBe('PM_VISIT_OVERLAP');
    expect(await auditCount(a.id, 'MANUAL_RECORD_UPDATED')).toBe(0);
    expect((await call('PUT', `${base}/pm-entries/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);

    const ok = await put(a.id, {
      month: '7', toleranceDays: '1', approvalStatus: 'APPROVED', approvalRemarks: 'fine', submittedByName: 'x', approvedByName: SA,
      notes: 'n', plannedDate: '1971-07-11', windowStart: '1971-07-10', windowEnd: '1971-07-12', approvedAt: '',
    });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.pmScheduleEntry.findUnique({ where: { id: a.id } })).toMatchObject({ toleranceDays: 1, approvalStatus: 'APPROVED', notes: 'n', approvedAt: null });
    const row = await audit(a.id, 'MANUAL_RECORD_UPDATED');
    expect(row?.beforeValue).toMatchObject({ toleranceDays: 2, approvalStatus: 'PENDING' });
    // A notes-only edit skips the separation check entirely.
    expect((await put(b.id, { notes: 'only notes' })).statusCode).toBe(200);
  });

  it('POST requires schedule, month and date; defaults the window; refuses an overlap', async () => {
    const miss = async (p: object) => (await call('POST', `${base}/pm-entries`, { _changeReason: REASON, ...p })).json();
    expect(await miss({ month: 7, plannedDate: '1971-09-01' })).toMatchObject({ message: 'A PM schedule must be selected.' });
    expect(await miss({ scheduleId, plannedDate: '1971-09-01' })).toMatchObject({ message: 'Month (1–12) is required.' });
    expect(await miss({ scheduleId, month: 9 })).toMatchObject({ message: 'Planned date is required.' });
    expect(await miss({ scheduleId, month: 0, plannedDate: '1971-09-01' })).toMatchObject({ error: 'INVALID_VALUE' });

    const res = await call('POST', `${base}/pm-entries`, { _changeReason: REASON, scheduleId, month: 10, plannedDate: '1971-10-15', notes: 'manual', approvalStatus: 'PENDING' });
    expect(res.statusCode).toBe(200);
    const e = res.json();
    expect(e).toMatchObject({ manualEntry: true, toleranceDays: 0, notes: 'manual' });
    expect(e.windowStart).toBe(e.plannedDate);
    expect(e.windowEnd).toBe(e.plannedDate);
    expect(await auditCount(e.id, 'MANUAL_RECORD_CREATED')).toBe(1);

    const clash = await call('POST', `${base}/pm-entries`, { _changeReason: REASON, scheduleId, month: 10, plannedDate: '1971-10-16', toleranceDays: 3, windowStart: '1971-10-13', windowEnd: '1971-10-19' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toBe('PM_VISIT_OVERLAP');

    // A schedule that does not exist has no siblings to clash with, so the FK
    // refuses the insert: a clean CREATE_FAILED, nothing audited.
    const ghost = randomUUID();
    const orphan = await call('POST', `${base}/pm-entries`, { _changeReason: REASON, scheduleId: ghost, month: 10, plannedDate: '1971-10-01' });
    expect(orphan.statusCode).toBe(400);
    expect(orphan.json()).toMatchObject({ error: 'CREATE_FAILED', message: 'Could not create PM entry.' });
    expect(await prisma.pmScheduleEntry.count({ where: { scheduleId: ghost } })).toBe(0);
  });

  it('DELETE audits first; an entry with an execution is refused by the DB (RESTRICT) -> DELETE_FAILED, no audit row', async () => {
    const free = await mkEntry(5, 0, 11);
    expect((await call('DELETE', `${base}/pm-entries/${free.id}`, { _changeReason: REASON })).statusCode).toBe(200);
    expect(await auditCount(free.id, 'MANUAL_RECORD_DELETED')).toBe(1);

    const busy = await mkEntry(20, 0, 11);
    const ex = await prisma.pmExecution.create({ data: { scheduleEntryId: busy.id, entityId: h.ahuId } });
    pmExecutionIds.push(ex.id);
    const res = await call('DELETE', `${base}/pm-entries/${busy.id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'DELETE_FAILED', message: 'Could not delete pm entry.' });
    expect(await prisma.pmScheduleEntry.count({ where: { id: busy.id } })).toBe(1);
    expect(await auditCount(busy.id, 'MANUAL_RECORD_DELETED')).toBe(0);
  });
});
