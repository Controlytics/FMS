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
import { getFilterWorkflowConfig, assertPmRole, initialApprovalStatus, filterReviewSkippedBySuperAdmin } from './filter-workflow.js';
import { superAdminExemptionFields } from '../../lib/super-admin-own-work.js';
import { mintFilterQnns, filterSubmissionNote } from './filter-qnn.js';

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

/**
 * Approval/decision flows require remarks (CLAUDE.md): a review or an approval
 * says why as much as a rejection does (2026-10-22; both used to be optional).
 * The routes refuse a blank one BEFORE the re-auth gate (400 VALIDATION, see
 * `hasDecisionRemarks` / `DECISION_REMARKS_MESSAGE`); this is the same rule for
 * any other caller of the service.
 */
export const DECISION_REMARKS_MESSAGE = 'Remarks are required to review, approve or reject filters.';
export function hasDecisionRemarks(remarks: unknown): remarks is string {
  return typeof remarks === 'string' && remarks.trim().length > 0;
}
function requireDecisionRemarks(remarks: unknown): string {
  if (!hasDecisionRemarks(remarks)) throw new AppError(400, 'REMARKS_REQUIRED', DECISION_REMARKS_MESSAGE);
  return remarks.trim();
}

/**
 * D03-09 / F-42 (2026-10-22): every refusal a decision can give, with no write.
 * The routes run these BEFORE the re-auth gate (a refused decision costs no
 * password and leaves no REAUTH_* row); each decision runs its own again.
 */
export async function assertCanReview(ctx: RequestContext, filterIds: string[], remarks?: string) {
  const why = requireDecisionRemarks(remarks);
  const cfg = await getFilterWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.reviewRole, 'review', 'filters');
  const rows = await loadInState(filterIds, ['PENDING_REVIEW'], 'review');
  assertNotOwnFilter(ctx, rows, 'review');
  return { why, rows };
}

export async function reviewFilters(ctx: RequestContext, filterIds: string[], remarks?: string) {
  const { why, rows } = await assertCanReview(ctx, filterIds, remarks);

  await prisma.assetInstance.updateMany({
    where: { id: { in: filterIds } },
    data: {
      approvalStatus: 'PENDING_APPROVAL',
      reviewedBy: ctx.userSub ?? null, reviewedByName: ctx.userId ?? null,
      reviewedAt: new Date(), reviewRemarks: why,
    },
  });
  await auditEach(rows, ctx, 'FILTER_REVIEWED', { reviewRemarks: why }, why);
  // One QNN per filter, tagged for the approval role (2026-10-24, filter-qnn.ts).
  const qnns = await mintFilterQnns('REVIEW', rows, ctx, 'Filter reviewed (pending approval)');
  return { reviewed: rows.length, filters: rows.map(r => r.name), qnns };
}

export async function assertCanApprove(ctx: RequestContext, filterIds: string[], remarks?: string) {
  const why = requireDecisionRemarks(remarks);
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
  return { why, rows };
}

export async function approveFilters(ctx: RequestContext, filterIds: string[], remarks?: string) {
  const { why, rows } = await assertCanApprove(ctx, filterIds, remarks);

  await prisma.assetInstance.updateMany({
    where: { id: { in: filterIds } },
    data: {
      approvalStatus: 'APPROVED',
      approvedBy: ctx.userSub ?? null, approvedByName: ctx.userId ?? null,
      approvedAt: new Date(), approvalRemarks: why,
    },
  });
  await auditEach(rows, ctx, 'FILTER_APPROVED', { approvalRemarks: why }, why);
  const qnns = await mintFilterQnns('APPROVE', rows, ctx, 'Filter approved (can now be cleaned)');
  return { approved: rows.length, filters: rows.map(r => r.name), qnns };
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
export async function assertCanReject(ctx: RequestContext, filterIds: string[], remarks: string) {
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
  return rows;
}

export async function rejectFilters(ctx: RequestContext, filterIds: string[], remarks: string) {
  const rows = await assertCanReject(ctx, filterIds, remarks);

  await prisma.assetInstance.updateMany({
    where: { id: { in: filterIds } },
    data: {
      approvalStatus: 'REJECTED',
      rejectedBy: ctx.userSub ?? null, rejectedByName: ctx.userId ?? null,
      rejectedAt: new Date(), rejectionRemarks: remarks.trim(),
    },
  });
  await auditEach(rows, ctx, 'FILTER_REJECTED', { rejectionRemarks: remarks.trim() }, remarks.trim());
  // The step each filter was rejected at, from the status it had (rows were read before the update).
  const stepOf = new Map(rows.map((r) => [r.id, r.approvalStatus === 'PENDING_REVIEW' ? 'review' : 'approval']));
  const qnns = await mintFilterQnns('REJECT', rows, ctx, (f) => `Filter rejected at ${stepOf.get(f.id)}`);
  return { rejected: rows.length, filters: rows.map(r => r.name), qnns };
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
export async function assertCanResubmit(ctx: RequestContext, filterId: string) {
  const rows = await loadInState([filterId], ['REJECTED'], 're-submit');
  const cfg = await getFilterWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.uploadRole, 're-submit', 'filters');
  return { rows, cfg };
}

export async function resubmitFilter(ctx: RequestContext, filterId: string) {
  const { rows, cfg } = await assertCanResubmit(ctx, filterId);
  // A Super Admin's own re-submission is not held for review (2026-10-24): it goes
  // straight to APPROVED, recorded FILTER_REVIEW; everyone else back to review.
  const reviewSkipped = filterReviewSkippedBySuperAdmin(cfg, ctx);
  const nextStatus = reviewSkipped ? initialApprovalStatus(cfg, ctx) : 'PENDING_REVIEW';

  await prisma.assetInstance.update({
    where: { id: filterId },
    data: {
      approvalStatus: nextStatus,
      submittedBy: ctx.userSub ?? null, submittedByName: ctx.userId ?? null, submittedAt: new Date(),
      reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewRemarks: null,
      approvedBy: null, approvedByName: null, approvedAt: null, approvalRemarks: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectionRemarks: null,
    },
  });
  await auditEach(rows, ctx, 'FILTER_RESUBMITTED', superAdminExemptionFields(reviewSkipped ? ['FILTER_REVIEW'] : []));
  const [qnn] = await mintFilterQnns('RESUBMIT', rows, ctx, filterSubmissionNote('resubmitted', nextStatus));
  return { resubmitted: rows[0].name, approvalStatus: nextStatus, qnn };
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
