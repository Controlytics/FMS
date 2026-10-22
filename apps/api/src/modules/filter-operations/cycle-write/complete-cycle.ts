/**
 * Close a cleaning cycle as COMPLETED, inside the caller's transaction.
 *
 * The ONE completion write set (2026-10-22). It was written out twice, word for
 * word, in executeAdvanceTx (a final stage with nothing after it) and
 * executeChecklistTx (the checklist after the final stage), and a third caller
 * now needs it: the QA approval of a final gated stage with no checklist after
 * it (stage-approvals approve()), which is that stage's completing act.
 *
 *  - cycle → COMPLETED at `completedAt` (the operator's offline instant on a
 *    replay, so the cycle, the event and lastCleaningDate agree);
 *  - FilterDetails → no current cycle, terminal CLEANING_CYCLE_COMPLETED state;
 *  - the typed filter's lastCleaningDate → the LOCAL calendar day;
 *  - a checksummed CYCLE_COMPLETED event and a CYCLE_COMPLETED audit row, both
 *    by `ctx` — whoever performed the completing act.
 */
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { withClientOpId } from '../../../lib/idempotency.js';
import { computeChecksum, toLocalDateString } from '../helpers.js';

export async function completeCycleTx(
  tx: Prisma.TransactionClient,
  args: {
    filterId: string;
    cycleId: string;
    sequenceNumber: number;
    ctx: RequestContext;
    /** The stage the cycle ends at (recorded on the audit row). */
    finalStage: string | null;
    /** Offline replay: the operator's instant. Otherwise now. */
    offlineTime?: Date | null;
    clientOpId?: string | null;
    /** Extra attributes for the CYCLE_COMPLETED event (e.g. the approval that completed it). */
    attributes?: Record<string, unknown>;
  },
): Promise<void> {
  const { filterId, cycleId, ctx, offlineTime } = args;
  const completedAt = offlineTime ?? new Date();
  await tx.cleaningCycle.update({
    where: { id: cycleId },
    data: { status: 'COMPLETED', completedAt },
  });
  // 2026-06-02: completion leaves the filter in the terminal
  // CLEANING_CYCLE_COMPLETED state (was null/Idle). currentCycleId is cleared,
  // so getCurrentState/start-cycle treat the filter as available.
  await tx.filterDetails.update({
    where: { assetInstanceId: filterId },
    data: { currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' },
  });
  // "Last Cleaned" = the completion day. LOCAL calendar day (not UTC) so a
  // completion near local midnight isn't stamped a day early. jsonb_set merges;
  // the filters → asset_instances mirror keeps the legacy row in sync.
  const cleanDate = toLocalDateString(completedAt);
  await tx.$executeRaw`UPDATE filters SET attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{lastCleaningDate}', to_jsonb(${cleanDate}::text), true) WHERE id = ${filterId}::uuid`;

  const completeEvent = {
    filterId, cycleId, eventType: 'CYCLE_COMPLETED' as const,
    performedBy: ctx.userSub,
    attributes: withClientOpId({ sequenceNumber: args.sequenceNumber, ...(args.attributes ?? {}) }, args.clientOpId ?? null),
  };
  await tx.filterEvent.create({
    data: {
      ...completeEvent,
      checksum: computeChecksum(completeEvent),
      ipAddress: ctx.ipAddress,
      telemetrySnapshot: {},
      // Audit 2026-09-24 (F6): on offline replay the completion event carries the
      // same instant as cycle.completedAt / lastCleaningDate.
      ...(offlineTime ? { performedAt: offlineTime } : {}),
    },
  });
  // Audit 2026-09-24 (F13): completion gets its own audit row.
  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'CYCLE_COMPLETED',
    targetType: 'filter', targetId: filterId,
    afterValue: { cycleId, completedAt, finalStage: args.finalStage },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  }, tx);
}
