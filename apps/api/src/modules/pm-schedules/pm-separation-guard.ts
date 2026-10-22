import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { checkSeparation, type SeparationInput } from './pm-separation.js';

/**
 * Enforce the visit-separation rule on a single entry against its siblings.
 *
 * `pm-separation.ts` holds the rule and stays pure; this is the thin layer that
 * knows about the database and about how to refuse. Bulk import does its own
 * whole-file check (it has every row in hand and must reject before writing) —
 * everything that touches ONE entry comes through here.
 *
 * ## Why every write path needs it
 *
 * A schedule can become invalid through six different doors in this module,
 * and a check on only the obvious one leaves the others open:
 *
 *   1. create a schedule with entries          (pm-schedule-crud.create)
 *   2. replace a schedule's entries            (pm-schedule-crud.update)
 *   3. re-submit a rejected entry on a new date(pm-approval.resubmitEntry)
 *   4. edit an APPROVED entry                  (pm-approval.editApprovedEntry)
 *   5. the reviewer's Modify                   (pm-approval.modifyReviewEntry)
 *   6. add one visit on a date                 (pm-visits.addVisit, 2026-10-22 —
 *      reads through its transaction via the optional `db` argument)
 *
 * (The upload validates its whole file itself; the Super Admin console's entry
 * create/edit in super-admin/routes.ts call assertSeparation as well.)
 *
 * Door 4 is the subtle one. The edit only STAGES `pendingPlannedDate`; the value
 * goes live later, when QA approves. Validating at request time is necessary but
 * not sufficient — a second entry can be added or moved in between, so the
 * pending date has to be re-checked at the moment it is applied. Both points
 * call this.
 */

/** Read through the caller's transaction when it has one, so the check sees what it will write next to. */
type Db = Pick<Prisma.TransactionClient, 'pmScheduleEntry'>;

/** Entries already on the schedule, excluding the one being written. */
async function siblingsOf(scheduleId: string, excludeEntryId?: string, db: Db = prisma): Promise<SeparationInput[]> {
  const rows = await db.pmScheduleEntry.findMany({
    where: { scheduleId, ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}) },
    select: { id: true, plannedDate: true, toleranceDays: true, pendingPlannedDate: true, pendingToleranceDays: true },
  });
  return rows.map((r) => ({
    // A sibling with an approved-but-pending edit is compared on its CURRENT
    // live values: the pending date is not in force yet, and treating it as if
    // it were would reject an edit against a date nobody has agreed to.
    ref: r.id,
    plannedDate: r.plannedDate,
    toleranceDays: r.toleranceDays,
  }));
}

/**
 * Throw 409 `PM_VISIT_OVERLAP` when `candidate` would overlap a sibling.
 *
 * `label` names the operation in the error so an operator editing an entry does
 * not get a message phrased as though they were uploading a file.
 */
export async function assertSeparation(
  scheduleId: string,
  candidate: { plannedDate: Date; toleranceDays: number; entryId?: string },
  label = 'This visit',
  db: Db = prisma,
): Promise<void> {
  const siblings = await siblingsOf(scheduleId, candidate.entryId, db);
  if (siblings.length === 0) return;

  const violations = checkSeparation([
    ...siblings,
    { ref: candidate.entryId ?? '__candidate__', plannedDate: candidate.plannedDate, toleranceDays: candidate.toleranceDays },
  ]);

  // Only violations involving the candidate matter here. Pre-existing overlaps
  // between two OTHER entries are grandfathered (operator decision 2026-08-27,
  // flagged in the UI) — failing an unrelated edit because of them would strand
  // the schedule.
  const mine = violations.filter(
    (v) => v.earlier.ref === (candidate.entryId ?? '__candidate__') || v.later.ref === (candidate.entryId ?? '__candidate__'),
  );
  if (mine.length === 0) return;

  throw new AppError(409, 'PM_VISIT_OVERLAP', `${label} cannot be scheduled here. ${mine[0].message}`);
}

/**
 * Validate staged edits that go live TOGETHER (bulk approve), before any of
 * them is written (D3, 2026-10-21).
 *
 * Checking entry by entry inside the approval loop had two faults: a refusal on
 * the second entry left the first already approved (QNN and audit row written)
 * while the client saw only the 409, and each check compared the entry's NEW
 * date with its siblings' OLD dates, although every edit in the batch goes live
 * at once. So each affected schedule is checked in its final state, and only
 * violations involving an edited entry refuse; overlaps between two untouched
 * entries stay grandfathered, as in assertSeparation.
 */
export async function assertBatchSeparation(
  edits: Array<{ scheduleId: string; entryId: string; plannedDate: Date; toleranceDays: number }>,
  label = 'This approval',
): Promise<void> {
  const bySchedule = new Map<string, typeof edits>();
  for (const e of edits) {
    if (!bySchedule.has(e.scheduleId)) bySchedule.set(e.scheduleId, []);
    bySchedule.get(e.scheduleId)!.push(e);
  }
  for (const [scheduleId, mine] of bySchedule) {
    const edited = new Set(mine.map((e) => e.entryId));
    const untouched = (await siblingsOf(scheduleId)).filter((s) => !edited.has(String(s.ref)));
    const violations = checkSeparation([
      ...untouched,
      ...mine.map((e) => ({ ref: e.entryId, plannedDate: e.plannedDate, toleranceDays: e.toleranceDays })),
    ]);
    const hit = violations.find((v) => edited.has(String(v.earlier.ref)) || edited.has(String(v.later.ref)));
    if (hit) throw new AppError(409, 'PM_VISIT_OVERLAP', `${label} cannot be scheduled here. ${hit.message}`);
  }
}

/**
 * Validate a whole proposed entry set before it replaces a schedule's entries.
 * Used by create/replace, where nothing exists to compare against yet.
 */
export function assertSetSeparation(entries: SeparationInput[], label = 'This schedule'): void {
  const violations = checkSeparation(entries);
  if (violations.length > 0) {
    throw new AppError(
      409,
      'PM_VISIT_OVERLAP',
      `${label} has visits that would be satisfied by the same cleaning. ${violations[0].message}`,
    );
  }
}
