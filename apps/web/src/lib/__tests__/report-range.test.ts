import { describe, it, expect, vi } from 'vitest';
import { isoToDateInput, startOfDayIso, endOfDayIso } from '../datetime-input';
import { yearSpan, MAX_YEAR_SPAN } from '../report-range';
import { readCleaningRecordExport, EXPORT_PAGE_SIZE } from '../cleaning-record-export';

const IST = 'Asia/Kolkata';

/**
 * Report range and export rules, each tested as the code the page runs: the
 * PM Schedules year span (lib/report-range.ts `yearSpan`) and the Filter
 * Cleaning Record export read (lib/cleaning-record-export.ts). They lock the
 * behaviours the fixes turn on: a year SPAN is fetched whole (M77), an emptied
 * end stays bounded (D-OPS-4), an export reports the count it actually contains
 * (M61), the export limit sees the whole set (M60), and truncation is claimed
 * only on evidence (2026-10-22).
 */

describe('PM schedule year span (M77)', () => {
  it('fetches every year a cross-year range touches', () => {
    // The old `new Date(dateFrom).getFullYear()` yielded [2026] and silently
    // dropped every Jan/Feb 2027 entry.
    expect(yearSpan('2026-12-01', '2027-02-28', 2000)).toEqual({ years: [2026, 2027], from: '2026-12-01', to: '2027-02-28' });
  });

  it('stays single-year for a within-year range', () => {
    expect(yearSpan('2026-07-01', '2026-07-31', 2000).years).toEqual([2026]);
  });

  it('spans more than two years', () => {
    expect(yearSpan('2025-11-01', '2027-03-01', 2000).years).toEqual([2025, 2026, 2027]);
  });

  it('does not fan out on an absurd range', () => {
    const { years } = yearSpan('2026-01-01', '9999-01-01', 2000);
    expect(years).toHaveLength(MAX_YEAR_SPAN + 1);
    expect(years.at(-1)).toBe(2026 + MAX_YEAR_SPAN);
  });

  it('tolerates an inverted range without producing a negative span', () => {
    expect(yearSpan('2027-01-01', '2026-01-01', 2000).years).toEqual([2027]);
  });

  it('does not shift the year for a January 1st start (the UTC-parse hazard)', () => {
    // `new Date('2026-01-01').getFullYear()` returns 2025 in any zone west of
    // UTC. The string slice cannot.
    expect(yearSpan('2026-01-01', '2026-12-31', 2000).years).toEqual([2026]);
  });
});

describe('PM schedule year span — an emptied end (D-OPS-4)', () => {
  it('an empty To is open to the end of the From year, never year 0', () => {
    expect(yearSpan('2026-03-05', '', 2000)).toEqual({ years: [2026], from: '2026-03-05', to: '2026-12-31' });
  });

  it('an empty From is open to the start of the To year', () => {
    expect(yearSpan('', '2027-08-20', 2000)).toEqual({ years: [2027], from: '2027-01-01', to: '2027-08-20' });
  });

  it('both ends empty: the whole fallback year', () => {
    expect(yearSpan('', '', 2031)).toEqual({ years: [2031], from: '2031-01-01', to: '2031-12-31' });
  });

  it('the fallback year is used only when both ends are empty', () => {
    expect(yearSpan('2026-01-01', '2026-06-30', 2031).years).toEqual([2026]);
  });
});

describe('PM entry day-key filtering (M77)', () => {
  it('keeps an entry whose local day is inside the range but whose UTC day is not', () => {
    // 2026-08-01 00:30 IST is stored as 2026-07-31T19:00Z. Slicing the ISO
    // string put it on 07-31 and dropped it from an August range.
    const plannedDate = '2026-07-31T19:00:00.000Z';
    expect(plannedDate.slice(0, 10)).toBe('2026-07-31');
    const localDay = isoToDateInput(plannedDate, IST);
    expect(localDay).toBe('2026-08-01');
    expect(localDay >= '2026-08-01' && localDay <= '2026-08-31').toBe(true);
  });
});

/** A server answering `rows` page by page with its total, as /api/filters/cleaning-record does. */
const pages = (rows: any[]) => async (page: number, size: number) => ({ data: rows.slice((page - 1) * size, page * size), total: rows.length });
const cycles = (n: number) => Array.from({ length: n }, (_, i) => ({ _kind: 'cycle', id: `c${i}` }));

