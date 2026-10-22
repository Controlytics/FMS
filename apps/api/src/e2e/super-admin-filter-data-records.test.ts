/**
 * e2e — Filter Data Management: retirement + replacement records, stats,
 * Super Admin API switch, and the SUPER_ADMIN_DATA_EDIT re-auth gate
 * (super-admin/routes.ts lines ~85-802 + manual-change.ts).
 *
 * Contract under test (root CLAUDE.md "Filter Data Management - audit-trail
 * retrofit"): every mutation needs a `_changeReason` (>= 5 chars, trimmed),
 * writes a MANUAL_RECORD_* row with before/after, deletes audit BEFORE the row
 * dies (in the same transaction), a retirement DELETE refuses with HAS_HISTORY,
 * and editing / deleting a replacement (an audit row) answers chainBroken.
 *
 * Real Fastify + auth + RBAC + Prisma on digilog_test_db. This file owns its
 * SUPER_ADMIN, a non-SA user + role, a BLOCK -> AHU (+ a deactivated AHU)
 * hierarchy and every filter / cycle / audit row it edits; all removed in
 * afterAll except audit rows (immutable by trigger, accumulate like every e2e).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { dateRangeGuard } from '../lib/date-range-guard.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, cleanupAll,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy, createCleaningProfile,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const PREFIX = `ZZSAFD-${SUF}`;
const SA = `cv_safd_sa_${SUF}`.toLowerCase();
const SA_PW = 'CovSafd@2026x';
const LOW = `cv_safd_low_${SUF}`.toLowerCase();
const LOW_PW = 'CovSafdLow@2026x';
const LOW_ROLE = `CVSAFD_${SUF}`;
const REASON = 'coverage: filter data records';

let app: FastifyInstance;
let saToken = '';
let lowToken = '';
let saId = '', lowId = '';
let h: Awaited<ReturnType<typeof createHierarchy>>;
let deadAhuId = '';
let profileId = '';
const filterIds: string[] = [];
const extraInstanceIds: string[] = [];
const equipmentGroupIds: string[] = [];
let apiLockRowExisted = true;

type Opts = { token?: string; reauth?: boolean };
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, o: Opts = {}) =>
  app.inject({
    method, url,
    headers: {
      authorization: `Bearer ${o.token ?? saToken}`,
      ...(o.reauth === false ? {} : { 'x-reauth-password': o.token === lowToken ? LOW_PW : SA_PW }),
    },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

const newFilter = async (tag: string, parent: string | null = h.ahuId) => {
  const id = await createFilter(parent, `${PREFIX}-${tag}`);
  filterIds.push(id);
  return id;
};
/** A retired filter exactly as retire() leaves it (no FILTER_RETIRED row). */
const retiredFilter = async (tag: string, preRetireParentId: string | null = h.ahuId) => {
  const id = await newFilter(tag, null);
  await prisma.assetInstance.update({
    where: { id },
    data: { status: 'Retired', isActive: false, customAttributes: preRetireParentId ? { _preRetireParentId: preRetireParentId } : {} },
  });
  await prisma.filterDetails.upsert({
    where: { assetInstanceId: id }, update: { currentLifecycleState: 'RETIRED' },
    create: { assetInstanceId: id, currentLifecycleState: 'RETIRED' },
  });
  return id;
};
const lastAudit = (targetId: string, action: string) =>
  prisma.auditTrail.findFirst({ where: { targetId, action }, orderBy: { chainPosition: 'desc' } });
const cycle = async (filterId: string, status: 'IN_PROGRESS' | 'COMPLETED', tag: string) =>
  prisma.cleaningCycle.create({
    data: {
      cycleCode: `${PREFIX}-${tag}`, filterId, profileId, profileVersion: 3, sequenceNumber: 1, status,
      cleaningReasonKey: 'routine', cleaningReasonLabel: 'Routine',
    },
  });

beforeAll(async () => {
  app = await buildApp([{
    prefix: '/api/super-admin',
    // Production registers dateRangeGuard globally (app.ts) before the routes.
    plugin: async (a) => { a.addHook('preHandler', dateRangeGuard); await a.register(superAdminRoutes); },
  }]);
  saId = await createUser(SA, 'SUPER_ADMIN', SA_PW);
  await createRole(LOW_ROLE, ['AUDIT_READ', 'ASSET_READ']);
  lowId = await createUser(LOW, LOW_ROLE, LOW_PW);
  saToken = await login(app, SA, SA_PW);
  lowToken = await login(app, LOW, LOW_PW);
  h = await createHierarchy(PREFIX);
  deadAhuId = (await prisma.assetInstance.create({
    data: { name: `${PREFIX}-DEAD-AHU`, templateId: h.ahuTemplateId, parentId: h.blockId, isActive: false, status: 'Inactive' },
  })).id;
  profileId = await createCleaningProfile(`${PREFIX} profile`, saId);
  apiLockRowExisted = !!(await prisma.systemConfig.findUnique({ where: { configKey: 'super-admin-api-access' } }));
}, 120_000);

