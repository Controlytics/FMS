/**
 * Filter create/upload → review → approve workflow: the review side.
 *
 * Mirrors pm-approval.ts (reviewEntries / approveEntries / rejectEntries /
 * resubmitEntry) so an operator who knows the PM screens already knows this one.
 * Every action takes an ARRAY of filter ids: a bulk upload creates up to 200
 * filters at once, and "these 198 are fine, those 2 are wrong" has to work.
 *
 * Status flow (statuses reuse PmEntryApprovalStatus — see schema.prisma):
 *
 *   create/upload ─▶ PENDING_REVIEW ─review─▶ PENDING_APPROVAL ─approve─▶ APPROVED
 *                          │                        │
 *                          └────────reject──────────┴──▶ REJECTED ─resubmit─▶ PENDING_REVIEW
 *
 * Only APPROVED filters can be operated (assertFilterOperable).
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { auditLog } from '../../lib/audit.js';
import type { RequestContext } from '../../types/context.js';
import { getFilterWorkflowConfig, assertPmRole } from './filter-workflow.js';

/** Filters in the workflow, for the Filters page's review actions. */
export async function listPendingFilters(_ctx: RequestContext, status?: string) {
  const where = status
    ? { approvalStatus: status as any }
    : { approvalStatus: { in: ['PENDING_REVIEW', 'PENDING_APPROVAL', 'REJECTED'] as any } };
  const rows = await prisma.assetInstance.findMany({
    where: { ...where, isActive: true, template: { templateKind: 'FILTER' } },
    select: {
      id: true, name: true, parentId: true, approvalStatus: true,
      submittedByName: true, submittedAt: true,
      reviewedByName: true, reviewedAt: true, reviewRemarks: true,
      approvedByName: true, approvedAt: true, approvalRemarks: true,
      rejectedByName: true, rejectedAt: true, rejectionRemarks: true,
    },
    orderBy: { submittedAt: 'desc' },
  });
  return { data: rows, total: rows.length };
}

/**
 * Load the filters an action is about and refuse the whole call unless every one
 * is in the expected state.
 *
 * All-or-nothing on purpose: a partial success would leave the operator to work
 * out which of 200 rows moved. PM's approveEntries takes the same line.
 */
async function loadInState(filterIds: string[], expected: string[], action: string) {
  if (!filterIds?.length) throw new AppError(400, 'NO_FILTERS', 'Select at least one filter');
  const rows = await prisma.assetInstance.findMany({
    where: { id: { in: filterIds } },
    select: { id: true, name: true, approvalStatus: true, submittedBy: true, reviewedBy: true },
  });
  if (rows.length !== filterIds.length) {
    throw new AppError(404, 'NOT_FOUND', 'One or more filters no longer exist');
  }
  const wrong = rows.filter(r => !expected.includes(r.approvalStatus as string));
  if (wrong.length > 0) {
    throw new AppError(
      409, 'INVALID_STATUS',
      `Cannot ${action}: ${wrong.map(w => `"${w.name}" is ${w.approvalStatus}`).join(', ')}. Expected ${expected.join(' or ')}.`,
      { filters: wrong.map(w => ({ id: w.id, name: w.name, approvalStatus: w.approvalStatus })) },
    );
  }
  return rows;
}

/**
 * Segregation of duties by USER (QA OQ-18 / BR-061, operator decision
 * 2026-10-19 "require a different person"). Same rule as PM
 * (`pm-approval.ts assertNotOwnEntry`) and replacement schedules: the person who
 * created / uploaded a filter may not review, approve or reject it, and the
 * reviewer may not also approve it. Before this, role separation was the only
 * guard, so with one person holding both roles (or a blank reviewRole) the same
 * user could submit and approve. All-or-nothing, like the state check: one own
 * filter in a batch refuses the batch and names it.
 */
