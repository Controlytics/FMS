/**
 * resolveFilterProfile's config-driven assignment modes, getProfilePipeline's
 * requireActive switch and getCleaningReasons' catalogue fallback (coverage
 * suite, 2026-10-21) — against real rows in digilog_test_db.
 *
 * Why these are direct calls and not route calls: the assignment rules live in
 * the shared `system_config['cleaning-profile-assignment']` row (and the
 * fallback in `default-cleaning-profile`). Writing those rows would re-route
 * every filter in every other suite running against the same DB. The function
 * already takes a BatchReadCache, through which getBatchStates hands it ONE
 * config read per batch; this test passes a cache that answers the two config
 * keys with synthetic values and LOADS everything else for real, so the
 * filter / parent / ancestor reads still hit this file's own rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { resolveFilterProfile, getProfilePipeline, getCleaningReasons } from '../filter-resolver.js';
import type { BatchReadCache } from '../batch-cache.js';
import {
  assertStageApprovedToLeave, getInterlockConfig, getApproverRoleForStage, prettyStage, collectFilterApprovalDetails,
} from '../stage-interlock.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FOM');
const DEFAULT = `default-${randomUUID()}`;
let B = ''; let AREA = ''; let AHU = ''; let F = ''; let LONE = '';
let CP_ACTIVE = ''; let CP_DRAFT = ''; let CP_NOREASONS = '';
const P1 = randomUUID(); const P2 = randomUUID();

/** Config keys answered from memory; every other key is loaded for real. */
function cacheWith(assignment: unknown): BatchReadCache & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    memo<T>(key: string, load: () => Promise<T>): Promise<T> {
      asked.push(key);
      if (key === 'cfg:cleaning-profile-assignment') return Promise.resolve((assignment === undefined ? null : { configValue: assignment }) as T);
      if (key === 'default-cleaning-profile-id') return Promise.resolve(DEFAULT as T);
      return load();
    },
  };
}
const resolve = (filter: { id: string; filterSet?: string | null }, assignment: unknown) =>
  resolveFilterProfile({ id: filter.id, filterProfileId: null, filterSet: filter.filterSet ?? null, name: 'x' }, cacheWith(assignment));

beforeAll(async () => {
  const sa = await fx.user('sa', 'SUPER_ADMIN');
  B = await fx.node('BLOCK', 'B');
  AREA = await fx.node('AREA', 'AREA', B);
  AHU = await fx.node('AHU', 'AHU', AREA);
  F = await fx.filter('F', AHU, null, { attributes: { micronSize: '10', filterSize: '600x600' } });
  LONE = await fx.filter('LONE', null, null, { attributes: { filterSize: '300x300' } });
  ({ cleaningProfileId: CP_ACTIVE } = await fx.pipeline({ name: 'ACT', stages: ['WASH_IN'] }, sa.id));
  ({ cleaningProfileId: CP_DRAFT } = await fx.pipeline({ name: 'DRF', stages: ['WASH_IN'], status: 'DRAFT' }, sa.id));
  const noReasons = await prisma.filterCleaningProfile.create({
    data: { name: fx.name('NORSN'), lineageId: randomUUID(), status: 'ACTIVE', createdBy: sa.id },
  });
  CP_NOREASONS = noReasons.id;
  fx.cleaningProfileIds.push(noReasons.id);
}, 60_000);

afterAll(async () => { await fx.cleanup(); }, 60_000);

