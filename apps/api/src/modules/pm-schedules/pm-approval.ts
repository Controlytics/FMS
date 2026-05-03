/**
 * PM Schedules — entry-level QA approval workflow.
 *
 * Each PmScheduleEntry carries an `approvalStatus` (PENDING/APPROVED/REJECTED)
 * and an optional pending edit (pendingPlannedDate / pendingToleranceDays).
 * Approve applies any pending edit; reject clears it. Re-submit moves a
 * REJECTED entry back to PENDING. Edit-approved stages a proposed change
 * onto an APPROVED entry and flips it to PENDING for QA.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { checkPmEnabled } from './pm-shared.js';

/** Check if the current user's role is allowed to approve PM schedules. */
async function assertPmApprovalRole(userRole: string | undefined) {
  if (userRole === 'SUPER_ADMIN') return;
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-approval' } });
  const configured = (cfg?.configValue as any)?.approvalRole;
  if (!configured || configured.trim() === '') return;
  if (userRole !== configured) {
    throw new AppError(403, 'FORBIDDEN_ROLE', `Only users with role "${configured}" can approve PM schedules`);
  }
}

/** List schedule entries with approval status for the PM Schedules table. */
export async function listEntries(
  _ctx: RequestContext,
  query: { approvalStatus?: string; year?: number; page?: number; limit?: number },
) {
  await checkPmEnabled();
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 200);
  const year = query.year ?? new Date().getFullYear();

  const where: any = {
    schedule: { status: 'ACTIVE', year },
  };
  if (query.approvalStatus && query.approvalStatus !== 'ALL') {
    where.approvalStatus = query.approvalStatus;
  }

  const [entries, total] = await Promise.all([
    prisma.pmScheduleEntry.findMany({
      where,
      include: { schedule: true },
      orderBy: { plannedDate: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pmScheduleEntry.count({ where }),
  ]);

  // Resolve AHU names from entityIds
  const entityIds = [...new Set(entries.map((e: any) => e.schedule?.entityId).filter(Boolean))];
  const ahus = entityIds.length > 0
    ? await prisma.assetInstance.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
    : [];
  const ahuMap = new Map(ahus.map(a => [a.id, a.name]));

  const data = entries.map((e: any) => ({
    id: e.id,
    scheduleId: e.scheduleId,
    ahuId: e.schedule?.entityId,
    ahuName: ahuMap.get(e.schedule?.entityId) ?? '?',
    month: e.month,
    plannedDate: e.plannedDate,
    toleranceDays: e.toleranceDays,
    windowStart: e.windowStart,
    windowEnd: e.windowEnd,
    approvalStatus: e.approvalStatus,
    approvalRemarks: e.approvalRemarks,
    approvedByName: e.approvedByName,
    approvedAt: e.approvedAt,
    submittedByName: e.submittedByName,
    pendingPlannedDate: e.pendingPlannedDate,
    pendingToleranceDays: e.pendingToleranceDays,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** Approve selected entries. If an entry has a pending edit, apply it. */
export async function approveEntries(ctx: RequestContext, entryIds: string[], comment?: string) {
  await checkPmEnabled();
  await assertPmApprovalRole(ctx.userRole);

  const entries = await prisma.pmScheduleEntry.findMany({
    where: { id: { in: entryIds } },
  });
  if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');

  const results: string[] = [];
  for (const entry of entries) {
    if (entry.approvalStatus !== 'PENDING') {
      results.push(`${entry.id}: already ${entry.approvalStatus}`);
      continue;
    }

    // If there's a pending edit, apply it
    const hasPendingEdit = entry.pendingPlannedDate != null;
    const newPlannedDate = hasPendingEdit ? entry.pendingPlannedDate! : entry.plannedDate;
    const newTolerance = hasPendingEdit && entry.pendingToleranceDays != null ? entry.pendingToleranceDays : entry.toleranceDays;
    const windowStart = new Date(newPlannedDate.getTime() - newTolerance * 86400000);
    const windowEnd = new Date(newPlannedDate.getTime() + newTolerance * 86400000);

    await prisma.pmScheduleEntry.update({
      where: { id: entry.id },
      data: {
        approvalStatus: 'APPROVED',
        approvalRemarks: comment ?? null,
        approvedBy: ctx.userSub,
        approvedByName: ctx.userId,
        approvedAt: new Date(),
        // Apply pending edit if present
        ...(hasPendingEdit ? {
          plannedDate: newPlannedDate,
          toleranceDays: newTolerance,
          windowStart,
          windowEnd,
          pendingPlannedDate: null,
          pendingToleranceDays: null,
          pendingEditBy: null,
          pendingEditAt: null,
        } : {}),
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_APPROVED',
      targetType: 'pm_schedule_entry', targetId: entry.id,
      afterValue: { comment, hasPendingEdit },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });
    results.push(`${entry.id}: approved`);
  }

  return { processed: results.length, results };
}

/** Reject selected entries with mandatory remarks. */
export async function rejectEntries(ctx: RequestContext, entryIds: string[], remarks: string) {
  await checkPmEnabled();
  await assertPmApprovalRole(ctx.userRole);
  if (!remarks || remarks.trim().length < 3) {
    throw new AppError(400, 'REMARKS_REQUIRED', 'Remarks are required when rejecting (min 3 characters)');
  }

  const entries = await prisma.pmScheduleEntry.findMany({
    where: { id: { in: entryIds } },
  });
  if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');

  for (const entry of entries) {
    if (entry.approvalStatus !== 'PENDING') continue;
    await prisma.pmScheduleEntry.update({
      where: { id: entry.id },
      data: {
        approvalStatus: 'REJECTED',
        approvalRemarks: remarks.trim(),
        approvedBy: ctx.userSub,
        approvedByName: ctx.userId,
        approvedAt: new Date(),
        // Clear pending edit if any
        pendingPlannedDate: null,
        pendingToleranceDays: null,
        pendingEditBy: null,
        pendingEditAt: null,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_REJECTED',
      targetType: 'pm_schedule_entry', targetId: entry.id,
      afterValue: { remarks: remarks.trim() },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });
  }

  return { processed: entries.length };
}

/** Re-submit a rejected entry with corrected data. Resets to PENDING. */
export async function resubmitEntry(
  ctx: RequestContext,
  entryId: string,
  data: { plannedDate: string; toleranceDays?: number },
) {
  await checkPmEnabled();
  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
  if (entry.approvalStatus !== 'REJECTED') {
    throw new AppError(400, 'INVALID_STATUS', 'Only rejected entries can be re-submitted');
  }

  const planned = new Date(data.plannedDate);
  if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');
  const tol = data.toleranceDays ?? entry.toleranceDays;
  const windowStart = new Date(planned.getTime() - tol * 86400000);
  const windowEnd = new Date(planned.getTime() + tol * 86400000);

  const updated = await prisma.pmScheduleEntry.update({
    where: { id: entryId },
    data: {
      plannedDate: planned,
      toleranceDays: tol,
      windowStart,
      windowEnd,
      approvalStatus: 'PENDING',
      approvalRemarks: null,
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      submittedBy: ctx.userSub,
      submittedByName: ctx.userId,
    },
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_RESUBMITTED',
    targetType: 'pm_schedule_entry', targetId: entryId,
    afterValue: { plannedDate: data.plannedDate, toleranceDays: tol },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return updated;
}

/** Edit an approved entry — stores proposed values in pending columns, sets status to PENDING. */
export async function editApprovedEntry(
  ctx: RequestContext,
  entryId: string,
  data: { plannedDate: string; toleranceDays?: number },
) {
  await checkPmEnabled();
  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
  if (entry.approvalStatus !== 'APPROVED') {
    throw new AppError(400, 'INVALID_STATUS', 'Only approved entries can be edited (pending changes require approval)');
  }

  const planned = new Date(data.plannedDate);
  if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');

  const updated = await prisma.pmScheduleEntry.update({
    where: { id: entryId },
    data: {
      pendingPlannedDate: planned,
      pendingToleranceDays: data.toleranceDays ?? entry.toleranceDays,
      pendingEditBy: ctx.userSub,
      pendingEditAt: new Date(),
      approvalStatus: 'PENDING',
      approvalRemarks: null,
      approvedBy: null,
      approvedByName: null,
      approvedAt: null,
      submittedBy: ctx.userSub,
      submittedByName: ctx.userId,
    },
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_EDIT_REQUESTED',
    targetType: 'pm_schedule_entry', targetId: entryId,
    beforeValue: { plannedDate: entry.plannedDate, toleranceDays: entry.toleranceDays },
    afterValue: { pendingPlannedDate: data.plannedDate, pendingToleranceDays: data.toleranceDays ?? entry.toleranceDays },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return updated;
}

/** Get counts of PENDING and REJECTED entries for the status badge. */
export async function pendingCounts(_ctx: RequestContext) {
  await checkPmEnabled();
  const baseWhere = { schedule: { status: 'ACTIVE' as const } };
  const [pending, rejected] = await Promise.all([
    prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'PENDING' } }),
    prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'REJECTED' } }),
  ]);
  return { pending, rejected };
}