function assertNotOwnFilter(
  ctx: RequestContext,
  rows: Array<{ name: string; submittedBy: string | null; reviewedBy: string | null; approvalStatus?: unknown }>,
  step: 'review' | 'approve' | 'reject',
) {
  // A-07 (2026-10-21): fail CLOSED. A request with no caller id cannot prove it
  // is a different person, so it is refused rather than waved through.
  if (!ctx.userSub) {
    throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', 'The signing user could not be identified, so separation of duties cannot be verified.');
  }
  // The reviewer may not also sign the APPROVAL step - approving it, or (since
  // 2026-10-21, A-06) rejecting it there - same rule as PM and replacement.
  const atApproval = (r: { approvalStatus?: unknown }) => step === 'approve' || (step === 'reject' && r.approvalStatus === 'PENDING_APPROVAL');
  const own = rows.filter((r) => r.submittedBy === ctx.userSub || (atApproval(r) && r.reviewedBy === ctx.userSub));
  if (own.length) {
    throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN',
      `You cannot ${step} a filter you created or reviewed yourself (${own.map((r) => `"${r.name}"`).join(', ')}). A different user must sign off.`);
  }
}

async function auditEach(rows: { id: string; name: string }[], ctx: RequestContext, action: string, after: Record<string, unknown>, reason?: string) {
  // One row per filter, not one per batch: an inspector asks "who approved THIS
  // filter", and a batch-level row cannot answer that.
  for (const r of rows) {
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action, targetType: 'asset_instance', targetId: r.id,
      afterValue: { filterName: r.name, ...after },
      ...(reason ? { reason } : {}),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  }
}

export async function reviewFilters(ctx: RequestContext, filterIds: string[], remarks?: string) {
  const cfg = await getFilterWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.reviewRole, 'review', 'filters');
  const rows = await loadInState(filterIds, ['PENDING_REVIEW'], 'review');
  assertNotOwnFilter(ctx, rows, 'review');

  await prisma.assetInstance.updateMany({
    where: { id: { in: filterIds } },
    data: {
      approvalStatus: 'PENDING_APPROVAL',
      reviewedBy: ctx.userSub ?? null, reviewedByName: ctx.userId ?? null,
      reviewedAt: new Date(), reviewRemarks: remarks ?? null,
    },
  });
  await auditEach(rows, ctx, 'FILTER_REVIEWED', { reviewRemarks: remarks ?? null }, remarks);
  return { reviewed: rows.length, filters: rows.map(r => r.name) };
}

export async function approveFilters(ctx: RequestContext, filterIds: string[], remarks?: string) {
  const cfg = await getFilterWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.approvalRole, 'approve', 'filters');
  // PENDING_REVIEW is accepted as well so an approver is not blocked when the
  // workflow was switched on after the filters were created, or when no review
  // role is configured and review is therefore a no-op step.
  // Audit 2026-09-24 (A-F3): the comment above was never enforced — with a
  // reviewRole configured (MANAGER live) QA could approve straight from
  // PENDING_REVIEW, skipping the review and leaving reviewedBy null.
  const approvable = cfg.reviewRole ? ['PENDING_APPROVAL'] : ['PENDING_APPROVAL', 'PENDING_REVIEW'];
  const rows = await loadInState(filterIds, approvable, 'approve');
  assertNotOwnFilter(ctx, rows, 'approve');

  await prisma.assetInstance.updateMany({
    where: { id: { in: filterIds } },
    data: {
      approvalStatus: 'APPROVED',
      approvedBy: ctx.userSub ?? null, approvedByName: ctx.userId ?? null,
      approvedAt: new Date(), approvalRemarks: remarks ?? null,
    },
  });
  await auditEach(rows, ctx, 'FILTER_APPROVED', { approvalRemarks: remarks ?? null }, remarks);
  return { approved: rows.length, filters: rows.map(r => r.name) };
}

