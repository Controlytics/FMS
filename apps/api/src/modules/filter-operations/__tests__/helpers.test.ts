import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { toLocalDateString } from '../helpers';
import { pinTimeZone } from '../../../lib/__tests__/pin-time-zone.js';

// A zone ahead of UTC, so the "UTC off-by-one" case is meaningful. Pinned for
// this file only and put back after it: this used to set process.env.TZ at the
// top of the module and never restore it, so every later file of the
// single-fork run inherited the zone (2026-10-23).
let restore: () => void;
beforeAll(() => { restore = pinTimeZone('Asia/Kolkata'); }); // UTC+5:30
afterAll(() => restore());

/**
 * Regression tests for the lastCleaningDate UTC off-by-one fix (2026-07-09 QA).
 * A cleaning completed near local midnight was stamped a day early because the
 * stamp used `completedAt.toISOString().slice(0,10)` (the UTC day).
 */
describe('toLocalDateString', () => {
  it('returns the LOCAL calendar day, zero-padded', () => {
    // Constructed from LOCAL components; getFullYear/getMonth/getDate read them
    // back, so these are deterministic in any runner TZ.
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 59, 0))).toBe('2026-01-05'); // Jan 5, 23:59 local
    expect(toLocalDateString(new Date(2026, 11, 31, 0, 30, 0))).toBe('2026-12-31'); // Dec 31, 00:30 local
  });

  it('uses the local day, not the UTC day, near local midnight (the bug it fixes)', () => {
    const d = new Date('2026-07-08T20:30:00Z'); // = 2026-07-09 02:00 IST
    expect(d.getDate()).toBe(9); // the pin is in force (pinTimeZone throws if it cannot pin)
    expect(toLocalDateString(d)).toBe('2026-07-09'); // local day (fixed)
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-08'); // the OLD buggy value
  });
});
