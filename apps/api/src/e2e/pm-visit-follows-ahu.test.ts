/**
 * A PM visit's filters follow the AHU (operator rule 2026-10-26, settlePmVisits
 * in pm-shared.ts) — the same answer from My Tasks, the missed-PM gate and the
 * overdue sweep:
 *  - a finished visit is frozen: a filter added afterwards does not reopen it;
 *  - an overdue visit takes no filter added after its window closed;
 *  - an unfinished, open visit takes one;
 *  - a replacement takes the old filter's place, and the old filter's PM
 *    cleaning still counts for that place;
 *  - a visit left with no filters of its own is never done: it is asked about
 *    and closes only by a written-off reason.
 * Each test failed before the rule (every filter of the AHU today counted, so an
 * added filter reopened finished visits and a replaced one undid a cleaning).
 *
 * Real Prisma on digilog_test_db; PM config is served in-process (pm-fixtures).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import { getDueTasks } from '../modules/pm-schedules/pm-due-tasks.js';
import { getPendingEarlierPmTasks } from '../modules/pm-schedules/pm-pending-tasks.js';
import { sweepOverdueDeviations } from '../modules/pm-schedules/pm-deviations.js';
import { FilterOperationsService } from '../modules/filter-operations/filter-operations.service.js';
import type { RequestContext } from '../types/context.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, utcDay, DAY,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMQ');
const T = utcDay(0);
const at = (d: number, h = 0) => new Date(T.getTime() + d * DAY + h * 3_600_000);
let app: FastifyInstance;
let blockId = '';
let sa: { id: string; username: string };
const ourAhus: string[] = [];

const ctx = (): RequestContext => ({ userId: sa.username, userSub: sa.id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', sessionId: 'pmq-suite' });

async function ahu(name: string) {
  const id = await fx.instance('AHU', name, { parentId: blockId });
  ourAhus.push(id);
  return id;
}
const clean = (filterId: string, completedAt: Date) =>
  fx.cycle(filterId, sa.id, { status: 'COMPLETED', startedAt: new Date(completedAt.getTime() - 3_600_000), completedAt });
async function myTask(entryId: string) {
  const due = await getDueTasks(ctx());
  return [...due.tasks, ...due.overdue].find((r: any) => r.entryId === entryId) as any;
}
/** Replace a filter from the Filters page; the new filter is registered for cleanup. */
async function replace(filterId: string) {
  const r = await new FilterOperationsService().replace(ctx(), filterId, 'media torn') as any;
  fx.instanceIds.push(r.newFilterId);
  fx.filterIds.push(r.newFilterId);
  return r.newFilterId as string;
}
/** The global sweep; deviations it opened on rows that are not ours are removed again. */
async function sweep() {
  const before = new Date(Date.now() - 1000);
  const result = await sweepOverdueDeviations(ctx());
  const opened = await prisma.auditTrail.findMany({
    where: { action: 'DEVIATION_OPENED', userId: sa.username, timestamp: { gte: before } },
    select: { targetId: true },
  });
  const ids = opened.map((a) => a.targetId).filter((id): id is string => !!id);
  if (ids.length) await prisma.deviation.deleteMany({ where: { id: { in: ids }, ahuId: { notIn: ourAhus } } });
  return result;
}

beforeAll(async () => {
  app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
  const note = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  installConfigOverrides(defaultPmConfig(note));
  sa = await fx.user('sa', 'SUPER_ADMIN');
  blockId = await fx.instance('BLOCK', 'BLOCK');
}, 120_000);

afterAll(async () => { await fx.cleanup(app); }, 120_000);

describe('a finished visit is frozen', () => {
  it('an overdue visit finished in its window stays finished when a filter is added: not asked about, complete in My Tasks', async () => {
    const a = await ahu('FIN');
    const f1 = await fx.filter('fin-1', a);
    const f2 = await fx.filter('fin-2', a);
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    await clean(f1, at(-13));
    await clean(f2, at(-12));
    const f3 = await fx.filter('fin-3', a, { installedAt: new Date() });
    expect(await getPendingEarlierPmTasks(f3)).toEqual([]);
    expect(await myTask(s.entryIds[0])).toMatchObject({ overallStatus: 'complete', totalFilters: 2, cleanedCount: 2 });
  });

  it('an open visit finished today stays finished when a filter is added', async () => {
    const a = await ahu('FINOPEN');
    const f1 = await fx.filter('fo-1', a);
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(0), toleranceDays: 5 }]);
    await clean(f1, new Date(Date.now() - 60_000));
    await fx.filter('fo-2', a, { installedAt: new Date() });
    expect(await myTask(s.entryIds[0])).toMatchObject({ overallStatus: 'complete', totalFilters: 1, cleanedCount: 1 });
  });
});

