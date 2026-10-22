/**
 * PM Schedules — add ONE visit on a chosen date (D-OPS-10, operator decision
 * 2026-10-22: "Add a new visit").
 *
 * The web New Schedule dialog used to look up the AHU's schedule for the year
 * and offer to "overwrite" `entries[0]` with the chosen date. An AHU is visited
 * many times a year (see "PM schedules: many irregular visits per AHU" in the
 * root CLAUDE.md), so that edited whichever visit happened to come first and
 * could never add a second one.
 *
 * This is the single-row counterpart of the upload, with the same rules:
 *   - the configured upload role (step 1 of the SoD chain) — assertPmRole;
 *   - the visit enters the approval workflow exactly as an uploaded row does
 *     (submissionApprovalFields, shared with the import and create());
 *   - a date already on the schedule is the SAME visit — refused here with
 *     409 PM_VISIT_EXISTS (the upload skips it; one row has nothing else to do);
 *   - two visits must never be satisfiable by one cleaning — 409
 *     PM_VISIT_OVERLAP against the visits already on the schedule (pre-existing
 *     overlaps between OTHER visits stay grandfathered, as for any single write);
 *   - it never touches an existing visit;
 *   - one audit row, and one QNN per entry, as the upload mints.
 *
 * The year's ACTIVE schedule is found or created in the same transaction as
 * the entry, so a refused visit never leaves an empty schedule behind.
 */
import type { RequestContext } from '../../types/context.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { getDatetimeConfig, formatDateWith } from '../../lib/format-datetime.js';
import { checkPmEnabled, readPmSettings } from './pm-shared.js';
import { getPmWorkflowConfig, assertPmRole, generateQnn } from './pm-workflow.js';
import { assertSeparation } from './pm-separation-guard.js';
import { submissionApprovalFields } from './pm-submission.js';
import { nextScheduleVersion } from './pm-schedule-version.js';

const DAY_MS = 86_400_000;

export interface AddVisitInput {
  entityId: string;
  /** `YYYY-MM-DD` (route schema `format: date`). */
  plannedDate: string;
  /** Defaults to the PM settings' defaultToleranceDays, as an upload row without one does. */
  toleranceDays?: number;
}

export async function addVisit(ctx: RequestContext, data: AddVisitInput) {
  await checkPmEnabled();
  const settings = await readPmSettings();
  const toleranceDays = data.toleranceDays ?? Number(settings.defaultToleranceDays ?? 3);
  const wf = await getPmWorkflowConfig();
  assertPmRole(ctx.userRole, wf.uploadRole, 'upload');

  // Only a live AHU can carry visits — the same candidates the upload resolves names against.
  const ahu = await prisma.assetInstance.findFirst({
    where: { id: data.entityId, isActive: true, template: { templateKind: 'AHU' } },
    select: { id: true, name: true },
  });
  if (!ahu) throw new AppError(404, 'NOT_FOUND', 'AHU not found');

  // UTC midnight, like every stored plannedDate (pm-import.ts parses the same way).
  const [y, m, d] = data.plannedDate.split('-').map(Number);
  const plannedDate = new Date(Date.UTC(y, m - 1, d));
  const year = y;
  const month = m;
  const windowStart = new Date(plannedDate.getTime() - toleranceDays * DAY_MS);
  const windowEnd = new Date(plannedDate.getTime() + toleranceDays * DAY_MS);
  const dtCfg = await getDatetimeConfig();
  const shown = formatDateWith(dtCfg, plannedDate);
  const approvalFields = submissionApprovalFields(ctx, wf);

  const { scheduleId, scheduleCreated, entry } = await prisma.$transaction(async (tx) => {
    const existing = await tx.pmSchedule.findFirst({
      where: { entityId: ahu.id, year, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
      select: { id: true },
    });

    if (existing) {
      const same = await tx.pmScheduleEntry.findFirst({
        where: { scheduleId: existing.id, plannedDate },
        select: { id: true },
      });
      if (same) {
        throw new AppError(409, 'PM_VISIT_EXISTS',
          `${ahu.name} already has a visit on ${shown} in the ${year} schedule. Open that visit to change it instead.`);
      }
      await assertSeparation(existing.id, { plannedDate, toleranceDays }, 'This visit', tx);
    }

    let sid = existing?.id;
    if (!sid) {
      // Next version, not the column default 1 (pm-schedule-version.ts).
      const version = await nextScheduleVersion(tx, ahu.id, year);
      try {
        sid = (await tx.pmSchedule.create({
          data: { entityId: ahu.id, year, version, status: 'ACTIVE', createdBy: ctx.userSub },
          select: { id: true },
        })).id;
      } catch (e: any) {
        // @@unique([entityId, year, version]): another request created this year's schedule first.
        if (e?.code === 'P2002') {
          throw new AppError(409, 'CONFLICT', `The ${year} schedule for ${ahu.name} was just created by another request. Try again.`);
        }
        throw e;
      }
    }

    let created;
    try {
      created = await tx.pmScheduleEntry.create({
        data: { scheduleId: sid, month, plannedDate, toleranceDays, windowStart, windowEnd, ...approvalFields },
      });
    } catch (e: any) {
      // @@unique([scheduleId, plannedDate]): the same date was added concurrently.
      if (e?.code === 'P2002') {
        throw new AppError(409, 'PM_VISIT_EXISTS',
          `${ahu.name} already has a visit on ${shown} in the ${year} schedule. Open that visit to change it instead.`);
      }
      throw e;
    }

    // In the same transaction: a refused or rolled-back visit leaves no audit row
    // claiming it was added (21 CFR §11.10(e)).
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'pm_schedule_entry', targetId: created.id,
      afterValue: {
        name: `${ahu.name} ${data.plannedDate}`, ahuName: ahu.name, entityId: ahu.id,
        scheduleId: sid, year, plannedDate: data.plannedDate, toleranceDays,
        approvalStatus: created.approvalStatus, scheduleCreated: !existing,
      },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    }, tx);

    return { scheduleId: sid, scheduleCreated: !existing, entry: created };
  });

  // One QNN per entry, as the upload mints (after commit — generateQnn writes
  // through its own connection, exactly as on the upload path).
  const pendingSuffix = wf.workflowEnabled ? ' (pending review)' : '';
  const qnn = await generateQnn('UPLOAD', {
    pmScheduleEntryId: entry.id,
    scheduleId,
    ahuName: ahu.name,
    message: `Visit added — ${ahu.name} (${data.plannedDate})${pendingSuffix}`,
  }, ctx);

  return { scheduleId, scheduleCreated, entry, qnn };
}
