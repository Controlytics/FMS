/**
 * PM Schedules — the missed-PM reason gate.
 *
 * Fired from `start-cycle.ts` when a PM cleaning is about to begin on a filter
 * whose AHU still has an unresolved PM task from an earlier period. The
 * operator must account for that older task before the new work is recorded.
 * Two documented ways out, both requiring a written reason:
 *
 *   COMPLETE_LATE  "I am performing that missed PM now."
 *                  → the cycle BINDS to the old entry, which is what lets a
 *                    late completion credit it (see `cycleCreditsEntry`).
 *                    The PM happened, late, and is recorded as such.
 *
 *   SKIP           "I am doing this period's PM instead; here is why the
 *                  earlier one was not done."
 *                  → the old entry is written off with `skippedAt` + reason and
 *                    its deviation closes as SKIPPED. It is NOT marked complete:
 *                    the PM did not happen, and recording it as done would put a
 *                    false statement in the audit trail (21 CFR §11).
 *
 * The gate is SOFT — it never blocks the work, it demands an explanation. It is
 * enforced server-side; the dialog is only the client's way of collecting the
 * answer. A client that omits the payload gets a 409 carrying the entry list so
 * it can ask and retry.
 */

import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { stripHtml } from '../../lib/sanitize.js';
import { getPendingContextForFilter, type AhuPendingContext } from './pm-pending-context.js';
import { resolvePmReasonKeys } from './pm-shared.js';

/** Shortest acceptable justification. Long enough to be a statement, not a keystroke. */
export const MIN_REASON_LENGTH = 10;

export interface PmTaskPayload {
  /** Performing one overdue task late. */
  completeLate?: { pmScheduleEntryId: string; reason: string };
  /** Writing off overdue tasks, one reason each. */
  skips?: Array<{ pmScheduleEntryId: string; reason: string }>;
}

export interface PmGateOutcome {
  /** Entry this cycle is being performed FOR, stamped on CleaningCycle. */
  bindEntryId: string | null;
  /** Applied after the cycle commits — see `applyPmGate`. */
  apply: ((cycleId: string) => Promise<void>) | null;
}

function cleanReason(raw: unknown, label: string): string {
  const reason = typeof raw === 'string' ? stripHtml(raw).trim() : '';
  if (reason.length < MIN_REASON_LENGTH) {
    throw new AppError(
      400, 'PM_REASON_REQUIRED',
      `A reason of at least ${MIN_REASON_LENGTH} characters is required to ${label}.`,
    );
  }
  return reason;
}

/**
 * Resolve the gate for a starting cycle.
 *
 * Returns what to bind and a deferred `apply`. Nothing is written here: the
 * caller runs `apply` once the cycle row exists, so a cycle that fails to start
 * never leaves a PM task written off behind it.
 */
export async function resolvePmGate(
  ctx: RequestContext,
  filterId: string,
  payload: PmTaskPayload | undefined,
  cleaningReasonKey: string,
): Promise<PmGateOutcome> {
  // Only a PM cleaning interacts with PM tasks. A breakdown or ad-hoc clean
  // neither satisfies nor is blocked by one, so demanding an explanation for a
  // missed PM there would be noise on unrelated work.
  //
  // `resolvePmReasonKeys()` returning null means no PM reason is configured at
  // all - nothing distinguishes a scheduled PM from any other cleaning, so the
  // gate stays out of the way rather than challenging every clean.
  const pmReasonKeys = await resolvePmReasonKeys();
  if (!pmReasonKeys || !pmReasonKeys.has(cleaningReasonKey)) {
    return { bindEntryId: null, apply: null };
  }

  const context = await getPendingContextForFilter(filterId);
  if (!context) return { bindEntryId: null, apply: null };

  const { overdueEntries, currentEntry } = context;

  // Nothing outstanding — bind to the entry actually due, so the credit is
  // explicit rather than inferred from dates.
  if (overdueEntries.length === 0) {
    return { bindEntryId: currentEntry?.entryId ?? null, apply: null };
  }

  if (!payload || (!payload.completeLate && !payload.skips?.length)) {
    throw pendingTaskError(context);
  }

  const overdueIds = new Set(overdueEntries.map((e) => e.entryId));
  const lateId = payload.completeLate?.pmScheduleEntryId ?? null;
  const skips = payload.skips ?? [];

  if (lateId && !overdueIds.has(lateId)) {
    throw new AppError(400, 'PM_ENTRY_NOT_PENDING', 'That PM task is not among this AHU\'s outstanding tasks.');
  }
  for (const s of skips) {
    if (!overdueIds.has(s.pmScheduleEntryId)) {
      throw new AppError(400, 'PM_ENTRY_NOT_PENDING', 'One of the PM tasks being skipped is not outstanding for this AHU.');
    }
  }
  if (lateId && skips.some((s) => s.pmScheduleEntryId === lateId)) {
    throw new AppError(400, 'PM_CONFLICTING_INTENT', 'The same PM task cannot be both performed late and skipped.');
  }

  // EVERY outstanding task must be accounted for. Letting one through
  // unanswered would leave a missed PM silently open behind completed work —
  // the exact gap this gate exists to close.
  const accounted = new Set<string>([...(lateId ? [lateId] : []), ...skips.map((s) => s.pmScheduleEntryId)]);
  const unaccounted = overdueEntries.filter((e) => !accounted.has(e.entryId));
  if (unaccounted.length > 0) throw pendingTaskError({ ...context, overdueEntries: unaccounted });

  // Validate + sanitise every reason BEFORE anything is written.
  const lateReason = payload.completeLate ? cleanReason(payload.completeLate.reason, 'record a late PM') : null;
  const cleanSkips = skips.map((s) => ({
    pmScheduleEntryId: s.pmScheduleEntryId,
    reason: cleanReason(s.reason, 'skip a scheduled PM'),
  }));

  // COMPLETE_LATE binds to the OLD entry (that is the task being performed);
  // otherwise the work counts toward the period actually due.
  const bindEntryId = lateId ?? currentEntry?.entryId ?? null;

  const apply = async (cycleId: string) => {
    await applyPmGate(ctx, {
      cycleId,
      ahuName: context.ahuName,
      completeLate: lateId ? { pmScheduleEntryId: lateId, reason: lateReason! } : null,
      skips: cleanSkips,
    });
  };

  return { bindEntryId, apply };
}

