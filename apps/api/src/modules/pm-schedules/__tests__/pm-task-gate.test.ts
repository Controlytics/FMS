import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    pmScheduleEntry: { update: vi.fn() },
    deviation: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../pm-shared.js', () => ({ resolvePmReasonKeys: vi.fn() }));
vi.mock('../pm-pending-context.js', () => ({ getPendingContextForFilter: vi.fn() }));

import { resolvePmGate, MIN_REASON_LENGTH } from '../pm-task-gate.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { resolvePmReasonKeys } from '../pm-shared.js';
import { getPendingContextForFilter } from '../pm-pending-context.js';

const P = prisma as any;
const ctx = { userId: 'op1', userSub: 'u-1', userRole: 'OPERATOR', ipAddress: '::1', userAgent: 'vitest', sessionId: 's1' } as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const AUG = {
  entryId: 'e-aug', ahuId: 'ahu-1', ahuName: 'AHU-21',
  plannedDate: d('2026-08-15'), windowStart: d('2026-08-12'), windowEnd: d('2026-08-18'),
  overdueDays: 31, deviationId: 'dev-1', deviationNumber: 'DEV-000001',
};
const SEP_CURRENT = {
  entryId: 'e-sep', ahuId: 'ahu-1', ahuName: 'AHU-21',
  plannedDate: d('2026-09-15'), windowStart: d('2026-09-12'), windowEnd: d('2026-09-18'),
};

const context = (over: Partial<any> = {}) => ({
  ahuId: 'ahu-1', ahuName: 'AHU-21', currentEntry: SEP_CURRENT, overdueEntries: [AUG], ...over,
});

const GOOD_REASON = 'line was in production, could not stop it';

beforeEach(() => {
  vi.clearAllMocks();
  (resolvePmReasonKeys as any).mockResolvedValue(new Set(['PM']));
  (getPendingContextForFilter as any).mockResolvedValue(context());
  P.pmScheduleEntry.update.mockResolvedValue({});
  P.deviation.findUnique.mockResolvedValue({ id: 'dev-1', deviationNumber: 'DEV-000001', status: 'OPEN' });
  P.deviation.update.mockResolvedValue({});
});

describe('resolvePmGate — when the gate stays out of the way', () => {
  it('ignores a NON-PM cleaning entirely', async () => {
    const r = await resolvePmGate(ctx, 'f-1', undefined, 'BREAKDOWN');
    expect(r).toEqual({ bindEntryId: null, apply: null });
    expect(getPendingContextForFilter).not.toHaveBeenCalled();
  });

  it('ignores everything when no PM reason is configured at all', async () => {
    // Nothing distinguishes a scheduled PM from any other clean, so challenging
    // every cleaning would be noise.
    (resolvePmReasonKeys as any).mockResolvedValue(null);
    const r = await resolvePmGate(ctx, 'f-1', undefined, 'PM');
    expect(r.apply).toBeNull();
    expect(r.bindEntryId).toBeNull();
  });

  it('binds to the currently-due entry when nothing is outstanding', async () => {
    (getPendingContextForFilter as any).mockResolvedValue(context({ overdueEntries: [] }));
    const r = await resolvePmGate(ctx, 'f-1', undefined, 'PM');
    expect(r.bindEntryId).toBe('e-sep');
    expect(r.apply).toBeNull();
  });

  it('binds nothing when there is no due entry either', async () => {
    (getPendingContextForFilter as any).mockResolvedValue(context({ overdueEntries: [], currentEntry: null }));
    const r = await resolvePmGate(ctx, 'f-1', undefined, 'PM');
    expect(r.bindEntryId).toBeNull();
  });
});

