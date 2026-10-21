import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ExcelJS from 'exceljs';
import { exportToExcel } from '../excel-export';

/**
 * Drives the REAL exportToExcel + exceljs. The only stubs are the browser
 * download boundary jsdom does not implement: URL.createObjectURL /
 * revokeObjectURL (we capture the Blob there) and the anchor's click (which
 * would navigate). The captured Blob is then read back with exceljs, so the
 * assertions are about the file an operator would actually open.
 *
 * (excel-export-injection.test.ts asserts the injection property on a COPY of
 * neutralizeCell; this file exercises the shipped function end to end.)
 */

let blobs: Blob[];
let revoked: string[];
let clicks: { download: string; href: string; inDom: boolean }[];

beforeEach(() => {
  blobs = [];
  revoked = [];
  clicks = [];
  let n = 0;
  (URL as any).createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return `blob:test/${++n}`; });
  (URL as any).revokeObjectURL = vi.fn((u: string) => { revoked.push(u); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ download: this.download, href: this.getAttribute('href') ?? '', inDom: document.body.contains(this) });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (URL as any).createObjectURL;
  delete (URL as any).revokeObjectURL;
});

async function readBack(blob: Blob): Promise<ExcelJS.Workbook> {
  const buf: ArrayBuffer = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const values = (ws: ExcelJS.Worksheet) => {
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => { out.push((row.values as unknown[]).slice(1)); });
  return out;
};

describe('exportToExcel', () => {
  it('downloads <filename>.xlsx through a temporary anchor and revokes the object URL', async () => {
    await exportToExcel({ filename: 'audit-trail_2026-10-21', head: ['A'], rows: [['x']] });
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(clicks).toEqual([{ download: 'audit-trail_2026-10-21.xlsx', href: 'blob:test/1', inDom: true }]);
    // The anchor is removed again and the URL released.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('writes the header row then every body row, keeping numbers numeric and nulls blank', async () => {
    await exportToExcel({
      filename: 'f', sheetName: 'Filters',
      head: ['Filter', 'Count', 'Note'],
      rows: [['F-001', 3, null], ['F-002', 0, undefined], ['F-003', 12.5, 'ok']],
    });
    const wb = await readBack(blobs[0]);
    const ws = wb.getWorksheet('Filters')!;
    expect(ws).toBeTruthy();
    const v = values(ws);
    expect(v[0]).toEqual(['Filter', 'Count', 'Note']);
    expect(v[1].slice(0, 2)).toEqual(['F-001', 3]);
    expect(typeof v[1][1]).toBe('number');
    expect(v[1][2] ?? '').toBe('');
    expect(v[2].slice(0, 2)).toEqual(['F-002', 0]);
    expect(v[3]).toEqual(['F-003', 12.5, 'ok']);
  });

  it('neutralises formula triggers in the SHIPPED writer: no cell is a live formula', async () => {
    await exportToExcel({
      filename: 'f',
      head: ['=Header', 'Name'],
      rows: [
        ['=cmd|"/c calc"!A1', 'ok'],
        ['+HYPERLINK("http://evil")', '@SUM(1)'],
        ['-2+3', '\tTabbed'],
        ['\rCR', 'Safe-Name'],
      ],
    });
    const ws = (await readBack(blobs[0])).worksheets[0];
    const cells: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => {
      expect((c as any).formula).toBeUndefined();
      cells.push(c.value);
    }));
    // XML end-of-line normalisation turns the stored \r into \n on read-back;
    // what matters is that the quote prefix is there, so compare that cell apart.
    const cr = cells.splice(8, 1)[0];
    expect(cr).toMatch(/^'[\r\n]CR$/);
    expect(cells).toEqual([
      "'=Header", 'Name',
      `'=cmd|"/c calc"!A1`, 'ok',
      `'+HYPERLINK("http://evil")`, "'@SUM(1)",
      "'-2+3", "'\tTabbed",
      'Safe-Name', // a hyphen that is not leading is left alone
    ]);
  });

  it('defaults the sheet name to "Report" and truncates a long one to Excel\'s 31-char limit', async () => {
    await exportToExcel({ filename: 'a', head: ['A'], rows: [] });
    expect((await readBack(blobs[0])).worksheets[0].name).toBe('Report');
    const long = 'Cleaning Lifecycle Report For AHU-0A North Block';
    await exportToExcel({ filename: 'b', sheetName: long, head: ['A'], rows: [] });
    expect((await readBack(blobs[1])).worksheets[0].name).toBe(long.slice(0, 31));
  });

  it('auto-fits each column to its longest cell, clamped to 8..60', async () => {
    await exportToExcel({
      filename: 'w',
      head: ['A', 'Medium header', 'C'],
      rows: [['x', 'short', 'y'.repeat(200)], [null, 'a much longer value here', undefined]],
    });
    const ws = (await readBack(blobs[0])).worksheets[0];
    expect(ws.getColumn(1).width).toBe(8);   // 1 char + 2 -> clamped up to 8
    expect(ws.getColumn(2).width).toBe('a much longer value here'.length + 2);
    expect(ws.getColumn(3).width).toBe(60);  // 200 chars -> clamped down to 60
  });

  it('an export with no rows still writes the header row', async () => {
    await exportToExcel({ filename: 'empty', head: ['Only', 'Header'], rows: [] });
    expect(values((await readBack(blobs[0])).worksheets[0])).toEqual([['Only', 'Header']]);
  });
});
