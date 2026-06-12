/**
 * Stage Approvals service — the approver side of the cleaning stage interlock.
 *
 * A CleaningStageApproval is created (PENDING) by the operator's advance INTO an
 * interlock stage (see filter-operations/advance.ts). Here the configured
 * approver re-authenticates (the digital signature) and either:
 *   - APPROVE → the operator is released to continue per the cleaning-profile graph.
 *   - REJECT  → the filter's currentLifecycleState moves back (WASH_OUT→WASH_IN,
 *               DRY_OUT→DRY_IN); a deviation FilterEvent is logged; for a DRY_OUT
 *               reject the cycle's dryer fields are cleared so the operator must
 *               actually re-dry. The operator re-cleans and a fresh PENDING is
 *               raised when they re-reach the gated stage.
 *
 * Guards (per locked decisions 2026-06-12):
 *   - role match: decider's role === the approval's frozen approverRole (SUPER_ADMIN
 *     always allowed).
 *   - segregation of duties (config requireDifferentApprover): the operator who
 *     performed the stage cannot sign their own approval.
 *
 * The reauth password check is the digital signature; it happens in routes.ts via
 * enforceReauthAlways before these methods run.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { computeChecksum } from '../filter-operations/helpers.js';
import { getInterlockConfig, prettyStage } from '../filter-operations/stage-interlock.js';
import { createNotification } from '../notifications/notification.service.js';

const SUMMARY_SELECT = {
  id: true,
  cycleId: true,
  filterId: true,
  stageKey: true,
  status: true,
  approverRole: true,
  rejectToStateKey: true,
  attemptSeq: true,
  detailsSnapshot: true,
  requestedByName: true,
  requestedAt: true,
  decidedByName: true,
  decidedAt: true,
  decisionRemarks: true,
} as const;

/** Decider must hold the approval's frozen role (or be SUPER_ADMIN). */
function assertRoleAllowed(ctx: RequestContext, approverRole: string) {
  if (ctx.userRole === 'SUPER_ADMIN') return;
  if (ctx.userRole !== approverRole) {
    throw new AppError(403, 'WRONG_APPROVER_ROLE', `Only ${approverRole} can act on this approval.`);
  }
}

/** Segregation of duties — the performer cannot sign their own stage. */
async function assertDifferentApprover(ctx: RequestContext, requestedBy: string) {
  const cfg = await getInterlockConfig();
  if (cfg.requireDifferentApprover && ctx.userSub === requestedBy) {
    throw new AppError(
      403,
      'SELF_APPROVAL_FORBIDDEN',
      'The operator who performed this stage cannot approve it. A different user must sign off.',
    );
  }
}

