/**
 * PM Schedules — recurring-series rollover.
 *
 * A recurring schedule is materialised only through 31 Dec of NEXT calendar
 * year (`pm-recurrence.defaultHorizon`). Entries must be REAL rows — the My
 * Tasks query filters on `approvalStatus`, `Deviation.pmScheduleEntryId` is
 * UNIQUE, and `PmExecution.scheduleEntryId` is an FK — so "repeat forever"
 * cannot be a computed view. This job walks the horizon forward: every day it
 * tops up each live series with any occurrence that has come into range,
 * creating the next year's `PmSchedule` row when one is needed.
 *
 * Invariants:
 *  - **Idempotent.** Re-running creates nothing new. Occurrences are keyed by
 *    (scheduleId, month) — the same key the DB enforces — and existing months
 *    are skipped, so a double-run or a retry cannot duplicate a PM task.
 *  - **Never clobbers.** If some OTHER schedule already owns a year for this
 *    AHU, that year is left completely alone and reported in `skipped`. The
 *    job's job is to extend, never to overwrite.
 *  - **Never resurrects.** Only ACTIVE schedules with a `frequencyDays` are
 *    extended; an ARCHIVED (superseded) series is ignored.
 *
 * Trigger: daily cron at 03:30, after the 03:00 overdue sweep — see app.ts.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { checkPmEnabled } from './pm-shared.js';
import { getPmWorkflowConfig } from './pm-workflow.js';
import { generateOccurrences, defaultHorizon } from './pm-recurrence.js';

export interface RolloverResult {
  /** Distinct series examined. */
  seriesChecked: number;
  /** Entries created across all series. */
  entriesCreated: number;
  /** PmSchedule rows created for a newly-reached year. */
  schedulesCreated: number;
  /** Years left alone because another schedule already owns them. */
  skippedYears: Array<{ entityId: string; year: number; reason: string }>;
}

/**
 * Extend every live recurring series up to the current horizon.
 *
 * `ctx` is optional — present when triggered manually by an admin, absent for
 * the cron, in which case the audit row attributes to the system actor.
 */
