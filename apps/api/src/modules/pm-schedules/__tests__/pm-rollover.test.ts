import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    pmSchedule: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    pmScheduleEntry: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('../pm-shared.js', () => ({ checkPmEnabled: vi.fn(async () => {}) }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../pm-workflow.js', () => ({ getPmWorkflowConfig: vi.fn() }));

import { rolloverSeries } from '../pm-rollover.js';
import { prisma } from '../../../lib/prisma.js';
import { getPmWorkflowConfig } from '../pm-workflow.js';
import { auditLog } from '../../../lib/audit.js';

const P = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: any) => new Date(x).toISOString().slice(0, 10);

/** A schedule row of a monthly series anchored 2026-09-15. */
function seriesRow(over: Partial<any> = {}) {
  return {
    id: 'sched-2027', entityId: 'ahu-1', year: 2027, status: 'ACTIVE',
    createdBy: 'user-1', frequencyDays: 30, anchorDate: d('2026-09-15'),
    seriesId: 'series-A',
    entries: [
      {
        id: 'e-dec', month: 12, plannedDate: d('2027-12-15'), toleranceDays: 3,
        approvalStatus: 'APPROVED', approvedBy: 'u', approvedByName: 'admin', approvedAt: d('2026-09-01'),
        skippedAt: null, lateReason: null,
      },
    ],
    ...over,
  };
}

let createdEntries: any[];
let createdSchedules: any[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Move the clock into 2027 so the horizon becomes 31 Dec 2028 and the series
  // (materialised only to Dec 2027) has room to grow.
  vi.setSystemTime(new Date('2027-06-01T06:00:00Z'));

  createdEntries = [];
  createdSchedules = [];

  P.pmSchedule.findMany.mockResolvedValue([seriesRow()]);
  P.pmSchedule.findFirst.mockResolvedValue(null);
  P.pmSchedule.create.mockImplementation(async (a: any) => {
    createdSchedules.push(a.data);
    return { id: `sched-${a.data.year}`, ...a.data };
  });
  P.pmScheduleEntry.findFirst.mockResolvedValue(null);
  P.pmScheduleEntry.create.mockImplementation(async (a: any) => {
    createdEntries.push(a.data);
    return { id: `entry-${createdEntries.length}` };
  });
  (getPmWorkflowConfig as any).mockResolvedValue({ workflowEnabled: false });
});

afterEach(() => vi.useRealTimers());

describe('rolloverSeries — extending to the horizon', () => {
  it('creates the next year schedule row and its entries', async () => {
    const r = await rolloverSeries();

    expect(r.seriesChecked).toBe(1);
    // Jan..Dec 2028 = 12 new occurrences beyond the existing Dec-2027 entry.
    expect(r.entriesCreated).toBe(12);
    expect(r.schedulesCreated).toBe(1);
    expect(createdSchedules[0]).toMatchObject({
      entityId: 'ahu-1', year: 2028, status: 'ACTIVE', frequencyDays: 30, seriesId: 'series-A',
    });
  });

  it('keeps the anchor day-of-month on the extended entries', async () => {
    await rolloverSeries();
    const dates = createdEntries.map((e) => iso(e.plannedDate)).sort();
    expect(dates[0]).toBe('2028-01-15');
    expect(dates[dates.length - 1]).toBe('2028-12-15');
    expect(dates.every((x) => x.endsWith('-15'))).toBe(true);
  });

  it('carries the series tolerance forward', async () => {
    await rolloverSeries();
    expect(createdEntries.every((e) => e.toleranceDays === 3)).toBe(true);
  });

  it('is a no-op once the series already reaches the horizon', async () => {
    P.pmSchedule.findMany.mockResolvedValue([
      seriesRow({
        year: 2028, id: 'sched-2028',
        entries: [{
          id: 'e', month: 12, plannedDate: d('2028-12-15'), toleranceDays: 3,
          approvalStatus: 'APPROVED', skippedAt: null, lateReason: null,
        }],
      }),
    ]);
    const r = await rolloverSeries();
    expect(r.entriesCreated).toBe(0);
    expect(P.pmScheduleEntry.create).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled(); // nothing happened → nothing audited
  });
});

describe('rolloverSeries — idempotency', () => {
  it('skips a month that already exists on the target schedule', async () => {
    // Simulate a concurrent run having created Jan 2028 already.
    P.pmScheduleEntry.findFirst.mockImplementation(async (a: any) =>
      a.where.month === 1 ? { id: 'already-there' } : null,
    );
    const r = await rolloverSeries();
    expect(r.entriesCreated).toBe(11); // 12 minus the pre-existing January
    expect(createdEntries.some((e) => e.month === 1)).toBe(false);
  });

  it('reuses an existing schedule row of the SAME series instead of creating one', async () => {
    P.pmSchedule.findFirst.mockResolvedValue({ id: 'sched-2028-existing', seriesId: 'series-A' });
    const r = await rolloverSeries();
    expect(r.schedulesCreated).toBe(0);
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
    expect(createdEntries.every((e) => e.scheduleId === 'sched-2028-existing')).toBe(true);
  });
});

describe('rolloverSeries — never clobbers another schedule', () => {
  it('leaves a year owned by a DIFFERENT series untouched', async () => {
    P.pmSchedule.findFirst.mockResolvedValue({ id: 'other-sched', seriesId: 'series-B' });

    const r = await rolloverSeries();

    expect(r.entriesCreated).toBe(0);
    expect(P.pmScheduleEntry.create).not.toHaveBeenCalled();
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
    expect(r.skippedYears[0]).toMatchObject({ entityId: 'ahu-1', year: 2028 });
    expect(r.skippedYears[0].reason).toMatch(/different active PM schedule/);
  });
});

describe('rolloverSeries — approval treatment', () => {
  it('inherits the latest entry status when the workflow is OFF', async () => {
    await rolloverSeries();
    expect(createdEntries.every((e) => e.approvalStatus === 'APPROVED')).toBe(true);
    expect(createdEntries[0].approvedByName).toBe('admin');
  });

  it('forces PENDING_REVIEW when the workflow is ON', async () => {
    (getPmWorkflowConfig as any).mockResolvedValue({ workflowEnabled: true });
    await rolloverSeries();
    expect(createdEntries.every((e) => e.approvalStatus === 'PENDING_REVIEW')).toBe(true);
    // Must not carry an approval across — these have not been approved.
    expect(createdEntries.every((e) => e.approvedByName === undefined)).toBe(true);
  });
});

describe('rolloverSeries — refuses to guess', () => {
  it('skips a series row with no anchorDate rather than inventing one', async () => {
    P.pmSchedule.findMany.mockResolvedValue([seriesRow({ anchorDate: null })]);
    const r = await rolloverSeries();
    expect(r.entriesCreated).toBe(0);
    expect(r.skippedYears[0].reason).toMatch(/no anchorDate/);
  });

  it('skips a series with no entries to continue from', async () => {
    P.pmSchedule.findMany.mockResolvedValue([seriesRow({ entries: [] })]);
    const r = await rolloverSeries();
    expect(r.entriesCreated).toBe(0);
    expect(r.skippedYears[0].reason).toMatch(/no entries/);
  });

  it('only looks at ACTIVE recurring schedules', async () => {
    await rolloverSeries();
    expect(P.pmSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          frequencyDays: { not: null },
          seriesId: { not: null },
        }),
      }),
    );
  });
});