describe('Cleaning record export: bounds, count, limit, truncation (M60, M61)', () => {
  it('sends bounds that cover the operator local day', () => {
    expect(startOfDayIso('2026-07-15', IST)).toBe('2026-07-14T18:30:00.000Z');
    expect(endOfDayIso('2026-07-15', IST)).toBe('2026-07-15T18:29:59.999Z');
  });

  it('header count equals the exported cycle count, excluding manual rows', async () => {
    // `total` from the server counts cycles AND manual updates; the export only
    // ships cycles. Quoting `total` in the header overstated the document.
    const rows = [{ _kind: 'cycle' }, { _kind: 'manual' }, { _kind: 'cycle' }, { _kind: 'manual' }, { _kind: 'cycle' }];
    const r = await readCleaningRecordExport(pages(rows), 10_000);
    expect(r).toMatchObject({ tooLarge: false, read: 5, total: 5, truncated: false });
    expect(r.tooLarge === false && r.cycles).toEqual([{ _kind: 'cycle' }, { _kind: 'cycle' }, { _kind: 'cycle' }]);
  });

  it('truncation comes from evidence, never from a size: a complete 5,000-cycle record is not truncated', async () => {
    // The page compared the export with a mirrored 5,000-cycle server cap that
    // the server dropped on 2026-09-04, so every complete export that size was
    // labelled truncated.
    const r = await readCleaningRecordExport(pages(cycles(5000)), 10_000);
    expect(r).toMatchObject({ tooLarge: false, read: 5000, total: 5000, truncated: false });
  });

  it('a server that stops sending rows before its own total is reported truncated, with both counts', async () => {
    const sent = cycles(150);
    const fetchPage = vi.fn(async (page: number, size: number) => ({ data: sent.slice((page - 1) * size, page * size), total: 400 }));
    const r = await readCleaningRecordExport(fetchPage, 10_000);
    expect(r).toMatchObject({ tooLarge: false, read: 150, total: 400, truncated: true });
    expect(fetchPage).toHaveBeenCalledTimes(3); // the empty third page ends the read
  });

  it('reads past 100 pages: there is no page cap (operator decision 2026-09-04)', async () => {
    // 9,990 manual updates ahead of 60 cycles. The old read stopped at 100 pages
    // of 100 and kept 10 of the 60 cycles.
    const rows = [...Array.from({ length: 9990 }, () => ({ _kind: 'manual' })), ...cycles(60)];
    const fetchPage = vi.fn(pages(rows));
    const r = await readCleaningRecordExport(fetchPage, 10_000);
    expect(fetchPage).toHaveBeenCalledTimes(101);
    expect(r).toMatchObject({ tooLarge: false, read: 10_050, total: 10_050, truncated: false });
    expect(r.tooLarge === false && r.cycles).toHaveLength(60);
    expect(fetchPage.mock.calls.map(([, size]) => size)).toEqual(Array(101).fill(EXPORT_PAGE_SIZE));
  });

  it('the export limit is compared against the whole set, not one page, and stops the read', async () => {
    // A page holds at most EXPORT_PAGE_SIZE rows, so a per-page check could never
    // trip a limit above that.
    const fetchPage = vi.fn(pages(cycles(250)));
    expect(await readCleaningRecordExport(fetchPage, 150)).toEqual({ tooLarge: true, cycleCount: 200 });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('manual updates do not count toward the export limit; exactly at the limit is allowed', async () => {
    const rows = [...cycles(3), { _kind: 'manual' }, { _kind: 'manual' }];
    expect(await readCleaningRecordExport(pages(rows), 3)).toMatchObject({ tooLarge: false, read: 5, truncated: false });
    expect(await readCleaningRecordExport(pages(cycles(4)), 3)).toEqual({ tooLarge: true, cycleCount: 4 });
  });

  it('a server that omits data / total ends the read with what it sent', async () => {
    expect(await readCleaningRecordExport(async () => ({}), 10)).toEqual({ tooLarge: false, cycles: [], read: 0, total: 0, truncated: false });
    expect(await readCleaningRecordExport(async () => null, 10)).toEqual({ tooLarge: false, cycles: [], read: 0, total: 0, truncated: false });
    const once = vi.fn(async () => ({ data: cycles(2) }));
    expect(await readCleaningRecordExport(once, 10)).toMatchObject({ tooLarge: false, read: 2, total: 2, truncated: false });
    expect(once).toHaveBeenCalledTimes(1);
  });
});
