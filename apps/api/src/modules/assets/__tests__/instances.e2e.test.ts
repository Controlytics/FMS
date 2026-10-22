/**
 * /api/assets/instances — list / tree / get / create / update / status /
 * delete / children through the real harness app (production error handler,
 * real auth / RBAC / re-auth, real Prisma + mirror triggers on digilog_test_db).
 *
 * Visibility scoping (EntityAssignment / TemplateAssignment) is opt-in and
 * cached for 30 s per process. Rows created here target ONLY this suite's
 * users, so no other user's view changes; the cache is advanced with a faked
 * `Date` (no Prisma delegate is touched).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from './slice-support.js';

const own = new SliceOwner(runTag('CVIN'));
let app: FastifyInstance;
type U = { id: string; username: string; role: string; call: Caller };
let sa: U, adm: U, ed: U, sc1: U, sc2: U, sc3: U;
const T: Record<string, string> = {};
const I: Record<string, string> = {};
let fpId: string;

const create = (who: U, body: Record<string, unknown>, pw?: string) => who.call('POST', '/api/assets/instances', { body, pw });
const mineIds = (rows: Array<{ id: string; name: string }>) => rows.filter((r) => r.name.startsWith(own.tag)).map((r) => r.id).sort();

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  adm = await own.user(app, 'adm', 'ADMIN');
  const edRole = await own.role('ED', ['ASSET_VIEW', 'ASSET_CREATE', 'ASSET_UPDATE', 'ASSET_DELETE']);
  ed = await own.user(app, 'ed', edRole);
  const scRole = await own.role('SC', ['ASSET_VIEW']);
  sc1 = await own.user(app, 'sc1', scRole);
  sc2 = await own.user(app, 'sc2', scRole);
  sc3 = await own.user(app, 'sc3', await own.role('SC3', ['ASSET_VIEW']));
  await own.reauth(['CREATE_ASSET', 'UPDATE_ASSET', 'DELETE_ASSET'], edRole);

  T.block = await own.template('BLOCK', { maxConnections: 5 });
  T.blockSmall = await own.template('BLOCK', { maxConnections: 1 });
  T.area = await own.template('AREA');
  T.ahu = await own.template('AHU');
  T.filter = await own.template('FILTER', { isActive: true });
  T.other = await own.template('OTHER', { attributeSchema: [{ fieldName: 'capacity', dataType: 'INTEGER', required: true }] });
  T.plain = await own.template('OTHER');
  T.noParent = await own.template('OTHER', { maxParentConnections: 0 });
  const cp = await own.cleaningProfile('CP', ['WASH_IN'], sa.id, { status: 'ARCHIVED' });
  fpId = await own.filterProfile('FP', cp.id);
}, 60_000);

afterAll(async () => {
  vi.useRealTimers();
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('instances — create', () => {
  it('creates a Block → Area → AHU → Filter chain with containment links and one audit row each', async () => {
    const b = await create(sa, { name: own.n('B'), templateId: T.block });
    expect(b.status).toBe(201);
    I.B = b.body.data.id;
    expect(b.body.data).toMatchObject({ name: own.n('B'), parentId: null, templateId: T.block, status: 'Active', approvalStatus: 'APPROVED', createdBy: sa.username });
    const [bAudit] = await auditFor(I.B, 'ASSET_CREATED');
    expect(bAudit).toMatchObject({ reason: 'BLOCK created', signatureMeaning: `BLOCK "${own.n('B')}" created` });

    I.A = (await create(sa, { name: own.n('A'), templateId: T.area, parentId: I.B })).body.data.id;
    I.H = (await create(sa, { name: own.n('H'), templateId: T.ahu, parentId: I.A })).body.data.id;
    const f = await create(sa, { name: own.n('F'), templateId: T.filter, parentId: I.H, filterSet: 'A', filterProfileId: fpId, attributes: {} });
    expect(f.status).toBe(201);
    I.F = f.body.data.id;
    const [aAudit] = await auditFor(I.A, 'ASSET_CREATED');
    expect(aAudit.reason).toBe(`AREA created under "${own.n('B')}"`);
    expect(aAudit.afterValue).toMatchObject({ parentName: own.n('B'), parentKind: 'BLOCK', templateKind: 'AREA' });
    const rels = await prisma.assetRelationship.findMany({ where: { OR: [{ sourceAssetId: I.H }, { targetAssetId: I.H }] } });
    expect(rels.map((r) => `${r.sourceAssetId === I.H ? 'H' : r.sourceAssetId === I.A ? 'A' : 'F'}-${r.relationshipType}`).sort()).toEqual(['A-CONTAINS', 'F-CONTAINED_IN', 'H-CONTAINED_IN', 'H-CONTAINS'].sort());
    // Forward mirror + FilterDetails sidecar (A → SET_A).
    expect(await prisma.ahu.findUnique({ where: { id: I.H } })).toMatchObject({ areaId: I.A, blockId: null });
    expect(await prisma.filter.findUnique({ where: { id: I.F } })).toMatchObject({ ahuId: I.H });
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: I.F } })).toMatchObject({ filterSet: 'SET_A', filterProfileId: fpId });

    I.H2 = (await create(sa, { name: own.n('H2'), templateId: T.ahu, parentId: I.B })).body.data.id;
    const fb = await create(sa, { name: own.n('FB'), templateId: T.filter, parentId: I.H2, filterSet: 'B' });
    I.FB = fb.body.data.id;
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: I.FB } }))!.filterSet).toBe('SET_B');
    const fn = await create(sa, { name: own.n('FN'), templateId: T.filter, parentId: I.H2 });
    I.FN = fn.body.data.id;
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: I.FN } }))!.filterSet).toBeNull();
  });

  it('refuses invalid creates with a specific 400 and writes nothing', async () => {
    internalErrors.length = 0;
    I.dead = await own.instance('DEAD-PARENT', T.plain, null, { isActive: false });
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: own.n('X'), templateId: randomUUID() }, 'Template not found'],
      [{ name: own.n('b').toLowerCase(), templateId: T.plain }, `An entity with the name "${own.n('b').toLowerCase()}" already exists`],
      [{ name: own.n('X'), templateId: T.plain, parentId: randomUUID() }, 'Parent entity instance not found'],
      [{ name: own.n('X'), templateId: T.plain, parentId: I.dead }, 'Parent entity is deactivated and cannot receive children'],
      [{ name: own.n('X'), templateId: T.noParent, parentId: I.B }, 'This template does not allow parent connections (Number of Parent Connections = 0). Create this entity without a parent.'],
      [{ name: own.n('X'), templateId: T.filter, parentId: I.B }, 'A filter must be placed under an AHU'],
    ];
    for (const [body, message] of cases) {
      const res = await create(sa, body);
      expect(res.status, message).toBe(400);
      expect(res.body).toMatchObject({ error: 'VALIDATION_ERROR', message });
    }
    const attr = await create(sa, { name: own.n('X'), templateId: T.other, attributes: { other: 1 } });
    expect(attr.status).toBe(400);
    expect(attr.body).toMatchObject({ message: 'ATTRIBUTE_VALIDATION_ERROR', details: ['"capacity" is required'] });
    const zod = await create(sa, { name: '', templateId: T.plain });
    expect(zod.status).toBe(400);
    expect(zod.body.error).toBe('VALIDATION_ERROR');
    expect(zod.body.details.fieldErrors.name).toBeTruthy();
    expect(await prisma.assetInstance.count({ where: { name: own.n('X') } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });

  it('refuses a child once the parent template\'s max connections is reached', async () => {
    I.BS = (await create(sa, { name: own.n('BS'), templateId: T.blockSmall })).body.data.id;
    const first = await create(sa, { name: own.n('BS-C1'), templateId: T.plain, parentId: I.BS });
    expect(first.status).toBe(201);
    I.BSC1 = first.body.data.id;
    const second = await create(sa, { name: own.n('BS-C2'), templateId: T.plain, parentId: I.BS });
    expect(second.status).toBe(400);
    expect(second.body.message).toBe('Parent entity has reached max connections (1/1)');
  });

  it('asks a re-auth-configured role for the password, then creates with it (and validates attributes)', async () => {
    const noPw = await create(ed, { name: own.n('O1'), templateId: T.other, attributes: { capacity: 5 } });
    expect(noPw.status).toBe(401);
    expect(noPw.body).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_ASSET' });
    const res = await create(ed, { name: own.n('O1'), templateId: T.other, attributes: { capacity: 5 }, description: 'tank' }, PASSWORD);
    expect(res.status).toBe(201);
    I.O1 = res.body.data.id;
    expect(res.body.data).toMatchObject({ attributes: { capacity: 5 }, createdBy: ed.username, description: 'tank' });
    expect(await prisma.filterDetails.count({ where: { assetInstanceId: I.O1 } })).toBe(0);
  });
});

describe('instances — read', () => {
  it('lists with search / template / status / parent / active filters and paging; zod errors are 400', async () => {
    const all = await sa.call('GET', `/api/assets/instances?search=${own.tag}`);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ page: 1, totalPages: 1, limit: all.body.total });
    expect(mineIds(all.body.data)).toEqual([I.A, I.B, I.BS, I.BSC1, I.F, I.FB, I.FN, I.H, I.H2, I.O1].sort());
    const f = all.body.data.find((r: any) => r.id === I.F);
    expect(f).toMatchObject({ filterSet: 'SET_A', filterProfileId: fpId, currentLifecycleState: null, lastCleanedAt: null, template: { name: expect.any(String) } });
    const byTpl = await sa.call('GET', `/api/assets/instances?search=${own.tag}&templateId=${T.ahu}`);
    expect(mineIds(byTpl.body.data)).toEqual([I.H, I.H2].sort());
    const children = await sa.call('GET', `/api/assets/instances?search=${own.tag}&parentId=${I.B}`);
    expect(mineIds(children.body.data)).toEqual([I.A, I.H2].sort());
    const roots = await sa.call('GET', `/api/assets/instances?search=${own.tag}&parentId=null`);
    expect(mineIds(roots.body.data)).toEqual([I.B, I.BS, I.O1].sort());
    const inactive = await sa.call('GET', `/api/assets/instances?search=${own.tag}&isActive=false`);
    expect(mineIds(inactive.body.data)).toEqual([I.dead]);
    const status = await sa.call('GET', `/api/assets/instances?search=${own.tag}&status=Nope`);
    expect(status.body.data).toEqual([]);
    const paged = await sa.call('GET', `/api/assets/instances?search=${own.tag}&limit=3&page=2`);
    expect(paged.body).toMatchObject({ page: 2, limit: 3, total: 10, totalPages: 4 });
    expect(paged.body.data).toHaveLength(3);
    internalErrors.length = 0;
    for (const q of ['page=0', 'parentId=not-a-uuid', 'limit=0']) {
      const bad = await sa.call('GET', `/api/assets/instances?${q}`);
      expect(bad.status, q).toBe(400);
      expect(bad.body.error).toBe('VALIDATION_ERROR');
    }
    expect(internalErrors).toEqual([]);
  });

  it('serves the flat tree and one instance in full; 404s an unknown id', async () => {
    const tree = await adm.call('GET', '/api/assets/instances/tree');
    expect(tree.status).toBe(200);
    const h = tree.body.find((r: any) => r.id === I.H);
    expect(h).toMatchObject({ parentId: I.A, templateId: T.ahu, _count: { children: 1 } });
    const one = await sa.call('GET', `/api/assets/instances/${I.F}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: I.F, parent: { id: I.H, name: own.n('H') }, template: { id: T.filter, templateKind: 'FILTER' }, filterSet: 'SET_A', identifiers: [] });
    expect(one.body.targetRelations.some((r: any) => r.sourceAsset.id === I.H)).toBe(true);
    const missing = await sa.call('GET', `/api/assets/instances/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: 'NOT_FOUND', message: 'Entity instance not found' });
  });

  it('lists the direct, active children of an instance; 404 for an unknown parent', async () => {
    const res = await sa.call('GET', `/api/assets/instances/${I.B}/children`);
    expect(res.status).toBe(200);
    expect(res.body.map((c: any) => c.id).sort()).toEqual([I.A, I.H2].sort());
    expect(res.body.find((c: any) => c.id === I.A)).toMatchObject({ _count: { children: 1 }, template: { name: expect.any(String) } });
    const missing = await sa.call('GET', `/api/assets/instances/${randomUUID()}/children`);
    expect(missing.status).toBe(404);
  });
});

describe('instances — update', () => {
  it('records each kind of change in the audit reason', async () => {
    const noPw = await ed.call('PUT', `/api/assets/instances/${I.O1}`, { body: { description: 'x' } });
    expect(noPw.status).toBe(401);
    const res = await ed.call('PUT', `/api/assets/instances/${I.O1}`, {
      pw: PASSWORD,
      body: { description: 'big tank', attributes: { capacity: 6 }, telemetryConfig: { rate: 1 }, customAttributes: { colour: 'blue' }, status: 'Active' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ description: 'big tank', attributes: { capacity: 6 }, telemetryConfig: { rate: 1 }, customAttributes: { colour: 'blue' }, updatedBy: ed.username });
    const [audit] = await auditFor(I.O1, 'ASSET_UPDATED');
    expect(audit.reason).toBe('Description updated; Attributes changed: capacity: 5 → 6; Telemetry config updated; Custom attributes updated');
    expect(audit.beforeValue).toMatchObject({ description: 'tank', attributes: { capacity: 5 } });

    await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { attributes: { capacity: 6 } } });
    expect((await auditFor(I.O1, 'ASSET_UPDATED'))[0].reason).toBe('Attributes updated (no value changes)');
    await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: {} });
    const [empty] = await auditFor(I.O1, 'ASSET_UPDATED');
    expect(empty.reason).toBe('OTHER updated');
    expect(empty.signatureMeaning).toBe(`OTHER "${own.n('O1')}" updated: updated`);
    // A case-only rename is not a duplicate of itself.
    await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { name: own.n('o1'), status: 'Spare' } });
    const [renamed] = await auditFor(I.O1, 'ASSET_UPDATED');
    expect(renamed.reason).toBe(`Name: "${own.n('O1')}" → "${own.n('o1')}"; Status: "Active" → "Spare"`);
  });

  it('validates attributes, unique names and the target before writing', async () => {
    const attr = await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { attributes: { capacity: 'lots' } } });
    expect(attr.status).toBe(400);
    expect(attr.body.details).toEqual(['"capacity" must be an integer']);
    const taken = await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { name: own.n('B') } });
    expect(taken.status).toBe(400);
    expect(taken.body.message).toBe(`An entity with the name "${own.n('B')}" already exists`);
    const missing = await sa.call('PUT', `/api/assets/instances/${randomUUID()}`, { body: { name: 'x' } });
    expect(missing.status).toBe(404);
    const zod = await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { name: '' } });
    expect(zod.status).toBe(400);
    expect(zod.body.error).toBe('VALIDATION_ERROR');
  });

  it('a filter\'s status is lifecycle-owned, its fields are master-data validated, and it cannot be detached', async () => {
    const status = await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { status: 'Retired' } });
    expect(status.status).toBe(409);
    expect(status.body.error).toBe('FILTER_STATUS_LIFECYCLE_OWNED');
    const same = await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { status: 'Active' } });
    expect(same.status).toBe(200);
    const fields = await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { attributes: { ahuType: 'process', micronSize: '', note: 'keep me' } } });
    expect(fields.status).toBe(200);
    expect(fields.body.data.attributes).toEqual({ ahuType: 'Process', note: 'keep me' });
    expect((await prisma.filter.findUnique({ where: { id: I.F } }))!.attributes).toEqual({ ahuType: 'Process', note: 'keep me' });
    const bad = await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { attributes: { ahuType: 'Bogus' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('One or more filter fields are invalid');
    const detach = await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { parentId: null } });
    expect(detach.status).toBe(400);
    expect(detach.body.message).toBe('A filter cannot be detached from its AHU. Move it to another AHU or retire it.');
    const sets = await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { filterSet: 'B', filterProfileId: null } });
    expect(sets.status).toBe(200);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: I.F } })).toMatchObject({ filterSet: 'SET_B', filterProfileId: null });
    await sa.call('PUT', `/api/assets/instances/${I.F}`, { body: { filterSet: null, filterProfileId: fpId } });
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: I.F } })).toMatchObject({ filterSet: null, filterProfileId: fpId });
    // Non-filter: the sidecar fields are ignored, no FilterDetails row appears.
    await sa.call('PUT', `/api/assets/instances/${I.H}`, { body: { filterSet: 'A' } });
    expect(await prisma.filterDetails.count({ where: { assetInstanceId: I.H } })).toBe(0);

    await prisma.filter.update({ where: { id: I.FN }, data: { isActive: false } });
    const retired = await sa.call('PUT', `/api/assets/instances/${I.FN}`, { body: { description: 'x' } });
    expect(retired.status).toBe(409);
    expect(retired.body.error).toBe('FILTER_INACTIVE');
    await prisma.filter.update({ where: { id: I.FN }, data: { isActive: true } });
  });

  it('moving an AHU swaps its containment links, audits the move twice, and the mirror follows', async () => {
    I.H3 = (await create(sa, { name: own.n('H3'), templateId: T.ahu, parentId: I.B })).body.data.id;
    const res = await sa.call('PUT', `/api/assets/instances/${I.H3}`, { body: { parentId: I.A } });
    expect(res.status).toBe(200);
    expect(await prisma.ahu.findUnique({ where: { id: I.H3 } })).toMatchObject({ areaId: I.A, blockId: null });
    const rels = await prisma.assetRelationship.findMany({ where: { OR: [{ sourceAssetId: I.H3, relationshipType: 'CONTAINED_IN' }, { targetAssetId: I.H3, relationshipType: 'CONTAINS' }] } });
    expect(rels.map((r) => (r.relationshipType === 'CONTAINS' ? r.sourceAssetId : r.targetAssetId))).toEqual([I.A, I.A]);
    const [del] = await auditFor(I.H3, 'ASSET_RELATIONSHIP_DELETED');
    expect(del.reason).toBe(`Parent changed: "${own.n('H3')}" removed from under "${own.n('B')}"`);
    expect(del.beforeValue).toMatchObject({ sourceKind: 'BLOCK', targetKind: 'AHU' });
    const created = await prisma.auditTrail.findFirst({ where: { action: 'ASSET_RELATIONSHIP_CREATED', reason: `Parent changed: "${own.n('H3')}" now placed under "${own.n('A')}"` } });
    expect(created).toBeTruthy();
    // An AHU that already holds filters cannot itself become a child.
    const busy = await sa.call('PUT', `/api/assets/instances/${I.H2}`, { body: { parentId: I.A } });
    expect(busy.status).toBe(400);
    const [upd] = await auditFor(I.H3, 'ASSET_UPDATED');
    expect(upd.reason).toBe(`Parent: "${I.B}" → "${I.A}"`);

    // A root node gaining its first parent only creates (nothing to remove).
    const r2 = await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { parentId: I.B } });
    expect(r2.status).toBe(200);
    expect(await auditFor(I.O1, 'ASSET_RELATIONSHIP_DELETED')).toHaveLength(0);
  });

  it('refuses a self-parent, moving a node that has children, a deactivated parent, and a cycle', async () => {
    const self = await sa.call('PUT', `/api/assets/instances/${I.A}`, { body: { parentId: I.A } });
    expect(self.body.message).toBe('Cannot set self as parent');
    const withKids = await sa.call('PUT', `/api/assets/instances/${I.A}`, { body: { parentId: I.O1 } });
    expect(withKids.status).toBe(400);
    expect(withKids.body.message).toBe('This entity is already a parent node with children and cannot be connected as a child node');
    const dead = await sa.call('PUT', `/api/assets/instances/${I.O1}`, { body: { parentId: I.dead } });
    expect(dead.body.message).toBe('Parent entity is deactivated and cannot receive children');
    // parentId-only hierarchy (no CONTAINS rows) still detects the loop.
    const p = await own.instance('LOOP-P', T.plain);
    const c = await own.instance('LOOP-C', T.plain, p);
    const loop = await sa.call('PUT', `/api/assets/instances/${p}`, { body: { parentId: c } });
    expect(loop.status).toBe(400);
    expect(loop.body.message).toBe('Cannot set parent: would create a cycle in the hierarchy');
  });
});

describe('instances — status', () => {
  it('changes a non-filter status with remarks in the audit reason; refuses a blank status and a filter status change', async () => {
    const noPw = await ed.call('PATCH', `/api/assets/instances/${I.BSC1}/status`, { body: { status: 'Under Maintenance' } });
    expect(noPw.status).toBe(401);
    const res = await ed.call('PATCH', `/api/assets/instances/${I.BSC1}/status`, { pw: PASSWORD, body: { status: ' Under Maintenance ', remarks: 'pump swap' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Under Maintenance');
    const [audit] = await auditFor(I.BSC1, 'ASSET_STATUS_CHANGED');
    expect(audit.reason).toBe('Status: "Active" → "Under Maintenance" — pump swap');
    expect(audit.afterValue).toEqual({ status: 'Under Maintenance', templateKind: 'OTHER' });
    await sa.call('PATCH', `/api/assets/instances/${I.BSC1}/status`, { body: { status: 'Active' } });
    expect((await auditFor(I.BSC1, 'ASSET_STATUS_CHANGED'))[0].reason).toBe('Status: "Under Maintenance" → "Active"');

    const blank = await sa.call('PATCH', `/api/assets/instances/${I.BSC1}/status`, { body: { status: '   ' } });
    expect(blank.status).toBe(400);
    expect(blank.body.message).toBe('Status is required and must be a non-empty string');
    const filter = await sa.call('PATCH', `/api/assets/instances/${I.F}/status`, { body: { status: 'Retired' } });
    expect(filter.status).toBe(409);
    expect(filter.body.error).toBe('FILTER_STATUS_LIFECYCLE_OWNED');
    const missing = await sa.call('PATCH', `/api/assets/instances/${randomUUID()}/status`, { body: { status: 'x' } });
    expect(missing.status).toBe(404);
  });
});

describe('instances — visibility scoping', () => {
  it('with no scoping rows anywhere, a non-admin role sees everything its permission allows', async () => {
    const list = await sc1.call('GET', `/api/assets/instances?search=${own.tag}`);
    expect(list.status).toBe(200);
    expect(mineIds(list.body.data)).toContain(I.F);
    expect(list.body.total).toBe(list.body.data.length);
    const tree = await sc1.call('GET', '/api/assets/instances/tree');
    expect(tree.body.some((r: any) => r.id === I.F)).toBe(true);
  });

  it('honours USER and ROLE entity assignments, USER template assignments and own creations once scoping exists', async () => {
    const own1 = await own.instance('SC1-OWN', T.plain, null, { createdBy: sc1.username });
    await prisma.entityAssignment.create({ data: { entityId: I.H, assigneeType: 'USER', userId: sc1.id } });
    await prisma.templateAssignment.create({ data: { templateId: T.area, assigneeType: 'USER', userId: sc1.id } });
    await prisma.entityAssignment.create({ data: { entityId: I.B, assigneeType: 'ROLE', roleValue: sc3.role } });
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.now() + 31_000)); // past the 30 s "is scoping configured" cache
    try {
      const scoped = await sc1.call('GET', `/api/assets/instances?search=${own.tag}`);
      expect(mineIds(scoped.body.data)).toEqual([I.A, I.H, own1].sort());
      const scopedTree = await sc1.call('GET', '/api/assets/instances/tree');
      expect(mineIds(scopedTree.body)).toEqual([I.A, I.H, own1].sort());

      const byRole = await sc3.call('GET', `/api/assets/instances?search=${own.tag}`);
      expect(mineIds(byRole.body.data)).toEqual([I.B]);
      const byRoleTree = await sc3.call('GET', '/api/assets/instances/tree');
      expect(mineIds(byRoleTree.body)).toEqual([I.B]);

      // Same role, no rows targeting this user: scoping is off for them.
      const open = await sc2.call('GET', `/api/assets/instances?search=${own.tag}`);
      expect(mineIds(open.body.data)).toContain(I.F);
      const openTree = await sc2.call('GET', '/api/assets/instances/tree');
      expect(openTree.body.some((r: any) => r.id === I.F)).toBe(true);
      // Admins bypass scoping.
      const admin = await adm.call('GET', `/api/assets/instances?search=${own.tag}`);
      expect(mineIds(admin.body.data)).toContain(I.F);

      // Template list: a user with template assignments sees only those templates.
      const tpls = await sc1.call('GET', '/api/assets/templates');
      expect(tpls.body.data.map((t: any) => t.id)).toEqual([T.area]);
      const tplsOpen = await sc2.call('GET', `/api/assets/templates?search=${own.tag}`);
      expect(tplsOpen.body.data.map((t: any) => t.id)).toContain(T.block);
    } finally {
      vi.useRealTimers();
      await prisma.entityAssignment.deleteMany({ where: { OR: [{ userId: sc1.id }, { roleValue: sc3.role }] } });
      await prisma.templateAssignment.deleteMany({ where: { userId: sc1.id } });
    }
  });
});

describe('instances — delete (soft, with cascade)', () => {
  it('refuses while any filter in the subtree is mid-cycle, naming it', async () => {
    const cp = await prisma.filterProfile.findUnique({ where: { id: fpId } });
    const cycle = await own.cycle(I.FB, cp!.cleaningProfileId);
    const res = await sa.call('DELETE', `/api/assets/instances/${I.B}`, { pw: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('FILTER_CYCLE_IN_PROGRESS');
    const code = (await prisma.cleaningCycle.findUnique({ where: { id: cycle } }))!.cycleCode;
    expect(res.body.message).toContain(`${own.n('FB')} (${code})`);
    expect(res.body.details).toEqual({ cycles: [{ filterName: own.n('FB'), cycleCode: code }] });
    expect((await prisma.assetInstance.findUnique({ where: { id: I.B } }))!.isActive).toBe(true);
    await prisma.cleaningCycle.update({ where: { id: cycle }, data: { status: 'COMPLETED', completedAt: new Date() } });
  });

  it('deactivates the subtree, deletes its tags and links with audit rows, and deactivates the block\'s equipment groups', async () => {
    const tag = await prisma.assetIdentifier.create({ data: { assetId: I.F, identifierType: 'RFID', identifierValue: own.n('TAG-F') } });
    const group = await prisma.equipmentGroup.create({ data: { name: own.n('EG'), blockId: I.B } });
    const noPw = await ed.call('DELETE', `/api/assets/instances/${I.B}`);
    expect(noPw.status).toBe(401);
    const res = await ed.call('DELETE', `/api/assets/instances/${I.B}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    // B, A, H, H3, H2, F, FN, FB, O1 (moved under B earlier)
    expect(res.body).toEqual({ success: true, deactivatedCount: 9 });
    const states = await prisma.assetInstance.findMany({ where: { id: { in: [I.B, I.A, I.H, I.H3, I.H2, I.F, I.FB, I.FN, I.O1] } }, select: { isActive: true } });
    expect(states).toHaveLength(9);
    expect(states.every((s) => s.isActive === false)).toBe(true);
    expect((await prisma.filter.findUnique({ where: { id: I.F } }))!.isActive).toBe(false);
    expect(await prisma.assetIdentifier.count({ where: { id: tag.id } })).toBe(0);
    expect(await prisma.assetRelationship.count({ where: { OR: [{ sourceAssetId: I.H }, { targetAssetId: I.H }] } })).toBe(0);
    expect((await prisma.equipmentGroup.findUnique({ where: { id: group.id } }))!.isActive).toBe(false);
    const [identAudit] = await auditFor(tag.id, 'ASSET_IDENTIFIER_DELETED');
    expect(identAudit.reason).toBe(`Cascade: BLOCK "${own.n('B')}" deleted`);
    expect(identAudit.beforeValue).toMatchObject({ assetId: I.F, identifierValue: own.n('TAG-F'), filterName: own.n('F') });
    const [del] = await auditFor(I.B, 'ASSET_DELETED');
    expect(del.afterValue).toEqual({ isActive: false, cascadeDeactivated: 8, templateKind: 'BLOCK', equipmentGroupsDeactivated: 1 });
    expect(del.signatureMeaning).toBe(`BLOCK "${own.n('B')}" and 8 under it deactivated`);
  });

  it('a leaf deletes on its own (no groups recorded); an unknown id is 404', async () => {
    const res = await sa.call('DELETE', `/api/assets/instances/${I.BSC1}`, { pw: PASSWORD });
    expect(res.body).toEqual({ success: true, deactivatedCount: 1 });
    const [del] = await auditFor(I.BSC1, 'ASSET_DELETED');
    expect(del.afterValue).toEqual({ isActive: false, cascadeDeactivated: 0, templateKind: 'OTHER' });
    const missing = await sa.call('DELETE', `/api/assets/instances/${randomUUID()}`, { pw: PASSWORD });
    expect(missing.status).toBe(404);
  });
});
