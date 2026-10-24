/**
 * Quality notifications (QNN) for the filter creation workflow (operator request
 * 2026-10-24: "for filters upload, review and approve qnn is there or not — add
 * for this also"). Until then only PM and replacement schedules minted QNNs; a
 * filter's create / review / approve / reject / resubmit wrote audit rows only.
 *
 * Same shape as PM (pm-approval.ts mintQnn): ONE QNN per filter, a batch tag when
 * one action covers several filters (qnnBatchTag names the AHUs it touched), and
 * the notification tagged for the next step's role — from the FILTER workflow's
 * settings (filter-approval config), not PM's.
 *
 * Minted only while the filter workflow is ON (the caller decides): with it off a
 * filter is an ordinary record with no review / approval step to report.
 *
 * Storage: the QNN row has no subject column. The filter id goes into the soft
 * `pm_schedule_entry_id` uuid column (no foreign key, and nothing dereferences it
 * — the QNN list, export and Super Admin edit read only their own fields), the
 * same way replacement-schedule QNNs keep their entry id there; the notification
 * metadata carries it as `filterId`, and every message starts with "Filter …".
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { generateQnn, newQnnBatchRef, qnnBatchTag, type QnnAction } from '../pm-schedules/pm-workflow.js';
import { getFilterWorkflowConfig } from './filter-workflow.js';

/**
 * Mint one QNN per filter for `action`. `happened` completes the plain-language
 * message "Filter <name> <happened>" ("approved. It can now be cleaned."); it may
 * depend on the filter (a reject names its step). Returns the QNN numbers in the
 * order of `filters`.
 */
export async function mintFilterQnns(
  action: QnnAction,
  filters: ReadonlyArray<{ id: string; name: string }>,
  ctx: RequestContext,
  happened: string | ((f: { id: string; name: string }) => string),
): Promise<string[]> {
  if (filters.length === 0) return [];
  const cfg = await getFilterWorkflowConfig();

  // Each filter's AHU (its parent) for the QNN's AHU column and the batch tag.
  const rows = await prisma.assetInstance.findMany({ where: { id: { in: filters.map((f) => f.id) } }, select: { id: true, parentId: true } });
  const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is string => !!x))];
  const parents = parentIds.length
    ? await prisma.assetInstance.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
    : [];
  const parentName = new Map(parents.map((p) => [p.id, p.name]));
  const ahuOf = new Map(rows.map((r) => [r.id, r.parentId ? parentName.get(r.parentId) ?? null : null]));

  const batchRef = filters.length > 1 ? newQnnBatchRef() : null;
  const batchAhus = [...new Set(filters.map((f) => ahuOf.get(f.id) ?? '?'))];
  const qnns: string[] = [];
  for (const [i, f] of filters.entries()) {
    const ahuName = ahuOf.get(f.id) ?? null;
    const what = typeof happened === 'function' ? happened(f) : happened;
    qnns.push(await generateQnn(action, {
      pmScheduleEntryId: f.id, // soft uuid column: holds the FILTER id (see the header)
      scheduleId: null,
      ahuName,
      subject: 'Filter',
      filterId: f.id,
      route: { reviewRole: cfg.reviewRole, approvalRole: cfg.approvalRole },
      message: `Filter ${f.name} ${what}${qnnBatchTag(batchRef, i + 1, filters.length, batchAhus)}`,
    }, ctx));
  }
  return qnns;
}

/** "created. Waiting for review." — a create / upload / resubmit QNN, by the status the filter now has. */
export function filterSubmissionNote(verb: 'created' | 'uploaded' | 'resubmitted', status: string): string {
  return status === 'APPROVED'
    ? `${verb}. Approved at once (Super Admin).`
    : `${verb}. Waiting for review.`;
}
