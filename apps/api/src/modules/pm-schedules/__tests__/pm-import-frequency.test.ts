import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (same shape as pm-import-guards.test.ts) ──────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn() },
    assetInstance: { findMany: vi.fn() },
    pmSchedule: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pmScheduleEntry: { count: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    pmExecution: { count: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../pm-shared.js', () => ({ checkPmEnabled: vi.fn(async () => {}) }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../pm-workflow.js', () => ({
  getPmWorkflowConfig: vi.fn(),
  assertPmRole: vi.fn(),
  generateQnn: vi.fn(async () => 'QN-2026-000001'),
}));

import { importSchedules, getTemplateCsv } from '../pm-import.js';
import { prisma } from '../../../lib/prisma.js';
import { getPmWorkflowConfig } from '../pm-workflow.js';

const P = prisma as any;
const ctx = { userId: 'tester', userSub: 'user-1', userRole: 'ADMIN', ipAddress: '::1', userAgent: 'vitest' } as any;

/** Every created entry, captured across all per-schedule transactions. */
let createdEntries: any[];
/** Every pmSchedule.create payload, in creation order. */
let createdSchedules: any[];

beforeEach(() => {
  vi.clearAllMocks();
  // The materialisation horizon is "31 Dec of NEXT calendar year", derived from
  // the wall clock — freeze it so occurrence counts are deterministic forever.
  // Only Date is faked; faking timers wholesale would stall the async paths.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-26T06:00:00Z'));

  createdEntries = [];
  createdSchedules = [];

  P.systemConfig.findUnique.mockResolvedValue({ configValue: {} });
  P.assetInstance.findMany.mockResolvedValue([{ id: 'ahu-1', name: 'AHU-01' }]);
  // No existing schedule — every bucket takes the create path.
  P.pmSchedule.findFirst.mockResolvedValue(null);
  P.pmSchedule.create.mockImplementation(async (args: any) => {
    createdSchedules.push(args.data);
    return { id: `sched-${args.data.year}` };
  });
  P.pmSchedule.update.mockResolvedValue({ id: 'sched-x' });
  P.pmExecution.count.mockResolvedValue(0);
  P.pmScheduleEntry.count.mockResolvedValue(0);
  P.pmScheduleEntry.createMany.mockImplementation(async (args: any) => {
    createdEntries.push(...args.data);
    return { count: args.data.length };
  });
  P.pmScheduleEntry.deleteMany.mockResolvedValue({ count: 0 });
  // Read-back for the per-entry report: echo whatever was just created.
  P.pmScheduleEntry.findMany.mockImplementation(async (args: any) =>
    createdEntries
      .filter((e) => e.scheduleId === args.where.scheduleId)
      .map((e) => ({ id: `entry-${e.scheduleId}-${e.month}`, month: e.month })),
  );
  P.$transaction.mockImplementation(async (fn: any) => fn(P));
  (getPmWorkflowConfig as any).mockResolvedValue({ workflowEnabled: false });
});

afterEach(() => {
  vi.useRealTimers();
});

const iso = (d: any) => new Date(d).toISOString().slice(0, 10);

describe('getTemplateCsv', () => {
  it('exposes frequency_days as a fourth column', () => {
    expect(getTemplateCsv()).toBe('ahu_name,scheduled_date,tolerance_days,frequency_days\n');
  });
});

describe('importSchedules — no frequency (legacy behaviour preserved)', () => {
  it('creates exactly one entry and no series metadata', async () => {
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3' },
    ]);

    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(0);
    expect(createdEntries).toHaveLength(1);
    expect(iso(createdEntries[0].plannedDate)).toBe('2026-09-15');
    expect(createdSchedules).toHaveLength(1);
    expect(createdSchedules[0].frequencyDays).toBeNull();
    expect(createdSchedules[0].anchorDate).toBeNull();
    expect(createdSchedules[0].seriesId).toBeNull();
  });
});

