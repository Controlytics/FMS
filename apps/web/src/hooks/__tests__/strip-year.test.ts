import { describe, it, expect } from 'vitest';
import { stripYear } from '../use-datetime-format';

// formatDayMonth = formatDate(value) with the year removed. The input here is
// what formatDateValue produces for 15 June 2026 under each configurable
// format; the output must keep that format's day/month ORDER and separator.
describe('stripYear (formatDayMonth)', () => {
  it('keeps the configured day/month order and separator', () => {
    expect(stripYear('15/06/2026', 'DD/MM/YYYY')).toBe('15/06');
    expect(stripYear('06/15/2026', 'MM/DD/YYYY')).toBe('06/15');
    expect(stripYear('2026-06-15', 'YYYY-MM-DD')).toBe('06-15');
    expect(stripYear('15-Jun-2026', 'DD-MMM-YYYY')).toBe('15-Jun');
    expect(stripYear('Jun 15, 2026', 'MMM DD, YYYY')).toBe('Jun 15');
  });

  it('an unknown format falls back to the slash rule, like formatDateValue does', () => {
    expect(stripYear('15/06/2026', 'SOMETHING')).toBe('15/06');
  });

  it('leaves a string with no year untouched', () => {
    expect(stripYear('15/06', 'DD/MM/YYYY')).toBe('15/06');
  });
});
