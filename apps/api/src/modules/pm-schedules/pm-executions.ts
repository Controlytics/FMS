/**
 * PM Schedules — execution lifecycle: starting an execution against a
 * schedule entry, and updating its status (COMPLETED / OVERDUE / MISSED).
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { checkPmEnabled } from './pm-shared.js';

export async function createExecution(ctx: RequestContext, data: any) {
  await checkPmEnabled();
  const { scheduleEntryId, entityId, filterSet } = data;

  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: scheduleEntryId } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Schedule entry not found');

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

export async function updateExecution(ctx: RequestContext, id: string, data: any) {
  await checkPmEnabled();
  const existing = await prisma.pmExecution.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM execution not found');

  // State machine validation: only IN_PROGRESS executions can be updated
  if (existing.status !== 'IN_PROGRESS') {
    throw new AppError(400, 'VALIDATION_ERROR', `Cannot update execution in ${existing.status} status`);
  }

  const updated = await prisma.pmExecution.update({
    where: { id },
    data: {
      status: data.status,
      completedAt: data.status === 'COMPLETED' ? new Date() : undefined,
      notes: data.notes ?? existing.notes,
    },
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_UPDATED',
    targetType: 'pm_execution', targetId: id,
    beforeValue: { status: existing.status },
    afterValue: { status: updated.status },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return updated;
}