export const stageApprovalService = {
  /** PENDING items the current user can act on (their role, or all for SUPER_ADMIN). */
  async queue(ctx: RequestContext) {
    const where =
      ctx.userRole === 'SUPER_ADMIN'
        ? { status: 'PENDING' as const }
        : { status: 'PENDING' as const, approverRole: ctx.userRole };
    return prisma.cleaningStageApproval.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      select: SUMMARY_SELECT,
    });
  },

  /** Broader list — ?status=APPROVED|REJECTED|PENDING for the archive. */
  async list(ctx: RequestContext, opts: { status?: string }) {
    const where: Record<string, unknown> = {};
    if (opts.status) where.status = opts.status;
    // Non-super-admins only ever see approvals routed to their role.
    if (ctx.userRole !== 'SUPER_ADMIN') where.approverRole = ctx.userRole;
    return prisma.cleaningStageApproval.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: 200,
      select: SUMMARY_SELECT,
    });
  },

  async getById(id: string) {
    const row = await prisma.cleaningStageApproval.findUnique({ where: { id } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Stage approval not found.');
    return row;
  },

  /** APPROVE — release the operator. Records APPROVAL_GRANTED + audit signature. */
  async approve(ctx: RequestContext, id: string, remarks?: string) {
    const row = await prisma.cleaningStageApproval.findUnique({ where: { id } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Stage approval not found.');
    if (row.status !== 'PENDING') throw new AppError(400, 'INVALID_STATUS', 'This stage approval is not pending.');
    assertRoleAllowed(ctx, row.approverRole);
    await assertDifferentApprover(ctx, row.requestedBy);

    const cleanRemarks = typeof remarks === 'string' ? remarks.trim() || null : null;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.cleaningStageApproval.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedBy: ctx.userSub,
          decidedByName: ctx.userId,
          decidedAt: new Date(),
          decisionRemarks: cleanRemarks,
        },
      });

      // Immutable cycle-timeline entry for the signature.
      const eventData = {
        filterId: row.filterId,
        cycleId: row.cycleId,
        eventType: 'APPROVAL_GRANTED' as const,
        performedBy: ctx.userSub,
        attributes: {
          kind: 'STAGE_INTERLOCK_APPROVED',
          stageKey: row.stageKey,
          attemptSeq: row.attemptSeq,
          approvalId: row.id,
        },
        remarks: cleanRemarks,
      };
      await tx.filterEvent.create({
        data: {
          ...eventData,
          checksum: computeChecksum({
            filterId: row.filterId,
            cycleId: row.cycleId ?? '',
            eventType: 'APPROVAL_GRANTED',
            performedBy: ctx.userSub,
            stageKey: row.stageKey,
            attemptSeq: row.attemptSeq,
          }),
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });

      await auditLog(
        {
          userId: ctx.userId,
          userRole: ctx.userRole,
          action: 'STAGE_APPROVAL_APPROVED',
          targetType: 'cleaning_stage_approval',
          targetId: row.id,
          afterValue: { stageKey: row.stageKey, filterName: (row.detailsSnapshot as any)?.filterName ?? null },
          signatureMeaning: `${prettyStage(row.stageKey)} approved for filter "${(row.detailsSnapshot as any)?.filterName ?? row.filterId}"`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          sessionId: ctx.sessionId,
        },
        tx,
      );
      return u;
    });

    await notifyOperator(row, 'STAGE_APPROVAL_APPROVED', 'Cleaning stage approved',
      `${prettyStage(row.stageKey)} for "${(row.detailsSnapshot as any)?.filterName ?? row.filterId}" was approved by ${ctx.userId}. You can continue cleaning.`, ctx);

    return updated;
  },

  /** REJECT — move the filter back and require a re-clean. Remarks mandatory. */
  async reject(ctx: RequestContext, id: string, remarks?: string) {
    const clean = typeof remarks === 'string' ? remarks.trim() : '';
    if (clean.length < 3) throw new AppError(400, 'REMARKS_REQUIRED', 'Remarks are required when rejecting (min 3 chars).');

    const row = await prisma.cleaningStageApproval.findUnique({ where: { id } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Stage approval not found.');
    if (row.status !== 'PENDING') throw new AppError(400, 'INVALID_STATUS', 'This stage approval is not pending.');
    assertRoleAllowed(ctx, row.approverRole);
    await assertDifferentApprover(ctx, row.requestedBy);

    // Cycle must still be active — a rejection that re-points lifecycle state at a
    // terminated/completed cycle would corrupt it.
    if (!row.cycleId) throw new AppError(409, 'CYCLE_NOT_ACTIVE', 'This approval is not bound to a cycle.');
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: row.cycleId }, select: { status: true } });
    if (!cycle || cycle.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'CYCLE_NOT_ACTIVE', 'The cleaning cycle is no longer in progress.');
    }

    // DRY_OUT reject sends the filter back to DRY_IN — clear the dryer state so the
    // operator must actually re-dry (half-time + readings gates re-fire). Per the
    // offline-anchor rule, the redo restamps dryer_started_at fresh.
    const clearsDryer = row.rejectToStateKey === 'DRY_IN';

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.cleaningStageApproval.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedBy: ctx.userSub,
          decidedByName: ctx.userId,
          decidedAt: new Date(),
          decisionRemarks: clean,
        },
      });

      // Immutable deviation entry: backward transition caused by QA rejection.
      const eventData = {
        filterId: row.filterId,
        cycleId: row.cycleId,
        eventType: 'STATE_TRANSITION' as const,
        fromState: row.stageKey,
        toState: row.rejectToStateKey,
        performedBy: ctx.userSub,
        attributes: {
          kind: 'STAGE_INTERLOCK_REJECTED',
          stageKey: row.stageKey,
          attemptSeq: row.attemptSeq,
          approvalId: row.id,
        },
        deviationDetails: {
          type: 'STAGE_APPROVAL_REJECTED',
          stageKey: row.stageKey,
          rejectedBy: ctx.userId,
          remarks: clean,
        },
        remarks: clean,
      };
      await tx.filterEvent.create({
        data: {
          ...eventData,
          checksum: computeChecksum({
            filterId: row.filterId,
            cycleId: row.cycleId ?? '',
            eventType: 'STATE_TRANSITION',
            fromState: row.stageKey,
            toState: row.rejectToStateKey,
            performedBy: ctx.userSub,
            attemptSeq: row.attemptSeq,
          }),
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });

      // Move the filter back so the operator re-cleans.
      await tx.filterDetails.update({
        where: { assetInstanceId: row.filterId },
        data: { currentLifecycleState: row.rejectToStateKey },
      });

      if (clearsDryer) {
        await tx.cleaningCycle.update({
          where: { id: row.cycleId! },
          data: { dryerStartedAt: null, dryerDurationMinutes: null, dryerReadingsSubmitted: false },
        });
      }

      await auditLog(
        {
          userId: ctx.userId,
          userRole: ctx.userRole,
          action: 'STAGE_APPROVAL_REJECTED',
          targetType: 'cleaning_stage_approval',
          targetId: row.id,
          afterValue: { stageKey: row.stageKey, rejectToStateKey: row.rejectToStateKey, remarks: clean },
          signatureMeaning: `${prettyStage(row.stageKey)} rejected for filter "${(row.detailsSnapshot as any)?.filterName ?? row.filterId}" — restart from ${prettyStage(row.rejectToStateKey)}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          sessionId: ctx.sessionId,
        },
        tx,
      );
      return u;
    });

    await notifyOperator(row, 'STAGE_APPROVAL_REJECTED', 'Cleaning stage rejected',
      `${prettyStage(row.stageKey)} for "${(row.detailsSnapshot as any)?.filterName ?? row.filterId}" was rejected by ${ctx.userId}. Restart from ${prettyStage(row.rejectToStateKey)}. Reason: ${clean}`, ctx);

    return updated;
  },
};

/** Best-effort notification to the operator who requested the approval. */
async function notifyOperator(
  row: { id: string; filterId: string; stageKey: string; requestedByName: string },
  type: 'STAGE_APPROVAL_APPROVED' | 'STAGE_APPROVAL_REJECTED',
  title: string,
  message: string,
  ctx: RequestContext,
): Promise<void> {
  try {
    await createNotification({
      type,
      title,
      message,
      forUserId: row.requestedByName, // *Name fields hold the User ID (username)
      metadata: { stageApprovalId: row.id, filterId: row.filterId, stageKey: row.stageKey },
      createdBy: ctx.userId,
    });
  } catch (e) {
    console.error('[stage-approvals] notify operator failed:', (e as Error).message);
  }
}
