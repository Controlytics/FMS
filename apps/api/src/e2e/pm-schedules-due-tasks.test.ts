/**
 * PM schedules — My Tasks (/due), the offline missed-PM map
 * (/pending-tasks-map), the overdue-deviation lifecycle (sweep → acknowledge →
 * close → blocked re-occurrence) and the missed-PM write-off, against real rows.
 *
 * Everything is built relative to today (UTC midnight, `@db.Date` semantics),
 * at least five days away from any window edge, so the suite is independent of
 * the date and time it runs.
 *
 * Own SUPER_ADMIN, roles, users, hierarchy, cleaning cycles and events; PM
 * config served in-process (pm-fixtures.ts). The sweep is global by design, so
 * assertions are made on this suite's own AHUs/entries only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import { getPendingEarlierPmTasks, applyPmSkips, getPendingPmTasksMap } from '../modules/pm-schedules/pm-pending-tasks.js';
import { loadCountedFilters as loadPmCountedFilters } from '../modules/pm-schedules/pm-shared.js';
import { loadCountedFilters as loadAhuGateFilters } from '../modules/filter-operations/ahu-completion-gate.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, utcDay, iso, DAY, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMD');
const T = utcDay(0);
const at = (days: number, hours = 0) => new Date(T.getTime() + days * DAY + hours * 3_600_000);
const YEAR = T.getUTCFullYear();

let app: FastifyInstance;
let cfg: ConfigOverrides;
let notifyRole: string;
const u: Record<string, { id: string; username: string }> = {};
const tok: Record<string, string> = {};
const ahu: Record<string, string> = {};
const entryOf: Record<string, string> = {};
const f: Record<string, string> = {}; // filters
const cycle: Record<string, string> = {};
let blockId: string, areaId: string, area2Id: string;

const call = (method: string, url: string, k: string, payload?: unknown, pw?: string) =>
  app.inject({
    method: method as any, url: `/api/pm-schedules${url}`,
    headers: { authorization: `Bearer ${tok[k]}`, ...(pw ? { 'x-reauth-password': pw } : {}) },
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });

async function due(query = '') {
  const res = await call('GET', `/due${query}`, 'ro');
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { tasks: any[]; overdue: any[]; settings: any };
}
const rowFor = (list: any[], key: string) => list.find((r) => r.ahuId === ahu[key]);

/** One AHU with one APPROVED visit. */
async function scenario(key: string, planned: Date, tol: number, opts: {
  parentId?: string | null; mode?: string; isActive?: boolean; extra?: Record<string, unknown>;
} = {}) {
  ahu[key] = await fx.instance('AHU', key, {
    parentId: opts.parentId === undefined ? blockId : opts.parentId,
    isActive: opts.isActive,
    ...(opts.mode ? { customAttributes: { pmFilterSetMode: opts.mode } } : {}),
  });
  const s = await fx.schedule(ahu[key], YEAR, u.sa.id, [{ plannedDate: planned, toleranceDays: tol, extra: opts.extra }]);
  entryOf[key] = s.entryIds[0];
}
const myDeviation = (key: string) => prisma.deviation.findUnique({ where: { pmScheduleEntryId: entryOf[key] } });

/**
 * Run the global sweep; undo anything THIS call opened on rows that are not
 * ours. Identified through the sweep's own DEVIATION_OPENED audit rows (actor =
 * this caller, by uuid or username), never by time alone — another suite may be
 * creating its own deviation rows at the same moment.
 */
async function sweep(k = 'sa') {
  const before = new Date();
  const res = await call('POST', '/deviations/sweep', k);
  const opened = await prisma.auditTrail.findMany({
    where: { action: 'DEVIATION_OPENED', timestamp: { gte: before }, userId: { in: [u[k].id, u[k].username] } },
    select: { targetId: true },
  });
  const ids = opened.map((a) => a.targetId).filter((id): id is string => !!id);
  if (ids.length) await prisma.deviation.deleteMany({ where: { id: { in: ids }, ahuId: { notIn: Object.values(ahu) } } });
  return res;
}

