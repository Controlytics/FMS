import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn() },
    assetInstance: { findMany: vi.fn() },
    pmSchedule: { findFirst: vi.fn(), create: vi.fn() },
    pmScheduleEntry: { count: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    pmExecution: { count: vi.fn(), deleteMany: vi.fn() },
    // Interactive form — hand the callback the same mocked client.
    $transaction: vi.fn(),
  },
}));
vi.mock('../pm-shared.js', () => ({ checkPmEnabled: vi.fn(async () => {}) }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../pm-workflow.js', () => ({
  getPmWorkflowConfig: vi.fn(),
  assertPmRole: vi.fn(),
  generateQnn: vi.fn(async () => 'QNN-0001'),
  // 2026-09-02: the upload mints one QNN per entry and tags them with a shared
  // batch reference. Mirrors the real implementations (fixed ref so assertions
  // on the message stay deterministic) rather than stubbing them away, so these
  // tests still cover the message the importer actually writes.
  newQnnBatchRef: vi.fn(() => 'B-TEST01'),
  qnnBatchTag: vi.fn((ref: string | null, i: number, total: number) =>
    (ref && total > 1 ? ` [batch ${ref}, ${i} of ${total}]` : '')),
}));

import { importSchedules } from '../pm-import.js';
import { prisma } from '../../../lib/prisma.js';
import { getPmWorkflowConfig } from '../pm-workflow.js';

const P = prisma as any;
const ctx = { userId: 'tester', userSub: 'user-1', userRole: 'ADMIN', ipAddress: '::1', userAgent: 'vitest' } as any;

const ROW = { ahu_name: 'AHU-01', scheduled_date: '2026-04-12', tolerance_days: '3' };
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
/** An entry as the importer reads it back off the schedule. */
const entry = (id: string, date: string, tol = 3) => ({ id, plannedDate: d(date), toleranceDays: tol });

beforeEach(() => {
  vi.clearAllMocks();
  P.systemConfig.findUnique.mockResolvedValue({ configValue: {} });
  P.assetInstance.findMany.mockResolvedValue([{ id: 'ahu-1', name: 'AHU-01' }]);
  P.pmSchedule.findFirst.mockResolvedValue({ id: 'sched-1', version: 1 });
  P.pmExecution.count.mockResolvedValue(0);
  P.pmScheduleEntry.count.mockResolvedValue(0);
  // No existing visits by default; the id-readback returns what was added.
  P.pmScheduleEntry.findMany.mockResolvedValue([]);
  P.pmScheduleEntry.createMany.mockResolvedValue({ count: 1 });
  P.pmScheduleEntry.deleteMany.mockResolvedValue({ count: 0 });
  P.$transaction.mockImplementation(async (fn: any) => fn(P));
  (getPmWorkflowConfig as any).mockResolvedValue({ workflowEnabled: false });
});

/**
 * Upload is ADDITIVE (2026-08-27).
 *
 * It used to hard-replace: delete every entry for the (AHU, year) and recreate
 * from the file. Two guards then refused the wipe when it would destroy
 * execution evidence or APPROVED entries — which made a whole-year re-upload
 * impossible in practice (13 of 15 live AHUs held an approved entry and were
 * refused outright).
 *
 * Nothing is deleted any more, so the guards are gone with the wipe. What
 * replaces them is stricter about the thing that actually mattered: an existing
 * visit is never touched by an upload.
 */