describe('resolvePmGate — demanding an answer', () => {
  it('409s with the outstanding entries when no payload is supplied', async () => {
    await expect(resolvePmGate(ctx, 'f-1', undefined, 'PM')).rejects.toMatchObject({
      statusCode: 409, code: 'PM_PREVIOUS_TASK_PENDING',
    });
  });

  it('carries the pending list and the AHU on the error for the dialog', async () => {
    const err: any = await resolvePmGate(ctx, 'f-1', undefined, 'PM').catch((e) => e);
    expect(err.pendingTasks).toHaveLength(1);
    expect(err.pendingTasks[0].entryId).toBe('e-aug');
    expect(err.ahu).toEqual({ id: 'ahu-1', name: 'AHU-21' });
    expect(err.message).toMatch(/2026-08-15/);
    expect(err.message).toMatch(/AHU-21/);
  });

  it('409s again when only SOME outstanding tasks are accounted for', async () => {
    const JUL = { ...AUG, entryId: 'e-jul', plannedDate: d('2026-07-15') };
    (getPendingContextForFilter as any).mockResolvedValue(context({ overdueEntries: [JUL, AUG] }));

    const err: any = await resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] }, 'PM').catch((e) => e);

    expect(err.statusCode).toBe(409);
    // Only the UNANSWERED one is re-reported.
    expect(err.pendingTasks.map((t: any) => t.entryId)).toEqual(['e-jul']);
  });

  it('rejects an empty payload the same as a missing one', async () => {
    await expect(resolvePmGate(ctx, 'f-1', {}, 'PM')).rejects.toMatchObject({ code: 'PM_PREVIOUS_TASK_PENDING' });
    await expect(resolvePmGate(ctx, 'f-1', { skips: [] }, 'PM')).rejects.toMatchObject({ code: 'PM_PREVIOUS_TASK_PENDING' });
  });
});

describe('resolvePmGate — payload validation', () => {
  it('refuses a reason shorter than the minimum', async () => {
    await expect(resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: 'busy' }] }, 'PM'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PM_REASON_REQUIRED' });
    expect(MIN_REASON_LENGTH).toBe(10);
  });

  it('refuses whitespace padded into a reason', async () => {
    await expect(resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: '          ' }] }, 'PM'),
    ).rejects.toMatchObject({ code: 'PM_REASON_REQUIRED' });
  });

  it('refuses an entry that is not actually outstanding', async () => {
    await expect(resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-someone-else', reason: GOOD_REASON }] }, 'PM'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PM_ENTRY_NOT_PENDING' });
  });

  it('refuses performing AND skipping the same task', async () => {
    await expect(resolvePmGate(ctx, 'f-1', {
      completeLate: { pmScheduleEntryId: 'e-aug', reason: GOOD_REASON },
      skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }],
    }, 'PM')).rejects.toMatchObject({ statusCode: 400, code: 'PM_CONFLICTING_INTENT' });
  });

  it('writes NOTHING while validating', async () => {
    await resolvePmGate(ctx, 'f-1', { skips: [{ pmScheduleEntryId: 'e-aug', reason: 'no' }] }, 'PM').catch(() => {});
    expect(P.pmScheduleEntry.update).not.toHaveBeenCalled();
    expect(P.deviation.update).not.toHaveBeenCalled();
  });
});

describe('resolvePmGate — Path A: perform the missed PM late', () => {
  it('binds the cycle to the OLD entry, not the current one', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { completeLate: { pmScheduleEntryId: 'e-aug', reason: GOOD_REASON } }, 'PM');
    expect(r.bindEntryId).toBe('e-aug');
    expect(r.apply).toBeTypeOf('function');
  });

  it('records the lateness reason on the entry and does NOT skip it', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { completeLate: { pmScheduleEntryId: 'e-aug', reason: GOOD_REASON } }, 'PM');
    await r.apply!('cycle-1');

    expect(P.pmScheduleEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'e-aug' },
      data: expect.objectContaining({ lateReason: GOOD_REASON, lateReasonBy: 'u-1' }),
    }));
    const data = P.pmScheduleEntry.update.mock.calls[0][0].data;
    expect(data.skippedAt).toBeUndefined();
    // The deviation is NOT closed here — the sweep closes it once the bound
    // cleaning actually completes. Starting is not finishing.
    expect(P.deviation.update).not.toHaveBeenCalled();
  });

  it('audits it as COMPLETED_LATE with the operator statement', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { completeLate: { pmScheduleEntryId: 'e-aug', reason: GOOD_REASON } }, 'PM');
    await r.apply!('cycle-1');
    const entry = (auditLog as any).mock.calls[0][0];
    expect(entry.action).toBe('PM_TASK_COMPLETED_LATE');
    expect(entry.reason).toBe(GOOD_REASON);
    expect(entry.signatureMeaning).toMatch(/perform the previously-missed scheduled PM/);
  });
});