describe('resolveFilterProfile', () => {
  it('a direct assignment wins and never reads the config', async () => {
    const cache = cacheWith({ mode: 'BY_ENTITY', rules: [{ matchValue: F, profileId: P1 }] });
    expect(await resolveFilterProfile({ id: F, filterProfileId: P2, filterSet: null, name: 'x' }, cache)).toBe(P2);
    expect(cache.asked).toEqual([]);
  });

  it('no config row, or a config with no rules, falls straight to the default profile', async () => {
    expect(await resolve({ id: F }, undefined)).toBe(DEFAULT);
    expect(await resolve({ id: F }, { mode: 'BY_AHU', rules: [] })).toBe(DEFAULT);
  });

  it('BY_FILTER_SIZE matches micronSize first, then filterSize; otherwise the default', async () => {
    expect(await resolve({ id: F }, { mode: 'BY_FILTER_SIZE', rules: [{ matchValue: '10', profileId: P1 }] })).toBe(P1);
    expect(await resolve({ id: LONE }, { mode: 'BY_FILTER_SIZE', rules: [{ matchValue: '300x300', profileId: P2 }] })).toBe(P2);
    expect(await resolve({ id: F }, { mode: 'BY_FILTER_SIZE', rules: [{ matchValue: '600x600', profileId: P2 }] })).toBe(DEFAULT);
  });

  it('BY_FILTER_SIZE treats a filter with no size as the empty value', async () => {
    const sizeless = await fx.filter('NOSIZE', null, null);
    expect(await resolve({ id: sizeless }, { mode: 'BY_FILTER_SIZE', rules: [{ matchValue: '', profileId: P1 }] })).toBe(P1);
  });

  it('BY_FILTER_SET compares with the SET_ prefix and case normalised away', async () => {
    const cfg = { mode: 'BY_FILTER_SET', rules: [{ matchValue: 'b', profileId: P1 }, { matchValue: 'SET_A', profileId: P2 }] };
    expect(await resolve({ id: F, filterSet: 'SET_B' }, cfg)).toBe(P1);
    expect(await resolve({ id: F, filterSet: 'set_a' }, cfg)).toBe(P2);
    expect(await resolve({ id: F, filterSet: null }, cfg)).toBe(DEFAULT);
  });

  it('BY_AHU matches the filter\'s parent; an unparented filter or an unmatched AHU gets the default', async () => {
    expect(await resolve({ id: F }, { mode: 'BY_AHU', rules: [{ matchValue: AHU, profileId: P1 }] })).toBe(P1);
    expect(await resolve({ id: LONE }, { mode: 'BY_AHU', rules: [{ matchValue: AHU, profileId: P1 }] })).toBe(DEFAULT);
    expect(await resolve({ id: F }, { mode: 'BY_AHU', rules: [{ matchValue: B, profileId: P1 }] })).toBe(DEFAULT);
  });

  it('BY_BLOCK walks every ancestor (AHU → Area → Block) and takes the first rule it meets', async () => {
    expect(await resolve({ id: F }, { mode: 'BY_BLOCK', rules: [{ matchValue: B, profileId: P1 }] })).toBe(P1);
    expect(await resolve({ id: F }, { mode: 'BY_BLOCK', rules: [{ matchValue: AREA, profileId: P2 }, { matchValue: B, profileId: P1 }] })).toBe(P2);
    expect(await resolve({ id: F }, { mode: 'BY_BLOCK', rules: [{ matchValue: randomUUID(), profileId: P1 }] })).toBe(DEFAULT);
  });

  it('BY_ENTITY matches the filter itself; an unknown mode is the default', async () => {
    expect(await resolve({ id: F }, { mode: 'BY_ENTITY', rules: [{ matchValue: F, profileId: P1 }] })).toBe(P1);
    expect(await resolve({ id: LONE }, { mode: 'BY_ENTITY', rules: [{ matchValue: F, profileId: P1 }] })).toBe(DEFAULT);
    expect(await resolve({ id: F }, { mode: 'BY_MOON_PHASE', rules: [{ matchValue: F, profileId: P1 }] })).toBe(DEFAULT);
  });

  it('without a cache, an unassigned filter resolves to the oldest ACTIVE cleaning profile (no default configured)', async () => {
    // Precondition: a seeded test DB has neither shared row (the seed writes neither).
    const cfgRows = await prisma.systemConfig.findMany({ where: { configKey: { in: ['cleaning-profile-assignment', 'default-cleaning-profile'] } } });
    expect(cfgRows).toEqual([]);
    const oldest = await prisma.filterCleaningProfile.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    expect(await resolveFilterProfile({ id: F, filterProfileId: null, filterSet: null, name: 'x' })).toBe(oldest!.id);
  });
});