/** The 409 a client turns into the operator dialog. */
function pendingTaskError(context: AhuPendingContext): AppError {
  const list = context.overdueEntries
    .map((e) => `${e.plannedDate.toISOString().slice(0, 10)} (overdue by ${e.overdueDays} day(s))`)
    .join(', ');
  const err = new AppError(
    409,
    'PM_PREVIOUS_TASK_PENDING',
    `A previous scheduled PM for ${context.ahuName} was not completed: ${list}. Record whether it is being performed now or skipped, with a reason.`,
  );
  (err as any).pendingTasks = context.overdueEntries;
  (err as any).ahu = { id: context.ahuId, name: context.ahuName };
  return err;
}

/**
 * Write the gate's decisions. Runs AFTER the cycle exists so a failed start
 * cannot leave a PM task written off with no work behind it.
 */
export async function applyPmGate(
  ctx: RequestContext,
  args: {
    cycleId: string;
    ahuName: string;
    completeLate: { pmScheduleEntryId: string; reason: string } | null;
    skips: Array<{ pmScheduleEntryId: string; reason: string }>;
  },
): Promise<void> {
  const now = new Date();

  if (args.completeLate) {
    const { pmScheduleEntryId, reason } = args.completeLate;
    await prisma.pmScheduleEntry.update({
      where: { id: pmScheduleEntryId },
      data: { lateReason: reason, lateReasonBy: ctx.userSub, lateReasonAt: now },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'PM_TASK_COMPLETED_LATE', targetType: 'pm_schedule_entry', targetId: pmScheduleEntryId,
      afterValue: { ahuName: args.ahuName, cycleId: args.cycleId, reason },
      reason,
      signatureMeaning: `${ctx.userId} started a cleaning to perform the previously-missed scheduled PM for AHU "${args.ahuName}" late, stating: ${reason}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  }

  for (const skip of args.skips) {
    const { pmScheduleEntryId, reason } = skip;
    await prisma.pmScheduleEntry.update({
      where: { id: pmScheduleEntryId },
      data: {
        skippedAt: now, skippedBy: ctx.userSub, skippedByName: ctx.userId, skipReason: reason,
      },
    });

    // Close the deviation the same way, so the Deviations page and the Tasks
    // page cannot tell an inspector different stories. Marked SKIPPED, never
    // COMPLETED_LATE — the PM did not happen.
    const dev = await prisma.deviation.findUnique({ where: { pmScheduleEntryId } });
    if (dev && dev.status !== 'CLOSED') {
      await prisma.deviation.update({
        where: { id: dev.id },
        data: {
          status: 'CLOSED', closureKind: 'SKIPPED', closureReason: reason,
          closedAt: now, completedBy: null, completedByName: null,
        },
      });
      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole,
        action: 'DEVIATION_CLOSED', targetType: 'deviation', targetId: dev.id,
        beforeValue: { status: dev.status },
        afterValue: { status: 'CLOSED', closureKind: 'SKIPPED', deviationNumber: dev.deviationNumber },
        reason,
        signatureMeaning: `Deviation ${dev.deviationNumber} closed as SKIPPED — the scheduled PM for AHU "${args.ahuName}" was NOT performed; ${ctx.userId} recorded: ${reason}`,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'PM_TASK_SKIPPED', targetType: 'pm_schedule_entry', targetId: pmScheduleEntryId,
      afterValue: { ahuName: args.ahuName, cycleId: args.cycleId, reason },
      reason,
      signatureMeaning: `${ctx.userId} recorded that the scheduled PM for AHU "${args.ahuName}" was NOT performed and will not be, stating: ${reason}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  }
}

