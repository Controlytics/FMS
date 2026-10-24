/**
 * Quality Notification messages in plain language (operator 2026-10-24: "show
 * message content properly — basic, human readable, simple, understandable").
 *
 * Since 2026-10-24 the API writes every QNN message as plain sentences
 * (apps/api/src/modules/pm-schedules/qnn-message.ts). Rows written BEFORE that
 * hold short codes:
 *
 *   Uploaded — CWH/RDU (2026-11-03) (pending review) [batch B-EE7A3E, 1 of 36 across …]
 *   Edited (applied at once, Super Admin) — CWH/RDU (month 10)
 *   Approved — CWH/AHU-01 · 610x610x150 · 15µ · qty 3
 *   Filter rejected at review — L1/AHU-01/03
 *
 * `readableQnnMessage` rewords exactly those shapes, for the page and its
 * exports, in the same words the API now uses. The stored text is never
 * changed. Anything it does not recognise — every new message, a Super Admin
 * edit — is shown as stored.
 */

export const QNN_ACTION_LABEL: Record<string, string> = {
  UPLOAD: 'Uploaded', REVIEW: 'Reviewed', APPROVE: 'Approved',
  REJECT: 'Rejected', RESUBMIT: 'Resubmitted', EDIT: 'Changed',
};

/** "Approved" for APPROVE; an unknown code is shown as stored. */
export const qnnActionLabel = (action: string): string => QNN_ACTION_LABEL[action] ?? action;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The old batch tag → " Batch B-…: 1 of 3 (AHU-1, AHU-2)." */
const OLD_BATCH = / \[batch ([^,\]]+), (\d+) of (\d+)(?: across ([^\]]+))?\]$/;
function splitBatch(message: string): { body: string; batch: string } {
  const m = message.match(OLD_BATCH);
  if (!m) return { body: message, batch: '' };
  return { body: message.slice(0, m.index), batch: ` Batch ${m[1]}: ${m[2]} of ${m[3]}${m[4] ? ` (${m[4]})` : ''}.` };
}

/** What happened, for the old PM and replacement notes. */
const OLD_NOTE: Record<string, string> = {
  'Reviewed (sent for approval)': 'reviewed. Sent for approval.',
  Approved: 'approved.',
  'Rejected at review': 'rejected at review.',
  'Rejected at approval': 'rejected at approval.',
  Resubmitted: 'resubmitted.',
  'Modified at review': 'changed at review.',
};

/**
 * The plain-language text of a QNN message. `formatDay` renders a yyyy-mm-dd
 * day in the configured date format (useDatetimeFormat().formatDate).
 */
export function readableQnnMessage(message: string | null | undefined, formatDay: (isoDay: string) => string): string {
  if (!message) return '';
  const { body, batch } = splitBatch(message.trim());
  let m: RegExpMatchArray | null;

  // PM visit uploaded / added: "Uploaded — AHU (2026-11-03) (pending review)"
  if ((m = body.match(/^(Uploaded|Visit added) — (.+) \((\d{4}-\d{2}-\d{2})\)( \(pending review\))?$/))) {
    return `PM visit for ${m[2]} on ${formatDay(m[3])} ${m[1] === 'Uploaded' ? 'uploaded' : 'added'}.${m[4] ? ' Waiting for review.' : ''}${batch}`;
  }

  // PM visit step: "Approved — AHU (month 10)"
  if ((m = body.match(/^(.+?) — (.+) \(month (\d{1,2})\)$/))) {
    const [, note, ahu, mm] = m;
    const month = MONTHS[Number(mm) - 1] ?? `month ${mm}`;
    const visit = `PM visit for ${ahu} in ${month}`;
    if (OLD_NOTE[note]) return `${visit} ${OLD_NOTE[note]}${batch}`;
    if (note === 'Edited (applied at once, Super Admin)') return `${visit} moved to a new date. Applied at once (Super Admin).${batch}`;
    if (note === 'Edit requested') return `Date change requested for ${ahu} PM visit in ${month}.${batch}`;
    const change = note.match(/^Change rejected at (review|approval) \(visit stays approved\)$/);
    if (change) return `Date change for ${ahu} PM visit in ${month} rejected at ${change[1]}. The visit keeps its date.${batch}`;
    return message;
  }

  // Replacement entry step: "Approved — AHU · 610x610x150 · 15µ · qty 3"
  if ((m = body.match(/^(.+?) — (.+) · qty (\d+)$/)) && OLD_NOTE[m[1]]) {
    const [, note, rest, qty] = m;
    const [ahu, ...parts] = rest.split(' · ');
    const micron = parts.find((p) => p.endsWith('µ'));
    const size = parts.find((p) => !p.endsWith('µ'));
    const n = Number(qty);
    const spec = [`${n} filter${n === 1 ? '' : 's'}`, micron ? `${micron.slice(0, -1)} micron` : null, size ? `size ${size}` : null].filter(Boolean).join(', ');
    return `Filter replacement for ${ahu} (${spec}) ${OLD_NOTE[note]}${batch}`;
  }

  // Replacement schedule upload: "Uploaded replacement schedule (6 entries) — pending review"
  if ((m = body.match(/^Uploaded replacement schedule \((\d+) entr(?:y|ies)\)( — pending review)?$/))) {
    const n = Number(m[1]);
    return `Replacement schedule uploaded with ${n} row${n === 1 ? '' : 's'}.${m[2] ? ' Waiting for review.' : ''}${batch}`;
  }

  // Filter workflow (2026-10-24 morning): "Filter created (pending review) — NAME"
  if ((m = body.match(/^Filter (created|uploaded|resubmitted) \((pending review|approved at once, Super Admin)\) — (.+)$/))) {
    return `Filter ${m[3]} ${m[1]}. ${m[2] === 'pending review' ? 'Waiting for review.' : 'Approved at once (Super Admin).'}${batch}`;
  }
  if ((m = body.match(/^Filter reviewed \(pending approval\) — (.+)$/))) return `Filter ${m[1]} reviewed. Sent for approval.${batch}`;
  if ((m = body.match(/^Filter approved \(can now be cleaned\) — (.+)$/))) return `Filter ${m[1]} approved. It can now be cleaned.${batch}`;
  if ((m = body.match(/^Filter rejected at (review|approval) — (.+)$/))) return `Filter ${m[2]} rejected at ${m[1]}.${batch}`;

  return message;
}
