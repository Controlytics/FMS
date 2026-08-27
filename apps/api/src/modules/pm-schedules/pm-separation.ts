/**
 * PM visit separation — two scheduled visits to one AHU must never be
 * satisfiable by the same cleaning (2026-08-27).
 *
 * A year's schedule is uploaded in one file, and the same AHU appears in it many
 * times with irregular gaps — some around a month, some longer, some shorter.
 * Each visit carries a tolerance, and the entry's window is symmetric:
 * `plannedDate ± toleranceDays` (see pm-import.ts). If one visit's window
 * touches the next one's, a single cleaning performed in the overlap could
 * credit BOTH tasks, and the second PM effectively never happens.
 *
 * ## The rule
 *
 * Sort an AHU's visits by date. For each consecutive pair, it is a violation
 * when `next.windowStart <= prev.windowEnd`.
 *
 * That is deliberately stricter than "the next date must be after the previous
 * date + its tolerance". The next visit's own BACKWARD tolerance reaches into
 * the past, so dates that look comfortably apart can still overlap:
 *
 *     10 Mar (tol 15) -> window 24 Feb .. 25 Mar
 *      5 Apr (tol 20) -> window 16 Mar .. 25 Apr      <- 26 days later, still overlaps
 *
 * A cleaning on 20 Mar sits in both windows. The live data had three such pairs
 * on AHU-0A with gaps of 31 and 32 days — the DATES look fine, the TOLERANCES
 * overlap. A gap-only check would have passed all three.
 *
 * ## Why this module is pure
 *
 * Import, single-create, edit and the QA approval of a pending edit all have to
 * apply the identical rule, and the UI has to show which existing rows break it.
 * Five call sites re-deriving one comparison is how the rule drifts — so it
 * lives here once, takes plain values, and touches no database.
 */

/** One end of a range, as stored on PmScheduleEntry. */
export interface SeparationInput {
  /** Stable identifier for reporting — a row number on import, an entry id in the UI. */
  ref: string | number;
  plannedDate: Date;
  toleranceDays: number;
}

export interface SeparationViolation {
  kind: 'OVERLAP' | 'DUPLICATE_DATE';
  earlier: SeparationInput;
  later: SeparationInput;
  /** Inclusive days on which a single cleaning would satisfy both visits. */
  overlapStart: Date;
  overlapEnd: Date;
  message: string;
}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `plannedDate ± toleranceDays`, matching how entries are stored. */
export function windowOf(entry: SeparationInput): { start: Date; end: Date } {
  return {
    start: new Date(entry.plannedDate.getTime() - entry.toleranceDays * DAY_MS),
    end: new Date(entry.plannedDate.getTime() + entry.toleranceDays * DAY_MS),
  };
}

/**
 * Every separation violation among one AHU's visits.
 *
 * Only CONSECUTIVE pairs are compared. With windows sorted by planned date, a
 * non-adjacent overlap implies an adjacent one, so checking every pair would
 * report the same problem several times and bury the fix.
 *
 * Input order does not matter — the list is sorted here.
 */
export function checkSeparation(entries: SeparationInput[]): SeparationViolation[] {
  if (entries.length < 2) return [];

  const sorted = [...entries].sort((a, b) => {
    const d = a.plannedDate.getTime() - b.plannedDate.getTime();
    // Stable tie-break so a duplicate date reports the same way every run.
    return d !== 0 ? d : String(a.ref).localeCompare(String(b.ref));
  });

  const violations: SeparationViolation[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];

    if (prev.plannedDate.getTime() === next.plannedDate.getTime()) {
      violations.push({
        kind: 'DUPLICATE_DATE',
        earlier: prev,
        later: next,
        overlapStart: next.plannedDate,
        overlapEnd: next.plannedDate,
        message: `Two visits are scheduled on the same date (${iso(next.plannedDate)}).`,
      });
      continue;
    }

    const prevWindow = windowOf(prev);
    const nextWindow = windowOf(next);

    if (nextWindow.start.getTime() <= prevWindow.end.getTime()) {
      violations.push({
        kind: 'OVERLAP',
        earlier: prev,
        later: next,
        overlapStart: nextWindow.start,
        overlapEnd: prevWindow.end,
        message:
          `${iso(next.plannedDate)} (tolerance ${next.toleranceDays}d) starts on ${iso(nextWindow.start)}, ` +
          `which is on or before ${iso(prevWindow.end)} — the end of the ${iso(prev.plannedDate)} ` +
          `(tolerance ${prev.toleranceDays}d) window. One cleaning between ${iso(nextWindow.start)} and ` +
          `${iso(prevWindow.end)} would satisfy both visits.`,
      });
    }
  }

  return violations;
}

/**
 * The earliest date a visit could take, given the one before it — for
 * "next available date" hints in error messages and the UI.
 */
export function earliestNextDate(previous: SeparationInput, toleranceDays: number): Date {
  return new Date(windowOf(previous).end.getTime() + (toleranceDays + 1) * DAY_MS);
}
