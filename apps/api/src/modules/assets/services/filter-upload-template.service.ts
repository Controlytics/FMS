// Builds the Filter bulk-upload .xlsx template with live Excel Data Validation
// dropdowns. SheetJS (`xlsx`) cannot WRITE data validation, so we use exceljs.
// Dropdown values come fresh from loadFilterFieldOptions() each call, so a
// master-data edit shows up in the next downloaded template — nothing hardcoded.
// Columns are the concrete single-create fields (no templateId / attributeSchema).
import ExcelJS from 'exceljs';
import { loadFilterFieldOptions } from './filter-fields.service.js';

const VALIDATION_ROWS = 1000;

interface TemplateColumn {
  key: string;
  header: string;
  options?: string[];
  note?: string;
  // true = the dropdown only SUGGESTS (AHU / Area names): a typed value that is
  // not in the list is accepted, because the upload creates it. false = strict.
  suggestOnly?: boolean;
}

export type FilterTemplateScope =
  | { scope: 'ahu' }
  | { scope: 'area'; ahuNames: string[] }
  | { scope: 'block'; ahuNames: string[]; areaNames: string[] };

/**
 * Columns follow where the upload was started (2026-10-08):
 *  - AHU   → no ahu / area columns: every filter goes into that AHU.
 *  - Area  → `ahu` column (required), suggesting the area's AHUs.
 *  - Block → `area` column (optional) + `ahu` column (required), suggesting the
 *            block's Areas / AHUs.
 * Names are read at DOWNLOAD time; a new name may be typed — the upload
 * matches existing ones (ignoring case / extra spaces) and creates the rest.
 */
export async function buildFilterUploadTemplate(target: FilterTemplateScope): Promise<Buffer> {
  const opts = await loadFilterFieldOptions();

  const hierarchy: TemplateColumn[] = [];
  if (target.scope === 'block') {
    hierarchy.push({ key: 'area', header: 'area', options: target.areaNames, suggestOnly: true,
      note: 'Optional. The area the AHU sits in. Pick an existing one or type a new name — a new area is created in this block. Leave blank for an AHU directly under the block (or to use an existing AHU wherever it is).' });
  }
  if (target.scope !== 'ahu') {
    hierarchy.push({ key: 'ahu', header: 'ahu', options: target.ahuNames, suggestOnly: true,
      note: `Required. The AHU this filter goes into. Pick an existing one or type a new name — a new AHU is created in this ${target.scope}.` });
  }

  const columns: TemplateColumn[] = [
    { key: 'name', header: 'name', note: 'Required. Unique filter ID / name.' },
    ...hierarchy,
    { key: 'filterSet', header: 'filterSet', options: ['A', 'B'], note: 'A or B. Required.' },
    { key: 'ahuType', header: 'ahuType', options: opts.ahuType },
    { key: 'filterType', header: 'filterType', options: opts.filterType },
    { key: 'micronSize', header: 'micronSize', options: opts.micronSize, note: 'Micron size (µm).' },
    { key: 'filterSize', header: 'Filter Dimensions', note: 'Physical filter dimensions (free text).' },
    { key: 'lastCleaningDate', header: 'lastCleaningDate', note: 'YYYY-MM-DD or NA. Optional.' },
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DigiLog';
  const ws = wb.addWorksheet('Filters');

  // Hidden sheet holding the dropdown value-lists, referenced by the main
  // sheet's data validations as ranges (avoids the 255-char inline-list limit).
  const lists = wb.addWorksheet('_lists');
  lists.state = 'veryHidden';

  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(14, c.header.length + 4) }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  let listColIdx = 1;
  columns.forEach((col, i) => {
    const colNumber = i + 1;
    if (col.note) ws.getCell(1, colNumber).note = col.note;

    if (col.options && col.options.length > 0) {
      col.options.forEach((opt, r) => { lists.getCell(r + 1, listColIdx).value = opt; });
      const letter = lists.getColumn(listColIdx).letter;
      const ref = `_lists!$${letter}$1:$${letter}$${col.options.length}`;
      listColIdx++;

      for (let row = 2; row <= VALIDATION_ROWS + 1; row++) {
        ws.getCell(row, colNumber).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [ref],
          // A suggest-only list must not block a typed new name; Excel only
          // enforces the list when the error message is shown.
          showErrorMessage: !col.suggestOnly,
          errorStyle: 'error',
          errorTitle: 'Invalid value',
          error: `Choose a value from the ${col.header} dropdown (reflects the current master data).`,
        };
      }
    }
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
