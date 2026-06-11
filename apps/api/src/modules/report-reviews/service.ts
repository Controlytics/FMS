/**
 * Report Review service — 3-stage review/approval workflow for ad-hoc PDF
 * exports. "Send for Review" snapshots the rendered report data; a reviewer then
 * an approver act on it; once APPROVED the snapshot can be re-downloaded with
 * Printed By / Reviewed By / Approved By signatures.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

export interface SubmitInput {
  reportType: string;
  title: string;
  subtitle?: string;
  dataSnapshot: unknown;
  assigneeUserId?: string;
  assigneeRole?: string;
}

function requireOneAssignee(userId?: string, role?: string) {
  const u = (userId ?? '').trim();
  const r = (role ?? '').trim();
  if (!u && !r) throw new AppError(400, 'ASSIGNEE_REQUIRED', 'Choose a user or a role to send this to.');
  return { assigneeUserId: u || null, assigneeRole: u ? null : (r || null) };
}

export const reportReviewService = {
  async submit(ctx: RequestContext, input: SubmitInput) {
    if (!input.reportType || !input.title || input.dataSnapshot == null) {
      throw new AppError(400, 'INVALID_INPUT', 'reportType, title and dataSnapshot are required.');
    }
    const assignee = requireOneAssignee(input.assigneeUserId, input.assigneeRole);
    const row = await prisma.reportReview.create({
      data: {
        reportType: input.reportType,
        title: input.title.slice(0, 500),
        subtitle: input.subtitle?.slice(0, 1000) ?? null,
        dataSnapshot: input.dataSnapshot as any,
        status: 'PENDING_REVIEW',
        generatedBy: ctx.userSub,
        generatedByName: ctx.userId,
        ...assignee,
      },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'REPORT_REVIEW_SUBMITTED',
      targetType: 'report_review', targetId: row.id,
      afterValue: { reportType: row.reportType, title: row.title, assignee },
      signatureMeaning: `Report "${row.title}" submitted for review`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return row;
  },

  /** Items the current user can act on right now (assigned to them or their role
   *  at the report's current pending stage). */
  async queue(ctx: RequestContext) {
    const rows = await prisma.reportReview.findMany({
      where: {
        status: { in: ['PENDING_REVIEW', 'PENDING_APPROVAL'] },
        OR: [{ assigneeUserId: ctx.userSub }, { assigneeRole: ctx.userRole }],
      },
      orderBy: { createdAt: 'desc' },
      select: SUMMARY_SELECT,
    });
    return rows.map((r) => ({ ...r, stage: r.status === 'PENDING_REVIEW' ? 'REVIEW' : 'APPROVE' }));
  },

  /** Broader list — for tracking what I submitted, and the approved archive. */
  async list(ctx: RequestContext, opts: { status?: string; mine?: boolean }) {
    const where: Record<string, unknown> = {};
    if (opts.status) where.status = opts.status;
    if (opts.mine) where.generatedBy = ctx.userSub;
    const rows = await prisma.reportReview.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, select: SUMMARY_SELECT });
    return rows;
  },

  async getById(id: string) {
    const row = await prisma.reportReview.findUnique({ where: { id } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Report not found.');
    return row;
  },

  /** Stage 2 — reviewer approves (→ PENDING_APPROVAL, assigns the approver) or rejects. */
  async review(ctx: RequestContext, id: string, action: 'approve' | 'reject', remarks: string | undefined, nextUserId?: string, nextRole?: string) {
    const row = await prisma.reportReview.findUnique({ where: { id } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Report not found.');
    if (row.status !== 'PENDING_REVIEW') throw new AppError(400, 'INVALID_STATUS', 'This report is not awaiting review.');

    if (action === 'reject') {
      if (!remarks || remarks.trim().length < 3) throw new AppError(400, 'REMARKS_REQUIRED', 'Remarks are required when rejecting (min 3 chars).');
      const updated = await prisma.reportReview.update({
        where: { id },
        data: {
          status: 'REJECTED', rejectionStage: 'REVIEW', rejectedBy: ctx.userSub, rejectedByName: ctx.userId, rejectedAt: new Date(),
          reviewRemarks: remarks.trim(), assigneeUserId: null, assigneeRole: null,
        },
      });
      await this.audit(ctx, updated, 'REPORT_REVIEW_REJECTED', `Report "${row.title}" rejected at review`);
      return updated;
    }
    // approve → move to approval stage, assign approver
    const assignee = requireOneAssignee(nextUserId, nextRole);
    const updated = await prisma.reportReview.update({
      where: { id },
      data: {
        status: 'PENDING_APPROVAL', reviewedBy: ctx.userSub, reviewedByName: ctx.userId, reviewedAt: new Date(),
        reviewRemarks: remarks?.trim() || null, ...assignee,
      },
    });
    await this.audit(ctx, updated, 'REPORT_REVIEW_REVIEWED', `Report "${row.title}" reviewed (sent for approval)`);
    return updated;
  },

  /** Stage 3 — approver approves (→ APPROVED) or rejects. */
  async approve(ctx: RequestContext, id: string, action: 'approve' | 'reject', remarks: string | undefined) {
    const row = await prisma.reportReview.findUnique({ where: { id } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Report not found.');
    if (row.status !== 'PENDING_APPROVAL') throw new AppError(400, 'INVALID_STATUS', 'This report is not awaiting approval.');

    if (action === 'reject') {
      if (!remarks || remarks.trim().length < 3) throw new AppError(400, 'REMARKS_REQUIRED', 'Remarks are required when rejecting (min 3 chars).');
      const updated = await prisma.reportReview.update({
        where: { id },
        data: {
          status: 'REJECTED', rejectionStage: 'APPROVAL', rejectedBy: ctx.userSub, rejectedByName: ctx.userId, rejectedAt: new Date(),
          approvalRemarks: remarks.trim(), assigneeUserId: null, assigneeRole: null,
        },
      });
      await this.audit(ctx, updated, 'REPORT_REVIEW_REJECTED', `Report "${row.title}" rejected at approval`);
      return updated;
    }
    const updated = await prisma.reportReview.update({
      where: { id },
      data: {
        status: 'APPROVED', approvedBy: ctx.userSub, approvedByName: ctx.userId, approvedAt: new Date(),
        approvalRemarks: remarks?.trim() || null, assigneeUserId: null, assigneeRole: null,
      },
    });
    await this.audit(ctx, updated, 'REPORT_REVIEW_APPROVED', `Report "${row.title}" approved`);
    return updated;
  },

  async audit(ctx: RequestContext, row: { id: string; status: string }, action: string, meaning: string) {
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action,
      targetType: 'report_review', targetId: row.id, afterValue: { status: row.status },
      signatureMeaning: meaning, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },
};

const SUMMARY_SELECT = {
  id: true, reportType: true, title: true, subtitle: true, status: true,
  generatedByName: true, generatedAt: true, assigneeUserId: true, assigneeRole: true,
  reviewedByName: true, reviewedAt: true, approvedByName: true, approvedAt: true,
  rejectionStage: true, rejectedByName: true, rejectedAt: true, reviewRemarks: true, approvalRemarks: true,
  createdAt: true,
} as const;