afterAll(async () => {
  try {
    await cleanupAll([
      ['equipment groups', () => prisma.equipmentGroup.deleteMany({ where: { id: { in: equipmentGroupIds } } })],
      ['entity assignments', () => prisma.entityAssignment.deleteMany({ where: { entityId: { in: [...filterIds, ...extraInstanceIds] } } })],
      ['extra instances', () => prisma.assetInstance.deleteMany({ where: { id: { in: extraInstanceIds } } })],
      ['filters', () => deleteFilters(filterIds)],
      profileId ? ['cycles', () => prisma.cleaningCycle.deleteMany({ where: { profileId } })] : null,
      profileId ? ['profile', () => prisma.filterCleaningProfile.deleteMany({ where: { id: profileId } })] : null,
      ['hierarchy', () => deleteHierarchy(h, deadAhuId ? [deadAhuId] : [])],
      apiLockRowExisted ? null : ['api-lock row', () => prisma.systemConfig.deleteMany({ where: { configKey: 'super-admin-api-access' } })],
      ['users', () => deleteUsers([saId, lowId])],
      ['roles', () => deleteRoles([LOW_ROLE])],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('stats + Super Admin API switch', () => {
  it('GET /stats returns platform counts to a SUPER_ADMIN only', async () => {
    const res = await call('GET', '/api/super-admin/stats');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.devices).toBe(0);
    expect(body.users).toBe(await prisma.user.count());
    expect(body.entities).toBeGreaterThanOrEqual(2); // at least our block + AHU are active

    const denied = await call('GET', '/api/super-admin/stats', undefined, { token: lowToken });
    expect(denied.statusCode).toBe(403);
  });

  it('GET /api-lock reads the switch; PUT demands a password every time and audits the flip', async () => {
    const read = await call('GET', '/api/super-admin/api-lock');
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ enabled: true });

    // enforceReauthAlways: no password -> 401, nothing written.
    const noPw = await call('PUT', '/api/super-admin/api-lock', { enabled: true }, { reauth: false });
    expect(noPw.statusCode).toBe(401);
    expect(noPw.json().error).toBe('REAUTH_REQUIRED');

    // Only ever `true` here: `false` freezes every SUPER_ADMIN request in every
    // process sharing this DB (other suites run concurrently).
    const ok = await call('PUT', '/api/super-admin/api-lock', { enabled: true, _currentPassword: SA_PW }, { reauth: false });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ enabled: true });
    const row = await prisma.auditTrail.findFirst({
      where: { action: 'SUPER_ADMIN_API_ACCESS_CHANGED', userName: SA }, orderBy: { chainPosition: 'desc' },
    });
    expect(row).toMatchObject({ userId: SA, userRole: 'SUPER_ADMIN', targetId: 'super-admin-api-access' });
    expect(row?.beforeValue).toEqual({ enabled: true });
    expect(row?.afterValue).toEqual({ enabled: true });
    expect(row?.signatureMeaning).toBe('Super Admin API access ENABLED');
  });

  it('a non-SUPER_ADMIN cannot read or flip the switch', async () => {
    expect((await call('GET', '/api/super-admin/api-lock', undefined, { token: lowToken })).statusCode).toBe(403);
    expect((await call('PUT', '/api/super-admin/api-lock', { enabled: true }, { token: lowToken })).statusCode).toBe(403);
  });
});

describe('POST /filter-data/retirements (manual retire)', () => {
  it('retires a live filter exactly like retire(): cycle terminated, parent stashed, relationships torn down, two audit rows', async () => {
    const id = await newFilter('MANRET');
    await prisma.assetRelationship.createMany({
      data: [
        { sourceAssetId: h.ahuId, targetAssetId: id, relationshipType: 'CONTAINS' },
        { sourceAssetId: id, targetAssetId: h.ahuId, relationshipType: 'CONTAINED_IN' },
      ],
    });
    const c = await cycle(id, 'IN_PROGRESS', 'MANRET-C');
    await prisma.filterDetails.upsert({
      where: { assetInstanceId: id }, update: { currentCycleId: c.id, currentLifecycleState: 'WASH_IN' },
      create: { assetInstanceId: id, currentCycleId: c.id, currentLifecycleState: 'WASH_IN' },
    });
    const retiredAt = '2025-02-03T04:05:06.000Z';

    const res = await call('POST', '/api/super-admin/filter-data/retirements', {
      _changeReason: REASON, filterId: id, remarks: 'damaged frame', retiredAt, performedBy: 'field.tech',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const inst = await prisma.assetInstance.findUnique({ where: { id } });
    expect(inst).toMatchObject({ status: 'Retired', isActive: false, parentId: null });
    expect((inst?.customAttributes as any)._preRetireParentId).toBe(h.ahuId);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } }))
      .toMatchObject({ currentLifecycleState: 'RETIRED', currentCycleId: null });
    const cyc = await prisma.cleaningCycle.findUnique({ where: { id: c.id } });
    expect(cyc).toMatchObject({ status: 'TERMINATED', terminationReason: 'RETIRED' });
    expect(cyc?.terminatedAt?.toISOString()).toBe(retiredAt);
    expect(await prisma.assetRelationship.count({ where: { OR: [{ sourceAssetId: id }, { targetAssetId: id }] } })).toBe(0);

    const retiredRow = await lastAudit(id, 'FILTER_RETIRED');
    expect(retiredRow?.timestamp.toISOString()).toBe(retiredAt); // back-dated
    expect(retiredRow?.userName).toBe('field.tech');
    expect(retiredRow?.userId).toBe(SA); // the actor who keyed it in, as a username (compliance F3)
    expect(retiredRow?.reason).toBe(REASON);
    expect(retiredRow?.afterValue).toMatchObject({ remarks: 'damaged frame', filterName: `${PREFIX}-MANRET`, manualEntry: true });
    const marker = await lastAudit(id, 'MANUAL_RECORD_CREATED');
    expect(marker).toMatchObject({ userId: SA, userName: SA, userRole: 'SUPER_ADMIN', targetType: 'retired_filter', reason: REASON });
    expect(marker?.afterValue).toMatchObject({ remarks: 'damaged frame', previousParentId: h.ahuId, previousLifecycleState: 'WASH_IN' });
    expect(marker?.signatureMeaning).toBe('Retirement record manually created via Filter Data Management');

    // Second attempt on the now-retired filter.
    const again = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('ALREADY_RETIRED');
  });

  it('defaults the date to now and the performer to the acting SUPER_ADMIN, and works with no FilterDetails row', async () => {
    const id = await newFilter('MANRET2');
    await prisma.filterDetails.deleteMany({ where: { assetInstanceId: id } });
    const before = Date.now();
    const res = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id });
    expect(res.statusCode).toBe(200);
    const row = await lastAudit(id, 'FILTER_RETIRED');
    expect(row?.userName).toBe(SA);
    expect(row?.timestamp.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row?.afterValue).toMatchObject({ remarks: null });
    expect((await lastAudit(id, 'MANUAL_RECORD_CREATED'))?.afterValue).toMatchObject({ previousLifecycleState: null });
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } })).toMatchObject({ currentLifecycleState: 'RETIRED' });
  });

  it('refuses an unknown filter (404), a bad date (400) and a blank reason (400) without writing anything', async () => {
    const unknown = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: randomUUID() });
    expect(unknown.statusCode).toBe(404);

    const id = await newFilter('MANRET3');
    const badDate = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id, retiredAt: 'not-a-date' });
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json().error).toBe('INVALID');

    // Six spaces pass the schema's minLength 5 but trim to nothing.
    const blank = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: '      ', filterId: id });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toBe('REASON_REQUIRED');

    // Missing reason is refused by the body schema itself.
    const missing = await call('POST', '/api/super-admin/filter-data/retirements', { filterId: id });
    expect(missing.statusCode).toBe(400);

    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.status).toBe('Active');
    expect(await prisma.auditTrail.count({ where: { targetId: id } })).toBe(0);
  });

  it('a filter whose custom attributes are JSON null still records its pre-retire parent', async () => {
    const id = await newFilter('MANRET5');
    await prisma.$executeRawUnsafe(`UPDATE asset_instances SET custom_attributes = 'null'::jsonb WHERE id = $1::uuid`, id);
    const res = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id });
    expect(res.statusCode).toBe(200);
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.customAttributes).toEqual({ _preRetireParentId: h.ahuId });

    // ... and unretire of a retired filter whose custom attributes are JSON null restores it parentless.
    await prisma.$executeRawUnsafe(`UPDATE asset_instances SET custom_attributes = 'null'::jsonb WHERE id = $1::uuid`, id);
    const un = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: REASON });
    expect(un.statusCode).toBe(200);
    expect(await prisma.assetInstance.findUnique({ where: { id } })).toMatchObject({ status: 'Active', parentId: null, customAttributes: {} });
  });

  it('is SUPER_ADMIN-only', async () => {
    const id = await newFilter('MANRET4');
    const res = await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id }, { token: lowToken });
    expect(res.statusCode).toBe(403);
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.status).toBe('Active');
  });
});

