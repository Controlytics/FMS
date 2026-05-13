/**
 * Filter Operations — terminateCycle() implementation.
 *
 * Extracted byte-for-byte from filter-operations.service.ts. The orchestrator
 * (FilterOperationsService.terminateCycle) is now a thin forward to this
 * function. Pure module-decomposition move; no behavioral changes.
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { findExistingByClientOpId, withClientOpId } from '../../../lib/idempotency.js';
import { validateOfflinePerformedAt } from '../../../lib/offline-time-window.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import { computeChecksum } from '../helpers.js';
import { lockAndVerifyFilterState } from './locking.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

export async function terminateCycleImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: { justification: string; clientOpId?: string; tapeVersion?: number; offlinePerformedAt?: string },
) {
  // Server-only: idempotent replay short-circuits before touching shared guards.
  const clientOpId: string | null = data.clientOpId ?? null;
  if (clientOpId && await findExistingByClientOpId(filterId, clientOpId)) {
    return service.getCurrentState(ctx, filterId);
  }

  // Server-only: HTML escape (input sanitization) before guards.
  const justification = typeof data.justification === 'string'
    ? data.justification.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : '';

  // Phase 8.5 Commit 3: drop pure guards through the shared executor.
  const { ctx: localCtx, filterCurrentCycleId, rawCycle: cycle } = await loadLocalContext(filterId, ctx);
  throwIfFailed(executor.assertCycleActive(localCtx));

  // Audit 2026-05-04 fix C2 parity: validate offlinePerformedAt with
  // cycle.startedAt floor (terminate inherits the floor from the cycle
  // it's terminating).
  const offlineTime = validateOfflinePerformedAt(data.offlinePerformedAt, {
    isReplay: ctx.isOfflineReplay === true,
    cycleStartedAt: cycle?.startedAt ?? null,
  });

  throwIfFailed(executor.assertTapeVersionFresh(localCtx, data.tapeVersion));
  throwIfFailed(
    executor.assertJustificationValid(localCtx, justification, { kind: 'terminate' }),
  );

  // Phase 8.7 follow-up: snapshot the pre-lock state so the in-txn recheck can
  // detect a concurrent operator who advanced the filter or terminated/restarted
  // its cycle between loadLocalContext() and the row lock acquiring.
  const fromState = localCtx.filter.currentLifecycleState;

  await prisma.$transaction(async (tx) => {
    // Phase 8.7 follow-up: SELECT FOR UPDATE row lock — mirrors the advance()
    // pattern. Without this the audit-flagged race
    // (AUDIT-2026-05-02-concurrent-operator.md lines 83-87) lets two
    // concurrent terminate calls both succeed, or lets a terminate win against
    // an in-flight advance that already swapped the cycle.
    await lockAndVerifyFilterState(tx, filterId, fromState, filterCurrentCycleId);

    await tx.cleaningCycle.update({
      where: { id: filterCurrentCycleId! },
      data: { status: 'TERMINATED', completedAt: new Date() },
    });
    // currentCycleId + currentLifecycleState moved to FilterDetails (Step 6).
    await tx.filterDetails.update({
      where: { assetInstanceId: filterId },
      data: { currentCycleId: null, currentLifecycleState: null },
    });
    const eventData = {
      filterId, cycleId: filterCurrentCycleId!, eventType: 'CYCLE_TERMINATED' as const,
      performedBy: ctx.userSub, attributes: withClientOpId({ justification }, clientOpId),
      remarks: justification,
    };
    await tx.filterEvent.create({
      data: {
        ...eventData,
        checksum: computeChecksum(eventData),
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
        ...(offlineTime ? { performedAt: offlineTime } : {}),
      },
    });
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'CYCLE_TERMINATED',
    targetType: 'filter', targetId: filterId,
    afterValue: { cycleId: filterCurrentCycleId, justification },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return service.getCurrentState(ctx, filterId);
}
