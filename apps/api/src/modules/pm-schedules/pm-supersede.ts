/**
 * PM Schedules — supersede a previous recurring series on re-upload.
 *
 * "…until they upload a new schedule for that AHU." A new upload REPLACES the
 * old series. `pm-import.ts` already hard-replaces every year the new file
 * covers, but a previous series can reach FURTHER into the future than the new
 * one does — those later years are untouched by the replace and would keep
 * generating PM tasks from a schedule the operator has already superseded.
 *
 * What this removes, and what it deliberately does not:
 *
 *   REMOVED  future, unexecuted, unresolved entries of the OLD series in years
 *            the new series does not cover. They describe work that has not
 *            happened and is no longer planned.
 *
 *   KEPT     - anything on or before today (it is history),
 *            - anything with a PmExecution (recorded evidence, 21 CFR §11),
 *            - anything skipped or completed-late with a justification
 *              (an operator's signed statement about a missed PM),
 *            - anything with an open Deviation (a live §11 record that must
 *              not lose the row it points at).
 *
 * A schedule row left with no entries at all is ARCHIVED rather than deleted,
 * so the version history of what was once planned survives.
 */
import { prisma } from '../../lib/prisma.js';

export interface SupersedeResult {
  entriesDeleted: number;
  schedulesArchived: number;
  /** Rows kept despite being in a superseded year, with the reason. */
  retained: Array<{ scheduleId: string; month: number; reason: string }>;
}

/**
 * End the previous series for `entityId`, keeping only the years the NEW series
 * covers (`keepYears`) plus everything that counts as evidence.
 *
 * `newSeriesId` is excluded from the sweep so the series just written is never
 * its own victim.
 */
export async function supersedePreviousSeries(
  entityId: string,
  keepYears: number[],
  newSeriesId: string | null,
): Promise<SupersedeResult> {
  const out: SupersedeResult = { entriesDeleted: 0, schedulesArchived: 0, retained: [] };

  const stale = await prisma.pmSchedule.findMany({
    where: {
      entityId,
      status: 'ACTIVE',
      year: { notIn: keepYears },
      // Only a RECURRING schedule is part of a series and therefore superseded
      // by a new one. A one-off schedule in another year was created on its own
      // terms and is none of this function's business.
      seriesId: newSeriesId ? { not: newSeriesId } : { not: null },
      frequencyDays: { not: null },
    },
    include: { entries: true },
  });
  if (stale.length === 0) return out;

  // Today at UTC midnight — entries on or before today are history.
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const allEntryIds = stale.flatMap((s) => s.entries.map((e) => e.id));
  if (allEntryIds.length === 0) {
    // Nothing to weigh — archive the empty shells and stop.
    for (const s of stale) {
      await prisma.pmSchedule.update({ where: { id: s.id }, data: { status: 'ARCHIVED' } });
      out.schedulesArchived++;
    }
    return out;
  }

  // Evidence lookups, batched.
  const [executed, deviated] = await Promise.all([
    prisma.pmExecution.findMany({
      where: { scheduleEntryId: { in: allEntryIds } },
      select: { scheduleEntryId: true },
    }),
    prisma.deviation.findMany({
      where: { pmScheduleEntryId: { in: allEntryIds } },
      select: { pmScheduleEntryId: true },
    }),
  ]);
  const hasExecution = new Set(executed.map((x) => x.scheduleEntryId));
  const hasDeviation = new Set(deviated.map((d) => d.pmScheduleEntryId));

  for (const schedule of stale) {
    const deletable: string[] = [];

    for (const e of schedule.entries) {
      const reason =
        e.plannedDate <= today ? 'already in the past'
        : hasExecution.has(e.id) ? 'has a recorded PM execution'
        : hasDeviation.has(e.id) ? 'has a deviation record'
        : e.skippedAt ? 'skipped with a recorded justification'
        : e.lateReason ? 'completed late with a recorded justification'
        : null;

      if (reason) out.retained.push({ scheduleId: schedule.id, month: e.month, reason });
      else deletable.push(e.id);
    }

    if (deletable.length > 0) {
      const { count } = await prisma.pmScheduleEntry.deleteMany({ where: { id: { in: deletable } } });
      out.entriesDeleted += count;
    }

    // Archive only when nothing at all is left; a schedule still holding
    // retained evidence stays ACTIVE so those rows keep rendering normally.
    if (deletable.length === schedule.entries.length) {
      await prisma.pmSchedule.update({ where: { id: schedule.id }, data: { status: 'ARCHIVED' } });
      out.schedulesArchived++;
    }
  }

  return out;
}
