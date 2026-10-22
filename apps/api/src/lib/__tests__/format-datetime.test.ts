/**
 * Server-side date formatting (lib/format-datetime.ts). Must match the web
 * hook (apps/web use-datetime-format) so a date in a notification, an export
 * or a PDF reads the same as on screen.
 *
 * 2026-10-21: MM/DD/YYYY was not zero-padded (en-US prints 6/15/2026), and
 * DD-MMM-YYYY used ICU's short month, which is "Sept" on ICU 72+.
 */
import { describe, it, expect } from 'vitest';
import { formatDateWith } from '../format-datetime.js';

const cfg = (dateFormat: string, timezone = 'UTC') => ({ dateFormat, timeFormat: '24-hour', timezone });
const JUN_15 = '2026-06-15T09:05:00.000Z';
const SEP_05 = '2026-09-05T09:05:00.000Z';

describe('formatDateWith', () => {
  it.each([
    ['DD/MM/YYYY', JUN_15, '15/06/2026'],
    ['MM/DD/YYYY', JUN_15, '06/15/2026'],
    ['MM/DD/YYYY', SEP_05, '09/05/2026'],
    ['YYYY-MM-DD', SEP_05, '2026-09-05'],
    ['DD-MMM-YYYY', SEP_05, '05-Sep-2026'],
    ['DD-MMM-YYYY', JUN_15, '15-Jun-2026'],
    // The format says DD: a one-digit day is zero-padded, like every other format.
    ['MMM DD, YYYY', SEP_05, 'Sep 05, 2026'],
    ['MMM DD, YYYY', JUN_15, 'Jun 15, 2026'],
  ])('%s %s -> %s', (format, value, expected) => {
    expect(formatDateWith(cfg(format), value)).toBe(expected);
  });

  it('every month of DD-MMM-YYYY is a fixed 3-letter name (never "Sept")', () => {
    const names = Array.from({ length: 12 }, (_, m) =>
      formatDateWith(cfg('DD-MMM-YYYY'), new Date(Date.UTC(2026, m, 10, 12))).split('-')[1]);
    expect(names).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('formats in the configured zone, not UTC (a late-evening UTC instant is the next day in IST)', () => {
    const lateUtc = '2026-06-15T20:00:00.000Z'; // 16 Jun 01:30 in Asia/Kolkata
    expect(formatDateWith(cfg('MM/DD/YYYY', 'Asia/Kolkata'), lateUtc)).toBe('06/16/2026');
    expect(formatDateWith(cfg('DD-MMM-YYYY', 'Asia/Kolkata'), lateUtc)).toBe('16-Jun-2026');
    expect(formatDateWith(cfg('MM/DD/YYYY', 'UTC'), lateUtc)).toBe('06/15/2026');
  });

  it('empty and unparseable values format as an empty string', () => {
    expect(formatDateWith(cfg('DD-MMM-YYYY'), null)).toBe('');
    expect(formatDateWith(cfg('DD-MMM-YYYY'), 'not a date')).toBe('');
  });
});
