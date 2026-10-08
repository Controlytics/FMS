/**
 * Bulk filter upload — scope-driven AHU / Area resolution (2026-10-08).
 *
 * Runs the real service against digilog_test_db with its own Block / Area / AHU
 * fixture. Proves:
 *  - a 20-row file built from the DOWNLOADED template (1000 dropdown rows) is
 *    accepted — it used to be refused as "Maximum 200 filters per upload";
 *  - Block scope: an existing AHU is used, a missing AHU / Area is created, a
 *    blank area matches an existing AHU wherever it sits;
 *  - an AHU under a different area than the row says is refused, not moved;
 *  - Area scope creates missing AHUs inside that area;
 *  - AHU scope puts every row in that AHU and refuses a stray ahu value;
 *  - without hierarchy-create permission nothing is created;
 *  - the dry-run writes nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../../../../lib/prisma.js';
import { hashPassword } from '../../../../lib/password.js';
import type { RequestContext } from '../../../../types/context.js';
import { bulkUploadFilters } from '../bulk-upload-filter.service.js';
import { buildFilterUploadTemplate } from '../filter-upload-template.service.js';

const PREFIX = `ZZBULK${Date.now()}`;
const USERNAME = 'bulk_upload_scope_admin';
let ctx: RequestContext;
let userId: string;
const templateIds: string[] = [];
let blockId: string;
let areaAId: string;
let ahuInAId: string;
let ahuDirectId: string;

const n = (s: string) => `${PREFIX}-${s}`;

/**
 * A sheet shaped like the downloaded template for `scope`, with `rows` filled in.
 * `excelSaved` mimics a file re-saved in Microsoft Excel: Excel writes an empty
 * <row> element for every row that carries the template's dropdown (rows
 * 2..1001), so `rowCount` reads 1001 however few rows are filled. That is the
 * file the operator uploads, and what the old cap refused.
 */
async function sheet(scope: 'block' | 'area' | 'ahu', rows: Array<Record<string, string>>, excelSaved = false): Promise<Buffer> {
  const buf = await buildFilterUploadTemplate(
    scope === 'ahu' ? { scope } : scope === 'area' ? { scope, ahuNames: [] } : { scope, ahuNames: [], areaNames: [] },
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet('Filters')!;
  const headers = (ws.getRow(1).values as any[]).slice(1) as string[];
  const keyOf: Record<string, string> = { 'Filter Dimensions': 'filterSize' };
  rows.forEach((r, i) => headers.forEach((h, c) => {
    const v = r[keyOf[h] ?? h];
    if (v !== undefined) ws.getCell(i + 2, c + 1).value = v;
  }));
  if (excelSaved) for (let r = rows.length + 2; r <= 1001; r++) ws.getCell(r, 1).numFmt = '@';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const filtersIn = async (ahuId: string) =>
  (await prisma.filter.findMany({ where: { ahuId, name: { startsWith: PREFIX } }, select: { name: true } })).map(f => f.name).sort();

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { username: USERNAME },
    update: { role: 'SUPER_ADMIN', status: 'ENABLED' },
    create: {
      username: USERNAME, passwordHash: await hashPassword('Bulk@Scope1'), fullName: 'Bulk Scope Admin',
      email: 'bulk-scope@example.test', role: 'SUPER_ADMIN', status: 'ENABLED',
      forcePasswordChange: false, isTemporaryPassword: false,
    },
  });
  userId = user.id;
  ctx = { userId: USERNAME, userSub: user.id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', sessionId: 'bulk-scope-test' };

  for (const [code, label] of [['BLOCK', 'Block'], ['AREA', 'Area'], ['AHU', 'AHU'], ['FILTER', 'Filter']] as const) {
    await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
  }
  const tpl = async (kind: string) => {
    const t = await prisma.assetTemplate.create({ data: { name: n(`${kind} Tpl`), templateKind: kind, maxConnections: 50 } });
    templateIds.push(t.id);
    return t.id;
  };
  const blockTpl = await tpl('BLOCK');
  const areaTpl = await tpl('AREA');
  const ahuTpl = await tpl('AHU');
  blockId = (await prisma.assetInstance.create({ data: { name: n('BLOCK'), templateId: blockTpl } })).id;
  areaAId = (await prisma.assetInstance.create({ data: { name: n('AREA-A'), templateId: areaTpl, parentId: blockId } })).id;
  ahuInAId = (await prisma.assetInstance.create({ data: { name: n('AHU-A1'), templateId: ahuTpl, parentId: areaAId } })).id;
  ahuDirectId = (await prisma.assetInstance.create({ data: { name: n('AHU-D1'), templateId: ahuTpl, parentId: blockId } })).id;
  if (!(await prisma.ahu.findUnique({ where: { id: ahuInAId } }))) throw new Error('asset->typed mirror trigger missing on this DB');
});

