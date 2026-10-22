/**
 * How the Filter Cleaning Record export reads its rows (cleaning-cycles/history.tsx),
 * kept out of the page so the rules are tested as the code that runs (2026-10-22).
 *
 * - The export holds CYCLES only. Manual status updates have no stages, and the
 *   server's `total` counts both, so the count that goes on the document is
 *   `cycles.length`, never `total` (M61).
 * - The export limit is compared against the cycles read so far across the
 *   WHOLE record, never one page (a page can never exceed it, M60), and the read
 *   stops as soon as the limit is passed, so an oversized export is not pulled
 *   over the wire first.
 * - The read pages until an empty page or the server's total, with no page cap
 *   (operator decision 2026-09-04: no record caps). It used to stop after 100
 *   pages of 100: a record of more than 10,000 rows (cycles + manual updates)
 *   arrived short with no word.
 * - Truncation is reported from EVIDENCE: fewer rows read than the server's own
 *   total. The page used to compare the export with a mirrored 5,000-cycle server
 *   cap, which the server dropped on 2026-09-04 (6c5749d), so every complete export
 *   of 5,000+ cycles was labelled truncated on the document itself.
 */
export const EXPORT_PAGE_SIZE = 100;

export interface CleaningRecordPage {
  data?: any[];
  total?: number;
}

export type CleaningRecordExport =
  /** Over the export limit: refused, and the read stopped there. */
  | { tooLarge: true; cycleCount: number }
  /** `read` rows (cycles + manual) of the server's `total`; `truncated` = read < total. */
  | { tooLarge: false; cycles: any[]; read: number; total: number; truncated: boolean };

const isCycle = (row: any) => row?._kind !== 'manual';

export async function readCleaningRecordExport(
  fetchPage: (page: number, pageSize: number) => Promise<CleaningRecordPage | null | undefined>,
  maxRecords: number,
): Promise<CleaningRecordExport> {
  const all: any[] = [];
  let cycleCount = 0;
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await fetchPage(page, EXPORT_PAGE_SIZE);
    const batch = res?.data ?? [];
    all.push(...batch);
    cycleCount += batch.filter(isCycle).length;
    if (cycleCount > maxRecords) return { tooLarge: true, cycleCount };
    // A server that omits `total` is taken at its word: what it sent is all there is.
    total = res?.total ?? all.length;
    if (batch.length === 0 || all.length >= total) break;
  }
  return { tooLarge: false, cycles: all.filter(isCycle), read: all.length, total, truncated: all.length < total };
}