beforeAll(async () => {
  app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
  notifyRole = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides(defaultPmConfig(notifyRole));
  const EXE = await fx.role('EXE', ['PM_READ', 'PM_EXECUTE']);
  const RO = await fx.role('RO', ['PM_READ']);
  const UPD = await fx.role('UPD', ['PM_READ', 'PM_UPDATE']);
  const NONE = await fx.role('NONE', ['DASHBOARD_VIEW']);
  for (const [k, role] of [['sa', 'SUPER_ADMIN'], ['exe', EXE], ['ro', RO], ['upd', UPD], ['none', NONE]] as const) {
    u[k] = await fx.user(k, role);
    tok[k] = await fx.login(app, u[k].username);
  }

  blockId = await fx.instance('BLOCK', 'BLOCK');
  areaId = await fx.instance('AREA', 'AREA', { parentId: blockId });
  area2Id = await fx.instance('AREA', 'AREA-TOP', { parentId: null });
  const C = (filter: string, o: Parameters<PmFixture['cycle']>[2]) => fx.cycle(f[filter], u.sa.id, o);

  // In-window, nothing done (an old clean only feeds lastCycleCompletedAt).
  await scenario('PEND', T, 5);
  f.p1 = await fx.filter('p1', ahu.PEND);
  await C('p1', { status: 'COMPLETED', startedAt: at(-101), completedAt: at(-100) });
  // A visit still awaiting approval, and one on an archived version, never become tasks.
  await fx.schedule(ahu.PEND, YEAR + 1, u.sa.id, [{ plannedDate: T, toleranceDays: 5, approvalStatus: 'PENDING_REVIEW' }]);
  await fx.schedule(ahu.PEND, YEAR + 2, u.sa.id, [{ plannedDate: T, toleranceDays: 5 }], 'ARCHIVED');

  // In-window, half done: one filter mid-cycle, one PM-cleaned.
  await scenario('PROG', T, 5, { parentId: areaId });
  f.g1 = await fx.filter('g1', ahu.PROG, { filterSet: 'SET_A', stage: 'WASH_IN' });
  f.g2 = await fx.filter('g2', ahu.PROG, { filterSet: 'SET_B' });
  await C('g1', { status: 'IN_PROGRESS', startedAt: at(-1) });
  await C('g2', { status: 'COMPLETED', startedAt: at(-2), completedAt: at(-1) });

  await scenario('DONE', T, 5);
  f.d1 = await fx.filter('d1', ahu.DONE);
  await C('d1', { status: 'COMPLETED', startedAt: at(-2), completedAt: at(-1) });

  // Cleaned, but for a breakdown — not the scheduled PM.
  await scenario('NONPM', T, 5);
  f.n1 = await fx.filter('n1', ahu.NONPM);
  await C('n1', { status: 'COMPLETED', reason: 'BREAKDOWN', startedAt: at(-2), completedAt: at(-1) });

  // Overdue (window T-20..T-10): one late PM clean, one late clean in progress, one nothing.
  await scenario('ODUE', at(-15), 5);
  f.o1 = await fx.filter('o1', ahu.ODUE);
  f.o2 = await fx.filter('o2', ahu.ODUE);
  f.o3 = await fx.filter('o3', ahu.ODUE);
  await C('o1', { status: 'COMPLETED', startedAt: at(-3), completedAt: at(-2) });
  cycle.o2 = await C('o2', { status: 'IN_PROGRESS', startedAt: at(-1) });
  // A non-PM clean on o3 does not count.
  await C('o3', { status: 'COMPLETED', reason: 'BREAKDOWN', startedAt: at(-4), completedAt: at(-3) });

  // Overdue, all filters cleaned late → reads as complete.
  await scenario('LATE', at(-15), 5);
  f.l1 = await fx.filter('l1', ahu.LATE);
  await C('l1', { status: 'COMPLETED', startedAt: at(-4), completedAt: at(-3) });

  // Written off: the later clean must NOT turn it into "completed".
  await scenario('SKIP', at(-15), 5, { extra: { skippedAt: at(-1), skippedBy: randomUUID(), skippedByName: 'night-shift', skipReason: 'AHU shut down for repairs' } });
  f.s1 = await fx.filter('s1', ahu.SKIP);
  await C('s1', { status: 'COMPLETED', startedAt: at(-4), completedAt: at(-3) });

  await scenario('SETA', T, 5, { mode: 'SET_A' });
  f.a1 = await fx.filter('a1', ahu.SETA, { filterSet: 'SET_A' });
  f.a2 = await fx.filter('a2', ahu.SETA, { filterSet: 'SET_B' });
  f.a3 = await fx.filter('a3', ahu.SETA, { filterSet: null });
  await C('a1', { status: 'COMPLETED', startedAt: at(-2), completedAt: at(-1) });

  await scenario('SETB', T, 5, { mode: 'SET_B' });
  f.b1 = await fx.filter('b1', ahu.SETB, { filterSet: 'SET_A' });
  f.b2 = await fx.filter('b2', ahu.SETB, { filterSet: 'SET_B' });
  await C('b1', { status: 'COMPLETED', startedAt: at(-2), completedAt: at(-1) });

  await scenario('DIS', T, 5, { mode: 'DISABLED' });
  f.x1 = await fx.filter('x1', ahu.DIS);
  await scenario('INACT', T, 5, { isActive: false });

  // Closed 45 days ago: outside the 30-day My Tasks horizon, inside the 90-day sweep horizon.
  await scenario('FAR', at(-50), 5);
  f.far1 = await fx.filter('far1', ahu.FAR);

  // Planned tomorrow with a wide tolerance: its window opens before every other
  // fetched visit's, although it sorts after them by planned date.
  await scenario('NOPAR', at(1), 25, { parentId: null });
  await scenario('TOP', T, 5, { parentId: area2Id });

  // Overdue and uncleaned — used by the deviation close paths and the write-off.
  await scenario('GHOST', at(-15), 5);
  f.gh1 = await fx.filter('gh1', ahu.GHOST);
  await scenario('NOEV', at(-15), 5);
  f.ne1 = await fx.filter('ne1', ahu.NOEV);
  await scenario('WOFF', at(-15), 5);
  f.w1 = await fx.filter('w1', ahu.WOFF);

  // Overdue under a filter-set mode: only that set has to be cleaned.
  await scenario('ODA', at(-15), 5, { mode: 'SET_A' });
  f.oa1 = await fx.filter('oa1', ahu.ODA, { filterSet: 'SET_A' });
  f.oa2 = await fx.filter('oa2', ahu.ODA, { filterSet: 'SET_B' });
  await C('oa1', { status: 'COMPLETED', startedAt: at(-4), completedAt: at(-3) });
  await scenario('ODB', at(-15), 5, { mode: 'SET_B' });
  f.ob1 = await fx.filter('ob1', ahu.ODB, { filterSet: 'SET_A' });
  f.ob2 = await fx.filter('ob2', ahu.ODB, { filterSet: 'SET_B' });
  await C('ob1', { status: 'COMPLETED', startedAt: at(-4), completedAt: at(-3) });
  // Overdue, but the AHU has no filters: nothing to clean, nothing to gate or deviate.
  await scenario('NOF', at(-15), 5);

  // D03-05: filters still in the creation workflow (pending review / approval,
  // rejected) cannot be cleaned, so they must not count toward the PM visit.
  const waiting = async (key: string, ahuKey: string, status: string, filterSet: 'SET_A' | 'SET_B' | null = null) => {
    f[key] = await fx.filter(key, ahu[ahuKey], { filterSet });
    await prisma.assetInstance.update({ where: { id: f[key] }, data: { approvalStatus: status as any } });
  };
  await scenario('WFQ', T, 5);
  f.wq1 = await fx.filter('wq1', ahu.WFQ);
  await C('wq1', { status: 'COMPLETED', startedAt: at(-2), completedAt: at(-1) });
  await waiting('wq2', 'WFQ', 'PENDING_REVIEW');
  await waiting('wq3', 'WFQ', 'PENDING_APPROVAL');
  await waiting('wq4', 'WFQ', 'REJECTED');
  // ...under a filter-set mode too: SET_A counts, but not a SET_A filter awaiting review.
  await scenario('WFA', T, 5, { mode: 'SET_A' });
  f.wa1 = await fx.filter('wa1', ahu.WFA, { filterSet: 'SET_A' });
  f.wa2 = await fx.filter('wa2', ahu.WFA, { filterSet: 'SET_B' });
  await waiting('wa3', 'WFA', 'PENDING_REVIEW', 'SET_A');
  // Overdue, and its ONLY filter waits for approval: nothing it can clean, so nothing to gate.
  await scenario('WFO', at(-15), 5);
  await waiting('wo1', 'WFO', 'PENDING_APPROVAL');
}, 120_000);

