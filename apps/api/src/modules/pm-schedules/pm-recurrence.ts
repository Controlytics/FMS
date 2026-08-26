/**
 * PM Schedules — recurring-occurrence generator (`frequency_days`).
 *
 * A PM schedule row may carry a `frequencyDays` interval. One uploaded/created
 * row then becomes a *series*: the same day-of-month, repeating, until a new
 * schedule is uploaded for that AHU.
 *
 * ── Semantics (owner-confirmed 2026-08-26) ──────────────────────────────────
 * Only MULTIPLES OF 30 are accepted, and 30 days means "one month", not 30
 * literal days. `months = frequencyDays / 30`, and the DAY-OF-MONTH is
 * preserved forever:
 *
 *   anchor 2026-08-15, freq 30 → 15 Aug, 15 Sep, 15 Oct … 15 Dec, 15 Jan 27 …
 *   anchor 2026-08-15, freq 90 → 15 Aug, 15 Nov, 15 Feb 27, 15 May 27 …
 *
 * Literal day arithmetic is deliberately NOT used: 15 Aug + 30 days is 14 Sep,
 * which moves the date. The requirement is that the date never moves.
 *
 * Sub-30 and non-multiple intervals (7, 15, 45, 100) are REJECTED, not
 * approximated. They cannot hold the date still, and below ~30 days they would
 * also put two occurrences in one calendar month — which the existing
 * `@@unique([scheduleId, month])` constraint forbids outright.
 *
 * ── Invariants this module guarantees ───────────────────────────────────────
 *  1. Every occurrence is computed FROM THE ANCHOR (anchor + k months), never
 *     by stepping off the previous occurrence. Stepping accumulates the
 *     short-month clamp: 31 Jan → 28 Feb → 28 Mar → 28 Apr, and the date is
 *     lost after the first February. Anchoring gives 31 Jan → 28 Feb → 31 Mar.
 *  2. All arithmetic is at UTC midnight, matching the normalisation every date
 *     already gets in `pm-import.ts`. A non-UTC server (Asia/Kolkata locally)
 *     must not shift a planned date by a day.
 *  3. At most ONE occurrence per calendar month, so `@@unique([scheduleId,
 *     month])` holds and windows of consecutive occurrences cannot overlap
 *     (guarded by `validateFrequency`, see below).
 *
 * Pure module — no Prisma, no config reads, no clock reads beyond what the
 * caller passes in. Everything here is unit-testable in isolation.
 */

/** Days per accepted frequency step. 30 days ≡ 1 calendar month. */
export const DAYS_PER_MONTH_STEP = 30;

/** Hard floor — the owner-confirmed minimum interval. */
export const MIN_FREQUENCY_DAYS = 30;

export interface Occurrence {
  /** Calendar year of this occurrence — selects/creates the PmSchedule row. */
  year: number;
  /** 1-12. Stored on PmScheduleEntry; still the unique key within a schedule. */
  month: number;
  /** UTC-midnight planned date. */
  plannedDate: Date;
  toleranceDays: number;
  windowStart: Date;
  windowEnd: Date;
  /** 0 for the anchor occurrence, then 1, 2, 3 … */
  index: number;
}

/**
 * Validation failure from `validateFrequency`. `code` is stable for tests and
 * for the API error payload; `message` is operator-facing and names the actual
 * numbers involved (a bare "invalid frequency" tells an operator nothing).
 */
export interface FrequencyError {
  code: 'FREQUENCY_TOO_SMALL' | 'FREQUENCY_NOT_MULTIPLE_OF_30' | 'FREQUENCY_TOLERANCE_OVERLAP';
  message: string;
}

/**
 * Smallest possible day-gap between two consecutive occurrences `monthStep`
 * calendar months apart.
 *
 * NOT `monthStep * 30`. Calendar months are 28-31 days, so a "30-day" monthly
 * PM anchored on 31 Jan is only **28 days** from its February occurrence — and
 * the short-month clamp shortens it further still (31 Jan → 28 Feb). Sizing the
 * overlap check off the nominal 30 lets a 14-day tolerance through, whose
 * windows then touch exactly on 14 Feb. Computed, not assumed.
 *
 * Scans every start (day 1-31 × 12 months) across a 4-year window so a leap
 * February is included. ~1.5k cheap iterations, only on the validation path.
 */
