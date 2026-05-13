/**
 * Filter Operations — bypass() implementation.
 *
 * Extracted byte-for-byte from filter-operations.service.ts. The orchestrator
 * (FilterOperationsService.bypass) is now a thin forward to this function.
 * Pure module-decomposition move; no behavioral changes.
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingByClientOpId, withClientOpId } from '../../../lib/idempotency.js';
import { validateOfflinePerformedAt } from '../../../lib/offline-time-window.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import { computeChecksum } from '../helpers.js';
import { lockAndVerifyFilterState } from './locking.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function bypassImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const { targetState, parameters } = data;
  // Server-only: HTML escape (input sanitization) before guards.
  const justification = typeof data.justification === "string"
    ? data.justification.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : data.justification;
  // Server-only: idempotent replay short-circuits before touching shared guards.
  const clientOpId: string | null = data.clientOpId ?? null;
  if (clientOpId && await findExistingByClientOpId(filterId, clientOpId)) {
    return service.getCurrentState(ctx, filterId);
  }

  // Phase 8.5 Commit 3: drop pure guards through the shared executor.
  const { ctx: localCtx, cp, filterCurrentCycleId, rawCycle: cycle } = await loadLocalContext(filterId, ctx);
  throwIfFailed(executor.assertCycleActive(localCtx));

  // Audit 2026-05-04 fix C2 parity (start-cycle/advance/submit-checklist
  // already wired): validate offlinePerformedAt against cycle.startedAt
  // floor + replay-only + future-skew + max-staleness. See
  // apps/api/src/lib/offline-time-window.ts.
  const offlineTime = validateOfflinePerformedAt(data.offlinePerformedAt, {
    isReplay: ctx.isOfflineReplay === true,
    cycleStartedAt: cycle?.startedAt ?? null,
  });

  throwIfFailed(executor.assertTapeVersionFresh(localCtx, data.tapeVersion));
  // Phase 8.6: assertProfileActive enforces both null-check + status='ACTIVE'.
  // Bypass requires an active profile to read flowMode + valid states.
  throwIfFailed(executor.assertProfileActive(localCtx, cp ? localCtx.profile : null));
  if (!cp) {
    throw new AppError(400, 'PROFILE_DISABLED', 'Cleaning profile is disabled or not found.');
  }
  throwIfFailed(executor.assertBypassAllowed(localCtx, cp.flowMode));
  const validStates = cp.stages.filter(s => s.nodeType === 'STAGE' && s.stateKey).map(s => s.stateKey);
  throwIfFailed(executor.assertBypassTargetStateValid(localCtx, targetState, validStates));
  throwIfFailed(executor.assertJustificationValid(localCtx, justification, { kind: 'bypass' }));

  const fromState = localCtx.filter.currentLifecycleState;

  const eventData = {
    filterId, cycleId: filterCurrentCycleId ?? undefined,
    eventType: 'BYPASS_DEVIATION' as const,
    fromState, toState: targetState,
    performedBy: ctx.userSub,
    attributes: withClientOpId(parameters ?? {}, clientOpId),
    deviationDetails: { type: 'BYPASS', fromState, toState: targetState, justification },
    remarks: justification,
  };
  const checksum = computeChecksum(eventData);

  await prisma.$transaction(async (tx) => {
    // Phase 5b.4: SELECT FOR UPDATE row lock — prevents concurrent bypass
    // and concurrent advance from interleaving on the same filter.
    // Phase 8.7 follow-up: also rechecks current_cycle_id (was missing — see
    // AUDIT-2026-05-02-concurrent-operator.md). A cycle-id swap behind a
    // bypass write would otherwise silently record BYPASS_DEVIATION against
    // the pre-lock cycle.
    await lockAndVerifyFilterState(tx, filterId, fromState, filterCurrentCycleId);

    await tx.filterEvent.create({
      data: {
        ...eventData,
        checksum,
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
        ...(offlineTime ? { performedAt: offlineTime } : {}),
      },
    });

    // currentLifecycleState moved to FilterDetails (Step 6).
    await tx.filterDetails.update({
      where: { assetInstanceId: filterId },
      data: { currentLifecycleState: targetState },
    });
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'BYPASS_DEVIATION',
    targetType: 'filter', targetId: filterId,
    beforeValue: { state: fromState },
    afterValue: { state: targetState, justification },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return service.getCurrentState(ctx, filterId);
}
