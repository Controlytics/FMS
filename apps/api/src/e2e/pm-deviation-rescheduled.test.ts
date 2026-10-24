/**
 * PM visits moved to a new date, and the window's day edges (2026-10-24).
 *
 * Operator report: "I edited a PM schedule date — the task was overdue, I moved
 * it to a future date past the tolerance days, and it still showed overdue."
 * Two causes, both covered here:
 *
 *  1. A date change never touched the open deviation, and My Tasks shows
 *     "Overdue" while one is open. Operator decisions: "Close as Rescheduled" —
 *     a visit moved to a window that has not closed closes its deviation with
 *     closureKind RESCHEDULED (never as completed) — and then "Update the same
 *     deviation": moved to a window that HAS closed, the one deviation takes the
 *     new date (reopening when it was closed as rescheduled). On the write that
 *     puts the date live and, as a backstop, in the sweep.
 *  2. Window edges were compared with the raw DATE values (UTC midnight = 05:30
 *     in India): the last day read as Overdue from 05:30, a cleaning before
 *     05:30 on the first day was not credited, and the 03:00 sweep opened every
 *     deviation a day late. Those cases run at fixed India times a few days
 *     BEFORE today, with only `Date` faked (timers stay real, so Prisma is
 *     unaffected). Never a future time: the sweep writes audit rows, and a
 *     future timestamp would sort above every other suite's newest row.
 *
 * Own users, roles, hierarchy and schedules (pm-fixtures.ts); PM config served
 * in-process.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { toDateColumnDay } from '../lib/date-range-guard.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import { getDueTasks } from '../modules/pm-schedules/pm-due-tasks.js';
import { sweepOverdueDeviations } from '../modules/pm-schedules/pm-deviations.js';
import type { RequestContext } from '../types/context.js';
import { pinTimeZone } from '../lib/__tests__/pin-time-zone.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, iso, DAY, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMR');
let app: FastifyInstance;
let cfg: ConfigOverrides;
let restoreZone: () => void;
let T: Date; // today's local calendar day, as a DATE value
const day = (offset: number) => new Date(T.getTime() + offset * DAY);
const u: Record<string, { id: string; username: string }> = {};
const tok: Record<string, string> = {};
const ahu: Record<string, string> = {};
const entryOf: Record<string, string> = {};

const call = (method: string, url: string, k: string, payload?: unknown) =>
  app.inject({
    method: method as any, url: `/api/pm-schedules${url}`,
    headers: { authorization: `Bearer ${tok[k]}` },
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });

const ctxOf = (k: string): RequestContext => ({
  userId: u[k].username, userSub: u[k].id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', sessionId: 'pmr-suite',
});

/** One AHU, one filter, one APPROVED visit. */
async function scenario(key: string, planned: Date, tol: number) {
  ahu[key] = await fx.instance('AHU', key);
  await fx.filter(`${key}-f1`, ahu[key]);
  const s = await fx.schedule(ahu[key], planned.getUTCFullYear(), u.sa.id, [{ plannedDate: planned, toleranceDays: tol }]);
  entryOf[key] = s.entryIds[0];
}
const deviationOf = (key: string) => prisma.deviation.findUnique({ where: { pmScheduleEntryId: entryOf[key] } });

/**
 * The global sweep, as this suite's Super Admin; anything it opened on rows
 * that are not ours is removed again (identified by its DEVIATION_OPENED audit
 * row, same rule as pm-schedules-due-tasks.test.ts).
 */
async function sweep(now?: Date) {
  const before = new Date(Date.now() - 1000);
  const result = now
    ? await withNow(now, () => sweepOverdueDeviations(ctxOf('sa')))
    : await sweepOverdueDeviations(ctxOf('sa'));
  const opened = await prisma.auditTrail.findMany({
    where: { action: 'DEVIATION_OPENED', userId: u.sa.username, ...(now ? {} : { timestamp: { gte: before } }) },
    select: { targetId: true },
  });
  const ids = opened.map((a) => a.targetId).filter((id): id is string => !!id);
  if (ids.length) await prisma.deviation.deleteMany({ where: { id: { in: ids }, ahuId: { notIn: Object.values(ahu) } } });
  return result;
}

/** Run `fn` with only `Date` faked to `now`. */
async function withNow<T>(now: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  try { return await fn(); } finally { vi.useRealTimers(); }
}
afterEach(() => { vi.useRealTimers(); });

