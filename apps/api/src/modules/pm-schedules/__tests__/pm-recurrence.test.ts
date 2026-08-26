import { describe, it, expect } from 'vitest';

import {
  DAYS_PER_MONTH_STEP,
  MIN_FREQUENCY_DAYS,
  addMonthsPreservingDay,
  defaultHorizon,
  generateOccurrences,
  lastDayOfMonth,
  minGapDays,
  toUtcMidnight,
  validateFrequency,
} from '../pm-recurrence.js';

/** ISO yyyy-mm-dd of a UTC date — the shape used in every assertion below. */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isoAll = (occ: { plannedDate: Date }[]) => occ.map((o) => iso(o.plannedDate));

describe('validateFrequency', () => {
  it('accepts multiples of 30 with a compatible tolerance', () => {
    expect(validateFrequency(30, 3)).toBeNull();
    expect(validateFrequency(60, 5)).toBeNull();
    expect(validateFrequency(90, 10)).toBeNull();
    expect(validateFrequency(360, 30)).toBeNull();
  });

  it('rejects anything below the 30-day minimum', () => {
    for (const f of [1, 7, 15, 29]) {
      const err = validateFrequency(f, 3);
      expect(err?.code).toBe('FREQUENCY_TOO_SMALL');
      expect(err?.message).toContain(String(f));
    }
  });

  it('rejects non-multiples of 30 and suggests the neighbours', () => {
    const err = validateFrequency(45, 3);
    expect(err?.code).toBe('FREQUENCY_NOT_MULTIPLE_OF_30');
    // Suggests both 30 and 60 so the operator can pick without doing the maths.
    expect(err?.message).toContain('30');
    expect(err?.message).toContain('60');
  });

  it('rejects non-integers and non-finite input', () => {
    expect(validateFrequency(30.5, 3)?.code).toBe('FREQUENCY_TOO_SMALL');
    expect(validateFrequency(NaN, 3)?.code).toBe('FREQUENCY_TOO_SMALL');
  });

  it('rejects a tolerance wide enough to overlap the next occurrence', () => {
    // 30-day frequency with 15-day tolerance: window is 31 days wide, so
    // consecutive windows overlap and one cleaning would satisfy two tasks.
    const err = validateFrequency(30, 15);
    expect(err?.code).toBe('FREQUENCY_TOLERANCE_OVERLAP');
    expect(err?.message).toContain('15');
  });

  it('measures the overlap against the SHORTEST real month gap, not the nominal 30', () => {
    // The trap: "30 days" is one calendar month, and Jan 31 → Feb 28 is only 28
    // days. A 14-day tolerance makes windows [17 Jan, 14 Feb] and [14 Feb, 14
    // Mar] — touching exactly on 14 Feb, so one cleaning satisfies both tasks.
    // Sizing this check off the nominal 30 would wrongly accept it.
    expect(validateFrequency(30, 14)?.code).toBe('FREQUENCY_TOLERANCE_OVERLAP');
    expect(validateFrequency(30, 13)).toBeNull(); // 27-day window inside a 28-day gap
  });

  it('exposes the documented constants', () => {
    expect(MIN_FREQUENCY_DAYS).toBe(30);
    expect(DAYS_PER_MONTH_STEP).toBe(30);
  });
});

describe('minGapDays', () => {
  it('returns the shortest real calendar gap, not monthStep * 30', () => {
    expect(minGapDays(1)).toBe(28);  // Jan 31 → Feb 28
    expect(minGapDays(2)).toBe(59);  // Dec 31 → Feb 28
    expect(minGapDays(3)).toBe(89);  // Feb → May
    expect(minGapDays(12)).toBe(365);
  });

  it('is always <= the nominal 30-day-per-month figure', () => {
    for (const m of [1, 2, 3, 4, 6, 12]) {
      expect(minGapDays(m)).toBeLessThanOrEqual(m * 30 + 5);
      expect(minGapDays(m)).toBeGreaterThan(0);
    }
  });
});

