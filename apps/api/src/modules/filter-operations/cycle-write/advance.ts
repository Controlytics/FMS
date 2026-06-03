/**
 * Filter Operations — advance() implementation.
 *
 * Extracted byte-for-byte from filter-operations.service.ts. Largest of the
 * write methods: pure-guard chain → equipment-group / instrument-readings
 * resolution (against pinned snapshot or live group) → in-tx row lock →
 * mutation + auto-complete on END.
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { stripHtml } from '../../../lib/sanitize.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingByClientOpId, withClientOpId } from '../../../lib/idempotency.js';
import { validateOfflinePerformedAt } from '../../../lib/offline-time-window.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import { computeChecksum, collectChecklistsAfterStage } from '../helpers.js';
import { lockAndVerifyFilterState } from './locking.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function advanceImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const { targetState, parameters, equipmentId, cleaningAreaId, instrumentReadings, equipmentGroupId, dryerAction, dryerDurationMinutes } = data;
  // Use the canonical `stripHtml` (sanitize-html under the hood) instead of
  // hand-rolled `<` / `>` escapes. The hand-rolled version missed entity-
  // encoded payloads, `javascript:` URIs, and event handlers. Other modules
  // (admin-requests, auth, assets) already use this helper — bringing
  // cycle-write into the same input-sanitization contract.
  const remarks = typeof data.remarks === "string" ? stripHtml(data.remarks) : data.remarks;
  const clientOpId: string | null = data.clientOpId ?? null;

  // Phase 8.5 Commit 3: drop pure guards through the shared executor.
  const { ctx: localCtx, cp, rawCycle: cycle, filterCurrentCycleId } = await loadLocalContext(filterId, ctx);

  // Cycle-scoped clientOpId dedup (audit §1.10): a replay with the same opId
  // for the same cycle is a no-op success; the same opId across different
  // cycles cannot collide. Run AFTER loadLocalContext so we have the
  // current cycle id; same pattern as submit-checklist.ts.
  if (clientOpId && filterCurrentCycleId && await findExistingByClientOpId(filterId, clientOpId, filterCurrentCycleId)) {
    return service.getCurrentState(ctx, filterId);
  }
  throwIfFailed(executor.assertCycleActive(localCtx));

  // Server-only: cycle must be IN_PROGRESS (live state).
  if (!cycle || cycle.status !== 'IN_PROGRESS') {
    throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');
  }

  // Validate offlinePerformedAt against cycle.startedAt floor + replay-only +
  // future-skew + max-staleness. Audit 2026-05-04 fix C2 — see
  // apps/api/src/lib/offline-time-window.ts.
  const offlineTime = validateOfflinePerformedAt(data.offlinePerformedAt, {
    isReplay: ctx.isOfflineReplay === true,
    cycleStartedAt: cycle.startedAt,
  });

  throwIfFailed(executor.assertTapeVersionFresh(localCtx, data.tapeVersion));
  throwIfFailed(executor.assertProfileAssigned(localCtx, cp?.id));
  throwIfFailed(executor.assertProfileActive(localCtx, cp ? localCtx.profile : null));

  // assertProfileActive now enforces status === 'ACTIVE' (Phase 8.6 fix);
  // narrow for TS so downstream code can read cp.* without optional chaining.
  if (!cp) {
    throw new AppError(400, 'PROFILE_DISABLED', 'Cleaning profile is disabled or not found. Contact admin to activate it.');
  }

  const currentState = localCtx.filter.currentLifecycleState;

  // Pending checklist gate (frozen at cycle start per A5).
  throwIfFailed(executor.assertChecklistGatePassed(localCtx, localCtx.profile, currentState));

  // Compute reachable stages + END detection from pipeline graph.
  const fromNodeForReachability = currentState
    ? localCtx.profile.nodes.find(s => s.stateKey === currentState)
      ?? localCtx.profile.nodes.find(s => s.nodeType === 'START')
    : localCtx.profile.nodes.find(s => s.nodeType === 'START');
  const { reachableStages, hasEndNext } = fromNodeForReachability
    ? executor.findReachable(fromNodeForReachability.id, localCtx.profile.nodes, localCtx.profile.edges)
    : { reachableStages: [] as string[], hasEndNext: false };

  throwIfFailed(executor.assertNotCycleComplete(localCtx, reachableStages, hasEndNext));
  // Dryer-in-place exception: SET_DURATION / SUBMIT_READINGS at DRY_IN -> DRY_IN.
  const isDryerInPlace = !!dryerAction && targetState === 'DRY_IN' && currentState === 'DRY_IN';
  throwIfFailed(
    executor.assertTargetStateReachable(
      localCtx,
      targetState,
      reachableStages,
      cp.flowMode,
      isDryerInPlace,
      currentState,
    ),
  );
  throwIfFailed(executor.assertTargetStateExists(localCtx, targetState, localCtx.profile));

  // Resolve targetStage (post-existence check) for the in-tx END walk.
  const targetStage = cp.stages.find(s => s.stateKey === targetState)!;

  // PARAM_CAPTURE block validation (pure).
  const paramDefs = executor.extractParameterDefs(localCtx.profile.nodes);
  throwIfFailed(executor.assertParametersRequired(localCtx, parameters, paramDefs));
  throwIfFailed(executor.assertParametersInRange(localCtx, parameters, paramDefs));

  const fromState = currentState;

  // Equipment-group existence check when provided + not yet bound (server I/O).
  if (equipmentGroupId && !cycle.equipmentGroupId) {
    const eqGroup = await prisma.equipmentGroup.findFirst({
      where: { id: equipmentGroupId, isActive: true },
      select: { id: true, isActive: true },
    });
    throwIfFailed(executor.assertEquipmentGroupValid(localCtx, equipmentGroupId, eqGroup));
  }

  // Dryer guards (pure).
  throwIfFailed(executor.assertDryerActionValid(localCtx, dryerAction, targetState));
  if (dryerAction === 'SET_DURATION') {
    throwIfFailed(executor.assertDryerDurationValid(localCtx, dryerDurationMinutes));
  }
  throwIfFailed(executor.assertInDryInForReadings(localCtx, currentState, dryerAction));
  throwIfFailed(executor.assertDryerStarted(localCtx, localCtx.cycle, dryerAction));
  throwIfFailed(
    executor.assertDryerHalfTimeElapsed(localCtx, localCtx.cycle, dryerAction, offlineTime ?? null),
  );
  throwIfFailed(
    executor.assertDryerHalfTimeBeforeLeavingDryIn(
      localCtx,
      localCtx.cycle,
      currentState,
      targetState,
      offlineTime ?? null,
    ),
  );
  // 2026-05-25: require the SUBMIT_READINGS submission before leaving DRY_IN.
  // The half-time guard alone was letting cycles auto-advance once the timer
  // elapsed even though no actual temperature reading was recorded — a 21
  // CFR Part 11 gap reported by an operator the same day.
  throwIfFailed(
    executor.assertDryerReadingsSubmittedBeforeLeavingDryIn(
      localCtx.cycle,
      currentState,
      targetState,
    ),
  );

  // Validate instrument readings if provided.
  let validatedReadings: any = null;
  if (instrumentReadings && typeof instrumentReadings === 'object' && Object.keys(instrumentReadings).length > 0) {
    let cycleGroupId = equipmentGroupId ?? cycle.equipmentGroupId;
    // Three pin sources (priority): cycle pin → lazy-bind live group version → null (legacy).
    let cycleVersionPin: number | null = cycle.equipmentGroupVersionPin ?? null;

    // Auto-resolve: if no group on cycle but block is known, pick the block's active group.
    // Hybrid guard #30 — pure portion (count <= 1) wraps the live DB read.
    if (!cycleGroupId && cycle.cleaningAreaId) {
      const blockGroups = await prisma.equipmentGroup.findMany({
        where: { blockId: cycle.cleaningAreaId, isActive: true },
        select: { id: true, version: true },
      });
      throwIfFailed(executor.assertSingleEquipmentGroupPerBlock(localCtx, blockGroups.length));
      if (blockGroups.length === 1) {
        cycleGroupId = blockGroups[0].id;
        cycleVersionPin = blockGroups[0].version; // P1: pin at lazy-bind moment
        // Persist on cycle so future requests don't need to re-resolve.
        // (Pre-tx write — same as before; keeps lock-acquisition order unchanged.)
        await prisma.cleaningCycle.update({
          where: { id: cycle.id },
          data: { equipmentGroupId: cycleGroupId, equipmentGroupVersionPin: cycleVersionPin },
        });
      }
    }
    throwIfFailed(executor.assertEquipmentGroupSelected(localCtx, cycleGroupId));

    // P1 (2026-05-02): validate against frozen snapshot when pinned, live row otherwise.
    let stageInstruments: any[];
    if (cycleVersionPin !== null) {
      const versionRow = await prisma.equipmentGroupVersion.findUnique({
        where: { groupId_versionNumber: { groupId: cycleGroupId!, versionNumber: cycleVersionPin } },
      });
      if (versionRow) {
        const snap = versionRow.snapshot as { instruments: any[] };
        const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
        stageInstruments = (snap.instruments ?? [])
          .filter((i: any) => i.stageKey === readingsStageKey)
          .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      } else {
        // Pin set but no version row — pin is for current live row (lazy first-version).
        const eqGroup = await prisma.equipmentGroup.findUnique({
          where: { id: cycleGroupId! },
          include: { instruments: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found');
        // Hybrid guard #32 — pure portion compares pin/live version.
        throwIfFailed(
          executor.assertEquipmentGroupVersionExists(localCtx, cycleVersionPin, eqGroup.version, false),
        );
        const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
        stageInstruments = eqGroup.instruments.filter(i => i.stageKey === readingsStageKey);
      }
    } else {
      // Legacy fallback (pre-P1 cycle).
      const eqGroup = await prisma.equipmentGroup.findUnique({
        where: { id: cycleGroupId! },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found');
      const readingsStageKey = dryerAction === 'SUBMIT_READINGS' ? 'DRY_IN' : targetState;
      stageInstruments = eqGroup.instruments.filter(i => i.stageKey === readingsStageKey);
    }

    validatedReadings = [];
    for (const inst of stageInstruments) {
      const reading = instrumentReadings[inst.id];
      // Per-instrument pure guards (#27/#28/#29).
      throwIfFailed(executor.assertInstrumentReadingRequired(localCtx, reading, inst));
      throwIfFailed(executor.assertInstrumentReadingValid(localCtx, reading, inst));
      const val = Number(reading);
      throwIfFailed(executor.assertInstrumentReadingInRange(localCtx, val, inst));
      validatedReadings.push({
        instrumentId: inst.id,
        instrumentCode: inst.instrumentId,
        description: inst.description,
        value: val,
        uom: inst.uom,
        leastCount: inst.leastCount,
      });
    }
  }

  // Fold the dryer-action info into the main event's attributes so that
  // SET_DURATION emits ONE filter_event row, not two. The previous code
  // wrote a separate "DRYER_STARTED" STATE_TRANSITION inside the same tx
  // (lines below, now removed), both stamped with the same clientOpId.
  // That broke server-side idempotency-by-clientOpId — a single op produced
  // two audit rows with identical clientOpId 14ms apart — and bloated the
  // immutable trail with redundant transitions (see test 2026-05-18
  // cycle CC-fffffff-00-003 at 16:42:54).
  //
  // Offline-cycle correctness (2026-05-18): when SET_DURATION is replayed
  // from an offline queue, stamp dryer_started_at with the offline
  // timestamp, not server NOW. Otherwise the FOLLOWING op in the queue
  // (advance DRY_IN → STORAGE_IN, also stamped with an offline
  // performedAt) will fail assertDryerHalfTimeBeforeLeavingDryIn because
  // (offlinePerformedAt - serverNow) is negative or tiny. With offline
  // anchor, the subsequent op compares two offline timestamps and the
  // half-time guard passes for cycles the operator actually waited out.
  const dryerStartedAt = dryerAction === 'SET_DURATION' ? (offlineTime ?? new Date()) : null;
  const eventAttributes = withClientOpId({
    ...(parameters ?? {}),
    ...(validatedReadings ? { instrumentReadings: validatedReadings } : {}),
    ...(dryerAction === 'SET_DURATION' ? { action: 'DRYER_STARTED', dryerDurationMinutes, dryerStartedAt: dryerStartedAt!.toISOString() } : {}),
    ...(dryerAction === 'SUBMIT_READINGS' ? { action: 'DRYER_READINGS_SUBMITTED' } : {}),
  }, clientOpId);

  // Dryer-readings submission is recorded as a STATE_TRANSITION row but
  // the filter never actually leaves DRY_IN (isDryerInPlace). Storing
  // fromState=toState=DRY_IN reads as "DRY_IN → DRY_IN" in the audit UI,
  // which misleads inspectors into thinking a transition happened. Set
  // fromState=null when no transition actually occurs; the `action`
  // attribute already labels the event correctly.
  const persistedFromState = isDryerInPlace ? null : fromState;
  const eventData = {
    filterId, cycleId: cycle.id, eventType: 'STATE_TRANSITION' as const,
    fromState: persistedFromState, toState: targetState,
    performedBy: ctx.userSub,
    cleaningAreaId: cleaningAreaId ?? null,
    equipmentId: equipmentId ?? null,
    attributes: eventAttributes,
    remarks: dryerAction === 'SET_DURATION'
      ? (remarks ?? `Dryer started for ${dryerDurationMinutes} minute(s)`)
      : (remarks ?? null),
  };
  const checksum = computeChecksum(eventData);

  // Check if target stage leads to END (walking through any CHECKLIST nodes).
  // Cross-cutting cleanup: was an inline recursive `checkEnd` walker; replaced
  // with the canonical `executor.findReachable` (packages/shared/src/
  // pipeline-executor/transitions.ts:279) — same semantics, single source of
  // truth shared with submit-checklist.ts and current-state.ts.
  const reachFromTarget = executor.findReachable(targetStage.id, localCtx.profile.nodes, localCtx.profile.edges);
  const leadsToEnd = reachFromTarget.hasEndNext;
  const hasMoreStages = reachFromTarget.reachableStages.length > 0;

  // Defer auto-complete when an active CHECKLIST node sits between the
  // target stage and END. Without this, pipelines like WASH_IN→CHECKLIST→END
  // would complete the cycle the instant the operator advances to WASH_IN,
  // never letting them answer the post-stage checklist. submitChecklist
  // performs the completion in that case instead.
  let hasPendingChecklistAfterTarget = false;
  if (leadsToEnd && !hasMoreStages) {
    const postNodes = collectChecklistsAfterStage(targetStage, cp.stages, cp.connections)
      .filter(n => (n.configuration as any)?.checklistProfileId);
    const postProfileIds = [...new Set(postNodes.map(n => (n.configuration as any).checklistProfileId).filter(Boolean))] as string[];
    if (postProfileIds.length > 0) {
      const active = await prisma.checklistProfile.findMany({
        where: { id: { in: postProfileIds }, isActive: true },
        select: { id: true },
      });
      hasPendingChecklistAfterTarget = active.length > 0;
    }
  }

  // Wrap all writes in a single transaction with row-level lock (Phase 5b.4).
  await prisma.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE on the FilterDetails row blocks any concurrent
    // advance/bypass on this filter until this transaction commits. Closes
    // the read-then-write race where two operators on two devices could both
    // pass the state check and both write STAGE_TRANSITIONED.
    await lockAndVerifyFilterState(tx, filterId, currentState, cycle.id);

    // Update equipment group if provided and not yet set
    if (equipmentGroupId && !cycle.equipmentGroupId) {
      await tx.cleaningCycle.update({
        where: { id: cycle.id },
        data: { equipmentGroupId },
      });
    }

    // Dryer SET_DURATION: persist duration + start time on the cycle row.
    // The DRYER_STARTED audit info is now folded into the main advance event
    // (see eventAttributes above) — emitting a separate row here would
    // duplicate the audit-trail with two state transitions per advance and
    // break clientOpId-based idempotency.
    if (dryerAction === 'SET_DURATION') {
      await tx.cleaningCycle.update({
        where: { id: cycle.id },
        data: { dryerDurationMinutes, dryerStartedAt: dryerStartedAt! },
      });
    }

    await tx.filterEvent.create({
      data: {
        ...eventData,
        checksum,
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
        ...(offlineTime && { performedAt: offlineTime }),
      },
    });

    // Mark dryer readings as submitted (DRY_IN stays, user advances to DRY_OUT later)
    if (dryerAction === 'SUBMIT_READINGS') {
      await tx.cleaningCycle.update({
        where: { id: cycle.id },
        data: { dryerReadingsSubmitted: true },
      });
    }

    // currentLifecycleState moved to FilterDetails (Step 6).
    await tx.filterDetails.update({
      where: { assetInstanceId: filterId },
      data: { currentLifecycleState: targetState },
    });

    if (leadsToEnd && !hasMoreStages && !hasPendingChecklistAfterTarget) {
      const completedAt = offlineTime ?? new Date();
      await tx.cleaningCycle.update({
        where: { id: cycle.id },
        data: { status: 'COMPLETED', completedAt },
      });
      // 2026-06-02: completion now leaves the filter in the terminal
      // CLEANING_CYCLE_COMPLETED state (was null/Idle). currentCycleId is still
      // cleared, so getCurrentState/start-cycle treat the filter as available
      // (both key off currentCycleId, not the lifecycle label).
      await tx.filterDetails.update({
        where: { assetInstanceId: filterId },
        data: { currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' },
      });
      // Stamp the typed filter's lastCleaningDate to the completion day so the
      // "Last Cleaned" column reflects the just-finished cycle. Uses offlineTime
      // (not server-now) for offline replay, per the dryer-anchor rule. jsonb_set
      // merges — other field-option attributes are preserved. The filters→
      // asset_instances mirror trigger keeps the legacy row in sync.
      const cleanDate = completedAt.toISOString().slice(0, 10);
      await tx.$executeRaw`UPDATE filters SET attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{lastCleaningDate}', to_jsonb(${cleanDate}::text), true) WHERE id = ${filterId}::uuid`;

      const completeEvent = {
        filterId, cycleId: cycle.id, eventType: 'CYCLE_COMPLETED' as const,
        performedBy: ctx.userSub, attributes: withClientOpId({ sequenceNumber: cycle.sequenceNumber }, clientOpId),
      };
      await tx.filterEvent.create({
        data: {
          ...completeEvent,
          checksum: computeChecksum(completeEvent),
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });
    }

    // Audit §1.1 (2026-05-16): audit-write inside business tx.
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'STATE_TRANSITION',
      targetType: 'filter', targetId: filterId,
      beforeValue: { state: fromState },
      afterValue: { state: targetState },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    }, tx);
  });

  return service.getCurrentState(ctx, filterId);
}