afterAll(async () => {
  await fx.cleanup(app);
}, 120_000);

beforeEach(() => {
  for (const [k, v] of Object.entries(defaultPmConfig(notifyRole))) cfg.set(k, v);
});

describe('GET /due — My Tasks', () => {
  it('needs PM_READ', async () => {
    const res = await call('GET', '/due', 'none');
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_READ');
  });

  it('pending: nothing cleaned in the window; lastCycleCompletedAt falls back to the latest clean; block resolved', async () => {
    const r = rowFor((await due()).tasks, 'PEND');
    expect(r).toMatchObject({
      entryId: entryOf.PEND, ahuName: `${fx.tag}-PEND`, overallStatus: 'pending', totalFilters: 1, cleanedCount: 0,
      blockId, blockName: `${fx.tag}-BLOCK`, areaId: null, areaName: null, toleranceDays: 5,
      skippedAt: null, skipReason: null, deviation: null,
    });
    expect(iso(new Date(r.windowStart))).toBe(iso(at(-5)));
    expect(r.filters).toEqual([{ filterId: f.p1, filterName: `${fx.tag}-p1`, status: 'pending', currentStage: null, lastCycleCompletedAt: at(-100).toISOString() }]);
  });

  it('in_progress: one filter mid-cycle (with its stage), one PM-cleaned; AHU → AREA → BLOCK resolved', async () => {
    const r = rowFor((await due()).tasks, 'PROG');
    expect(r).toMatchObject({ overallStatus: 'in_progress', totalFilters: 2, cleanedCount: 1, areaId, areaName: `${fx.tag}-AREA`, blockId });
    const byId = Object.fromEntries(r.filters.map((x: any) => [x.filterId, x]));
    expect(byId[f.g1]).toMatchObject({ status: 'in_progress', currentStage: 'WASH_IN', lastCycleCompletedAt: null });
    expect(byId[f.g2]).toMatchObject({ status: 'cleaned_in_window', lastCycleCompletedAt: at(-1).toISOString() });
  });

  it('complete when every counted filter is PM-cleaned in the window', async () => {
    expect(rowFor((await due()).tasks, 'DONE')).toMatchObject({ overallStatus: 'complete', cleanedCount: 1, totalFilters: 1 });
  });

  it('a clean done for another reason does not satisfy the PM — unless no PM reason is configured', async () => {
    expect(rowFor((await due()).tasks, 'NONPM')).toMatchObject({ overallStatus: 'pending', cleanedCount: 0 });
    cfg.set('filter-cleaning-reasons', { value: [{ key: 'BREAKDOWN', name: 'Breakdown', isActive: true }, { key: 'PM', name: 'PM', isActive: false }] });
    expect(rowFor((await due()).tasks, 'NONPM')).toMatchObject({ overallStatus: 'complete', cleanedCount: 1 });
    // The flat (un-wrapped) list shape is read too; a reason NAMED "pm" counts.
    cfg.set('filter-cleaning-reasons', [{ key: 'PREV', name: 'pm', isActive: true }]);
    expect(rowFor((await due()).tasks, 'NONPM')).toMatchObject({ overallStatus: 'pending' });
    cfg.missing('filter-cleaning-reasons');
    expect(rowFor((await due()).tasks, 'NONPM')).toMatchObject({ overallStatus: 'complete' });
  });

  it('overdue: late PM cleans are credited, a late clean in progress shows, the row lands in `overdue`', async () => {
    const d = await due();
    expect(rowFor(d.tasks, 'ODUE')).toBeUndefined();
    const r = rowFor(d.overdue, 'ODUE');
    expect(r).toMatchObject({ overallStatus: 'overdue', totalFilters: 3, cleanedCount: 1 });
    const byId = Object.fromEntries(r.filters.map((x: any) => [x.filterId, x.status]));
    expect(byId).toEqual({ [f.o1]: 'cleaned_in_window', [f.o2]: 'in_progress', [f.o3]: 'pending' });
  });

  it('an overdue visit cleaned in full (late) reads as complete and moves out of the overdue list', async () => {
    const d = await due();
    expect(rowFor(d.overdue, 'LATE')).toBeUndefined();
    expect(rowFor(d.tasks, 'LATE')).toMatchObject({ overallStatus: 'complete', cleanedCount: 1 });
  });

  it('a written-off visit is not_performed with its reason — never complete, even though a later clean exists', async () => {
    const r = rowFor((await due()).tasks, 'SKIP');
    expect(r).toMatchObject({ overallStatus: 'not_performed', cleanedCount: 0, skippedByName: 'night-shift', skipReason: 'AHU shut down for repairs' });
    expect(r.filters.map((x: any) => x.status)).toEqual(['skipped']);
  });

  it('filter-set modes narrow the counted filters; DISABLED and deactivated AHUs produce no task', async () => {
    const d = await due();
    const a = rowFor(d.tasks, 'SETA');
    expect(a).toMatchObject({ overallStatus: 'complete', totalFilters: 1, cleanedCount: 1 });
    expect(a.filters.map((x: any) => x.filterId)).toEqual([f.a1]);
    const b = rowFor(d.tasks, 'SETB');
    expect(b).toMatchObject({ overallStatus: 'pending', totalFilters: 1, cleanedCount: 0 });
    expect(b.filters.map((x: any) => x.filterId)).toEqual([f.b2]);
    for (const k of ['DIS', 'INACT']) {
      expect(rowFor(d.tasks, k), k).toBeUndefined();
      expect(rowFor(d.overdue, k), k).toBeUndefined();
    }
    // Overdue under a mode: the other set's dirty filter does not hold SET_A back, and vice versa.
    expect(rowFor(d.tasks, 'ODA')).toMatchObject({ overallStatus: 'complete', totalFilters: 1, cleanedCount: 1 });
    expect(rowFor(d.overdue, 'ODB')).toMatchObject({ overallStatus: 'overdue', totalFilters: 1, cleanedCount: 0 });
  });

  it('a period holding only a filter-less AHU still answers (no cycle lookups at all)', async () => {
    const d = await due(`?from=${iso(at(1))}&to=${iso(at(1))}`);
    const mine = [...d.tasks, ...d.overdue].filter((r) => Object.values(ahu).includes(r.ahuId));
    expect(mine.map((r) => r.ahuId)).toEqual([ahu.NOPAR]);
    expect(mine[0]).toMatchObject({ totalFilters: 0, filters: [], toleranceDays: 25 });
  });

  it('an AHU with no parent has no block/area; a parent chain with no BLOCK falls back to its topmost node', async () => {
    const d = await due();
    expect(rowFor(d.tasks, 'NOPAR')).toMatchObject({ blockId: null, blockName: null, areaId: null, areaName: null, totalFilters: 0 });
    expect(rowFor(d.tasks, 'TOP')).toMatchObject({ areaId: area2Id, areaName: `${fx.tag}-AREA-TOP`, blockId: area2Id, blockName: `${fx.tag}-AREA-TOP` });
  });

  it('windows closed more than 30 days ago are left out of the default view', async () => {
    const d = await due();
    expect(rowFor(d.tasks, 'FAR')).toBeUndefined();
    expect(rowFor(d.overdue, 'FAR')).toBeUndefined();
  });

  it('a from/to period returns visits PLANNED in it, whatever today is', async () => {
    const d = await due(`?from=${iso(at(-60))}&to=${iso(at(-40))}`);
    expect(rowFor(d.overdue, 'FAR')).toMatchObject({ overallStatus: 'overdue', entryId: entryOf.FAR });
    expect(rowFor(d.tasks, 'PEND')).toBeUndefined();
    // `to` alone, and `from` alone, are both a period.
    expect(rowFor((await due(`?to=${iso(at(-40))}`)).overdue, 'FAR')).toBeTruthy();
    const fromOnly = await due(`?from=${iso(at(-1))}`);
    expect(rowFor(fromOnly.tasks, 'PEND')).toBeTruthy();
    expect(rowFor(fromOnly.overdue, 'FAR')).toBeUndefined();
    // A period with nothing planned in it.
    expect(await due('?from=2190-01-01&to=2190-01-02')).toEqual({ tasks: [], overdue: [], settings: { showOverdueSeparately: true } });
  });

  it('showOverdueSeparately=false hides the overdue section', async () => {
    cfg.set('pm-schedule-settings', { enabled: true, showOverdueSeparately: false });
    const d = await due();
    expect(d.overdue).toEqual([]);
    expect(d.settings).toEqual({ showOverdueSeparately: false });
    expect(rowFor(d.tasks, 'ODUE')).toBeUndefined();
  });

  it('a task-visibility mode other than GLOBAL is 501 NOT_IMPLEMENTED', async () => {
    cfg.set('pm-schedule-settings', { enabled: true, taskVisibility: 'PER_USER' });
    const res = await call('GET', '/due', 'ro');
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ error: 'NOT_IMPLEMENTED' });
    expect(res.json().message).toContain('PER_USER');
  });
});

