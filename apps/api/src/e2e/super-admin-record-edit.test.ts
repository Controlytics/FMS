/**
 * e2e — SUPER_ADMIN record edits launched from the user-facing pages
 * (super-admin/record-edit-routes.ts): RFID Track Record row, Filters page
 * "every column" edit, Stage Approval record.
 *
 * RFID rows ARE audit rows (ASSET_IDENTIFIER_CREATED = Assigned,
 * ASSET_IDENTIFIER_DELETED = Removed): an edit rewrites the row (chain break,
 * meta-audited first) and, only when the row is the tag's LATEST event,
 * corrects the live asset_identifiers row (update / create / delete / none) or
 * refuses the two states that cannot be made consistent silently (409).
 *
 * Owns its SUPER_ADMIN, a low user + role, BLOCK -> AHU (+ a second AHU and a
 * deactivated AHU) and every filter, tag, approval and audit row it edits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, cleanupAll,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const PREFIX = `ZZSARE-${SUF}`;
const SA = `cv_sare_sa_${SUF}`.toLowerCase();
const SA_PW = 'CovSare@2026x';
const LOW = `cv_sare_low_${SUF}`.toLowerCase();
const LOW_PW = 'CovSareLow@2026x';
const LOW_ROLE = `CVSARE_${SUF}`;
const REASON = 'coverage: record edits';
const tag = (n: string) => `${PREFIX}-${n}`.toUpperCase();

let app: FastifyInstance;
let saToken = '', lowToken = '';
let saId = '', lowId = '';
let h: Awaited<ReturnType<typeof createHierarchy>>;
let ahu2 = '', deadAhu = '';
const filterIds: string[] = [];

const call = (method: 'PUT', url: string, payload: unknown, token?: string) =>
  app.inject({
    method, url,
    headers: { authorization: `Bearer ${token ?? saToken}`, 'x-reauth-password': token === lowToken ? LOW_PW : SA_PW },
    payload: payload as Record<string, unknown>,
  });
const newFilter = async (n: string, ahu = h.ahuId) => { const id = await createFilter(ahu, `${PREFIX}-${n}`); filterIds.push(id); return id; };
const lastAudit = (targetId: string, action: string) =>
  prisma.auditTrail.findFirst({ where: { targetId, action }, orderBy: { chainPosition: 'desc' } });

/** An Assigned / Removed track-record row exactly as identifierService writes them. */
const rfidRow = async (kind: 'ASSIGN' | 'REMOVE', value: string, assetId: string, at: Date, extra: Record<string, unknown> = {}) => {
  const payload = { assetId, identifierType: 'RFID', identifierValue: value, filterName: 'fx', ...extra };
  const id = await auditLog({
    userId: LOW, userName: LOW, userRole: LOW_ROLE,
    action: kind === 'ASSIGN' ? 'ASSET_IDENTIFIER_CREATED' : 'ASSET_IDENTIFIER_DELETED',
    targetType: 'asset_identifier', targetId: randomUUID(), timestamp: at,
    beforeValue: kind === 'ASSIGN' ? undefined : payload,
    afterValue: kind === 'ASSIGN' ? payload : { deleted: true },
    reason: kind === 'REMOVE' ? 'damaged' : undefined,
  });
  return id;
};
const liveTag = (value: string) => prisma.assetIdentifier.findUnique({ where: { identifierValue: value } });

beforeAll(async () => {
  app = await buildApp([{ prefix: '/api/super-admin', plugin: superAdminRoutes }]);
  saId = await createUser(SA, 'SUPER_ADMIN', SA_PW, 'Record Edit SA');
  await createRole(LOW_ROLE, ['AUDIT_READ']);
  lowId = await createUser(LOW, LOW_ROLE, LOW_PW, 'Record Edit Low');
  saToken = await login(app, SA, SA_PW);
  lowToken = await login(app, LOW, LOW_PW);
  h = await createHierarchy(PREFIX);
  ahu2 = (await prisma.assetInstance.create({ data: { name: `${PREFIX}-AHU2`, templateId: h.ahuTemplateId, parentId: h.blockId } })).id;
  deadAhu = (await prisma.assetInstance.create({ data: { name: `${PREFIX}-DEADAHU`, templateId: h.ahuTemplateId, parentId: h.blockId, isActive: false } })).id;
}, 120_000);