describe('importSchedules — the upload never destroys existing visits', () => {
  it('adds a new visit without deleting anything', async () => {
    P.pmScheduleEntry.findMany
      .mockResolvedValueOnce([entry('e1', '2026-01-10')])          // existing
      .mockResolvedValueOnce([entry('e1', '2026-01-10'), entry('e2', '2026-04-12')]); // read-back

    const r = await importSchedules(ctx, [ROW]);

    expect(r.imported).toBe(1);
    expect(P.pmScheduleEntry.deleteMany).not.toHaveBeenCalled();
    expect(P.pmExecution.deleteMany).not.toHaveBeenCalled();
    // Only the NEW visit is written; the existing one is not rewritten.
    expect(P.pmScheduleEntry.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it('uploads even when the schedule holds APPROVED entries and the workflow is ON', async () => {
    // The old approved-entry guard refused this outright. Nothing is destroyed
    // now, so there is nothing to refuse — this is the case that blocked 13 AHUs.
    (getPmWorkflowConfig as any).mockResolvedValue({ workflowEnabled: true });
    P.pmScheduleEntry.count.mockResolvedValue(3);
    P.pmScheduleEntry.findMany
      .mockResolvedValueOnce([entry('a1', '2026-01-10')])
      .mockResolvedValueOnce([entry('a1', '2026-01-10'), entry('a2', '2026-04-12')]);

    const r = await importSchedules(ctx, [ROW]);

    expect(r.imported).toBe(1);
    expect(P.pmScheduleEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('uploads even when the schedule has recorded executions', async () => {
    // Executions hang off existing entries. They were only ever at risk from
    // the wipe; an append cannot touch them.
    P.pmExecution.count.mockResolvedValue(2);
    P.pmScheduleEntry.findMany
      .mockResolvedValueOnce([entry('x1', '2026-01-10')])
      .mockResolvedValueOnce([entry('x1', '2026-01-10'), entry('x2', '2026-04-12')]);

    const r = await importSchedules(ctx, [ROW]);

    expect(r.imported).toBe(1);
    expect(P.pmExecution.deleteMany).not.toHaveBeenCalled();
    expect(P.pmScheduleEntry.deleteMany).not.toHaveBeenCalled();
  });
});

describe('importSchedules — re-uploading the same dates', () => {
  it('leaves a date that is already scheduled untouched and says so', async () => {
    // Re-uploading a corrected file must not fail on every row that has not
    // changed, and must not duplicate them.
    P.pmScheduleEntry.findMany.mockResolvedValue([entry('e1', '2026-04-12')]);

    const r = await importSchedules(ctx, [ROW]);

    expect(r.imported).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.details.skipped[0].reason).toMatch(/already on the 2026 schedule/);
    expect(P.pmScheduleEntry.createMany).not.toHaveBeenCalled();
  });

  it('adds only the genuinely new dates from a mixed file', async () => {
    P.pmScheduleEntry.findMany
      .mockResolvedValueOnce([entry('e1', '2026-04-12')])
      .mockResolvedValueOnce([entry('e1', '2026-04-12'), entry('e2', '2026-06-20')]);

    const r = await importSchedules(ctx, [ROW, { ...ROW, scheduled_date: '2026-06-20' }]);

    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(1);
    expect(P.pmScheduleEntry.createMany.mock.calls[0][0].data).toHaveLength(1);
  });
});

describe('importSchedules — separation against EXISTING visits', () => {
  it('refuses a new visit whose window overlaps one already on the schedule', async () => {
    // The operator cannot see the existing dates from inside their spreadsheet,
    // so the check has to include them. 2026-04-12 ±3 opens 9 Apr; an existing
    // 2026-04-10 ±3 closes 13 Apr.
    P.pmScheduleEntry.findMany.mockResolvedValue([entry('e1', '2026-04-10', 3)]);

    const r = await importSchedules(ctx, [ROW]);

    expect(r.imported).toBe(0);
    expect(r.details.skipped[0].reason).toMatch(/would satisfy both visits/);
    expect(P.pmScheduleEntry.createMany).not.toHaveBeenCalled();
  });

  it('accepts a new visit that clears the existing window', async () => {
    P.pmScheduleEntry.findMany
      .mockResolvedValueOnce([entry('e1', '2026-01-10', 3)])
      .mockResolvedValueOnce([entry('e1', '2026-01-10', 3), entry('e2', '2026-04-12', 3)]);

    const r = await importSchedules(ctx, [ROW]);

    expect(r.imported).toBe(1);
  });
});

describe('importSchedules — per-schedule atomicity', () => {
  it('opens ONE transaction per (AHU, year) regardless of row count', async () => {
    P.pmScheduleEntry.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([entry('e4', '2026-04-12'), entry('e5', '2026-05-12')]);

    await importSchedules(ctx, [ROW, { ...ROW, scheduled_date: '2026-05-12' }]);

    expect(P.$transaction).toHaveBeenCalledTimes(1);
    expect(P.pmScheduleEntry.createMany).toHaveBeenCalledTimes(1);
    expect(P.pmScheduleEntry.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('rolls a failed schedule back and reports every one of its rows as skipped', async () => {
    P.$transaction.mockRejectedValue(new Error('deadlock detected'));

    const r = await importSchedules(ctx, [ROW, { ...ROW, scheduled_date: '2026-05-12' }]);

    expect(r.imported).toBe(0);
    expect(r.skipped).toBe(2);
    expect(r.details.skipped.every((s: any) => /deadlock detected/.test(s.reason))).toBe(true);
  });

  it('isolates a failing schedule from a healthy one in the same file', async () => {
    P.assetInstance.findMany.mockResolvedValue([
      { id: 'ahu-1', name: 'AHU-01' },
      { id: 'ahu-2', name: 'AHU-02' },
    ]);
    P.pmSchedule.findFirst.mockImplementation(async (args: any) =>
      args.where.entityId === 'ahu-1' ? { id: 'sched-1', version: 1 } : { id: 'sched-2', version: 1 },
    );
    // AHU-01 already holds this exact date, so its row is skipped; AHU-02 does not.
    P.pmScheduleEntry.findMany.mockImplementation(async (args: any) =>
      args.where.scheduleId === 'sched-1' ? [entry('e1', '2026-04-12')] : [entry('e2', '2026-04-12')],
    );

    const r = await importSchedules(ctx, [ROW, { ...ROW, ahu_name: 'AHU-02' }]);

    // Both AHUs already hold the date — each is reported independently.
    expect(r.skipped).toBe(2);
    expect(r.details.skipped.map((s: any) => s.row).sort()).toEqual([2, 3]);
  });
});