describe('D03-05: a filter waiting in the creation workflow does not count toward PM', () => {
  it('My Tasks counts only APPROVED filters, so the visit completes when they are cleaned', async () => {
    expect(rowFor((await due()).tasks, 'WFQ')).toMatchObject({ overallStatus: 'complete', totalFilters: 1, cleanedCount: 1 });
  });

  it('...and still honours the AHU filter-set mode', async () => {
    const r = rowFor((await due()).tasks, 'WFA');
    expect(r).toMatchObject({ overallStatus: 'pending', totalFilters: 1, cleanedCount: 0 });
    expect(r.filters.map((x: any) => x.filterId ?? x.id)).toEqual([f.wa1]);
  });

  it('the PM sites and the AHU-completion gate count the SAME filters (one predicate)', async () => {
    const pm = await loadPmCountedFilters([ahu.WFQ, ahu.WFA]);
    expect(pm.get(ahu.WFQ)!.filters.map((x) => x.id)).toEqual([f.wq1]);
    expect(pm.get(ahu.WFA)!.filters.map((x) => x.id)).toEqual([f.wa1]);
    expect((await loadAhuGateFilters(ahu.WFQ)).map((x) => x.id)).toEqual([f.wq1]);
  });

  it('an overdue AHU whose only filter waits for approval has nothing to gate', async () => {
    const map = await getPendingPmTasksMap();
    expect(map[ahu.WFO]).toBeUndefined();
  });
});