beforeAll(async () => {
  restoreZone = pinTimeZone('Asia/Kolkata');
  T = toDateColumnDay(new Date());
  app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
  const notifyRole = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides(defaultPmConfig(notifyRole));
  const EDIT = await fx.role('EDIT', ['PM_READ', 'PM_EDIT_ENTRY']);
  const APR = await fx.role('APR', ['PM_READ', 'PM_APPROVE']);
  for (const [k, role] of [['sa', 'SUPER_ADMIN'], ['ed', EDIT], ['apr', APR]] as const) {
    u[k] = await fx.user(k, role);
    tok[k] = await fx.login(app, u[k].username);
  }
  // Every visit below is overdue: window T-18..T-12, nothing cleaned.
  for (const key of ['SA', 'STAGED', 'PAST', 'SWEEP', 'SAME', 'DONE']) await scenario(key, day(-15), 3);
  await sweep();
}, 60_000);

afterAll(async () => {
  cfg?.passthrough('pm-schedule-settings');
  await fx.cleanup(app);
  restoreZone?.();
});

describe("a visit's deviation follows its date", () => {
  it('the sweep opened a deviation for every overdue visit (precondition)', async () => {
    for (const key of ['SA', 'STAGED', 'PAST', 'SWEEP', 'SAME', 'DONE']) {
      expect((await deviationOf(key))?.status, key).toBe('OPEN');
    }
  });

  it("a Super Admin's change goes live at once and closes it, recorded and audited", async () => {
    // The operator's case: moved into a window that includes today (T-2..T+4).
    const res = await call('PUT', `/entries/${entryOf.SA}/edit`, 'sa', { plannedDate: iso(day(1)) });
    expect(res.statusCode, res.body).toBe(200);
    const dev = await deviationOf('SA');
    expect(dev).toMatchObject({ status: 'CLOSED', closureKind: 'RESCHEDULED', completedAt: null, delayDays: null });
    expect(dev!.closureReason).toMatch(new RegExp(`^Moved from .+ to .+ by ${u.sa.username}$`));
    // The record of the miss keeps the date that was missed.
    expect(iso(dev!.scheduledDate)).toBe(iso(day(-15)));
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_CLOSED', targetId: dev!.id }, orderBy: { chainPosition: 'desc' } });
    expect(audit?.userId).toBe(u.sa.username);
    expect(audit?.afterValue).toMatchObject({ closureKind: 'RESCHEDULED', rescheduledTo: iso(day(1)) });
  });

  it('My Tasks lists it as a current task with no "Overdue by N days" badge', async () => {
    const due = await getDueTasks(ctxOf('sa'));
    expect(due.overdue.find((r: any) => r.ahuId === ahu.SA)).toBeUndefined();
    const row = due.tasks.find((r: any) => r.ahuId === ahu.SA);
    expect(row?.overallStatus).toBe('pending');
    // my-tasks/index.tsx shows the badge for any deviation that is not CLOSED.
    expect(row?.deviation?.status).toBe('CLOSED');
    // Still overdue (not moved): listed.
    expect(due.overdue.find((r: any) => r.ahuId === ahu.SAME)).toBeDefined();
  });

  it('a staged change leaves it OPEN until the change is approved, then closes it', async () => {
    const edit = await call('PUT', `/entries/${entryOf.STAGED}/edit`, 'ed', { plannedDate: iso(day(12)) });
    expect(edit.statusCode, edit.body).toBe(200);
    expect((await deviationOf('STAGED'))?.status).toBe('OPEN'); // the visit is still owed on its old date
    const approve = await call('POST', '/entries/approve', 'apr', { entryIds: [entryOf.STAGED], comment: 'moved to the next shutdown' });
    expect(approve.statusCode, approve.body).toBe(200);
    const dev = await deviationOf('STAGED');
    expect(dev).toMatchObject({ status: 'CLOSED', closureKind: 'RESCHEDULED' });
    expect(dev!.closureReason).toMatch(new RegExp(`by ${u.apr.username}$`));
  });

  it('moved to another date whose window has also closed: stays OPEN, on the new date, overdue recounted, audited', async () => {
    const res = await call('PUT', `/entries/${entryOf.PAST}/edit`, 'sa', { plannedDate: iso(day(-8)) }); // window T-11..T-5
    expect(res.statusCode, res.body).toBe(200);
    const dev = await deviationOf('PAST');
    expect(dev).toMatchObject({ status: 'OPEN', overdueDaysAtOpen: 8 });
    expect([iso(dev!.scheduledDate), iso(dev!.windowStart!), iso(dev!.windowEnd)]).toEqual([iso(day(-8)), iso(day(-11)), iso(day(-5))]);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_UPDATED', targetId: dev!.id } });
    expect(audit?.userId).toBe(u.sa.username);
    expect(audit?.beforeValue).toMatchObject({ scheduledDate: iso(day(-15)), status: 'OPEN' });
    expect(audit?.afterValue).toMatchObject({ scheduledDate: iso(day(-8)), status: 'OPEN', overdueDaysAtOpen: 8, movedBy: u.sa.username });
  });

  // The operator's case (CWH/RDU, 2026-10-24): 8 Oct → 21 Oct (closed as
  // rescheduled) → 2 Oct, already past. The second miss could not be recorded:
  // the sweep raised DEVIATION_OPEN_BLOCKED every day.
  it('a rescheduled visit moved back to a date already past REOPENS the same deviation at once, on that date', async () => {
    const before = await deviationOf('SA'); // closed as rescheduled by the first test
    expect(before).toMatchObject({ status: 'CLOSED', closureKind: 'RESCHEDULED' });
    const res = await call('PUT', `/entries/${entryOf.SA}/edit`, 'sa', { plannedDate: iso(day(-6)) }); // window T-9..T-3
    expect(res.statusCode, res.body).toBe(200);
    const dev = await deviationOf('SA');
    expect(dev).toMatchObject({ id: before!.id, deviationNumber: before!.deviationNumber, status: 'OPEN', closureKind: null, closureReason: null, closedAt: null, overdueDaysAtOpen: 6 });
    expect(iso(dev!.scheduledDate)).toBe(iso(day(-6)));
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_UPDATED', targetId: dev!.id }, orderBy: { chainPosition: 'desc' } });
    expect(audit?.beforeValue).toMatchObject({ status: 'CLOSED', closureKind: 'RESCHEDULED', scheduledDate: iso(day(-15)) });
    expect(audit?.afterValue).toMatchObject({ status: 'OPEN', scheduledDate: iso(day(-6)) });
    // The overdue roles are told again, and My Tasks shows it overdue.
    expect(await prisma.notification.count({ where: { type: 'PM_OVERDUE', metadata: { path: ['deviationId'], equals: dev!.id } } })).toBe(2);
    const due = await getDueTasks(ctxOf('sa'));
    expect(due.overdue.find((r: any) => r.ahuId === ahu.SA)?.deviation).toMatchObject({ status: 'OPEN', overdueDays: 6 });
  });

  it('a rescheduled deviation moved again to a date still ahead keeps its one note, on the latest date', async () => {
    const res = await call('PUT', `/entries/${entryOf.STAGED}/edit`, 'sa', { plannedDate: iso(day(14)) });
    expect(res.statusCode, res.body).toBe(200);
    const dev = await deviationOf('STAGED');
    expect(dev).toMatchObject({ status: 'CLOSED', closureKind: 'RESCHEDULED' });
    expect(dev!.closureReason).toMatch(new RegExp(` by ${u.sa.username}$`));
    expect(iso(dev!.scheduledDate)).toBe(iso(day(-15))); // still the date that was missed
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_UPDATED', targetId: dev!.id } });
    expect(audit?.afterValue).toMatchObject({ rescheduledTo: iso(day(14)) });
  });

  it('a deviation closed because the PM was DONE is never reopened by a date change', async () => {
    const filterId = (await prisma.assetInstance.findFirst({ where: { parentId: ahu.DONE } }))!.id;
    await fx.cycle(filterId, u.sa.id, { status: 'COMPLETED', startedAt: new Date(Date.now() - 3_600_000), completedAt: new Date(Date.now() - 1_800_000) });
    await sweep();
    const done = await deviationOf('DONE');
    expect(done).toMatchObject({ status: 'CLOSED', closureKind: null });
    expect(done!.completedAt).not.toBeNull();
    const res = await call('PUT', `/entries/${entryOf.DONE}/edit`, 'sa', { plannedDate: iso(day(-7)) });
    expect(res.statusCode, res.body).toBe(200);
    const after = await deviationOf('DONE');
    expect(after).toMatchObject({ status: 'CLOSED', closureKind: null, scheduledDate: done!.scheduledDate });
    expect(await prisma.auditTrail.count({ where: { action: 'DEVIATION_UPDATED', targetId: done!.id } })).toBe(0);
  });

  it('the sweep closes one whose date was changed by another door, and leaves an unchanged one open', async () => {
    await prisma.pmScheduleEntry.update({
      where: { id: entryOf.SWEEP },
      data: { plannedDate: day(20), windowStart: day(17), windowEnd: day(23) },
    });
    await sweep();
    const moved = await deviationOf('SWEEP');
    expect(moved).toMatchObject({ status: 'CLOSED', closureKind: 'RESCHEDULED' });
    expect(moved!.closureReason).toMatch(/^Moved from .+ to .+$/);
    expect(moved!.closureReason).not.toMatch(/ by /); // the sweep does not know who moved it
    expect((await deviationOf('SAME'))?.status).toBe('OPEN');
    expect((await deviationOf('PAST'))?.status).toBe('OPEN');
  });

  it('when the NEW date is missed too, the sweep reopens the same deviation on that date — no blocked alarm', async () => {
    // The rescheduled visit's new window has now closed as well (changed by
    // another door, so only the sweep sees it).
    await prisma.pmScheduleEntry.update({
      where: { id: entryOf.SWEEP },
      data: { plannedDate: day(-4), windowStart: day(-7), windowEnd: day(-1) },
    });
    const r = await sweep();
    expect(r.opened).toBeGreaterThanOrEqual(1);
    const dev = await deviationOf('SWEEP');
    expect(dev).toMatchObject({ status: 'OPEN', closureKind: null, overdueDaysAtOpen: 4 });
    expect(iso(dev!.scheduledDate)).toBe(iso(day(-4)));
    expect(await prisma.auditTrail.count({ where: { action: 'DEVIATION_OPEN_BLOCKED', targetId: dev!.id } })).toBe(0);
    expect(await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_UPDATED', targetId: dev!.id } })).toMatchObject({ userRole: 'SUPER_ADMIN' });
    // Idempotent: a second sweep changes nothing.
    await sweep();
    expect(await prisma.auditTrail.count({ where: { action: 'DEVIATION_UPDATED', targetId: dev!.id } })).toBe(1);
  });
});

describe('window edges are whole local days (Asia/Kolkata)', () => {
  // Window T-6..T-2 (planned T-4 ± 2). `ist(offset, h)` = that local day at h:m
  // in India, whose midnight is 18:30 UTC the day before.
  const ist = (offset: number, h: number, m = 0) => new Date(day(offset).getTime() + (h * 60 + m) * 60_000 - 330 * 60_000);
  const row = (due: any, key: string) =>
    [...due.tasks, ...due.overdue].find((r: any) => r.ahuId === ahu[key]);

  beforeAll(async () => {
    await scenario('EDGE', day(-4), 2);
    await scenario('CREDIT', day(-4), 2);
    const filterId = (await prisma.assetInstance.findFirst({ where: { parentId: ahu.CREDIT } }))!.id;
    // A PM cleaning finished at 01:00 on the window's first day.
    await fx.cycle(filterId, u.sa.id, { status: 'COMPLETED', startedAt: ist(-6, 0, 20), completedAt: ist(-6, 1) });
  });

  it('15:00 on the last day is still inside the window (was Overdue from 05:30)', async () => {
    const due = await withNow(ist(-2, 15), () => getDueTasks(ctxOf('sa')));
    expect(row(due, 'EDGE')?.overallStatus).toBe('pending');
    expect(due.overdue.find((r: any) => r.ahuId === ahu.EDGE)).toBeUndefined();
  });

  it('00:30 the next day the visit is overdue', async () => {
    const due = await withNow(ist(-1, 0, 30), () => getDueTasks(ctxOf('sa')));
    expect(due.overdue.find((r: any) => r.ahuId === ahu.EDGE)?.overallStatus).toBe('overdue');
  });

  it('02:00 on the first day the visit is already listed (was hidden until 05:30)', async () => {
    const due = await withNow(ist(-6, 2), () => getDueTasks(ctxOf('sa')));
    expect(row(due, 'EDGE')?.overallStatus).toBe('pending');
  });

  it('a cleaning finished at 01:00 on the first day counts for the visit', async () => {
    const due = await withNow(ist(-4, 12), () => getDueTasks(ctxOf('sa')));
    expect(row(due, 'CREDIT')?.overallStatus).toBe('complete');
  });

  it('the 03:00 sweep the day after the window opens the deviation (was a day late), counting calendar days', async () => {
    await sweep(ist(-1, 3));
    const dev = await deviationOf('EDGE');
    expect(dev?.status).toBe('OPEN');
    expect(dev?.overdueDaysAtOpen).toBe(3); // (T-1) − (T-4)
    expect(await deviationOf('CREDIT')).toBeNull(); // cleaned in its window: no deviation
  });
});
