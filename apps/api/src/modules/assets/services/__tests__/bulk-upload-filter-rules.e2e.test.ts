/**
 * Bulk filter upload — the per-row rules, against the real database.
 *
 * Complements bulk-upload-filter-scope.e2e.test.ts (scope resolution, row cap)
 * and assets/__tests__/bulk-upload-routes.e2e.test.ts (the HTTP layer). Calls
 * the real service with its own Block / Area / AHU fixture — no mocks — and
 * covers: how cells are read (rich text, hyperlink, formula, date), every scope
 * refusal, the row-level cross checks (area vs AHU, names already used by each
 * kind of entity, names repeated inside the file), and parent capacity.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '../../../../lib/prisma.js';
import type { RequestContext } from '../../../../types/context.js';
import { bulkUploadFilters } from '../bulk-upload-filter.service.js';
import { SliceOwner, runTag } from '../../__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVBR'));
const ctx = { userId: 'cov-bulk-rules', userSub: randomUUID(), userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined } as unknown as RequestContext;
const id: Record<string, string> = {};
const n = (s: string) => own.n(s);

async function book(headers: string[], rows: unknown[][], sheet = 'Filters'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(headers);
  rows.forEach((r, i) => r.forEach((v, c) => { if (v !== undefined) ws.getCell(i + 2, c + 1).value = v as any; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const dry = (buf: Buffer, scope: Record<string, string>, canCreateHierarchy = true, def?: 'SET_A' | 'SET_B') =>
  bulkUploadFilters(buf, scope, def, ctx, { validateOnly: true, canCreateHierarchy });
const errorsOf = (res: Awaited<ReturnType<typeof dry>>) => res.results.filter((r) => r.status === 'error').map((r) => [r.row, r.column, r.error]);

beforeAll(async () => {
  const blockTpl = await own.template('BLOCK', { maxConnections: 50 });
  const smallBlockTpl = await own.template('BLOCK', { maxConnections: 1 });
  const areaTpl = await own.template('AREA', { maxConnections: 50 });
  const ahuTpl = await own.template('AHU', { maxConnections: 50 });
  const otherTpl = await own.template('OTHER');
  await own.template('FILTER', { isActive: true });
  id.B = await own.instance('B', blockTpl);
  id.A = await own.instance('A', areaTpl, id.B);
  id.H = await own.instance('H', ahuTpl, id.A);
  id.HD = await own.instance('HD', ahuTpl, id.B);
  id.Hdead = await own.instance('H-DEAD', ahuTpl, id.A, { isActive: false });
  id.Adead = await own.instance('A-DEAD', areaTpl, id.B, { isActive: false });
  id.B2 = await own.instance('B2', blockTpl);
  id.A2 = await own.instance('A2', areaTpl, id.B2);
  id.H2 = await own.instance('H2', ahuTpl, id.A2);
  id.F2 = await own.filter('F2', id.H2);
  id.O = await own.instance('OTHER', otherTpl);
  id.Horphan = await own.instance('H-ORPHAN', ahuTpl);
  id.Aorphan = await own.instance('A-ORPHAN', areaTpl);
  // A block that already holds its single allowed child (capacity counts CONTAINS rows).
  id.BS = await own.instance('BS', smallBlockTpl);
  id.HS = await own.instance('HS', ahuTpl, id.BS);
  // The DB requires each containment link with its inverse (pair invariant trigger).
  await prisma.assetRelationship.createMany({
    data: [
      { sourceAssetId: id.BS, targetAssetId: id.HS, relationshipType: 'CONTAINS' },
      { sourceAssetId: id.HS, targetAssetId: id.BS, relationshipType: 'CONTAINED_IN' },
    ],
  });
}, 60_000);

afterAll(async () => {
  await own.cleanup();
}, 60_000);

describe('bulk upload rules — reading the workbook', () => {
  it('reads rich text, hyperlink, formula and date cells, ignores unknown columns, and falls back to the first sheet', async () => {
    const buf = await book(['Filter Name', 'AHU Name', 'filterSet', 'colour', 'lastCleaningDate', 'Dimensions'], [[
      { richText: [{ text: `${n('RT')}` }, { text: '-1' }] },
      { text: n('H'), hyperlink: 'http://example.invalid/h' },
      { formula: '"A"', result: 'A' },
      'red',
      new Date(Date.UTC(2026, 2, 1)),
      '600x600',
    ]], 'Data');
    const res = await dry(buf, { blockId: id.B });
    expect(errorsOf(res)).toEqual([]);
    expect(res.rows![0]).toMatchObject({ name: `${n('RT')}-1`, ahu: n('H'), ahuStatus: 'existing', area: n('A'), areaStatus: 'existing', filterSet: 'A', lastCleaningDate: '2026-03-01', filterSize: '600x600' });
    expect(res.rows![0]).not.toHaveProperty('colour');
  });

  it('refuses a sheet without a name column, a sheet without data, and a row with no name', async () => {
    expect(errorsOf(await dry(await book(['ahu', 'filterSet'], [['x', 'A']]), { blockId: id.B }))).toEqual([[1, undefined, 'Template is missing a "name" column']]);
    expect(errorsOf(await dry(await book(['name', 'filterSet'], []), { blockId: id.B }))).toEqual([[1, undefined, 'No data rows found']]);
    const blank = await dry(await book(['name', 'ahu', 'filterSet'], [[undefined, undefined, 'A']]), { blockId: id.B });
    expect(errorsOf(blank)).toEqual([[2, 'name', 'Filter Name is required'], [2, 'ahu', 'ahu is required — the AHU this filter goes into']]);
  });
});

describe('bulk upload rules — scope', () => {
  const sheet = () => book(['name', 'filterSet'], [[n('S1'), 'A']]);
  it('refuses a scope that does not resolve to an active block', async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ ahuId: randomUUID() }, 'AHU not found'],
      [{ ahuId: id.Hdead }, 'AHU not found'],
      [{ ahuId: id.H, blockId: id.B2 }, `AHU "${n('H')}" is not in the selected block`],
      [{ ahuId: id.Horphan }, 'Choose the block, area or AHU to upload into'],
      [{ areaId: randomUUID() }, 'Area not found'],
      [{ areaId: id.Adead }, 'Area not found'],
      [{ areaId: id.A, blockId: id.B2 }, `Area "${n('A')}" is not in the selected block`],
      [{ areaId: id.Aorphan }, 'Choose the block, area or AHU to upload into'],
      [{ blockId: randomUUID() }, 'Block not found'],
      [{}, 'Choose the block, area or AHU to upload into'],
    ];
    for (const [scope, error] of cases) {
      const res = await dry(await sheet(), scope);
      expect(res, error).toMatchObject({ created: 0, failed: 1, results: [{ row: 1, status: 'error', error }] });
    }
    // An AHU sitting directly on a block resolves that block; a matching blockId is accepted.
    const direct = await dry(await sheet(), { ahuId: id.HD, blockId: id.B });
    expect(errorsOf(direct)).toEqual([]);
  });

  it('AHU scope: an ahu / area cell that names somewhere else is an error, a matching one is fine', async () => {
    const res = await dry(await book(['name', 'ahu', 'area', 'filterSet'], [
      [n('S2'), n('HD'), '', 'A'],
      [n('S3'), '', n('A2'), 'B'],
      [n('S4'), n('h').toLowerCase(), n('A'), 'A'],
    ]), { ahuId: id.H });
    expect(errorsOf(res)).toEqual([
      [2, 'ahu', `This upload goes into AHU "${n('H')}", but the row names "${n('HD')}". Remove the ahu column, or upload from the block.`],
      [3, 'area', `This upload goes into AHU "${n('H')}" (area "${n('A')}"), but the row names area "${n('A2')}".`],
    ]);
    const direct = await dry(await book(['name', 'area', 'filterSet'], [[n('S5'), n('A'), 'A']]), { ahuId: id.HD });
    expect(errorsOf(direct)).toEqual([[2, 'area', `This upload goes into AHU "${n('HD')}", but the row names area "${n('A')}".`]]);
  });

  it('area scope: a row naming another area is an error', async () => {
    const res = await dry(await book(['name', 'ahu', 'area', 'filterSet'], [[n('S6'), n('H'), n('OTHER-AREA'), 'A']]), { areaId: id.A });
    expect(errorsOf(res)).toEqual([[2, 'area', `This upload goes into area "${n('A')}", but the row names area "${n('OTHER-AREA')}". Remove the area column, or upload from the block.`]]);
  });
});

describe('bulk upload rules — block scope cross checks', () => {
  it('an existing AHU must sit where the row says', async () => {
    const res = await dry(await book(['name', 'area', 'ahu', 'filterSet'], [
      [n('C1'), n('A'), n('HD'), 'A'],
      [n('C2'), n('NEW-AREA-C2'), n('H'), 'A'],
    ]), { blockId: id.B });
    expect(errorsOf(res)).toEqual([
      [2, 'ahu', `AHU "${n('HD')}" already exists in this block directly (no area), not under area "${n('A')}". Fix the area cell, or leave it blank.`],
      [3, 'ahu', `AHU "${n('H')}" already exists in this block under area "${n('A')}", not under area "${n('NEW-AREA-C2')}". Fix the area cell, or leave it blank.`],
    ]);
    // Neither new area is planned: their rows failed.
    expect(res.newAreas).toEqual([]);
  });

  it('a new AHU keeps the area its first row gave it; a later row without an area inherits it', async () => {
    const res = await dry(await book(['name', 'area', 'ahu', 'filterSet'], [
      [n('P1'), n('NEW-AREA-P'), n('NEW-AHU-P'), 'A'],
      [n('P2'), '', n('NEW-AHU-P'), 'A'],
      [n('P3'), n('A'), n('NEW-AHU-P'), 'A'],
      [n('P4'), '', n('NEW-AHU-Q'), 'B'],
      [n('P5'), n('A'), n('NEW-AHU-Q'), 'B'],
    ]), { blockId: id.B });
    expect(errorsOf(res)).toEqual([
      [4, 'ahu', `New AHU "${n('NEW-AHU-P')}" is placed under a different area by an earlier row (row 2). Use the same area for every row of one AHU.`],
      [6, 'ahu', `New AHU "${n('NEW-AHU-Q')}" is placed directly under the block by an earlier row (row 5). Use the same area for every row of one AHU.`],
    ]);
    expect(res.rows![1]).toMatchObject({ ahu: n('NEW-AHU-P'), ahuStatus: 'new', area: n('NEW-AREA-P'), areaStatus: 'new' });
    expect(res.newAreas).toEqual([n('NEW-AREA-P')]);
    expect(res.newAhus).toEqual([n('NEW-AHU-P'), n('NEW-AHU-Q')]);
  });

  it('a new name the upload would create must be free site-wide (and not a filter name in the same file)', async () => {
    const res = await dry(await book(['name', 'area', 'ahu', 'filterSet'], [
      [n('N1'), '', n('F2'), 'A'],
      [n('N2'), '', n('H2'), 'A'],
      [n('N3'), '', n('A2'), 'A'],
      [n('N4'), '', n('B2'), 'A'],
      [n('N5'), '', n('OTHER'), 'A'],
      [n('N6'), n('HD'), n('NEW-AHU-N6'), 'A'],
      [n('N7'), '', n('N8'), 'A'],
      [n('N8'), '', n('H'), 'A'],
    ]), { blockId: id.B });
    expect(errorsOf(res)).toEqual([
      [2, 'ahu', `"${n('F2')}" is already used by a filter outside this block — names are unique across the site`],
      [3, 'ahu', `"${n('H2')}" is already used by an AHU outside this block — names are unique across the site`],
      [4, 'ahu', `"${n('A2')}" is already used by an area outside this block — names are unique across the site`],
      [5, 'ahu', `"${n('B2')}" is already used by a block outside this block — names are unique across the site`],
      [6, 'ahu', `"${n('OTHER')}" is already used by another entity outside this block — names are unique across the site`],
      [7, 'area', `"${n('HD')}" is already used by an AHU in this block — names are unique across the site`],
      [8, 'ahu', `"${n('N8')}" is also used as a filter name in this file`],
    ]);
  });

  it('a filter name must be new, unique in the file, and not reused as an AHU / area name; field values are validated', async () => {
    const res = await dry(await book(['name', 'area', 'ahu', 'filterSet', 'ahuType', 'lastCleaningDate'], [
      [n('F2'), '', n('H'), 'A', '', ''],
      [n('NEW-AHU-X'), '', n('NEW-AHU-X'), 'A', '', ''],
      [n('D1'), '', n('H'), 'A', 'Bogus', '2026-02-30'],
    ]), { blockId: id.B });
    expect(errorsOf(res)).toEqual([
      [2, 'name', `"${n('F2')}" already exists`],
      [3, 'ahu', `"${n('NEW-AHU-X')}" is also used as a filter name in this file`],
      [3, 'name', `"${n('NEW-AHU-X')}" is also used as an AHU / area name in this file`],
      [4, 'ahuType', 'must be one of: Process, Non Process'],
      [4, 'lastCleaningDate', 'must be a date (YYYY-MM-DD) or NA'],
    ]);
  });

  it('without hierarchy-create permission a new AREA is refused too', async () => {
    const res = await dry(await book(['name', 'area', 'ahu', 'filterSet'], [[n('Z1'), n('NEW-AREA-Z'), n('H'), 'A']]), { blockId: id.B }, false);
    expect(errorsOf(res)).toEqual([
      [2, 'area', `Area "${n('NEW-AREA-Z')}" does not exist in this block, and you do not have permission to create areas. Create it first or ask an administrator.`],
    ]);
  });

  it('a parent already at its template\'s maximum children cannot take a new AHU or area', async () => {
    const res = await dry(await book(['name', 'area', 'ahu', 'filterSet'], [
      [n('K1'), '', n('NEW-AHU-K1'), 'A'],
      [n('K2'), n('NEW-AREA-K'), n('NEW-AHU-K2'), 'A'],
      [n('K3'), '', n('HS'), 'A'],
    ]), { blockId: id.BS });
    const full = `block "${n('BS')}" already holds its maximum of 1 children`;
    expect(errorsOf(res)).toEqual([
      [2, 'ahu', `New AHU "${n('NEW-AHU-K1')}": Cannot create it: ${full}`],
      [3, 'ahu', `New AHU "${n('NEW-AHU-K2')}": Cannot create it: ${full}`],
    ]);
    expect(res).toMatchObject({ newAreas: [], newAhus: [] });
    expect(res.results.find((r) => r.row === 4)).toMatchObject({ status: 'success' });
  });
});

describe('bulk upload rules — a real upload (block scope)', () => {
  it('creates the new area and AHU through the structure path, then the filters, and audits one summary row', async () => {
    const res = await bulkUploadFilters(await book(['name', 'area', 'ahu', 'filterSet', 'ahuType'], [
      [n('R1'), n('NEW-AREA-R'), n('NEW-AHU-R'), 'A', 'Process'],
      [n('R2'), '', n('HD'), '', ''],
    ]), { blockId: id.B }, 'SET_B', ctx, { canCreateHierarchy: true });
    expect(res).toMatchObject({ created: 2, failed: 0, newAreas: [n('NEW-AREA-R')], newAhus: [n('NEW-AHU-R')] });
    const ahu = await prisma.ahu.findFirst({ where: { name: n('NEW-AHU-R') } });
    const area = await prisma.area.findFirst({ where: { name: n('NEW-AREA-R') } });
    expect(area).toMatchObject({ blockId: id.B });
    expect(ahu).toMatchObject({ areaId: area!.id });
    const r2 = await prisma.filter.findFirst({ where: { name: n('R2') } });
    expect(r2).toMatchObject({ ahuId: id.HD });
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: r2!.id } }))!.filterSet).toBe('SET_B');
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'BULK_FILTER_UPLOAD', targetId: id.B }, orderBy: { chainPosition: 'desc' } });
    expect(audit!.afterValue).toMatchObject({ scope: 'block', count: 2, createdAreas: [n('NEW-AREA-R')], createdAhus: [n('NEW-AHU-R')] });
    expect(audit!.reason).toBe(`Bulk uploaded 2 filters into block "${n('B')}"; created AHU(s) ${n('NEW-AHU-R')}; created area(s) ${n('NEW-AREA-R')}`);
  });

  it('writes no audit row when nothing was created', async () => {
    const before = await prisma.auditTrail.count({ where: { action: 'BULK_FILTER_UPLOAD', targetId: id.A } });
    const res = await bulkUploadFilters(await book(['name', 'ahu', 'filterSet'], [[n('R1'), n('H'), 'A']]), { areaId: id.A }, undefined, ctx, { canCreateHierarchy: true });
    expect(res).toMatchObject({ created: 0, failed: 1 });
    expect(await prisma.auditTrail.count({ where: { action: 'BULK_FILTER_UPLOAD', targetId: id.A } })).toBe(before);
  });
});
