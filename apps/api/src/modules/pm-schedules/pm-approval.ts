/**
 * PM Schedules — entry-level workflow (3-step when enabled, single-step when off).
 *
 * Workflow ON (config pm-schedule-approval.workflowEnabled):
 *   upload → PENDING_REVIEW → (review) PENDING_APPROVAL → (approve) APPROVED
 *   reject at review or approval → REJECTED → (resubmit) → PENDING_REVIEW
 * Workflow OFF (legacy): upload → PENDING → (approve) APPROVED / REJECTED.
 *
 * Every action also mints a QNN (Quality Notification Number) into
 * quality_notifications via pm-workflow.generateQnn().
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireDecisionRemarks } from '../../lib/decision-remarks.js';
import { checkPmEnabled } from './pm-shared.js';
import { getPmWorkflowConfig, assertPmRole, generateQnn, newQnnBatchRef, qnnBatchTag, type QnnAction } from './pm-workflow.js';
import { assertSeparation, assertBatchSeparation } from './pm-separation-guard.js';

const MS_DAY = 86400000;
function windowsFor(planned: Date, tol: number) {
  return { windowStart: new Date(planned.getTime() - tol * MS_DAY), windowEnd: new Date(planned.getTime() + tol * MS_DAY) };
}

/** Resolve AHU names for a set of entries (each entry carries schedule.entityId). */
async function ahuNameByEntry(entries: { id: string; schedule?: { entityId?: string | null } | null }[]): Promise<Map<string, string>> {
  const entityIds = [...new Set(entries.map((e) => e.schedule?.entityId).filter(Boolean) as string[])];
  const ahus = entityIds.length > 0
    ? await prisma.assetInstance.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(ahus.map((a) => [a.id, a.name]));
  const out = new Map<string, string>();
  for (const e of entries) out.set(e.id, (e.schedule?.entityId && nameById.get(e.schedule.entityId)) || '?');
  return out;
}

async function mintQnn(action: QnnAction, entry: any, ahuName: string, ctx: RequestContext, note: string, batchTag = '') {
  return generateQnn(action, {
    pmScheduleEntryId: entry.id,
    scheduleId: entry.scheduleId,
    ahuName,
    // `batchTag` is '' for a single-entry action; see qnnBatchTag.
    message: `${note} — ${ahuName} (month ${entry.month})${batchTag}`,
  }, ctx);
}

