/**
 * Plain-language QNN messages (operator 2026-10-24: "in quality notifications
 * show message content properly — basic, human readable, simple,
 * understandable").
 *
 * Every QNN message is one or two short sentences: what it is about (a PM
 * visit, a filter replacement, a filter), for which AHU and date, what
 * happened, what happens next, and for a rejection the reason. A bulk action
 * adds its batch reference ("Batch B-3F7A2C: 2 of 15 (AHU-88, AHU-90).").
 *
 * Before this the messages were short codes — "Edited (applied at once, Super
 * Admin) — CWH/RDU (month 10)", "[batch B-FEE70F, 3 of 3 across …]" — that
 * named no date and needed the code to read. Rows written before stay as they
 * were stored; the Quality Notifications page rewords them for display
 * (apps/web/src/lib/qnn-message.ts).
 */
import { formatConfiguredDate } from '../../lib/format-datetime.js';

/** A calendar day in the configured date format ("08/10/2026"). */
export const qnnDay = (d: Date | string): Promise<string> => formatConfiguredDate(d);

/** " Reason: <remarks>." — for a rejection; '' when there are none. */
export function qnnReason(remarks?: string | null): string {
  const r = (remarks ?? '').trim().replace(/[.\s]+$/, '');
  return r ? ` Reason: ${r}.` : '';
}

/**
 * What happens next, from the status the record now has. "(Super Admin)" only
 * when it was one: with the workflow off, anyone's upload is approved at once.
 */
export function qnnNextStep(status: string | null | undefined, actorRole?: string | null): string {
  if (status === 'APPROVED') return actorRole === 'SUPER_ADMIN' ? ' Approved at once (Super Admin).' : ' Approved at once.';
  if (status === 'PENDING_REVIEW') return ' Waiting for review.';
  if (status === 'PENDING_APPROVAL' || status === 'PENDING') return ' Waiting for approval.';
  return '';
}

/** "3 filters" / "1 filter". */
export const qnnCount = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`;