export function minGapDays(monthStep: number): number {
  let min = Infinity;
  for (let year = 2025; year <= 2028; year++) {
    for (let month = 0; month < 12; month++) {
      for (let day = 1; day <= 31; day++) {
        if (day > lastDayOfMonth(year, month)) continue;
        const anchor = new Date(Date.UTC(year, month, day));
        const next = addMonthsPreservingDay(anchor, monthStep);
        const gap = Math.round((next.getTime() - anchor.getTime()) / 86400000);
        if (gap < min) min = gap;
      }
    }
  }
  return min;
}

/**
 * Validate a frequency/tolerance pair. Returns null when valid.
 *
 * Three refusals, all deliberate:
 *
 *  1. `< 30` — below one month. The date cannot be held still, and two
 *     occurrences would collide inside one calendar month.
 *  2. not a multiple of 30 — 45 days is neither one month nor two. Rounding it
 *     silently would generate dates the operator never asked for; the honest
 *     move is to refuse and say so.
 *  3. `2 * toleranceDays >= minGapDays(months)` — tolerance is applied
 *     symmetrically (`plannedDate ± tol`), so a window spans `2 * tol + 1` days.
 *     Once that reaches the gap between occurrences the windows TOUCH or
 *     OVERLAP, and a single cleaning would fall inside two different PM tasks'
 *     windows — satisfying both and auto-closing two deviations off one clean.
 *     That records a PM as having happened twice, which is a false statement in
 *     a 21 CFR §11 audit trail. Refusing at input is the only fix that does not
 *     silently shrink the tolerance the operator configured.
 *
 *     Measured against the SHORTEST real calendar gap, not the nominal
 *     frequency — see `minGapDays`.
 */
export function validateFrequency(frequencyDays: number, toleranceDays: number): FrequencyError | null {
  if (!Number.isFinite(frequencyDays) || !Number.isInteger(frequencyDays) || frequencyDays < MIN_FREQUENCY_DAYS) {
    return {
      code: 'FREQUENCY_TOO_SMALL',
      message: `Frequency must be at least ${MIN_FREQUENCY_DAYS} days (got ${frequencyDays}).`,
    };
  }
  if (frequencyDays % DAYS_PER_MONTH_STEP !== 0) {
    return {
      code: 'FREQUENCY_NOT_MULTIPLE_OF_30',
      message:
        `Frequency must be a multiple of ${DAYS_PER_MONTH_STEP} days (got ${frequencyDays}). ` +
        `${DAYS_PER_MONTH_STEP} days = 1 month, so the PM keeps the same date each time. ` +
        `Use ${frequencyDays - (frequencyDays % DAYS_PER_MONTH_STEP)} or ` +
        `${frequencyDays + (DAYS_PER_MONTH_STEP - (frequencyDays % DAYS_PER_MONTH_STEP))}.`,
    };
  }
  const gap = minGapDays(frequencyDays / DAYS_PER_MONTH_STEP);
  if (2 * toleranceDays >= gap) {
    // Largest tolerance that still leaves a clear day between windows.
    const maxTol = Math.ceil(gap / 2) - 1;
    return {
      code: 'FREQUENCY_TOLERANCE_OVERLAP',
      message:
        `A tolerance of ${toleranceDays} day(s) makes each PM window ${2 * toleranceDays + 1} days wide, ` +
        `but consecutive PMs can be as little as ${gap} days apart at a ${frequencyDays}-day frequency — ` +
        `the windows would overlap and one cleaning would satisfy two tasks. ` +
        `Reduce the tolerance to ${maxTol} day(s) or fewer, or increase the frequency.`,
    };
  }
  return null;
}