describe('stage-interlock primitives', () => {
  it('the leave-gate lets through a non-gated stage, an in-place move, and — with no config passed — whatever the stored setting says', async () => {
    const cycleId = randomUUID();
    await expect(assertStageApprovedToLeave({ cycleId, fromState: 'WASH_IN', targetState: 'WASH_OUT' })).resolves.toBeUndefined();
    await expect(assertStageApprovedToLeave({ cycleId, fromState: 'DRY_OUT', targetState: 'DRY_OUT', config: { enabled: true, washOutApproverRole: 'X', dryOutApproverRole: 'X' } })).resolves.toBeUndefined();
    // Precondition: the seeded test DB stores the interlock OFF. No config passed → that row is read.
    expect((await getInterlockConfig()).enabled).toBe(false);
    await expect(assertStageApprovedToLeave({ cycleId, fromState: 'WASH_OUT', targetState: 'DRY_IN' })).resolves.toBeUndefined();
    // With it on and no approval on record, leaving is refused.
    await expect(assertStageApprovedToLeave({ cycleId, fromState: 'DRY_OUT', targetState: 'STORAGE_IN', config: { enabled: true, washOutApproverRole: 'QA_W', dryOutApproverRole: 'QA_D' } }))
      .rejects.toMatchObject({ statusCode: 423, code: 'STAGE_APPROVAL_PENDING', message: expect.stringContaining('QA_D') });
  });

  it('the approver role follows the stage', () => {
    const c = { enabled: true, washOutApproverRole: 'W', dryOutApproverRole: 'D' };
    expect([getApproverRoleForStage('DRY_OUT', c), getApproverRoleForStage('WASH_OUT', c)]).toEqual(['D', 'W']);
    expect(prettyStage('STORAGE_OUT')).toBe('Storage Out');
  });

  it('the approver snapshot walks Block / Area / AHU and normalises attribute values', async () => {
    const f = await fx.filter('SNAPF', AHU, null, { attributes: { micronSize: 10, filterType: null, ahuType: '  ', filterSize: '600x600' }, filterSet: 'SET_B' });
    expect(await collectFilterApprovalDetails(f)).toEqual({
      filterName: (await prisma.assetInstance.findUnique({ where: { id: f } }))!.name,
      block: (await prisma.assetInstance.findUnique({ where: { id: B } }))!.name,
      area: (await prisma.assetInstance.findUnique({ where: { id: AREA } }))!.name,
      ahu: (await prisma.assetInstance.findUnique({ where: { id: AHU } }))!.name,
      ahuType: null, micronSize: '10', filterType: null, filterDimensions: '600x600', filterSet: 'SET_B',
    });
    expect(await collectFilterApprovalDetails(randomUUID())).toMatchObject({ filterName: null, block: null, area: null, ahu: null, filterSet: null });
  });
});

describe('getProfilePipeline / getCleaningReasons', () => {
  it('requireActive hides a non-ACTIVE profile and returns an ACTIVE one with its graph', async () => {
    expect(await getProfilePipeline(CP_DRAFT, true)).toBeNull();
    expect((await getProfilePipeline(CP_DRAFT, false))!.id).toBe(CP_DRAFT);
    const active = await getProfilePipeline(CP_ACTIVE, true);
    expect(active!.stages.map((s) => s.nodeType)).toEqual(['START', 'STAGE', 'END']);
    expect(active!.connections).toHaveLength(2);
    expect(await getProfilePipeline(randomUUID(), true)).toBeNull();
  });

  it('a profile with no reasons of its own falls back to the configured catalogue', async () => {
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
    const raw = cfg?.configValue as any;
    const expected = Array.isArray(raw) ? raw : (raw?.value ?? []);
    expect(await getCleaningReasons(CP_NOREASONS)).toEqual(expected);
    expect(await getCleaningReasons(randomUUID())).toEqual(expected);
    expect((await getCleaningReasons(CP_ACTIVE)).map((r: any) => r.key)).toEqual(['ROUTINE', 'BREAKDOWN']);
  });
});