describe('PUT /filter-data/retirements/:id (edit a retirement record)', () => {
  it('edits asset fields and the FilterDetails set; audits before/after including filterSet', async () => {
    const id = await retiredFilter('EDIT1');
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, {
      _changeReason: REASON, name: `${PREFIX}-EDIT1-RENAMED`, attributes: { note: 'x' }, filterSet: 'SET_A',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ name: `${PREFIX}-EDIT1-RENAMED`, chainBroken: false });
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } }))?.filterSet).toBe('SET_A');
    const row = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    expect(row).toMatchObject({ targetType: 'retired_filter', reason: REASON, userName: SA });
    expect(row?.beforeValue).toMatchObject({ name: `${PREFIX}-EDIT1`, filterSet: null });
    expect(row?.afterValue).toMatchObject({ name: `${PREFIX}-EDIT1-RENAMED`, filterSet: 'SET_A' });
    expect((row?.afterValue as any)._sideEffects).toBeUndefined();
  });

  it('a filterSet-only edit (blank clears it) is still a real, audited change', async () => {
    const id = await retiredFilter('EDIT2');
    await prisma.filterDetails.update({ where: { assetInstanceId: id }, data: { filterSet: 'SET_B' } });
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, filterSet: '' });
    expect(res.statusCode).toBe(200);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } }))?.filterSet).toBeNull();
    const row = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    expect(row?.beforeValue).toMatchObject({ filterSet: 'SET_B' });
    expect(row?.afterValue).toMatchObject({ filterSet: null });
  });

  it('a no-field edit keeps the sidecar value on both sides of the audit row', async () => {
    const id = await retiredFilter('EDIT2B');
    await prisma.filterDetails.update({ where: { assetInstanceId: id }, data: { filterSet: 'SET_B' } });
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(200);
    const row = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    expect(row?.beforeValue).toMatchObject({ filterSet: 'SET_B' });
    expect(row?.afterValue).toMatchObject({ filterSet: 'SET_B' });
  });

  it('editing date / performer / remarks rewrites the FILTER_RETIRED row (meta-audited) and reports chainBroken', async () => {
    const id = await newFilter('EDIT3');
    expect((await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id, remarks: 'orig' })).statusCode).toBe(200);
    const original = await lastAudit(id, 'FILTER_RETIRED');
    const newDate = '2024-06-07T08:09:10.000Z';

    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, {
      _changeReason: REASON, retiredAt: newDate, retiredBy: LOW, remarks: '  corrected remark  ',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().chainBroken).toBe(true);

    const edited = await prisma.auditTrail.findUnique({ where: { id: original!.id } });
    expect(edited?.timestamp.toISOString()).toBe(newDate);
    expect(edited?.userName).toBe(LOW);
    expect(edited?.userId).toBe(LOW); // username, like retire() writes it (compliance F3)
    expect(edited?.afterValue).toMatchObject({ remarks: 'corrected remark', filterName: `${PREFIX}-EDIT3` });

    const meta = await lastAudit(original!.id, 'AUDIT_RECORD_UPDATED');
    expect(meta).toMatchObject({ targetType: 'audit_trail', reason: REASON, userName: SA, userId: SA });
    expect(meta?.beforeValue).toMatchObject({ userName: SA, action: 'FILTER_RETIRED', afterValue: { remarks: 'orig' } });
    expect(meta?.afterValue).toMatchObject({ userName: LOW, afterValue: { remarks: 'corrected remark' } });
    expect(meta?.signatureMeaning).toMatch(/hash chain broken/);
    const marker = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    expect((marker?.afterValue as any)._sideEffects).toEqual({ retirementAuditRowEdited: true });

    // A blank remark clears it.
    const cleared = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, remarks: '   ' });
    expect(cleared.statusCode).toBe(200);
    expect((await prisma.auditTrail.findUnique({ where: { id: original!.id } }))?.afterValue).toMatchObject({ remarks: null });
  });

  it('refuses a bad date (400) and an unknown performer (404) before touching the audit row', async () => {
    const id = await newFilter('EDIT4');
    await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id, remarks: 'keep' });
    const row = await lastAudit(id, 'FILTER_RETIRED');

    const badDate = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, retiredAt: 'garbage' });
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json().error).toBe('INVALID_VALUE');
    const ghost = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, retiredBy: `nobody_${SUF}` });
    expect(ghost.statusCode).toBe(404);

    const after = await prisma.auditTrail.findUnique({ where: { id: row!.id } });
    expect(after?.timestamp.toISOString()).toBe(row?.timestamp.toISOString());
    expect(after?.userName).toBe(row?.userName);
    expect(await prisma.auditTrail.count({ where: { targetId: row!.id, action: 'AUDIT_RECORD_UPDATED' } })).toBe(0);
  });

  it('404s for an unknown / non-retired filter, and when no FILTER_RETIRED row carries the edited fields', async () => {
    expect((await call('PUT', `/api/super-admin/filter-data/retirements/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
    const live = await newFilter('EDIT5LIVE');
    expect((await call('PUT', `/api/super-admin/filter-data/retirements/${live}`, { _changeReason: REASON })).statusCode).toBe(404);

    const noRow = await retiredFilter('EDIT5');
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${noRow}`, { _changeReason: REASON, remarks: 'x' });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/No FILTER_RETIRED audit row/);
  });

  it('a performer-only edit keeps the stored date and payload; a FILTER_RETIRED row with no payload gains just the remark', async () => {
    const id = await newFilter('EDIT7');
    await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id, remarks: 'kept' });
    const row = await lastAudit(id, 'FILTER_RETIRED');
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, retiredBy: LOW });
    expect(res.json().chainBroken).toBe(true);
    const after = await prisma.auditTrail.findUnique({ where: { id: row!.id } });
    expect(after?.timestamp.toISOString()).toBe(row!.timestamp.toISOString());
    expect(after?.afterValue).toEqual(row!.afterValue);
    expect(after?.userName).toBe(LOW);
    const meta = await lastAudit(row!.id, 'AUDIT_RECORD_UPDATED');
    expect(meta?.afterValue).toMatchObject({ userName: LOW, afterValue: { remarks: 'kept' } });

    // Legacy shape: a FILTER_RETIRED row written with no afterValue at all.
    const bare = await retiredFilter('EDIT7B');
    const bareRow = await auditLog({ userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'FILTER_RETIRED', targetType: 'filter', targetId: bare });
    expect((await call('PUT', `/api/super-admin/filter-data/retirements/${bare}`, { _changeReason: REASON, remarks: 'added later' })).statusCode).toBe(200);
    expect((await prisma.auditTrail.findUnique({ where: { id: bareRow } }))?.afterValue).toEqual({ remarks: 'added later' });
  });

  it('validates EVERY field before the first write: a bad updatedAt leaves the FILTER_RETIRED row untouched', async () => {
    const id = await newFilter('EDIT8');
    await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id, remarks: 'orig' });
    const row = await lastAudit(id, 'FILTER_RETIRED');
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, {
      _changeReason: REASON, remarks: 'should-not-land', filterSet: 'SET_A', updatedAt: 'not-a-date',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_VALUE', message: 'updatedAt must be a valid date-time' });
    expect((await prisma.auditTrail.findUnique({ where: { id: row!.id } }))?.afterValue).toMatchObject({ remarks: 'orig' });
    expect(await prisma.auditTrail.count({ where: { targetId: row!.id, action: 'AUDIT_RECORD_UPDATED' } })).toBe(0);
    expect(await prisma.auditTrail.count({ where: { targetId: id, action: 'MANUAL_RECORD_UPDATED' } })).toBe(0);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } }))?.filterSet).toBeNull();
  });

  it('a blank reason is refused and nothing is written', async () => {
    const id = await retiredFilter('EDIT6');
    const res = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: '        ', name: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_REQUIRED');
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.name).toBe(`${PREFIX}-EDIT6`);
  });
});

