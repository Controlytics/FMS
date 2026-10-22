/**
 * Regression test for D6: a superseded (archived) cleaning-profile version must
 * not be re-activated next to the current one — a lineage has ONE live
 * version. Toggle and edit both refuse a non-latest version with 409.
 * Real harness app + Prisma; every profile here is archived before it is left.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVDC'));
let app: FastifyInstance;
let sa: { call: Caller };
let v1: string;
let v2: string;
let lineageId: string;

const graph = {
  stages: [{ nodeType: 'START' }, { nodeType: 'STAGE', stateKey: 'WASH_IN' }, { nodeType: 'END' }],
  connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 2 }],
};

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const created = await sa.call('POST', '/api/filter-cleaning-profiles', { body: { name: own.n('CP'), ...graph } });
  v1 = created.body.id;
  lineageId = created.body.lineageId;
  own.cleaningLineages.add(lineageId);
  v2 = (await sa.call('PUT', `/api/filter-cleaning-profiles/${v1}`, { body: { description: 'v2' } })).body.id;
}, 60_000);

afterAll(async () => {
  // ACTIVE profiles are every other suite's fallback default on this DB.
  await prisma.filterCleaningProfile.updateMany({ where: { lineageId }, data: { status: 'ARCHIVED' } }).catch(() => undefined);
  await own.cleanup();
  await app?.close();
}, 60_000);

const activeVersions = async () => (await prisma.filterCleaningProfile.findMany({ where: { lineageId, status: 'ACTIVE' }, select: { version: true } })).map((r) => r.version);

describe('D6 — only the latest version of a cleaning profile can be toggled or edited', () => {
  it('toggling a superseded version is 409 and leaves exactly one ACTIVE version', async () => {
    internalErrors.length = 0;
    const res = await sa.call('PATCH', `/api/filter-cleaning-profiles/${v1}/toggle-status`, { body: {} });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'CONFLICT',
      message: `Version 1 of "${own.n('CP')}" has been superseded by version 2. Open the latest version to change it.`,
    });
    expect(await activeVersions()).toEqual([2]);
    expect(internalErrors).toEqual([]);
  });

  it('editing a superseded version is refused with the same explicit 409, before anything is written', async () => {
    const res = await sa.call('PUT', `/api/filter-cleaning-profiles/${v1}`, { body: { description: 'stale' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Version 1 of "${own.n('CP')}" has been superseded by version 2. Open the latest version to change it.`);
    expect(await prisma.filterCleaningProfile.count({ where: { lineageId } })).toBe(2);
  });

  it('the latest version still toggles off and on', async () => {
    const off = await sa.call('PATCH', `/api/filter-cleaning-profiles/${v2}/toggle-status`, { body: {} });
    expect(off.body).toEqual({ success: true, status: 'INACTIVE' });
    // With the whole lineage archived, the old version is still not the one to revive.
    const old = await sa.call('PATCH', `/api/filter-cleaning-profiles/${v1}/toggle-status`, { body: {} });
    expect(old.status).toBe(409);
    const on = await sa.call('PATCH', `/api/filter-cleaning-profiles/${v2}/toggle-status`, { body: {} });
    expect(on.body).toEqual({ success: true, status: 'ACTIVE' });
    expect(await activeVersions()).toEqual([2]);
  });
});