describe('importSchedules — monthly series (frequency 30)', () => {
  it('expands one row into the whole series through the horizon', async () => {
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);

    // Sep-Dec 2026 (4) + all of 2027 (12) = 16, horizon being 31 Dec 2027.
    expect(createdEntries).toHaveLength(16);
    expect(r.imported).toBe(16);
    expect(r.skipped).toBe(0);
  });

  it('holds the same day-of-month across the year boundary', async () => {
    await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);
    const dates = createdEntries.map((e) => iso(e.plannedDate)).sort();
    expect(dates.slice(0, 5)).toEqual([
      '2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15',
    ]);
    expect(dates.every((d) => d.endsWith('-15'))).toBe(true);
  });

  it('writes ONE PmSchedule per calendar year, sharing one seriesId', async () => {
    await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);

    expect(createdSchedules).toHaveLength(2);
    expect(createdSchedules.map((s) => s.year).sort()).toEqual([2026, 2027]);

    const seriesIds = new Set(createdSchedules.map((s) => s.seriesId));
    expect(seriesIds.size).toBe(1);
    expect([...seriesIds][0]).toMatch(/^[0-9a-f-]{36}$/);

    for (const s of createdSchedules) {
      expect(s.frequencyDays).toBe(30);
      expect(iso(s.anchorDate)).toBe('2026-09-15');
    }
  });

  it('never puts two entries in the same month of the same schedule', async () => {
    await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);
    // @@unique([scheduleId, month]) survives only if this holds.
    const keys = createdEntries.map((e) => `${e.scheduleId}::${e.month}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reports one imported record per entry, with distinct dates', async () => {
    // The upload UI widens its date filter from these values; reporting only
    // the anchor would hide every later occurrence behind the filter.
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);
    const dates = r.details.imported.map((i) => i.plannedDate);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates[0]).toBe('2026-09-15');
    expect(dates[dates.length - 1]).toBe('2027-12-15');
    expect(r.details.imported.every((i) => i.row === 2)).toBe(true);
    expect(r.details.imported.every((i) => i.frequencyDays === 30)).toBe(true);
  });

  it('carries the tolerance onto every generated window', async () => {
    await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '4', frequency_days: '30' },
    ]);
    const first = createdEntries.find((e) => iso(e.plannedDate) === '2026-09-15');
    expect(first.toleranceDays).toBe(4);
    expect(iso(first.windowStart)).toBe('2026-09-11');
    expect(iso(first.windowEnd)).toBe('2026-09-19');
  });
});

describe('importSchedules — quarterly series (frequency 90)', () => {
  it('advances three months at a time on the same date', async () => {
    await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '5', frequency_days: '90' },
    ]);
    expect(createdEntries.map((e) => iso(e.plannedDate)).sort()).toEqual([
      '2026-09-15', '2026-12-15', '2027-03-15', '2027-06-15', '2027-09-15', '2027-12-15',
    ]);
  });
});

describe('importSchedules — frequency validation', () => {
  const badRow = (freq: string, tol = '3') => ({
    ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: tol, frequency_days: freq,
  });

  it('refuses a non-multiple of 30 and writes nothing', async () => {
    const r = await importSchedules(ctx, [badRow('45')]);
    expect(r.imported).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.details.skipped[0].reason).toMatch(/multiple of 30/i);
    expect(P.pmScheduleEntry.createMany).not.toHaveBeenCalled();
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
  });

  it('refuses anything below the 30-day minimum', async () => {
    const r = await importSchedules(ctx, [badRow('15')]);
    expect(r.imported).toBe(0);
    expect(r.details.skipped[0].reason).toMatch(/at least 30 days/i);
  });

  it('refuses a tolerance that would overlap consecutive windows', async () => {
    // 14-day tolerance at frequency 30: windows touch on the Feb occurrence,
    // where the real gap is 28 days, not 30.
    const r = await importSchedules(ctx, [badRow('30', '14')]);
    expect(r.imported).toBe(0);
    expect(r.details.skipped[0].reason).toMatch(/overlap|windows would overlap/i);
  });

  it('refuses non-numeric input', async () => {
    const r = await importSchedules(ctx, [badRow('monthly')]);
    expect(r.imported).toBe(0);
    expect(r.details.skipped[0].reason).toMatch(/Invalid frequency_days/i);
  });

  it('rejects only the bad row, importing the good ones alongside it', async () => {
    P.assetInstance.findMany.mockResolvedValue([
      { id: 'ahu-1', name: 'AHU-01' },
      { id: 'ahu-2', name: 'AHU-02' },
    ]);
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '45' },
      { ahu_name: 'AHU-02', scheduled_date: '2026-09-20', tolerance_days: '3' },
    ]);
    expect(r.skipped).toBe(1);
    expect(r.details.skipped[0].row).toBe(2);
    expect(r.imported).toBe(1);
    expect(r.details.imported[0].ahuName).toBe('AHU-02');
  });
});

describe('importSchedules — a blocked year refuses the WHOLE series', () => {
  // Owner decision 2026-08-26. Applying a series year-by-year would leave a
  // half-materialised schedule: old dates surviving in the blocked year, new
  // ones written elsewhere, and only some rows carrying the seriesId.
  beforeEach(() => {
    // 2026 already has an ACTIVE schedule; 2027 does not.
    P.pmSchedule.findFirst.mockImplementation(async (args: any) =>
      args.where.year === 2026 ? { id: 'sched-2026', version: 1 } : null,
    );
    P.pmSchedule.update.mockResolvedValue({ id: 'sched-2026' });
    // …and that 2026 schedule carries recorded executions, so it cannot be wiped.
    P.pmExecution.count.mockResolvedValue(2);
  });

  it('writes NOTHING when one year of the series is blocked', async () => {
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);

    expect(r.imported).toBe(0);
    expect(createdEntries).toHaveLength(0);
    expect(createdSchedules).toHaveLength(0);
    // Critically: the UNBLOCKED 2027 year must not be created either, and no
    // wipe may run anywhere.
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
    expect(P.pmScheduleEntry.deleteMany).not.toHaveBeenCalled();
    expect(P.pmScheduleEntry.createMany).not.toHaveBeenCalled();
  });

  it('reports it once, naming the blocked year and the series', async () => {
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
    ]);

    expect(r.skipped).toBe(1); // one line per ROW, not per blocked year
    const reason = r.details.skipped[0].reason;
    expect(reason).toMatch(/whole recurring schedule/i);
    expect(reason).toContain('AHU-01');
    expect(reason).toContain('2026');
    expect(reason).toMatch(/every 30 days from 2026-09-15/);
    expect(reason).toMatch(/recorded execution/);
    expect(reason).toMatch(/No year was changed/);
  });

  it('still refuses when the BLOCKED year is not the anchor year', async () => {
    // Anchor in 2027 (unblocked), but the series also reaches back into… no —
    // reach FORWARD: anchor 2026-12-15 puts one occurrence in 2026 (blocked)
    // and the rest in 2027. Either way the whole thing must be refused.
    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-12-15', tolerance_days: '3', frequency_days: '90' },
    ]);
    expect(r.imported).toBe(0);
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
  });

  it('refuses only the blocked series, importing an unrelated AHU alongside it', async () => {
    P.assetInstance.findMany.mockResolvedValue([
      { id: 'ahu-1', name: 'AHU-01' },
      { id: 'ahu-2', name: 'AHU-02' },
    ]);
    // Only AHU-01's 2026 schedule exists/blocks; AHU-02 is clean.
    P.pmSchedule.findFirst.mockImplementation(async (args: any) =>
      args.where.entityId === 'ahu-1' && args.where.year === 2026 ? { id: 'sched-2026', version: 1 } : null,
    );

    const r = await importSchedules(ctx, [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequency_days: '30' },
      { ahu_name: 'AHU-02', scheduled_date: '2026-09-20', tolerance_days: '3', frequency_days: '90' },
    ]);

    expect(r.skipped).toBe(1);
    expect(r.details.skipped[0].row).toBe(2);
    // AHU-02's series lands in full: Sep + Dec 2026, then Mar/Jun/Sep/Dec 2027.
    expect(r.imported).toBe(6);
    expect(createdEntries.every((e) => e.scheduleId.startsWith('sched-'))).toBe(true);
    expect(r.details.imported.every((i) => i.ahuName === 'AHU-02')).toBe(true);
  });
});

describe('importSchedules — accepted column-name variants', () => {
  it('reads frequencyDays and "Frequency (days)" as well as frequency_days', async () => {
    for (const row of [
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', frequencyDays: '90' },
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', 'Frequency (days)': '90' },
      { ahu_name: 'AHU-01', scheduled_date: '2026-09-15', tolerance_days: '3', 'Frequency Days': '90' },
    ]) {
      createdEntries = [];
      createdSchedules = [];
      vi.clearAllMocks();
      P.systemConfig.findUnique.mockResolvedValue({ configValue: {} });
      P.assetInstance.findMany.mockResolvedValue([{ id: 'ahu-1', name: 'AHU-01' }]);
      P.pmSchedule.findFirst.mockResolvedValue(null);
      P.pmSchedule.create.mockImplementation(async (a: any) => {
        createdSchedules.push(a.data); return { id: `sched-${a.data.year}` };
      });
      P.pmExecution.count.mockResolvedValue(0);
      P.pmScheduleEntry.count.mockResolvedValue(0);
      P.pmScheduleEntry.createMany.mockImplementation(async (a: any) => {
        createdEntries.push(...a.data); return { count: a.data.length };
      });
      P.pmScheduleEntry.findMany.mockResolvedValue([]);
      P.$transaction.mockImplementation(async (fn: any) => fn(P));
      (getPmWorkflowConfig as any).mockResolvedValue({ workflowEnabled: false });

      await importSchedules(ctx, [row as any]);
      expect(createdEntries.length).toBe(6); // quarterly through the horizon
      expect(createdSchedules[0].frequencyDays).toBe(90);
    }
  });
});
