/**
 * M10 (QA 2026-10-19): the RFID Track Record must load only the requested page
 * of audit rows, not the whole assign/remove history. Before the fix it ran
 * `auditTrail.findMany({ where: { action IN (...) }, orderBy })` — every row,
 * full width — and filtered and paged in Node. Equivalence of the new SQL path
 * with the old output was proven on the QA clone's 3,044-row history
 * (QA/tests/equivalence/rfid-track-record-compare.mts: 23 cases, 0 differences;
 * a 25-row page went 163 ms → 68 ms there, and the old cost grows with history).
 *
 * The Prisma model delegates cannot be spied on (they are proxies), so the
 * "page only" property is asserted on the source, and the result contract on
 * the real digilog_test_db.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { identifierService } from '../identifier.service.js';

describe('RFID Track Record paging (M10)', () => {
  it('pages and filters in SQL instead of loading the whole history', () => {
    const src = readFileSync(resolve(__dirname, '../identifier.service.ts'), 'utf8');
    const fn = src.slice(src.indexOf('async getRfidTrackRecord('));
    expect(fn).not.toMatch(/auditTrail\.findMany\(\{\s*where,\s*orderBy/);
    expect(fn).toMatch(/LIMIT \$\{limit\} OFFSET/);
    expect(fn).toMatch(/auditTrail\.findMany\(\{ where: \{ id: \{ in: pageIds \} \} \}\)/);
  });

  it('total counts every matching row while data holds one page, in the same order', async () => {
    const all = await identifierService.getRfidTrackRecord({});
    const paged = await identifierService.getRfidTrackRecord({ limit: 2, page: 1 });
    expect(paged.total).toBe(all.total);
    expect(paged.data).toEqual(all.data.slice(0, 2));
    expect(paged.totalPages).toBe(Math.ceil(all.total / 2));
  });
});
