import * as XLSX from 'xlsx';

export interface ExcelExportOptions {
  /** File name WITHOUT the .xlsx extension. */
  filename: string;
  sheetName?: string;
  head: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * Export a single-sheet .xlsx from a header row + body rows (the same
 * `head` / `body` shape pages already build for their PDF table), using
 * SheetJS. Column widths auto-fit to content. Downloads immediately.
 */
export function exportToExcel({ filename, sheetName = 'Report', head, rows }: ExcelExportOptions): void {
  const aoa: (string | number)[][] = [
    head,
    ...rows.map((r) => r.map((c) => (c == null ? '' : (typeof c === 'number' ? c : String(c))))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Auto-fit column widths from the longest cell in each column (clamped).
  ws['!cols'] = head.map((h, i) => {
    const longest = Math.max(
      String(h).length,
      ...rows.map((r) => String(r[i] ?? '').length),
    );
    return { wch: Math.min(Math.max(longest + 2, 8), 60) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
