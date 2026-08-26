/**
 * PM Schedules — top-level schedule CRUD: get-by-entity, create, update
 * (versioning), delete (with in-progress guard), and version history.
 */
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { checkPmEnabled } from './pm-shared.js';
import { generateOccurrences, defaultHorizon, validateFrequency } from './pm-recurrence.js';

/**
 * Normalise the optional `frequencyDays` on a create/update body.
 * Absent, null, empty or 0 all mean "one-off" — the behaviour that existed
 * before recurring schedules, and the default for every legacy caller.
 */
function normaliseFrequency(raw: unknown): number | null {
  if (raw == null || raw === '' || raw === 0) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Invalid frequencyDays "${String(raw)}" — expected a whole number of days`);
  }
  return n;
}

export async function getByEntity(_ctx: RequestContext, entityId: string, year?: number) {
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

export async function create(ctx: RequestContext, data: any) {
  await checkPmEnabled();
  const { entityId, year, entries } = data;
  const frequencyDays = normaliseFrequency(data.frequencyDays);

  // Recurring create takes a separate path: one anchor date expands into a
  // series spanning several calendar years, so it writes several PmSchedule
  // rows rather than one. Everything below this branch is the original
  // one-off behaviour, untouched.
  if (frequencyDays !== null) {
    return createSeries(ctx, { entityId, entries, frequencyDays });
  }

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

/**
 * Create a RECURRING PM schedule from a single anchor date.
 *
 * The occurrences of one series span calendar years, but `PmScheduleEntry` has
 * no year column and `PmSchedule` is unique per (entity, year, version) — so a
 * series is stored as ONE PmSchedule ROW PER YEAR, tied together by a shared
 * `seriesId`. All of them are written in a single transaction: a series that
 * committed only its first year would start generating tasks for a schedule the
 * operator never agreed to.
 */
async function createSeries(
  ctx: RequestContext,
  args: { entityId: string; entries: any[]; frequencyDays: number },
) {
  const { entityId, entries, frequencyDays } = args;

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A recurring schedule needs one entry to use as its anchor date');
  }
  // A frequency already determines every date after the first, so a second
  // supplied entry can only contradict it. Refuse rather than silently
  // discarding whichever one loses.
  if (entries.length > 1) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `A recurring schedule is defined by a single anchor date plus the frequency — received ${entries.length} entries. Send only the first PM date.`,
    );
  }

  const anchor = entries[0];
  const toleranceDays = anchor.toleranceDays ?? 0;

  const freqErr = validateFrequency(frequencyDays, toleranceDays);
  if (freqErr) throw new AppError(400, freqErr.code, freqErr.message);

  const occurrences = generateOccurrences({
    anchorDate: anchor.plannedDate,
    frequencyDays,
    toleranceDays,
    horizonEnd: defaultHorizon(new Date()),
  });

  // Refuse if ANY target year already has an active schedule. Checking only the
  // anchor year would let a series silently collide with an existing schedule
  // in a later year and fail mid-transaction on the unique constraint.
  const years = [...new Set(occurrences.map((o) => o.year))];
  const conflicts = await prisma.pmSchedule.findMany({
    where: { entityId, year: { in: years }, status: 'ACTIVE' },
    select: { year: true },
    orderBy: { year: 'asc' },
  });
  if (conflicts.length > 0) {
    const list = conflicts.map((c) => c.year).join(', ');
    throw new AppError(
      409,
      'CONFLICT',
      `Active PM schedule already exists for year${conflicts.length > 1 ? 's' : ''} ${list}. This recurring schedule would cover ${years.join(', ')}.`,
    );
  }

  const seriesId = randomUUID();
  const anchorDate = occurrences[0].plannedDate;

  const schedules = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const y of years) {
      const forYear = occurrences.filter((o) => o.year === y);
      out.push(
        await tx.pmSchedule.create({
          data: {
            entityId,
            year: y,
            status: 'ACTIVE',
            createdBy: ctx.userSub,
            frequencyDays,
            anchorDate,
            seriesId,
            entries: {
              create: forYear.map((o) => ({
                month: o.month,
                plannedDate: o.plannedDate,
                toleranceDays: o.toleranceDays,
                windowStart: o.windowStart,
                windowEnd: o.windowEnd,
                notes: anchor.notes ?? null,
              })),
            },
          },
          include: { entries: { orderBy: { month: 'asc' } } },
        }),
      );
    }
    return out;
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
    targetType: 'pm_schedule', targetId: schedules[0].id,
    afterValue: {
      entityId, seriesId, frequencyDays,
      anchorDate: anchorDate.toISOString().slice(0, 10),
      years, scheduleCount: schedules.length, entryCount: occurrences.length,
    },
    reason: `Recurring PM schedule created — every ${frequencyDays} days from ${anchorDate.toISOString().slice(0, 10)}, ${occurrences.length} occurrence(s) across ${years.join(', ')}`,
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  // Return the ANCHOR year's schedule so existing callers keep receiving the
  // same shape, with the series summary attached for callers that want it.
  return {
    ...schedules[0],
    series: {
      seriesId,
      frequencyDays,
      anchorDate,
      years,
      scheduleIds: schedules.map((s) => s.id),
      totalEntries: occurrences.length,
    },
  };
}

export async function update(ctx: RequestContext, id: string, data: any) {
  await checkPmEnabled();

  // Validate BEFORE any write: this is archive-then-recreate, so a late throw
  // would leave the old version ARCHIVED with no ACTIVE replacement and
  // silently stop PM task generation for the AHU/year.
  const entries = data.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Schedule must have at least one entry');
  }

  const existing = await prisma.pmSchedule.findUnique({
    where: { id },
    include: { entries: true },
  });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM schedule not found');

  // Archive + recreate atomically — a failure must not strand the schedule
  // with no ACTIVE version.
  const [, newSchedule] = await prisma.$transaction([
    prisma.pmSchedule.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    }),
    prisma.pmSchedule.create({
      data: {
        entityId: existing.entityId,
        year: existing.year,
        version: existing.version + 1,
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
    }),
  ]);

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
    targetType: 'pm_schedule', targetId: newSchedule.id,
    beforeValue: { version: existing.version },
    afterValue: { version: newSchedule.version },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return newSchedule;
}

export async function remove(ctx: RequestContext, id: string) {
  await checkPmEnabled();
  const existing = await prisma.pmSchedule.findUnique({
    where: { id },
    include: { entries: { include: { executions: true } } },
  });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM schedule not found');

  // Check if any executions are in progress
  const inProgress = existing.entries.some(e => e.executions.some(ex => ex.status === 'IN_PROGRESS'));
  if (inProgress) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Cannot delete: schedule has executions in progress');
  }

  // Delete executions, entries, then schedule
  await prisma.$transaction([
    prisma.pmExecution.deleteMany({ where: { scheduleEntryId: { in: existing.entries.map(e => e.id) } } }),
    prisma.pmScheduleEntry.deleteMany({ where: { scheduleId: id } }),
    prisma.pmSchedule.delete({ where: { id } }),
  ]);

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'DELETED',
    targetType: 'pm_schedule', targetId: id,
    beforeValue: { entityId: existing.entityId, year: existing.year, version: existing.version },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return { success: true };
}

export async function getHistory(_ctx: RequestContext, entityId: string) {
  await checkPmEnabled();
  return prisma.pmSchedule.findMany({
    where: { entityId },
    orderBy: [{ year: 'desc' }, { version: 'desc' }],
    select: { id: true, year: true, version: true, status: true, createdAt: true },
  });
}