describe('GET /pending-tasks-map — the tablet\'s offline missed-PM cache', () => {
  it('keys outstanding overdue visits by AHU; cleaned, written-off and in-window visits are absent', async () => {
    const res = await call('GET', '/pending-tasks-map', 'ro');
    expect(res.statusCode).toBe(200);
    const map = res.json();
    expect(map[ahu.FAR]).toEqual([{
      entryId: entryOf.FAR, scheduleId: expect.any(String), ahuId: ahu.FAR, ahuName: `${fx.tag}-FAR`,
      plannedDate: at(-50).toISOString(), windowStart: at(-55).toISOString(), windowEnd: at(-45).toISOString(), overdueDays: 45,
    }]);
    expect(map[ahu.GHOST]?.[0]).toMatchObject({ entryId: entryOf.GHOST, overdueDays: 10 });
    for (const k of ['LATE', 'SKIP', 'PEND', 'DONE', 'NOPAR', 'NOF']) expect(map[ahu[k]], k).toBeUndefined();
  });

  it('agrees with the per-filter gate it is built from', async () => {
    const map = await getPendingPmTasksMap();
    expect(map[ahu.FAR]).toEqual(await getPendingEarlierPmTasks(f.far1));
  });

  it('needs PM_READ', async () => {
    expect((await call('GET', '/pending-tasks-map', 'none')).statusCode).toBe(403);
  });
});

