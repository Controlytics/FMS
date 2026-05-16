/**
 * Filter Operations — startCycle() implementation.
 *
 * Extracted byte-for-byte from filter-operations.service.ts. Creates a new
 * CleaningCycle, snapshots checklist-profile versions for cycle-pinning
 * (Phase A.1), pins the equipment-group version (P1, 2026-05-02), records
 * CYCLE_STARTED, and updates FilterDetails.currentCycleId. No race lock —
 * uses an in-tx recheck against the previously-active cycle to prevent
 * concurrent double-start.
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { stripHtml } from '../../../lib/sanitize.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingStartByClientOpId } from '../../../lib/idempotency.js';
import { validateOfflinePerformedAt } from '../../../lib/offline-time-window.js';
import { computeChecksum } from '../helpers.js';
import {
  getFilter,
  resolveFilterProfile,
  validateBlockChange,
  consumeBlockChangeApprovalTx,
  getCleaningReasons,
} from '../filter-resolver.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function startCycleImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const { cleaningReasonKey, cleaningAreaId, equipmentGroupId } = data;
  // offlinePerformedAt: tablet wall-clock timestamp when the operator
  // physically performed the action offline. The tablet IS the source of
  // truth — that's the point of offline operation. But the server validates
  // the value (future-skew, max-staleness, replay-only) so a forged client
  // can't back-date forged audit records (audit 2026-05-04 fix — C2).
  // start-cycle has no prior cycle so cycleStartedAt is omitted.
  const offlineTime = validateOfflinePerformedAt(data.offlinePerformedAt, {
    isReplay: ctx.isOfflineReplay === true,
  });
  // Idempotent replay: if this clientOpId was already used to start a cycle,
  // return current state instead of creating a duplicate cycle. Scoped to
  // CYCLE_STARTED events only (audit §1.10) so replays from non-start ops
  // sharing the same UUID don't accidentally short-circuit a legitimate start.
  const clientOpId: string | null = data.clientOpId ?? null;
  if (clientOpId && await findExistingStartByClientOpId(filterId, clientOpId)) {
    return service.getCurrentState(ctx, filterId);
  }
  // Use canonical `stripHtml` instead of hand-rolled `<` / `>` escape — see
  // advance.ts:29 rationale. Same input-sanitization contract as the rest
  // of the codebase.
  const cleaningJustification = typeof data.cleaningJustification === "string" ? stripHtml(data.cleaningJustification) : data.cleaningJustification;

  const filter = await getFilter(filterId, ctx);
  const resolvedProfileIdForCycle = await resolveFilterProfile(filter);
  if (!resolvedProfileIdForCycle) throw new AppError(400, 'NO_PROFILE', 'Filter has no assigned profile');

  if (filter.currentCycleId) {
    const activeCycle = await prisma.cleaningCycle.findFirst({
      where: { id: filter.currentCycleId, status: 'IN_PROGRESS' },
    });
    if (activeCycle) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
  }

  // Validate block change (must be before cycle creation)
  await validateBlockChange(filterId, cleaningAreaId, ctx);

  const reasons = await getCleaningReasons(resolvedProfileIdForCycle);
  if (!cleaningReasonKey) {
    throw new AppError(400, 'REASON_REQUIRED', 'Cleaning reason is required');
  }
  const reason = reasons.find((r: any) => r.key === cleaningReasonKey);
  if (!reason) throw new AppError(400, 'INVALID_REASON', `Invalid cleaning reason: ${cleaningReasonKey}`);
  if (reason.requiresJustification && (!cleaningJustification || cleaningJustification.length < 10)) {
    throw new AppError(400, 'JUSTIFICATION_REQUIRED', 'Justification required (min 10 characters) for this cleaning reason');
  }

  const prevCycleCount = await prisma.cleaningCycle.count({ where: { filterId } });
  const seq = prevCycleCount + 1;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cycleCode = `CC-${filter.name?.replace(/\s+/g, '').slice(0, 10) ?? filterId.slice(0, 8)}-${String(seq).padStart(3, '0')}-${dateStr}`;

  // Resolve to cleaning profile — could be a FilterProfile ID or a CleaningProfile ID directly
  const fp = await prisma.filterProfile.findUnique({ where: { id: resolvedProfileIdForCycle } });
  const cleaningProfileIdForCycle = fp ? fp.cleaningProfileId : resolvedProfileIdForCycle;
  const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: cleaningProfileIdForCycle } });
  if (cp && cp.status !== 'ACTIVE') {
    throw new AppError(400, 'PROFILE_DISABLED', `Cleaning profile "${cp.name}" is disabled. Contact admin to activate it.`);
  }

  // Phase A.1: snapshot the version of every ChecklistProfile referenced by
  // this pipeline at cycle start. From now on, this cycle resolves checklist
  // questions through these pinned versions — admin edits to a profile mid-cycle
  // will NOT change the questions or required-flags the operator sees.
  // Goes through the service.getProfilePipeline indirection so tests that
  // monkey-patch the spy still intercept.
  const pipelineForPins = await (service as any).getProfilePipeline(resolvedProfileIdForCycle, false);
  const checklistProfileIdsInPipeline: string[] = pipelineForPins
    ? [...new Set(
        pipelineForPins.stages
          .filter((s: any) => s.nodeType === 'CHECKLIST')
          .map((s: any) => s.configuration?.checklistProfileId)
          .filter(Boolean) as string[],
      )]
    : [];
  const checklistVersionPins: Record<string, number> = {};
  if (checklistProfileIdsInPipeline.length > 0) {
    const profilesForPins = await prisma.checklistProfile.findMany({
      where: { id: { in: checklistProfileIdsInPipeline } },
      select: { id: true, version: true },
    });
    for (const p of profilesForPins) {
      checklistVersionPins[p.id] = p.version;
    }
  }

  // Use transaction to prevent race conditions on double-start.
  //
  // Audit 2026-05-04 fix (api-core review C2): the previous in-tx `findUnique`
  // recheck did NOT acquire a row lock — two concurrent start-cycle requests
  // for the same filter could both clear the recheck and both insert. Switch
  // to `SELECT ... FOR UPDATE` so the second caller serializes behind the
  // first's commit and observes the new currentCycleId before its own check.
  // Mirrors the lock pattern used by advance/bypass/terminate via
  // lockAndVerifyFilterState() in ./locking.ts.
  const cycle = await prisma["$transaction"](async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ current_cycle_id: string | null }>>`
      SELECT current_cycle_id
      FROM filter_details
      WHERE asset_instance_id = ${filterId}::uuid
      FOR UPDATE
    `;
    const lockedCurrentCycleId = lockedRows[0]?.current_cycle_id ?? null;
    if (lockedCurrentCycleId) {
      const active = await tx.cleaningCycle.findFirst({ where: { id: lockedCurrentCycleId, status: 'IN_PROGRESS' } });
      if (active) throw new AppError(409, 'CYCLE_ACTIVE', 'Filter already has an active cleaning cycle');
    }

    // Audit 2026-05-05 fix #7: re-check + consume the block-change approval
    // INSIDE the lock. Without this, two concurrent starts could both pass
    // the outer-tx hasApproval read at validateBlockChange() above and both
    // proceed to consume — second one wins with no audit trail of the first
    // having claimed it.
    await consumeBlockChangeApprovalTx(tx, filterId, cleaningAreaId);

    // Validate equipment group if provided. P1 (2026-05-02): also capture the
    // group's current version so the cycle pins it at start. Reading validation
    // later reads operating-range from the pinned EquipmentGroupVersion
    // snapshot, NOT the live group, so admin edits to ranges mid-cycle don't
    // reach the in-flight cycle.
    let equipmentGroupVersionPin: number | null = null;
    if (equipmentGroupId) {
      const eqGroup = await tx.equipmentGroup.findFirst({
        where: { id: equipmentGroupId, isActive: true },
        select: { id: true, version: true },
      });
      if (!eqGroup) throw new AppError(400, 'INVALID_EQUIPMENT_GROUP', 'Equipment group not found or inactive');
      equipmentGroupVersionPin = eqGroup.version;
    }

    const newCycle = await tx.cleaningCycle.create({
      data: {
        cycleCode, filterId, ahuId: null,
        // Pre-existing latent bug caught during P1 verification (2026-05-02):
        // cleaning_cycles.profile_id FKs to filter_cleaning_profiles.id, NOT
        // filter_profiles.id. resolveFilterProfile() can return either depending
        // on whether the filter has a FilterDetails.filter_profile_id binding
        // (returns FilterProfile id) or only a config-based rule (which
        // *might* return a CleaningProfile id directly). Storing the
        // FilterProfile id here triggers the FK violation. cleaningProfileIdForCycle
        // (computed at line 820) already resolves to the CleaningProfile id in both
        // cases — use that. Latent until now because no FilterDetails-bound cycle
        // had ever been started in this DB.
        profileId: cleaningProfileIdForCycle,
        profileVersion: cp?.version ?? 1,
        checklistVersionPins: checklistVersionPins as any,
        sequenceNumber: seq, cleaningReasonKey,
        cleaningReasonLabel: reason.name,
        cleaningJustification: cleaningJustification ?? null,
        cleaningAreaId: cleaningAreaId ?? null,
        equipmentGroupId: equipmentGroupId ?? null,
        equipmentGroupVersionPin, // P1: null when no group bound at start
        ...(offlineTime && { startedAt: offlineTime }),
      },
    });

    await tx.filterEvent.create({
      data: {
        filterId, cycleId: newCycle.id, eventType: 'CYCLE_STARTED',
        performedBy: ctx.userSub, cleaningAreaId: cleaningAreaId ?? null,
        attributes: { cleaningReasonKey, cleaningReasonLabel: reason.name, ...(clientOpId ? { clientOpId } : {}) },
        remarks: cleaningJustification ?? null,
        checksum: computeChecksum({ filterId, cycleId: newCycle.id, eventType: 'CYCLE_STARTED', performedBy: ctx.userSub }),
        ipAddress: ctx.ipAddress, telemetrySnapshot: {},
        ...(offlineTime && { performedAt: offlineTime }),
      },
    });

    // currentCycleId moved to FilterDetails (Step 6).
    await tx.filterDetails.upsert({
      where: { assetInstanceId: filterId },
      update: { currentCycleId: newCycle.id },
      create: { assetInstanceId: filterId, currentCycleId: newCycle.id },
    });

    // Audit §1.1 (2026-05-16): audit-write must share the business tx so
    // a partial failure either rolls back the cycle creation OR is
    // re-attempted as a unit. Standalone (post-commit) writes left state
    // changed with no audit record on transient failures — § 11.10(e)
    // violation.
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CYCLE_STARTED',
      targetType: 'cleaning_cycle', targetId: newCycle.id,
      afterValue: { cycleCode, cleaningReasonKey, filterId },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    }, tx);

    return newCycle;
  });

  return cycle;
}
