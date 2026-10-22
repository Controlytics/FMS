/**
 * Filter profiles — every route through the real harness app (production error
 * handler, real auth + RBAC + re-auth, real Prisma on digilog_test_db).
 *
 * Owns its users, roles, templates, cleaning profiles, hierarchy and filters
 * (see SliceOwner). Asserts what a client sees (status, error code, body) and
 * what the database holds afterwards (rows, version snapshots, audit rows).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVFP'));
let app: FastifyInstance;
let sa: { id: string; call: Caller };
let fp: { id: string; call: Caller; role: string };
let vh: { call: Caller };
let none: { call: Caller };
let cpActive: string;
let cpActive2: string;
let cpArchived: string;
let t1: string;
let t2: string;
let blockId: string;
let ahuId: string;
let f1: string;
let f2: string;
let fDead: string;
let profileId: string;

const ACTIONS = ['CREATE_FILTER_PROFILE', 'UPDATE_FILTER_PROFILE', 'DELETE_FILTER_PROFILE', 'ASSIGN_FILTER_PROFILE'];

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const fpRole = await own.role('FP', ['FP_READ', 'FP_CREATE', 'FP_UPDATE', 'FP_DELETE', 'FP_ASSIGN']);
  fp = await own.user(app, 'fp', fpRole);
  vh = await own.user(app, 'vh', await own.role('VH', ['VERSION_HISTORY_VIEW']));
  none = await own.user(app, 'none', await own.role('NONE', ['ASSET_VIEW']));
  await own.reauth(ACTIONS, fpRole);

  cpActive = (await own.cleaningProfile('CP-A', ['WASH_IN', 'WASH_OUT'], sa.id)).id;
  cpActive2 = (await own.cleaningProfile('CP-B', ['WASH_IN'], sa.id)).id;
  cpArchived = (await own.cleaningProfile('CP-ARCH', ['WASH_IN'], sa.id, { status: 'ARCHIVED' })).id;
  t1 = await own.template('OTHER');
  t2 = await own.template('OTHER');
  await own.template('FILTER', { isActive: true });
  blockId = await own.instance('BLOCK', await own.template('BLOCK'));
  ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  f1 = await own.filter('F1', ahuId);
  f2 = await own.filter('F2', ahuId);
  fDead = await own.filter('FDEAD', ahuId, {}, { isActive: false });
}, 60_000);

afterAll(async () => {
  // The ACTIVE profiles above are every other suite's fallback default while
  // they exist (the test DB has none of its own) — archive first, then remove.
  await prisma.filterCleaningProfile.updateMany({ where: { name: { startsWith: own.tag } }, data: { status: 'ARCHIVED' } }).catch(() => undefined);
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('filter-profiles — permissions and re-auth', () => {
  it('refuses a caller with no filter-profile permission (403) and lets VERSION_HISTORY_VIEW read', async () => {
    const denied = await none.call('GET', '/api/filter-profiles');
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('FORBIDDEN');
    const reader = await vh.call('GET', '/api/filter-profiles?limit=5');
    expect(reader.status).toBe(200);
    expect(Array.isArray(reader.body.data)).toBe(true);
    const write = await vh.call('POST', '/api/filter-profiles', { body: { name: own.n('X'), cleaningProfileId: cpActive } });
    expect(write.status).toBe(403);
  });

  it('POST asks for the password when re-auth is configured for the role, and writes nothing without it', async () => {
    const name = own.n('NOPW');
    const res = await fp.call('POST', '/api/filter-profiles', { body: { name, cleaningProfileId: cpActive } });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_FILTER_PROFILE' });
    expect(await prisma.filterProfile.count({ where: { name } })).toBe(0);
  });
});

describe('filter-profiles — create / read', () => {
  it('POST creates the profile, binds the applicable templates and signs the audit row', async () => {
    const res = await fp.call('POST', '/api/filter-profiles', {
      pw: PASSWORD,
      body: { name: own.n('PROFILE'), description: 'first', cleaningProfileId: cpActive, applicableTemplates: [t1, t2], maxCleaningCycles: 7 },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: own.n('PROFILE'), cleaningProfileId: cpActive, blockRestriction: 'OWN_BLOCK_ONLY', version: 1, maxCleaningCycles: 7 });
    expect([...res.body.applicableTemplates].sort()).toEqual([t1, t2].sort());
    profileId = res.body.id;

    const joins = await prisma.filterProfileApplicableTemplate.findMany({ where: { profileId } });
    expect(joins.map((j) => j.templateId).sort()).toEqual([t1, t2].sort());
    const [created] = await auditFor(profileId, 'CREATED');
    expect(created.afterValue).toMatchObject({ name: own.n('PROFILE'), cleaningProfileId: cpActive });
    expect(created.signatureAuditId).toBeTruthy();
    const sig = await prisma.auditTrail.findUnique({ where: { id: created.signatureAuditId! } });
    expect(sig?.action).toBe('REAUTH_SUCCESS');
    expect((sig?.afterValue as any).reauthAction).toBe('CREATE_FILTER_PROFILE');
  });

  it('POST refuses an inactive cleaning profile and unknown template ids, and schema errors are 400', async () => {
    const before = await prisma.filterProfile.count({ where: { name: { startsWith: own.tag } } });
    internalErrors.length = 0;
    const inactive = await sa.call('POST', '/api/filter-profiles', { body: { name: own.n('BAD1'), cleaningProfileId: cpArchived } });
    expect(inactive.status).toBe(400);
    expect(inactive.body).toMatchObject({ error: 'VALIDATION_ERROR', message: 'Referenced cleaning profile not found or not active' });
    const ghost = randomUUID();
    const badTpl = await sa.call('POST', '/api/filter-profiles', { body: { name: own.n('BAD2'), cleaningProfileId: cpActive, applicableTemplates: [t1, ghost] } });
    expect(badTpl.status).toBe(400);
    expect(badTpl.body.message).toBe(`Unknown asset template id(s): ${ghost}`);
    const schema = await sa.call('POST', '/api/filter-profiles', { body: { name: own.n('BAD3'), cleaningProfileId: 'not-a-uuid' } });
    expect(schema.status).toBe(400);
    expect(schema.body.error).toBe('VALIDATION_ERROR');
    const badEnum = await sa.call('POST', '/api/filter-profiles', { body: { name: own.n('BAD4'), cleaningProfileId: cpActive, blockRestriction: 'EVERYWHERE' } });
    expect(badEnum.status).toBe(400);
    expect(await prisma.filterProfile.count({ where: { name: { startsWith: own.tag } } })).toBe(before);
    expect(internalErrors).toEqual([]);
  });

  it('POST without applicableTemplates binds none and keeps SPECIFIC_BLOCKS + allowedBlocks', async () => {
    const res = await sa.call('POST', '/api/filter-profiles', {
      body: { name: own.n('SPECIFIC'), cleaningProfileId: cpActive2, blockRestriction: 'SPECIFIC_BLOCKS', allowedBlocks: [blockId] },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ applicableTemplates: [], blockRestriction: 'SPECIFIC_BLOCKS', allowedBlocks: [blockId] });
    expect(await prisma.filterProfileApplicableTemplate.count({ where: { profileId: res.body.id } })).toBe(0);
  });

  it('GET / pages and decorates rows; GET /:id returns the flattened row or 404', async () => {
    const all = await sa.call('GET', '/api/filter-profiles?limit=1000');
    expect(all.status).toBe(200);
    const mine = all.body.data.find((r: any) => r.id === profileId);
    expect(mine).toMatchObject({ cleaningProfileName: own.n('CP-A'), activeFilterCount: 0 });
    expect([...mine.applicableTemplates].sort()).toEqual([t1, t2].sort());
    expect(mine).not.toHaveProperty('cleaningProfile');
    expect(mine).not.toHaveProperty('_count');
    expect(all.body.total).toBeGreaterThanOrEqual(2);

    const page = await sa.call('GET', '/api/filter-profiles?page=1&limit=1');
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.total).toBe(all.body.total);

    const one = await fp.call('GET', `/api/filter-profiles/${profileId}`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: profileId, name: own.n('PROFILE') });
    expect([...one.body.applicableTemplates].sort()).toEqual([t1, t2].sort());

    const missing = await fp.call('GET', `/api/filter-profiles/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: 'NOT_FOUND', message: 'Filter profile not found' });
    const malformed = await fp.call('GET', '/api/filter-profiles/abc');
    expect(malformed.status).toBe(400);
  });
});

describe('filter-profiles — update and versions', () => {
  it('starts with no archived versions (the live row IS v1)', async () => {
    const res = await vh.call('GET', `/api/filter-profiles/${profileId}/versions`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ profileId, currentVersion: 1, versions: [] });
  });

  it('PUT freezes the outgoing state, bumps the version, rewrites the template set and audits', async () => {
    const res = await fp.call('PUT', `/api/filter-profiles/${profileId}`, {
      pw: PASSWORD,
      body: { name: own.n('PROFILE-v2'), applicableTemplates: [t2], changeNotes: 'narrowed templates' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: own.n('PROFILE-v2'), version: 2, applicableTemplates: [t2], description: 'first', maxCleaningCycles: 7 });

    const snap = await vh.call('GET', `/api/filter-profiles/${profileId}/versions/1`);
    expect(snap.status).toBe(200);
    expect(snap.body).toMatchObject({
      profileId, versionNumber: 1, name: own.n('PROFILE'), cleaningProfileId: cpActive,
      blockRestriction: 'OWN_BLOCK_ONLY', maxCleaningCycles: 7, isActive: true, createdBy: fp.id,
    });
    expect([...snap.body.applicableTemplates].sort()).toEqual([t1, t2].sort());

    const list = await vh.call('GET', `/api/filter-profiles/${profileId}/versions`);
    expect(list.body.currentVersion).toBe(2);
    expect(list.body.versions).toHaveLength(1);
    expect(list.body.versions[0]).toMatchObject({ versionNumber: 1, createdBy: fp.id });

    const [upd] = await auditFor(profileId, 'UPDATED');
    expect(upd.beforeValue).toEqual({ name: own.n('PROFILE'), version: 1 });
    expect(upd.afterValue).toEqual({ name: own.n('PROFILE-v2'), version: 2 });
  });

  it('PUT records the caller\'s change notes on the archived version', async () => {
    const list = await vh.call('GET', `/api/filter-profiles/${profileId}/versions`);
    expect(list.body.versions[0].changeNotes).toBe('narrowed templates');
  });

  it('PUT without applicableTemplates leaves the set alone; [] clears it; other fields update', async () => {
    const keep = await sa.call('PUT', `/api/filter-profiles/${profileId}`, { body: { description: 'second', isActive: false, cleaningProfileId: cpActive2, blockRestriction: 'ANY_BLOCK', maxCleaningCycles: 3 } });
    expect(keep.status).toBe(200);
    expect(keep.body).toMatchObject({ applicableTemplates: [t2], description: 'second', isActive: false, cleaningProfileId: cpActive2, blockRestriction: 'ANY_BLOCK', maxCleaningCycles: 3, version: 3 });

    const clear = await sa.call('PUT', `/api/filter-profiles/${profileId}`, { body: { applicableTemplates: [] } });
    expect(clear.status).toBe(200);
    expect(clear.body.applicableTemplates).toEqual([]);
    expect(await prisma.filterProfileApplicableTemplate.count({ where: { profileId } })).toBe(0);
    const snap3 = await sa.call('GET', `/api/filter-profiles/${profileId}/versions/3`);
    expect(snap3.body.applicableTemplates).toEqual([t2]);
    expect(snap3.body.changeNotes).toBeNull();
  });

  it('PUT validates the referenced cleaning profile and templates, and 404s an unknown profile', async () => {
    const versionBefore = (await prisma.filterProfile.findUnique({ where: { id: profileId } }))!.version;
    const archived = await sa.call('PUT', `/api/filter-profiles/${profileId}`, { body: { cleaningProfileId: cpArchived } });
    expect(archived.status).toBe(400);
    expect(archived.body).toMatchObject({ error: 'VALIDATION_ERROR', message: 'Cleaning profile must be active' });
    const ghostCp = await sa.call('PUT', `/api/filter-profiles/${profileId}`, { body: { cleaningProfileId: randomUUID() } });
    expect(ghostCp.status).toBe(404);
    expect(ghostCp.body.message).toBe('Cleaning profile not found');
    const ghostTpl = randomUUID();
    const badTpl = await sa.call('PUT', `/api/filter-profiles/${profileId}`, { body: { applicableTemplates: [ghostTpl] } });
    expect(badTpl.status).toBe(400);
    expect(badTpl.body.message).toContain(ghostTpl);
    const missing = await sa.call('PUT', `/api/filter-profiles/${randomUUID()}`, { body: { name: 'x' } });
    expect(missing.status).toBe(404);
    const blank = await sa.call('PUT', `/api/filter-profiles/${profileId}`, { body: { name: '' } });
    expect(blank.status).toBe(400);
    // Nothing above reached the version bump.
    expect((await prisma.filterProfile.findUnique({ where: { id: profileId } }))!.version).toBe(versionBefore);
  });

  it('version endpoints 404 an unknown profile or version, and reject version 0', async () => {
    const ghost = await vh.call('GET', `/api/filter-profiles/${randomUUID()}/versions`);
    expect(ghost.status).toBe(404);
    expect(ghost.body.message).toBe('Filter profile not found');
    const noVer = await vh.call('GET', `/api/filter-profiles/${profileId}/versions/99`);
    expect(noVer.status).toBe(404);
    expect(noVer.body.message).toBe(`Version 99 of filter profile ${profileId} not found`);
    const zero = await vh.call('GET', `/api/filter-profiles/${profileId}/versions/0`);
    expect(zero.status).toBe(400);
  });
});

describe('filter-profiles — assign and delete', () => {
  it('assign refuses ids that are not live filters and writes nothing', async () => {
    for (const ids of [[f1, blockId], [f1, fDead], [f1, randomUUID()]]) {
      const res = await sa.call('POST', `/api/filter-profiles/${profileId}/assign`, { body: { filterInstanceIds: ids } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_FILTER_IDS');
      expect(res.body.message).toMatch(/^1 id\(s\) are not active filters: /);
    }
    const many = Array.from({ length: 7 }, () => randomUUID());
    const big = await sa.call('POST', `/api/filter-profiles/${profileId}/assign`, { body: { filterInstanceIds: many } });
    expect(big.status).toBe(400);
    expect(big.body.message).toMatch(/^7 id\(s\) are not active filters: .*, …$/);
    expect(await prisma.filterDetails.count({ where: { filterProfileId: profileId } })).toBe(0);
    const unknownProfile = await sa.call('POST', `/api/filter-profiles/${randomUUID()}/assign`, { body: { filterInstanceIds: [f1] } });
    expect(unknownProfile.status).toBe(404);
  });

  it('assign binds de-duplicated live filters (creating a missing sidecar) and audits once in the same transaction', async () => {
    await prisma.filterDetails.delete({ where: { assetInstanceId: f2 } }); // a legacy filter without a sidecar
    const noPw = await fp.call('POST', `/api/filter-profiles/${profileId}/assign`, { body: { filterInstanceIds: [f1] } });
    expect(noPw.status).toBe(401);
    const res = await fp.call('POST', `/api/filter-profiles/${profileId}/assign`, { pw: PASSWORD, body: { filterInstanceIds: [f1, f1, f2] } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, assignedCount: 2 });
    const details = await prisma.filterDetails.findMany({ where: { assetInstanceId: { in: [f1, f2] } } });
    expect(details).toHaveLength(2);
    expect(details.every((d) => d.filterProfileId === profileId)).toBe(true);
    const rows = await auditFor(profileId, 'ASSIGNED');
    expect(rows).toHaveLength(1);
    expect(rows[0].afterValue).toMatchObject({ assignedFilters: 2, profileVersion: 4 });
    expect([...(rows[0].afterValue as any).filterNames].sort()).toEqual([own.n('F1'), own.n('F2')].sort());
    const list = await sa.call('GET', '/api/filter-profiles?limit=1000');
    expect(list.body.data.find((r: any) => r.id === profileId).activeFilterCount).toBe(2);
  });

  it('DELETE refuses while filters are assigned, needs the password, then removes the profile with its history', async () => {
    const blocked = await sa.call('DELETE', `/api/filter-profiles/${profileId}`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toBe('Cannot delete: 2 filter(s) are still assigned to this profile');

    await prisma.filterDetails.updateMany({ where: { filterProfileId: profileId }, data: { filterProfileId: null } });
    const noPw = await fp.call('DELETE', `/api/filter-profiles/${profileId}`);
    expect(noPw.status).toBe(401);
    expect(await prisma.filterProfile.count({ where: { id: profileId } })).toBe(1);
    const noPwPut = await fp.call('PUT', `/api/filter-profiles/${profileId}`, { body: { name: own.n('NOPE') } });
    expect(noPwPut.status).toBe(401);

    const res = await fp.call('DELETE', `/api/filter-profiles/${profileId}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.filterProfile.count({ where: { id: profileId } })).toBe(0);
    expect(await prisma.filterProfileVersion.count({ where: { profileId } })).toBe(0);
    const [del] = await auditFor(profileId, 'DELETED');
    expect(del.beforeValue).toMatchObject({ version: 4 });

    const again = await sa.call('DELETE', `/api/filter-profiles/${profileId}`);
    expect(again.status).toBe(404);
  });
});