describe('overdue deviations', () => {
  it('the sweep needs PM_UPDATE', async () => {
    const res = await call('POST', '/deviations/sweep', 'ro');
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_UPDATE');
  });

  it('opens one deviation per overdue, not-fully-PM-cleaned visit — and notifies + audits it', async () => {
    const res = await sweep('upd');
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['blocked', 'closed', 'opened']);
    expect(res.json().opened).toBeGreaterThanOrEqual(5);

    const dev = await myDeviation('ODUE');
    expect(dev).toMatchObject({
      ahuId: ahu.ODUE, ahuName: `${fx.tag}-ODUE`, filterCount: 3, status: 'OPEN', overdueDaysAtOpen: 15,
      acknowledgedBy: null, completedAt: null,
    });
    expect(dev?.deviationNumber).toMatch(/^DEV-\d{6}$/);
    expect([...(dev!.filterIds as string[])].sort()).toEqual([f.o1, f.o2, f.o3].sort());
    expect(iso(dev!.scheduledDate)).toBe(iso(at(-15)));
    expect(iso(dev!.windowStart!)).toBe(iso(at(-20)));
    expect(dev?.notifiedAt).toBeInstanceOf(Date);
    for (const k of ['FAR', 'GHOST', 'NOEV', 'WOFF']) expect((await myDeviation(k))?.status, k).toBe('OPEN');
    // Fully cleaned (late), written-off-and-cleaned, in-window, disabled and filter-less visits get none.
    for (const k of ['LATE', 'SKIP', 'PEND', 'DIS', 'NOPAR', 'NOF', 'ODA']) expect(await myDeviation(k), k).toBeNull();
    // SET_B mode: only the SET_B filter is counted, so only it is recorded.
    expect(await myDeviation('ODB')).toMatchObject({ status: 'OPEN', filterIds: [f.ob2], filterCount: 1 });

    const note = await prisma.notification.findFirst({ where: { type: 'PM_OVERDUE', forRole: notifyRole, metadata: { path: ['deviationId'], equals: dev!.id } } });
    expect(note).toMatchObject({ title: `AHU ${fx.tag}-ODUE cleaning overdue` });
    expect(note?.message).toContain('overdue by 15 day(s) — 3 filter(s) pending');
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_OPENED', targetId: dev!.id } });
    expect(audit).toMatchObject({ userRole: fx.roleName('UPD'), targetType: 'deviation' });
    expect(audit?.afterValue).toMatchObject({ deviationNumber: dev!.deviationNumber, overdueDays: 15, filterCount: 3 });
  });

  it('My Tasks now carries the deviation context for the visit', async () => {
    const r = rowFor((await due()).overdue, 'ODUE');
    const dev = await myDeviation('ODUE');
    expect(r.deviation).toEqual({
      deviationId: dev!.id, deviationNumber: dev!.deviationNumber, status: 'OPEN',
      overdueDays: 15, acknowledged: false, acknowledgedByName: null,
    });
  });

  it('a second sweep is idempotent: no duplicate, no "blocked" signal for a still-open deviation', async () => {
    const before = await prisma.deviation.count({ where: { ahuId: { in: Object.values(ahu) } } });
    const res = await sweep();
    expect(res.statusCode).toBe(200);
    expect(await prisma.deviation.count({ where: { ahuId: { in: Object.values(ahu) } } })).toBe(before);
    const dev = await myDeviation('ODUE');
    expect(await prisma.auditTrail.count({ where: { action: 'DEVIATION_OPEN_BLOCKED', targetId: dev!.id } })).toBe(0);
  });

  it('GET /deviations filters by status and AHU, pages, and reports live overdue days', async () => {
    const one = (await call('GET', `/deviations?status=OPEN&ahuId=${ahu.ODUE}`, 'ro')).json();
    expect(one).toMatchObject({ total: 1, page: 1, limit: 50, totalPages: 1 });
    expect(one.data[0]).toMatchObject({ pmScheduleEntryId: entryOf.ODUE, liveOverdueDays: 15 });
    expect(one.openCount).toBeGreaterThanOrEqual(5);

    const all = (await call('GET', '/deviations?status=ALL&limit=1000', 'ro')).json();
    // ODUE, FAR, GHOST, NOEV, WOFF, ODB
    expect(all.data.filter((d: any) => Object.values(ahu).includes(d.ahuId))).toHaveLength(6);
    const page = (await call('GET', '/deviations?page=2&limit=1', 'ro')).json();
    expect(page).toMatchObject({ page: 2, limit: 1, totalPages: page.total });
    expect(page.data).toHaveLength(1);
    expect((await call('GET', `/deviations?status=CLOSED&ahuId=${ahu.ODUE}`, 'ro')).json().total).toBe(0);
    expect((await call('GET', '/deviations?ahuId=not-a-uuid', 'ro')).statusCode).toBe(400);
    expect((await call('GET', '/deviations', 'none')).statusCode).toBe(403);
  });

  it('acknowledge needs PM_EXECUTE, ALWAYS asks for the password, and 404s an unknown deviation', async () => {
    const dev = await myDeviation('ODUE');
    const ro = await call('POST', `/deviations/${dev!.id}/acknowledge`, 'ro');
    expect(ro.statusCode).toBe(403);
    expect(ro.json().requiredPermission).toBe('PM_EXECUTE');
    // No action-reauth row is configured — the gate is intrinsic.
    const noPw = await call('POST', `/deviations/${dev!.id}/acknowledge`, 'exe');
    expect(noPw.statusCode).toBe(401);
    expect(noPw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'ACKNOWLEDGE_PM_OVERDUE' });
    const missing = await call('POST', `/deviations/${randomUUID()}/acknowledge`, 'exe', undefined, fx.password);
    expect(missing.statusCode).toBe(404);
    expect((await myDeviation('ODUE'))?.status).toBe('OPEN');
  });

  it('acknowledging records who confirmed, with the password verified, and audits it as a signature', async () => {
    const dev = await myDeviation('ODUE');
    const res = await call('POST', `/deviations/${dev!.id}/acknowledge`, 'exe', undefined, fx.password);
    expect(res.statusCode).toBe(200);
    expect(await myDeviation('ODUE')).toMatchObject({
      status: 'ACKNOWLEDGED', acknowledgedBy: u.exe.id, acknowledgedByName: u.exe.username,
      passwordVerified: true, assignedUserId: u.exe.id,
    });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'ACKNOWLEDGE_PM_OVERDUE', targetId: dev!.id } });
    expect(audit).toMatchObject({ userId: u.exe.username, userRole: fx.roleName('EXE') });
    expect(audit?.beforeValue).toEqual({ status: 'OPEN' });
    expect(audit?.signatureMeaning).toContain(dev!.deviationNumber);
    expect(audit?.signatureAuditId).toBeTruthy();
    expect(rowFor((await due()).overdue, 'ODUE').deviation).toMatchObject({ status: 'ACKNOWLEDGED', acknowledged: true, acknowledgedByName: u.exe.username });
  });

  it('closes once every counted filter is PM-cleaned, crediting the acknowledger / the event performer / nobody', async () => {
    // ODUE: finish o2's cycle and PM-clean o3 (acknowledged → the acknowledger is credited).
    await prisma.cleaningCycle.update({ where: { id: cycle.o2 }, data: { status: 'COMPLETED', completedAt: at(-1, 6) } });
    await fx.cycle(f.o3, u.sa.id, { status: 'COMPLETED', startedAt: at(-1, 2), completedAt: at(-1, 12) });
    // GHOST: the CYCLE_COMPLETED event names a user id that no longer resolves.
    const ghost = randomUUID();
    const gc = await fx.cycle(f.gh1, u.sa.id, { status: 'COMPLETED', startedAt: at(-1, 2), completedAt: at(-1, 12) });
    await fx.cycleCompletedEvent(f.gh1, gc, ghost, at(-1, 12));
    // FAR: a real operator completed it (event performer is resolved to the username).
    const fc = await fx.cycle(f.far1, u.sa.id, { status: 'COMPLETED', startedAt: at(-1, 2), completedAt: at(-1, 12) });
    await fx.cycleCompletedEvent(f.far1, fc, u.exe.id, at(-1, 12));
    // NOEV: cleaned with no completion event, and its completion was already notified.
    await fx.cycle(f.ne1, u.sa.id, { status: 'COMPLETED', startedAt: at(-1, 2), completedAt: at(-1, 12) });
    await prisma.deviation.update({ where: { pmScheduleEntryId: entryOf.NOEV }, data: { completionNotifiedAt: at(-1) } });

    const res = await sweep();
    expect(res.json().closed).toBeGreaterThanOrEqual(4);

    const odue = await myDeviation('ODUE');
    expect(odue).toMatchObject({ status: 'CLOSED', completedBy: u.exe.id, completedByName: u.exe.username, delayDays: 14 });
    expect(odue?.completedAt?.toISOString()).toBe(at(-1, 12).toISOString());
    expect(odue?.closedAt).toBeInstanceOf(Date);
    expect(odue?.completionNotifiedAt).toBeInstanceOf(Date);
    expect(await myDeviation('GHOST')).toMatchObject({ status: 'CLOSED', completedBy: ghost, completedByName: ghost });
    expect(await myDeviation('FAR')).toMatchObject({ status: 'CLOSED', completedBy: u.exe.id, completedByName: u.exe.username, delayDays: 49 });
    const noev = await myDeviation('NOEV');
    expect(noev).toMatchObject({ status: 'CLOSED', completedBy: null, completedByName: null });
    expect(noev?.completionNotifiedAt?.toISOString()).toBe(at(-1).toISOString()); // not re-notified

    const done = await prisma.notification.findFirst({ where: { type: 'PM_OVERDUE_COMPLETED', forRole: notifyRole, metadata: { path: ['deviationId'], equals: odue!.id } } });
    expect(done?.message).toBe(`${u.exe.username} completed overdue cleaning for ${fx.tag}-ODUE filters (was overdue by 15 day(s); resolved with 14-day delay).`);
    expect(await prisma.notification.count({ where: { type: 'PM_OVERDUE_COMPLETED', metadata: { path: ['deviationId'], equals: noev!.id } } })).toBe(0);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_CLOSED', targetId: odue!.id } });
    expect(audit?.afterValue).toMatchObject({ completedByName: u.exe.username, delayDays: 14 });

    // My Tasks: the visit is now complete and its deviation reads as closed with the delay.
    const row = rowFor((await due()).tasks, 'ODUE');
    expect(row).toMatchObject({ overallStatus: 'complete', cleanedCount: 3 });
    expect(row.deviation).toMatchObject({ status: 'CLOSED', overdueDays: 14, acknowledged: true });
    const listed = (await call('GET', `/deviations?status=CLOSED&ahuId=${ahu.ODUE}`, 'ro')).json();
    expect(listed.data[0].liveOverdueDays).toBe(14);
  });

  it('a closed deviation cannot be acknowledged', async () => {
    const dev = await myDeviation('ODUE');
    const res = await call('POST', `/deviations/${dev!.id}/acknowledge`, 'exe', undefined, fx.password);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CONFLICT' });
  });

  it('a re-overdue visit whose deviation is already CLOSED is reported loudly (audited + notified), never dropped', async () => {
    // A new, never-cleaned filter makes the visit overdue again; the UNIQUE
    // (pm_schedule_entry_id) row is CLOSED, so a second deviation cannot be recorded.
    await fx.filter('o4', ahu.ODUE);
    const dev = await myDeviation('ODUE');
    const res = await sweep();
    expect(res.json().blocked).toBeGreaterThanOrEqual(1);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_OPEN_BLOCKED', targetId: dev!.id } });
    expect(audit?.beforeValue).toEqual({ existingDeviationNumber: dev!.deviationNumber, existingStatus: 'CLOSED' });
    expect(audit?.afterValue).toMatchObject({ pmScheduleEntryId: entryOf.ODUE, filterCount: 4 });
    const note = await prisma.notification.findFirst({ where: { forRole: notifyRole, metadata: { path: ['existingDeviationId'], equals: dev!.id } } });
    expect(note?.title).toBe(`PM deviation could NOT be opened — ${fx.tag}-ODUE`);
    // The closed record is untouched.
    expect(await myDeviation('ODUE')).toMatchObject({ status: 'CLOSED', delayDays: 14, completedByName: u.exe.username });
  });
});

