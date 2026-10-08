import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { buildFilterUploadTemplate, type FilterTemplateScope } from '../filter-upload-template.service.js';
import { prisma } from '../../../../lib/prisma.js';

vi.mock('../../../../lib/prisma.js', () => ({ prisma: { systemConfig: { findUnique: vi.fn() } } }));

const OPTS = { ahuType: ['Process', 'Non Process'], filterType: ['HEPA', 'PRE'], micronSize: ['5', '10'], filterSize: ['610×610×292mm', '24×24×12in'] };
beforeEach(() => { (prisma.systemConfig.findUnique as any).mockResolvedValue({ configValue: { value: OPTS } }); });

async function loadBack(target: FilterTemplateScope) {
  const buf = await buildFilterUploadTemplate(target);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}
const headersOf = (wb: ExcelJS.Workbook) => (wb.getWorksheet('Filters')!.getRow(1).values as any[]).slice(1);
const TAIL = ['filterSet', 'ahuType', 'filterType', 'micronSize', 'Filter Dimensions', 'lastCleaningDate'];

describe('buildFilterUploadTemplate — columns follow the upload scope (2026-10-08)', () => {
  it('AHU scope: no ahu / area columns — every filter goes into that AHU', async () => {
    expect(headersOf(await loadBack({ scope: 'ahu' }))).toEqual(['name', ...TAIL]);
  });

  it('Area scope: an ahu column, no area column', async () => {
    expect(headersOf(await loadBack({ scope: 'area', ahuNames: ['AHU-1'] }))).toEqual(['name', 'ahu', ...TAIL]);
  });

  it('Block scope: an optional area column, then ahu', async () => {
    expect(headersOf(await loadBack({ scope: 'block', ahuNames: ['AHU-M', 'PBKS'], areaNames: ['Zone-1'] }))).toEqual(['name', 'area', 'ahu', ...TAIL]);
  });
});

describe('buildFilterUploadTemplate — dropdowns', () => {
  const block = () => loadBack({ scope: 'block', ahuNames: ['AHU-M', 'PBKS'], areaNames: ['Zone-1'] });

  it('area / ahu dropdowns SUGGEST existing names but accept a typed new one', async () => {
    const ws = (await block()).getWorksheet('Filters')!;
    for (const col of [2, 3]) {
      const dv = ws.getCell(2, col).dataValidation;
      expect(dv?.type).toBe('list');
      // Excel only enforces a list when the error message is shown.
      expect(dv?.showErrorMessage).toBeFalsy();
    }
    const lists = (await block()).getWorksheet('_lists')!;
    expect(lists.getCell(1, 1).value).toBe('Zone-1');
    expect([lists.getCell(1, 2).value, lists.getCell(2, 2).value]).toEqual(['AHU-M', 'PBKS']);
  });

  it('master-data dropdowns stay strict and reflect LIVE config', async () => {
    const wb = await block();
    const ws = wb.getWorksheet('Filters')!;
    const filterSet = ws.getCell(2, 4).dataValidation;
    expect(filterSet?.type).toBe('list');
    expect(filterSet?.showErrorMessage).toBe(true);
    const lists = wb.getWorksheet('_lists')!;
    expect([lists.getCell(1, 3).value, lists.getCell(2, 3).value]).toEqual(['A', 'B']);
    expect([lists.getCell(1, 4).value, lists.getCell(2, 4).value]).toEqual(['Process', 'Non Process']);
  });

  it('leaves Filter Dimensions as free text', async () => {
    const ws = (await block()).getWorksheet('Filters')!;
    expect(ws.getCell(2, 8).dataValidation).toBeUndefined();
  });

  it('an empty block/area still produces a template (new AHUs are typed in)', async () => {
    const wb = await loadBack({ scope: 'block', ahuNames: [], areaNames: [] });
    expect(headersOf(wb)).toEqual(['name', 'area', 'ahu', ...TAIL]);
  });
});
