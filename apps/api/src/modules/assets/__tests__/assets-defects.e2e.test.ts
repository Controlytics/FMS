/**
 * Regression tests for the asset-module defects found by the 2026-10-21
 * coverage pass (D2, D3, D4, D7, D8, D9). Each was confirmed failing before
 * its fix. Real harness app + real Prisma on digilog_test_db; owns its rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, auditFor, type Caller } from './slice-support.js';

const own = new SliceOwner(runTag('CVDA'));
let app: FastifyInstance;
let sa: { call: Caller };
let ahuId: string;
let filterTpl: string;
let otherTpl: string;

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  filterTpl = await own.template('FILTER', { isActive: true });
  otherTpl = await own.template('OTHER');
  const blockId = await own.instance('BLOCK', await own.template('BLOCK', { maxConnections: 50 }));
  ahuId = await own.instance('AHU', await own.template('AHU', { maxConnections: 50 }), blockId);
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

function multipart(fields: Record<string, string>, file: Buffer) {
  const b = `----cvda${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="u.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
async function sheet(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Filters');
  ws.addRow(['name', 'filterSet', 'lastCleaningDate']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('D8 — an impossible lastCleaningDate is a 400 naming the field on every path, never a 500', () => {
  const impossible = ['2026-13-01', '2026-00-10', '2026-12-32', '2026-04-31'];

  it('typed create and update', async () => {
    internalErrors.length = 0;
    const fid = await own.filter('D8-F', ahuId);
    for (const date of impossible) {
      const create = await sa.call('POST', '/api/hierarchy/filters', { body: { name: own.n(`D8-${date}`), ahuId, lastCleaningDate: date } });
      expect(create.status, date).toBe(400);
      expect(create.body).toMatchObject({ error: 'VALIDATION_ERROR', details: [{ field: 'lastCleaningDate', value: date, message: 'must be a date (YYYY-MM-DD) or NA' }] });
      const update = await sa.call('PUT', `/api/hierarchy/filters/${fid}`, { body: { lastCleaningDate: date } });
      expect(update.status, date).toBe(400);
      expect(update.body.details).toEqual([{ field: 'lastCleaningDate', value: date, message: 'must be a date (YYYY-MM-DD) or NA' }]);
    }
    expect(internalErrors).toEqual([]);
    expect(await prisma.filter.count({ where: { name: { startsWith: own.n('D8-2026') } } })).toBe(0);
  });

  it('the generic instance edit of a filter', async () => {
    internalErrors.length = 0;
    const fid = await own.filter('D8-G', ahuId);
    const res = await sa.call('PUT', `/api/assets/instances/${fid}`, { body: { attributes: { lastCleaningDate: '2026-13-01' } } });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([{ field: 'lastCleaningDate', value: '2026-13-01', message: 'must be a date (YYYY-MM-DD) or NA' }]);
    expect(internalErrors).toEqual([]);
  });

  it('bulk upload validate reports it as a row error', async () => {
    const mp = multipart({ ahuId }, await sheet([[own.n('D8-B1'), 'A', '2026-13-01'], [own.n('D8-B2'), 'A', '2026-02-28']]));
    const res = await sa.call('POST', '/api/assets/instances/bulk-upload-filters/validate', mp);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { row: 2, name: own.n('D8-B1'), status: 'error', column: 'lastCleaningDate', value: '2026-13-01', error: 'must be a date (YYYY-MM-DD) or NA' },
      { row: 3, name: own.n('D8-B2'), status: 'success' },
    ]);
  });

  it('a real date and NA are still accepted', async () => {
    const res = await sa.call('POST', '/api/hierarchy/filters', { body: { name: own.n('D8-OK'), ahuId, lastCleaningDate: '2024-02-29' } });
    expect(res.status).toBe(201);
    expect(res.body.data.attributes).toEqual({ lastCleaningDate: '2024-02-29' });
    const na = await sa.call('PUT', `/api/hierarchy/filters/${res.body.data.id}`, { body: { lastCleaningDate: 'na' } });
    expect(na.body.data.attributes).toEqual({ lastCleaningDate: 'NA' });
  });
});

describe('D7 — a file over the multipart limit is 413 FILE_TOO_LARGE on both bulk-upload routes', () => {
  it('upload and validate', async () => {
    internalErrors.length = 0;
    const big = Buffer.concat([await sheet([[own.n('D7-1'), 'A', '']]), Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41)]);
    for (const url of ['/api/assets/instances/bulk-upload-filters', '/api/assets/instances/bulk-upload-filters/validate']) {
      const res = await sa.call('POST', url, multipart({ ahuId }, big));
      expect(res.status, url).toBe(413);
      expect(res.body, url).toEqual({ error: 'FILE_TOO_LARGE', message: 'Upload exceeds the maximum file size (5 MB).' });
    }
    expect(await prisma.filter.count({ where: { name: own.n('D7-1') } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });
});

describe('D4 — PUT /instances stores a status exactly as the lifecycle guard compares it', () => {
  it('a filter: padding is not a change, nothing padded is stored, and the correct value is accepted afterwards', async () => {
    const created = await sa.call('POST', '/api/assets/instances', { body: { name: own.n('D4-F'), templateId: filterTpl, parentId: ahuId } });
    const id = created.body.data.id;
    const res = await sa.call('PUT', `/api/assets/instances/${id}`, { body: { status: ' Active ' } });
    expect(res.status).toBe(200);
    expect((await prisma.assetInstance.findUnique({ where: { id } }))!.status).toBe('Active');
    expect((await prisma.filter.findUnique({ where: { id } }))!.status).toBe('Active');
    const [audit] = await auditFor(id, 'ASSET_UPDATED');
    expect(audit.reason).toBe('FILTER updated');
    const patch = await sa.call('PATCH', `/api/assets/instances/${id}/status`, { body: { status: 'Active' } });
    expect(patch.status).toBe(200);
  });

  it('a non-filter: the status is trimmed, and a blank one is refused like PATCH /status', async () => {
    const created = await sa.call('POST', '/api/assets/instances', { body: { name: own.n('D4-O'), templateId: otherTpl } });
    const id = created.body.data.id;
    const res = await sa.call('PUT', `/api/assets/instances/${id}`, { body: { status: '  Spare  ' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Spare');
    expect((await auditFor(id, 'ASSET_UPDATED'))[0].reason).toBe('Status: "Active" → "Spare"');
    const blank = await sa.call('PUT', `/api/assets/instances/${id}`, { body: { status: '   ' } });
    expect(blank.status).toBe(400);
    expect(blank.body).toMatchObject({ error: 'VALIDATION_ERROR', message: 'Status is required and must be a non-empty string' });
    expect((await prisma.assetInstance.findUnique({ where: { id } }))!.status).toBe('Spare');
  });
});

describe('D9 — PUT/POST /instances store a name exactly as the duplicate check compares it', () => {
  it('a padded name is stored trimmed on create and on rename, so it cannot shadow an existing name', async () => {
    const created = await sa.call('POST', '/api/assets/instances', { body: { name: `  ${own.n('D9-A')}  `, templateId: otherTpl } });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe(own.n('D9-A'));
    const twin = await sa.call('POST', '/api/assets/instances', { body: { name: own.n('D9-A'), templateId: otherTpl } });
    expect(twin.status).toBe(400);
    const other = await sa.call('POST', '/api/assets/instances', { body: { name: own.n('D9-B'), templateId: otherTpl } });
    const renamed = await sa.call('PUT', `/api/assets/instances/${other.body.data.id}`, { body: { name: ` ${own.n('D9-C')} ` } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe(own.n('D9-C'));
    const blank = await sa.call('PUT', `/api/assets/instances/${other.body.data.id}`, { body: { name: '   ' } });
    expect(blank.status).toBe(400);
    expect((await prisma.assetInstance.findUnique({ where: { id: other.body.data.id } }))!.name).toBe(own.n('D9-C'));
  });
});

describe('D2 — deleting a filter that does not exist is 404', () => {
  it('DELETE /api/hierarchy/filters/:unknown', async () => {
    const res = await sa.call('DELETE', `/api/hierarchy/filters/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'NOT_FOUND', message: 'Filter not found' });
  });
});

describe('D3 — DELETE /api/assets/identifiers/:id needs no request body', () => {
  it('no body + ?reason=, an empty JSON body, and a body reason all work', async () => {
    const tags: string[] = [];
    for (const k of ['Q', 'E', 'B']) {
      const fid = await own.filter(`D3-${k}`, ahuId);
      tags.push((await prisma.assetIdentifier.create({ data: { assetId: fid, identifierType: 'RFID', identifierValue: `${own.tag}D3${k}` } })).id);
    }
    const noBody = await sa.call('DELETE', `/api/assets/identifiers/${tags[0]}?reason=tag%20lost`);
    expect(noBody.status).toBe(200);
    expect(noBody.body).toEqual({ success: true });
    expect((await auditFor(tags[0], 'ASSET_IDENTIFIER_DELETED'))[0].reason).toBe('tag lost');
    const empty = await sa.call('DELETE', `/api/assets/identifiers/${tags[1]}`, { body: {} });
    expect(empty.status).toBe(200);
    expect((await auditFor(tags[1], 'ASSET_IDENTIFIER_DELETED'))[0].reason).toBeNull();
    const bodyReason = await sa.call('DELETE', `/api/assets/identifiers/${tags[2]}?reason=ignored`, { body: { reason: 'damaged' } });
    expect(bodyReason.status).toBe(200);
    expect((await auditFor(tags[2], 'ASSET_IDENTIFIER_DELETED'))[0].reason).toBe('damaged');
    const missing = await sa.call('DELETE', `/api/assets/identifiers/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});