afterAll(async () => {
  const mine = await prisma.assetInstance.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = mine.map(m => m.id);
  await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
  await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: ids } }, { targetAssetId: { in: ids } }] } });
  await prisma.filter.deleteMany({ where: { name: { startsWith: PREFIX } } });
  // Children before parents: filters, AHUs, areas, block.
  for (const kind of ['FILTER', 'AHU', 'AREA', 'BLOCK']) {
    await prisma.assetInstance.deleteMany({ where: { name: { startsWith: PREFIX }, template: { templateKind: kind } } }).catch(() => undefined);
  }
  await prisma.assetInstance.deleteMany({ where: { name: { startsWith: PREFIX } } }).catch(() => undefined);
  await prisma.assetTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
});

describe('bulk upload — row cap regression', () => {
  it('accepts 20 rows written into the downloaded template (1000 dropdown rows)', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ name: n(`CAP-${i}`), ahu: n('AHU-D1'), filterSet: 'A' }));
    const buf = await sheet('block', rows, true);
    const ws = new ExcelJS.Workbook();
    await ws.xlsx.load(buf as any);
    expect(ws.getWorksheet('Filters')!.rowCount).toBeGreaterThan(260); // the old pre-check refused this
    const res = await bulkUploadFilters(buf, { blockId }, undefined, ctx, { validateOnly: true, canCreateHierarchy: true });
    expect(res.failed).toBe(0);
    expect(res.results.filter(r => r.status === 'success')).toHaveLength(20);
  });

  it('has no 200-filter cap', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ name: n(`BIG-${i}`), ahu: n('AHU-D1'), filterSet: 'B' }));
    const res = await bulkUploadFilters(await sheet('block', rows), { blockId }, undefined, ctx, { validateOnly: true, canCreateHierarchy: true });
    expect(res.failed).toBe(0);
    expect(res.results).toHaveLength(250);
  });
});

describe('bulk upload — Block scope', () => {
  it('dry-run reports what it would create and writes nothing', async () => {
    const res = await bulkUploadFilters(await sheet('block', [
      { name: n('DRY-1'), area: n('AREA-NEW-DRY'), ahu: n('AHU-NEW-DRY'), filterSet: 'A' },
    ]), { blockId }, undefined, ctx, { validateOnly: true, canCreateHierarchy: true });
    expect(res.failed).toBe(0);
    expect(res.newAreas).toEqual([n('AREA-NEW-DRY')]);
    expect(res.newAhus).toEqual([n('AHU-NEW-DRY')]);
    expect(res.rows?.[0]).toMatchObject({ ahuStatus: 'new', areaStatus: 'new' });
    expect(await prisma.assetInstance.count({ where: { name: { in: [n('AREA-NEW-DRY'), n('AHU-NEW-DRY'), n('DRY-1')] } } })).toBe(0);
  });

  it('uses existing AHUs, creates missing AHUs / Areas, and places filters in them', async () => {
    const res = await bulkUploadFilters(await sheet('block', [
      // existing AHU in an area; blank area = "wherever it is"
      { name: n('B-1'), ahu: n('ahu-a1 '), filterSet: 'A' },
      // existing AHU with the right area
      { name: n('B-2'), area: n('AREA-A'), ahu: n('AHU-A1'), filterSet: 'B' },
      // new AHU in an existing area
      { name: n('B-3'), area: n('AREA-A'), ahu: n('AHU-A2'), filterSet: 'A' },
      // new area + new AHU, two filters into it
      { name: n('B-4'), area: n('AREA-B'), ahu: n('AHU-B1'), filterSet: 'A' },
      { name: n('B-5'), area: n('area-b'), ahu: n('AHU-B1'), filterSet: 'B' },
      // new AHU directly under the block
      { name: n('B-6'), ahu: n('AHU-D2'), filterSet: 'A' },
    ]), { blockId }, undefined, ctx, { canCreateHierarchy: true });

    expect(res.failed).toBe(0);
    expect(res.created).toBe(6);
    expect(res.newAreas).toEqual([n('AREA-B')]);
    expect(res.newAhus?.sort()).toEqual([n('AHU-A2'), n('AHU-B1'), n('AHU-D2')].sort());

    expect(await filtersIn(ahuInAId)).toEqual([n('B-1'), n('B-2')]);
    const a2 = await prisma.ahu.findFirst({ where: { name: n('AHU-A2') } });
    expect(a2?.areaId).toBe(areaAId);
    expect(await filtersIn(a2!.id)).toEqual([n('B-3')]);
    const areaB = await prisma.area.findFirst({ where: { name: n('AREA-B') } });
    expect(areaB?.blockId).toBe(blockId);
    const b1 = await prisma.ahu.findFirst({ where: { name: n('AHU-B1') } });
    expect(b1?.areaId).toBe(areaB!.id);
    expect(await filtersIn(b1!.id)).toEqual([n('B-4'), n('B-5')]);
    const d2 = await prisma.ahu.findFirst({ where: { name: n('AHU-D2') } });
    expect(d2?.blockId).toBe(blockId);
    expect(d2?.areaId).toBeNull();

    // Each created AHU / Area has its own ASSET_CREATED audit row.
    expect(await prisma.auditTrail.count({ where: { action: 'ASSET_CREATED', targetId: { in: [areaB!.id, b1!.id, a2!.id, d2!.id] } } })).toBe(4);
  });

  it('refuses an AHU that exists under a different area — never moves it', async () => {
    const res = await bulkUploadFilters(await sheet('block', [
      { name: n('C-1'), area: n('AREA-B'), ahu: n('AHU-A1'), filterSet: 'A' },
    ]), { blockId }, undefined, ctx, { canCreateHierarchy: true });
    expect(res.created).toBe(0);
    expect(res.results[0]).toMatchObject({ status: 'error', column: 'ahu' });
    expect(res.results[0].error).toContain(n('AREA-A'));
  });

  it('refuses a name already used outside the block, and a missing ahu', async () => {
    const res = await bulkUploadFilters(await sheet('block', [
      { name: n('C-2'), ahu: n('B-1'), filterSet: 'A' }, // B-1 is a filter
      { name: n('C-3'), filterSet: 'A' },
    ]), { blockId }, undefined, ctx, { validateOnly: true, canCreateHierarchy: true });
    expect(res.results.map(r => r.column)).toEqual(['ahu', 'ahu']);
    expect(res.results[0].error).toContain('a filter');
  });

  it('creates nothing without hierarchy-create permission', async () => {
    const res = await bulkUploadFilters(await sheet('block', [
      { name: n('P-1'), ahu: n('AHU-NOPERM'), filterSet: 'A' },
      { name: n('P-2'), ahu: n('AHU-D1'), filterSet: 'A' },
    ]), { blockId }, undefined, ctx, { canCreateHierarchy: false });
    expect(res.created).toBe(1);
    expect(res.results.find(r => r.name === n('P-1'))?.error).toContain('permission');
    expect(await prisma.assetInstance.count({ where: { name: n('AHU-NOPERM') } })).toBe(0);
  });

  it('only creates an AHU that a valid row needs', async () => {
    const res = await bulkUploadFilters(await sheet('block', [
      { name: n('V-1'), ahu: n('AHU-UNNEEDED'), filterSet: 'Z' },
    ]), { blockId }, undefined, ctx, { canCreateHierarchy: true });
    expect(res.created).toBe(0);
    expect(res.newAhus).toEqual([]);
    expect(await prisma.assetInstance.count({ where: { name: n('AHU-UNNEEDED') } })).toBe(0);
  });
});

