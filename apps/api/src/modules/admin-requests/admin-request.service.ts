import { PrismaClient } from '@prisma/client';
import { auditLog } from '../../lib/audit.js';
import { stripHtml } from '../../lib/sanitize.js';
import type { RequestContext } from '../../types/context.js';

const prisma = new PrismaClient();

export const adminRequestService = {
  async create(data: {
    requestType: string;
    requesterName: string;
    requesterEmployeeId?: string;
    requesterEmail?: string;
    requestData: Record<string, unknown>;
    remarks?: string;
  }) {
    const request = await prisma.adminRequest.create({
      data: {
        requestType: data.requestType,
        requesterName: stripHtml(data.requesterName),
        requesterEmployeeId: data.requesterEmployeeId ? stripHtml(data.requesterEmployeeId) : null,
        requesterEmail: data.requesterEmail ?? null,
        requestData: data.requestData as any,
        remarks: data.remarks ? stripHtml(data.remarks) : null,
        status: 'PENDING',
      },
    });

    // Audit log (no userId since this is a public endpoint)
    await auditLog({
      action: 'ADMIN_REQUEST_SUBMITTED',
      targetType: 'admin_request',
      targetId: request.id,
      afterValue: { requestType: request.requestType, requesterName: request.requesterName },
      reason: `${request.requestType} request submitted by ${request.requesterName}`,
      signatureMeaning: `Admin request (${request.requestType}) submitted by ${request.requesterName}`,
    });

    // Create notification for admins
    await prisma.notification.create({
      data: {
        type: 'USER_CREATION_REQUEST_SUBMITTED',
        title: `New ${formatRequestType(request.requestType)} Request`,
        message: `${request.requesterName} submitted a ${formatRequestType(request.requestType).toLowerCase()} request.`,
        forRole: 'SUPER_ADMIN',
        metadata: { requestId: request.id, requestType: request.requestType },
      },
    });

    return request;
  },

  async list(status?: string) {
    const where = status ? { status } : {};
    return prisma.adminRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
    });
  },

  async pendingCount() {
    return prisma.adminRequest.count({ where: { status: 'PENDING' } });
  },

  async getById(id: string) {
    return prisma.adminRequest.findUnique({ where: { id } });
  },

  async process(
    id: string,
    action: 'approve' | 'reject',
    adminRemarks: string,
    ctx: RequestContext,
  ) {
    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) throw new Error('Request not found');
    if (request.status !== 'PENDING') throw new Error('Request has already been processed');

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

    const updated = await prisma.adminRequest.update({
      where: { id },
      data: {
        status: newStatus,
        adminRemarks: adminRemarks ? stripHtml(adminRemarks) : null,
        processedBy: ctx.userId,
        processedAt: new Date(),
      },
    });

    // Audit log
    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: action === 'approve' ? 'ADMIN_REQUEST_APPROVED' : 'ADMIN_REQUEST_REJECTED',
      targetType: 'admin_request',
      targetId: id,
      beforeValue: { status: 'PENDING' },
      afterValue: { status: newStatus, adminRemarks },
      reason: `${formatRequestType(request.requestType)} request ${newStatus.toLowerCase()} — ${adminRemarks}`,
      signatureMeaning: `Admin request (${request.requestType}) ${newStatus.toLowerCase()} by admin`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    // Notify requester via email if provided
    if (request.requesterEmail) {
      const notifType = action === 'approve'
        ? 'USER_CREATION_REQUEST_APPROVED' as const
        : 'USER_CREATION_REQUEST_REJECTED' as const;

      await prisma.notification.create({
        data: {
          type: notifType,
          title: `Request ${newStatus}`,
          message: `Your ${formatRequestType(request.requestType).toLowerCase()} request has been ${newStatus.toLowerCase()}.${adminRemarks ? ` Admin notes: ${adminRemarks}` : ''}`,
          targetUserId: request.requesterName,
          metadata: { requestId: id, requestType: request.requestType },
        },
      });
    }

    return updated;
  },
};

function formatRequestType(type: string): string {
  switch (type) {
    case 'CREATE_USER': return 'Create User';
    case 'MODIFY_USER': return 'Modify User';
    case 'UNLOCK': return 'Unlock Account';
    case 'FORGOT_PASSWORD': return 'Forgot Password';
    default: return type;
  }
}
