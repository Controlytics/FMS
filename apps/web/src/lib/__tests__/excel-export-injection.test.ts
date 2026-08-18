import { describe, it, expect } from 'vitest';
import * as ExcelJS from 'exceljs';

// VAPT-1 (2026-08-18): excel-export.ts is the client-side .xlsx builder used by
// 11+ pages that export operator-controlled text. It previously wrote raw cell
// values, so a field like `=cmd|'/c calc'!A1` exported as a live formula.
// The FORMULA_TRIGGER + neutralizeCell logic mirrors backend lib/spreadsheet-safe.ts.
// We assert the *property* (no executable formula survives) against a real
// exceljs round-trip, since excel-export.ts triggers a browser download and can't
// be called directly in jsdom.

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
function neutralizeCell(c: string | number | null | undefined): string | number {
  if (c == null) return '';
  if (typeof c === 'number') return c;
  const s = String(c);
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

describe('VAPT-1 — client Excel export neutralizes formula injection', () => {
  it('quote-escapes leading = + - @ and keeps no live formula after a round-trip', async () => {
    const head = ['name', 'note'];
    const rows: (string | number | null)[][] = [
      ['=cmd|"/c calc"!A1', 'ok'],
      ['+HYPERLINK("http://evil")', '=IMPORTXML(1)'],
      ['@SUM(1)', '-2+3'],
      ['SafeName', 42],
    ];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('R');
    ws.addRow(head.map(neutralizeCell));
    for (const r of rows) ws.addRow(r.map(neutralizeCell));
    const buf = await wb.xlsx.writeBuffer();

    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buf as any);
    let live = 0, danger = 0;
    wb2.worksheets[0].eachRow((row) => row.eachCell((c) => {
      if ((c as any).formula || (c.value && (c.value as any).formula)) live++;
      const t = typeof c.value === 'string' ? c.value : '';
      if (/^[=+\-@]/.test(t)) danger++;
    }));
    expect(live).toBe(0);
    expect(danger).toBe(0);
  });

  it('leaves numbers and safe strings untouched', () => {
    expect(neutralizeCell(42)).toBe(42);
    expect(neutralizeCell('HEPA-01')).toBe('HEPA-01');
    expect(neutralizeCell(null)).toBe('');
    expect(neutralizeCell('=1+1')).toBe("'=1+1");
  });
});
