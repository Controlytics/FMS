/**
 * Filter bulk upload over HTTP: the .xlsx template download, the dry-run
 * validate route and the upload route — multipart bodies built by hand and sent
 * through the real harness app (real @fastify/multipart with the production
 * 5 MB limit, real auth / RBAC / re-auth, real Prisma + mirror triggers).
 *
 * The service's row rules are covered in services/__tests__/
 * bulk-upload-filter-scope.e2e.test.ts; this file covers what the ROUTES add:
 * parsing the parts, the scope checks, the hierarchy-create permission
 * decision, re-auth before the body is consumed, and the error mapping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, type Caller } from './slice-support.js';

const own = new SliceOwner(runTag('CVBU'));
let app: FastifyInstance;
type U = { id: string; username: string; call: Caller };
let sa: U, bu: U, bh: U, ac: U, rd: U;
let blockId: string;
let areaId: string;
let ahuId: string;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbook(headers: string[], rows: string[][], sheetName = 'Filters'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipart(fields: Record<string, string>, file?: Buffer, fileField = 'file') {
  const boundary = `----cov${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="upload.xlsx"\r\nContent-Type: ${XLSX}\r\n\r\n`));
    chunks.push(file, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const send = (who: U, path: 'validate' | 'upload', fields: Record<string, string>, file?: Buffer, pw?: string) => {
  const mp = multipart(fields, file);
  const url = path === 'validate' ? '/api/assets/instances/bulk-upload-filters/validate' : '/api/assets/instances/bulk-upload-filters';
  return who.call('POST', url, { body: mp.body, headers: mp.headers, pw });
};

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const buRole = await own.role('BU', ['FILTER_BULK_UPLOAD']);
  bu = await own.user(app, 'bu', buRole);
  bh = await own.user(app, 'bh', await own.role('BH', ['FILTER_BULK_UPLOAD', 'FILTER_HIERARCHY_CREATE']));
  ac = await own.user(app, 'ac', await own.role('AC', ['ASSET_CREATE']));
  rd = await own.user(app, 'rd', await own.role('RD', ['ASSET_READ']));
  await own.reauth(['BULK_UPLOAD_FILTERS'], buRole);
  await own.template('FILTER', { isActive: true });
  blockId = await own.instance('BLOCK', await own.template('BLOCK', { maxConnections: 50 }));
  areaId = await own.instance('AREA', await own.template('AREA', { maxConnections: 50 }), blockId);
  ahuId = await own.instance('AHU', await own.template('AHU', { maxConnections: 50 }), areaId);
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('bulk upload — template download', () => {
  async function headersOf(buf: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    return (wb.getWorksheet('Filters')!.getRow(1).values as any[]).slice(1);
  }

  it('streams an .xlsx whose columns follow the scope: AHU (no hierarchy), area (ahu), block (area + ahu)', async () => {
    const ahu = await bu.call('GET', `/api/assets/instances/filter-upload-template.xlsx?ahuId=${ahuId}`);
    expect(ahu.status).toBe(200);
    expect(ahu.headers['content-type']).toBe(XLSX);
    expect(ahu.headers['content-disposition']).toBe('attachment; filename="filter-upload-template.xlsx"');
    expect(await headersOf(ahu.raw)).toEqual(['name', 'filterSet', 'ahuType', 'filterType', 'micronSize', 'Filter Dimensions', 'lastCleaningDate']);
    const area = await bu.call('GET', `/api/assets/instances/filter-upload-template.xlsx?areaId=${areaId}`);
    expect((await headersOf(area.raw)).slice(0, 2)).toEqual(['name', 'ahu']);
    const block = await bu.call('GET', `/api/assets/instances/filter-upload-template.xlsx?blockId=${blockId}`);
    expect((await headersOf(block.raw)).slice(0, 3)).toEqual(['name', 'area', 'ahu']);
    const emptyBlock = await own.instance('EMPTY-BLOCK', (await prisma.assetInstance.findUnique({ where: { id: blockId } }))!.templateId);
    const empty = await bu.call('GET', `/api/assets/instances/filter-upload-template.xlsx?blockId=${emptyBlock}`);
    expect(empty.status).toBe(200);
  });

  it('needs a scope and an upload permission', async () => {
    const none = await bu.call('GET', '/api/assets/instances/filter-upload-template.xlsx');
    expect(none.status).toBe(400);
    expect(none.body).toEqual({ error: 'VALIDATION', message: 'Pass blockId, areaId or ahuId — the template columns depend on where the upload goes.' });
    const denied = await rd.call('GET', `/api/assets/instances/filter-upload-template.xlsx?ahuId=${ahuId}`);
    expect(denied.status).toBe(403);
  });
});

describe('bulk upload — request checks (validate route)', () => {
  it('answers a missing file, a missing / malformed scope and a non-multipart body with 400', async () => {
    internalErrors.length = 0;
    const file = await workbook(['name', 'filterSet'], [[own.n('V1'), 'A']]);
    const noFile = await send(bu, 'validate', { ahuId });
    expect(noFile.body).toEqual({ error: 'VALIDATION', message: 'An .xlsx file is required' });
    const emptyFile = await send(bu, 'validate', { ahuId }, Buffer.alloc(0));
    expect(emptyFile.body.message).toBe('An .xlsx file is required');
    const noScope = await send(bu, 'validate', { blockId: '  ' }, file);
    expect(noScope.body).toEqual({ error: 'VALIDATION', message: 'blockId, areaId or ahuId is required' });
    const badScope = await send(bu, 'validate', { areaId: 'not-a-uuid' }, file);
    expect(badScope.body).toEqual({ error: 'VALIDATION', message: 'blockId / areaId / ahuId must be a UUID' });
    const json = await bu.call('POST', '/api/assets/instances/bulk-upload-filters/validate', { body: { ahuId } });
    expect(json.status).toBe(400);
    expect(json.body).toEqual({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data' });
    const jsonUpload = await sa.call('POST', '/api/assets/instances/bulk-upload-filters', { body: { ahuId } });
    expect(jsonUpload.body).toEqual({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data' });
    const denied = await send(rd, 'validate', { ahuId }, file);
    expect(denied.status).toBe(403);
    expect(internalErrors).toEqual([]);
  });

  it('dry-runs a file into a per-row preview, applying the dialog-level default set, and writes nothing', async () => {
    const file = await workbook(['name', 'filterSet', 'ahuType'], [
      [own.n('V1'), '', 'process'],
      [own.n('V2'), 'B', ''],
      [own.n('V3'), 'Z', ''],
    ]);
    const res = await send(bu, 'validate', { ahuId, defaultFilterSet: 'set_a', ignored: 'x' }, file);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, created: 0, failed: 1, newAreas: [], newAhus: [] });
    expect(res.body.results).toEqual([
      { row: 2, name: own.n('V1'), status: 'success' },
      { row: 3, name: own.n('V2'), status: 'success' },
      { row: 4, name: own.n('V3'), status: 'error', column: 'filterSet', value: 'Z', error: 'filterSet must be A or B' },
    ]);
    expect(res.body.rows[0]).toMatchObject({ name: own.n('V1'), ahu: own.n('AHU'), ahuStatus: 'existing', area: own.n('AREA'), areaStatus: 'existing' });
    expect(await prisma.filter.count({ where: { name: { in: [own.n('V1'), own.n('V2')] } } })).toBe(0);
    // Without a default, a blank set is an error; 'b' / 'A' spellings are accepted as defaults.
    const noDefault = await send(bu, 'validate', { ahuId, defaultFilterSet: 'C' }, await workbook(['name', 'filterSet'], [[own.n('V4'), '']]));
    expect(noDefault.body.results[0]).toMatchObject({ status: 'error', column: 'filterSet', error: 'filterSet is required — set A or B in the filterSet column' });
    for (const d of ['b', 'A', 'SET_B']) {
      const ok = await send(bu, 'validate', { ahuId, defaultFilterSet: d }, await workbook(['name', 'filterSet'], [[own.n('V5'), '']]));
      expect(ok.body.results[0].status, d).toBe('success');
    }
  });

  it('a file that is not an .xlsx is reported as a row-1 error, not a failure of the request', async () => {
    const res = await send(bu, 'validate', { ahuId }, Buffer.from('this is not a spreadsheet'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, failed: 1, results: [{ row: 1, status: 'error', error: 'Invalid .xlsx file' }] });
  });
});

describe('bulk upload — upload route', () => {
  it('signs before the body is read, then creates every valid row and reports the rest', async () => {
    const file = await workbook(['name', 'filterSet', 'ahuType'], [[own.n('U1'), 'A', 'Process'], [own.n('U2'), 'B', ''], [own.n('U1'), 'A', '']]);
    const noPw = await send(bu, 'upload', { ahuId }, file);
    expect(noPw.status).toBe(401);
    expect(noPw.body.action).toBe('BULK_UPLOAD_FILTERS');
    const res = await send(bu, 'upload', { ahuId }, file, PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, created: 2, failed: 1 });
    expect(res.body.results.find((r: any) => r.row === 4)).toMatchObject({ status: 'error', column: 'name', error: 'Duplicate name in file' });
    const made = await prisma.filter.findMany({ where: { name: { in: [own.n('U1'), own.n('U2')] } }, select: { name: true, ahuId: true } });
    expect(made.map((m) => m.ahuId)).toEqual([ahuId, ahuId]);
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'BULK_FILTER_UPLOAD', targetId: ahuId }, orderBy: { chainPosition: 'desc' } });
    expect(audit!.afterValue).toMatchObject({ scope: 'AHU', count: 2, ahuName: own.n('AHU') });
  });

  it('creating a missing AHU needs hierarchy-create permission: the upload permission alone cannot', async () => {
    const rows = (n: string) => workbook(['name', 'ahu', 'filterSet'], [[own.n(n), own.n(`NEW-AHU-${n}`), 'A']]);
    const noPerm = await send(bu, 'upload', { areaId }, await rows('H1'), PASSWORD);
    expect(noPerm.status).toBe(200);
    expect(noPerm.body.created).toBe(0);
    expect(noPerm.body.results[0].error).toBe(`AHU "${own.n('NEW-AHU-H1')}" does not exist in this block, and you do not have permission to create AHUs. Create it first or ask an administrator.`);
    expect(await prisma.ahu.count({ where: { name: own.n('NEW-AHU-H1') } })).toBe(0);

    const withPerm = await send(bh, 'upload', { areaId }, await rows('H2'));
    expect(withPerm.body).toMatchObject({ created: 1, newAhus: [own.n('NEW-AHU-H2')] });
    expect(await prisma.ahu.findFirst({ where: { name: own.n('NEW-AHU-H2') } })).toMatchObject({ areaId });
    // ASSET_CREATE (the broad create) also counts, through the effective-permission rules.
    const broad = await send(ac, 'validate', { areaId }, await rows('H3'));
    expect(broad.body.newAhus).toEqual([own.n('NEW-AHU-H3')]);
    // SUPER_ADMIN always may.
    const admin = await send(sa, 'validate', { blockId }, await workbook(['name', 'area', 'ahu', 'filterSet'], [[own.n('H4'), own.n('NEW-AREA'), own.n('NEW-AHU-H4'), 'B']]));
    expect(admin.body).toMatchObject({ newAreas: [own.n('NEW-AREA')], newAhus: [own.n('NEW-AHU-H4')] });
  });

  it('refuses a file over the 5 MB multipart limit and creates nothing', async () => {
    const big = Buffer.concat([await workbook(['name', 'filterSet'], [[own.n('BIG'), 'A']]), Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41)]);
    const res = await send(sa, 'upload', { ahuId }, big);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBeUndefined();
    expect(await prisma.filter.count({ where: { name: own.n('BIG') } })).toBe(0);
    const dry = await send(sa, 'validate', { ahuId }, big);
    expect(dry.status).toBeGreaterThanOrEqual(400);
  });
});