describe('bulk upload — Area scope', () => {
  it('creates a missing AHU inside the area and refuses another area', async () => {
    const res = await bulkUploadFilters(await sheet('area', [
      { name: n('AR-1'), ahu: n('AHU-A3'), filterSet: 'A' },
      { name: n('AR-2'), ahu: n('AHU-D1'), filterSet: 'A' }, // exists, but directly under the block
    ]), { areaId: areaAId }, undefined, ctx, { canCreateHierarchy: true });
    expect(res.created).toBe(1);
    const a3 = await prisma.ahu.findFirst({ where: { name: n('AHU-A3') } });
    expect(a3?.areaId).toBe(areaAId);
    expect(await filtersIn(a3!.id)).toEqual([n('AR-1')]);
    expect(res.results.find(r => r.name === n('AR-2'))).toMatchObject({ status: 'error', column: 'ahu' });
  });
});

describe('bulk upload — AHU scope', () => {
  it('puts every row in the AHU and refuses a stray ahu value', async () => {
    const res = await bulkUploadFilters(await sheet('ahu', [
      { name: n('H-1'), filterSet: 'A' },
      { name: n('H-2'), filterSet: 'B' },
    ]), { ahuId: ahuDirectId }, undefined, ctx, { canCreateHierarchy: false });
    expect(res.created).toBe(2);
    expect(await filtersIn(ahuDirectId)).toEqual(expect.arrayContaining([n('H-1'), n('H-2')]));

    // A block-scope sheet uploaded into an AHU: the row's ahu must match.
    const stray = await bulkUploadFilters(await sheet('block', [
      { name: n('H-3'), ahu: n('AHU-A1'), filterSet: 'A' },
    ]), { ahuId: ahuDirectId }, undefined, ctx, { canCreateHierarchy: true });
    expect(stray.created).toBe(0);
    expect(stray.results[0]).toMatchObject({ status: 'error', column: 'ahu' });
  });
});
