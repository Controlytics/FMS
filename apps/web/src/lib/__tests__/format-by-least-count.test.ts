import { describe, it, expect } from 'vitest';
import { getLeastCountDecimals, formatByLeastCount, formatRecordedReading } from '../format-by-least-count';

describe('getLeastCountDecimals', () => {
  it.each([
    [1, 0], [5, 0], [0.5, 1], [0.1, 1], [0.25, 2], [0.01, 2], [0.001, 3],
    [1e-7, 7],          // toString() gives "1e-7"
    ['0.05', 2],        // a string least count from a JSON row
    [0, 0], [-0.1, 0], [null, 0], [undefined, 0], [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0],
  ] as const)('least count %s -> %i decimals', (lc, decimals) => {
    expect(getLeastCountDecimals(lc as number)).toBe(decimals);
  });
});

describe('formatByLeastCount', () => {
  it.each([
    [25, 1, '25'],
    [25, 0.5, '25.0'],
    [25.06, 0.1, '25.1'],
    [25, 0.01, '25.00'],
    ['69.625', 0.01, '69.63'],
    [0, 0.1, '0.0'],
    [25.4, null, '25'],
  ] as const)('%s at least count %s -> %s', (value, lc, out) => {
    expect(formatByLeastCount(value, lc as number | null)).toBe(out);
  });

  it.each([[null], [undefined], ['']])('an empty reading (%j) renders as blank', (v) => {
    expect(formatByLeastCount(v as null, 0.1)).toBe('');
  });

  it('a non-numeric reading is shown as typed, never as NaN', () => {
    expect(formatByLeastCount('n/a', 0.1)).toBe('n/a');
    expect(formatByLeastCount(Number.POSITIVE_INFINITY, 0.1)).toBe('Infinity');
  });
});

// Operator decision 2026-10-22: a RECORDED reading is shown exactly as stored.
// An instrument can report finer than its least count (an auto-fetched 60.04 on
// a 0.1 dryer); formatByLeastCount showed "60.0" while the record held 60.04.
describe('formatRecordedReading', () => {
  it.each([
    [60.04, 0.1, '60.04'],     // finer than the least count: every recorded digit
    [60, 0.1, '60.0'],         // coarser: padded to the least count, the same number
    [25.06, 0.1, '25.06'],     // formatByLeastCount would round this to 25.1
    ['69.625', 0.01, '69.625'],
    [25, 1, '25'],
    [25.4, null, '25.4'],      // no least count: the value as recorded
    [0.1 + 0.2, 0.1, String(0.1 + 0.2)], // the stored double, never tidied
    [-3.25, 0.5, '-3.25'],
  ] as const)('%s at least count %s -> %s', (value, lc, out) => {
    expect(formatRecordedReading(value, lc as number | null)).toBe(out);
  });

  it.each([[null], [undefined], ['']])('an empty reading (%j) renders as blank', (v) => {
    expect(formatRecordedReading(v as null, 0.1)).toBe('');
  });

  it('a non-numeric reading is shown as typed, never as NaN', () => {
    expect(formatRecordedReading('n/a', 0.1)).toBe('n/a');
  });

  it('never shows fewer digits than the value has (the screen matches the record)', () => {
    for (const v of [1.23456, 99.999, 0.005, 1234.5678]) {
      expect(Number(formatRecordedReading(v, 0.1))).toBe(v);
    }
  });
});