describe('an overdue visit takes no new filter; an open one does', () => {
  it('overdue: a filter added after the window closed is not required; the late clean of the last original filter completes it', async () => {
    const a = await ahu('OVD');
    const f1 = await fx.filter('ovd-1', a);
    const f2 = await fx.filter('ovd-2', a);
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    await clean(f1, at(-13));
    const f3 = await fx.filter('ovd-3', a, { installedAt: new Date() });
    expect((await getPendingEarlierPmTasks(f3)).map((p) => p.entryId)).toEqual([s.entryIds[0]]);
    expect(await myTask(s.entryIds[0])).toMatchObject({ overallStatus: 'overdue', totalFilters: 2, cleanedCount: 1 });
    await clean(f2, at(-1));
    expect(await getPendingEarlierPmTasks(f3)).toEqual([]);
    expect(await myTask(s.entryIds[0])).toMatchObject({ overallStatus: 'complete', totalFilters: 2 });
  });

  it('open and not finished: a filter added now joins the visit', async () => {
    const a = await ahu('OPEN');
    const f1 = await fx.filter('op-1', a);
    await fx.filter('op-2', a);
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(0), toleranceDays: 5 }]);
    await clean(f1, at(-1));
    await fx.filter('op-3', a, { installedAt: new Date() });
    const t = await myTask(s.entryIds[0]);
    expect(t).toMatchObject({ totalFilters: 3, cleanedCount: 1 });
    expect(t.overallStatus).not.toBe('complete');
  });
});

describe('a replacement takes the old filter\'s place', () => {
  it('a filter PM-cleaned and then replaced keeps that cleaning for its place', async () => {
    const a = await ahu('REPL');
    const f1 = await fx.filter('rp-1', a);
    await fx.filter('rp-2', a);
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(0), toleranceDays: 5 }]);
    await clean(f1, at(-1));
    const f1New = await replace(f1);
    const t = await myTask(s.entryIds[0]);
    expect(t).toMatchObject({ totalFilters: 2, cleanedCount: 1 });
    expect(t.filters.find((f: any) => f.filterId === f1New)).toMatchObject({ status: 'cleaned_in_window' });
  });

  it('the sweep closes the deviation once the visit is done, although one of the filters it opened for was replaced since', async () => {
    const a = await ahu('DEVREP');
    const f1 = await fx.filter('dr-1', a);
    const f2 = await fx.filter('dr-2', a);
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    await sweep();
    const opened = await prisma.deviation.findUnique({ where: { pmScheduleEntryId: s.entryIds[0] } });
    expect(opened).toMatchObject({ status: 'OPEN', filterCount: 2 });
    expect([...(opened!.filterIds as string[])].sort()).toEqual([f1, f2].sort());

    await clean(f1, at(-2, 10));
    const f2New = await replace(f2);
    await clean(f2New, at(-1, 10));
    await sweep();
    const closed = await prisma.deviation.findUnique({ where: { pmScheduleEntryId: s.entryIds[0] } });
    expect(closed).toMatchObject({ status: 'CLOSED' });
    expect(closed!.completedAt?.toISOString()).toBe(at(-1, 10).toISOString());
  });
});

describe('a visit left with no filters of its own', () => {
  it('is never done: it is asked about (a written-off reason is its only close), and My Tasks shows it overdue with 0 filters', async () => {
    const a = await ahu('EMPTY');
    const s = await fx.schedule(a, 2026, sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    const f = await fx.filter('em-1', a, { installedAt: new Date() });
    await clean(f, at(-1));
    expect((await getPendingEarlierPmTasks(f)).map((p) => p.entryId)).toEqual([s.entryIds[0]]);
    expect(await myTask(s.entryIds[0])).toMatchObject({ overallStatus: 'overdue', totalFilters: 0 });
  });
});