describe('lastDayOfMonth', () => {
  it('knows month lengths including leap February', () => {
    expect(lastDayOfMonth(2026, 0)).toBe(31); // Jan
    expect(lastDayOfMonth(2026, 1)).toBe(28); // Feb, non-leap
    expect(lastDayOfMonth(2028, 1)).toBe(29); // Feb, leap
    expect(lastDayOfMonth(2026, 3)).toBe(30); // Apr
  });
});

describe('addMonthsPreservingDay', () => {
  it('keeps the day-of-month and rolls the year', () => {
    const anchor = toUtcMidnight('2026-08-15');
    expect(iso(addMonthsPreservingDay(anchor, 0))).toBe('2026-08-15');
    expect(iso(addMonthsPreservingDay(anchor, 1))).toBe('2026-09-15');
    expect(iso(addMonthsPreservingDay(anchor, 5))).toBe('2027-01-15');
    expect(iso(addMonthsPreservingDay(anchor, 12))).toBe('2027-08-15');
  });

  it('clamps into short months WITHOUT decaying afterwards', () => {
    // The anchoring invariant: 31 Jan clamps to 28 Feb, then RECOVERS to 31 Mar.
    // Stepping off the previous occurrence would give 28 Mar and stay there.
    const anchor = toUtcMidnight('2026-01-31');
    expect(iso(addMonthsPreservingDay(anchor, 1))).toBe('2026-02-28');
    expect(iso(addMonthsPreservingDay(anchor, 2))).toBe('2026-03-31');
    expect(iso(addMonthsPreservingDay(anchor, 3))).toBe('2026-04-30');
    expect(iso(addMonthsPreservingDay(anchor, 4))).toBe('2026-05-31');
  });

  it('clamps to 29 Feb in a leap year', () => {
    expect(iso(addMonthsPreservingDay(toUtcMidnight('2028-01-31'), 1))).toBe('2028-02-29');
  });
});

describe('generateOccurrences — no frequency (legacy one-off)', () => {
  it('returns exactly one occurrence', () => {
    const occ = generateOccurrences({
      anchorDate: '2026-08-15',
      frequencyDays: null,
      toleranceDays: 3,
      horizonEnd: '2027-12-31',
    });
    expect(occ).toHaveLength(1);
    expect(iso(occ[0].plannedDate)).toBe('2026-08-15');
    expect(occ[0].index).toBe(0);
  });

  it('emits the one-off even when it sits beyond the horizon', () => {
    // A far-future one-off schedule must still be creatable.
    const occ = generateOccurrences({
      anchorDate: '2030-08-15',
      frequencyDays: 0,
      toleranceDays: 3,
      horizonEnd: '2027-12-31',
    });
    expect(isoAll(occ)).toEqual(['2030-08-15']);
  });
});

