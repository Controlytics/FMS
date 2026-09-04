import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { buildFilterUploadTemplate } from '../filter-upload-template.service.js';
import { prisma } from '../../../../lib/prisma.js';

vi.mock('../../../../lib/prisma.js', () => ({ prisma: { systemConfig: { findUnique: vi.fn() } } }));

const OPTS = { ahuType: ['Process', 'Non Process'], filterType: ['HEPA', 'PRE'], micronSize: ['5', '10'], filterSize: ['610×610×292mm', '24×24×12in'] };
beforeEach(() => { (prisma.systemConfig.findUnique as any).mockResolvedValue({ configValue: { value: OPTS } }); });

async function loadBack() {
  // The AHU list is what the block holds AT DOWNLOAD TIME — the caller reads it
  // fresh per request, so a newly created AHU shows up in the next download.
  const buf = await buildFilterUploadTemplate(['AHU-M', 'PBKS']);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe('buildFilterUploadTemplate', () => {
  it('produces a Filters sheet with the expected concrete header columns (no templateId/attributes)', async () => {
    const wb = await loadBack();
    const ws = wb.getWorksheet('Filters');
    expect(ws).toBeDefined();
    const headers = (ws!.getRow(1).values as any[]).slice(1);
    // `ahu` sits second (2026-09-04): per-row AHU, shifting every later column by one.
    expect(headers).toEqual(['name', 'ahu', 'filterSet', 'ahuType', 'filterType', 'micronSize', 'Filter Dimensions', 'lastCleaningDate']);
  });

  it('leaves the filterSize column as free text (no data-validation dropdown)', async () => {
    const wb = await loadBack();
    const ws = wb.getWorksheet('Filters')!;
    // Columns: 1 name, 2 filterSet, 3 ahuType, 4 filterType, 5 micronSize, 6 filterSize
    expect(ws.getCell(2, 7).dataValidation).toBeUndefined(); // Filter Dimensions is column 7 now
  });

  it('applies a list data-validation dropdown on filterSet referencing the hidden _lists sheet', async () => {
    const wb = await loadBack();
    const ws = wb.getWorksheet('Filters')!;
    const cell = ws.getCell(2, 3); // row 2, filterSet column (ahu is column 2)
    expect(cell.dataValidation?.type).toBe('list');
    expect(cell.dataValidation?.formulae?.[0]).toContain('_lists');
    const lists = wb.getWorksheet('_lists')!;
    // _lists is filled in dropdown-column order, and `ahu` is the first dropdown,
    // so its names occupy _lists column 1 and filterSet's A/B moved to column 2.
    expect([lists.getCell(1, 1).value, lists.getCell(2, 1).value]).toEqual(['AHU-M', 'PBKS']);
    expect([lists.getCell(1, 2).value, lists.getCell(2, 2).value]).toEqual(['A', 'B']);
  });

  it('reflects LIVE master data — ahuType dropdown uses the config values, not hardcoded', async () => {
    const wb = await loadBack();
    const lists = wb.getWorksheet('_lists')!;
    expect([lists.getCell(1, 3).value, lists.getCell(2, 3).value]).toEqual(['Process', 'Non Process']);
    const ws = wb.getWorksheet('Filters')!;
    expect(ws.getCell(2, 4).dataValidation?.type).toBe('list'); // ahuType is column 4
  });

  it('applies a list dropdown on the ahu column referencing the names passed in', async () => {
    // The route passes the block's AHUs as they stand at download time; the sheet
    // must offer exactly those, so an operator cannot type a filter into an AHU
    // that is not in this block.
    const wb = await loadBack();
    const ws = wb.getWorksheet('Filters')!;
    const dv = ws.getCell(2, 2).dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.formulae?.[0]).toMatch(/^_lists!\$A\$1:\$A\$2$/);
  });
});