describe('missed-PM write-off (pm-pending-tasks)', () => {
  it('lists the earlier unresolved visit for any filter under the AHU, with whole overdue days', async () => {
    const pending = await getPendingEarlierPmTasks(f.w1);
    expect(pending).toEqual([{
      entryId: entryOf.WOFF, scheduleId: expect.any(String), ahuId: ahu.WOFF, ahuName: `${fx.tag}-WOFF`,
      plannedDate: at(-15), windowStart: at(-20), windowEnd: at(-10), overdueDays: 10,
    }]);
    // `now` is injectable: three days later the same visit is 13 days overdue.
    expect((await getPendingEarlierPmTasks(f.w1, at(3, 1)))[0].overdueDays).toBe(13);
    // Before its window closed it is not yet an obligation.
    expect(await getPendingEarlierPmTasks(f.w1, at(-12))).toEqual([]);
  });

  it('is empty for a filter with no parent, and for an AHU whose filters are all retired', async () => {
    const orphan = await fx.instance('FILTER', 'orphan', { parentId: null });
    expect(await getPendingEarlierPmTasks(orphan)).toEqual([]);
    expect(await getPendingEarlierPmTasks(randomUUID())).toEqual([]);
    await scenario('RET', at(-15), 5);
    const retired = await fx.filter('ret1', ahu.RET, { status: 'Retired' });
    expect(await getPendingEarlierPmTasks(retired)).toEqual([]);
  });

  it('inside a transaction: writes the reason onto the visit, closes its deviation as SKIPPED, audits a §11 statement', async () => {
    const pending = await getPendingEarlierPmTasks(f.w1);
    await prisma.$transaction((tx) => applyPmSkips(
      [{ entryId: entryOf.WOFF, reason: '  AHU under shutdown  ' }, { entryId: randomUUID(), reason: 'not pending — ignored' }],
      pending,
      { userSub: u.exe.id, userId: u.exe.username, userRole: fx.roleName('EXE'), ipAddress: '10.0.0.9', userAgent: 'vitest' },
      tx,
    ));
    const e = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id: entryOf.WOFF } });
    expect(e).toMatchObject({ skippedBy: u.exe.id, skippedByName: u.exe.username, skipReason: 'AHU under shutdown', approvalStatus: 'APPROVED' });
    expect(e.skippedAt).toBeInstanceOf(Date);
    expect(await myDeviation('WOFF')).toMatchObject({ status: 'CLOSED', closureKind: 'SKIPPED', closureReason: 'AHU under shutdown', completedAt: null });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'PM_TASK_SKIPPED', targetId: entryOf.WOFF } });
    expect(audit).toMatchObject({ userId: u.exe.username, reason: 'AHU under shutdown', ipAddress: '10.0.0.9' });
    expect(audit?.signatureMeaning).toMatch(new RegExp(`^Scheduled PM for "${fx.tag}-WOFF" on .+ was NOT performed; written off with a reason at cleaning start$`));
    expect(audit?.afterValue).toMatchObject({ ahuName: `${fx.tag}-WOFF`, overdueDays: 10, skipReason: 'AHU under shutdown' });

    // Resolved: no longer pending, and My Tasks shows it as not performed.
    expect(await getPendingEarlierPmTasks(f.w1)).toEqual([]);
    const woff = rowFor((await due()).tasks, 'WOFF');
    expect(woff).toMatchObject({ overallStatus: 'not_performed', skipReason: 'AHU under shutdown' });
    // A deviation closed by write-off has no delay; its overdue days stay those at opening.
    expect(woff.deviation).toMatchObject({ status: 'CLOSED', overdueDays: 15 });
    const listed = (await call('GET', `/deviations?ahuId=${ahu.WOFF}`, 'ro')).json();
    expect(listed.data[0]).toMatchObject({ status: 'CLOSED', closureKind: 'SKIPPED', delayDays: null, liveOverdueDays: 15 });
  });

  it('without a transaction it writes through the shared client; a stale task list writes nothing', async () => {
    await scenario('WOFF2', at(-15), 5);
    const w2 = await fx.filter('w2', ahu.WOFF2);
    const pending = await getPendingEarlierPmTasks(w2);
    expect(pending).toHaveLength(1);
    await applyPmSkips([{ entryId: entryOf.WOFF2, reason: 'Plant holiday' }], pending, { userId: u.sa.username, userRole: 'SUPER_ADMIN' });
    expect(await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id: entryOf.WOFF2 } })).toMatchObject({ skipReason: 'Plant holiday', skippedBy: null });
    expect(await prisma.auditTrail.count({ where: { action: 'PM_TASK_SKIPPED', targetId: entryOf.WOFF2 } })).toBe(1);
    // Applying the same skip against an empty (already-resolved) list changes nothing.
    await applyPmSkips([{ entryId: entryOf.WOFF2, reason: 'second attempt' }], [], { userId: u.sa.username });
    expect((await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id: entryOf.WOFF2 } })).skipReason).toBe('Plant holiday');
  });
});

