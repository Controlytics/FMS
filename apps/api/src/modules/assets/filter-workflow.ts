/**
 * Filter create/upload → review → approve workflow (2026-09-04).
 *
 * Config lives in system_config['filter-approval'] (Config → Role Assignments →
 * "Filter Creation Workflow"):
 *   { workflowEnabled, uploadRole, reviewRole, approvalRole }
 *
 * When `workflowEnabled`, a newly created or bulk-uploaded FILTER lands in
 * PENDING_REVIEW and must pass review (→ PENDING_APPROVAL) then approval (→
 * APPROVED) before it can be OPERATED. It is visible and readable throughout.
 *
 * Deliberately does NOT inherit from the PM config the way
 * `getReplacementWorkflowConfig` does — see filter-approval.def.ts for why.
 *
 * The role gate itself is `assertPmRole` from the PM module: one implementation
 * of "SUPER_ADMIN always passes; a blank configured role means anyone with the
 * route permission; otherwise the role must match exactly". Duplicating it here
 * would be a second place for that rule to drift.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { assertPmRole, normalizeRoles, type PmWorkflowConfig } from '../pm-schedules/pm-workflow.js';
import type { RequestContext } from '../../types/context.js';
import { isSuperAdminOwnWork } from '../../lib/super-admin-own-work.js';

export { assertPmRole };

/** Statuses a filter can hold. Reuses PmEntryApprovalStatus — see schema.prisma. */
export type FilterApprovalStatus = 'PENDING_REVIEW' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PENDING';

export async function getFilterWorkflowConfig(): Promise<PmWorkflowConfig> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-approval' } });
  const v = (cfg?.configValue as any) ?? {};
  return {
    workflowEnabled: v.workflowEnabled === true, // default OFF: absent row = today's behaviour
    uploadRole: normalizeRoles(v.uploadRole),
    reviewRole: (v.reviewRole ?? '').toString().trim(),
    approvalRole: (v.approvalRole ?? '').toString().trim(),
  };
}

/**
 * The status a newly created (or re-submitted) filter should carry.
 *
 * APPROVED when the workflow is off, so creation behaves exactly as it did
 * before this feature existed. Non-filter assets (Block / Area / AHU) never
 * call this — they keep the column's APPROVED default.
 *
 * APPROVED too for a Super Admin's own filter (operator decision 2026-10-24,
 * lib/super-admin-own-work.ts): its own work is not held for review. The caller
 * records the skip (`filterReviewSkippedBySuperAdmin` → FILTER_REVIEW on the
 * audit row); no reviewer / approver attribution is invented.
 */
export function initialApprovalStatus(
  cfg: PmWorkflowConfig,
  ctx: Pick<RequestContext, 'userRole' | 'isOfflineReplay'>,
): FilterApprovalStatus {
  if (!cfg.workflowEnabled) return 'APPROVED';
  return isSuperAdminOwnWork(ctx) ? 'APPROVED' : 'PENDING_REVIEW';
}

/** The review step was on but a Super Admin's own filter skipped it — record FILTER_REVIEW. */
export function filterReviewSkippedBySuperAdmin(
  cfg: PmWorkflowConfig,
  ctx: Pick<RequestContext, 'userRole' | 'isOfflineReplay'>,
): boolean {
  return cfg.workflowEnabled && isSuperAdminOwnWork(ctx);
}

/**
 * 🔴 The operability gate. A filter that has not been APPROVED cannot be
 * operated — no cycle start, advance, bypass or checklist submit.
 *
 * Called from `loadLocalContext()` (which every cycle-write path goes through)
 * and from `start-cycle.ts` (which loads via getFilter instead). It is
 * deliberately NOT in `getFilter()`: 6 of that function's 9 callers are reads
 * that must keep working, including reading a pending filter's own record.
 *
 * `status` is typed loosely because callers select it straight off Prisma rows.
 */
export function assertFilterOperable(status: string | null | undefined, filterName?: string | null): void {
  // An absent value means a row selected without the column, not an unapproved
  // filter — never block on a query's own omission.
  if (status == null || status === 'APPROVED') return;
  const label = filterName ? `Filter "${filterName}"` : 'This filter';
  const why = status === 'REJECTED'
    ? 'was rejected and must be corrected and re-submitted'
    : 'is still awaiting review/approval';
  throw new AppError(
    409,
    'FILTER_NOT_APPROVED',
    `${label} ${why}, so it cannot be operated yet.`,
    { approvalStatus: status },
  );
}

/** Prisma `where` fragment for lists that must show only operable filters. */
export const OPERABLE_FILTER_WHERE = { approvalStatus: 'APPROVED' as const };

/**
 * The filters that COUNT toward an AHU's completion: live (active, not
 * retired), a FILTER, and operable (APPROVED). THE one predicate (D03-05,
 * 2026-10-22) for the AHU-completion gate and every PM site — the deviation
 * sweep and missed-PM gate (pm-shared loadCountedFilters), My Tasks' "x/y
 * cleaned" (pm-due-tasks), the offline missed-PM map's probe filter
 * (pm-pending-tasks) and the per-set counts on the PM AHU config page. A filter
 * waiting in the creation workflow (pending review / approval, or rejected)
 * cannot be cleaned (BR-002), so counting it kept the AHU's PM visit from ever
 * completing. Spread it into a `where` next to the parent clause; the AHU's
 * filter-set mode is applied on top by each caller.
 */
export const COUNTED_FILTER_WHERE = {
  isActive: true,
  status: { not: 'Retired' },
  template: { templateKind: 'FILTER' },
  ...OPERABLE_FILTER_WHERE,
} satisfies Prisma.AssetInstanceWhereInput;
