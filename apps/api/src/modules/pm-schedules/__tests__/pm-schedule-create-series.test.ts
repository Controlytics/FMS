import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    pmSchedule: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    // Interactive form — hand the callback the same mocked client.
    $transaction: vi.fn(),
  },
}));
vi.mock('../pm-shared.js', () => ({ checkPmEnabled: vi.fn(async () => {}) }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));

import { create } from '../pm-schedule-crud.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';

const P = prisma as any;
const ctx = { userId: 'tester', userSub: 'user-1', userRole: 'ADMIN', ipAddress: '::1', userAgent: 'vitest' } as any;

/** Every pmSchedule.create payload, in creation order. */
let created: any[];

const body = (over: Record<string, any> = {}) => ({
  entityId: 'ahu-1',
  year: 2026,
  entries: [{ month: 9, plannedDate: '2026-09-15', toleranceDays: 3 }],
  ...over,
});

const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
const allEntries = () => created.flatMap((c) => c.entries?.create ?? []);

beforeEach(() => {
  vi.clearAllMocks();
  // The horizon is "31 Dec of NEXT calendar year", read off the wall clock —
  // freeze it so occurrence counts stay deterministic.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-26T06:00:00Z'));

  created = [];
  P.pmSchedule.findFirst.mockResolvedValue(null);
  P.pmSchedule.findMany.mockResolvedValue([]); // no conflicting years
  P.pmSchedule.create.mockImplementation(async (args: any) => {
    created.push(args.data);
    return { id: `sched-${args.data.year}`, ...args.data, entries: args.data.entries?.create ?? [] };
  });
  P.$transaction.mockImplementation(async (fn: any) => fn(P));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('create — one-off (no frequencyDays) is untouched', () => {
  it.each([
    ['omitted', {}],
    ['null', { frequencyDays: null }],
    ['zero', { frequencyDays: 0 }],
  ])('takes the legacy single-schedule path when frequencyDays is %s', async (_label, over) => {
    await create(ctx, body(over));
    expect(P.pmSchedule.create).toHaveBeenCalledTimes(1);
    expect(created[0].year).toBe(2026);
    expect(created[0].seriesId).toBeUndefined();
    expect(created[0].frequencyDays).toBeUndefined();
    expect(allEntries()).toHaveLength(1);
  });

  it('still 409s when the year already has an active schedule', async () => {
    P.pmSchedule.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(create(ctx, body())).rejects.toMatchObject({ statusCode: 409 });
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
  });
});

describe('create — recurring series', () => {
  it('writes ONE schedule per calendar year under a shared seriesId', async () => {
    const r: any = await create(ctx, body({ frequencyDays: 90 }));

    expect(created.map((c) => c.year)).toEqual([2026, 2027]);
    const ids = new Set(created.map((c) => c.seriesId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^[0-9a-f-]{36}$/);
    for (const c of created) {
      expect(c.frequencyDays).toBe(90);
      expect(iso(c.anchorDate)).toBe('2026-09-15');
      expect(c.status).toBe('ACTIVE');
    }
    expect(r.series.totalEntries).toBe(6);
    expect(r.series.years).toEqual([2026, 2027]);
    expect(r.series.scheduleIds).toEqual(['sched-2026', 'sched-2027']);
  });

  it('keeps the same day-of-month across the year boundary', async () => {
    await create(ctx, body({ frequencyDays: 30 }));
    const dates = allEntries().map((e) => iso(e.plannedDate)).sort();
    expect(dates.slice(0, 5)).toEqual([
      '2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15',
    ]);
    expect(dates.every((d) => d.endsWith('-15'))).toBe(true);
  });

  it('carries the tolerance onto every generated window', async () => {
    await create(ctx, body({ frequencyDays: 90, entries: [{ month: 9, plannedDate: '2026-09-15', toleranceDays: 4 }] }));
    for (const e of allEntries()) {
      expect(e.toleranceDays).toBe(4);
      expect(new Date(e.windowEnd).getTime() - new Date(e.windowStart).getTime()).toBe(8 * 86400000);
    }
  });

  it('returns the ANCHOR year schedule so existing callers keep their shape', async () => {
    const r: any = await create(ctx, body({ frequencyDays: 90 }));
    expect(r.id).toBe('sched-2026');
    expect(r.year).toBe(2026);
    expect(Array.isArray(r.entries)).toBe(true);
  });

  it('writes every year inside ONE transaction', async () => {
    await create(ctx, body({ frequencyDays: 30 }));
    // A series that committed only its first year would start generating tasks
    // for a schedule the operator never agreed to.
    expect(P.$transaction).toHaveBeenCalledTimes(1);
  });

  it('audits the series, not just the first schedule', async () => {
    await create(ctx, body({ frequencyDays: 90 }));
    const entry = (auditLog as any).mock.calls[0][0];
    expect(entry.afterValue).toMatchObject({
      frequencyDays: 90, anchorDate: '2026-09-15', scheduleCount: 2, entryCount: 6,
    });
    expect(entry.reason).toMatch(/every 90 days/);
  });
});

describe('create — recurring validation', () => {
  it('refuses a non-multiple of 30', async () => {
    await expect(create(ctx, body({ frequencyDays: 45 }))).rejects.toMatchObject({
      statusCode: 400, code: 'FREQUENCY_NOT_MULTIPLE_OF_30',
    });
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
  });

  it('refuses below the 30-day minimum', async () => {
    await expect(create(ctx, body({ frequencyDays: 15 }))).rejects.toMatchObject({
      statusCode: 400, code: 'FREQUENCY_TOO_SMALL',
    });
  });

  it('refuses a tolerance that would overlap consecutive windows', async () => {
    await expect(create(ctx, body({
      frequencyDays: 30,
      entries: [{ month: 9, plannedDate: '2026-09-15', toleranceDays: 14 }],
    }))).rejects.toMatchObject({ statusCode: 400, code: 'FREQUENCY_TOLERANCE_OVERLAP' });
  });

  it('refuses a non-numeric frequency', async () => {
    await expect(create(ctx, body({ frequencyDays: 'monthly' }))).rejects.toMatchObject({
      statusCode: 400, code: 'VALIDATION_ERROR',
    });
  });

  it('refuses more than one entry — the frequency already fixes every later date', async () => {
    await expect(create(ctx, body({
      frequencyDays: 30,
      entries: [
        { month: 9, plannedDate: '2026-09-15', toleranceDays: 3 },
        { month: 10, plannedDate: '2026-10-20', toleranceDays: 3 },
      ],
    }))).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
  });

  it('refuses an empty entries array', async () => {
    await expect(create(ctx, body({ frequencyDays: 30, entries: [] })))
      .rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });
});

describe('create — year conflicts across the whole series', () => {
  it('409s when a LATER year already has a schedule, naming it', async () => {
    // Checking only the anchor year would let the series collide in 2027 and
    // blow up mid-transaction on the unique constraint instead.
    P.pmSchedule.findMany.mockResolvedValue([{ year: 2027 }]);

    await expect(create(ctx, body({ frequencyDays: 90 }))).rejects.toMatchObject({
      statusCode: 409, code: 'CONFLICT',
    });
    await expect(create(ctx, body({ frequencyDays: 90 }))).rejects.toThrow(/2027/);
    expect(P.pmSchedule.create).not.toHaveBeenCalled();
  });

  it('queries every year the series would cover', async () => {
    await create(ctx, body({ frequencyDays: 30 }));
    expect(P.pmSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityId: 'ahu-1', status: 'ACTIVE', year: { in: [2026, 2027] },
        }),
      }),
    );
  });
});