/** List schedule entries with workflow status for the PM Schedules table. */
export async function listEntries(
  _ctx: RequestContext,
  query: { approvalStatus?: string; year?: number; page?: number; limit?: number },
) {
  await checkPmEnabled();
  const page = query.page ?? 1;
  // The PM Schedules page renders a whole year's entries (12 months × AHUs) in one
  // table with no pagination UI, so the default cap must comfortably cover a full
  // year. Raised from 200 → 2000 (2026-06-12): the old cap silently hid entries
  // beyond the first 50/200 in the ALL view.
  const limit = (query.limit ?? 50) /* no page-size cap (operator decision 2026-09-04): callers get the size they ask for */;
  const year = query.year ?? new Date().getFullYear();

  const where: any = { schedule: { status: 'ACTIVE', year } };
  if (query.approvalStatus && query.approvalStatus !== 'ALL') {
    where.approvalStatus = query.approvalStatus;
  }

  const [entries, total] = await Promise.all([
    prisma.pmScheduleEntry.findMany({
      where,
      include: { schedule: true },
      orderBy: { plannedDate: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pmScheduleEntry.count({ where }),
  ]);

  const entityIds = [...new Set(entries.map((e: any) => e.schedule?.entityId).filter(Boolean))];
  const ahus = entityIds.length > 0
    ? await prisma.assetInstance.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
    : [];
  const ahuMap = new Map(ahus.map(a => [a.id, a.name]));

  const data = entries.map((e: any) => ({
    id: e.id,
    scheduleId: e.scheduleId,
    ahuId: e.schedule?.entityId,
    ahuName: ahuMap.get(e.schedule?.entityId) ?? '?',
    month: e.month,
    plannedDate: e.plannedDate,
    toleranceDays: e.toleranceDays,
    windowStart: e.windowStart,
    windowEnd: e.windowEnd,
    approvalStatus: e.approvalStatus,
    approvalRemarks: e.approvalRemarks,
    submittedByName: e.submittedByName,
    reviewedByName: e.reviewedByName,
    reviewedAt: e.reviewedAt,
    reviewRemarks: e.reviewRemarks,
    approvedByName: e.approvedByName,
    approvedAt: e.approvedAt,
    rejectedByName: e.rejectedByName,
    rejectedAt: e.rejectedAt,
    rejectionStage: e.rejectionStage,
    pendingPlannedDate: e.pendingPlannedDate,
    pendingToleranceDays: e.pendingToleranceDays,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Audit 2026-09-24 (C-F9): segregation of duties by USER. Role separation alone
 * is config-borne — with a blank reviewRole/approvalRole any PM_REVIEW /
 * PM_APPROVE holder could sign off their own upload. The uploader may not
 * review or approve their own entries, and the reviewer may not also approve.
 */
function assertNotOwnEntry(
  ctx: RequestContext,
  entries: Array<{ submittedBy: string | null; reviewedBy: string | null }>,
  step: 'review' | 'approve' | 'reject',
) {
  // A-07 (2026-10-21): fail CLOSED. A request with no caller id cannot prove it
  // is a different person, so it is refused rather than waved through.
  if (!ctx.userSub) {
    throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', 'The signing user could not be identified, so separation of duties cannot be verified.');
  }
  const own = entries.some((e) => e.submittedBy === ctx.userSub || (step !== 'review' && e.reviewedBy === ctx.userSub));
  if (own) {
    throw new AppError(403, 'SELF_APPROVAL_FORBIDDEN', `You cannot ${step} a PM schedule entry you submitted or reviewed yourself. A different user must sign off.`);
  }
}

/**
 * What a rejection writes. A plain entry becomes REJECTED. A CHANGE to an
 * approved visit (pendingPlannedDate set) is discarded instead, and the visit
 * stays APPROVED on its original date (D2, operator decision 2026-10-21):
 * rejecting a proposed new date must not cancel the scheduled maintenance. The
 * rejection itself is recorded by the caller's audit row and QNN. The review
 * fields described the rejected change, so they are cleared.
 */
function rejectionUpdate(
  entry: { pendingPlannedDate: Date | null },
  stage: 'REVIEW' | 'APPROVAL',
  remarks: string,
  ctx: RequestContext,
) {
  const dropChange = { pendingPlannedDate: null, pendingToleranceDays: null, pendingEditBy: null, pendingEditAt: null };
  if (entry.pendingPlannedDate != null) {
    return {
      approvalStatus: 'APPROVED' as const, ...dropChange,
      reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewRemarks: null,
    };
  }
  return {
    approvalStatus: 'REJECTED' as const, rejectionStage: stage,
    rejectedBy: ctx.userSub, rejectedByName: ctx.userId, rejectedAt: new Date(),
    approvalRemarks: remarks,
    // A rejected entry carries no proposal: a later resubmit + approval must
    // not lay a stale date over the resubmitted one (D11, 2026-10-21).
    ...dropChange,
  };
}

/** Audit fields for a rejection, naming a discarded change and the visit it left standing. */
function rejectionAudit(entry: { pendingPlannedDate: Date | null; pendingToleranceDays: number | null; plannedDate: Date; toleranceDays: number }, stage: 'REVIEW' | 'APPROVAL', remarks: string) {
  return entry.pendingPlannedDate != null
    ? {
      stage, remarks, changeRejected: true,
      rejectedChange: { plannedDate: entry.pendingPlannedDate, toleranceDays: entry.pendingToleranceDays },
      visitKept: { plannedDate: entry.plannedDate, toleranceDays: entry.toleranceDays, approvalStatus: 'APPROVED' },
    }
    : { stage, remarks };
}

/**
 * Review step (workflow ON). action='approve' moves PENDING_REVIEW →
 * PENDING_APPROVAL; action='reject' moves PENDING_REVIEW → REJECTED (stage REVIEW).
 * Gated by the configured reviewRole.
 */
export async function reviewEntries(
  ctx: RequestContext,
  entryIds: string[],
  action: 'approve' | 'reject',
  remarks?: string,
) {
  await checkPmEnabled();
  const cfg = await getPmWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.reviewRole, 'review');
  // A review that sends an entry on needs a reason too, not only a rejection (D03-13).
  remarks = requireDecisionRemarks(remarks);

  const entries = await prisma.pmScheduleEntry.findMany({ where: { id: { in: entryIds } }, include: { schedule: true } });
  if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');
  assertNotOwnEntry(ctx, entries, 'review');
  const ahuNames = await ahuNameByEntry(entries as any);
  const qnns: string[] = [];

  // Reviewable from PENDING_REVIEW, plus legacy PENDING entries that predate the
  // workflow being enabled (so they enter review instead of being stuck as
  // directly-approvable). Workflow must be ON for PENDING to count as reviewable.
  // ONE predicate, used to size the batch AND to guard the loop, so the "n of N"
  // in the batch tag can never disagree with the rows actually processed.
  const isReviewable = (e: typeof entries[number]) =>
    e.approvalStatus === 'PENDING_REVIEW' || (cfg.workflowEnabled && e.approvalStatus === 'PENDING');
  const batchTotal = entries.filter(isReviewable).length;
  // The AHUs this batch touches, named in the tag so a reader can see which
  // units one bulk action covered without opening every row.
  const batchAhus = [...new Set(entries.filter(isReviewable).map((e) => ahuNames.get(e.id) ?? '?'))];
  const batchRef = batchTotal > 1 ? newQnnBatchRef() : null;

  for (const entry of entries) {
    if (!isReviewable(entry)) continue;
    const ahuName = ahuNames.get(entry.id) ?? '?';
    if (action === 'approve') {
      await prisma.pmScheduleEntry.update({
        where: { id: entry.id },
        data: {
          approvalStatus: 'PENDING_APPROVAL',
          reviewedBy: ctx.userSub, reviewedByName: ctx.userId, reviewedAt: new Date(),
          reviewRemarks: remarks,
        },
      });
      qnns.push(await mintQnn('REVIEW', entry, ahuName, ctx, 'Reviewed (sent for approval)',
        qnnBatchTag(batchRef, qnns.length + 1, batchTotal, batchAhus)));
      await auditLog({ userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_REVIEWED', targetType: 'pm_schedule_entry', targetId: entry.id, afterValue: { remarks, ahuName }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    } else {
      await prisma.pmScheduleEntry.update({
        where: { id: entry.id },
        data: rejectionUpdate(entry, 'REVIEW', remarks!.trim(), ctx),
      });
      qnns.push(await mintQnn('REJECT', entry, ahuName, ctx,
        entry.pendingPlannedDate != null ? 'Change rejected at review (visit stays approved)' : 'Rejected at review',
        qnnBatchTag(batchRef, qnns.length + 1, batchTotal, batchAhus)));
      await auditLog({ userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_REJECTED', targetType: 'pm_schedule_entry', targetId: entry.id, afterValue: rejectionAudit(entry, 'REVIEW', remarks!.trim()), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    }
  }
  return { processed: qnns.length, qnns };
}

/** Approve selected entries (final approval). Applies any pending edit. */
export async function approveEntries(ctx: RequestContext, entryIds: string[], comment?: string) {
  await checkPmEnabled();
  const cfg = await getPmWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.approvalRole, 'approve');
  comment = requireDecisionRemarks(comment); // an approval says why too (D03-13)

  const entries = await prisma.pmScheduleEntry.findMany({ where: { id: { in: entryIds } }, include: { schedule: true } });
  if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');
  assertNotOwnEntry(ctx, entries, 'approve');
  const ahuNames = await ahuNameByEntry(entries as any);

  // Approvable from PENDING_APPROVAL (workflow ON) or legacy PENDING (workflow OFF).
  const results: string[] = [];
  const qnns: string[] = [];
  // Workflow ON: approve ONLY from PENDING_APPROVAL — review must happen first.
  // Workflow OFF (legacy): PENDING is directly approvable. One predicate sizes the
  // batch and guards the loop (see reviewEntries).
  const isApprovable = (e: typeof entries[number]) => cfg.workflowEnabled
    ? e.approvalStatus === 'PENDING_APPROVAL'
    : (e.approvalStatus === 'PENDING_APPROVAL' || e.approvalStatus === 'PENDING');
  const batchTotal = entries.filter(isApprovable).length;
  // The AHUs this batch touches, named in the tag so a reader can see which
  // units one bulk action covered without opening every row.
  const batchAhus = [...new Set(entries.filter(isApprovable).map((e) => ahuNames.get(e.id) ?? '?'))];
  const batchRef = batchTotal > 1 ? newQnnBatchRef() : null;
  const goingLive = (e: typeof entries[number]) => {
    const hasPendingEdit = e.pendingPlannedDate != null;
    return {
      hasPendingEdit,
      plannedDate: hasPendingEdit ? e.pendingPlannedDate! : e.plannedDate,
      toleranceDays: hasPendingEdit && e.pendingToleranceDays != null ? e.pendingToleranceDays : e.toleranceDays,
    };
  };

  // Re-check the separation rule at the moment staged edits go LIVE — for the
  // whole batch, before anything is written (D3, see assertBatchSeparation).
  //
  // editApprovedEntry() already validated each date when it was proposed, but
  // approval happens later and the schedule can move underneath it — another
  // entry added, or another pending edit approved first. Validating only at
  // request time would let two approvals, each fine on its own, combine into
  // an overlap. This is the last point at which it can still be refused.
  await assertBatchSeparation(
    entries.filter((e) => isApprovable(e) && e.pendingPlannedDate != null).map((e) => {
      const live = goingLive(e);
      return { scheduleId: e.scheduleId, entryId: e.id, plannedDate: live.plannedDate, toleranceDays: live.toleranceDays };
    }),
    'This approved change',
  );

  for (const entry of entries) {
    const approvable = isApprovable(entry);
    if (!approvable) {
      results.push(`${entry.id}: not awaiting approval (${entry.approvalStatus})`);
      continue;
    }
    const { hasPendingEdit, plannedDate: newPlannedDate, toleranceDays: newTolerance } = goingLive(entry);
    const { windowStart, windowEnd } = windowsFor(newPlannedDate, newTolerance);

    await prisma.pmScheduleEntry.update({
      where: { id: entry.id },
      data: {
        approvalStatus: 'APPROVED',
        approvalRemarks: comment,
        approvedBy: ctx.userSub, approvedByName: ctx.userId, approvedAt: new Date(),
        rejectionStage: null, rejectedBy: null, rejectedByName: null, rejectedAt: null,
        ...(hasPendingEdit ? {
          plannedDate: newPlannedDate, toleranceDays: newTolerance, windowStart, windowEnd,
          pendingPlannedDate: null, pendingToleranceDays: null, pendingEditBy: null, pendingEditAt: null,
        } : {}),
      },
    });
    qnns.push(await mintQnn('APPROVE', entry, ahuNames.get(entry.id) ?? '?', ctx, 'Approved',
      qnnBatchTag(batchRef, qnns.length + 1, batchTotal, batchAhus)));
    await auditLog({ userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_APPROVED', targetType: 'pm_schedule_entry', targetId: entry.id, afterValue: { comment, hasPendingEdit, ahuName: ahuNames.get(entry.id) ?? '?' }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
    results.push(`${entry.id}: approved`);
  }
  return { processed: results.length, results, qnns };
}

/** Reject at the approval stage with mandatory remarks. */
export async function rejectEntries(ctx: RequestContext, entryIds: string[], remarks: string) {
  await checkPmEnabled();
  const cfg = await getPmWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.approvalRole, 'approve');
  if (!remarks || remarks.trim().length < 3) {
    throw new AppError(400, 'REMARKS_REQUIRED', 'Remarks are required when rejecting (min 3 characters)');
  }

  const entries = await prisma.pmScheduleEntry.findMany({ where: { id: { in: entryIds } }, include: { schedule: true } });
  if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');
  assertNotOwnEntry(ctx, entries, 'reject');
  const ahuNames = await ahuNameByEntry(entries as any);
  const qnns: string[] = [];

  // Approval-stage reject: workflow ON → only PENDING_APPROVAL (a PENDING entry
  // hasn't been reviewed yet — it's rejected at the review stage instead).
  // Workflow OFF → legacy PENDING is rejectable here. One predicate sizes the
  // batch and guards the loop (see reviewEntries).
  const isRejectable = (e: typeof entries[number]) => cfg.workflowEnabled
    ? e.approvalStatus === 'PENDING_APPROVAL'
    : (e.approvalStatus === 'PENDING_APPROVAL' || e.approvalStatus === 'PENDING');
  const batchTotal = entries.filter(isRejectable).length;
  // The AHUs this batch touches, named in the tag so a reader can see which
  // units one bulk action covered without opening every row.
  const batchAhus = [...new Set(entries.filter(isRejectable).map((e) => ahuNames.get(e.id) ?? '?'))];
  const batchRef = batchTotal > 1 ? newQnnBatchRef() : null;

  for (const entry of entries) {
    if (!isRejectable(entry)) continue;
    await prisma.pmScheduleEntry.update({
      where: { id: entry.id },
      data: rejectionUpdate(entry, 'APPROVAL', remarks.trim(), ctx),
    });
    qnns.push(await mintQnn('REJECT', entry, ahuNames.get(entry.id) ?? '?', ctx,
      entry.pendingPlannedDate != null ? 'Change rejected at approval (visit stays approved)' : 'Rejected at approval',
      qnnBatchTag(batchRef, qnns.length + 1, batchTotal, batchAhus)));
    await auditLog({ userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_REJECTED', targetType: 'pm_schedule_entry', targetId: entry.id, afterValue: rejectionAudit(entry, 'APPROVAL', remarks.trim()), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
  }
  // Count what was actually rejected (one QNN each), not what was asked for.
  return { processed: qnns.length, qnns };
}

/** Re-submit a rejected entry with corrected data. Goes back to the start of the flow. */
// D03-09 / F-42 (2026-10-22): the route runs this BEFORE the re-auth gate (a
// refused request costs no password and leaves no REAUTH_* row); the write
// runs it again.
export async function assertCanResubmit(entryId: string, data: { plannedDate: string; toleranceDays?: number }) {
  await checkPmEnabled();
  const cfg = await getPmWorkflowConfig();
  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId }, include: { schedule: true } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
  if (entry.approvalStatus !== 'REJECTED') {
    throw new AppError(400, 'INVALID_STATUS', 'Only rejected entries can be re-submitted');
  }

  const planned = new Date(data.plannedDate);
  if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');
  const tol = data.toleranceDays ?? entry.toleranceDays;
  await assertSeparation(entry.scheduleId, { plannedDate: planned, toleranceDays: tol, entryId: entryId }, 'This visit');
  return { cfg, entry, planned, tol };
}

export async function resubmitEntry(
  ctx: RequestContext,
  entryId: string,
  data: { plannedDate: string; toleranceDays?: number },
) {
  const { cfg, entry, planned, tol } = await assertCanResubmit(entryId, data);
  const { windowStart, windowEnd } = windowsFor(planned, tol);
  const nextStatus = cfg.workflowEnabled ? 'PENDING_REVIEW' : 'PENDING';

  const updated = await prisma.pmScheduleEntry.update({
    where: { id: entryId },
    data: {
      plannedDate: planned, toleranceDays: tol, windowStart, windowEnd,
      approvalStatus: nextStatus,
      approvalRemarks: null,
      reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewRemarks: null,
      approvedBy: null, approvedByName: null, approvedAt: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectionStage: null,
      submittedBy: ctx.userSub, submittedByName: ctx.userId,
      // The resubmitted date IS the proposal; a staged edit left by a review
      // reject before D11 was fixed must not be applied over it at approval.
      pendingPlannedDate: null, pendingToleranceDays: null, pendingEditBy: null, pendingEditAt: null,
    },
  });
  const ahuName = (await ahuNameByEntry([entry as any])).get(entry.id) ?? '?';
  const qnn = await mintQnn('RESUBMIT', entry, ahuName, ctx, 'Resubmitted');

  await auditLog({ userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_RESUBMITTED', targetType: 'pm_schedule_entry', targetId: entryId, afterValue: { plannedDate: data.plannedDate, toleranceDays: tol }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
  return { ...updated, qnn };
}

/** Edit an approved entry — stages proposed values and sends it back through the flow. */
// D03-09 / F-42 (2026-10-22): the route runs this BEFORE the re-auth gate (a
// refused request costs no password and leaves no REAUTH_* row); the write
// runs it again.
export async function assertCanEditApproved(entryId: string, data: { plannedDate: string; toleranceDays?: number }) {
  await checkPmEnabled();
  const cfg = await getPmWorkflowConfig();
  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId }, include: { schedule: true } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
  if (entry.approvalStatus !== 'APPROVED') {
    throw new AppError(400, 'INVALID_STATUS', 'Only approved entries can be edited (pending changes require approval)');
  }

  const planned = new Date(data.plannedDate);
  if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');
  // Checked here AND again when the pending value goes live: entries can be
  // added or moved between the request and the approval, so a date that was
  // clear when proposed may not be clear when applied.
  await assertSeparation(
    entry.scheduleId,
    { plannedDate: planned, toleranceDays: data.toleranceDays ?? entry.toleranceDays, entryId },
    'This visit',
  );
  return { cfg, entry, planned };
}

export async function editApprovedEntry(
  ctx: RequestContext,
  entryId: string,
  data: { plannedDate: string; toleranceDays?: number },
) {
  const { cfg, entry, planned } = await assertCanEditApproved(entryId, data);
  const nextStatus = cfg.workflowEnabled ? 'PENDING_REVIEW' : 'PENDING';

  const updated = await prisma.pmScheduleEntry.update({
    where: { id: entryId },
    data: {
      pendingPlannedDate: planned,
      pendingToleranceDays: data.toleranceDays ?? entry.toleranceDays,
      pendingEditBy: ctx.userSub, pendingEditAt: new Date(),
      // The status tracks the CHANGE through review/approval. The visit itself
      // stays in force on its approved date (PM_ENTRY_IN_FORCE, D2), so the
      // approval attribution of that date is kept; approving the change
      // overwrites it, rejecting the change leaves it standing.
      approvalStatus: nextStatus,
      reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewRemarks: null,
      submittedBy: ctx.userSub, submittedByName: ctx.userId,
    },
  });
  const ahuName = (await ahuNameByEntry([entry as any])).get(entry.id) ?? '?';
  const qnn = await mintQnn('EDIT', entry, ahuName, ctx, 'Edit requested');

  await auditLog({ userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_EDIT_REQUESTED', targetType: 'pm_schedule_entry', targetId: entryId, beforeValue: { plannedDate: entry.plannedDate, toleranceDays: entry.toleranceDays }, afterValue: { pendingPlannedDate: data.plannedDate, pendingToleranceDays: data.toleranceDays ?? entry.toleranceDays }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent });
  return { ...updated, qnn };
}

/**
 * Reviewer modifies a PENDING_REVIEW entry in place (date/tolerance) before
 * sending it on for approval. Status stays PENDING_REVIEW. Gated by reviewRole.
 */
export async function modifyReviewEntry(
  ctx: RequestContext,
  entryId: string,
  data: { plannedDate: string; toleranceDays?: number },
) {
  await checkPmEnabled();
  const cfg = await getPmWorkflowConfig();
  assertPmRole(ctx.userRole, cfg.reviewRole, 'review');
  const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId }, include: { schedule: true } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
  if (entry.approvalStatus !== 'PENDING_REVIEW') {
    throw new AppError(400, 'INVALID_STATUS', 'Only entries awaiting review can be modified by the reviewer');
  }
  const planned = new Date(data.plannedDate);
  if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');
  // An entry under review may be an EDIT of an approved visit: its live columns
  // hold the approved date and the proposal sits in pending* (D10, 2026-10-21).
  // The reviewer adjusts the PROPOSAL. Writing the live columns changed an
  // approved visit with no approval, and the approval then laid the old
  // proposal on top, discarding the reviewer's change.
  const isEdit = entry.pendingPlannedDate != null;
  const tol = data.toleranceDays ?? (isEdit ? entry.pendingToleranceDays ?? entry.toleranceDays : entry.toleranceDays);
  const { windowStart, windowEnd } = windowsFor(planned, tol);
  // Audit 2026-09-24 (C-F4): the review-edit was the one single-entry write with
  // no separation check — a reviewer could move a visit onto a sibling's window.
  await assertSeparation(entry.scheduleId, { plannedDate: planned, toleranceDays: tol, entryId }, 'This visit');

  const updated = await prisma.pmScheduleEntry.update({
    where: { id: entryId },
    data: {
      ...(isEdit
        ? { pendingPlannedDate: planned, pendingToleranceDays: tol }
        : { plannedDate: planned, toleranceDays: tol, windowStart, windowEnd }),
      // Record the reviewer touched it, but keep it in the review stage.
      reviewedBy: ctx.userSub, reviewedByName: ctx.userId, reviewedAt: new Date(),
    },
  });
  const ahuName = (await ahuNameByEntry([entry as any])).get(entry.id) ?? '?';
  const qnn = await mintQnn('EDIT', entry, ahuName, ctx, 'Modified at review');
  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_REVIEW_MODIFIED', targetType: 'pm_schedule_entry', targetId: entryId,
    beforeValue: isEdit
      ? { pendingPlannedDate: entry.pendingPlannedDate, pendingToleranceDays: entry.pendingToleranceDays }
      : { plannedDate: entry.plannedDate, toleranceDays: entry.toleranceDays },
    afterValue: isEdit
      ? { pendingPlannedDate: data.plannedDate, pendingToleranceDays: tol }
      : { plannedDate: data.plannedDate, toleranceDays: tol },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });
  return { ...updated, qnn };
}

/** Counts per workflow stage for status badges. */
export async function pendingCounts(_ctx: RequestContext) {
  await checkPmEnabled();
  const baseWhere = { schedule: { status: 'ACTIVE' as const } };
  const [pending, pendingReview, pendingApproval, rejected] = await Promise.all([
    prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'PENDING' } }),
    prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'PENDING_REVIEW' } }),
    prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'PENDING_APPROVAL' } }),
    prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'REJECTED' } }),
  ]);
  // `pending` (legacy + review + approval) kept for the existing badge consumer.
  return { pending: pending + pendingReview + pendingApproval, pendingReview, pendingApproval, rejected };
}
