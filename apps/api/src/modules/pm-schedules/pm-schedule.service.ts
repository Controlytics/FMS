/**
 * PM Schedule Service — CRUD, CSV upload, execution tracking for preventive maintenance.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

function orgFilter(ctx: RequestContext) {
  if (ctx.scope === 'GLOBAL') return {};
  return { organizationId: ctx.organizationId };
}

async function checkPmEnabled() {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-pm-schedule' } });
  const val = cfg?.configValue as any;
  if (!val?.enabled) throw new AppError(404, 'PM_DISABLED', 'PM scheduling module is not enabled');
}

export class PmScheduleService {
  async getByEntity(ctx: RequestContext, entityId: string, year?: number) {
    await checkPmEnabled();
    const targetYear = year ?? new Date().getFullYear();

    const schedule = await prisma.pmSchedule.findFirst({
      where: { entityId, year: targetYear, status: 'ACTIVE' },
      include: {
        entries: {
          orderBy: { month: 'asc' },
          include: { executions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
      orderBy: { version: 'desc' },
    });

    if (!schedule) return null;

    return {
      ...schedule,
      entries: schedule.entries.map(e => ({
        ...e,
        execution: e.executions[0] ?? null,
      })),
    };
  }

  async create(ctx: RequestContext, data: any) {
    await checkPmEnabled();
    const { entityId, year, entries } = data;

    // Check for existing active schedule
    const existing = await prisma.pmSchedule.findFirst({
      where: { entityId, year, status: 'ACTIVE' },
    });
    if (existing) throw new AppError(409, 'CONFLICT', `Active PM schedule already exists for year ${year}`);

    const schedule = await prisma.pmSchedule.create({
      data: {
        entityId,
        year,
        status: 'ACTIVE',
        createdBy: ctx.userSub,
        entries: {
          create: entries.map((e: any) => ({
            month: e.month,
            plannedDate: new Date(e.plannedDate),
            toleranceDays: e.toleranceDays ?? 0,
            windowStart: new Date(new Date(e.plannedDate).getTime() - (e.toleranceDays ?? 0) * 86400000),
            windowEnd: new Date(new Date(e.plannedDate).getTime() + (e.toleranceDays ?? 0) * 86400000),
            notes: e.notes ?? null,
          })),
        },
      },
      include: { entries: { orderBy: { month: 'asc' } } },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'pm_schedule', targetId: schedule.id,
      afterValue: { entityId, year, entryCount: entries.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return schedule;
  }

  async update(ctx: RequestContext, id: string, data: any) {
    await checkPmEnabled();
    const existing = await prisma.pmSchedule.findUnique({
      where: { id },
      include: { entries: true },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM schedule not found');

    // Archive old version
    await prisma.pmSchedule.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    // Create new version
    const newSchedule = await prisma.pmSchedule.create({
      data: {
        entityId: existing.entityId,
        year: existing.year,
        version: existing.version + 1,
        status: 'ACTIVE',
        createdBy: ctx.userSub,
        entries: {
          create: (data.entries ?? []).map((e: any) => ({
            month: e.month,
            plannedDate: new Date(e.plannedDate),
            toleranceDays: e.toleranceDays ?? 0,
            windowStart: new Date(new Date(e.plannedDate).getTime() - (e.toleranceDays ?? 0) * 86400000),
            windowEnd: new Date(new Date(e.plannedDate).getTime() + (e.toleranceDays ?? 0) * 86400000),
            notes: e.notes ?? null,
          })),
        },
      },
      include: { entries: { orderBy: { month: 'asc' } } },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
      targetType: 'pm_schedule', targetId: newSchedule.id,
      beforeValue: { version: existing.version },
      afterValue: { version: newSchedule.version },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return newSchedule;
  }

  async getHistory(ctx: RequestContext, entityId: string) {
    await checkPmEnabled();
    return prisma.pmSchedule.findMany({
      where: { entityId },
      orderBy: [{ year: 'desc' }, { version: 'desc' }],
      select: { id: true, year: true, version: true, status: true, createdAt: true },
    });
  }

  async createExecution(ctx: RequestContext, data: any) {
    await checkPmEnabled();
    const { scheduleEntryId, entityId, filterSet } = data;

    const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: scheduleEntryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Schedule entry not found');

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

  async updateExecution(ctx: RequestContext, id: string, data: any) {
    await checkPmEnabled();
    const existing = await prisma.pmExecution.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM execution not found');

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
}
