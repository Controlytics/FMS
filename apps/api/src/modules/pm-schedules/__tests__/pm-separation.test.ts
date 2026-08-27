import { describe, it, expect } from 'vitest';
import { checkSeparation, windowOf, earliestNextDate } from '../pm-separation.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const e = (ref: string, date: string, toleranceDays: number) => ({ ref, plannedDate: d(date), toleranceDays });

describe('checkSeparation', () => {
  it('passes visits whose windows do not touch', () => {
    // 10 Mar ±15 -> 24 Feb..25 Mar ; 20 Apr ±20 -> 31 Mar..10 May
    expect(checkSeparation([e('a', '2026-03-10', 15), e('b', '2026-04-20', 20)])).toEqual([]);
  });

  it('catches the case a gap-only rule would miss', () => {
    // 26 days apart, but the later visit's BACKWARD tolerance reaches back into
    // the earlier window. A cleaning on 20 Mar would satisfy both.
    const v = checkSeparation([e('a', '2026-03-10', 15), e('b', '2026-04-05', 20)]);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('OVERLAP');
    expect(v[0].overlapStart.toISOString().slice(0, 10)).toBe('2026-03-16');
    expect(v[0].overlapEnd.toISOString().slice(0, 10)).toBe('2026-03-25');
  });

  it('catches the three pairs that were already live on AHU-0A', () => {
    // Gaps of 31 and 32 days — the dates look fine, the tolerances overlap.
    // These are the real rows that motivated the rule.
    const v = checkSeparation([
      e('sep', '2026-09-18', 15),
      e('oct', '2026-10-19', 20),
      e('nov', '2026-11-20', 20),
      e('dec', '2026-12-21', 25),
    ]);
    expect(v).toHaveLength(3);
    expect(v.every(x => x.kind === 'OVERLAP')).toBe(true);
    expect(v.map(x => x.later.ref)).toEqual(['oct', 'nov', 'dec']);
  });

  it('treats a shared boundary day as an overlap', () => {
    // 1 Mar ±10 ends 11 Mar; 21 Mar ±10 starts 11 Mar. The single shared day is
    // still a day on which one cleaning credits both, so `<=` not `<`.
    const v = checkSeparation([e('a', '2026-03-01', 10), e('b', '2026-03-21', 10)]);
    expect(v).toHaveLength(1);
    expect(v[0].overlapStart.getTime()).toBe(v[0].overlapEnd.getTime());
  });

  it('allows windows that stop one day short of touching', () => {
    // 1 Mar ±10 ends 11 Mar; 22 Mar ±10 starts 12 Mar.
    expect(checkSeparation([e('a', '2026-03-01', 10), e('b', '2026-03-22', 10)])).toEqual([]);
  });

  it('reports two visits on the same date as a duplicate, not an overlap', () => {
    const v = checkSeparation([e('a', '2026-03-10', 5), e('b', '2026-03-10', 5)]);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('DUPLICATE_DATE');
  });

  it('handles zero tolerance: adjacent days pass, the same day does not', () => {
    expect(checkSeparation([e('a', '2026-03-10', 0), e('b', '2026-03-11', 0)])).toEqual([]);
    expect(checkSeparation([e('a', '2026-03-10', 0), e('b', '2026-03-10', 0)])[0].kind).toBe('DUPLICATE_DATE');
  });

  it('does not depend on input order', () => {
    const forward = checkSeparation([e('a', '2026-03-10', 15), e('b', '2026-04-05', 20)]);
    const reversed = checkSeparation([e('b', '2026-04-05', 20), e('a', '2026-03-10', 15)]);
    expect(reversed).toHaveLength(forward.length);
    expect(reversed[0].earlier.ref).toBe('a');
    expect(reversed[0].later.ref).toBe('b');
  });

  it('reports only consecutive pairs, not every combination', () => {
    // Three visits stacked inside one another would be 3 pairs if every
    // combination were compared; adjacent-only keeps it to 2 and points at the
    // two edits that actually fix it.
    const v = checkSeparation([e('a', '2026-03-01', 30), e('b', '2026-03-10', 30), e('c', '2026-03-20', 30)]);
    expect(v).toHaveLength(2);
    expect(v.map(x => [x.earlier.ref, x.later.ref])).toEqual([['a', 'b'], ['b', 'c']]);
  });

  it('is a no-op for zero or one visit', () => {
    expect(checkSeparation([])).toEqual([]);
    expect(checkSeparation([e('a', '2026-03-10', 15)])).toEqual([]);
  });

  it('spans month and year boundaries by date, never by calendar month', () => {
    // Two visits in the SAME month must be allowed when separated enough — the
    // whole point of dropping the one-per-month unique constraint.
    expect(checkSeparation([e('a', '2026-03-02', 3), e('b', '2026-03-28', 3)])).toEqual([]);
    // And a December/January pair is compared on dates, not month numbers.
    const v = checkSeparation([e('dec', '2025-12-28', 10), e('jan', '2026-01-05', 10)]);
    expect(v).toHaveLength(1);
  });
});

describe('windowOf', () => {
  it('is symmetric around the planned date', () => {
    const w = windowOf(e('a', '2026-03-10', 5));
    expect(w.start.toISOString().slice(0, 10)).toBe('2026-03-05');
    expect(w.end.toISOString().slice(0, 10)).toBe('2026-03-15');
  });
});

describe('earliestNextDate', () => {
  it('clears the previous window by the next visit’s own tolerance, plus a day', () => {
    // prev 10 Mar ±15 ends 25 Mar; a next visit with tolerance 20 must be
    // planned at 15 Apr so its window opens 26 Mar.
    const next = earliestNextDate(e('a', '2026-03-10', 15), 20);
    expect(next.toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(checkSeparation([e('a', '2026-03-10', 15), { ref: 'b', plannedDate: next, toleranceDays: 20 }])).toEqual([]);
  });
});