describe('DELETE /filter-data/retirements/:id', () => {
  it('refuses with HAS_HISTORY naming every attached record (singular + plural)', async () => {
    const id = await retiredFilter('DELHIST');
    const c = await cycle(id, 'COMPLETED', 'DELHIST-C');
    for (let i = 0; i < 2; i++) {
      await prisma.filterEvent.create({
        data: { filterId: id, cycleId: c.id, eventType: 'REMARK_ADDED', performedBy: saId, checksum: 'x'.repeat(64), ipAddress: '127.0.0.1' },
      });
    }
    await prisma.assetIdentifier.create({ data: { assetId: id, identifierType: 'RFID', identifierValue: `${PREFIX}-DELHIST-TAG` } });
    const child = await prisma.assetInstance.create({ data: { name: `${PREFIX}-DELHIST-CHILD`, templateId: h.blockTemplateId, parentId: id } });
    extraInstanceIds.push(child.id);

    const res = await call('DELETE', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('HAS_HISTORY');
    expect(body.blockers).toEqual({ cycles: 1, events: 2, identifiers: 1, children: 1 });
    expect(body.message).toContain('1 cleaning cycle,');
    expect(body.message).toContain('2 filter events');
    expect(body.message).toContain('1 RFID/identifier tag,');
    expect(body.message).toContain('1 child record.');
    expect(await prisma.assetInstance.count({ where: { id } })).toBe(1);
    expect(await prisma.auditTrail.count({ where: { targetId: id, action: 'MANUAL_RECORD_DELETED' } })).toBe(0);

    // Plural spellings of the remaining blockers.
    const c2 = await cycle(id, 'COMPLETED', 'DELHIST-C2');
    await prisma.filterEvent.deleteMany({ where: { filterId: id } });
    await prisma.filterEvent.create({
      data: { filterId: id, cycleId: c2.id, eventType: 'REMARK_ADDED', performedBy: saId, checksum: 'x'.repeat(64), ipAddress: '127.0.0.1' },
    });
    await prisma.assetIdentifier.create({ data: { assetId: id, identifierType: 'QR', identifierValue: `${PREFIX}-DELHIST-QR` } });
    const child2 = await prisma.assetInstance.create({ data: { name: `${PREFIX}-DELHIST-CHILD2`, templateId: h.blockTemplateId, parentId: id } });
    extraInstanceIds.push(child2.id);
    const res2 = await call('DELETE', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON });
    expect(res2.json().message).toContain('2 cleaning cycles');
    expect(res2.json().message).toContain('1 filter event,');
    expect(res2.json().message).toContain('2 RFID/identifier tags');
    expect(res2.json().message).toContain('2 child records');
  });

  it('deletes a history-free retired filter, auditing it (with what cascades) BEFORE the row dies; FILTER_RETIRED survives', async () => {
    const id = await newFilter('DELOK');
    await call('POST', '/api/super-admin/filter-data/retirements', { _changeReason: REASON, filterId: id });
    const retiredRow = await lastAudit(id, 'FILTER_RETIRED');
    // A DB trigger enforces the bidirectional pair, so both halves go in together.
    await prisma.assetRelationship.createMany({
      data: [
        { sourceAssetId: h.blockId, targetAssetId: id, relationshipType: 'MONITORS' },
        { sourceAssetId: id, targetAssetId: h.blockId, relationshipType: 'MONITORED_BY' },
      ],
    });
    await prisma.entityAssignment.create({ data: { entityId: id, assigneeType: 'ROLE', roleValue: LOW_ROLE } });

    const res = await call('DELETE', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.assetInstance.count({ where: { id } })).toBe(0);
    expect(await prisma.filterDetails.count({ where: { assetInstanceId: id } })).toBe(0);
    expect(await prisma.entityAssignment.count({ where: { entityId: id } })).toBe(0);
    expect(await prisma.auditTrail.count({ where: { id: retiredRow!.id } })).toBe(1);

    const row = await lastAudit(id, 'MANUAL_RECORD_DELETED');
    expect(row).toMatchObject({ targetType: 'retired_filter', reason: REASON, userName: SA });
    expect(row?.beforeValue).toMatchObject({ id, name: `${PREFIX}-DELOK`, status: 'Retired' });
    const se = (row?.afterValue as any)._sideEffects;
    expect(se.filterRetiredAuditRowKept).toBe(true);
    expect(se.cascadedRelationships).toHaveLength(2);
    expect(se.cascadedRelationships.map((r: any) => r.relationshipType).sort()).toEqual(['MONITORED_BY', 'MONITORS']);
    expect(await prisma.assetRelationship.count({ where: { OR: [{ sourceAssetId: id }, { targetAssetId: id }] } })).toBe(0);
    expect(se.cascadedEntityAssignments).toHaveLength(1);
    expect(se.cascadedEntityAssignments[0]).toMatchObject({ roleValue: LOW_ROLE });
  });

  it('a delete the database refuses is a 400 DELETE_FAILED and leaves NO audit row (same transaction)', async () => {
    const id = await retiredFilter('DELFK');
    // equipment_groups.block_id -> asset_instances(id) is ON DELETE RESTRICT.
    const eg = await prisma.equipmentGroup.create({ data: { name: `${PREFIX}-EG`, blockId: id } });
    equipmentGroupIds.push(eg.id);
    const res = await call('DELETE', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'DELETE_FAILED', message: 'Could not delete retired filter.' });
    expect(await prisma.assetInstance.count({ where: { id } })).toBe(1);
    expect(await prisma.filterDetails.count({ where: { assetInstanceId: id } })).toBe(1);
    expect(await prisma.auditTrail.count({ where: { targetId: id, action: 'MANUAL_RECORD_DELETED' } })).toBe(0);
  });

  it('404s for an id that is not a retired filter', async () => {
    const live = await newFilter('DELLIVE');
    const res = await call('DELETE', `/api/super-admin/filter-data/retirements/${live}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(404);
    expect(await prisma.assetInstance.count({ where: { id: live } })).toBe(1);
  });
});

describe('POST /filter-data/retirements/:id/unretire', () => {
  it('validates the reason itself (its schema has no _changeReason): too long, and not a string', async () => {
    const id = await retiredFilter('UNR-R');
    const long = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: 'x'.repeat(501) });
    expect(long.statusCode).toBe(400);
    expect(long.json().error).toBe('REASON_TOO_LONG');
    const notString = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: 12345 });
    expect(notString.statusCode).toBe(400);
    expect(notString.json().error).toBe('REASON_REQUIRED');
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.status).toBe('Retired');
  });

  it('refuses to restore under a deactivated or missing parent (409 PARENT_INACTIVE)', async () => {
    const id = await retiredFilter('UNR-DEAD', deadAhuId);
    const dead = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: REASON });
    expect(dead.statusCode).toBe(409);
    expect(dead.json().error).toBe('PARENT_INACTIVE');
    expect(dead.json().message).toContain(`${PREFIX}-DEAD-AHU`);

    const ghostParent = randomUUID();
    const ghost = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: REASON, parentId: ghostParent });
    expect(ghost.statusCode).toBe(409);
    expect(ghost.json().message).toContain(ghostParent);
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.status).toBe('Retired');
  });

  it('restores under an explicit parent: Active again, relationships rebuilt, stash removed, audited', async () => {
    const id = await retiredFilter('UNR-OK', deadAhuId); // explicit parentId overrides the dead stash
    await prisma.assetInstance.update({ where: { id }, data: { customAttributes: { _preRetireParentId: deadAhuId, keep: 'me' } } });
    const res = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: REASON, parentId: h.ahuId });
    expect(res.statusCode).toBe(200);
    const inst = await prisma.assetInstance.findUnique({ where: { id } });
    expect(inst).toMatchObject({ status: 'Active', isActive: true, parentId: h.ahuId });
    expect(inst?.customAttributes).toEqual({ keep: 'me' });
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } }))?.currentLifecycleState).toBeNull();
    expect(await prisma.assetRelationship.count({ where: { sourceAssetId: h.ahuId, targetAssetId: id, relationshipType: 'CONTAINS' } })).toBe(1);
    expect(await prisma.assetRelationship.count({ where: { sourceAssetId: id, targetAssetId: h.ahuId, relationshipType: 'CONTAINED_IN' } })).toBe(1);
    const row = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    expect(row?.beforeValue).toMatchObject({ status: 'Retired' });
    expect(row?.afterValue).toMatchObject({ status: 'Active', parentId: h.ahuId, _sideEffects: { unretired: true } });
    expect((row?.afterValue as any)._sideEffects.replacementFilterDeleted).toBeUndefined();
  });

  it('a replaced filter: the replacement (and its cycles, events, tags) is destroyed, its parent inherited, the cascade audited', async () => {
    const id = await retiredFilter('UNR-REP', null);
    const repl = await newFilter('UNR-REPL', h.ahuId);
    const c = await cycle(repl, 'COMPLETED', 'UNR-REPL-C');
    await prisma.filterEvent.create({
      data: { filterId: repl, cycleId: c.id, eventType: 'CYCLE_STARTED', performedBy: saId, checksum: 'y'.repeat(64), ipAddress: '127.0.0.1' },
    });
    await prisma.assetIdentifier.create({ data: { assetId: repl, identifierType: 'RFID', identifierValue: `${PREFIX}-UNR-TAG` } });
    await prisma.filterDetails.upsert({ where: { assetInstanceId: repl }, update: { currentCycleId: c.id }, create: { assetInstanceId: repl, currentCycleId: c.id } });
    await auditLog({
      userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'FILTER_REPLACED', targetType: 'filter', targetId: id,
      afterValue: { oldFilterId: id, newFilterId: repl },
    });

    const res = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: REASON });
    expect(res.statusCode).toBe(200);
    expect(await prisma.assetInstance.count({ where: { id: repl } })).toBe(0);
    expect(await prisma.cleaningCycle.count({ where: { filterId: repl } })).toBe(0);
    expect(await prisma.filterEvent.count({ where: { filterId: repl } })).toBe(0);
    expect(await prisma.assetIdentifier.count({ where: { assetId: repl } })).toBe(0);
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.parentId).toBe(h.ahuId);
    const se = ((await lastAudit(id, 'MANUAL_RECORD_UPDATED'))?.afterValue as any)._sideEffects;
    expect(se.replacementFilterDeleted).toEqual({ replacementFilterId: repl, deletedCleaningCycles: 1, deletedFilterEvents: 1, deletedIdentifiers: 1 });
  });

  it('a replacement that no longer exists and no parent anywhere: restores parentless, nothing else destroyed', async () => {
    const id = await retiredFilter('UNR-ORPH', null);
    await auditLog({
      userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'FILTER_REPLACED', targetType: 'filter', targetId: id,
      afterValue: { oldFilterId: id, newFilterId: randomUUID() },
    });
    const res = await call('POST', `/api/super-admin/filter-data/retirements/${id}/unretire`, { _changeReason: REASON });
    expect(res.statusCode).toBe(200);
    expect(await prisma.assetInstance.findUnique({ where: { id } })).toMatchObject({ status: 'Active', parentId: null });
    expect(await prisma.assetRelationship.count({ where: { OR: [{ sourceAssetId: id }, { targetAssetId: id }] } })).toBe(0);
    const se = ((await lastAudit(id, 'MANUAL_RECORD_UPDATED'))?.afterValue as any)._sideEffects;
    expect(se).toEqual({ unretired: true });
  });

  it('404s for a filter that is not retired', async () => {
    const live = await newFilter('UNR-LIVE');
    expect((await call('POST', `/api/super-admin/filter-data/retirements/${live}/unretire`, { _changeReason: REASON })).statusCode).toBe(404);
  });
});

describe('replacement records (audit rows)', () => {
  it('POST validates both filters and the date, then writes a back-dated FILTER_REPLACED row + a marker', async () => {
    const oldF = await newFilter('REPOLD');
    const newF = await newFilter('REPNEW');
    const bad = async (p: Record<string, unknown>) => call('POST', '/api/super-admin/filter-data/replacements', { _changeReason: REASON, ...p });

    const r1 = await bad({ oldFilterId: randomUUID(), newFilterId: newF });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().message).toMatch(/old/);
    const r2 = await bad({ oldFilterId: oldF, newFilterId: randomUUID() });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().message).toMatch(/new/);
    const r3 = await bad({ oldFilterId: oldF, newFilterId: oldF });
    expect(r3.json()).toMatchObject({ error: 'INVALID', message: 'A filter cannot replace itself.' });
    const r4 = await bad({ oldFilterId: oldF, newFilterId: newF, replacedAt: 'nope' });
    expect(r4.json()).toMatchObject({ error: 'INVALID' });
    expect(await prisma.auditTrail.count({ where: { targetId: oldF } })).toBe(0);

    const replacedAt = '2023-11-12T10:00:00.000Z';
    const ok = await bad({ oldFilterId: oldF, newFilterId: newF, replacedAt, performedBy: 'night.shift', remarks: 'torn media' });
    expect(ok.statusCode).toBe(200);
    const row = await lastAudit(oldF, 'FILTER_REPLACED');
    expect(row?.timestamp.toISOString()).toBe(replacedAt);
    expect(row?.userName).toBe('night.shift');
    expect(row?.userId).toBe(SA);
    expect(row?.afterValue).toEqual({
      oldFilterId: oldF, oldFilterName: `${PREFIX}-REPOLD`, newFilterId: newF, newFilterName: `${PREFIX}-REPNEW`,
      remarks: 'torn media', manualEntry: true,
    });
    const marker = await lastAudit(oldF, 'MANUAL_RECORD_CREATED');
    expect(marker).toMatchObject({ targetType: 'replacement_record', reason: REASON, userName: SA });
    expect(marker?.afterValue).toMatchObject({ newFilterId: newF, remarks: 'torn media', replacedAt });

    // Defaults: now + acting user + null remarks.
    const def = await bad({ oldFilterId: newF, newFilterId: oldF });
    expect(def.statusCode).toBe(200);
    const defRow = await lastAudit(newF, 'FILTER_REPLACED');
    expect(defRow?.userName).toBe(SA);
    expect((defRow?.afterValue as any).remarks).toBeNull();
  });

  it('PUT edits the audit row in place (chainBroken), meta-audits the original values first; 404 for a non-replacement row', async () => {
    const oldF = await newFilter('REPEDOLD');
    const newF = await newFilter('REPEDNEW');
    await call('POST', '/api/super-admin/filter-data/replacements', { _changeReason: REASON, oldFilterId: oldF, newFilterId: newF, remarks: 'first' });
    const row = await lastAudit(oldF, 'FILTER_REPLACED');

    const wrongKind = await lastAudit(oldF, 'MANUAL_RECORD_CREATED');
    expect((await call('PUT', `/api/super-admin/filter-data/replacements/${wrongKind!.id}`, { _changeReason: REASON })).statusCode).toBe(404);

    const res = await call('PUT', `/api/super-admin/filter-data/replacements/${row!.id}`, {
      _changeReason: REASON, remarks: 'second', performedBy: 'other.tech', replacedAt: '2022-02-02T02:02:02.000Z',
      newFilterName: 'Renamed new', oldFilterName: 'Renamed old',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, chainBroken: true });
    const edited = await prisma.auditTrail.findUnique({ where: { id: row!.id } });
    expect(edited?.userName).toBe('other.tech');
    expect(edited?.timestamp.toISOString()).toBe('2022-02-02T02:02:02.000Z');
    expect(edited?.afterValue).toMatchObject({ remarks: 'second', newFilterName: 'Renamed new', oldFilterName: 'Renamed old', newFilterId: newF });
    const meta = await lastAudit(row!.id, 'AUDIT_RECORD_UPDATED');
    // The meta row is the ONLY surviving record of the original values (the
    // replacement row itself was rewritten in place), so its beforeValue must
    // carry them - not the edited ones.
    expect(meta?.beforeValue).toMatchObject({
      userName: SA, action: 'FILTER_REPLACED',
      afterValue: { remarks: 'first', oldFilterName: `${PREFIX}-REPEDOLD`, newFilterName: `${PREFIX}-REPEDNEW` },
    });
    expect((meta?.beforeValue as any).timestamp).toBe(row!.timestamp.toISOString());
    expect(meta?.userId).toBe(SA); // the actor column carries the username (compliance F3)
    expect(meta?.afterValue).toMatchObject({ userName: 'other.tech', afterValue: { remarks: 'second' } });
    expect(meta?.reason).toBe(REASON);

    // performedBy-only edit leaves afterValue untouched.
    const res2 = await call('PUT', `/api/super-admin/filter-data/replacements/${row!.id}`, { _changeReason: REASON, performedBy: 'third.tech' });
    expect(res2.statusCode).toBe(200);
    const meta2 = await lastAudit(row!.id, 'AUDIT_RECORD_UPDATED');
    expect((meta2?.afterValue as any).afterValue).toMatchObject({ remarks: 'second' });
    expect((await prisma.auditTrail.findUnique({ where: { id: row!.id } }))?.userName).toBe('third.tech');

    // An unparseable date fails INSIDE the transaction: the meta row written
    // first rolls back with it, and the record is untouched.
    const metaCount = await prisma.auditTrail.count({ where: { targetId: row!.id, action: 'AUDIT_RECORD_UPDATED' } });
    const bad = await call('PUT', `/api/super-admin/filter-data/replacements/${row!.id}`, { _changeReason: REASON, replacedAt: 'not-a-date' });
    expect(bad.statusCode).toBe(400);
    expect(await prisma.auditTrail.count({ where: { targetId: row!.id, action: 'AUDIT_RECORD_UPDATED' } })).toBe(metaCount);
    expect((await prisma.auditTrail.findUnique({ where: { id: row!.id } }))?.timestamp.toISOString()).toBe('2022-02-02T02:02:02.000Z');
  });

  it('DELETE physically removes the row through the guarded path, audits it first, and re-enables the trigger', async () => {
    const oldF = await newFilter('REPDELOLD');
    const newF = await newFilter('REPDELNEW');
    await call('POST', '/api/super-admin/filter-data/replacements', { _changeReason: REASON, oldFilterId: oldF, newFilterId: newF });
    const row = await lastAudit(oldF, 'FILTER_REPLACED');

    expect((await call('DELETE', `/api/super-admin/filter-data/replacements/${randomUUID()}`, { _changeReason: REASON })).statusCode).toBe(404);
    const blank = await call('DELETE', `/api/super-admin/filter-data/replacements/${row!.id}`, { _changeReason: '       ' });
    expect(blank.json().error).toBe('REASON_REQUIRED');

    const res = await call('DELETE', `/api/super-admin/filter-data/replacements/${row!.id}`, { _changeReason: REASON });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, chainBroken: true });
    expect(await prisma.auditTrail.count({ where: { id: row!.id } })).toBe(0);
    const meta = await lastAudit(row!.id, 'AUDIT_RECORD_DELETED');
    expect(meta?.beforeValue).toMatchObject({ id: row!.id, action: 'FILTER_REPLACED', targetId: oldF });
    expect(meta?.signatureMeaning).toMatch(/PHYSICALLY DELETED/);
    expect(meta).toMatchObject({ userId: SA, userName: SA });

    const trig = await prisma.$queryRawUnsafe<Array<{ tgenabled: string }>>(
      `SELECT tgenabled FROM pg_trigger WHERE tgrelid = '"audit_trail"'::regclass AND tgname = 'audit_trail_no_delete'`,
    );
    expect(trig).toHaveLength(1);
    expect(trig[0].tgenabled).toBe('O');
  });

  it('a FILTER_REPLACED row with no payload can still be given its fields', async () => {
    const target = await newFilter('REPBARE');
    const bare = await auditLog({ userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'FILTER_REPLACED', targetType: 'filter', targetId: target });
    const res = await call('PUT', `/api/super-admin/filter-data/replacements/${bare}`, { _changeReason: REASON, remarks: 'reconstructed', newFilterName: 'X' });
    expect(res.statusCode).toBe(200);
    expect((await prisma.auditTrail.findUnique({ where: { id: bare } }))?.afterValue).toEqual({ remarks: 'reconstructed', newFilterName: 'X' });
  });

  it('every record mutation refuses a whitespace-only reason before touching anything', async () => {
    const id = randomUUID();
    const routes: Array<['PUT' | 'POST' | 'DELETE', string]> = [
      ['PUT', `retirements/${id}`], ['POST', 'retirements'], ['DELETE', `retirements/${id}`], ['POST', `retirements/${id}/unretire`],
      ['PUT', `replacements/${id}`], ['POST', 'replacements'], ['DELETE', `replacements/${id}`],
    ];
    for (const [method, path] of routes) {
      const payload: Record<string, unknown> = { _changeReason: '      ' };
      if (path === 'retirements') payload.filterId = id;
      if (path === 'replacements') { payload.oldFilterId = id; payload.newFilterId = randomUUID(); }
      const res = await call(method, `/api/super-admin/filter-data/${path}`, payload);
      expect({ path, method, status: res.statusCode, error: res.json().error }).toEqual({ path, method, status: 400, error: 'REASON_REQUIRED' });
    }
  });

  it('every replacement endpoint is SUPER_ADMIN-only', async () => {
    const r = await call('POST', '/api/super-admin/filter-data/replacements', { _changeReason: REASON, oldFilterId: randomUUID(), newFilterId: randomUUID() }, { token: lowToken });
    expect(r.statusCode).toBe(403);
    expect((await call('PUT', `/api/super-admin/filter-data/replacements/${randomUUID()}`, { _changeReason: REASON }, { token: lowToken })).statusCode).toBe(403);
    expect((await call('DELETE', `/api/super-admin/filter-data/replacements/${randomUUID()}`, { _changeReason: REASON }, { token: lowToken })).statusCode).toBe(403);
  });
});

describe('SUPER_ADMIN_DATA_EDIT re-authentication', () => {
  // OD-01 (2026-10-22): ALWAYS required, whatever the re-auth policy says — so
  // no policy row is added; SUPER_ADMIN is asked although the policy may not list it.
  it('a mutation without a password is refused before any write; with one it is signed', async () => {
    const id = await retiredFilter('REAUTH');
    const refused = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, name: 'should-not-land' }, { reauth: false });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'SUPER_ADMIN_DATA_EDIT' });
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.name).toBe(`${PREFIX}-REAUTH`);
    expect(await prisma.auditTrail.count({ where: { targetId: id } })).toBe(0);

    const signed = await call('PUT', `/api/super-admin/filter-data/retirements/${id}`, { _changeReason: REASON, name: `${PREFIX}-REAUTH-OK` });
    expect(signed.statusCode).toBe(200);
    const row = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    const sig = await prisma.auditTrail.findFirst({
      // The signature row carries the username in userId (no userName).
      where: { action: 'REAUTH_SUCCESS', userId: SA, afterValue: { path: ['reauthAction'], equals: 'SUPER_ADMIN_DATA_EDIT' } },
      orderBy: { chainPosition: 'desc' },
    });
    expect(sig).not.toBeNull();
    expect(row?.signatureAuditId).toBe(sig!.id);
  });
});