describe('legacy deviation rows in the sweep\'s CLOSE half', () => {
  it('a row with no recorded filters is never auto-closed; one without a windowStart is judged from its scheduled date', async () => {
    ahu.LEG1 = await fx.instance('AHU', 'LEG1', { parentId: blockId });
    ahu.LEG2 = await fx.instance('AHU', 'LEG2', { parentId: blockId });
    f.lg2 = await fx.filter('lg2', ahu.LEG2);
    // A breakdown clean: it only counts because no PM reason is configured below.
    await fx.cycle(f.lg2, u.sa.id, { status: 'COMPLETED', reason: 'BREAKDOWN', startedAt: at(-1, 2), completedAt: at(-1, 12) });
    const base = { status: 'OPEN', scheduledDate: at(-20), windowEnd: at(-15), overdueDaysAtOpen: 20 };
    const leg1 = await prisma.deviation.create({
      data: { ...base, pmScheduleEntryId: randomUUID(), ahuId: ahu.LEG1, ahuName: `${fx.tag}-LEG1`, filterIds: {}, filterCount: 0 } as any,
    });
    const leg2 = await prisma.deviation.create({
      data: { ...base, pmScheduleEntryId: randomUUID(), ahuId: ahu.LEG2, ahuName: `${fx.tag}-LEG2`, filterIds: [f.lg2], filterCount: 1, windowStart: null } as any,
    });

    cfg.missing('filter-cleaning-reasons');
    expect((await sweep()).statusCode).toBe(200);

    expect(await prisma.deviation.findUniqueOrThrow({ where: { id: leg1.id } })).toMatchObject({ status: 'OPEN', closedAt: null });
    const closed = await prisma.deviation.findUniqueOrThrow({ where: { id: leg2.id } });
    expect(closed).toMatchObject({ status: 'CLOSED', completedBy: null, completedByName: null, delayDays: 19 });
    expect(closed.completedAt?.toISOString()).toBe(at(-1, 12).toISOString());
    const note = await prisma.notification.findFirst({ where: { type: 'PM_OVERDUE_COMPLETED', metadata: { path: ['deviationId'], equals: leg2.id } } });
    expect(note?.message).toBe(`An operator completed overdue cleaning for ${fx.tag}-LEG2 filters (was overdue by 20 day(s); resolved with 19-day delay).`);
    expect(note?.forRole).toBe(notifyRole);
  });
});
