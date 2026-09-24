import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { resolvePmReasonKeys } from './pm-shared.js';
import { formatConfiguredDate } from '../../lib/format-datetime.js';

/**
 * "An earlier scheduled PM for this AHU was never done" — detection and write-off
 * (2026-08-27).
 *
 * PM tasks STACK: an unmet March visit does not stop April's from appearing, and
 * nothing used to stop an operator cleaning for April while March sat unresolved.
 * Worse, the credit rule in pm-due-tasks.ts gives an overdue entry no upper bound
 * (`windowClosed || completedAt <= windowEnd`), so the April cleaning would
 * silently mark March done too — a PM recorded as performed on a day nobody
 * performed it.
 *
 * So: starting a PM cleaning on an AHU that still owes an earlier PM is refused
 * until the operator says, per task, why that one was not done. The reason is
 * stored on the entry (`skipReason` and friends) and on its deviation
 * (`closureKind = SKIPPED`).
 *
 * ## A skipped task is NOT a completed task
 *
 * `skippedAt` is deliberately a separate terminal state. The entry is never
 * marked cleaned, no PmExecution is written, and the UI shows "Not Performed"
 * in amber rather than a green Completed. Writing off a missed PM is a signed
 * statement that scheduled maintenance did NOT happen; recording it as done
 * would be a false record.
 *
 * ## Why this must be stored rather than derived
 *
 * Every other task status in pm-due-tasks.ts is computed at read time from
 * cleaning-cycle timestamps. "Skipped" has no cleaning behind it — it is an
 * operator assertion, and a §11 record needs who / when / why on the row itself.
 */

export interface PendingPmTask {
  entryId: string;
  scheduleId: string;
  ahuId: string;
  ahuName: string;
  plannedDate: Date;
  windowStart: Date;
  windowEnd: Date;
  overdueDays: number;
}

const DAY = 86_400_000;

/**
 * Earlier PM visits for the AHU above `filterId` that are overdue and still
 * unresolved.
 *
 * "Unresolved" means: the window has closed, the entry has not been written off,
 * and no PM-reason cleaning has actually been performed for it. The last test
 * uses the SAME predicate pm-due-tasks.ts uses to call a task done — if the two
 * disagreed, the popup would demand a reason for a task the task list already
 * showed as complete.
 */
export async function getPendingEarlierPmTasks(
  filterId: string,
  now: Date = new Date(),
): Promise<PendingPmTask[]> {
  const filter = await prisma.assetInstance.findUnique({
    where: { id: filterId },
    select: { id: true, parentId: true },
  });
  if (!filter?.parentId) return [];
  const ahuId = filter.parentId;

  const entries = await prisma.pmScheduleEntry.findMany({
    where: {
      schedule: { entityId: ahuId, status: 'ACTIVE' },
      windowEnd: { lt: now },
      skippedAt: null,
      // An entry still awaiting review/approval is not yet an obligation.
      approvalStatus: 'APPROVED',
    },
    select: {
      id: true, scheduleId: true, plannedDate: true, windowStart: true, windowEnd: true,
      schedule: { select: { entityId: true } },
    },
    orderBy: { plannedDate: 'asc' },
  });
  if (entries.length === 0) return [];

  // Sibling filters under the same AHU — a PM covers the AHU, and the task is
  // satisfied by cleaning its filters, so credit is looked up across all of them.
  const siblings = await prisma.assetInstance.findMany({
    where: { parentId: ahuId, isActive: true, status: { not: 'Retired' } },
    select: { id: true },
  });
  const siblingIds = siblings.map((s) => s.id);
  if (siblingIds.length === 0) return [];

  const pmReasonKeys = await resolvePmReasonKeys();
  const earliestWindow = entries[0].windowStart;

  const cycles = await prisma.cleaningCycle.findMany({
    where: { filterId: { in: siblingIds }, status: 'COMPLETED', completedAt: { gte: earliestWindow } },
    select: { completedAt: true, cleaningReasonKey: true },
  });
  const pmCycles = cycles.filter(
    (c) => c.completedAt != null && (!pmReasonKeys || pmReasonKeys.has(c.cleaningReasonKey)),
  );

  const ahu = await prisma.assetInstance.findUnique({ where: { id: ahuId }, select: { name: true } });

  const pending: PendingPmTask[] = [];
  for (const e of entries) {
    // Mirrors pm-due-tasks.ts: for a CLOSED window, any PM cleaning on or after
    // windowStart counts. That upper-boundless rule is exactly what this gate
    // exists to stop being applied silently — but while an entry is genuinely
    // satisfied by a real cleaning we must not ask for a reason.
    const satisfied = pmCycles.some((c) => c.completedAt! >= e.windowStart);
    if (satisfied) continue;
    pending.push({
      entryId: e.id,
      scheduleId: e.scheduleId,
      ahuId,
      ahuName: ahu?.name ?? 'this AHU',
      plannedDate: e.plannedDate,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      overdueDays: Math.max(0, Math.floor((now.getTime() - e.windowEnd.getTime()) / DAY)),
    });
  }
  return pending;
}

