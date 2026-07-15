import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import type { RequestContext } from '../../types/context.js';
import { createNotification } from '../notifications/notification.service.js';

export const blockChangeService = {
  /**
   * Cross-block mode (config `block-change-approval.mode`):
   *   - 'NONE'     → no cross-block check at all; clean any filter in any block.
   *   - 'CONFIRM'  → operator self-confirm (no approval); the default.
   *   - 'APPROVAL' → formal block-change request that an approver must approve.
   * For CONFIRM/APPROVAL: online only — OFFLINE never gates (the FE shows an
   * informational notice and the server auto-passes offline replays). Defaults
   * to 'CONFIRM' when the config row/key is absent.
   */
  async getMode(): Promise<'NONE' | 'CONFIRM' | 'APPROVAL'> {
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'block-change-approval' } });
    const mode = (cfg?.configValue as any)?.mode;
    if (mode === 'NONE') return 'NONE';
    if (mode === 'APPROVAL') return 'APPROVAL';
    return 'CONFIRM';
  },

  async create(ctx: RequestContext, data: {
    filterId: string; filterName: string;
    fromBlockId: string; fromBlockName: string;
    toBlockId: string; toBlockName: string;
    reason?: string;
  }) {
    const existing = await prisma.blockChangeRequest.findFirst({
      where: { filterId: data.filterId, toBlockId: data.toBlockId, status: 'PENDING' },
    });
    if (existing) throw new AppError(409, 'DUPLICATE_REQUEST', 'A pending request already exists for this filter and block');

    // Build the row from explicit named fields — never spread the request body.
    // `data` arrives as `req.body as any` and the POST schema does not set
    // additionalProperties:false, so a spread let a requester supply real model
    // columns: `status:'APPROVED'` self-forged the approval that hasApproval()
    // checks (bypassing the cross-block gate with no approver), and
    // `manualEntry:true` disguised the row as a data-management insert.
    const request = await prisma.blockChangeRequest.create({
      data: {
        filterId: data.filterId,
        filterName: data.filterName,
        fromBlockId: data.fromBlockId,
        fromBlockName: data.fromBlockName,
        toBlockId: data.toBlockId,
        toBlockName: data.toBlockName,
        reason: data.reason,
        requestedBy: ctx.userSub,
        requestedByName: ctx.userId,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'BLOCK_CHANGE_REQUESTED',
      targetType: 'block_change_request', targetId: request.id,
      afterValue: { filterId: data.filterId, fromBlock: data.fromBlockName, toBlock: data.toBlockName },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    // Notify the approvers. Pre-fix, this row was created silently and the
    // configured approval-role users had no signal at all — they only knew
    // a request existed if they happened to visit /approvals (which polls
    // /pending-count). Reported 2026-05-25: "request was going to selected
    // role users or not" — answer was "not". Now we read the same config
    // key the approval gate (routes.ts:assertApprovalRoleAllowed) uses and
    // fan out a notification to that role + SUPER_ADMIN (who can always
    // approve). Failure is non-fatal — the request row is the source of
    // truth; the notification is convenience.
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'block-change-approval' } });
      const approvalRole = ((cfg?.configValue as any)?.approvalRole as string | undefined)?.trim() || 'ADMIN';
      const baseMsg = {
        type: 'BLOCK_CHANGE_REQUESTED' as const,
        title: 'Block Change Approval Needed',
        message: `${ctx.userId} requested approval to clean ${data.filterName} (from ${data.fromBlockName}) in ${data.toBlockName}.${data.reason ? ` Reason: ${data.reason}` : ''}`,
        metadata: {
          requestId: request.id,
          filterId: data.filterId,
          filterName: data.filterName,
          fromBlockId: data.fromBlockId,
          fromBlockName: data.fromBlockName,
          toBlockId: data.toBlockId,
          toBlockName: data.toBlockName,
          requestedByName: ctx.userId,
        },
        createdBy: ctx.userId,
      };
      await createNotification({ ...baseMsg, forRole: approvalRole });
      // Also notify SUPER_ADMIN unless it IS the configured role (avoid duplicate).
      if (approvalRole !== 'SUPER_ADMIN') {
        await createNotification({ ...baseMsg, forRole: 'SUPER_ADMIN' });
      }
    } catch (e) {
      console.error('[block-change] Failed to dispatch approval notification:', (e as Error).message);
    }

    return request;
  },

  async list(ctx: RequestContext, query: { status?: string; page?: number; limit?: number; mine?: boolean }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = {};

    if (query.status && query.status !== 'ALL') where.status = query.status;
    if (query.mine) where.requestedBy = ctx.userSub;

    const [data, total] = await Promise.all([
      prisma.blockChangeRequest.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.blockChangeRequest.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  async pendingCount(_ctx: RequestContext) {
    const where: any = { status: 'PENDING' };
    return prisma.blockChangeRequest.count({ where });
  },

  async process(ctx: RequestContext, id: string, action: 'approve' | 'reject', comment?: string) {
    const request = await prisma.blockChangeRequest.findUnique({ where: { id } });
    if (!request) throw new AppError(404, 'NOT_FOUND', 'Request not found');
    if (request.status !== 'PENDING') throw new AppError(409, 'ALREADY_PROCESSED', `Request already ${request.status.toLowerCase()}`);

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const updated = await prisma.blockChangeRequest.update({
      where: { id },
      data: {
        status: newStatus,
        processedBy: ctx.userSub,
        processedByName: ctx.userId,
        processedComment: comment ?? null,
        processedAt: new Date(),
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: action === 'approve' ? 'BLOCK_CHANGE_APPROVED' : 'BLOCK_CHANGE_REJECTED',
      targetType: 'block_change_request', targetId: id,
      beforeValue: { status: 'PENDING' },
      afterValue: { status: newStatus, comment },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    // Close the loop: tell the requester their request was processed.
    // `requestedByName` is the username stamp written in create(); it matches
    // the `forUserId` field convention used elsewhere (see auth.service.ts
    // createNotification calls).
    try {
      await createNotification({
        type: action === 'approve' ? 'BLOCK_CHANGE_APPROVED' : 'BLOCK_CHANGE_REJECTED',
        title: action === 'approve' ? 'Block Change Approved' : 'Block Change Rejected',
        message: action === 'approve'
          ? `Your request to clean ${request.filterName} in ${request.toBlockName} was approved by ${ctx.userId}.${comment ? ` Note: ${comment}` : ''}`
          : `Your request to clean ${request.filterName} in ${request.toBlockName} was rejected by ${ctx.userId}.${comment ? ` Reason: ${comment}` : ''}`,
        forUserId: request.requestedByName,
        metadata: {
          requestId: id,
          filterId: request.filterId,
          filterName: request.filterName,
          toBlockId: request.toBlockId,
          toBlockName: request.toBlockName,
          processedByName: ctx.userId,
          comment,
        },
        createdBy: ctx.userId,
      });
    } catch (e) {
      console.error('[block-change] Failed to dispatch process notification:', (e as Error).message);
    }

    return updated;
  },

  async hasApproval(filterId: string, toBlockId: string): Promise<boolean> {
    const approved = await prisma.blockChangeRequest.findFirst({
      where: { filterId, toBlockId, status: 'APPROVED' },
    });
    return !!approved;
  },

  async consumeApproval(filterId: string, toBlockId: string): Promise<void> {
    await prisma.blockChangeRequest.updateMany({
      where: { filterId, toBlockId, status: 'APPROVED' },
      data: { status: 'EXPIRED' },
    });
  },

  /**
   * Audit 2026-05-05 fix #7: tx-aware variants. The pre-fix flow ran
   * validateBlockChange OUTSIDE the start-cycle transaction (called at
   * start-cycle.ts:63 before the FOR UPDATE lock at :124). A concurrent
   * second start-cycle could consume the same approval between the
   * outer-tx hasApproval read and the FOR UPDATE — both starts then
   * proceed as if approved.
   *
   * These variants take a TransactionClient so the find + update happen
   * under the same row lock as the cycle insert. start-cycle.ts now calls
   * the tx-aware path inside its $transaction.
   */
  async hasApprovalTx(tx: any, filterId: string, toBlockId: string): Promise<boolean> {
    const approved = await tx.blockChangeRequest.findFirst({
      where: { filterId, toBlockId, status: 'APPROVED' },
    });
    return !!approved;
  },

  async consumeApprovalTx(tx: any, filterId: string, toBlockId: string): Promise<void> {
    await tx.blockChangeRequest.updateMany({
      where: { filterId, toBlockId, status: 'APPROVED' },
      data: { status: 'EXPIRED' },
    });
  },
};
