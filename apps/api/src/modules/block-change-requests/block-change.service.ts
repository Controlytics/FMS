import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import type { RequestContext } from '../../types/context.js';

export const blockChangeService = {
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

    const request = await prisma.blockChangeRequest.create({
      data: {
        ...data,
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
