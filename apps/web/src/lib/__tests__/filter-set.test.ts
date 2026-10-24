import { describe, it, expect } from 'vitest';
import { formatFilterSet } from '../filter-set';
import { detailRows } from '../stage-approval';

describe('formatFilterSet', () => {
  it('turns the stored code into the screen label', () => {
    expect(formatFilterSet('SET_A')).toBe('Set A');
    expect(formatFilterSet('SET_B')).toBe('Set B');
    expect(formatFilterSet(' set_b ')).toBe('Set B');
  });
  it('keeps an unknown value and uses the placeholder for none', () => {
    expect(formatFilterSet('LEGACY')).toBe('LEGACY');
    expect(formatFilterSet(null)).toBe('—');
    expect(formatFilterSet('', 'NA')).toBe('NA');
  });
  it('the stage-approval details show "Set B", never SET_B (2026-10-24)', () => {
    const rows = detailRows({ filterName: 'F', block: null, area: null, ahu: null, ahuType: null, micronSize: null, filterType: null, filterDimensions: null, filterSet: 'SET_B' });
    expect(rows.find((r) => r.label === 'Filter Set')?.value).toBe('Set B');
  });
});
