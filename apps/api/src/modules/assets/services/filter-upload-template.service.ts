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
}

/**
 * `ahuNames` are the AHUs under the block the operator is uploading into, read
 * at DOWNLOAD time — so the dropdown reflects the block as it stands right then,
 * and an AHU added later needs a fresh template (same contract the field-option
 * dropdowns already have).
 *
 * The list is REQUIRED, not optional: a template with an `ahu` column but no
 * dropdown would look like this feature while silently accepting free text into
 * a name-resolution path. The route 400s rather than emit one.
 */
export async function buildFilterUploadTemplate(ahuNames: string[]): Promise<Buffer> {
  const opts = await loadFilterFieldOptions();

  const columns: TemplateColumn[] = [
    { key: 'name', header: 'name', note: 'Required. Unique filter ID / name.' },
    // Per-row AHU (2026-09-04). One upload can now span every AHU in the block.
    // Blank falls back to the AHU picked in the dialog, mirroring how filterSet
    // falls back to the dialog default.
    { key: 'ahu', header: 'ahu', options: ahuNames,
      note: 'AHU this filter belongs to. Pick from the dropdown (the AHUs in this block). Leave blank to use the AHU selected in the upload dialog.' },
    { key: 'filterSet', header: 'filterSet', options: ['A', 'B'], note: 'A or B. Leave blank to use the dialog Default Filter Set.' },
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
          showErrorMessage: true,
          errorStyle: 'error',
          errorTitle: 'Invalid value',
          error: `Choose a value from the ${col.header} dropdown (reflects the current master data).`,
        };
      }
    }
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
