/**
 * /api/assets/identifiers (RFID / QR tags + the RFID Track Record) and
 * /api/assets/templates through the real harness app and real Prisma.
 *
 * Every tag value carries this suite's run tag, so the track-record queries can
 * be filtered to this suite's own rows and their totals are exact.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from './slice-support.js';

const own = new SliceOwner(runTag('CVID'));
let app: FastifyInstance;
let sa: { id: string; username: string; call: Caller };
let rf: { id: string; username: string; call: Caller };
let viewer: { call: Caller };
let adm: { call: Caller };
let ahuId: string;
const F: Record<string, string> = {};
const tag = (s: string) => `${own.tag}${s}`; // canonical RFID form (upper-case, no separators)

const assign = (who: { call: Caller }, body: Record<string, unknown>, pw?: string) => who.call('POST', '/api/assets/identifiers', { body, pw });

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const rfRole = await own.role('RF', ['ASSET_VIEW', 'FILTER_RFID_MANAGE']);
  rf = await own.user(app, 'rf', rfRole);
  viewer = await own.user(app, 'vw', await own.role('VW', ['ASSET_VIEW']));
  adm = await own.user(app, 'adm', 'ADMIN');
  await own.reauth(['CREATE_ASSET_IDENTIFIER', 'DELETE_ASSET_IDENTIFIER'], rfRole);
  await own.template('FILTER', { isActive: true });
  const blockId = await own.instance('BLOCK', await own.template('BLOCK'));
  ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  for (const k of ['A', 'B', 'C', 'D', 'E']) F[k] = await own.filter(k, ahuId);
  F.retired = await own.filter('RETIRED', ahuId, {}, { status: 'Retired', isActive: false });
  F.inactive = await own.filter('INACTIVE', ahuId, {}, { isActive: false });
  F.rejected = await own.filter('REJ', ahuId);
  F.pending = await own.filter('PEND', ahuId);
  await prisma.assetInstance.update({ where: { id: F.rejected }, data: { approvalStatus: 'REJECTED' } });
  await prisma.assetInstance.update({ where: { id: F.pending }, data: { approvalStatus: 'PENDING_APPROVAL' } });
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('identifiers — assign', () => {
  it('a role without an identifier permission is refused; the RFID role needs the password when configured', async () => {
    expect((await assign(viewer, { assetId: F.A, identifierType: 'RFID', identifierValue: tag('X') })).status).toBe(403);
    const noPw = await assign(rf, { assetId: F.A, identifierType: 'RFID', identifierValue: tag('X') });
    expect(noPw.status).toBe(401);
    expect(noPw.body.action).toBe('CREATE_ASSET_IDENTIFIER');
    expect(await prisma.assetIdentifier.count({ where: { assetId: F.A } })).toBe(0);
  });

  it('stores an RFID value in canonical form (upper-case, reader stutter collapsed) and audits with the filter name', async () => {
    const stutter = `${tag('T1')}${tag('T1')}`.toLowerCase();
    const res = await assign(rf, { assetId: F.A, identifierType: 'RFID', identifierValue: stutter, label: 'front', isPrimary: true }, PASSWORD);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ assetId: F.A, identifierType: 'RFID', identifierValue: tag('T1'), label: 'front', isPrimary: true, createdBy: rf.username });
    const [audit] = await auditFor(res.body.data.id, 'ASSET_IDENTIFIER_CREATED');
    expect(audit.afterValue).toMatchObject({ identifierValue: tag('T1'), filterName: own.n('A') });
  });

  it('refuses the same tag twice on one filter, and a second tag without replaceExisting', async () => {
    const same = await assign(sa, { assetId: F.A, identifierType: 'RFID', identifierValue: tag('T1').toLowerCase() });
    expect(same.status).toBe(409);
    expect(same.body).toMatchObject({ error: 'IDENTIFIER_ALREADY_ON_ENTITY', message: `Tag ${tag('T1')} is already assigned to "${own.n('A')}".` });
    const second = await assign(sa, { assetId: F.A, identifierType: 'RFID', identifierValue: tag('T2') });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'ENTITY_HAS_IDENTIFIER', message: `"${own.n('A')}" already has tag ${tag('T1')}. Remove it first, or confirm the replacement.` });
  });

  it('replaceExisting releases the old tag (audited, names the new one) and binds the new one in one transaction', async () => {
    const old = await prisma.assetIdentifier.findFirst({ where: { assetId: F.A } });
    const res = await assign(sa, { assetId: F.A, identifierType: 'RFID', identifierValue: tag('T2'), replaceExisting: true });
    expect(res.status).toBe(201);
    expect(await prisma.assetIdentifier.findMany({ where: { assetId: F.A }, select: { identifierValue: true } })).toEqual([{ identifierValue: tag('T2') }]);
    const [released] = await auditFor(old!.id, 'ASSET_IDENTIFIER_DELETED');
    expect(released.reason).toBe(`Replaced by tag ${tag('T2')} on "${own.n('A')}"`);
    expect(released.afterValue).toEqual({ deleted: true, replacedBy: tag('T2') });
  });

  it('a tag held by a LIVE filter is a conflict — even when the stored row differs only in case', async () => {
    await prisma.assetIdentifier.create({ data: { assetId: F.B, identifierType: 'RFID', identifierValue: tag('LEGACY').toLowerCase() } });
    const res = await assign(sa, { assetId: F.C, identifierType: 'RFID', identifierValue: tag('LEGACY') });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'DUPLICATE_IDENTIFIER_VALUE', message: 'Identifier value already exists on another entity' });
  });

  it('a tag held by a retired or deactivated filter is released to the new filter, with a REMOVE row', async () => {
    for (const [holder, target, value] of [[F.retired, F.C, 'RET'], [F.inactive, F.D, 'INA']] as const) {
      const held = await prisma.assetIdentifier.create({ data: { assetId: holder, identifierType: 'RFID', identifierValue: tag(value) } });
      const res = await assign(sa, { assetId: target, identifierType: 'RFID', identifierValue: tag(value) });
      expect(res.status, value).toBe(201);
      expect(res.body.data.assetId).toBe(target);
      expect(await prisma.assetIdentifier.count({ where: { id: held.id } })).toBe(0);
      const [rel] = await auditFor(held.id, 'ASSET_IDENTIFIER_DELETED');
      expect(rel.afterValue).toEqual({ deleted: true, reassignedTo: target });
      expect(rel.reason).toMatch(/: previous holder ".*" is retired or deactivated$/);
    }
  });

  it('refuses an unknown entity, a filter still in the workflow, an empty RFID value and a schema-invalid body', async () => {
    internalErrors.length = 0;
    const ghost = await assign(sa, { assetId: randomUUID(), identifierType: 'RFID', identifierValue: tag('G') });
    expect(ghost.body).toMatchObject({ error: 'VALIDATION_ERROR', message: 'Entity instance not found' });
    const rej = await assign(sa, { assetId: F.rejected, identifierType: 'RFID', identifierValue: tag('R') });
    expect(rej.status).toBe(409);
    expect(rej.body.message).toBe(`Filter "${own.n('REJ')}" was rejected and must be corrected and re-submitted, so it cannot be operated yet.`);
    const pend = await assign(sa, { assetId: F.pending, identifierType: 'RFID', identifierValue: tag('P') });
    expect(pend.body.error).toBe('FILTER_NOT_APPROVED');
    const blank = await assign(sa, { assetId: F.E, identifierType: 'RFID', identifierValue: '  \r\n ' });
    expect(blank.body).toMatchObject({ error: 'VALIDATION_ERROR', message: 'RFID tag value is empty' });
    const type = await assign(sa, { assetId: F.E, identifierType: 'TELEPATHY', identifierValue: 'x' });
    expect(type.status).toBe(400);
    expect(type.body.error).toBe('VALIDATION_ERROR');
    expect(type.body.details.fieldErrors.identifierType).toBeTruthy();
    expect(await prisma.assetIdentifier.count({ where: { assetId: { in: [F.rejected, F.pending, F.E] } } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });

  it('a non-RFID value is stored exactly as sent and compared case-sensitively', async () => {
    const qr = `qr-${own.tag}-Mixed`;
    const a = await assign(sa, { assetId: F.E, identifierType: 'QR', identifierValue: qr });
    expect(a.status).toBe(201);
    expect(a.body.data.identifierValue).toBe(qr);
    const other = await own.filter('QR2', ahuId);
    const b = await assign(sa, { assetId: other, identifierType: 'QR', identifierValue: qr.toUpperCase() });
    expect(b.status).toBe(201);
    const dupe = await assign(sa, { assetId: F.D, identifierType: 'QR', identifierValue: qr, replaceExisting: true });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe('DUPLICATE_IDENTIFIER_VALUE');
  });
});

describe('identifiers — read', () => {
  it('lists by asset and by type with the asset summary the scan surfaces need', async () => {
    const byAsset = await viewer.call('GET', `/api/assets/identifiers?assetId=${F.A}`);
    expect(byAsset.status).toBe(200);
    expect(byAsset.body).toHaveLength(1);
    expect(byAsset.body[0]).toMatchObject({ identifierValue: tag('T2'), asset: { id: F.A, name: own.n('A'), approvalStatus: 'APPROVED', status: 'Active', isActive: true } });
    const qr = await viewer.call('GET', `/api/assets/identifiers?assetId=${F.E}&type=QR`);
    expect(qr.body.map((i: any) => i.identifierType)).toEqual(['QR']);
    const none = await viewer.call('GET', `/api/assets/identifiers?assetId=${F.E}&type=RFID`);
    expect(none.body).toEqual([]);
  });

  it('looks a tag up exactly, by its canonical form, or answers 404', async () => {
    const exact = await viewer.call('GET', `/api/assets/identifiers/lookup/${encodeURIComponent(tag('T2'))}`);
    expect(exact.status).toBe(200);
    expect(exact.body).toMatchObject({ identifierValue: tag('T2'), asset: { id: F.A, parent: { id: ahuId } } });
    // The legacy lower-case row on F.B resolves from an upper-case scan.
    const legacy = await viewer.call('GET', `/api/assets/identifiers/lookup/${encodeURIComponent(tag('LEGACY'))}`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.asset.id).toBe(F.B);
    const missing = await viewer.call('GET', `/api/assets/identifiers/lookup/${own.tag}NOPE`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Identifier not found');
  });
});

describe('identifiers — remove', () => {
  it('removes a tag with an optional reason from the body or the query string, audited for the Track Record', async () => {
    const [onA] = await prisma.assetIdentifier.findMany({ where: { assetId: F.A } });
    const noPw = await rf.call('DELETE', `/api/assets/identifiers/${onA.id}`, { body: { reason: 'x' } });
    expect(noPw.status).toBe(401);
    const res = await rf.call('DELETE', `/api/assets/identifiers/${onA.id}`, { pw: PASSWORD, body: { reason: '  tag damaged  ' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const [a] = await auditFor(onA.id, 'ASSET_IDENTIFIER_DELETED');
    expect(a.reason).toBe('tag damaged');
    expect(a.beforeValue).toEqual({ assetId: F.A, identifierType: 'RFID', identifierValue: tag('T2'), filterName: own.n('A') });

    const [onC] = await prisma.assetIdentifier.findMany({ where: { assetId: F.C } });
    // No body at all: the reason comes from the query string.
    const noBody = await sa.call('DELETE', `/api/assets/identifiers/${onC.id}?reason=lost`);
    expect(noBody.status).toBe(200);
    expect((await auditFor(onC.id, 'ASSET_IDENTIFIER_DELETED'))[0].reason).toBe('lost');
    // The empty JSON body the web client always sends; no reason at all.
    const [onD] = await prisma.assetIdentifier.findMany({ where: { assetId: F.D } });
    await sa.call('DELETE', `/api/assets/identifiers/${onD.id}`, { body: {} });
    expect((await auditFor(onD.id, 'ASSET_IDENTIFIER_DELETED'))[0].reason).toBeNull();

    const missing = await sa.call('DELETE', `/api/assets/identifiers/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});

describe('identifiers — RFID Track Record', () => {
  it('reconstructs assign / remove events from the audit trail, filtered in SQL and paged', async () => {
    // One legacy-shaped row: userId holds the user's UUID, not a username.
    await auditLog({
      userId: rf.id, userRole: 'X', action: 'ASSET_IDENTIFIER_CREATED', targetType: 'asset_identifier', targetId: randomUUID(),
      afterValue: { assetId: F.B, identifierType: 'RFID', identifierValue: tag('OLD') },
    });
    const all = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag.toLowerCase()}`);
    expect(all.status).toBe(200);
    // T1: assign, replaced. T2: assign, removed. RET and INA: released from the
    // retired / inactive holder, assigned, removed. OLD: the legacy row. = 11
    expect(all.body.total).toBe(11);
    expect(all.body).toMatchObject({ page: 1, limit: 11, totalPages: 1 });
    const t2 = all.body.data.filter((e: any) => e.rfidNumber === tag('T2'));
    expect(t2.map((e: any) => e.event)).toEqual(['REMOVE', 'ASSIGN']);
    expect(t2[0]).toMatchObject({ filterId: F.A, filterName: own.n('A'), ahuId, ahuName: own.n('AHU'), user: rf.username, reason: 'tag damaged' });
    const old = all.body.data.find((e: any) => e.rfidNumber === tag('OLD'));
    expect(old).toMatchObject({ event: 'ASSIGN', user: rf.username, userId: rf.id, filterName: own.n('B') });
    const times = all.body.data.map((e: any) => Date.parse(e.timestamp));
    expect(times).toEqual([...times].sort((x, y) => y - x));

    const byFilter = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&filterName=${encodeURIComponent(own.n('A').toLowerCase())}`);
    expect(byFilter.body.total).toBe(4);
    const byAhu = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&ahu=${encodeURIComponent(own.n('AHU'))}`);
    expect(byAhu.body.total).toBe(11);
    const byUser = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&user=${rf.username}`);
    // rf assigned T1, removed T2, and is the UUID-keyed user of the legacy row.
    expect(byUser.body.total).toBe(3);
    const page = await rf.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&limit=4&page=3`);
    expect(page.body).toMatchObject({ total: 11, page: 3, limit: 4, totalPages: 3 });
    expect(page.body.data).toHaveLength(3);
    // A LIKE wildcard in the search text is matched literally.
    const literal = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}%25_`);
    expect(literal.body.total).toBe(0);
    const future = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&from=2999-01-01`);
    expect(future.body).toMatchObject({ total: 0, data: [] });
    const past = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&to=2000-01-01`);
    expect(past.body.total).toBe(0);
    const window = await viewer.call('GET', `/api/assets/identifiers/track-record?rfid=${own.tag}&from=2000-01-01&to=2999-01-01`);
    expect(window.body.total).toBe(11);
  });

  it('an unparsable date is a 400, not a 500', async () => {
    internalErrors.length = 0;
    const res = await viewer.call('GET', '/api/assets/identifiers/track-record?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'INVALID_DATE', message: '"from" is not a valid date.' });
    const to = await viewer.call('GET', '/api/assets/identifiers/track-record?to=31/12/2026');
    expect(to.body.message).toBe('"to" is not a valid date.');
    expect(internalErrors).toEqual([]);
  });
});

describe('templates (read-only routes)', () => {
  it('lists with search, active filter and paging; an admin sees every template', async () => {
    const extra = await own.template('OTHER', { isActive: false });
    const mine = await adm.call('GET', `/api/assets/templates?search=${own.tag}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.every((t: any) => t.name.startsWith(own.tag))).toBe(true);
    expect(mine.body.data.map((t: any) => t.id)).toContain(extra);
    expect(mine.body).toMatchObject({ page: 1, totalPages: 1, limit: mine.body.total });
    const ahuTpl = mine.body.data.find((t: any) => t.templateKind === 'AHU');
    expect(ahuTpl._count.instances).toBe(1);
    // Active templates sort before inactive ones.
    expect(mine.body.data.at(-1).id).toBe(extra);
    const inactive = await sa.call('GET', `/api/assets/templates?search=${own.tag}&isActive=false`);
    expect(inactive.body.data.map((t: any) => t.id)).toEqual([extra]);
    const active = await sa.call('GET', `/api/assets/templates?search=${own.tag}&isActive=true`);
    expect(active.body.data.map((t: any) => t.id)).not.toContain(extra);
    const paged = await sa.call('GET', `/api/assets/templates?search=${own.tag}&limit=2&page=2`);
    expect(paged.body).toMatchObject({ page: 2, limit: 2, total: mine.body.total, totalPages: Math.ceil(mine.body.total / 2) });
    internalErrors.length = 0;
    const bad = await sa.call('GET', '/api/assets/templates?page=0');
    expect(bad.status).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('gets one template by id with its live-instance count; 404 for an unknown id', async () => {
    const tpl = (await prisma.assetTemplate.findFirst({ where: { name: { startsWith: own.tag }, templateKind: 'BLOCK' } }))!;
    const res = await viewer.call('GET', `/api/assets/templates/${tpl.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: tpl.id, templateKind: 'BLOCK', _count: { instances: 1 }, isActive: true });
    const missing = await viewer.call('GET', `/api/assets/templates/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Template not found');
  });
});
