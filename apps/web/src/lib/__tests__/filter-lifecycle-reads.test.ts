import { describe, it, expect, vi } from 'vitest';
import { fetchAllCycleSummaries, fetchManualChanges, readAllPages, LIFECYCLE_PAGE_SIZE } from '../filter-lifecycle-reads';

/**
 * The Filter Lifecycle report's history reads, called as the page calls them,
 * against a fake server. The reads used to stop after 100 pages of 100, so a
 * filter with more than 10,000 cycles (or manual changes) was reported short
 * with no word (operator decision 2026-09-04: no record caps).
 */

/** A server answering `rows` page by page with its total, honouring page + limit from the URL. */
function fakeServer(rows: any[]) {
  return vi.fn(async (url: string) => {
    const q = new URL(url, 'http://x').searchParams;
    const page = Number(q.get('page'));
    const limit = Number(q.get('limit'));
    return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length };
  });
}
const rows = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

describe('Filter Lifecycle reads — every page, no page cap', () => {
  it('cycle summaries: reads past 100 pages to the server total', async () => {
    const server = fakeServer(rows(10_050, 'c'));
    const all = await fetchAllCycleSummaries('f1', '', '', server);
    expect(all).toHaveLength(10_050);
    expect(all.at(-1)).toEqual({ id: 'c10049' });
    expect(server).toHaveBeenCalledTimes(101);
  });

  it('manual status changes: reads past 100 pages to the server total', async () => {
    const server = fakeServer(rows(10_001, 'm'));
    const all = await fetchManualChanges('f1', '', '', server);
    expect(all).toHaveLength(10_001);
    expect(server).toHaveBeenCalledTimes(101);
  });

  it('asks the right endpoint for one filter, page by page, with the period when one is given', async () => {
    const cycles = fakeServer(rows(150, 'c'));
    await fetchAllCycleSummaries('f-9', '2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z', cycles);
    expect(cycles.mock.calls.map(([u]) => u)).toEqual([1, 2].map((p) =>
      `/api/filters/cycles?filterId=f-9&page=${p}&limit=${LIFECYCLE_PAGE_SIZE}&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-31T23%3A59%3A59.999Z`));
    const manual = fakeServer(rows(3, 'm'));
    await fetchManualChanges('f-9', '', '', manual);
    expect(manual.mock.calls.map(([u]) => u)).toEqual([`/api/filters/manual-status-changes?filterId=f-9&page=1&limit=${LIFECYCLE_PAGE_SIZE}`]);
  });

  it('an empty page, a missing total or a null answer ends the read with what arrived', async () => {
    // Server reports 400 but stops sending after 150: the empty third page ends it.
    const sent = rows(150, 'c');
    const short = vi.fn(async (page: number) => ({ data: sent.slice((page - 1) * 100, page * 100), total: 400 }));
    expect(await readAllPages(short)).toHaveLength(150);
    expect(short).toHaveBeenCalledTimes(3);
    const noTotal = vi.fn(async () => ({ data: rows(2, 'x') }));
    expect(await readAllPages(noTotal)).toHaveLength(2);
    expect(noTotal).toHaveBeenCalledTimes(1);
    expect(await readAllPages(async () => null)).toEqual([]);
  });
});