afterAll(async () => {
  try {
    await cleanupAll([
      ['filters', () => deleteFilters(filterIds)],
      ['hierarchy', () => deleteHierarchy(h, [ahu2, deadAhu].filter(Boolean))],
      ['users', () => deleteUsers([saId, lowId])],
      ['roles', () => deleteRoles([LOW_ROLE])],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('PUT /filter-data/rfid-events/:id', () => {
  const url = (id: string) => `/api/super-admin/filter-data/rfid-events/${id}`;

  it('rewrites a latest Assigned row and MOVES the live tag to the corrected number (meta-audited, chainBroken)', async () => {
    const fa = await newFilter('RF-A');
    const t1 = tag('T1');
    await prisma.assetIdentifier.create({ data: { assetId: fa, identifierType: 'RFID', identifierValue: t1, isPrimary: true } });
    const rowId = await rfidRow('ASSIGN', t1, fa, new Date('2026-01-01T00:00:00Z'), { id: 'ident-x', isPrimary: true });

    const res = await call('PUT', url(rowId), {
      _changeReason: REASON, rfidNumber: ` ${tag('T1B')} `, timestamp: '2026-01-02T00:00:00.000Z', userId: saId, remarks: 'typo in tag',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, chainBroken: true, liveTag: 'update', liveTagNote: 'Live tag moved to match the edited assignment.' });
    expect(await liveTag(t1)).toBeNull();
    expect(await liveTag(tag('T1B'))).toMatchObject({ assetId: fa, updatedBy: saId });

    const row = await prisma.auditTrail.findUnique({ where: { id: rowId } });
    expect(row).toMatchObject({ action: 'ASSET_IDENTIFIER_CREATED', userId: saId, userName: SA, reason: 'typo in tag' });
    expect(row?.timestamp.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(row?.afterValue).toMatchObject({ id: 'ident-x', isPrimary: true, identifierValue: tag('T1B'), assetId: fa });
    const meta = await lastAudit(rowId, 'AUDIT_RECORD_UPDATED');
    expect(meta).toMatchObject({ userId: SA, userName: SA, targetType: 'audit_trail', reason: REASON });
    expect(meta?.beforeValue).toMatchObject({ action: 'ASSET_IDENTIFIER_CREATED', userName: LOW, afterValue: { identifierValue: t1 } });
    expect(meta?.afterValue).toMatchObject({ _liveTag: 'update', afterValue: { identifierValue: tag('T1B') } });

    // Flipping the same (still latest) row to Removed takes the live tag away.
    const flip = await call('PUT', url(rowId), { _changeReason: REASON, event: 'REMOVE' });
    expect(flip.json()).toMatchObject({ liveTag: 'delete', liveTagNote: 'Live tag removed to match the edited record.' });
    expect(await liveTag(tag('T1B'))).toBeNull();
    const flipped = await prisma.auditTrail.findUnique({ where: { id: rowId } });
    expect(flipped).toMatchObject({ action: 'ASSET_IDENTIFIER_DELETED', afterValue: { deleted: true } });
    expect(flipped?.beforeValue).toMatchObject({ identifierValue: tag('T1B'), assetId: fa });

    // Removed again with nothing live: nothing to remove.
    const again = await call('PUT', url(rowId), { _changeReason: REASON, remarks: 'still removed' });
    expect(again.json()).toMatchObject({ liveTag: 'none', liveTagNote: 'No live tag to remove.' });
  });

  it('a corrected number typed in lower case / read doubled is stored canonically, in the row AND the live tag (A-11)', async () => {
    const fx = await newFilter('RF-CANON');
    const t = tag('CANON');
    await prisma.assetIdentifier.create({ data: { assetId: fx, identifierType: 'RFID', identifierValue: t, isPrimary: true } });
    const rowId = await rfidRow('ASSIGN', t, fx, new Date('2026-01-03T00:00:00Z'));
    const fixed = tag('CANON2');
    const res = await call('PUT', url(rowId), { _changeReason: REASON, rfidNumber: ` ${(fixed + fixed).toLowerCase()} ` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().liveTag).toBe('update');
    expect((await prisma.auditTrail.findUnique({ where: { id: rowId } }))?.afterValue).toMatchObject({ identifierValue: fixed });
    expect(await liveTag(fixed)).toMatchObject({ assetId: fx });
    expect(await prisma.assetIdentifier.count({ where: { identifierValue: { equals: fixed, mode: 'insensitive' } } })).toBe(1);
  });

  it('a Removed row flipped to Assigned re-creates the live tag; moving it to another filter resolves the name', async () => {
    const fb = await newFilter('RF-B');
    const fc = await newFilter('RF-C');
    const t2 = tag('T2');
    const rowId = await rfidRow('REMOVE', t2, fb, new Date('2026-02-01T00:00:00Z'));
    const res = await call('PUT', url(rowId), { _changeReason: REASON, event: 'ASSIGN', filterId: fc });
    expect(res.json()).toMatchObject({ liveTag: 'create', liveTagNote: 'Live tag created to match the edited assignment.' });
    expect(await liveTag(t2)).toMatchObject({ assetId: fc, identifierType: 'RFID', isPrimary: true, createdBy: saId });
    expect((await prisma.auditTrail.findUnique({ where: { id: rowId } }))?.afterValue).toMatchObject({ assetId: fc, filterName: `${PREFIX}-RF-C` });

    // Already matching: no change to the live table.
    const same = await call('PUT', url(rowId), { _changeReason: REASON, remarks: 'confirm' });
    expect(same.json()).toMatchObject({ liveTag: 'none', liveTagNote: 'Live tag already matches.' });
  });

  it('an older row is a history-only edit: a later event owns the tag\'s live state', async () => {
    const fd = await newFilter('RF-D');
    const t3 = tag('T3');
    const older = await rfidRow('ASSIGN', t3, fd, new Date('2025-03-01T00:00:00Z'));
    await rfidRow('REMOVE', t3, fd, new Date('2025-03-05T00:00:00Z'));
    const res = await call('PUT', url(older), { _changeReason: REASON, remarks: 'history fix' });
    expect(res.json()).toMatchObject({ liveTag: 'none', liveTagNote: 'History row only - a later event describes the current state of this tag.' });
    expect(await liveTag(t3)).toBeNull();

    const removeOlder = await rfidRow('REMOVE', tag('T3R'), fd, new Date('2025-04-01T00:00:00Z'));
    await rfidRow('ASSIGN', tag('T3R'), fd, new Date('2025-04-02T00:00:00Z'));
    const r2 = await call('PUT', url(removeOlder), { _changeReason: REASON, remarks: 'x' });
    expect(r2.json().liveTagNote).toBe('History row only - a later event describes the current state of this tag.');
  });

  it('a row carrying no tag number and no filter leaves the live table alone', async () => {
    const id = await auditLog({
      userId: LOW, userRole: LOW_ROLE, action: 'ASSET_IDENTIFIER_CREATED', targetType: 'asset_identifier', targetId: randomUUID(),
      afterValue: { identifierType: 'RFID' },
    });
    const res = await call('PUT', url(id), { _changeReason: REASON, remarks: 'empty payload' });
    expect(res.statusCode).toBe(200);
    expect(res.json().liveTag).toBe('none');

    const noFilter = await rfidRow('ASSIGN', tag('NOFLT'), null as unknown as string, new Date('2026-03-01T00:00:00Z'));
    const r2 = await call('PUT', url(noFilter), { _changeReason: REASON, remarks: 'no filter' });
    expect(r2.json()).toMatchObject({ liveTag: 'none', liveTagNote: 'No filter on the row; live tag left unchanged.' });

    // An Assigned row written with no payload at all (afterValue null).
    const bare = await auditLog({
      userId: LOW, userRole: LOW_ROLE, action: 'ASSET_IDENTIFIER_CREATED', targetType: 'asset_identifier', targetId: randomUUID(),
    });
    const r3 = await call('PUT', url(bare), { _changeReason: REASON, remarks: 'null payload' });
    expect(r3.json().liveTag).toBe('none');
    expect((await prisma.auditTrail.findUnique({ where: { id: bare } }))?.afterValue).toMatchObject({ identifierType: 'RFID', identifierValue: '', assetId: null });
  });

  it('an older row naming a filter that no longer exists stays a history-only edit', async () => {
    const goneFilter = randomUUID();
    const older = await rfidRow('ASSIGN', tag('GONE'), goneFilter, new Date('2025-07-01T00:00:00Z'));
    await rfidRow('REMOVE', tag('GONE'), goneFilter, new Date('2025-07-02T00:00:00Z'));
    const res = await call('PUT', url(older), { _changeReason: REASON, remarks: 'filter deleted since' });
    expect(res.statusCode).toBe(200);
    expect(res.json().liveTag).toBe('none');
    expect(await liveTag(tag('GONE'))).toBeNull();
  });

  it('refuses the two inconsistent states with 409 and leaves the row untouched', async () => {
    const fe = await newFilter('RF-E');
    const ff = await newFilter('RF-F');
    await prisma.assetIdentifier.create({ data: { assetId: ff, identifierType: 'RFID', identifierValue: tag('T-FF') } });
    const rowId = await rfidRow('ASSIGN', tag('T5'), fe, new Date('2026-04-01T00:00:00Z'));
    await prisma.assetIdentifier.create({ data: { assetId: fe, identifierType: 'RFID', identifierValue: tag('T5') } });

    // Moving the assignment onto a filter that already holds a different tag.
    const other = await call('PUT', url(rowId), { _changeReason: REASON, filterId: ff });
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ error: 'ENTITY_HAS_IDENTIFIER', message: `${PREFIX}-RF-F already has tag ${tag('T-FF')} - remove it first.` });

    // Renaming it to a number that is live on another filter.
    const dupe = await call('PUT', url(rowId), { _changeReason: REASON, rfidNumber: tag('T-FF') });
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error).toBe('DUPLICATE_IDENTIFIER_VALUE');

    expect((await prisma.auditTrail.findUnique({ where: { id: rowId } }))?.afterValue).toMatchObject({ identifierValue: tag('T5'), assetId: fe });
    expect(await prisma.auditTrail.count({ where: { targetId: rowId, action: 'AUDIT_RECORD_UPDATED' } })).toBe(0);
    expect(await liveTag(tag('T5'))).toMatchObject({ assetId: fe });
  });

  it('validates the row, timestamp, filter and user', async () => {
    const fg = await newFilter('RF-G');
    const rowId = await rfidRow('ASSIGN', tag('T6'), fg, new Date('2026-05-01T00:00:00Z'));
    expect((await call('PUT', url(randomUUID()), { _changeReason: REASON })).statusCode).toBe(404);
    const notRfid = await auditLog({ userId: SA, userRole: 'SUPER_ADMIN', action: 'CONFIG_CHANGED', targetType: 'system_config', targetId: `x-${SUF}` });
    expect((await call('PUT', url(notRfid), { _changeReason: REASON })).json().message).toBe('RFID track record row not found');
    expect((await call('PUT', url(rowId), { _changeReason: REASON, timestamp: 'nope' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'timestamp must be a valid date-time' });
    expect((await call('PUT', url(rowId), { _changeReason: REASON, filterId: randomUUID() })).json().message).toBe('Filter not found');
    expect((await call('PUT', url(rowId), { _changeReason: REASON, userId: randomUUID() })).json().message).toBe('User not found');
    expect((await call('PUT', url(rowId), { _changeReason: REASON, rfidNumber: '' })).statusCode).toBe(400); // schema minLength
    expect((await call('PUT', url(rowId), { _changeReason: '      ' })).json().error).toBe('REASON_REQUIRED');
    expect((await call('PUT', url(rowId), { _changeReason: REASON }, lowToken)).statusCode).toBe(403);
    expect(await prisma.auditTrail.count({ where: { targetId: rowId, action: 'AUDIT_RECORD_UPDATED' } })).toBe(0);
  });
});

describe('PUT /filter-data/filters/:id (Filters page, every column)', () => {
  const url = (id: string) => `/api/super-admin/filter-data/filters/${id}`;

  it('applies state, name, set, AHU move and RFID through the owning services, then audits the whole before/after', async () => {
    const id = await newFilter('FP-1');
    const res = await call('PUT', url(id), {
      _changeReason: REASON, lifecycleState: 'INSTALLED', name: `${PREFIX}-FP-1-RENAMED`, filterSet: 'A', ahuId: ahu2, rfidNumber: tag('FP1'),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toEqual(['lifecycleState', 'name', 'filterSet', 'ahuId', 'rfid']);
    expect(body.data).toMatchObject({ name: `${PREFIX}-FP-1-RENAMED`, ahuId: ahu2, parentId: ahu2, filterSet: 'SET_A', currentLifecycleState: 'INSTALLED', rfid: [tag('FP1')] });

    expect(await prisma.assetRelationship.count({ where: { sourceAssetId: ahu2, targetAssetId: id, relationshipType: 'CONTAINS' } })).toBe(1);
    expect(await prisma.assetRelationship.count({ where: { sourceAssetId: id, targetAssetId: ahu2, relationshipType: 'CONTAINED_IN' } })).toBe(1);
    const row = await lastAudit(id, 'MANUAL_RECORD_UPDATED');
    expect(row).toMatchObject({ targetType: 'filter', reason: REASON, userName: SA });
    expect(row?.beforeValue).toMatchObject({ name: `${PREFIX}-FP-1`, ahuId: h.ahuId, filterSet: null, rfid: [] });
    expect(row?.afterValue).toMatchObject({ name: `${PREFIX}-FP-1-RENAMED`, _sideEffects: { applied: body.applied } });
    expect(row?.signatureMeaning).toBe(`Filter "${PREFIX}-FP-1-RENAMED" manually edited via Filter Data Management`);
    // The owning services wrote their own rows.
    expect(await prisma.auditTrail.count({ where: { targetId: id, action: 'ASSET_UPDATED' } })).toBe(1);
    expect(await prisma.auditTrail.count({ where: { action: 'ASSET_IDENTIFIER_CREATED', afterValue: { path: ['identifierValue'], equals: tag('FP1') } } })).toBe(1);

    // Re-sending the same state / tag is not a change; '' clears the set and removes the tag.
    const res2 = await call('PUT', url(id), { _changeReason: REASON, lifecycleState: 'INSTALLED', rfidNumber: tag('FP1'), ahuId: ahu2 });
    expect(res2.json().applied).toEqual([]);
    const res3 = await call('PUT', url(id), { _changeReason: REASON, filterSet: '', rfidNumber: '' });
    expect(res3.json().applied).toEqual(['filterSet', 'rfid']);
    expect(res3.json().data).toMatchObject({ filterSet: null, rfid: [] });
    const removed = await prisma.auditTrail.findFirst({
      where: { action: 'ASSET_IDENTIFIER_DELETED', beforeValue: { path: ['identifierValue'], equals: tag('FP1') } },
    });
    expect(removed?.reason).toBe(REASON);
    // '' on a filter with no set: nothing to clear.
    expect((await call('PUT', url(id), { _changeReason: REASON, filterSet: '' })).json().applied).toEqual([]);
  });

  it('compares and stores tag numbers canonically: the same tag in lower case is no change; another filter\'s tag in lower case is refused up front (A-11)', async () => {
    const id = await newFilter('FP-CANON');
    const other = await newFilter('FP-CANON-OTHER');
    const mine = tag('FPC-MINE');
    const theirs = tag('FPC-THEIRS');
    await prisma.assetIdentifier.create({ data: { assetId: id, identifierType: 'RFID', identifierValue: mine } });
    await prisma.assetIdentifier.create({ data: { assetId: other, identifierType: 'RFID', identifierValue: theirs } });

    // Same tag, typed in lower case: nothing to do - no remove / re-assign churn.
    const same = await call('PUT', url(id), { _changeReason: REASON, rfidNumber: mine.toLowerCase() });
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json().applied).toEqual([]);
    const tagRows = await prisma.auditTrail.count({
      where: { action: { in: ['ASSET_IDENTIFIER_CREATED', 'ASSET_IDENTIFIER_DELETED'] }, OR: [
        { afterValue: { path: ['identifierValue'], equals: mine } }, { beforeValue: { path: ['identifierValue'], equals: mine } },
      ] },
    });
    expect(tagRows).toBe(0);

    // Another filter's tag, typed in lower case: refused before anything is written.
    const taken = await call('PUT', url(id), { _changeReason: REASON, rfidNumber: theirs.toLowerCase(), name: `${PREFIX}-FP-CANON-X` });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: 'DUPLICATE_IDENTIFIER_VALUE', message: `Tag ${theirs} is live on another filter - remove it there first.` });
    expect((await prisma.filter.findUnique({ where: { id } }))?.name).toBe(`${PREFIX}-FP-CANON`);
    expect(await liveTag(mine)).toMatchObject({ assetId: id });

    // A new tag read doubled is stored once, canonically.
    const fresh = tag('FPC-NEW');
    const res = await call('PUT', url(id), { _changeReason: REASON, rfidNumber: (fresh + fresh).toLowerCase() });
    expect(res.json()).toMatchObject({ applied: ['rfid'], data: { rfid: [fresh] } });
  });

  it('replaces a different current tag with the new number', async () => {
    const id = await newFilter('FP-2');
    await prisma.assetIdentifier.create({ data: { assetId: id, identifierType: 'RFID', identifierValue: tag('FP2-OLD') } });
    const res = await call('PUT', url(id), { _changeReason: REASON, rfidNumber: tag('FP2-NEW') });
    expect(res.json().applied).toEqual(['rfid']);
    expect(await liveTag(tag('FP2-OLD'))).toBeNull();
    expect(await liveTag(tag('FP2-NEW'))).toMatchObject({ assetId: id });
  });

  it('a name the field service would refuse is refused BEFORE the lifecycle move commits', async () => {
    const id = await newFilter('FP-5');
    await newFilter('FP-5-TAKEN');
    for (const [name, message] of [
      [`${PREFIX}-FP-5-TAKEN`, `A filter with the name "${PREFIX}-FP-5-TAKEN" already exists`],
      [`  ${PREFIX.toLowerCase()}-fp-5-taken  `, `A filter with the name "${PREFIX.toLowerCase()}-fp-5-taken" already exists`],
      ['   ', 'Filter Name is required'],
    ] as const) {
      const res = await call('PUT', url(id), { _changeReason: REASON, lifecycleState: 'INSTALLED', name });
      expect({ name, status: res.statusCode, message: res.json().message }).toEqual({ name, status: 400, message });
    }
    // Nothing applied: no state, no stage event, no audit row of any kind.
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } })).toBeNull();
    expect(await prisma.filterEvent.count({ where: { filterId: id } })).toBe(0);
    expect(await prisma.auditTrail.count({ where: { targetId: id } })).toBe(0);
    expect((await prisma.filter.findUnique({ where: { id } }))?.name).toBe(`${PREFIX}-FP-5`);
  });

  it('validates up front: unknown filter 404, inactive AHU 400, tag live elsewhere 409 - nothing changed', async () => {
    expect((await call('PUT', url(randomUUID()), { _changeReason: REASON, name: 'x' })).statusCode).toBe(404);
    const id = await newFilter('FP-3');
    const other = await newFilter('FP-3-OTHER');
    await prisma.assetIdentifier.create({ data: { assetId: other, identifierType: 'RFID', identifierValue: tag('FP3-TAKEN') } });

    const dead = await call('PUT', url(id), { _changeReason: REASON, ahuId: deadAhu, name: `${PREFIX}-FP-3-X` });
    expect(dead.statusCode).toBe(400);
    expect(dead.json().message).toBe('Target AHU not found or inactive');
    const taken = await call('PUT', url(id), { _changeReason: REASON, rfidNumber: tag('FP3-TAKEN'), name: `${PREFIX}-FP-3-X` });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('DUPLICATE_IDENTIFIER_VALUE');

    expect((await prisma.filter.findUnique({ where: { id } }))?.name).toBe(`${PREFIX}-FP-3`);
    expect(await prisma.auditTrail.count({ where: { targetId: id } })).toBe(0);
  });

  it('is SUPER_ADMIN-only, and a whitespace-only reason is refused before any write', async () => {
    const id = await newFilter('FP-4');
    expect((await call('PUT', url(id), { _changeReason: REASON, name: 'x' }, lowToken)).statusCode).toBe(403);
    const blank = await call('PUT', url(id), { _changeReason: '       ', name: `${PREFIX}-FP-4-X`, lifecycleState: 'INSTALLED' });
    expect(blank.json().error).toBe('REASON_REQUIRED');
    expect((await prisma.filter.findUnique({ where: { id } }))?.name).toBe(`${PREFIX}-FP-4`);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: id } })).toBeNull();
  });
});

