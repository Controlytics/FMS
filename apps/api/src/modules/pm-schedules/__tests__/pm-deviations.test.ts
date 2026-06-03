import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn() },
    pmScheduleEntry: { findMany: vi.fn() },
    assetInstance: { findMany: vi.fn() },
    cleaningCycle: { groupBy: vi.fn() },
    filterEvent: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    deviation: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../pm-shared.js', () => ({ checkPmEnabled: vi.fn(async () => {}) }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: vi.fn(async () => ({})) }));

import { sweepOverdueDeviations, acknowledgeDeviation, dayDiff } from '../pm-deviations.js';
import { prisma } from '../../../lib/prisma.js';
import { createNotification } from '../../notifications/notification.service.js';

const P = prisma as any;

// assetInstance.findMany is called twice in loadCountedFilters (Promise.all):
// once for the AHUs (where.id) and once for child filters (where.parentId).
// Route by the where shape so order-independence holds.
function wireAhuWithFilters(ahu: { id: string; name: string; mode?: string }, filters: { id: string; name: string; filterSet?: string | null }[]) {
  P.assetInstance.findMany.mockImplementation(async (args: any) => {
    if (args?.where?.parentId) {
      return filters.map((f) => ({ id: f.id, name: f.name, parentId: ahu.id, filterDetails: { filterSet: f.filterSet ?? null } }));
    }
    return [{ id: ahu.id, name: ahu.name, customAttributes: ahu.mode ? { pmFilterSetMode: ahu.mode } : {} }];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  P.systemConfig.findUnique.mockResolvedValue({ configValue: {} }); // → default ['ADMIN']
  P.pmScheduleEntry.findMany.mockResolvedValue([]);
  P.deviation.findMany.mockResolvedValue([]);
  P.cleaningCycle.groupBy.mockResolvedValue([]);
  P.assetInstance.findMany.mockResolvedValue([]);
  P.deviation.update.mockResolvedValue({});
});

describe('dayDiff', () => {
  it('counts whole days (to − from), floored at 0', () => {
    const d = (s: string) => new Date(s);
    expect(dayDiff(d('2026-06-03T00:00:00Z'), d('2026-06-03T00:00:00Z'))).toBe(0);
    expect(dayDiff(d('2026-06-08T00:00:00Z'), d('2026-06-03T00:00:00Z'))).toBe(5);
    expect(dayDiff(d('2026-06-03T23:59:00Z'), d('2026-06-03T00:00:00Z'))).toBe(0); // partial day floors
    expect(dayDiff(d('2026-06-01T00:00:00Z'), d('2026-06-03T00:00:00Z'))).toBe(0); // future → 0
  });
});

describe('sweepOverdueDeviations — OPEN', () => {
  const entry = {
    id: 'entry-1', plannedDate: new Date('2026-05-16'),
    windowStart: new Date('2026-05-06'), windowEnd: new Date('2026-05-26'),
    schedule: { entityId: 'ahu-1' },
  };

  it('opens a deviation + fires one overdue notification when filters are not all cleaned', async () => {
    P.pmScheduleEntry.findMany.mockResolvedValue([entry]);
    wireAhuWithFilters({ id: 'ahu-1', name: 'AHU-02' }, [{ id: 'f1', name: 'F1' }, { id: 'f2', name: 'F2' }]);
    P.cleaningCycle.groupBy.mockResolvedValue([]); // nothing cleaned → overdue
    P.deviation.create.mockResolvedValue({ id: 'dev-1', deviationNumber: 'DEV-000001', scheduledDate: entry.plannedDate, pmScheduleEntryId: 'entry-1' });

    const r = await sweepOverdueDeviations();
    expect(r.opened).toBe(1);
    expect(P.deviation.create).toHaveBeenCalledTimes(1);
    const created = P.deviation.create.mock.calls[0][0].data;
    expect(created.pmScheduleEntryId).toBe('entry-1');
    expect(created.filterCount).toBe(2);
    expect(created.status).toBe('OPEN');
    expect(createNotification).toHaveBeenCalledTimes(1); // forRole ADMIN (default)
    expect((createNotification as any).mock.calls[0][0].type).toBe('PM_OVERDUE');
    expect((createNotification as any).mock.calls[0][0].forRole).toBe('ADMIN');
  });

  it('is idempotent — a unique-violation (P2002) on create opens nothing and sends no notification', async () => {
    P.pmScheduleEntry.findMany.mockResolvedValue([entry]);
    wireAhuWithFilters({ id: 'ahu-1', name: 'AHU-02' }, [{ id: 'f1', name: 'F1' }]);
    P.cleaningCycle.groupBy.mockResolvedValue([]);
    P.deviation.create.mockRejectedValue({ code: 'P2002' });

    const r = await sweepOverdueDeviations();
    expect(r.opened).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('does NOT open a deviation when all counted filters are already cleaned', async () => {
    P.pmScheduleEntry.findMany.mockResolvedValue([entry]);
    wireAhuWithFilters({ id: 'ahu-1', name: 'AHU-02' }, [{ id: 'f1', name: 'F1' }]);
    P.cleaningCycle.groupBy.mockResolvedValue([{ filterId: 'f1', _max: { completedAt: new Date('2026-05-20') } }]);

    const r = await sweepOverdueDeviations();
    expect(r.opened).toBe(0);
    expect(P.deviation.create).not.toHaveBeenCalled();
  });

  it('skips AHUs whose filter-set mode is DISABLED', async () => {
    P.pmScheduleEntry.findMany.mockResolvedValue([entry]);
    wireAhuWithFilters({ id: 'ahu-1', name: 'AHU-02', mode: 'DISABLED' }, [{ id: 'f1', name: 'F1' }]);
    const r = await sweepOverdueDeviations();
    expect(r.opened).toBe(0);
    expect(P.deviation.create).not.toHaveBeenCalled();
  });
});

describe('sweepOverdueDeviations — CLOSE', () => {
  it('closes an open deviation once all its filters are cleaned + fires completion notification', async () => {
    P.deviation.findMany.mockResolvedValue([{
      id: 'dev-1', deviationNumber: 'DEV-000001', ahuName: 'PC',
      filterIds: ['f1'], scheduledDate: new Date('2026-05-22'), windowStart: new Date('2026-05-13'),
      overdueDaysAtOpen: 12, acknowledgedBy: 'u1', acknowledgedByName: 'operator1', completionNotifiedAt: null,
    }]);
    P.cleaningCycle.groupBy.mockResolvedValue([{ filterId: 'f1', _max: { completedAt: new Date('2026-06-03') } }]);

    const r = await sweepOverdueDeviations();
    expect(r.closed).toBe(1);
    const upd = P.deviation.update.mock.calls.find((c: any) => c[0].data.status === 'CLOSED');
    expect(upd).toBeTruthy();
    expect(upd[0].data.completedByName).toBe('operator1'); // acknowledger wins
    expect(upd[0].data.delayDays).toBeGreaterThan(0);
    expect((createNotification as any).mock.calls.some((c: any) => c[0].type === 'PM_OVERDUE_COMPLETED')).toBe(true);
  });

  it('does not close while any filter is still uncleaned', async () => {
    P.deviation.findMany.mockResolvedValue([{
      id: 'dev-1', deviationNumber: 'DEV-1', ahuName: 'PC', filterIds: ['f1', 'f2'],
      scheduledDate: new Date('2026-05-22'), windowStart: new Date('2026-05-13'), overdueDaysAtOpen: 12,
      acknowledgedBy: null, completionNotifiedAt: null,
    }]);
    P.cleaningCycle.groupBy.mockResolvedValue([{ filterId: 'f1', _max: { completedAt: new Date('2026-06-03') } }]); // only f1
    P.filterEvent.findFirst.mockResolvedValue(null);

    const r = await sweepOverdueDeviations();
    expect(r.closed).toBe(0);
  });
});

describe('acknowledgeDeviation', () => {
  const ctx = { userSub: 'u1', userId: 'operator1', userRole: 'OPERATOR', ipAddress: '127.0.0.1', sessionId: 's1' } as any;

  it('records ACKNOWLEDGED + passwordVerified + the operator identity', async () => {
    P.deviation.findUnique.mockResolvedValue({ id: 'dev-1', deviationNumber: 'DEV-1', ahuName: 'PC', status: 'OPEN', overdueDaysAtOpen: 5, assignedUserId: null });
    P.deviation.update.mockResolvedValue({ id: 'dev-1', status: 'ACKNOWLEDGED', passwordVerified: true });
    await acknowledgeDeviation(ctx, 'dev-1');
    const data = P.deviation.update.mock.calls[0][0].data;
    expect(data.status).toBe('ACKNOWLEDGED');
    expect(data.passwordVerified).toBe(true);
    expect(data.acknowledgedBy).toBe('u1');
    expect(data.acknowledgedByName).toBe('operator1');
  });

  it('rejects acknowledging an already-closed deviation', async () => {
    P.deviation.findUnique.mockResolvedValue({ id: 'dev-1', status: 'CLOSED', ahuName: 'PC' });
    await expect(acknowledgeDeviation(ctx, 'dev-1')).rejects.toThrow(/closed/i);
  });

  it('404s on a missing deviation', async () => {
    P.deviation.findUnique.mockResolvedValue(null);
    await expect(acknowledgeDeviation(ctx, 'nope')).rejects.toThrow(/not found/i);
  });
});