describe('resolvePmGate — Path B: skip the missed PM', () => {
  it('binds the cycle to the CURRENT entry, not the skipped one', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] }, 'PM');
    expect(r.bindEntryId).toBe('e-sep');
  });

  it('writes off the old entry with who / when / why', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] }, 'PM');
    await r.apply!('cycle-1');

    expect(P.pmScheduleEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'e-aug' },
      data: expect.objectContaining({
        skipReason: GOOD_REASON, skippedBy: 'u-1', skippedByName: 'op1',
      }),
    }));
  });

  it('closes the deviation as SKIPPED, never as completed', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] }, 'PM');
    await r.apply!('cycle-1');

    const call = P.deviation.update.mock.calls[0][0];
    expect(call.data.status).toBe('CLOSED');
    expect(call.data.closureKind).toBe('SKIPPED');
    expect(call.data.closureReason).toBe(GOOD_REASON);
    // A skip is NOT a completion — no performer may be recorded against it.
    expect(call.data.completedBy).toBeNull();
    expect(call.data.completedByName).toBeNull();
  });

  it('leaves an already-CLOSED deviation alone', async () => {
    P.deviation.findUnique.mockResolvedValue({ id: 'dev-1', deviationNumber: 'DEV-1', status: 'CLOSED' });
    const r = await resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] }, 'PM');
    await r.apply!('cycle-1');
    expect(P.deviation.update).not.toHaveBeenCalled();
  });

  it('audits the skip as a statement that the PM did NOT happen', async () => {
    const r = await resolvePmGate(ctx, 'f-1',
      { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] }, 'PM');
    await r.apply!('cycle-1');
    const actions = (auditLog as any).mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toContain('PM_TASK_SKIPPED');
    const skipEntry = (auditLog as any).mock.calls.find((c: any[]) => c[0].action === 'PM_TASK_SKIPPED')[0];
    expect(skipEntry.signatureMeaning).toMatch(/was NOT performed/);
    expect(skipEntry.reason).toBe(GOOD_REASON);
  });

  it('handles several stacked tasks, one reason each', async () => {
    const JUL = { ...AUG, entryId: 'e-jul', plannedDate: d('2026-07-15'), deviationId: 'dev-2' };
    (getPendingContextForFilter as any).mockResolvedValue(context({ overdueEntries: [JUL, AUG] }));

    const r = await resolvePmGate(ctx, 'f-1', {
      skips: [
        { pmScheduleEntryId: 'e-jul', reason: 'shutdown was postponed twice' },
        { pmScheduleEntryId: 'e-aug', reason: GOOD_REASON },
      ],
    }, 'PM');
    await r.apply!('cycle-1');

    expect(P.pmScheduleEntry.update).toHaveBeenCalledTimes(2);
    const reasons = P.pmScheduleEntry.update.mock.calls.map((c: any[]) => c[0].data.skipReason);
    expect(reasons).toEqual(['shutdown was postponed twice', GOOD_REASON]);
  });

  it('is asked ONCE per AHU across a 50-tag batch, not once per filter', async () => {
    // The tablet batches every filter under an AHU into one bulk-operate
    // request, each item carrying the same pmTask payload. The first item
    // writes the skip; from then on the entry is no longer outstanding, so the
    // rest must sail through binding to the current entry — NOT fail with
    // "that task is not outstanding", and NOT write the skip 50 times.
    let skipped = false;
    (getPendingContextForFilter as any).mockImplementation(async () =>
      context({ overdueEntries: skipped ? [] : [AUG] }),
    );
    P.pmScheduleEntry.update.mockImplementation(async () => { skipped = true; return {}; });

    const payload = { skips: [{ pmScheduleEntryId: 'e-aug', reason: GOOD_REASON }] };
    const binds: (string | null)[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await resolvePmGate(ctx, `filter-${i}`, payload, 'PM');
      if (r.apply) await r.apply(`cycle-${i}`);
      binds.push(r.bindEntryId);
    }

    // Written off exactly once.
    expect(P.pmScheduleEntry.update).toHaveBeenCalledTimes(1);
    expect(P.deviation.update).toHaveBeenCalledTimes(1);
    // Every one of the 50 cleanings still credits the CURRENT period.
    expect(new Set(binds)).toEqual(new Set(['e-sep']));
  });

  it('supports performing one late while skipping another', async () => {
    const JUL = { ...AUG, entryId: 'e-jul', plannedDate: d('2026-07-15') };
    (getPendingContextForFilter as any).mockResolvedValue(context({ overdueEntries: [JUL, AUG] }));

    const r = await resolvePmGate(ctx, 'f-1', {
      completeLate: { pmScheduleEntryId: 'e-aug', reason: GOOD_REASON },
      skips: [{ pmScheduleEntryId: 'e-jul', reason: 'shutdown was postponed twice' }],
    }, 'PM');

    // The cycle is performed FOR August; July is written off.
    expect(r.bindEntryId).toBe('e-aug');
    await r.apply!('cycle-1');
    const actions = (auditLog as any).mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toContain('PM_TASK_COMPLETED_LATE');
    expect(actions).toContain('PM_TASK_SKIPPED');
  });
});
