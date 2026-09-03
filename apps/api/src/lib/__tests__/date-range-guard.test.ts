import { describe, it, expect } from 'vitest';
import { findInvertedRange, DATE_RANGE_PARAM_PAIRS, parseRangeEnd } from '../date-range-guard.js';

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
    // super-admin/routes.ts listWhere and the console's inDateRange use the
    // same rule — all three must agree or the same filter means different
    // things in different places.
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
});

/**
 * Exported 2026-09-03 so endpoints stop re-implementing the rule. Notifications
 * was doing `lte: new Date(endDate)`, which for a bare date is MIDNIGHT — so
 * "to = today" returned nothing from today and a same-day range was empty.
 */
describe('parseRangeEnd', () => {
  it('expands a bare yyyy-mm-dd to the last millisecond of that day', () => {
    expect(parseRangeEnd('2026-09-03')).toEqual(new Date('2026-09-03T23:59:59.999'));
  });

  it('leaves a full instant untouched', () => {
    expect(parseRangeEnd('2026-09-03T08:30:00.000Z')).toEqual(new Date('2026-09-03T08:30:00.000Z'));
    expect(parseRangeEnd('2026-09-03T08:30')).toEqual(new Date('2026-09-03T08:30'));
  });

  it('returns null for a value that is not a date, so the caller decides', () => {
    // Matching on parameter NAME means a non-date can reach here; turning it
    // into an Invalid Date would silently match nothing.
    expect(parseRangeEnd('alpha')).toBeNull();
    expect(parseRangeEnd('')).toBeNull();
  });
});
