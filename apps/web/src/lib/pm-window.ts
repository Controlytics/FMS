/**
 * Where a PM visit's tolerance window stands — the browser copy of the API's
 * rule (`apps/api/src/modules/pm-schedules/pm-shared.ts` pmWindowPhase); change
 * one and change the other.
 *
 * windowStart / windowEnd are DATE columns and arrive as
 * "yyyy-mm-ddT00:00:00.000Z": whole calendar days, not instants. The window
 * OPENS at local midnight of its first day and CLOSES at local midnight after
 * its last day, so the last day counts in full.
 *
 * 2026-10-24: the PM schedule pages compared `now` with the raw value, which is
 * UTC midnight (05:30 in India), so a visit turned "Overdue" at 05:30 on the
 * last day of its window.
 */
export type PmWindowPhase = 'upcoming' | 'open' | 'closed';

/** Local midnight that starts the calendar day a DATE value names. */
function dayStart(value: string, addDays = 0): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d + addDays);
}

export function pmWindowPhase(windowStart: string, windowEnd: string, now: Date = new Date()): PmWindowPhase {
  if (now < dayStart(windowStart)) return 'upcoming';
  return now < dayStart(windowEnd, 1) ? 'open' : 'closed';
}
