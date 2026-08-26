import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    pmSchedule: { findMany: vi.fn(), update: vi.fn() },
    pmScheduleEntry: { deleteMany: vi.fn() },
    pmExecution: { findMany: vi.fn() },
    deviation: { findMany: vi.fn() },
  },
}));

import { supersedePreviousSeries } from '../pm-supersede.js';
import { prisma } from '../../../lib/prisma.js';

const P = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const entry = (over: Partial<any> = {}) => ({
  id: 'e1', month: 6, plannedDate: d('2029-06-15'),
  skippedAt: null, lateReason: null, ...over,
});

const staleSchedule = (entries: any[], over: Partial<any> = {}) => ({
  id: 'old-sched', entityId: 'ahu-1', year: 2029, status: 'ACTIVE',
  seriesId: 'series-OLD', frequencyDays: 30, entries, ...over,
});

let deleted: string[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-26T06:00:00Z'));

  deleted = [];
  P.pmSchedule.findMany.mockResolvedValue([]);
  P.pmSchedule.update.mockResolvedValue({});
  P.pmExecution.findMany.mockResolvedValue([]);
  P.deviation.findMany.mockResolvedValue([]);
  P.pmScheduleEntry.deleteMany.mockImplementation(async (a: any) => {
    deleted.push(...a.where.id.in);
    return { count: a.where.id.in.length };
  });
});

afterEach(() => vi.useRealTimers());

describe('supersedePreviousSeries — scope of the sweep', () => {
  it('does nothing when there is no previous series', async () => {
    const r = await supersedePreviousSeries('ahu-1', [2026, 2027], 'series-NEW');
    expect(r).toEqual({ entriesDeleted: 0, schedulesArchived: 0, retained: [] });
    expect(P.pmScheduleEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('only targets ACTIVE RECURRING schedules outside the kept years, excluding the new series', async () => {
    await supersedePreviousSeries('ahu-1', [2026, 2027], 'series-NEW');
    expect(P.pmSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityId: 'ahu-1',
          status: 'ACTIVE',
          year: { notIn: [2026, 2027] },
          seriesId: { not: 'series-NEW' },
          frequencyDays: { not: null },
        }),
      }),
    );
  });

  it('never touches a ONE-OFF schedule in another year', async () => {
    // Enforced by `frequencyDays: { not: null }` — a one-off schedule was
    // created on its own terms and is not part of any series.
    await supersedePreviousSeries('ahu-1', [2026], null);
    const where = P.pmSchedule.findMany.mock.calls[0][0].where;
    expect(where.frequencyDays).toEqual({ not: null });
    // With no new seriesId, "any series but this one" degrades to "any series".
    expect(where.seriesId).toEqual({ not: null });
  });
});

describe('supersedePreviousSeries — what gets removed', () => {
  it('deletes a future unexecuted entry and archives the emptied schedule', async () => {
    P.pmSchedule.findMany.mockResolvedValue([staleSchedule([entry()])]);

    const r = await supersedePreviousSeries('ahu-1', [2026, 2027], 'series-NEW');

    expect(r.entriesDeleted).toBe(1);
    expect(deleted).toEqual(['e1']);
    expect(r.schedulesArchived).toBe(1);
    expect(P.pmSchedule.update).toHaveBeenCalledWith({ where: { id: 'old-sched' }, data: { status: 'ARCHIVED' } });
  });
});

describe('supersedePreviousSeries — what is retained as evidence', () => {
  it('keeps an entry already in the past', async () => {
    P.pmSchedule.findMany.mockResolvedValue([
      staleSchedule([entry({ id: 'past', plannedDate: d('2026-01-10') })], { year: 2026 }),
    ]);
    const r = await supersedePreviousSeries('ahu-1', [2027], 'series-NEW');
    expect(r.entriesDeleted).toBe(0);
    expect(r.retained[0].reason).toMatch(/already in the past/);
    // Still holds a row → must stay ACTIVE so it keeps rendering.
    expect(r.schedulesArchived).toBe(0);
    expect(P.pmSchedule.update).not.toHaveBeenCalled();
  });

  it('keeps an entry with a recorded PM execution', async () => {
    P.pmSchedule.findMany.mockResolvedValue([staleSchedule([entry({ id: 'executed' })])]);
    P.pmExecution.findMany.mockResolvedValue([{ scheduleEntryId: 'executed' }]);

    const r = await supersedePreviousSeries('ahu-1', [2026], 'series-NEW');
    expect(r.entriesDeleted).toBe(0);
    expect(r.retained[0].reason).toMatch(/recorded PM execution/);
  });

  it('keeps an entry with a deviation record', async () => {
    P.pmSchedule.findMany.mockResolvedValue([staleSchedule([entry({ id: 'deviated' })])]);
    P.deviation.findMany.mockResolvedValue([{ pmScheduleEntryId: 'deviated' }]);

    const r = await supersedePreviousSeries('ahu-1', [2026], 'series-NEW');
    expect(r.entriesDeleted).toBe(0);
    expect(r.retained[0].reason).toMatch(/deviation record/);
  });

  it('keeps an entry skipped with a justification', async () => {
    P.pmSchedule.findMany.mockResolvedValue([
      staleSchedule([entry({ id: 'skipped', skippedAt: d('2026-07-01') })]),
    ]);
    const r = await supersedePreviousSeries('ahu-1', [2026], 'series-NEW');
    expect(r.entriesDeleted).toBe(0);
    expect(r.retained[0].reason).toMatch(/skipped with a recorded justification/);
  });

  it('keeps an entry completed late with a justification', async () => {
    P.pmSchedule.findMany.mockResolvedValue([
      staleSchedule([entry({ id: 'late', lateReason: 'line was running' })]),
    ]);
    const r = await supersedePreviousSeries('ahu-1', [2026], 'series-NEW');
    expect(r.entriesDeleted).toBe(0);
    expect(r.retained[0].reason).toMatch(/completed late/);
  });

  it('deletes only the removable rows in a mixed schedule and leaves it ACTIVE', async () => {
    P.pmSchedule.findMany.mockResolvedValue([
      staleSchedule([
        entry({ id: 'keep-executed', month: 3 }),
        entry({ id: 'drop-1', month: 6 }),
        entry({ id: 'drop-2', month: 9 }),
      ]),
    ]);
    P.pmExecution.findMany.mockResolvedValue([{ scheduleEntryId: 'keep-executed' }]);

    const r = await supersedePreviousSeries('ahu-1', [2026], 'series-NEW');

    expect(r.entriesDeleted).toBe(2);
    expect(deleted.sort()).toEqual(['drop-1', 'drop-2']);
    expect(r.retained).toHaveLength(1);
    // Evidence survives → the schedule must NOT be archived out of view.
    expect(r.schedulesArchived).toBe(0);
    expect(P.pmSchedule.update).not.toHaveBeenCalled();
  });
});