/** Strip a Date to UTC midnight. Accepts a Date or a YYYY-MM-DD string. */
export function toUtcMidnight(d: Date | string): Date {
  if (typeof d === 'string') {
    const m = d.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const parsed = new Date(d);
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Last day (28/29/30/31) of a given UTC year+month. `month` is 0-indexed. */
export function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one; UTC so no TZ shift.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Add `months` calendar months to `anchor`, preserving the day-of-month and
 * clamping into short months.
 *
 * 31 Jan + 1 month → 28 Feb (29 in a leap year), + 2 → 31 Mar. The clamp is
 * applied against the ANCHOR's day every time, never against the previously
 * clamped value, so the date recovers instead of decaying — that recovery is
 * the whole reason callers must pass the anchor rather than the last
 * occurrence. Never skips an occurrence: a PM due "on the 31st" still happens
 * in February, on the last day.
 */
export function addMonthsPreservingDay(anchor: Date, months: number): Date {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const day = anchor.getUTCDate();

  const targetMonthAbsolute = m + months;
  const targetYear = y + Math.floor(targetMonthAbsolute / 12);
  // JS modulo is sign-preserving; normalise so negative months (unused today,
  // but a back-dated series would hit it) still land on 0-11.
  const targetMonth = ((targetMonthAbsolute % 12) + 12) % 12;

  const clampedDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

export interface GenerateOptions {
  /** First occurrence — the operator's chosen date. UTC-midnight normalised. */
  anchorDate: Date | string;
  /** Multiple of 30. Null/0/undefined → a single one-off occurrence (legacy). */
  frequencyDays?: number | null;
  toleranceDays: number;
  /**
   * Inclusive last date to materialise up to. Callers pass 31 Dec of next
   * calendar year; the rollover cron passes a later horizon to extend a series.
   */
  horizonEnd: Date | string;
  /**
   * Exclusive lower bound — only emit occurrences strictly AFTER this date.
   * The rollover cron passes the series' last materialised date so it emits
   * only the new tail. Omit for the initial create/upload.
   */
  after?: Date | string | null;
}

/**
 * Expand a schedule seed into concrete occurrences.
 *
 * With no `frequencyDays` this returns exactly one occurrence — byte-for-byte
 * the behaviour that `pm-import.ts` and `pm-schedule-crud.ts` have today, so a
 * legacy one-off schedule is unaffected by this module existing.
 *
 * Callers MUST have run `validateFrequency` first; this function assumes a
 * valid pair and does not re-refuse (it would have nothing sensible to return).
 * The `index === 0` occurrence is always the anchor itself.
 */
export function generateOccurrences(opts: GenerateOptions): Occurrence[] {
  const anchor = toUtcMidnight(opts.anchorDate);
  const horizon = toUtcMidnight(opts.horizonEnd);
  const after = opts.after != null ? toUtcMidnight(opts.after) : null;
  const tol = opts.toleranceDays;
  const freq = opts.frequencyDays ?? 0;

  const build = (plannedDate: Date, index: number): Occurrence => ({
    year: plannedDate.getUTCFullYear(),
    month: plannedDate.getUTCMonth() + 1,
    plannedDate,
    toleranceDays: tol,
    windowStart: new Date(plannedDate.getTime() - tol * 86400000),
    windowEnd: new Date(plannedDate.getTime() + tol * 86400000),
    index,
  });

  // Legacy / one-off: a single entry, no recurrence. Emitted regardless of the
  // horizon — a one-off schedule for a far-future date must still be creatable.
  if (!freq) {
    if (after && anchor <= after) return [];
    return [build(anchor, 0)];
  }

  const monthStep = freq / DAYS_PER_MONTH_STEP;
  const out: Occurrence[] = [];

  // Bounded by the horizon, not by a count. The extra guard is a runaway
  // backstop only: 12 occurrences/year at the minimum frequency means even a
  // decade-wide horizon stays well under it.
  const MAX_OCCURRENCES = 600;
  for (let k = 0; k < MAX_OCCURRENCES; k++) {
    const planned = addMonthsPreservingDay(anchor, k * monthStep);
    // The anchor itself is ALWAYS emitted, even when it sits beyond the
    // horizon — matching the one-off path above. A schedule anchored past the
    // horizon (e.g. anchor 2028-01-15 against a 2027-12-31 horizon) would
    // otherwise return zero occurrences, and the import caller would report a
    // successful upload that created a schedule with no entries: a silent
    // no-op, which is precisely the failure mode `pm-import.ts` avoids
    // everywhere else by routing rejections to `skipped` with a reason.
    // The rollover cron picks up the tail once the horizon advances.
    if (k > 0 && planned > horizon) break;
    if (after && planned <= after) continue;
    out.push(build(planned, k));
  }

  return out;
}

/**
 * Default materialisation horizon: 31 Dec of NEXT calendar year, relative to
 * `now`. Bounds an otherwise endless series to a reviewable number of rows
 * (max 24 at frequency 30) while the rollover cron keeps the tail topped up.
 */
export function defaultHorizon(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31));
}