describe('generateOccurrences — monthly (30)', () => {
  const occ = generateOccurrences({
    anchorDate: '2026-08-15',
    frequencyDays: 30,
    toleranceDays: 3,
    horizonEnd: '2027-12-31',
  });

  it('holds the day-of-month across the year boundary', () => {
    expect(isoAll(occ).slice(0, 7)).toEqual([
      '2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15',
      '2026-12-15', '2027-01-15', '2027-02-15',
    ]);
  });

  it('runs to the horizon and no further', () => {
    // Aug 2026 → Dec 2027 inclusive = 5 + 12 = 17 occurrences.
    expect(occ).toHaveLength(17);
    expect(iso(occ[occ.length - 1].plannedDate)).toBe('2027-12-15');
  });

  it('produces at most one occurrence per (year, month)', () => {
    const keys = occ.map((o) => `${o.year}-${o.month}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sets year/month consistently with plannedDate', () => {
    for (const o of occ) {
      expect(o.year).toBe(o.plannedDate.getUTCFullYear());
      expect(o.month).toBe(o.plannedDate.getUTCMonth() + 1);
    }
  });
});

describe('generateOccurrences — anchor beyond the horizon', () => {
  it('still emits the anchor for a RECURRING series (never a silent no-op)', () => {
    // Without this, an upload row anchored past the horizon would create a
    // schedule with zero entries and report success — a silent no-op.
    const occ = generateOccurrences({
      anchorDate: '2028-01-15', frequencyDays: 30, toleranceDays: 3, horizonEnd: '2027-12-31',
    });
    expect(isoAll(occ)).toEqual(['2028-01-15']);
    expect(occ[0].index).toBe(0);
  });

  it('matches the one-off path exactly for the same anchor', () => {
    const recurring = generateOccurrences({
      anchorDate: '2030-06-10', frequencyDays: 90, toleranceDays: 5, horizonEnd: '2027-12-31',
    });
    const oneOff = generateOccurrences({
      anchorDate: '2030-06-10', frequencyDays: null, toleranceDays: 5, horizonEnd: '2027-12-31',
    });
    expect(isoAll(recurring)).toEqual(isoAll(oneOff));
  });

  it('still honours `after`, so rollover does not re-emit the anchor', () => {
    const occ = generateOccurrences({
      anchorDate: '2028-01-15', frequencyDays: 30, toleranceDays: 3,
      horizonEnd: '2027-12-31', after: '2028-01-15',
    });
    expect(occ).toEqual([]);
  });
});

describe('generateOccurrences — quarterly (90) and other multiples', () => {
  it('advances 3 months at a time on the same date', () => {
    const occ = generateOccurrences({
      anchorDate: '2026-08-15',
      frequencyDays: 90,
      toleranceDays: 5,
      horizonEnd: '2027-12-31',
    });
    expect(isoAll(occ)).toEqual([
      '2026-08-15', '2026-11-15', '2027-02-15', '2027-05-15', '2027-08-15', '2027-11-15',
    ]);
  });

  it('handles 60 and 180', () => {
    const bimonthly = generateOccurrences({
      anchorDate: '2026-08-15', frequencyDays: 60, toleranceDays: 5, horizonEnd: '2027-02-28',
    });
    expect(isoAll(bimonthly)).toEqual(['2026-08-15', '2026-10-15', '2026-12-15', '2027-02-15']);

    const halfYearly = generateOccurrences({
      anchorDate: '2026-08-15', frequencyDays: 180, toleranceDays: 10, horizonEnd: '2027-12-31',
    });
    expect(isoAll(halfYearly)).toEqual(['2026-08-15', '2027-02-15', '2027-08-15']);
  });
});

describe('generateOccurrences — windows', () => {
  it('applies the tolerance symmetrically', () => {
    const [first] = generateOccurrences({
      anchorDate: '2026-08-15', frequencyDays: 30, toleranceDays: 3, horizonEnd: '2026-09-30',
    });
    expect(iso(first.windowStart)).toBe('2026-08-12');
    expect(iso(first.windowEnd)).toBe('2026-08-18');
    expect(first.toleranceDays).toBe(3);
  });

  it('never overlaps consecutive windows for any valid pair', () => {
    // The §11 invariant: one cleaning must never fall inside two PM windows.
    // Validation is what guarantees it, so assert across the accepted space.
    const cases: Array<[number, number]> = [
      [30, 0], [30, 3], [30, 13],
      [60, 3], [60, 29],
      [90, 10], [90, 44],
      [360, 30],
    ];
    for (const [freq, tol] of cases) {
      expect(validateFrequency(freq, tol)).toBeNull();
      const occ = generateOccurrences({
        anchorDate: '2026-01-31', frequencyDays: freq, toleranceDays: tol, horizonEnd: '2029-12-31',
      });
      for (let i = 1; i < occ.length; i++) {
        expect(
          occ[i].windowStart.getTime(),
          `freq=${freq} tol=${tol}: window ${i} starts before window ${i - 1} ends`,
        ).toBeGreaterThan(occ[i - 1].windowEnd.getTime());
      }
    }
  });
});

describe('generateOccurrences — anchoring (no cumulative drift)', () => {
  it('recovers the 31st after every short month', () => {
    const occ = generateOccurrences({
      anchorDate: '2026-01-31', frequencyDays: 30, toleranceDays: 2, horizonEnd: '2026-12-31',
    });
    expect(isoAll(occ)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
    ]);
  });

  it('keeps the date stable over a long horizon', () => {
    const occ = generateOccurrences({
      anchorDate: '2026-03-15', frequencyDays: 30, toleranceDays: 2, horizonEnd: '2031-12-31',
    });
    // Every single occurrence is still the 15th, 70 months later.
    expect(occ.every((o) => o.plannedDate.getUTCDate() === 15)).toBe(true);
    expect(iso(occ[occ.length - 1].plannedDate)).toBe('2031-12-15');
  });
});

describe('generateOccurrences — `after` (rollover tail)', () => {
  it('emits only occurrences strictly after the given date', () => {
    const tail = generateOccurrences({
      anchorDate: '2026-08-15',
      frequencyDays: 30,
      toleranceDays: 3,
      horizonEnd: '2027-06-30',
      after: '2027-01-15',
    });
    expect(isoAll(tail)).toEqual([
      '2027-02-15', '2027-03-15', '2027-04-15', '2027-05-15', '2027-06-15',
    ]);
  });

  it('keeps the anchor-relative index so the series stays identifiable', () => {
    const tail = generateOccurrences({
      anchorDate: '2026-08-15', frequencyDays: 30, toleranceDays: 3,
      horizonEnd: '2027-03-31', after: '2027-01-15',
    });
    // Feb 2027 is the 6th occurrence from an Aug 2026 anchor (index 6).
    expect(tail[0].index).toBe(6);
  });

  it('returns nothing when the series is already materialised to the horizon', () => {
    const tail = generateOccurrences({
      anchorDate: '2026-08-15', frequencyDays: 30, toleranceDays: 3,
      horizonEnd: '2026-12-31', after: '2026-12-15',
    });
    expect(tail).toEqual([]);
  });
});

describe('toUtcMidnight', () => {
  it('normalises strings and Dates to UTC midnight', () => {
    expect(iso(toUtcMidnight('2026-08-15'))).toBe('2026-08-15');
    expect(toUtcMidnight('2026-08-15').getUTCHours()).toBe(0);
    expect(iso(toUtcMidnight(new Date(Date.UTC(2026, 7, 15, 18, 30))))).toBe('2026-08-15');
  });

  it('does not shift the day in a non-UTC server timezone', () => {
    // Asia/Kolkata (UTC+5:30) is the local dev TZ — a naive local-time parse of
    // "2026-08-15" would land on 14 Aug UTC.
    expect(iso(toUtcMidnight('2026-08-15'))).toBe('2026-08-15');
    expect(toUtcMidnight('2026-08-15').getTime()).toBe(Date.UTC(2026, 7, 15));
  });
});

describe('defaultHorizon', () => {
  it('is 31 Dec of next calendar year', () => {
    expect(iso(defaultHorizon(new Date(Date.UTC(2026, 7, 26))))).toBe('2027-12-31');
    expect(iso(defaultHorizon(new Date(Date.UTC(2026, 0, 1))))).toBe('2027-12-31');
  });

  it('bounds a monthly series to at most 24 rows', () => {
    const now = new Date(Date.UTC(2026, 0, 15));
    const occ = generateOccurrences({
      anchorDate: '2026-01-15', frequencyDays: 30, toleranceDays: 3, horizonEnd: defaultHorizon(now),
    });
    expect(occ).toHaveLength(24);
  });
});
