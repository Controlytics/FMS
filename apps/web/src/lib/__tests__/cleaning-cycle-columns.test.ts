import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CC_COL_KEYS } from '../cleaning-cycle-report';
import { REPORT_DEFS } from '../report-labels';

/**
 * The Filter Cleaning Record renders the SAME column list three ways — the
 * on-screen table, the PDF and the Excel export — from `CC_COL_KEYS`. Two things
 * silently break when a column is added, and both have real precedent:
 *
 *  1. A key with no entry in `report-labels` resolves to `undefined`, so the
 *     header cell renders BLANK rather than failing.
 *  2. The PDF's `columnStyles` are hand-indexed integers. Add a column without
 *     renumbering and every style after it lands on the wrong column; get the
 *     widths wrong and autoTable breaks unbreakable tokens mid-value — which is
 *     exactly what happened on 2026-09-02 ("500X300X200" printed as
 *     "500X300X20" / "0").
 *
 * Widths are MEASURED, never estimated: see the comment above `report.addTable`
 * in history.tsx for the jsPDF numbers behind the current 7pt layout.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const historyTsx = readFileSync(resolve(__dirname, '../../routes/cleaning-cycles/history.tsx'), 'utf8');

/**
 * A4 landscape minus autoTable's DEFAULT margin — `addTable` passes no `margin`,
 * so this is 267mm, not the 268 the older comment quoted. Confirmed by
 * rendering: a 268mm table warns "0.78 units width could not fit page".
 */
const LANDSCAPE_USABLE_MM = 267;

function pdfColumnWidths(): number[] {
  const block = historyTsx.slice(
    historyTsx.indexOf('columnStyles: {', historyTsx.indexOf('body: buildCleaningRows(rows)')),
  );
  const end = block.indexOf('\n      },');
  return [...block.slice(0, end).matchAll(/cellWidth:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

describe('Filter Cleaning Record columns', () => {
  it('includes Dry By, positioned right after Dry Out', () => {
    // Re-added 2026-09-03 on operator request, after being dropped earlier.
    expect(CC_COL_KEYS).toContain('dryBy');
    expect(CC_COL_KEYS.indexOf('dryBy')).toBe(CC_COL_KEYS.indexOf('dryOut') + 1);
    // …and it reads as a pair with washBy, which sits right after washOut.
    expect(CC_COL_KEYS.indexOf('washBy')).toBe(CC_COL_KEYS.indexOf('washOut') + 1);
  });

  it('every column key has a label — a missing one renders a BLANK header', () => {
    const def = REPORT_DEFS.find((d) => d.key === 'cleaning-cycles');
    expect(def, 'cleaning-cycles report def not found').toBeTruthy();
    const labelled = new Set(def!.columns.map((c) => c.key));
    for (const key of CC_COL_KEYS) {
      expect(labelled.has(key), `no report-labels entry for column "${key}"`).toBe(true);
    }
  });

  it('the PDF declares a width for exactly as many columns as it renders', () => {
    // A short list silently misaligns every style after the gap.
    expect(pdfColumnWidths()).toHaveLength(CC_COL_KEYS.length);
  });

  it('the PDF column widths fill the page without overflowing it', () => {
    const total = pdfColumnWidths().reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(LANDSCAPE_USABLE_MM);
    // Also assert it is not far UNDER: unclaimed width is not redistributed
    // evenly, it starves the one column with a long unbreakable token (Filter).
    expect(total).toBeGreaterThanOrEqual(LANDSCAPE_USABLE_MM - 5);
  });

  it('uses the 7pt the 14-column layout was measured for', () => {
    // 8pt needs 284mm of the 268mm available; 7.5pt needs 273. Raising this
    // without re-measuring breaks values mid-token.
    expect(historyTsx).toMatch(/body: buildCleaningRows\(rows\),\s*\n\s*fontSize: 7,/);
  });
});