describe('PUT /filter-data/stage-approvals/:id', () => {
  const url = (id: string) => `/api/super-admin/filter-data/stage-approvals/${id}`;
  const mkApproval = async (snapshot: object = { filterName: 'Stage Filter' }) => {
    const filterId = filterIds[0] ?? randomUUID();
    return prisma.cleaningStageApproval.create({
      data: {
        cycleId: randomUUID(), filterId, stageKey: 'WASH_OUT', approverRole: LOW_ROLE, rejectToStateKey: 'WASH_IN',
        detailsSnapshot: snapshot, requestedBy: lowId, requestedByName: LOW,
      },
    });
  };

  it('records a decision (no side effects), then clears it back to PENDING; audited', async () => {
    const a = await mkApproval();
    const res = await call('PUT', url(a.id), {
      _changeReason: REASON, status: 'APPROVED', approverRole: ` ${LOW_ROLE} `, requestedBy: saId, requestedAt: '2026-06-01T00:00:00.000Z',
      decidedBy: lowId, decidedAt: '2026-06-02T00:00:00.000Z', decisionRemarks: '  looks clean  ',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'APPROVED', requestedBy: saId, requestedByName: SA, decidedBy: lowId, decidedByName: LOW, decisionRemarks: 'looks clean' });
    const row = await lastAudit(a.id, 'MANUAL_RECORD_UPDATED');
    expect(row).toMatchObject({ targetType: 'cleaning_stage_approval', reason: REASON });
    expect(row?.signatureMeaning).toBe('Stage approval (WASH_OUT) for filter "Stage Filter" manually edited via Filter Data Management');
    expect(row?.beforeValue).toMatchObject({ status: 'PENDING', decidedBy: null });
    expect(row?.afterValue).toMatchObject({ status: 'APPROVED', decidedBy: lowId });

    const back = await call('PUT', url(a.id), { _changeReason: REASON, status: 'PENDING', decidedBy: '', decidedAt: '', decisionRemarks: '  ' });
    expect(back.statusCode).toBe(200);
    expect(await prisma.cleaningStageApproval.findUnique({ where: { id: a.id } })).toMatchObject({
      status: 'PENDING', decidedBy: null, decidedByName: null, decidedAt: null, decisionRemarks: null,
    });
  });

  it('a snapshot without a filter name labels the audit row by filter id', async () => {
    const a = await mkApproval({});
    expect((await call('PUT', url(a.id), { _changeReason: REASON, status: 'SUPERSEDED' })).statusCode).toBe(200);
    expect((await lastAudit(a.id, 'MANUAL_RECORD_UPDATED'))?.signatureMeaning).toContain(`for filter "${a.filterId}"`);
  });

  it('refuses unknown references, blank / bad dates, an empty edit and every half-decided state', async () => {
    const a = await mkApproval();
    const put = (p: object) => call('PUT', url(a.id), { _changeReason: REASON, ...p });
    expect((await call('PUT', url(randomUUID()), { _changeReason: REASON, status: 'APPROVED' })).statusCode).toBe(404);
    expect((await put({ approverRole: `NOPE_${SUF}` })).json().message).toBe(`Role "NOPE_${SUF}" not found`);
    expect((await put({ requestedAt: '' })).json()).toMatchObject({ error: 'INVALID_VALUE', message: 'requestedAt cannot be blank' });
    expect((await put({ decidedAt: 'bad' })).json().message).toBe('decidedAt must be a valid date-time');
    expect((await put({ requestedBy: randomUUID() })).json().message).toBe('User for requestedBy not found');
    expect((await put({ decidedBy: randomUUID() })).json().message).toBe('User for decidedBy not found');
    expect((await put({})).json()).toMatchObject({ error: 'NO_CHANGES' });
    expect((await put({ decidedBy: lowId })).json().message).toMatch(/A PENDING approval cannot carry/);
    expect((await put({ status: 'APPROVED', decidedBy: lowId })).json().message).toBe('An APPROVED approval needs both decided-by and decided-at.');
    expect((await put({ status: 'REJECTED', decidedBy: lowId, decidedAt: '2026-06-03T00:00:00.000Z' })).json().message).toBe('A REJECTED approval needs decision remarks.');
    expect((await put({ status: 'MAYBE' })).statusCode).toBe(400); // schema enum
    expect((await call('PUT', url(a.id), { _changeReason: '      ', status: 'APPROVED' })).json().error).toBe('REASON_REQUIRED');
    expect(await prisma.auditTrail.count({ where: { targetId: a.id } })).toBe(0);
    expect((await prisma.cleaningStageApproval.findUnique({ where: { id: a.id } }))?.status).toBe('PENDING');

    const ok = await put({ status: 'REJECTED', decidedBy: lowId, decidedAt: '2026-06-03T00:00:00.000Z', decisionRemarks: 'dirty' });
    expect(ok.statusCode).toBe(200);
  });
});
