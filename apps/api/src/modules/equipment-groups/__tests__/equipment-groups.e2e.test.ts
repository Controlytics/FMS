/**
 * Equipment groups — every route through the real harness app, plus the
 * instrument auto-fetch path end to end.
 *
 * The auto-fetch is SSRF-guarded: loopback and link-local are refused, private
 * LAN is allowed (instruments live there). So the fake instrument below listens
 * on this PC's LAN IPv4 address, found at runtime (it changes), and the server
 * fetches it for real — no fetch mock. If the machine has no LAN IPv4 the
 * auto-fetch describe is skipped and says so.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, instruments, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVEG'));
let app: FastifyInstance;
let sa: { id: string; call: Caller };
let eg: { id: string; call: Caller };
let reader: { call: Caller };
let none: { call: Caller };
let block1: string;
let block2: string;
let block3: string;
let ahuId: string;
let fA: string;
let fB: string;
let cpId: string;

const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
let server: http.Server | undefined;
let base = '';
let deadPort = 0;

function startInstrumentServer(): Promise<void> {
  server = http.createServer((req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    switch (req.url) {
      case '/ok': return json(200, { reading: { air: 6.2, ro: 4.1, temp: 65, label: 'not-a-number' } });
      case '/flat': return json(200, { air: 1.5, temp: 70 });
      case '/array': return json(200, [1, 2, 3]);
      case '/scalar': return json(200, 42);
      case '/500': return json(500, { error: 'boom' });
      case '/notjson': res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('hello');
      case '/empty': res.writeHead(204); return res.end();
      case '/redirect': res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end();
      case '/big-declared': {
        const body = 'x'.repeat(70 * 1024);
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length) });
        return res.end(body);
      }
      case '/big-stream': {
        res.writeHead(200, { 'content-type': 'application/json' }); // chunked, no content-length
        const chunk = 'y'.repeat(1024);
        for (let i = 0; i < 70; i++) res.write(chunk);
        return res.end();
      }
      case '/slow': setTimeout(() => json(200, { reading: { air: 1 } }), 6_500); return undefined;
      default: return json(404, {});
    }
  });
  return new Promise((resolve) => server!.listen(0, lanIp, () => {
    base = `http://${lanIp}:${(server!.address() as AddressInfo).port}`;
    resolve();
  }));
}

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const egRole = await own.role('EG', ['EG_VIEW', 'EG_CREATE', 'EG_EDIT', 'EG_DELETE', 'FILTER_OPERATE']);
  eg = await own.user(app, 'eg', egRole);
  reader = await own.user(app, 'rd', await own.role('RD', ['ASSET_READ']));
  none = await own.user(app, 'none', await own.role('NONE', ['FP_READ']));
  await own.reauth(['CREATE_EQUIPMENT_GROUP', 'UPDATE_EQUIPMENT_GROUP', 'DELETE_EQUIPMENT_GROUP'], egRole);

  const blockTpl = await own.template('BLOCK');
  await own.template('FILTER', { isActive: true });
  block1 = await own.instance('BLOCK-1', blockTpl);
  block2 = await own.instance('BLOCK-2', blockTpl);
  block3 = await own.instance('BLOCK-3', blockTpl);
  ahuId = await own.instance('AHU', await own.template('AHU'), block1);
  fA = await own.filter('FA', ahuId);
  fB = await own.filter('FB', ahuId);
  // ARCHIVED: cycles need a profile FK, and an ACTIVE one would become every
  // other suite's fallback default on this shared database.
  cpId = (await own.cleaningProfile('CP', ['WASH_IN'], sa.id, { status: 'ARCHIVED' })).id;
  if (lanIp) await startInstrumentServer();
  // A port that was just free and is now closed: connection refused.
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, lanIp ?? '127.0.0.1', () => r()));
  deadPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await own.cleanup();
  await app?.close();
}, 60_000);

const createBody = (name: string, blockId: string, extra: Record<string, unknown> = {}) => ({ name, blockId, instruments: instruments(), ...extra });

describe('equipment-groups — create validation', () => {
  it('refuses a caller without any equipment permission', async () => {
    const res = await none.call('GET', '/api/equipment-groups');
    expect(res.status).toBe(403);
  });

  it('answers each instrument rule with its own message and writes nothing', async () => {
    internalErrors.length = 0;
    const cases: Array<[Array<Record<string, unknown>>, string]> = [
      [[{ instrumentId: '   ' }], 'Instrument 1 (Compressed Air Pressure): Instrument ID is required'],
      [[{}, { uom: ' ' }], 'Instrument 2 (RO Water Pressure): UOM is required'],
      [[{}, {}, { leastCount: 0 }], 'Instrument 3 (Dryer Temperature): Least Count must be greater than 0'],
      [[{ instrumentMin: 10, instrumentMax: 10 }], 'Instrument 1 (Compressed Air Pressure): Instrument Min must be less than Max'],
      [[{ operatingMin: -1 }], 'Instrument 1 (Compressed Air Pressure): Operating Min must be within Instrument range (0–10)'],
      [[{ operatingMin: 11 }], 'Instrument 1 (Compressed Air Pressure): Operating Min must be within Instrument range (0–10)'],
      [[{ operatingMax: 12 }], 'Instrument 1 (Compressed Air Pressure): Operating Max must be within Instrument range (0–10)'],
      [[{ operatingMax: -2 }], 'Instrument 1 (Compressed Air Pressure): Operating Max must be within Instrument range (0–10)'],
      [[{ operatingMin: 5, operatingMax: 5 }], 'Instrument 1 (Compressed Air Pressure): Operating Min must be less than Operating Max'],
    ];
    for (const [over, message] of cases) {
      const res = await sa.call('POST', '/api/equipment-groups', { body: { name: own.n('BAD'), blockId: block1, instruments: instruments(over) } });
      expect(res.status, message).toBe(400);
      expect(res.body).toMatchObject({ error: 'VALIDATION', message });
    }
    const blank = await sa.call('POST', '/api/equipment-groups', { body: createBody('   ', block1) });
    expect(blank.body).toMatchObject({ error: 'VALIDATION', message: 'Group name is required' });
    const badUrl = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('BAD'), block1, { readingUrl: 'not a url' }) });
    expect(badUrl.body).toMatchObject({ error: 'VALIDATION', message: 'Reading URL is not a valid URL' });
    const ftp = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('BAD'), block1, { readingUrl: 'ftp://10.0.0.1/x' }) });
    expect(ftp.body).toMatchObject({ error: 'VALIDATION', message: 'Reading URL must use http or https' });
    const noBlock = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('BAD'), randomUUID()) });
    expect(noBlock.status).toBe(404);
    expect(noBlock.body.message).toBe('Block not found');
    const two = await sa.call('POST', '/api/equipment-groups', { body: { name: own.n('BAD'), blockId: block1, instruments: instruments().slice(0, 2) } });
    expect(two.status).toBe(400);
    expect(two.body.error).toBe('VALIDATION_ERROR');
    expect(await prisma.equipmentGroup.count({ where: { name: own.n('BAD') } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });

  it('asks for the password when re-auth is configured, and creates nothing without it', async () => {
    const res = await eg.call('POST', '/api/equipment-groups', { body: createBody(own.n('NOPW'), block1) });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_EQUIPMENT_GROUP' });
    expect(await prisma.equipmentGroup.count({ where: { name: own.n('NOPW') } })).toBe(0);
  });
});

let g1: string;
let g2: string;

describe('equipment-groups — create, read, update, versions', () => {
  it('creates an active group with three instruments; auto-fetch only where the group has a URL AND the instrument a key', async () => {
    const res = await eg.call('POST', '/api/equipment-groups', {
      pw: PASSWORD,
      body: {
        name: `  ${own.n('G1')}  `, blockId: block1, readingUrl: `  ${base || 'http://10.0.0.1'}/ok  `,
        instruments: instruments([{ responseKey: ' air ', serialNumber: '  SN-1 ' }, { responseKey: 'missing_key' }, { responseKey: '', serialNumber: undefined }]),
      },
    });
    expect(res.status).toBe(201);
    g1 = res.body.id;
    expect(res.body).toMatchObject({ name: own.n('G1'), blockId: block1, isActive: true, version: 1, createdBy: eg.id, readingUrl: `${base || 'http://10.0.0.1'}/ok` });
    expect(res.body.instruments.map((i: any) => [i.description, i.stageKey, i.sortOrder, i.responseKey, i.autoFetchEnabled, i.serialNumber])).toEqual([
      ['Compressed Air Pressure', 'WASH_IN', 1, 'air', true, 'SN-1'],
      ['RO Water Pressure', 'WASH_IN', 2, 'missing_key', true, 'SN-RO'],
      ['Dryer Temperature', 'DRY_IN', 3, null, false, ''],
    ]);
    const [audit] = await auditFor(g1, 'EQUIPMENT_GROUP_CREATED');
    expect(audit.afterValue).toEqual({ name: own.n('G1'), blockId: block1 });

    const noUrl = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('G2'), block1, { instruments: instruments([{ responseKey: 'air' }]) }) });
    expect(noUrl.status).toBe(201);
    g2 = noUrl.body.id;
    expect(noUrl.body.readingUrl).toBeNull();
    expect(noUrl.body.instruments.every((i: any) => i.autoFetchEnabled === false)).toBe(true);
  });

  it('lists active groups (optionally by block / including inactive), gets one by id, and lists a block\'s groups by name', async () => {
    const dead = await prisma.equipmentGroup.create({ data: { name: own.n('G-DEAD'), blockId: block1, isActive: false } });
    const active = await reader.call('GET', `/api/equipment-groups?blockId=${block1}`);
    expect(active.status).toBe(200);
    expect(active.body.map((g: any) => g.id).sort()).toEqual([g1, g2].sort());
    expect(active.body.find((g: any) => g.id === g1).block).toEqual({ id: block1, name: own.n('BLOCK-1') });
    const all = await reader.call('GET', `/api/equipment-groups?blockId=${block1}&includeInactive=true`);
    expect(all.body.map((g: any) => g.id).sort()).toEqual([g1, g2, dead.id].sort());
    const site = await reader.call('GET', '/api/equipment-groups');
    expect(site.body.some((g: any) => g.id === g1)).toBe(true);
    expect(site.body.some((g: any) => g.id === dead.id)).toBe(false);

    const one = await reader.call('GET', `/api/equipment-groups/${g1}`);
    expect(one.status).toBe(200);
    expect(one.body.instruments).toHaveLength(3);
    const missing = await reader.call('GET', `/api/equipment-groups/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Equipment group not found');

    const byBlock = await reader.call('GET', `/api/equipment-groups/by-block/${block1}`);
    expect(byBlock.body.map((g: any) => g.name)).toEqual([own.n('G1'), own.n('G2')]);
  });

  it('update freezes the outgoing composite, bumps the version and audits; the version endpoints serve the snapshot', async () => {
    const noPw = await eg.call('PUT', `/api/equipment-groups/${g1}`, { body: { instruments: instruments() } });
    expect(noPw.status).toBe(401);
    const res = await eg.call('PUT', `/api/equipment-groups/${g1}`, {
      pw: PASSWORD,
      body: { name: own.n('G1-renamed'), readingUrl: `${base || 'http://10.0.0.1'}/flat`, instruments: instruments([{ responseKey: 'air', operatingMax: 9 }, {}, { responseKey: 'temp' }]), changeNotes: 'moved to flat endpoint' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: own.n('G1-renamed'), version: 2, readingUrl: `${base || 'http://10.0.0.1'}/flat` });
    expect(res.body.instruments.map((i: any) => [i.responseKey, i.autoFetchEnabled, i.operatingMax])).toEqual([['air', true, 9], [null, false, 6], ['temp', true, 90]]);

    const versions = await reader.call('GET', `/api/equipment-groups/${g1}/versions`);
    expect(versions.body).toMatchObject({ groupId: g1, currentVersion: 2 });
    expect(versions.body.versions).toHaveLength(1);
    expect(versions.body.versions[0]).toMatchObject({ versionNumber: 1, createdBy: eg.id, changeNotes: 'moved to flat endpoint' });
    const v1 = await reader.call('GET', `/api/equipment-groups/${g1}/versions/1`);
    expect(v1.body).toMatchObject({ groupId: g1, versionNumber: 1, name: own.n('G1'), blockId: block1, isActive: true, readingUrl: `${base || 'http://10.0.0.1'}/ok` });
    expect(v1.body.instruments.map((i: any) => [i.responseKey, i.autoFetchEnabled, i.operatingMax])).toEqual([['air', true, 8], ['missing_key', true, 6], [null, false, 90]]);

    const [audit] = await auditFor(g1, 'EQUIPMENT_GROUP_UPDATED');
    expect(audit.beforeValue).toEqual({ name: own.n('G1'), version: 1 });
    expect(audit.afterValue).toEqual({ name: own.n('G1-renamed'), version: 2 });
  });

  it('update keeps the name when it is omitted or unchanged, and an omitted readingUrl switches auto-fetch off', async () => {
    const same = await sa.call('PUT', `/api/equipment-groups/${g2}`, { body: { name: own.n('G2'), instruments: instruments() } });
    expect(same.status).toBe(200);
    expect(same.body).toMatchObject({ name: own.n('G2'), version: 2 });
    const omitted = await sa.call('PUT', `/api/equipment-groups/${g2}`, { body: { instruments: instruments([{ responseKey: 'air' }]) } });
    expect(omitted.body).toMatchObject({ name: own.n('G2'), version: 3, readingUrl: null });
    expect(omitted.body.instruments[0]).toMatchObject({ responseKey: 'air', autoFetchEnabled: false });
    const [audit] = await auditFor(g2, 'EQUIPMENT_GROUP_UPDATED');
    expect(audit.afterValue).toEqual({ name: own.n('G2'), version: 3 });
  });

  it('update refuses an unknown group and invalid input without bumping the version', async () => {
    const missing = await sa.call('PUT', `/api/equipment-groups/${randomUUID()}`, { body: { instruments: instruments() } });
    expect(missing.status).toBe(404);
    const bad = await sa.call('PUT', `/api/equipment-groups/${g2}`, { body: { instruments: instruments([{}, {}, { leastCount: -1 }]) } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Instrument 3 (Dryer Temperature): Least Count must be greater than 0');
    const badUrl = await sa.call('PUT', `/api/equipment-groups/${g2}`, { body: { readingUrl: 'javascript:alert(1)', instruments: instruments() } });
    expect(badUrl.status).toBe(400);
    expect((await prisma.equipmentGroup.findUnique({ where: { id: g2 } }))!.version).toBe(3);
  });

  it('version endpoints 404 an unknown group or version', async () => {
    const ghost = await reader.call('GET', `/api/equipment-groups/${randomUUID()}/versions`);
    expect(ghost.status).toBe(404);
    const noVer = await reader.call('GET', `/api/equipment-groups/${g1}/versions/7`);
    expect(noVer.status).toBe(404);
    expect(noVer.body.message).toBe(`Version 7 of equipment group ${g1} not found`);
  });
});

describe('equipment-groups — delete (soft) guards', () => {
  it('refuses while a cycle bound to the group is in progress', async () => {
    const cycle = await own.cycle(fA, cpId, { equipmentGroupId: g2, cleaningAreaId: block1 });
    const res = await eg.call('DELETE', `/api/equipment-groups/${g2}`, { pw: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'IN_USE', message: 'Cannot delete: equipment group is used by active cleaning cycles' });
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { status: 'COMPLETED', completedAt: new Date() } });
  });

  it('refuses to remove a block\'s LAST active group while unbound in-progress cycles depend on it; allows it once another group is active', async () => {
    const solo = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('G3'), block3) });
    const g3 = solo.body.id;
    const cycle = await own.cycle(fB, cpId, { cleaningAreaId: block3 });
    const blocked = await sa.call('DELETE', `/api/equipment-groups/${g3}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Cannot delete: this is the last active equipment group for this block and 1 in-progress cycle(s) have not yet bound a group — they would be unable to advance.');
    expect((await prisma.equipmentGroup.findUnique({ where: { id: g3 } }))!.isActive).toBe(true);

    const other = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('G4'), block3) });
    const ok = await sa.call('DELETE', `/api/equipment-groups/${g3}`);
    expect(ok.status).toBe(200);
    expect((await prisma.equipmentGroup.findUnique({ where: { id: g3 } }))!.isActive).toBe(false);
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { status: 'COMPLETED', completedAt: new Date() } });
    // Last group, nothing depending on it: allowed.
    const last = await sa.call('DELETE', `/api/equipment-groups/${other.body.id}`);
    expect(last.status).toBe(200);
  });

  it('deletes (deactivates) with the password and audits; an already-inactive group deletes again; unknown is 404', async () => {
    const noPw = await eg.call('DELETE', `/api/equipment-groups/${g2}`);
    expect(noPw.status).toBe(401);
    const res = await eg.call('DELETE', `/api/equipment-groups/${g2}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect((await prisma.equipmentGroup.findUnique({ where: { id: g2 } }))!.isActive).toBe(false);
    const [audit] = await auditFor(g2, 'EQUIPMENT_GROUP_DELETED');
    expect(audit.afterValue).toEqual({ name: own.n('G2') });
    const again = await sa.call('DELETE', `/api/equipment-groups/${g2}`);
    expect(again.status).toBe(200);
    const missing = await sa.call('DELETE', `/api/equipment-groups/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});

describe.skipIf(!lanIp)('equipment-groups — instrument auto-fetch through a real LAN endpoint', () => {
  const test = (url: string) => eg.call('POST', '/api/equipment-groups/test-url', { body: { url } });

  it('test-url returns the flat numeric reading object (with or without a `reading` wrapper)', async () => {
    const wrapped = await test(`${base}/ok`);
    expect(wrapped.status).toBe(200);
    expect(wrapped.body).toMatchObject({ ok: true, reading: { air: 6.2, ro: 4.1, temp: 65 } });
    expect(wrapped.body.reading).not.toHaveProperty('label');
    expect(Number.isNaN(Date.parse(wrapped.body.fetchedAt))).toBe(false);
    const flat = await test(`${base}/flat`);
    expect(flat.body).toMatchObject({ ok: true, reading: { air: 1.5, temp: 70 } });
  });

  it('test-url reports every failure as a result, never a 500', async () => {
    internalErrors.length = 0;
    const expectations: Array<[string, string]> = [
      [`${base}/array`, 'Response missing a reading object'],
      [`${base}/scalar`, 'Response missing a reading object'],
      [`${base}/500`, 'HTTP 500'],
      [`${base}/notjson`, 'Response was not valid JSON'],
      [`${base}/empty`, 'Response was not valid JSON'],
      [`${base}/big-declared`, 'Response too large'],
      [`${base}/big-stream`, 'Response too large'],
      [`http://${lanIp}:${deadPort}/x`, 'Request failed'],
      ['http://127.0.0.1:3000/api/users', 'Destination address not allowed'],
      ['', 'No URL configured'],
    ];
    for (const [url, error] of expectations) {
      const res = await test(url);
      expect(res.status, url).toBe(200);
      expect(res.body, url).toEqual({ ok: false, error });
    }
    expect(internalErrors).toEqual([]);
  });

  it('test-url never follows a redirect (the 302 to the metadata address is not fetched)', async () => {
    const res = await test(`${base}/redirect`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'Redirects are not allowed' });
  });

  it('test-url gives up after the 5 s timeout', async () => {
    const res = await test(`${base}/slow`);
    expect(res.body).toEqual({ ok: false, error: 'Timed out' });
  }, 20_000);

  it('fetch-readings with only a groupId uses the group\'s LIVE config; manual instruments are omitted', async () => {
    const res = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { groupId: g1, stageKey: 'WASH_IN' } });
    expect(res.status).toBe(200);
    // g1 now points at /flat (air 1.5) with only `air` keyed among WASH_IN instruments.
    expect(res.body.stageKey).toBe('WASH_IN');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ ok: true, value: 1.5, instrumentCode: 'PG-01', description: 'Compressed Air Pressure', uom: 'bar' });
    const dry = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { groupId: g1, stageKey: 'DRY_IN' } });
    expect(dry.body.results.map((r: any) => [r.ok, r.value])).toEqual([[true, 70]]);
    const nothing = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { stageKey: 'WASH_IN' } });
    expect(nothing.body).toEqual({ stageKey: 'WASH_IN', results: [] });
    const badStage = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { groupId: g1, stageKey: 'DRY_OUT' } });
    expect(badStage.status).toBe(400);
  });

  it('fetch-readings for a filter mid-cycle reads the PINNED version snapshot, not the live group', async () => {
    const cycle = await own.cycle(fA, cpId, { equipmentGroupId: g1, equipmentGroupVersionPin: 1, cleaningAreaId: block1 });
    await prisma.filterDetails.update({ where: { assetInstanceId: fA }, data: { currentCycleId: cycle } });
    const pinned = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, stageKey: 'WASH_IN' } });
    // v1 snapshot: URL /ok, air → 6.2 and ro keyed 'missing_key'.
    expect(pinned.body.results.map((r: any) => [r.instrumentCode, r.ok, r.value ?? r.error])).toEqual([
      ['PG-01', true, 6.2],
      ['PG-02', false, 'Key "missing_key" not found in response'],
    ]);

    // A pin with no archived row falls back to the live group (URL /flat).
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { equipmentGroupVersionPin: 99 } });
    const live = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, stageKey: 'WASH_IN' } });
    expect(live.body.results.map((r: any) => r.value)).toEqual([1.5]);
    // No pin at all: live too.
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { equipmentGroupVersionPin: null } });
    const unpinned = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, stageKey: 'WASH_IN' } });
    expect(unpinned.body.results.map((r: any) => r.value)).toEqual([1.5]);

    // An unbound cycle resolves the block's single active group (block1 now has only g1).
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { equipmentGroupId: null } });
    const viaBlock = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, stageKey: 'DRY_IN' } });
    expect(viaBlock.body.results.map((r: any) => r.value)).toEqual([70]);

    // Two active groups in the block → no unambiguous group → nothing (no groupId fallback given).
    const extra = await sa.call('POST', '/api/equipment-groups', { body: createBody(own.n('G5'), block1, { readingUrl: `${base}/ok`, instruments: instruments([{ responseKey: 'air' }]) }) });
    const ambiguous = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, stageKey: 'WASH_IN' } });
    expect(ambiguous.body).toEqual({ stageKey: 'WASH_IN', results: [] });
    // …unless the dialog names a group explicitly.
    const named = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, groupId: extra.body.id, stageKey: 'WASH_IN' } });
    expect(named.body.results.map((r: any) => r.value)).toEqual([6.2]);

    // A cycle that is no longer in progress is ignored.
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { status: 'COMPLETED', completedAt: new Date(), equipmentGroupId: g1 } });
    const done = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fA, stageKey: 'WASH_IN' } });
    expect(done.body.results).toEqual([]);
    // A filter with no cycle pointer falls through to the groupId.
    const noCycle = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { filterId: fB, groupId: g1, stageKey: 'WASH_IN' } });
    expect(noCycle.body.results.map((r: any) => r.value)).toEqual([1.5]);
  });

  it('an auto-fetch instrument whose group lost its URL reports "No reading URL configured"', async () => {
    await prisma.equipmentGroup.update({ where: { id: g1 }, data: { readingUrl: null } });
    const res = await eg.call('POST', '/api/equipment-groups/fetch-readings', { body: { groupId: g1, stageKey: 'WASH_IN' } });
    expect(res.body.results).toEqual([
      expect.objectContaining({ instrumentCode: 'PG-01', ok: false, error: 'No reading URL configured' }),
    ]);
  });
});
