/**
 * The approval fields a newly SUBMITTED PM visit carries — ONE rule for every
 * door a visit can be created through (D-OPS-10, 2026-10-22):
 *
 *   - the CSV/XLSX upload            (pm-import.ts)
 *   - "Add a visit"                  (pm-visits.ts, POST /visits)
 *   - create a schedule with entries (pm-schedule-crud.ts, POST /)
 *
 * Workflow ON: the visit lands in PENDING_REVIEW — review + approval required.
 * Workflow OFF (legacy single step): it waits in PENDING for a PM_APPROVE holder.
 * A SUPER_ADMIN's own visit is approved directly in both cases (operator
 * decision 2026-10-24, lib/super-admin-own-work.ts — its own work is not held;
 * workflow OFF did this already). The caller records the skip on its audit row
 * (`pmReviewSkippedBySuperAdmin` → PM_REVIEW).
 *
 * create() used to write its entries at the column default (PENDING, no
 * submitter) whatever the workflow said, so with the workflow ON they skipped
 * Review entirely. Copying this block per call site is how that happened; keep
 * it here.
 *
 * Pure on purpose: no database, no workflow read — callers pass the config they
 * already loaded.
 */
import type { RequestContext } from '../../types/context.js';
import type { PmWorkflowConfig } from './pm-workflow.js';
import { isSuperAdminOwnWork } from '../../lib/super-admin-own-work.js';

export function submissionApprovalFields(
  ctx: Pick<RequestContext, 'userSub' | 'userId' | 'userRole' | 'isOfflineReplay'>,
  wf: Pick<PmWorkflowConfig, 'workflowEnabled'>,
  now: Date = new Date(),
) {
  if (isSuperAdminOwnWork(ctx)) {
    return {
      approvalStatus: 'APPROVED' as const,
      submittedBy: ctx.userSub,
      submittedByName: ctx.userId,
      approvedBy: ctx.userSub, approvedByName: ctx.userId, approvedAt: now,
    };
  }
  return {
    approvalStatus: wf.workflowEnabled ? 'PENDING_REVIEW' as const : 'PENDING' as const,
    submittedBy: ctx.userSub,
    submittedByName: ctx.userId,
  };
}

/**
 * A Super Admin's own PM submission / change went live at once, where anyone
 * else's would wait for review or approval — the caller records PM_REVIEW.
 */
export function pmReviewSkippedBySuperAdmin(ctx: Pick<RequestContext, 'userRole' | 'isOfflineReplay'>): boolean {
  return isSuperAdminOwnWork(ctx);
}
