/**
 * PM Schedule 3-step workflow helpers: config-driven role gates + QNN generation.
 *
 * The workflow config lives in system_config['pm-schedule-approval'] (surfaced on
 * Config → "PM Schedule Workflow"):
 *   { workflowEnabled, uploadRole, reviewRole, approvalRole }
 * When workflowEnabled, an uploaded entry must pass review (PENDING_REVIEW →
 * PENDING_APPROVAL) and then approval (→ APPROVED) before it generates tasks.
 *
 * QNN = Quality Notification Number (QN-YYYY-000001, from the qnn_seq sequence),
 * generated for every workflow action and recorded in quality_notifications.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { createNotification } from '../notifications/notification.service.js';

export interface PmWorkflowConfig {
  workflowEnabled: boolean;
  uploadRole: string;
  reviewRole: string;
  approvalRole: string;
}

export async function getPmWorkflowConfig(): Promise<PmWorkflowConfig> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-approval' } });
  const v = (cfg?.configValue as any) ?? {};
  return {
    workflowEnabled: v.workflowEnabled === true, // default OFF until review UI ships
    uploadRole: (v.uploadRole ?? '').toString().trim(),
    reviewRole: (v.reviewRole ?? '').toString().trim(),
    approvalRole: (v.approvalRole ?? '').toString().trim(),
  };
}

/**
 * Role gate for a workflow step. SUPER_ADMIN always passes; an unset configured
 * role means "anyone with the route permission" (no extra role restriction).
 */
export function assertPmRole(userRole: string | undefined, configuredRole: string, actionLabel: string) {
  if (userRole === 'SUPER_ADMIN') return;
  if (!configuredRole) return;
  if (userRole !== configuredRole) {
    throw new AppError(403, 'FORBIDDEN_ROLE', `Only users with role "${configuredRole}" can ${actionLabel} PM schedules`);
  }
}

/** PM workflow actions that generate a QNN. */
export type QnnAction = 'UPLOAD' | 'REVIEW' | 'APPROVE' | 'REJECT' | 'RESUBMIT' | 'EDIT';

/**
 * Generate the next QNN (QN-YYYY-000001) and record it in quality_notifications.
 * Returns the QNN string. Phase 6 turns these into Notification-center entries.
 */
// Human label for each action (clear past-tense wording in the notification).
const ACTION_LABEL: Record<QnnAction, string> = {
  UPLOAD: 'Uploaded', REVIEW: 'Reviewed', APPROVE: 'Approved',
  REJECT: 'Rejected', RESUBMIT: 'Resubmitted', EDIT: 'Modified',
};

export async function generateQnn(
  action: QnnAction,
  opts: { pmScheduleEntryId?: string | null; scheduleId?: string | null; ahuName?: string | null; message?: string | null; subject?: string },
  ctx: RequestContext,
): Promise<string> {
  const rows = await prisma.$queryRaw<{ seq: bigint }[]>`SELECT nextval('qnn_seq') AS seq`;
  const seq = Number(rows?.[0]?.seq ?? 0);
  const year = new Date().getFullYear();
  const qnn = `QN-${year}-${String(seq).padStart(6, '0')}`;
  const subject = opts.subject ?? 'PM Schedule';
  const who = ctx.userId ?? 'unknown';
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');

  await prisma.qualityNotification.create({
    data: {
      qnn,
      action,
      pmScheduleEntryId: opts.pmScheduleEntryId ?? null,
      scheduleId: opts.scheduleId ?? null,
      ahuName: opts.ahuName ?? null,
      message: opts.message ?? null,
      performedBy: ctx.userSub ?? null,
      performedByName: ctx.userId ?? null,
    },
  });

  // Surface the QNN in the Notifications center with the FULL detail line:
  // QNN · subject · action · target · who (user id + role) · when.
  const cfg = await getPmWorkflowConfig();
  let forRole: string | null = null;
  if (action === 'UPLOAD') forRole = cfg.reviewRole || cfg.approvalRole || null;
  else if (action === 'REVIEW') forRole = cfg.approvalRole || null;
  const detail = [
    `QNN: ${qnn}`,
    `Action: ${ACTION_LABEL[action] ?? action} (${action})`,
    opts.ahuName ? `AHU: ${opts.ahuName}` : null,
    opts.message ? `Details: ${opts.message}` : null,
    `By: ${who}${ctx.userRole ? ` (${ctx.userRole})` : ''}`,
    `On: ${when} UTC`,
  ].filter(Boolean).join('\n');
  try {
    await createNotification({
      type: 'PM_SCHEDULE_QNN',
      title: `${qnn} · ${subject} ${ACTION_LABEL[action] ?? action} · by ${who}`,
      message: detail.slice(0, 1000),
      forRole: forRole || undefined,
      metadata: { qnn, action, subject, pmScheduleEntryId: opts.pmScheduleEntryId ?? null, scheduleId: opts.scheduleId ?? null, ahuName: opts.ahuName ?? null, performedBy: ctx.userSub ?? null, performedByName: ctx.userId ?? null, performedByRole: ctx.userRole ?? null, at: when },
      createdBy: ctx.userId ?? undefined,
    });
  } catch { /* QNN is recorded even if the notification emit fails */ }
  return qnn;
}