export async function rolloverSeries(ctx?: RequestContext): Promise<RolloverResult> {
  await checkPmEnabled();

  const horizon = defaultHorizon(new Date());
  const wf = await getPmWorkflowConfig();

  const result: RolloverResult = {
    seriesChecked: 0, entriesCreated: 0, schedulesCreated: 0, skippedYears: [],
  };

  // Every ACTIVE schedule row that belongs to a recurring series. Rows of one
  // series (one per year) are grouped by seriesId below.
  const rows = await prisma.pmSchedule.findMany({
    where: { status: 'ACTIVE', frequencyDays: { not: null }, seriesId: { not: null } },
    include: { entries: { orderBy: { plannedDate: 'desc' } } },
  });

  const bySeries = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.seriesId!;
    const list = bySeries.get(key);
    if (list) list.push(r);
    else bySeries.set(key, [r]);
  }

  for (const [seriesId, scheduleRows] of bySeries) {
    result.seriesChecked++;

    const head = scheduleRows[0];
    const { entityId, frequencyDays, anchorDate } = head;
    // A series row without an anchor cannot be continued — the anchor is what
    // every occurrence is computed from. Skip loudly rather than guessing one
    // from the last entry, which would silently shift the whole schedule.
    if (!frequencyDays || !anchorDate) {
      result.skippedYears.push({ entityId, year: head.year, reason: 'series row has no anchorDate — cannot continue it' });
      continue;
    }

    const allEntries = scheduleRows.flatMap((s) => s.entries);
    if (allEntries.length === 0) {
      result.skippedYears.push({ entityId, year: head.year, reason: 'series has no entries to continue from' });
      continue;
    }

    // Latest materialised date, and the tolerance to carry forward (uniform
    // across a series — every entry was generated with the same value).
    const latest = allEntries.reduce((a, b) => (a.plannedDate > b.plannedDate ? a : b));
    const toleranceDays = latest.toleranceDays;

    const fresh = generateOccurrences({
      anchorDate,
      frequencyDays,
      toleranceDays,
      horizonEnd: horizon,
      after: latest.plannedDate,
    });
    if (fresh.length === 0) continue; // already materialised to the horizon

    // Approval treatment for the new entries. With the workflow ON they must be
    // reviewed and approved like any other entry. With it OFF they inherit
    // whatever the series' most recent entry carries, so a series uploaded by a
    // SUPER_ADMIN (auto-approved) keeps generating usable tasks instead of
    // silently stalling in PENDING once the original window ran out.
    const approvalFields = wf.workflowEnabled
      ? { approvalStatus: 'PENDING_REVIEW' as const }
      : { approvalStatus: latest.approvalStatus, approvedBy: latest.approvedBy, approvedByName: latest.approvedByName, approvedAt: latest.approvedAt };

    const scheduleByYear = new Map<number, string>(scheduleRows.map((s) => [s.year, s.id]));
    const monthsTaken = new Set(
      scheduleRows.flatMap((s) => s.entries.map((e) => `${s.id}::${e.month}`)),
    );

    for (const occ of fresh) {
      let scheduleId = scheduleByYear.get(occ.year);

      if (!scheduleId) {
        // A year this series has not reached before. Refuse to touch it if some
        // other schedule already owns it — extending must never overwrite.
        const owner = await prisma.pmSchedule.findFirst({
          where: { entityId, year: occ.year, status: 'ACTIVE' },
          select: { id: true, seriesId: true },
        });
        if (owner && owner.seriesId !== seriesId) {
          result.skippedYears.push({
            entityId, year: occ.year,
            reason: `year already has a different active PM schedule (${owner.id}) — left untouched`,
          });
          continue;
        }
        if (owner) {
          scheduleId = owner.id;
        } else {
          const createdSchedule = await prisma.pmSchedule.create({
            data: {
              entityId, year: occ.year, status: 'ACTIVE',
              createdBy: head.createdBy,
              frequencyDays, anchorDate, seriesId,
            },
          });
          scheduleId = createdSchedule.id;
          result.schedulesCreated++;
        }
        scheduleByYear.set(occ.year, scheduleId);
      }

      const key = `${scheduleId}::${occ.month}`;
      if (monthsTaken.has(key)) continue; // idempotency guard

      // Re-check against the DB as well: a concurrent run (or a manual trigger
      // overlapping the cron) may have created it since this series was read.
      const clash = await prisma.pmScheduleEntry.findFirst({
        where: { scheduleId, month: occ.month },
        select: { id: true },
      });
      if (clash) { monthsTaken.add(key); continue; }

      await prisma.pmScheduleEntry.create({
        data: {
          scheduleId,
          month: occ.month,
          plannedDate: occ.plannedDate,
          toleranceDays: occ.toleranceDays,
          windowStart: occ.windowStart,
          windowEnd: occ.windowEnd,
          ...approvalFields,
        },
      });
      monthsTaken.add(key);
      result.entriesCreated++;
    }
  }

  if (result.entriesCreated > 0 || result.schedulesCreated > 0) {
    await auditLog({
      userId: ctx?.userSub, userRole: ctx?.userRole ?? 'SYSTEM',
      action: 'PM_SCHEDULE_IMPORTED', targetType: 'pm_schedule', targetId: 'rollover',
      afterValue: {
        seriesChecked: result.seriesChecked,
        entriesCreated: result.entriesCreated,
        schedulesCreated: result.schedulesCreated,
        skippedYears: result.skippedYears,
      },
      reason: `Recurring PM rollover extended ${result.seriesChecked} series — ${result.entriesCreated} new entr(y/ies) across ${result.schedulesCreated} new schedule row(s)`,
      signatureMeaning: 'System extended recurring PM schedules to the current materialisation horizon',
      ipAddress: ctx?.ipAddress ?? '127.0.0.1', userAgent: ctx?.userAgent, sessionId: ctx?.sessionId,
    });
  }

  return result;
}
