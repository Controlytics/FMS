/**
 * Filter Operations — bypass() implementation.
 *
 * Extracted from filter-operations.service.ts. The orchestrator
 * (FilterOperationsService.bypass) is a thin forward to this function.
 *
 * 2026-10-22: entering the target stage follows the SAME rules as an advance
 * into it (stage-entry.ts decideStageEntry). A bypass into the LAST stage used
 * to leave the cycle IN_PROGRESS there with nothing on the tape that finished
 * it — an advance answered CYCLE_COMPLETE — so it could only be terminated.
 * Now it completes the cycle when nothing follows the stage; carries the
 * checklist that follows it in the same call (`answers`, composed with
 * prepareChecklist / executeChecklistTx exactly as advance-with-checklist does);
 * raises the QA approval at a gated final stage (the approval completes it); and
 * at a final Dry In waits for the dryer and its readings.
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { stripHtml } from '../../../lib/sanitize.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingByClientOpId, findExistingByClientOpIdInLatestCycle, withClientOpId } from '../../../lib/idempotency.js';
import { validateOfflinePerformedAt, assertOfflineReplayPayload, latestEventAt } from '../../../lib/offline-time-window.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import { computeChecksum } from '../helpers.js';
import { lockAndVerifyFilterState } from './locking.js';
import {
  assertStageApprovedToLeave,
  getInterlockConfig,
  isInterlockStage,
  requestStageApprovalTx,
  notifyStageApprovalRequested,
} from '../stage-interlock.js';
import { completeCycleTx } from './complete-cycle.js';
import { decideStageEntry } from './stage-entry.js';
import { superAdminExemptionFields, type SuperAdminExemptGate } from '../../../lib/super-admin-own-work.js';
import { prepareChecklist, executeChecklistTx } from './submit-checklist.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function bypassImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const { targetState, parameters } = data;
  // Server-only: full HTML sanitization (sanitize-html via stripHtml) before
  // guards. Hand-rolled `<` / `>` escapes missed entity-encoded payloads,
  // javascript: URIs, and event handlers — replaced with the canonical
  // helper that the rest of the codebase uses.
  const justification = typeof data.justification === "string"
    ? stripHtml(data.justification)
    : data.justification;
  const clientOpId: string | null = data.clientOpId ?? null;
  // A request presenting the replay grant must look like a replay (2026-09-25).
  assertOfflineReplayPayload(ctx.isOfflineReplay === true, data);
  const replayExemptGates: string[] = [];
  if (ctx.isOfflineReplay) replayExemptGates.push('REAUTH');
  // Gates a Super Admin's own online work skipped (2026-10-24) — recorded the same way.
  const superAdminExemptGates: SuperAdminExemptGate[] = [];

  // Phase 8.5 Commit 3: drop pure guards through the shared executor.
  const { ctx: localCtx, cp, filterCurrentCycleId, rawCycle: cycle } = await loadLocalContext(filterId, ctx);

  // Cycle-scoped clientOpId dedup (audit §1.10): scope by current cycle so a
  // clientOpId reused from a prior (completed/terminated) cycle cannot
  // silently no-op a fresh bypass. F15 (2026-09-25): with no current cycle,
  // check the latest one — the op may be the retry of a bypass that ended it.
  if (clientOpId) {
    const seen = filterCurrentCycleId
      ? await findExistingByClientOpId(filterId, clientOpId, filterCurrentCycleId)
      : await findExistingByClientOpIdInLatestCycle(filterId, clientOpId);
    if (seen) return service.getCurrentState(ctx, filterId);
  }
  throwIfFailed(executor.assertCycleActive(localCtx));

  // Audit 2026-05-04 fix C2 parity (start-cycle/advance/submit-checklist
  // already wired): validate offlinePerformedAt against cycle.startedAt
  // floor + replay-only + future-skew + max-staleness. See
  // apps/api/src/lib/offline-time-window.ts.
  const offlineTime = validateOfflinePerformedAt(data.offlinePerformedAt, {
    isReplay: ctx.isOfflineReplay === true,
    cycleStartedAt: cycle?.startedAt ?? null,
    // C-F10 (2026-09-25): not earlier than the cycle's latest recorded event.
    previousEventAt: latestEventAt(localCtx.events),
  });

  throwIfFailed(executor.assertTapeVersionFresh(localCtx, data.tapeVersion));
  // 2026-06-09: bypass runs on an IN-PROGRESS cycle whose profile is pinned at
  // start. Do not require the pinned profile to still be ACTIVE — disabling a
  // profile must not strand cycles already running on it (it still has the
  // flowMode + states bypass needs). cp is only null if the row is missing.
  if (!cp) {
    throw new AppError(400, 'NO_PROFILE', 'This cycle has no cleaning profile (the pinned profile record is missing).');
  }
  throwIfFailed(executor.assertBypassAllowed(localCtx, cp.flowMode));
  const validStates = cp.stages.filter(s => s.nodeType === 'STAGE' && s.stateKey).map(s => s.stateKey);
  throwIfFailed(executor.assertBypassTargetStateValid(localCtx, targetState, validStates));
  throwIfFailed(executor.assertJustificationValid(localCtx, justification, { kind: 'bypass' }));

  const fromState = localCtx.filter.currentLifecycleState;

  // Stage interlock — leave-gate. A bypass must not be an escape hatch around a
  // pending QA approval: leaving an interlock stage (WASH_OUT / DRY_OUT) still
  // requires the latest approval to be APPROVED. No-op when interlock disabled or
  // fromState is not a gated stage.
  // KNOWN GAP (Phase 2): a bypass that jumps INTO a later stage, skipping an
  // interlock stage entirely, is not yet blocked — tracked in
  // tasks/STAGE-INTERLOCK-PLAN.md. Most profiles are STRICT (bypass disabled).
  // OFFLINE EXEMPTION (2026-06-15, per user): the interlock is online-only, so an
  // offline-replayed bypass is not gated (mirrors advance.ts).
  if (filterCurrentCycleId && !ctx.isOfflineReplay) {
    await assertStageApprovedToLeave({
      cycleId: filterCurrentCycleId,
      fromState,
      targetState,
    });
  } else if (filterCurrentCycleId && ctx.isOfflineReplay && fromState && isInterlockStage(fromState)) {
    // 2026-09-25: record the skipped leave-gate when it would have applied.
    const interlockConfig = await getInterlockConfig();
    if (interlockConfig.enabled) replayExemptGates.push('INTERLOCK_LEAVE');
  }

  // Entering the target stage — the advance's rules (2026-10-22). `answers` is
  // the checklist after the target, carried in the same call.
  const carriesChecklist = !!data.answers && typeof data.answers === 'object';
  const targetStage = cp.stages.find(s => s.stateKey === targetState)!;
  const entry = await decideStageEntry({
    ctx, filterId, localCtx, cp, targetState, targetStage,
    dryerAction: null,
    interlockConfig: await getInterlockConfig(),
    composedWithChecklist: carriesChecklist,
    filterSet: data.filterSet,
    replayExemptGates,
    superAdminExemptGates,
  });
  // The carried checklist belongs to the stage the bypass moves TO; every
  // checklist gate runs here, before anything is written. It completes the cycle
  // when the target is the final stage.
  const clPrep = carriesChecklist
    ? await prepareChecklist(service, ctx, filterId, data, { stateOverride: targetState, skipDedup: true })
    : null;

  const eventData = {
    filterId, cycleId: filterCurrentCycleId ?? undefined,
    eventType: 'BYPASS_DEVIATION' as const,
    fromState, toState: targetState,
    performedBy: ctx.userSub,
    // 2026-07-10 (per user): mark an OFFLINE bypass into a gated stage so the
    // interlock self-heal (current-state.ts) exempts it — same carve-out as the
    // advance path. Reserved key so it can't collide with an admin param key.
    attributes: withClientOpId({
      ...(parameters ?? {}),
      ...(offlineTime ? { __offlineEntry: true } : {}),
      ...(replayExemptGates.length ? { replayExemptGates } : {}),
      ...superAdminExemptionFields(superAdminExemptGates),
    }, clientOpId),
    deviationDetails: { type: 'BYPASS', fromState, toState: targetState, justification },
    remarks: justification,
  };
  const checksum = computeChecksum(eventData);

  const createdApproval = await prisma.$transaction(async (tx) => {
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

    // Entering a QA-gated stage raises its approval, atomic with the entry.
    let approval: { id: string } | null = null;
    if (entry.enteringInterlock && entry.interlockSnapshot && entry.interlockApproverRole && filterCurrentCycleId) {
      approval = await requestStageApprovalTx(tx, {
        cycleId: filterCurrentCycleId,
        filterId,
        stageKey: targetState,
        approverRole: entry.interlockApproverRole,
        detailsSnapshot: entry.interlockSnapshot,
        ctx,
      });
    }

    // A final stage with nothing after it: this bypass completes the cycle.
    if (entry.completesCycle && filterCurrentCycleId && cycle) {
      await completeCycleTx(tx, {
        filterId, cycleId: filterCurrentCycleId, sequenceNumber: cycle.sequenceNumber, ctx,
        finalStage: targetState, offlineTime, clientOpId,
      });
    }

    // Audit §1.1 (2026-05-16): audit-write inside business tx.
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'BYPASS_DEVIATION',
      targetType: 'filter', targetId: filterId,
      beforeValue: { state: fromState },
      afterValue: {
        state: targetState, justification,
        ...(replayExemptGates.length ? { offlineReplay: true, replayExemptGates } : {}),
        ...superAdminExemptionFields(superAdminExemptGates),
      },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    }, tx);

    // The carried checklist: re-locks and verifies the filter is at the target
    // stage (set above, in this tx), records it, and completes a final stage.
    if (clPrep?.kind === 'plan') await executeChecklistTx(tx, clPrep.plan);
    return approval;
  });

  if (createdApproval && entry.interlockApproverRole) {
    await notifyStageApprovalRequested(
      { id: createdApproval.id, filterId, stageKey: targetState, approverRole: entry.interlockApproverRole },
      entry.interlockSnapshot?.filterName ?? null,
      ctx,
    );
  }

  return service.getCurrentState(ctx, filterId);
}