export interface PmSkipInput {
  entryId: string;
  reason: string;
}

/** Minimum characters for a write-off reason — this is a §11 justification. */
export const MIN_SKIP_REASON = 5;

/**
 * Write off the named entries with their reasons, and close each one's overdue
 * deviation as SKIPPED.
 *
 * Runs inside the caller's transaction when one is given, so the write-off and
 * the cleaning that prompted it commit or roll back together — a reason recorded
 * for a cleaning that never started would be a phantom justification.
 */
export async function applyPmSkips(
  skips: PmSkipInput[],
  pending: PendingPmTask[],
  actor: { userSub?: string; userId?: string; userRole?: string; ipAddress?: string; userAgent?: string },
  tx: any = prisma,
): Promise<void> {
  const byId = new Map(pending.map((p) => [p.entryId, p]));
  const now = new Date();

  for (const s of skips) {
    const task = byId.get(s.entryId);
    if (!task) continue; // not pending — nothing to write off
    const reason = s.reason.trim();

    await tx.pmScheduleEntry.update({
      where: { id: s.entryId },
      data: {
        skippedAt: now,
        skippedBy: actor.userSub ?? null,
        skippedByName: actor.userId ?? null,
        skipReason: reason,
      },
    });

    // Close the deviation this entry raised, if the sweep had opened one. Marked
    // SKIPPED, never "completed" — the maintenance did not happen.
    await tx.deviation.updateMany({
      where: { pmScheduleEntryId: s.entryId, status: { not: 'CLOSED' } },
      data: {
        status: 'CLOSED',
        closedAt: now,
        closureKind: 'SKIPPED',
        closureReason: reason,
      },
    });

    await auditLog({
      userId: actor.userId,
      userRole: actor.userRole,
      action: 'PM_TASK_SKIPPED',
      targetType: 'pm_schedule_entry',
      targetId: s.entryId,
      afterValue: {
        ahuName: task.ahuName,
        plannedDate: task.plannedDate,
        overdueDays: task.overdueDays,
        skipReason: reason,
      },
      reason,
      signatureMeaning:
        `Scheduled PM for "${task.ahuName}" on ${await formatConfiguredDate(task.plannedDate)} ` +
        `was NOT performed; written off with a reason at cleaning start`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    }, tx === prisma ? undefined : tx);
  }
}

/**
 * Every AHU that still owes an earlier PM, keyed by AHU id — the tablet's
 * offline cache for the dialog.
 *
 * Computed by reusing `getPendingEarlierPmTasks` per candidate AHU rather than
 * with a bespoke bulk query: one definition of "pending" means the cached answer
 * and the server's gate can never disagree, which is the whole point of caching
 * it. The candidate set is small (AHUs with an overdue approved entry), so the
 * per-AHU cost is acceptable.
 */
export async function getPendingPmTasksMap(
  now: Date = new Date(),
): Promise<Record<string, PendingPmTask[]>> {
  const overdueEntries = await prisma.pmScheduleEntry.findMany({
    where: {
      schedule: { status: 'ACTIVE' },
      approvalStatus: 'APPROVED',
      windowEnd: { lt: now },
      skippedAt: null,
    },
    select: { schedule: { select: { entityId: true } } },
  });
  const ahuIds = [...new Set(overdueEntries.map((e) => e.schedule.entityId))];
  if (ahuIds.length === 0) return {};

  // getPendingEarlierPmTasks takes a FILTER id (it walks up to the AHU), so pick
  // any live child filter per AHU as the probe.
  const probes = await prisma.assetInstance.findMany({
    where: { parentId: { in: ahuIds }, isActive: true, status: { not: 'Retired' } },
    select: { id: true, parentId: true },
  });
  const probeByAhu = new Map<string, string>();
  for (const p of probes) if (p.parentId && !probeByAhu.has(p.parentId)) probeByAhu.set(p.parentId, p.id);

  const out: Record<string, PendingPmTask[]> = {};
  for (const ahuId of ahuIds) {
    const probe = probeByAhu.get(ahuId);
    if (!probe) continue; // AHU with no filters — nothing to clean, nothing to gate
    const pending = await getPendingEarlierPmTasks(probe, now);
    if (pending.length > 0) out[ahuId] = pending;
  }
  return out;
}
