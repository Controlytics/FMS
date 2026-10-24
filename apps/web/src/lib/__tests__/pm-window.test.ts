import { describe, it, expect } from 'vitest';
import { pmWindowPhase } from '../pm-window';

/**
 * Window 18..24 Oct as the API sends it (DATE columns → UTC midnight). The
 * times below are LOCAL (new Date(y, m, d, h)), so the rule is checked in
 * whatever zone the test runs: in India the old comparison turned the visit
 * Overdue at 05:30 on the 24th.
 */
const start = '2026-10-18T00:00:00.000Z';
const end = '2026-10-24T00:00:00.000Z';

describe('pmWindowPhase (browser copy of the API rule)', () => {
  it('is upcoming until local midnight of the first day, then open', () => {
    expect(pmWindowPhase(start, end, new Date(2026, 9, 17, 23, 59))).toBe('upcoming');
    expect(pmWindowPhase(start, end, new Date(2026, 9, 18, 0, 0))).toBe('open');
    expect(pmWindowPhase(start, end, new Date(2026, 9, 18, 2, 0))).toBe('open');
  });

  it('keeps the whole last day open and closes at the next local midnight', () => {
    expect(pmWindowPhase(start, end, new Date(2026, 9, 24, 15, 0))).toBe('open');
    expect(pmWindowPhase(start, end, new Date(2026, 9, 24, 23, 59, 59))).toBe('open');
    expect(pmWindowPhase(start, end, new Date(2026, 9, 25, 0, 0))).toBe('closed');
  });

  it('reads a bare yyyy-mm-dd the same way', () => {
    expect(pmWindowPhase('2026-10-18', '2026-10-24', new Date(2026, 9, 24, 15, 0))).toBe('open');
  });
});
