/**
 * Typed hierarchy (/api/hierarchy) through the real harness app and real
 * Prisma on digilog_test_db. The existing hierarchy.routes.test.ts mocks Prisma;
 * this file reads the rows the mirror triggers actually write.
 *
 * Owns one Block with an Area and two AHUs (one in the area, one directly on
 * the block), live and deactivated filters, and asserts only on those rows —
 * never on site-wide totals.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVHY'));
let app: FastifyInstance;
let sa: { id: string; call: Caller };
let hy: { id: string; username: string; call: Caller };
let viewer: { call: Caller };
let hierOnly: { call: Caller };
let blockId: string;
let deadBlock: string;
let a1: string;
let a2Dead: string;
let h1: string;
let h2: string;
let h3Dead: string;
let f1: string;
let f2: string;
let f3: string;
let f4Dead: string;
let fNoDetails: string;
let fpId: string;
let cpId: string;
const seen = new Date('2026-03-04T05:06:07.000Z');

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const hyRole = await own.role('HY', ['ASSET_VIEW', 'FILTER_CREATE', 'FILTER_EDIT', 'FILTER_DELETE']);
  hy = await own.user(app, 'hy', hyRole);
  viewer = await own.user(app, 'vw', await own.role('VW', ['ASSET_READ']));
  hierOnly = await own.user(app, 'hc', await own.role('HC', ['ASSET_VIEW', 'FILTER_HIERARCHY_CREATE', 'FILTER_HIERARCHY_EDIT', 'FILTER_HIERARCHY_DELETE']));
  await own.reauth(['CREATE_FILTER', 'EDIT_FILTER', 'DELETE_FILTER'], hyRole);

  const blockTpl = await own.template('BLOCK');
  const areaTpl = await own.template('AREA');
  const ahuTpl = await own.template('AHU');
  await own.template('FILTER', { isActive: true });
  blockId = await own.instance('BLOCK', blockTpl);
  deadBlock = await own.instance('BLOCK-DEAD', blockTpl, null, { isActive: false });
  a1 = await own.instance('AREA-1', areaTpl, blockId);
  a2Dead = await own.instance('AREA-2-DEAD', areaTpl, blockId, { isActive: false });
  h1 = await own.instance('AHU-1', ahuTpl, a1);
  h2 = await own.instance('AHU-2-DIRECT', ahuTpl, blockId);
  h3Dead = await own.instance('AHU-3-DEAD', ahuTpl, a1, { isActive: false });

  cpId = (await own.cleaningProfile('CP', ['WASH_IN'], sa.id, { status: 'ARCHIVED' })).id;
  fpId = await own.filterProfile('FP', cpId);
  f1 = await own.filter('F1', h1, {}, { attributes: { lastCleaningDate: '2026-01-15', ahuType: 'Process' } });
  f2 = await own.filter('F2', h1, { filterSet: 'SET_B', currentLifecycleState: 'WASH_IN', filterProfileId: fpId });
  f3 = await own.filter('F3', h2);
  f4Dead = await own.filter('F4-DEAD', h1, {}, { isActive: false });
  fNoDetails = randomUUID();
  await prisma.filter.create({ data: { id: fNoDetails, ahuId: h2, name: own.n('F5-NODETAILS'), status: 'Active', attributes: {} } });
  await prisma.assetInstance.update({ where: { id: f1 }, data: { approvalStatus: 'PENDING_REVIEW' } });
  // F2 was last cleaned by a completed cycle.
  await own.cycle(f2, cpId, { status: 'COMPLETED', completedAt: seen });
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name);

describe('hierarchy — blocks', () => {
  it('needs a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hierarchy/blocks' });
    expect(res.statusCode).toBe(401);
  });

  it('lists active blocks; an omitted limit returns every row on one page, an explicit one pages', async () => {
    const all = await viewer.call('GET', '/api/hierarchy/blocks');
    expect(all.status).toBe(200);
    expect(names(all.body.data)).toContain(own.n('BLOCK'));
    expect(names(all.body.data)).not.toContain(own.n('BLOCK-DEAD'));
    expect(all.body).toMatchObject({ page: 1, limit: all.body.total, totalPages: 1 });
    const mine = all.body.data.find((b: any) => b.id === blockId);
    expect(mine).not.toHaveProperty('areas');
    const paged = await viewer.call('GET', '/api/hierarchy/blocks?limit=1&page=2');
    expect(paged.body.data.length).toBeLessThanOrEqual(1);
    expect(paged.body).toMatchObject({ page: 2, limit: 1, totalPages: paged.body.total });
  });

  it('expands areas → ahus → filters, keeping only active rows at every level', async () => {
    const lvl1 = await viewer.call('GET', '/api/hierarchy/blocks?expand=areas');
    expect(names(lvl1.body.data.find((b: any) => b.id === blockId).areas)).toEqual([own.n('AREA-1')]);
    const lvl2 = await viewer.call('GET', '/api/hierarchy/blocks?expand=areas.ahus');
    const area2 = lvl2.body.data.find((b: any) => b.id === blockId).areas[0];
    expect(names(area2.ahus)).toEqual([own.n('AHU-1')]);
    expect(area2.ahus[0]).not.toHaveProperty('filters');
    const lvl3 = await viewer.call('GET', '/api/hierarchy/blocks?expand=areas.ahus.filters');
    const ahu3 = lvl3.body.data.find((b: any) => b.id === blockId).areas[0].ahus[0];
    expect(names(ahu3.filters).sort()).toEqual([own.n('F1'), own.n('F2')]);
  });

  it('gets one active block with any expansion; 404 for a deactivated or unknown block', async () => {
    const plain = await viewer.call('GET', `/api/hierarchy/blocks/${blockId}`);
    expect(plain.status).toBe(200);
    expect(plain.body).toMatchObject({ id: blockId, name: own.n('BLOCK'), isActive: true });
    const deep = await viewer.call('GET', `/api/hierarchy/blocks/${blockId}?expand=areas.ahus.filters`);
    expect(names(deep.body.areas[0].ahus[0].filters).sort()).toEqual([own.n('F1'), own.n('F2')]);
    for (const id of [deadBlock, randomUUID()]) {
      const res = await viewer.call('GET', `/api/hierarchy/blocks/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'NOT_FOUND', message: 'Block not found' });
    }
    const badExpand = await viewer.call('GET', `/api/hierarchy/blocks/${blockId}?expand=everything`);
    expect(badExpand.status).toBe(400);
  });
});

describe('hierarchy — areas and AHUs', () => {
  it('lists the areas of one block, with expansion and paging', async () => {
    const res = await viewer.call('GET', `/api/hierarchy/areas?blockId=${blockId}`);
    expect(res.body).toMatchObject({ total: 1, page: 1, limit: 1, totalPages: 1 });
    expect(res.body.data[0]).toMatchObject({ id: a1, blockId });
    const ahus = await viewer.call('GET', `/api/hierarchy/areas?blockId=${blockId}&expand=ahus`);
    expect(names(ahus.body.data[0].ahus)).toEqual([own.n('AHU-1')]);
    const filters = await viewer.call('GET', `/api/hierarchy/areas?blockId=${blockId}&expand=ahus.filters`);
    expect(names(filters.body.data[0].ahus[0].filters).sort()).toEqual([own.n('F1'), own.n('F2')]);
    const page2 = await viewer.call('GET', `/api/hierarchy/areas?blockId=${blockId}&limit=1&page=2`);
    expect(page2.body).toMatchObject({ data: [], total: 1, totalPages: 1 });
    const empty = await viewer.call('GET', `/api/hierarchy/areas?blockId=${randomUUID()}&limit=5`);
    expect(empty.body).toEqual({ data: [], total: 0, page: 1, limit: 5, totalPages: 0 });
    const site = await viewer.call('GET', '/api/hierarchy/areas');
    expect(names(site.body.data)).toContain(own.n('AREA-1'));
    expect(names(site.body.data)).not.toContain(own.n('AREA-2-DEAD'));
  });

  it('gets one area with or without its AHUs; 404 for a deactivated area', async () => {
    const plain = await viewer.call('GET', `/api/hierarchy/areas/${a1}`);
    expect(plain.body).toMatchObject({ id: a1, blockId });
    expect(plain.body).not.toHaveProperty('ahus');
    const deep = await viewer.call('GET', `/api/hierarchy/areas/${a1}?expand=ahus.filters`);
    expect(names(deep.body.ahus[0].filters).sort()).toEqual([own.n('F1'), own.n('F2')]);
    const shallow = await viewer.call('GET', `/api/hierarchy/areas/${a1}?expand=ahus`);
    expect(names(shallow.body.ahus)).toEqual([own.n('AHU-1')]);
    const dead = await viewer.call('GET', `/api/hierarchy/areas/${a2Dead}`);
    expect(dead.status).toBe(404);
    expect(dead.body.message).toBe('Area not found');
  });

  it('lists AHUs by area (with filters), keeps the direct-on-block AHU\'s blockId, and gets one AHU', async () => {
    const inArea = await viewer.call('GET', `/api/hierarchy/ahus?areaId=${a1}&expand=filters`);
    expect(inArea.body.total).toBe(1);
    expect(inArea.body.data[0]).toMatchObject({ id: h1, areaId: a1, blockId: null });
    expect(names(inArea.body.data[0].filters).sort()).toEqual([own.n('F1'), own.n('F2')]);
    const site = await viewer.call('GET', '/api/hierarchy/ahus?limit=100000');
    const direct = site.body.data.find((h: any) => h.id === h2);
    expect(direct).toMatchObject({ areaId: null, blockId });
    expect(direct).not.toHaveProperty('filters');
    expect(site.body.data.some((h: any) => h.id === h3Dead)).toBe(false);
    const one = await viewer.call('GET', `/api/hierarchy/ahus/${h2}?expand=filters`);
    expect(names(one.body.filters).sort()).toEqual([own.n('F3'), own.n('F5-NODETAILS')]);
    const bare = await viewer.call('GET', `/api/hierarchy/ahus/${h2}`);
    expect(bare.body).not.toHaveProperty('filters');
    const dead = await viewer.call('GET', `/api/hierarchy/ahus/${h3Dead}`);
    expect(dead.status).toBe(404);
    expect(dead.body.message).toBe('AHU not found');
  });
});

describe('hierarchy — filters (read)', () => {
  it('lists an AHU\'s live filters with cycle state, approval status and the derived last-cleaned date', async () => {
    const res = await viewer.call('GET', `/api/hierarchy/filters?ahuId=${h1}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, limit: 2, totalPages: 1 });
    const byName = Object.fromEntries(res.body.data.map((f: any) => [f.name, f]));
    expect(byName[own.n('F1')]).toMatchObject({
      id: f1, ahuId: h1, approvalStatus: 'PENDING_REVIEW', filterSet: null, currentLifecycleState: null, filterProfileId: null, currentCycleId: null,
      lastCleanedAt: '2026-01-15',
    });
    expect(byName[own.n('F2')]).toMatchObject({
      id: f2, approvalStatus: 'APPROVED', filterSet: 'SET_B', currentLifecycleState: 'WASH_IN', filterProfileId: fpId, lastCleanedAt: seen.toISOString(),
    });
    const paged = await viewer.call('GET', `/api/hierarchy/filters?ahuId=${h1}&limit=1&page=2`);
    expect(paged.body).toMatchObject({ total: 2, limit: 1, totalPages: 2 });
    expect(paged.body.data).toHaveLength(1);
    const none = await viewer.call('GET', `/api/hierarchy/filters?ahuId=${randomUUID()}`);
    expect(none.body).toEqual({ data: [], total: 0, page: 1, limit: 0, totalPages: 1 });
  });

  it('a filter with no FilterDetails sidecar reads as nulls, not as missing keys', async () => {
    const res = await viewer.call('GET', `/api/hierarchy/filters/${fNoDetails}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: fNoDetails, filterSet: null, currentLifecycleState: null, currentCycleId: null, filterProfileId: null, approvalStatus: 'APPROVED', lastCleanedAt: null });
    const dead = await viewer.call('GET', `/api/hierarchy/filters/${f4Dead}`);
    expect(dead.status).toBe(404);
    expect(dead.body.message).toBe('Filter not found');
  });

  it('the full tree nests areas → AHUs → filters AND keeps direct-on-block AHUs, with enriched filters', async () => {
    const res = await viewer.call('GET', '/api/hierarchy/tree');
    expect(res.status).toBe(200);
    const block = res.body.find((b: any) => b.id === blockId);
    expect(names(block.areas)).toEqual([own.n('AREA-1')]);
    expect(names(block.areas[0].ahus)).toEqual([own.n('AHU-1')]);
    const f2Row = block.areas[0].ahus[0].filters.find((f: any) => f.id === f2);
    expect(f2Row).toMatchObject({ filterSet: 'SET_B', currentLifecycleState: 'WASH_IN', lastCleanedAt: seen.toISOString() });
    expect(names(block.ahus)).toEqual([own.n('AHU-2-DIRECT')]);
    expect(names(block.ahus[0].filters)).toEqual([own.n('F3'), own.n('F5-NODETAILS')]);
    expect(res.body.some((b: any) => b.id === deadBlock)).toBe(false);
  });
});

let created: string;

describe('hierarchy — filters (write)', () => {
  it('create is refused to a role holding only the hierarchy toggle, and asks for the password when configured', async () => {
    const body = { name: own.n('NEW'), ahuId: h1 };
    expect((await hierOnly.call('POST', '/api/hierarchy/filters', { body })).status).toBe(403);
    const noPw = await hy.call('POST', '/api/hierarchy/filters', { body });
    expect(noPw.status).toBe(401);
    expect(noPw.body.error).toBe('REAUTH_REQUIRED');
    expect(await prisma.filter.count({ where: { name: own.n('NEW') } })).toBe(0);
  });

  it('creates a typed filter (canonicalised field values, Set A, profile) mirrored into asset_instances, and audits it', async () => {
    const res = await hy.call('POST', '/api/hierarchy/filters', {
      pw: PASSWORD,
      body: { name: `  ${own.n('NEW')}  `, ahuId: h1, filterSet: 'A', ahuType: 'non process', filterSize: ' 610×610×292mm ', lastCleaningDate: '2026-02-01', filterProfileId: fpId },
    });
    expect(res.status).toBe(201);
    created = res.body.data.id;
    expect(res.body.data).toMatchObject({ name: own.n('NEW'), ahuId: h1, status: 'Active', createdBy: hy.username, attributes: { ahuType: 'Non Process', filterSize: '610×610×292mm', lastCleaningDate: '2026-02-01' } });
    const mirror = await prisma.assetInstance.findUnique({ where: { id: created }, include: { filterDetails: true } });
    expect(mirror).toMatchObject({ parentId: h1, isActive: true, approvalStatus: 'APPROVED', submittedBy: null });
    expect(mirror!.filterDetails).toMatchObject({ filterSet: 'SET_A', filterProfileId: fpId });
    const [audit] = await auditFor(created, 'ASSET_CREATED');
    expect(audit.afterValue).toEqual({ name: own.n('NEW'), ahuId: h1, filterSet: 'SET_A', kind: 'FILTER' });
    const read = await viewer.call('GET', `/api/hierarchy/filters/${created}`);
    expect(read.body).toMatchObject({ filterSet: 'SET_A', lastCleanedAt: '2026-02-01' });
  });

  it('refuses a missing / deactivated AHU, a taken name, a blank name and invalid field values (400, nothing written)', async () => {
    internalErrors.length = 0;
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: own.n('X1'), ahuId: randomUUID() }, 'AHU not found'],
      [{ name: own.n('X1'), ahuId: h3Dead }, 'Parent entity is deactivated and cannot receive children'],
      [{ name: own.n('new').toLowerCase(), ahuId: h1 }, `A filter with the name "${own.n('new').toLowerCase()}" already exists`],
      [{ name: '   ', ahuId: h1 }, 'Filter Name is required'],
    ];
    for (const [body, message] of cases) {
      const res = await sa.call('POST', '/api/hierarchy/filters', { body });
      expect(res.status, message).toBe(400);
      expect(res.body.message).toBe(message);
    }
    const fields = await sa.call('POST', '/api/hierarchy/filters', { body: { name: own.n('X2'), ahuId: h1, ahuType: 'Bogus', lastCleaningDate: '2026-02-30' } });
    expect(fields.status).toBe(400);
    expect(fields.body.message).toBe('One or more filter fields are invalid');
    expect(fields.body.details).toEqual([
      { field: 'ahuType', value: 'Bogus', message: 'must be one of: Process, Non Process' },
      { field: 'lastCleaningDate', value: '2026-02-30', message: 'must be a date (YYYY-MM-DD) or NA' },
    ]);
    const badSet = await sa.call('POST', '/api/hierarchy/filters', { body: { name: own.n('X3'), ahuId: h1, filterSet: 'C' } });
    expect(badSet.status).toBe(400);
    expect(await prisma.filter.count({ where: { name: { in: [own.n('X1'), own.n('X2'), own.n('X3')] } } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });

  it('update overlays sent fields, clears a field sent blank, sets Set B and audits; refuses unknown / retired / taken names', async () => {
    const noPw = await hy.call('PUT', `/api/hierarchy/filters/${created}`, { body: { filterSet: 'B' } });
    expect(noPw.status).toBe(401);
    const res = await hy.call('PUT', `/api/hierarchy/filters/${created}`, { pw: PASSWORD, body: { name: own.n('NEW-2'), ahuType: '', filterSet: 'B' } });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(own.n('NEW-2'));
    expect(res.body.data.attributes).toEqual({ filterSize: '610×610×292mm', lastCleaningDate: '2026-02-01' });
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: created } }))!.filterSet).toBe('SET_B');
    const [audit] = await auditFor(created, 'ASSET_UPDATED');
    expect(audit.beforeValue).toMatchObject({ name: own.n('NEW'), filterSet: 'SET_A' });
    expect(audit.afterValue).toMatchObject({ name: own.n('NEW-2'), filterSet: 'SET_B', attributes: { filterSize: '610×610×292mm', lastCleaningDate: '2026-02-01' } });

    const unknown = await sa.call('PUT', `/api/hierarchy/filters/${randomUUID()}`, { body: { name: 'x' } });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: 'NOT_FOUND', message: 'Filter not found' });
    const retired = await sa.call('PUT', `/api/hierarchy/filters/${f4Dead}`, { body: { name: own.n('ZZ') } });
    expect(retired.status).toBe(409);
    expect(retired.body.error).toBe('FILTER_INACTIVE');
    const taken = await sa.call('PUT', `/api/hierarchy/filters/${created}`, { body: { name: own.n('F3') } });
    expect(taken.status).toBe(400);
    expect(taken.body.message).toBe(`A filter with the name "${own.n('F3')}" already exists`);
    const blank = await sa.call('PUT', `/api/hierarchy/filters/${created}`, { body: { name: '  ' } });
    expect(blank.body.message).toBe('Filter Name is required');
    const badField = await sa.call('PUT', `/api/hierarchy/filters/${created}`, { body: { lastCleaningDate: 'yesterday' } });
    expect(badField.status).toBe(400);
  });

  it('delete refuses while the filter is mid-cycle, ignores a stale pointer at a finished cycle, and cascades the RFID tag with audit rows', async () => {
    const live = await own.cycle(created, cpId);
    await prisma.filterDetails.update({ where: { assetInstanceId: created }, data: { currentCycleId: live } });
    const blocked = await sa.call('DELETE', `/api/hierarchy/filters/${created}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('FILTER_CYCLE_IN_PROGRESS');
    expect(blocked.body.message).toContain(own.n('NEW-2'));
    await prisma.cleaningCycle.update({ where: { id: live }, data: { status: 'COMPLETED', completedAt: new Date() } });

    const tag = await prisma.assetIdentifier.create({ data: { assetId: created, identifierType: 'RFID', identifierValue: own.n('TAG-1') } });
    const noPw = await hy.call('DELETE', `/api/hierarchy/filters/${created}`);
    expect(noPw.status).toBe(401);
    const res = await hy.call('DELETE', `/api/hierarchy/filters/${created}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect((await prisma.filter.findUnique({ where: { id: created } }))!.isActive).toBe(false);
    expect((await prisma.assetInstance.findUnique({ where: { id: created } }))!.isActive).toBe(false);
    expect(await prisma.assetIdentifier.count({ where: { id: tag.id } })).toBe(0);
    const [identAudit] = await auditFor(tag.id, 'ASSET_IDENTIFIER_DELETED');
    expect(identAudit.beforeValue).toEqual({ assetId: created, identifierType: 'RFID', identifierValue: own.n('TAG-1'), filterName: own.n('NEW-2') });
    expect(identAudit.reason).toBe(`Cascade: Filter "${own.n('NEW-2')}" deleted`);
    const [del] = await auditFor(created, 'ASSET_DELETED');
    expect(del.afterValue).toEqual({ isActive: false, templateKind: 'FILTER' });
    // A filter with no sidecar at all deletes too.
    const plain = await sa.call('DELETE', `/api/hierarchy/filters/${fNoDetails}`);
    expect(plain.status).toBe(200);
  });

  it('deleting a filter that does not exist is 404, like editing one', async () => {
    internalErrors.length = 0;
    const res = await sa.call('DELETE', `/api/hierarchy/filters/${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'NOT_FOUND', message: 'Filter not found' });
    expect(internalErrors).toEqual([]);
  });
});
