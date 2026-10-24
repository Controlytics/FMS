import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  findInvertedRange, DATE_RANGE_PARAM_PAIRS, parseRangeStart, parseRangeEnd, toDateColumnDay,
  dateColumnDayStart, dateColumnDayEnd,
} from '../date-range-guard.js';
import { pmWindowPhase } from '../../modules/pm-schedules/pm-shared.js';
import { pinTimeZone } from './pin-time-zone.js';

/**
 * Every test runs under a PINNED zone — one east of UTC (the customer server is
 * in India) and one west — never the process's. The single-fork suite used to
 * inherit America/New_York from another file, and these tests then measured a
 * different rule than the one they were written for.
 */
describe.each(['Asia/Kolkata', 'America/New_York'])('in %s', (tz) => {
  let restore: () => void;
  beforeAll(() => { restore = pinTimeZone(tz); });
  afterAll(() => restore());

  /**
   * The API used to answer an inverted range with an empty list, which reads as
   * "no matching records" — the UI guard alone left every direct client, saved URL
   * and integration exposed to that silent wrong answer.
   */
  describe('findInvertedRange', () => {
    it('passes a normal forward range', () => {
      expect(findInvertedRange({ from: '2026-01-01', to: '2026-01-31' })).toBeNull();
    });

    it('catches an inverted range and names both ends', () => {
      const bad = findInvertedRange({ from: '2026-02-01', to: '2026-01-31' });
      expect(bad).not.toBeNull();
      expect(bad!.startKey).toBe('from');
      expect(bad!.endKey).toBe('to');
      expect(bad!.start).toBe('2026-02-01');
      expect(bad!.end).toBe('2026-01-31');
    });

    it.each(DATE_RANGE_PARAM_PAIRS)('covers the %s/%s spelling', (startKey, endKey) => {
      expect(findInvertedRange({ [startKey]: '2026-05-02', [endKey]: '2026-05-01' })).not.toBeNull();
      expect(findInvertedRange({ [startKey]: '2026-05-01', [endKey]: '2026-05-02' })).toBeNull();
    });

    it('allows a single-day range', () => {
      // The whole reason the end is expanded to 23:59:59.999: a bare end date
      // parses to 00:00, so a same-day filter would otherwise look inverted.
      expect(findInvertedRange({ from: '2026-08-05', to: '2026-08-05' })).toBeNull();
      expect(findInvertedRange({ startDate: '2026-08-05', endDate: '2026-08-05' })).toBeNull();
    });

    it('allows an open-ended range', () => {
      expect(findInvertedRange({ from: '2026-01-01' })).toBeNull();
      expect(findInvertedRange({ to: '2026-01-01' })).toBeNull();
      expect(findInvertedRange({ from: '2026-01-01', to: '' })).toBeNull();
      expect(findInvertedRange({ from: '', to: '2026-01-01' })).toBeNull();
    });

    it('handles full ISO timestamps, including within one day', () => {
      expect(findInvertedRange({ from: '2026-08-05T17:00:00Z', to: '2026-08-05T08:00:00Z' })).not.toBeNull();
      expect(findInvertedRange({ from: '2026-08-05T08:00:00Z', to: '2026-08-05T17:00:00Z' })).toBeNull();
    });

    it('stays out of the way when a value is not a date', () => {
      // The hook matches on parameter NAME, so it must not become a new way for a
      // future non-date from/to to break. Unparseable => leave it to the endpoint.
      expect(findInvertedRange({ from: 'alpha', to: 'beta' })).toBeNull();
      expect(findInvertedRange({ from: '2026-01-01', to: 'not-a-date' })).toBeNull();
    });

    it('ignores non-string and absent values', () => {
      expect(findInvertedRange({})).toBeNull();
      expect(findInvertedRange(undefined)).toBeNull();
      expect(findInvertedRange(null)).toBeNull();
      expect(findInvertedRange({ from: 5, to: 1 })).toBeNull();
      // fromPosition/toPosition on /api/audit/verify-chain are integers with
      // different names — they must not be caught.
      expect(findInvertedRange({ fromPosition: 900, toPosition: 100 })).toBeNull();
    });

    it('reports the first offending pair when several are present', () => {
      const bad = findInvertedRange({ from: '2026-03-02', to: '2026-03-01', startDate: '2026-04-02', endDate: '2026-04-01' });
      expect(bad!.startKey).toBe('from');
    });

    // 2026-10-23: the start was read as UTC midnight and the end as local
    // end-of-day. West of UTC the two overlapped, so a range inverted by one day
    // (2 Feb → 1 Feb) passed as valid and answered with an empty list.
    it('catches a range inverted by one day, in any zone', () => {
      expect(findInvertedRange({ from: '2026-02-02', to: '2026-02-01' })).not.toBeNull();
      expect(findInvertedRange({ startDate: '2026-12-31', endDate: '2026-12-30' })).not.toBeNull();
    });
  });

  /**
   * A bare date is the server's LOCAL calendar day at both ends (2026-10-23). The
   * start used to be `new Date('2026-02-01')` = UTC midnight, which in India is
   * 05:30: a filter "from 1 Feb" dropped everything recorded between 00:00 and
   * 05:30 on the first day (night-shift cleanings), in lists, reports and exports.
   */
  describe('parseRangeStart', () => {
    it('reads a bare yyyy-mm-dd as local midnight of that day', () => {
      expect(parseRangeStart('2026-02-01')).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
    });

    it('includes the first hours of the day: 00:30 local is inside "from that day"', () => {
      const start = parseRangeStart('2026-02-01')!;
      expect(new Date(2026, 1, 1, 0, 30).getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(new Date(2026, 0, 31, 23, 59, 59, 999).getTime()).toBeLessThan(start.getTime());
    });

    it('leaves a full instant untouched', () => {
      expect(parseRangeStart('2026-02-01T00:00:00.000Z')).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(parseRangeStart('2026-01-31T18:30:00.000Z')).toEqual(new Date('2026-01-31T18:30:00.000Z'));
    });

    it('returns null for a value that is not a date', () => {
      expect(parseRangeStart('alpha')).toBeNull();
      expect(parseRangeStart('')).toBeNull();
    });
  });

  /**
   * Exported 2026-09-03 so endpoints stop re-implementing the rule. Notifications
   * was doing `lte: new Date(endDate)`, which for a bare date is MIDNIGHT — so
   * "to = today" returned nothing from today and a same-day range was empty.
   */
  describe('parseRangeEnd', () => {
    it('expands a bare yyyy-mm-dd to the last millisecond of that local day', () => {
      expect(parseRangeEnd('2026-09-03')).toEqual(new Date(2026, 8, 3, 23, 59, 59, 999));
    });

    it('is the same day as parseRangeStart: start and end of 1 Feb are 1 ms short of 24 h apart', () => {
      expect(parseRangeEnd('2026-02-01')!.getTime() - parseRangeStart('2026-02-01')!.getTime()).toBe(86_400_000 - 1);
    });

    it('leaves a full instant untouched', () => {
      expect(parseRangeEnd('2026-09-03T08:30:00.000Z')).toEqual(new Date('2026-09-03T08:30:00.000Z'));
      expect(parseRangeEnd('2026-09-03T08:30')).toEqual(new Date(2026, 8, 3, 8, 30));
    });

    it('returns null for a value that is not a date, so the caller decides', () => {
      // Matching on parameter NAME means a non-date can reach here; turning it
      // into an Invalid Date would silently match nothing.
      expect(parseRangeEnd('alpha')).toBeNull();
      expect(parseRangeEnd('')).toBeNull();
    });
  });

  /**
   * A `@db.Date` column (PM planned dates) holds a calendar day, and Prisma
   * compares it with the UTC date of the value it is given (measured 2026-10-23).
   * A local instant must be mapped to its local day first.
   */
  describe('toDateColumnDay', () => {
    it('maps the start and end of a local day to that day, whatever the zone', () => {
      const day = new Date(Date.UTC(2026, 1, 1));
      expect(toDateColumnDay(parseRangeStart('2026-02-01')!)).toEqual(day);
      expect(toDateColumnDay(parseRangeEnd('2026-02-01')!)).toEqual(day);
    });

    it('maps what the web sends (the instant of local midnight) to the local day, not its UTC day', () => {
      const localMidnight = new Date(2026, 1, 1); // 31 Jan 18:30 UTC in India, 1 Feb 05:00 UTC in New York
      expect(toDateColumnDay(localMidnight)).toEqual(new Date(Date.UTC(2026, 1, 1)));
    });
  });

  /** The reverse: a DATE value read back → the local day it names, as instants (2026-10-24). */
  describe('dateColumnDayStart / dateColumnDayEnd', () => {
    const day = new Date(Date.UTC(2026, 1, 1)); // how Prisma returns 1 Feb from a DATE column
    it('start is local midnight of that day, end the next local midnight', () => {
      expect(dateColumnDayStart(day)).toEqual(new Date(2026, 1, 1));
      expect(dateColumnDayEnd(day)).toEqual(new Date(2026, 1, 2));
    });
    it('round-trips through toDateColumnDay', () => {
      expect(toDateColumnDay(dateColumnDayStart(day))).toEqual(day);
      expect(toDateColumnDay(new Date(dateColumnDayEnd(day).getTime() - 1))).toEqual(day);
    });
  });

  /** A PM window holds its first and last day in full, in the local zone. */
  describe('pmWindowPhase', () => {
    const w = { windowStart: new Date(Date.UTC(2026, 9, 18)), windowEnd: new Date(Date.UTC(2026, 9, 24)) };
    it('is upcoming until local midnight of the first day', () => {
      expect(pmWindowPhase(w, new Date(2026, 9, 17, 23, 59))).toBe('upcoming');
      expect(pmWindowPhase(w, new Date(2026, 9, 18, 0, 0))).toBe('open');
      expect(pmWindowPhase(w, new Date(2026, 9, 18, 2, 0))).toBe('open');
    });
    it('stays open all of the last day and closes at the next local midnight', () => {
      expect(pmWindowPhase(w, new Date(2026, 9, 24, 15, 0))).toBe('open');
      expect(pmWindowPhase(w, new Date(2026, 9, 24, 23, 59, 59))).toBe('open');
      expect(pmWindowPhase(w, new Date(2026, 9, 25, 0, 0))).toBe('closed');
    });
  });
});
