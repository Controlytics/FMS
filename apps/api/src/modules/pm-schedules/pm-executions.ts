/**
 * PM Schedules — start a PM execution against a schedule entry.
 *
 * H3 cleanup (2026-05-04 audit): the `updateExecution` helper that flipped
 * `PmExecution.status` to COMPLETED/OVERDUE/MISSED was removed alongside its
 * `PUT /api/pm-executions/:id` route. Completion is derived from cleaning-cycle
 * timestamps in `pm-due-tasks.ts` — `PmExecution.status` is never read by the
 * My Tasks computation, so manually advancing it had no observable effect.
 *
 * Known downstream consequence: `pm-schedule-crud.ts:138` blocks schedule
 * deletion when any `PmExecution.status === 'IN_PROGRESS'`. Without the PUT,
 * that status never advances, so once a PM has been started against an entry
 * the parent schedule is effectively locked. This matches the pre-cleanup
 * reality (no FE caller existed before either) and is left in place — a real
 * "abandon execution" UX would be a deliberate product decision.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { checkPmEnabled } from './pm-shared.js';

export async function createExecution(ctx: RequestContext, data: any) {
  await checkPmEnabled();
  const { scheduleEntryId, filterSet } = data;

  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: scheduleEntryId }, include: { schedule: { select: { entityId: true } } } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Schedule entry not found');
  // Audit 2026-09-24 (C-F12): the AHU comes from the entry's schedule, never from
  // the body (the audited PM_STARTED row could name any asset), and only an
  // APPROVED entry can be executed.
  if (entry.approvalStatus !== 'APPROVED') {
    throw new AppError(409, 'ENTRY_NOT_APPROVED', 'Only an approved PM schedule entry can be executed.');
  }
  const entityId = entry.schedule.entityId;

  // Prevent duplicate IN_PROGRESS executions
  const existing = await prisma.pmExecution.findFirst({
    where: { scheduleEntryId, status: 'IN_PROGRESS' },
  });
  if (existing) throw new AppError(409, 'CONFLICT', 'An execution is already in progress for this entry');

  const now = new Date();
  const isWithinWindow = now >= entry.windowStart && now <= entry.windowEnd;

  const execution = await prisma.pmExecution.create({
    data: {
      scheduleEntryId,
      entityId,
      status: 'IN_PROGRESS',
      startedAt: now,
      performedBy: ctx.userSub,
      isWithinWindow,
      filterSet: filterSet ?? null,
    },
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_STARTED',
    targetType: 'pm_execution', targetId: execution.id,
    afterValue: { entityId, isWithinWindow, filterSet },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return execution;
}
