import { describe, it, expect } from 'vitest';

import { cycleCreditsEntry } from '../pm-shared.js';

/**
 * The stacked-task double-credit regression.
 *
 * PM tasks stack: an unmet August entry does not stop September's from being
 * generated. The original rule credited ANY PM cleaning completed after an
 * entry's windowStart, so one September cleaning satisfied BOTH tasks and
 * closed BOTH deviations — recording two preventive maintenances where one
 * happened. `cycleCreditsEntry` is the single predicate that prevents it, used
 * by both My Tasks and the overdue sweep.
 */
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const AUG = { id: 'entry-aug', windowStart: d('2026-08-12'), windowEnd: d('2026-08-18') };
const SEP = { id: 'entry-sep', windowStart: d('2026-09-12'), windowEnd: d('2026-09-18') };

describe('cycleCreditsEntry — unbound cycles (normal cleaning, and legacy rows)', () => {
  it('credits the entry whose window it falls inside', () => {
    expect(cycleCreditsEntry({ pmScheduleEntryId: null }, AUG, d('2026-08-15'))).toBe(true);
    expect(cycleCreditsEntry({ pmScheduleEntryId: null }, SEP, d('2026-09-15'))).toBe(true);
  });

  it('counts the window boundaries inclusively', () => {
    expect(cycleCreditsEntry({ pmScheduleEntryId: null }, AUG, d('2026-08-12'))).toBe(true);
    expect(cycleCreditsEntry({ pmScheduleEntryId: null }, AUG, d('2026-08-18'))).toBe(true);
  });

  it('does NOT credit an earlier task once its window has closed', () => {
    // THE REGRESSION: a September cleaning must not also satisfy the unmet
    // August PM. Under the old rule this returned true.
    expect(cycleCreditsEntry({ pmScheduleEntryId: null }, AUG, d('2026-09-15'))).toBe(false);
  });

  it('does not credit anything before the window opens', () => {
    expect(cycleCreditsEntry({ pmScheduleEntryId: null }, AUG, d('2026-08-11'))).toBe(false);
  });

  it('treats a missing field the same as an explicit null', () => {
    expect(cycleCreditsEntry({}, AUG, d('2026-08-15'))).toBe(true);
    expect(cycleCreditsEntry({}, AUG, d('2026-09-15'))).toBe(false);
  });
});

describe('cycleCreditsEntry — bound cycles (the perform-it-late path)', () => {
  it('credits its own entry LATE, with no upper bound', () => {
    // The operator explicitly said "I am doing the August PM now".
    expect(cycleCreditsEntry({ pmScheduleEntryId: 'entry-aug' }, AUG, d('2026-09-15'))).toBe(true);
    expect(cycleCreditsEntry({ pmScheduleEntryId: 'entry-aug' }, AUG, d('2026-11-30'))).toBe(true);
  });

  it('credits its own entry in-window too', () => {
    expect(cycleCreditsEntry({ pmScheduleEntryId: 'entry-aug' }, AUG, d('2026-08-15'))).toBe(true);
  });

  it('still refuses anything before its window opens', () => {
    expect(cycleCreditsEntry({ pmScheduleEntryId: 'entry-aug' }, AUG, d('2026-08-01'))).toBe(false);
  });

  it('never credits a DIFFERENT entry, even inside that entry window', () => {
    // A cleaning performed for August cannot also tick off September.
    expect(cycleCreditsEntry({ pmScheduleEntryId: 'entry-aug' }, SEP, d('2026-09-15'))).toBe(false);
    expect(cycleCreditsEntry({ pmScheduleEntryId: 'entry-sep' }, AUG, d('2026-08-15'))).toBe(false);
  });
});

describe('cycleCreditsEntry — one cleaning, one task', () => {
  it('an unbound September clean credits September ONLY', () => {
    const cycle = { pmScheduleEntryId: null };
    const at = d('2026-09-15');
    const credited = [AUG, SEP].filter((e) => cycleCreditsEntry(cycle, e, at));
    expect(credited.map((e) => e.id)).toEqual(['entry-sep']);
  });

  it('a clean bound to August credits August ONLY, even performed in September', () => {
    const cycle = { pmScheduleEntryId: 'entry-aug' };
    const at = d('2026-09-15');
    const credited = [AUG, SEP].filter((e) => cycleCreditsEntry(cycle, e, at));
    expect(credited.map((e) => e.id)).toEqual(['entry-aug']);
  });

  it('never credits two entries at once, across a sweep of dates', () => {
    // The invariant stated plainly: for any single cycle at any single moment,
    // at most one stacked task may be satisfied.
    const dates = ['2026-08-12', '2026-08-15', '2026-08-18', '2026-09-01',
                   '2026-09-12', '2026-09-15', '2026-09-18', '2026-10-01'];
    for (const bound of [null, 'entry-aug', 'entry-sep']) {
      for (const day of dates) {
        const n = [AUG, SEP].filter((e) => cycleCreditsEntry({ pmScheduleEntryId: bound }, e, d(day))).length;
        expect(n, `bound=${bound} at ${day} credited ${n} entries`).toBeLessThanOrEqual(1);
      }
    }
  });
});