/**
 * Reject. Each step is rejected by ITS role (operator decision 2026-10-21, A-06,
 * matching PM and replacement schedules): a filter waiting for review is
 * rejected by the review role, one waiting for approval only by the approval
 * role - the reviewer no longer acts at the approval step. With no review role
 * configured the review step is a no-op, so the approval role may reject there.
 *
 * The row SURVIVES as REJECTED rather than being deleted: the rejection reason
 * and attribution are the record of why it was refused, and the uploader
 * corrects that same row (see resubmitFilter). Its name therefore stays taken.
 */
export async function rejectFilters(ctx: RequestContext, filterIds: string[], remarks: string) {
  if (!remarks?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'A rejection reason is required');
  const cfg = await getFilterWorkflowConfig();
  const rows = await loadInState(filterIds, ['PENDING_REVIEW', 'PENDING_APPROVAL'], 'reject');
  if (ctx.userRole !== 'SUPER_ADMIN') {
    const roleFor = (status: unknown) => (status === 'PENDING_REVIEW' && cfg.reviewRole ? cfg.reviewRole : cfg.approvalRole);
    const notMine = rows.filter((r) => { const role = roleFor(r.approvalStatus); return role && role !== ctx.userRole; });
    if (notMine.length) {
      throw new AppError(403, 'FORBIDDEN_ROLE',
        `You cannot reject ${notMine.map((r) => `"${r.name}"`).join(', ')} at its current step: ${[...new Set(notMine.map((r) => `${r.approvalStatus === 'PENDING_REVIEW' ? 'review' : 'approval'} is decided by role "${roleFor(r.approvalStatus)}"`))].join('; ')}.`);
    }
  }
  assertNotOwnFilter(ctx, rows, 'reject');

  await prisma.assetInstance.updateMany({
    where: { id: { in: filterIds } },
    data: {
      approvalStatus: 'REJECTED',
      rejectedBy: ctx.userSub ?? null, rejectedByName: ctx.userId ?? null,
      rejectedAt: new Date(), rejectionRemarks: remarks.trim(),
    },
  });
  await auditEach(rows, ctx, 'FILTER_REJECTED', { rejectionRemarks: remarks.trim() }, remarks.trim());
  return { rejected: rows.length, filters: rows.map(r => r.name) };
}

/**
 * Resubmit a rejected filter. Clears every review/approve/reject field and puts
 * it back at the start, exactly as PM's resubmitEntry does — a rejection you can
 * only resubmit unchanged would be a dead end.
 *
 * Corrected VALUES are applied by the normal filter-update endpoint before this
 * is called; this moves the state. Keeping the two apart means resubmit cannot
 * become a second, unvalidated write path into the filter's fields.
 */
export async function resubmitFilter(ctx: RequestContext, filterId: string) {
  const rows = await loadInState([filterId], ['REJECTED'], 're-submit');
  const cfg = await getFilterWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.uploadRole, 're-submit', 'filters');

  await prisma.assetInstance.update({
    where: { id: filterId },
    data: {
      approvalStatus: 'PENDING_REVIEW',
      submittedBy: ctx.userSub ?? null, submittedByName: ctx.userId ?? null, submittedAt: new Date(),
      reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewRemarks: null,
      approvedBy: null, approvedByName: null, approvedAt: null, approvalRemarks: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectionRemarks: null,
    },
  });
  await auditEach(rows, ctx, 'FILTER_RESUBMITTED', {});
  return { resubmitted: rows[0].name };
}

/** Counts for the Filters page badges. */
export async function pendingFilterCounts(_ctx: RequestContext) {
  const grouped = await prisma.assetInstance.groupBy({
    by: ['approvalStatus'],
    where: { isActive: true, template: { templateKind: 'FILTER' } },
    _count: { _all: true },
  });
  const out: Record<string, number> = { PENDING_REVIEW: 0, PENDING_APPROVAL: 0, REJECTED: 0, APPROVED: 0 };
  for (const g of grouped) out[g.approvalStatus as string] = g._count._all;
  return out;
}
