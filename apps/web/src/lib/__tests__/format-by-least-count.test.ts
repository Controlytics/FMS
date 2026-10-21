import { describe, it, expect } from 'vitest';
import { getLeastCountDecimals, formatByLeastCount } from '../format-by-least-count';

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
