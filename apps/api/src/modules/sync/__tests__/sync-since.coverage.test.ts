/**
 * GET /api/sync/since through the real route (2026-10-21).
 *
 * sync.routes.test.ts only inspects the route's registration; this drives the
 * handler: the permission gate (ASSET_VIEW or FILTER_OPERATE), query
 * validation, and the filter rows it returns — including the parent chain
 * bucketed by KIND for a Filter -> AHU -> AREA -> BLOCK hierarchy, which is the
 * branch a Block-direct AHU never reaches.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors, authGet } from '../../../e2e/test-helper.js';
import syncRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix, deleteFilters,
} from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoSync@2026!x';
const ROLE_VIEW = `cvoSV${S}`;
const ROLE_OP = `cvoSO${S}`;
const ROLE_NONE = `cvoSN${S}`;
const U = { view: `cvosvw${S}`.toLowerCase(), op: `cvosop${S}`.toLowerCase(), none: `cvosnn${S}`.toLowerCase() };
const ids: Record<string, string> = {};
const tok: Record<string, string> = {};
let app: FastifyInstance;
const templateIds: string[] = [];
const inst: Record<string, string> = {};
let cutoff = '';

beforeAll(async () => {
  await createRole(ROLE_VIEW, ['ASSET_VIEW']);
  await createRole(ROLE_OP, ['FILTER_OPERATE']);
  await createRole(ROLE_NONE, []);
  ids.view = await createUser(U.view, ROLE_VIEW, PW);
  ids.op = await createUser(U.op, ROLE_OP, PW);
  ids.none = await createUser(U.none, ROLE_NONE, PW);
  app = await buildApp([{ plugin: syncRoutes, prefix: '/api/sync' }]);
  for (const k of Object.keys(U) as Array<keyof typeof U>) tok[k] = await login(app, U[k], PW);

  for (const [code, label] of [['BLOCK', 'Block'], ['AREA', 'Area'], ['AHU', 'AHU'], ['FILTER', 'Filter']] as const) {
    await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
  }
  const tpl = async (kind: string) => {
    const t = await prisma.assetTemplate.create({ data: { name: `cvoS ${kind} ${S}`, templateKind: kind, isActive: true } });
    templateIds.push(t.id);
    return t.id;
  };
  const [tb, ta, th, tf] = [await tpl('BLOCK'), await tpl('AREA'), await tpl('AHU'), await tpl('FILTER')];
  cutoff = new Date(Date.now() - 1000).toISOString();
  inst.block = (await prisma.assetInstance.create({ data: { name: `cvoS-BLK-${S}`, templateId: tb } })).id;
  inst.area = (await prisma.assetInstance.create({ data: { name: `cvoS-AREA-${S}`, templateId: ta, parentId: inst.block } })).id;
  inst.ahu = (await prisma.assetInstance.create({ data: { name: `cvoS-AHU-${S}`, templateId: th, parentId: inst.area } })).id;
  inst.filter = (await prisma.assetInstance.create({
    data: { name: `cvoS-F-${S}`, templateId: tf, parentId: inst.ahu, attributes: { micronSize: '10' } },
  })).id;
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['filter', () => deleteFilters([inst.filter])],
    ['ahu', () => prisma.assetInstance.deleteMany({ where: { id: inst.ahu } })],
    ['area', () => prisma.assetInstance.deleteMany({ where: { id: inst.area } })],
    ['block', () => prisma.assetInstance.deleteMany({ where: { id: inst.block } })],
    ['templates', () => prisma.assetTemplate.deleteMany({ where: { id: { in: templateIds } } })],
    ['users', () => deleteUsers(Object.values(ids))],
    ['roles', () => deleteRoles([ROLE_VIEW, ROLE_OP, ROLE_NONE])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('GET /api/sync/since', () => {
  it('refuses an account with neither ASSET_VIEW nor FILTER_OPERATE', async () => {
    const res = await authGet(app, '/api/sync/since', tok.none);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('returns every entity array (even when empty), a server timestamp and hasMore', async () => {
    const res = await authGet(app, '/api/sync/since', tok.view);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const k of ['filterCleaningProfiles', 'filterProfiles', 'equipmentGroups', 'checklistProfiles', 'assetTemplates', 'filters']) {
      expect(Array.isArray(body[k]), k).toBe(true);
    }
    expect(Number.isNaN(Date.parse(body.serverTimestamp))).toBe(false);
    expect(typeof body.hasMore).toBe('boolean');
  });

  it('a FILTER_OPERATE-only role may sync too (the tablet operating roles)', async () => {
    const res = await authGet(app, `/api/sync/since?filterUpdatedSince=${encodeURIComponent(cutoff)}`, tok.op);
    expect(res.statusCode).toBe(200);
    expect(res.json().filters.map((f: any) => f.id)).toContain(inst.filter);
  });

  it('flattens the parent chain by KIND for Filter -> AHU -> AREA -> BLOCK', async () => {
    const res = await authGet(app, `/api/sync/since?filterUpdatedSince=${encodeURIComponent(cutoff)}&profileVersion=0`, tok.view);
    const f = res.json().filters.find((x: any) => x.id === inst.filter);
    expect(f).toMatchObject({
      name: `cvoS-F-${S}`, templateKind: 'FILTER', parentId: inst.ahu, isActive: true,
      ahuId: inst.ahu, ahuName: `cvoS-AHU-${S}`,
      areaId: inst.area, areaName: `cvoS-AREA-${S}`,
      blockId: inst.block, blockName: `cvoS-BLK-${S}`,
      attributes: { micronSize: '10' },
    });
  });

  it('a negative cursor is a validation error, not a 500', async () => {
    const res = await authGet(app, '/api/sync/since?checklistVersion=-1', tok.view);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
  });
});
