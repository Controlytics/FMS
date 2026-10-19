/**
 * QA-D001 (2026-10-19) regression: concurrent PM-task starts for ONE schedule
 * entry must create exactly one IN_PROGRESS execution.
 *
 * Before the fix `createExecution` ran `findFirst(IN_PROGRESS)` and `create` as two
 * separate statements; on the QA clone 20 simultaneous starts produced 2–5
 * executions per run, each with its own PM_STARTED audit row.
 *
 * Real database (digilog_test_db via vitest.env.ts) — a mocked Prisma cannot race.
 * Only the "PM module enabled" config check is stubbed, so the test never writes
 * system_config.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../pm-shared.js', async (orig) => ({
  ...(await orig<typeof import('../pm-shared.js')>()),
  checkPmEnabled: async () => undefined,
}));

import { prisma } from '../../../lib/prisma.js';
import { createExecution } from '../pm-executions.js';
import type { RequestContext } from '../../../types/context.js';

const SUFFIX = `qa-d001-${Date.now()}`;
const entityId = randomUUID();
const userSub = randomUUID();
let scheduleId = '';
let entryId = '';

const ctx = {
  userId: `pm_race_${SUFFIX}`, userSub, userRole: 'OPERATOR',
  ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined,
} as unknown as RequestContext;

describe('PM execution start — concurrent starts (QA-D001)', () => {
  beforeAll(async () => {
    const today = new Date();
    const day = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
    const schedule = await prisma.pmSchedule.create({
      data: { entityId, year: today.getUTCFullYear(), status: 'ACTIVE', createdBy: userSub },
    });
    scheduleId = schedule.id;
    const entry = await prisma.pmScheduleEntry.create({
      data: {
        scheduleId, month: today.getUTCMonth() + 1, plannedDate: day(0), toleranceDays: 3,
        windowStart: day(-3), windowEnd: day(3), approvalStatus: 'APPROVED',
      },
    });
    entryId = entry.id;
  });

  afterAll(async () => {
    await prisma.pmExecution.deleteMany({ where: { scheduleEntryId: entryId } });
    await prisma.pmScheduleEntry.deleteMany({ where: { scheduleId } });
    await prisma.pmSchedule.deleteMany({ where: { id: scheduleId } });
  });

  it('20 simultaneous starts create one execution; the other 19 are refused with 409 CONFLICT', async () => {
    const N = 20;
    const settled = await Promise.allSettled(
      Array.from({ length: N }, () => createExecution(ctx, { scheduleEntryId: entryId, entityId })),
    );

    const ok = settled.filter((s) => s.status === 'fulfilled');
    const refused = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(N - 1);
    for (const r of refused) {
      expect(r.reason?.statusCode ?? r.reason?.status).toBe(409);
      expect(r.reason?.code).toBe('CONFLICT');
    }

    const rows = await prisma.pmExecution.findMany({ where: { scheduleEntryId: entryId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('IN_PROGRESS');

    // Exactly one PM_STARTED row, for the surviving execution — a refused start
    // must not leave an audit row claiming it happened.
    const audits = await prisma.auditTrail.findMany({
      where: { action: 'PM_STARTED', userId: ctx.userId },
      select: { targetId: true },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].targetId).toBe(rows[0].id);
  });
});
