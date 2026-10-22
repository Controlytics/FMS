/**
 * The lib/ helpers whose whole job is a database effect, against real Prisma on
 * digilog_test_db with fixtures this file owns (prefix `cvl`):
 *   filter-details      upsertFilterDetails
 *   filter-attributes   zipFilterAttributes
 *   last-cleaned        zipLastCleaned
 *   idempotency         findExistingByClientOpId / ...Start... / ...InLatestCycle / withClientOpId
 *   typed-asset-dispatch kind lookup, shape translation, dual-write create/update/soft-delete
 *
 * Each assertion is the row a caller (or a later reader) observes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import { upsertFilterDetails } from '../filter-details.js';
import { zipFilterAttributes } from '../filter-attributes.js';
import { zipLastCleaned, CLEANING_STAGE_EVENT_TYPES } from '../last-cleaned.js';
import {
  findExistingByClientOpId, findExistingStartByClientOpId,
  findExistingByClientOpIdInLatestCycle, withClientOpId,
} from '../idempotency.js';
import * as typedAssetDispatch from '../typed-asset-dispatch.js';
import {
  kindFromInstanceId, isHierarchyKind, translateToTypedShape,
  dispatchUpdate,
} from '../typed-asset-dispatch.js';
import {
  cleanupAll, runSuffix, createRole, createUser, deleteUsers, deleteRoles,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy, createCleaningProfile,
} from '../../e2e/support/owned-fixtures.js';

const SFX = runSuffix();
const P = `cvl-${SFX}`;
const ROLE = `CVLR${SFX}`.slice(0, 20);
const PW = 'Cvl@Pass123!';

let userId = '';
let hier: Awaited<ReturnType<typeof createHierarchy>> | undefined;
let filterA = '', filterB = '', filterC = '', filterNone = '';
let profileId = '';
let cycleA1 = '', cycleA2 = '', cycleB1 = '', cycleC1 = '';
const extraTemplateIds: string[] = [];
const extraInstanceIds: string[] = [];
let customKindCode = '';

const T_CYCLE_DONE = new Date('2026-03-01T08:00:00.000Z');
const T_EVENT = new Date('2026-03-05T09:30:00.000Z');

async function makeCycle(filterId: string, code: string, extra: Record<string, unknown>) {
  const c = await prisma.cleaningCycle.create({
    data: {
      cycleCode: `${P}-${code}`, filterId, profileId, profileVersion: 3, sequenceNumber: 1,
      cleaningReasonKey: 'ROUTINE', cleaningReasonLabel: 'Routine', ...extra,
    } as any,
  });
  return c.id;
}

async function makeEvent(filterId: string, cycleId: string | null, eventType: string, performedAt: Date, attributes: Record<string, unknown>) {
  await prisma.filterEvent.create({
    data: {
      filterId, cycleId, eventType: eventType as any, performedBy: userId, performedAt,
      attributes: attributes as any, checksum: 'x'.repeat(64), ipAddress: '127.0.0.1',
    },
  });
}

beforeAll(async () => {
  await createRole(ROLE, []);
  userId = await createUser(`cvl_${SFX.toLowerCase()}`, ROLE, PW);
  hier = await createHierarchy(P);
  profileId = await createCleaningProfile(`${P}-profile`, userId);
  filterA = await createFilter(hier.ahuId, `${P}-FA`);
  filterB = await createFilter(hier.ahuId, `${P}-FB`);
  filterC = await createFilter(hier.ahuId, `${P}-FC`);
  filterNone = await createFilter(hier.ahuId, `${P}-FN`);
  await prisma.filter.update({ where: { id: filterA }, data: { attributes: { micronSize: '5', filterSize: '24x24' } } });

  // A: an older COMPLETED cycle, then a newer in-progress one with a later stage event.
  cycleA1 = await makeCycle(filterA, 'A1', { status: 'COMPLETED', startedAt: new Date('2026-02-28T08:00:00Z'), completedAt: T_CYCLE_DONE });
  cycleA2 = await makeCycle(filterA, 'A2', { startedAt: new Date('2026-03-05T08:00:00Z') });
  await makeEvent(filterA, cycleA1, 'STATE_TRANSITION', new Date('2026-02-28T09:00:00Z'), { clientOpId: `${P}-op-old` });
  await makeEvent(filterA, cycleA2, 'CYCLE_STARTED', new Date('2026-03-05T08:00:00Z'), { clientOpId: `${P}-start` });
  await makeEvent(filterA, cycleA2, 'STATE_TRANSITION', T_EVENT, { clientOpId: `${P}-op-new` });
  // A non-cleaning event type that is LATER must not move "last cleaned".
  await makeEvent(filterA, null, 'REMARK_ADDED', new Date('2026-04-01T00:00:00Z'), {});
  // B: only a completed cycle, no events.
  cycleB1 = await makeCycle(filterB, 'B1', { status: 'COMPLETED', startedAt: new Date('2026-01-01T00:00:00Z'), completedAt: new Date('2026-01-01T06:00:00Z') });
  // C: a legacy COMPLETED cycle with no completedAt contributes nothing.
  cycleC1 = await makeCycle(filterC, 'C1', { status: 'COMPLETED', startedAt: new Date('2025-01-01T00:00:00Z'), completedAt: null });
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['filters', () => deleteFilters([filterA, filterB, filterC, filterNone])],
    ['cycles', () => prisma.cleaningCycle.deleteMany({ where: { id: { in: [cycleA1, cycleA2, cycleB1, cycleC1].filter(Boolean) } } })],
    ['extra instances (typed)', async () => {
      const ids = extraInstanceIds;
      await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: ids } }, { targetAssetId: { in: ids } }] } });
      // Children first: the forward mirror removes the typed row with its asset_instances row.
      for (const id of [...ids].reverse()) await prisma.assetInstance.deleteMany({ where: { id } });
      await prisma.block.deleteMany({ where: { id: { in: ids } } });
    }],
    ['extra templates', () => prisma.assetTemplate.deleteMany({ where: { id: { in: extraTemplateIds } } })],
    ['custom kind', () => (customKindCode ? prisma.templateKind.deleteMany({ where: { code: customKindCode } }) : Promise.resolve())],
    ['profile', () => (profileId ? prisma.filterCleaningProfile.deleteMany({ where: { id: profileId } }) : Promise.resolve())],
    ['hierarchy', () => deleteHierarchy(hier)],
    ['users', () => deleteUsers([userId])],
    ['roles', () => deleteRoles([ROLE])],
  ]);
}, 60_000);

describe('upsertFilterDetails', () => {
  it('creates the sidecar when missing, then patches only the keys given (null clears)', async () => {
    await prisma.filterDetails.deleteMany({ where: { assetInstanceId: filterC } });
    await upsertFilterDetails(filterC, { filterSet: 'SET_A', currentLifecycleState: 'WASH_IN' });
    let row = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterC } });
    expect(row).toMatchObject({ filterSet: 'SET_A', currentLifecycleState: 'WASH_IN', currentCycleId: null });

    await upsertFilterDetails(filterC, { currentLifecycleState: null });
    row = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterC } });
    expect(row).toMatchObject({ filterSet: 'SET_A', currentLifecycleState: null });
  });

  it('writes through the caller transaction, so a rollback leaves nothing behind', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await upsertFilterDetails(filterC, { filterSet: 'SET_B' }, tx as any);
      const inside = await tx.filterDetails.findUnique({ where: { assetInstanceId: filterC } });
      expect(inside?.filterSet).toBe('SET_B');
      throw new Error('roll back');
    })).rejects.toThrow('roll back');
    const after = await prisma.filterDetails.findUnique({ where: { assetInstanceId: filterC } });
    expect(after?.filterSet).toBe('SET_A');
  });
});

describe('zipFilterAttributes', () => {
  it('returns the same (empty) array without a query', async () => {
    const empty: Array<{ id: string }> = [];
    expect(await zipFilterAttributes(empty)).toBe(empty);
  });

  it('merges the typed filter attributes over the instance ones and leaves non-filter rows alone', async () => {
    const block = { id: hier!.blockId, attributes: { colour: 'blue' } };
    const rows = await zipFilterAttributes([
      { id: filterA, name: 'A', attributes: { micronSize: 'stale', note: 'kept' } },
      { id: filterB, name: 'B' },
      block,
    ]);
    expect(rows[0].attributes).toEqual({ micronSize: '5', filterSize: '24x24', note: 'kept' });
    expect(rows[1].attributes).toEqual({});
    expect(rows[2]).toBe(block);
  });
});

describe('zipLastCleaned', () => {
  it('returns [] for no rows', async () => {
    expect(await zipLastCleaned([])).toEqual([]);
  });

  it('takes the latest of stage event, completed cycle and the manual date seed', async () => {
    const rows = await zipLastCleaned([
      { id: filterA, attributes: { lastCleaningDate: '2026-01-15' } },  // event (05 Mar) wins
      { id: filterB },                                                    // only the completed cycle
      { id: filterC, attributes: { lastCleaningDate: '2026-02-02' } },   // only the seed
      { id: filterNone, attributes: { lastCleaningDate: 'NA' } },        // nothing usable
    ]);
    expect(rows.map((r) => r.lastCleanedAt)).toEqual([
      T_EVENT.toISOString(),
      '2026-01-01T06:00:00.000Z',
      '2026-02-02',
      null,
    ]);
  });

  it('lets a later manual seed beat older events, and ignores malformed seeds', async () => {
    const rows = await zipLastCleaned([
      { id: filterA, attributes: { lastCleaningDate: '2026-09-30' } },
      { id: filterNone, attributes: { lastCleaningDate: '2026-13-45' } },
      { id: filterNone, attributes: { lastCleaningDate: '30/09/2026' } },
      { id: filterNone, attributes: { lastCleaningDate: 20260930 } },
    ]);
    expect(rows.map((r) => r.lastCleanedAt)).toEqual(['2026-09-30', null, null, null]);
  });

  it('only counts cleaning-stage event types', () => {
    expect([...CLEANING_STAGE_EVENT_TYPES]).toEqual(['STATE_TRANSITION', 'BYPASS_DEVIATION', 'CYCLE_COMPLETED']);
  });
});

describe('idempotency (offline replay de-dup)', () => {
  it('matches a clientOpId only within the given filter + cycle', async () => {
    expect(await findExistingByClientOpId(filterA, `${P}-op-new`, cycleA2)).toBe(true);
    expect(await findExistingByClientOpId(filterA, `${P}-op-new`, cycleA1)).toBe(false);
    expect(await findExistingByClientOpId(filterB, `${P}-op-new`, cycleA2)).toBe(false);
    expect(await findExistingByClientOpId(filterA, `${P}-never`, cycleA2)).toBe(false);
  });

  it('matches a start op only against CYCLE_STARTED events', async () => {
    expect(await findExistingStartByClientOpId(filterA, `${P}-start`)).toBe(true);
    expect(await findExistingStartByClientOpId(filterA, `${P}-op-new`)).toBe(false);
    expect(await findExistingStartByClientOpId(filterB, `${P}-start`)).toBe(false);
  });

  it('after the cycle ended, looks in the most recent cycle only', async () => {
    expect(await findExistingByClientOpIdInLatestCycle(filterA, `${P}-op-new`)).toBe(true);
    // The op is in the OLDER cycle: never consulted (audit §1.10).
    expect(await findExistingByClientOpIdInLatestCycle(filterA, `${P}-op-old`)).toBe(false);
    // A filter that has never had a cycle.
    expect(await findExistingByClientOpIdInLatestCycle(filterNone, `${P}-op-new`)).toBe(false);
  });

  it('withClientOpId embeds the id, and is a no-op without one', () => {
    const attrs = { a: 1 };
    expect(withClientOpId(attrs, 'op-9')).toEqual({ a: 1, clientOpId: 'op-9' });
    expect(attrs).toEqual({ a: 1 });
    expect(withClientOpId(attrs, null)).toBe(attrs);
    expect(withClientOpId(attrs, '')).toBe(attrs);
  });
});

describe('typed-asset-dispatch', () => {
  let areaTpl = '', otherTpl = '', customTpl = '';

  beforeAll(async () => {
    for (const [code, label] of [['AREA', 'Area'], ['OTHER', 'Other']] as const) {
      await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
    }
    customKindCode = `CVLK${SFX}`.slice(0, 20);
    await prisma.templateKind.create({ data: { code: customKindCode, label: 'cvl custom kind' } });
    areaTpl = (await prisma.assetTemplate.create({ data: { name: `${P} Area Tpl`, templateKind: 'AREA' } })).id;
    otherTpl = (await prisma.assetTemplate.create({ data: { name: `${P} Other Tpl`, templateKind: 'OTHER' } })).id;
    customTpl = (await prisma.assetTemplate.create({ data: { name: `${P} Custom Tpl`, templateKind: customKindCode } })).id;
    extraTemplateIds.push(areaTpl, otherTpl, customTpl);
  }, 60_000);

  /**
   * Fixture rows are created the way production creates them
   * (instance.service.ts: `tx.assetInstance.create`): the asset_instances row is
   * written and the forward mirror (fn_mirror_asset_instance) writes the typed
   * row with the same id. dispatchCreate, which used to make these, was removed
   * 2026-10-22 (D-LIB-1).
   */
  async function makeInstance(templateId: string, name: string, parentId?: string) {
    const row = await prisma.assetInstance.create({ data: { templateId, name, ...(parentId ? { parentId } : {}) } });
    extraInstanceIds.push(row.id);
    return row;
  }

  it('no longer exports dispatchCreate or the template-kind lookup it alone used (D-LIB-1)', () => {
    const mod = typedAssetDispatch as Record<string, unknown>;
    expect(mod.dispatchCreate).toBeUndefined();
    expect(mod.kindFromTemplateId).toBeUndefined();
    expect(mod._clearKindCache).toBeUndefined();
  });

  it('no longer exports dispatchSoftDeleteMany (no caller; soft-deletes go through instance.service / filter.service)', () => {
    expect((typedAssetDispatch as Record<string, unknown>).dispatchSoftDeleteMany).toBeUndefined();
  });

  it('resolves an instance kind through its template (unknown codes -> OTHER), null when absent', async () => {
    expect(await kindFromInstanceId(hier!.blockId)).toBe('BLOCK');
    expect(await kindFromInstanceId(hier!.ahuId)).toBe('AHU');
    const area = await makeInstance(areaTpl, `${P}-KA1`, hier!.blockId);
    expect(await kindFromInstanceId(area.id)).toBe('AREA');
    const other = await makeInstance(otherTpl, `${P}-KO1`);
    expect(await kindFromInstanceId(other.id)).toBe('OTHER');
    const custom = await makeInstance(customTpl, `${P}-KC1`);
    expect(await kindFromInstanceId(custom.id)).toBe('OTHER');
    expect(await kindFromInstanceId(randomUUID())).toBeNull();
  });

  it('isHierarchyKind is true for exactly the four typed kinds', () => {
    expect(['BLOCK', 'AREA', 'AHU', 'FILTER', 'OTHER', 'EQUIPMENT'].map((k) => isHierarchyKind(k as any)))
      .toEqual([true, true, true, true, false, false]);
  });

  it('translateToTypedShape strips legacy-only fields and maps parentId to the kind FK', () => {
    const base = {
      name: 'n', templateId: 't', templateVersion: 2, parentId: 'p',
      currentLifecycleState: 'X', currentCycleId: 'c', filterProfileId: 'f', filterSet: 'SET_A', status: 'Active',
    };
    expect(translateToTypedShape('BLOCK', base)).toEqual({ name: 'n', status: 'Active' });
    expect(translateToTypedShape('AREA', base)).toEqual({ name: 'n', status: 'Active', blockId: 'p' });
    expect(translateToTypedShape('AHU', base)).toEqual({ name: 'n', status: 'Active', areaId: 'p' });
    expect(translateToTypedShape('FILTER', base)).toEqual({ name: 'n', status: 'Active', ahuId: 'p' });
    expect(translateToTypedShape('AREA', { name: 'n' })).toEqual({ name: 'n' });
  });

  it('dispatchUpdate writes both sides for a typed kind, skipping the typed write when nothing maps', async () => {
    const block = await makeInstance(hier!.blockTemplateId, `${P}-DB2`);
    expect(await prisma.block.findUnique({ where: { id: block.id } })).toMatchObject({ name: `${P}-DB2` });
    const updated = await dispatchUpdate(block.id, { name: `${P}-DB2-renamed`, description: 'moved' });
    expect(updated).toMatchObject({ name: `${P}-DB2-renamed`, description: 'moved' });
    expect(await prisma.block.findUnique({ where: { id: block.id } })).toMatchObject({ name: `${P}-DB2-renamed`, description: 'moved' });

    // templateVersion only: nothing to write on the typed table, asset_instances still updated.
    const v = await dispatchUpdate(block.id, { templateVersion: 7 });
    expect(v.templateVersion).toBe(7);
    expect((await prisma.block.findUnique({ where: { id: block.id } }))?.name).toBe(`${P}-DB2-renamed`);
  });

  it('dispatchUpdate on a FILTER keeps the typed row and the instance row in step', async () => {
    const res = await dispatchUpdate(filterNone, { description: 'cvl filter note' });
    expect(res.description).toBe('cvl filter note');
    expect((await prisma.filter.findUnique({ where: { id: filterNone } }))?.description).toBe('cvl filter note');
  });

  it('dispatchUpdate on an OTHER-kind row writes asset_instances only, and refuses an unknown id', async () => {
    const other = await makeInstance(otherTpl, `${P}-DO2`);
    expect((await dispatchUpdate(other.id, { description: 'plain' })).description).toBe('plain');
    // OTHER has no typed home: nothing was written to any typed table.
    const typed = await Promise.all([
      prisma.block.findUnique({ where: { id: other.id } }), prisma.area.findUnique({ where: { id: other.id } }),
      prisma.ahu.findUnique({ where: { id: other.id } }), prisma.filter.findUnique({ where: { id: other.id } }),
    ]);
    expect(typed).toEqual([null, null, null, null]);
    const missing = randomUUID();
    await expect(dispatchUpdate(missing, { name: 'x' })).rejects.toThrow(`Asset instance not found: ${missing}`);
  });
});
