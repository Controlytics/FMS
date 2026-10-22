/**
 * Cleaning profiles — every route through the real harness app (production
 * error handler, real auth / RBAC / re-auth, real Prisma on digilog_test_db),
 * plus the one service method no route calls (`deleteProfile`).
 *
 * The test DB holds no ACTIVE cleaning profile of its own, so an ACTIVE profile
 * created here is every other suite's fallback default while it exists. Each
 * one is archived as soon as the test that needs it is done, and all are
 * removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { CleaningProfileService } from '../cleaning-profile.service.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVCP'));
let app: FastifyInstance;
let sa: { id: string; username: string; call: Caller };
let cp: { id: string; call: Caller };
let op: { call: Caller };
let ckOn: string;
let ckOff: string;
let ckOff2: string;
let filterId: string;

type Node = { nodeType: string; stateKey?: string | null; configuration?: Record<string, unknown>; positionX?: number; positionY?: number; sortOrder?: number };
function linear(keys: string[], mid: Node[] = []) {
  const stages: Node[] = [{ nodeType: 'START' }, ...keys.map((k) => ({ nodeType: 'STAGE', stateKey: k })), ...mid, { nodeType: 'END' }];
  const connections = stages.slice(0, -1).map((_, i) => ({ fromIndex: i, toIndex: i + 1 }));
  return { stages, connections };
}
const post = (who: { call: Caller }, body: Record<string, unknown>, pw?: string) => who.call('POST', '/api/filter-cleaning-profiles', { body, pw });
const archiveMine = () => prisma.filterCleaningProfile.updateMany({ where: { name: { startsWith: own.tag }, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const cpRole = await own.role('CP', ['FCP_READ', 'CP_PAGE_CREATE', 'CP_PAGE_EDIT', 'CP_PAGE_DELETE']);
  cp = await own.user(app, 'cp', cpRole);
  op = await own.user(app, 'op', await own.role('OP', ['FILTER_OPERATE']));
  await own.reauth(['CREATE_CLEANING_PROFILE', 'UPDATE_CLEANING_PROFILE', 'DELETE_CLEANING_PROFILE'], cpRole);
  ckOn = await own.checklist('CK-ON');
  ckOff = await own.checklist('CK-OFF', false);
  ckOff2 = await own.checklist('CK-OFF2', false);
  await own.template('FILTER', { isActive: true });
  const blockId = await own.instance('BLOCK', await own.template('BLOCK'));
  const ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  filterId = await own.filter('F', ahuId);
}, 60_000);

afterAll(async () => {
  await archiveMine().catch(() => undefined);
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('cleaning-profiles — pipeline validation (nothing is written)', () => {
  it('answers each graph rule with its own 400 message', async () => {
    internalErrors.length = 0;
    const cases: Array<[{ stages: Node[]; connections?: unknown[] }, string | RegExp]> = [
      [{ stages: [{ nodeType: 'STAGE', stateKey: 'WASH_IN' }, { nodeType: 'END' }], connections: [{ fromIndex: 0, toIndex: 1 }] }, 'Pipeline must have exactly 1 START node (found 0)'],
      [{ stages: [{ nodeType: 'START' }, { nodeType: 'START' }, { nodeType: 'END' }], connections: [{ fromIndex: 0, toIndex: 2 }] }, 'Pipeline must have exactly 1 START node (found 2)'],
      [{ stages: [{ nodeType: 'START' }, { nodeType: 'STAGE', stateKey: 'WASH_IN' }], connections: [{ fromIndex: 0, toIndex: 1 }] }, 'Pipeline must have exactly 1 END node (found 0)'],
      [{ ...linear([]), stages: [{ nodeType: 'START' }, { nodeType: 'STAGE' }, { nodeType: 'END' }] }, 'All STAGE nodes must have a stateKey assigned'],
      [linear(['WASH_IN'], [{ nodeType: 'CHECKLIST', configuration: {} }]), 'All CHECKLIST nodes must have a checklist profile assigned'],
      [{ stages: linear(['WASH_IN']).stages }, /^Pipeline must have at least one connection/],
      [{ stages: linear(['WASH_IN']).stages, connections: [] }, /^Pipeline must have at least one connection/],
      [{ stages: linear(['WASH_IN']).stages, connections: [{ fromIndex: 1, toIndex: 2 }] }, 'START node must have at least one outgoing connection'],
      [{ stages: linear(['WASH_IN']).stages, connections: [{ fromIndex: 0, toIndex: 1 }] }, 'END node must have at least one incoming connection'],
      [{ stages: linear(['WASH_IN', 'WASH_OUT']).stages, connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 3 }] }, 'Disconnected node found: WASH_OUT'],
      [{ stages: [...linear(['WASH_IN']).stages.slice(0, 2), { nodeType: 'REMARKS' }, { nodeType: 'END' }], connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 3 }] }, 'Disconnected node found: REMARKS'],
    ];
    for (const [graph, message] of cases) {
      const res = await post(sa, { name: own.n('BAD'), ...graph });
      expect(res.status, String(message)).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      if (typeof message === 'string') expect(res.body.message).toBe(message);
      else expect(res.body.message).toMatch(message);
    }
    expect(await prisma.filterCleaningProfile.count({ where: { name: own.n('BAD') } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });

  it('rejects an unknown node type, a one-node pipeline and a blank name at the schema (400, not 500)', async () => {
    internalErrors.length = 0;
    const bogus = await post(sa, { name: own.n('BAD'), stages: [{ nodeType: 'START' }, { nodeType: 'BOGUS' }, { nodeType: 'END' }], connections: [] });
    expect(bogus.status).toBe(400);
    expect(bogus.body.error).toBe('VALIDATION_ERROR');
    const one = await post(sa, { name: own.n('BAD'), stages: [{ nodeType: 'START' }], connections: [] });
    expect(one.status).toBe(400);
    const blank = await post(sa, { name: '', ...linear(['WASH_IN']) });
    expect(blank.status).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('a connection that cannot be resolved rolls the whole create back (profile, stages, connections)', async () => {
    const { stages } = linear(['WASH_IN']);
    const src = await post(sa, { name: own.n('ROLLBACK'), stages, connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 2 }, { fromIndex: 99, toIndex: 2 }] });
    expect(src.status).toBe(400);
    expect(src.body.message).toBe('Invalid connection: could not resolve source stage');
    const tgt = await post(sa, { name: own.n('ROLLBACK'), stages, connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 2 }, { fromIndex: 1, toIndex: 99 }] });
    expect(tgt.body.message).toBe('Invalid connection: could not resolve target stage');
    // A stage id that does not exist reaches the FK — a client data error, still rolled back.
    internalErrors.length = 0;
    const fk = await post(sa, { name: own.n('ROLLBACK'), stages, connections: [{ fromIndex: 0, toIndex: 1 }, { fromIndex: 1, toIndex: 2 }, { fromIndex: 1, toStageId: randomUUID() }] });
    expect(fk.status).toBe(400);
    expect(fk.body.error).toBe('DATA_CONSTRAINT');
    expect(internalErrors).toEqual([]);
    expect(await prisma.filterCleaningProfile.count({ where: { name: own.n('ROLLBACK') } })).toBe(0);
  });

  it('refuses a pipeline that uses a disabled checklist, naming it (singular and plural)', async () => {
    const one = await post(sa, { name: own.n('USES-OFF'), ...linear(['WASH_IN'], [{ nodeType: 'CHECKLIST', configuration: { checklistProfileId: ckOff } }]) });
    expect(one.status).toBe(400);
    expect(one.body).toMatchObject({
      error: 'CHECKLIST_DISABLED',
      message: `This cleaning profile uses disabled checklist "${own.n('CK-OFF')}". Enable it or remove it from the profile.`,
      details: { checklists: [own.n('CK-OFF')] },
    });
    const two = await post(sa, {
      name: own.n('USES-OFF'),
      ...linear(['WASH_IN'], [{ nodeType: 'CHECKLIST', configuration: { checklistProfileId: ckOff } }, { nodeType: 'CHECKLIST', configuration: { checklistProfileId: ckOff2 } }]),
    });
    expect(two.body.message).toMatch(/^This cleaning profile uses disabled checklists ".*", ".*"\. Enable them or remove them from the profile\.$/);
    expect([...two.body.details.checklists].sort()).toEqual([own.n('CK-OFF'), own.n('CK-OFF2')].sort());
    expect(await prisma.filterCleaningProfile.count({ where: { name: own.n('USES-OFF') } })).toBe(0);
  });
});

let p1: string; // v1 of the main lineage
let p2: string; // v2
let minimal: string;

describe('cleaning-profiles — create, list, read', () => {
  it('asks for the password when re-auth is configured, and writes nothing without it', async () => {
    const res = await post(cp, { name: own.n('NOPW'), ...linear(['WASH_IN']) });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_CLEANING_PROFILE' });
    expect(await prisma.filterCleaningProfile.count({ where: { name: own.n('NOPW') } })).toBe(0);
  });

  it('creates an ACTIVE v1 with ordered stages, resolved connections and a signed audit row', async () => {
    const graph = linear(['WASH_IN', 'WASH_OUT'], [{ nodeType: 'CHECKLIST', configuration: { checklistProfileId: ckOn }, positionX: 12.5, positionY: 40 }]);
    // Checklist sits after WASH_OUT, before END: START→WASH_IN→WASH_OUT→CHECKLIST→END.
    graph.connections[2] = { fromIndex: 2, toIndex: 3, label: 'To checklist' } as any;
    const reasons = [{ key: 'PM', name: 'PM', isActive: true }];
    const res = await post(cp, { name: own.n('MAIN'), description: 'main lineage', flowMode: 'BYPASS_ENABLED', alarmOnForwardSkip: false, cleaningReasons: reasons, ...graph }, PASSWORD);
    expect(res.status).toBe(201);
    p1 = res.body.id;
    own.cleaningLineages.add(res.body.lineageId);
    expect(res.body).toMatchObject({
      name: own.n('MAIN'), description: 'main lineage', status: 'ACTIVE', version: 1, flowMode: 'BYPASS_ENABLED',
      alarmOnForwardSkip: false, alarmOnBackwardJump: true, alarmOnOutOfSequence: true, cleaningReasons: reasons, createdBy: cp.id,
    });
    expect(res.body.stages.map((s: any) => [s.sortOrder, s.nodeType, s.stateKey])).toEqual([
      [0, 'START', null], [1, 'STAGE', 'WASH_IN'], [2, 'STAGE', 'WASH_OUT'], [3, 'CHECKLIST', null], [4, 'END', null],
    ]);
    expect(res.body.stages[3]).toMatchObject({ positionX: 12.5, positionY: 40, configuration: { checklistProfileId: ckOn } });
    const byId = new Map(res.body.stages.map((s: any) => [s.id, s.sortOrder]));
    expect(res.body.connections.map((c: any) => [byId.get(c.fromStageId), byId.get(c.toStageId), c.label]).sort()).toEqual([
      [0, 1, 'Next'], [1, 2, 'Next'], [2, 3, 'To checklist'], [3, 4, 'Next'],
    ].sort());
    const [audit] = await auditFor(p1, 'CREATED');
    expect(audit.afterValue).toEqual({ name: own.n('MAIN'), flowMode: 'BYPASS_ENABLED' });
    expect(audit.signatureAuditId).toBeTruthy();
  });

  it('fills the documented defaults for an omitted flow mode, alarms and reasons', async () => {
    const res = await post(sa, { name: own.n('MINIMAL'), ...linear(['DRY_IN']) });
    expect(res.status).toBe(201);
    minimal = res.body.id;
    own.cleaningLineages.add(res.body.lineageId);
    expect(res.body).toMatchObject({ flowMode: 'STRICT', alarmOnForwardSkip: true, alarmOnBackwardJump: true, alarmOnOutOfSequence: true, cleaningReasons: null, description: null });
  });

  it('lists the latest version per lineage with server-side search, status filter and paging', async () => {
    const res = await cp.call('GET', `/api/filter-cleaning-profiles?status=ACTIVE&search=${own.tag}&limit=50`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const main = res.body.data.find((r: any) => r.id === p1);
    expect(main).toMatchObject({ name: own.n('MAIN'), version: 1, status: 'ACTIVE', stageCount: 3, connectionCount: 4, flowMode: 'BYPASS_ENABLED' });
    expect(Object.keys(main).sort()).toEqual(['connectionCount', 'createdAt', 'description', 'flowMode', 'id', 'name', 'stageCount', 'status', 'version']);
    const page2 = await cp.call('GET', `/api/filter-cleaning-profiles?status=ACTIVE&search=${own.tag.toLowerCase()}&page=2&limit=1`);
    expect(page2.body).toMatchObject({ total: 2, page: 2, limit: 1, totalPages: 2 });
    expect(page2.body.data).toHaveLength(1);
    const none = await cp.call('GET', `/api/filter-cleaning-profiles?search=${own.tag}-NOPE`);
    expect(none.body).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    // Operating roles read profiles for the offline cache (FILTER_OPERATE alternate).
    const operator = await op.call('GET', `/api/filter-cleaning-profiles?search=${own.tag}`);
    expect(operator.status).toBe(200);
    expect(operator.body.total).toBe(2);
  });

  it('gets one profile with its stages and connections; 404 for an unknown id', async () => {
    const res = await op.call('GET', `/api/filter-cleaning-profiles/${p1}`);
    expect(res.status).toBe(200);
    expect(res.body.stages).toHaveLength(5);
    expect(res.body.connections).toHaveLength(4);
    const missing = await op.call('GET', `/api/filter-cleaning-profiles/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: 'NOT_FOUND', message: 'Cleaning profile not found' });
  });
});

describe('cleaning-profiles — update (new version)', () => {
  it('asks for the password, and refuses an empty connection list for an otherwise valid pipeline', async () => {
    const noPw = await cp.call('PUT', `/api/filter-cleaning-profiles/${p1}`, { body: { name: own.n('MAIN-x') } });
    expect(noPw.status).toBe(401);
    const empty = await sa.call('PUT', `/api/filter-cleaning-profiles/${p1}`, { body: { connections: [] } });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/^Pipeline must have at least one connection/);
    const missing = await sa.call('PUT', `/api/filter-cleaning-profiles/${randomUUID()}`, { body: { name: 'x' } });
    expect(missing.status).toBe(404);
    expect((await prisma.filterCleaningProfile.findUnique({ where: { id: p1 } }))!.status).toBe('ACTIVE');
  });

  it('a name-only edit archives v1, creates v2 in the same lineage with remapped connections, and moves filter profiles to v2', async () => {
    const fpId = await own.filterProfile('FP-MAIN', p1);
    const res = await cp.call('PUT', `/api/filter-cleaning-profiles/${p1}`, { pw: PASSWORD, body: { name: own.n('MAIN-v2') } });
    expect(res.status).toBe(200);
    p2 = res.body.id;
    expect(p2).not.toBe(p1);
    const old = await prisma.filterCleaningProfile.findUnique({ where: { id: p1 } });
    expect(old).toMatchObject({ status: 'ARCHIVED', name: own.n('MAIN') });
    expect(res.body).toMatchObject({ lineageId: old!.lineageId, version: 2, status: 'ACTIVE', name: own.n('MAIN-v2'), flowMode: 'BYPASS_ENABLED', description: 'main lineage', createdBy: cp.id });
    const newIds = new Set(res.body.stages.map((s: any) => s.id));
    const byId = new Map(res.body.stages.map((s: any) => [s.id, s.sortOrder]));
    expect(res.body.connections.every((c: any) => newIds.has(c.fromStageId) && newIds.has(c.toStageId))).toBe(true);
    expect(res.body.connections.map((c: any) => [byId.get(c.fromStageId), byId.get(c.toStageId)]).sort()).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]].sort());
    expect((await prisma.filterProfile.findUnique({ where: { id: fpId } }))!.cleaningProfileId).toBe(p2);
    const [audit] = await auditFor(p2, 'UPDATED');
    expect(audit.beforeValue).toEqual({ version: 1 });
    expect(audit.afterValue).toEqual({ version: 2 });
  });

  it('translates connections that still carry the previous version\'s stage ids', async () => {
    const v2 = await prisma.filterPipelineStage.findMany({ where: { profileId: p2 }, orderBy: { sortOrder: 'asc' } });
    const conns = [[0, 1], [1, 2], [2, 4]].map(([a, b]) => ({ fromStageId: v2[a].id, toStageId: v2[b].id, label: `${a}-${b}` }));
    // Drop the checklist hop: the CHECKLIST node becomes disconnected → refused.
    const refused = await sa.call('PUT', `/api/filter-cleaning-profiles/${p2}`, { body: { connections: conns } });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('Disconnected node found: CHECKLIST');
    const ok = await sa.call('PUT', `/api/filter-cleaning-profiles/${p2}`, {
      body: { connections: [...conns, { fromStageId: v2[3].id, toStageId: v2[4].id }, { fromStageId: v2[2].id, toStageId: v2[3].id }] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(3);
    const ids = new Set(ok.body.stages.map((s: any) => s.id));
    expect(ok.body.connections).toHaveLength(5);
    expect(ok.body.connections.every((c: any) => ids.has(c.fromStageId) && ids.has(c.toStageId))).toBe(true);
    expect(ok.body.connections.find((c: any) => c.label === '2-4')).toBeTruthy();
    p2 = ok.body.id;
  });

  it('a new stage list without connections re-validates and reuses the stored edges by position', async () => {
    const stages = [{ nodeType: 'START' }, { nodeType: 'STAGE', stateKey: 'DRY_IN' }, { nodeType: 'STAGE', stateKey: 'DRY_OUT' }, { nodeType: 'CHECKLIST', configuration: { checklistProfileId: ckOn } }, { nodeType: 'END' }];
    const res = await sa.call('PUT', `/api/filter-cleaning-profiles/${p2}`, { body: { stages } });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(4);
    expect(res.body.stages.map((s: any) => s.stateKey)).toEqual([null, 'DRY_IN', 'DRY_OUT', null, null]);
    expect(res.body.connections).toHaveLength(5);
    p2 = res.body.id;
  });

  it('an index connection beyond the new stage list, or an unknown stage id, is refused and rolls back', async () => {
    const before = await prisma.filterCleaningProfile.count({ where: { lineageId: { in: [...own.cleaningLineages] } } });
    const v = await prisma.filterPipelineStage.findMany({ where: { profileId: p2 }, orderBy: { sortOrder: 'asc' } });
    const base = [[0, 1], [1, 2], [2, 3], [3, 4]].map(([a, b]) => ({ fromStageId: v[a].id, toStageId: v[b].id }));
    const src = await sa.call('PUT', `/api/filter-cleaning-profiles/${p2}`, { body: { connections: [...base, { fromStageId: randomUUID(), toStageId: v[4].id }] } });
    expect(src.status).toBe(400);
    expect(src.body.message).toBe('Invalid connection: could not resolve source stage');
    const tgt = await sa.call('PUT', `/api/filter-cleaning-profiles/${p2}`, { body: { connections: [...base, { fromStageId: v[1].id, toStageId: randomUUID() }] } });
    expect(tgt.body.message).toBe('Invalid connection: could not resolve target stage');
    const off = await sa.call('PUT', `/api/filter-cleaning-profiles/${p2}`, {
      body: { stages: [{ nodeType: 'START' }, { nodeType: 'STAGE', stateKey: 'DRY_IN' }, { nodeType: 'STAGE', stateKey: 'DRY_OUT' }, { nodeType: 'CHECKLIST', configuration: { checklistProfileId: ckOff } }, { nodeType: 'END' }] },
    });
    expect(off.status).toBe(400);
    expect(off.body.error).toBe('CHECKLIST_DISABLED');
    expect(await prisma.filterCleaningProfile.count({ where: { lineageId: { in: [...own.cleaningLineages] } } })).toBe(before);
    expect((await prisma.filterCleaningProfile.findUnique({ where: { id: p2 } }))!.status).toBe('ACTIVE');
  });

  it('editing a superseded (archived) version is refused with 409, nothing changes', async () => {
    internalErrors.length = 0;
    const res = await sa.call('PUT', `/api/filter-cleaning-profiles/${p1}`, { body: { description: 'stale edit' } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'CONFLICT',
      message: `Version 1 of "${own.n('MAIN')}" has been superseded by version 4. Open the latest version to change it.`,
    });
    expect(internalErrors).toEqual([]);
    expect((await prisma.filterCleaningProfile.findUnique({ where: { id: p2 } }))!.status).toBe('ACTIVE');
  });
});

describe('cleaning-profiles — versions', () => {
  it('lists the whole lineage newest first and serves any frozen version', async () => {
    const res = await sa.call('GET', `/api/filter-cleaning-profiles/${p1}/versions`);
    expect(res.status).toBe(200);
    expect(res.body.versions.map((v: any) => [v.version, v.status])).toEqual([[4, 'ACTIVE'], [3, 'ARCHIVED'], [2, 'ARCHIVED'], [1, 'ARCHIVED']]);
    const v1 = await sa.call('GET', `/api/filter-cleaning-profiles/${p2}/versions/1`);
    expect(v1.status).toBe(200);
    expect(v1.body).toMatchObject({ id: p1, version: 1, name: own.n('MAIN') });
    expect(v1.body.stages.map((s: any) => s.stateKey)).toEqual([null, 'WASH_IN', 'WASH_OUT', null, null]);
    const noVer = await sa.call('GET', `/api/filter-cleaning-profiles/${p1}/versions/42`);
    expect(noVer.status).toBe(404);
    expect(noVer.body.message).toMatch(/^Version 42 not found in lineage /);
    for (const url of [`/api/filter-cleaning-profiles/${randomUUID()}/versions`, `/api/filter-cleaning-profiles/${randomUUID()}/versions/1`]) {
      const r = await sa.call('GET', url);
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('Cleaning profile not found');
    }
    // Version history is not part of the operator alternate.
    const operator = await op.call('GET', `/api/filter-cleaning-profiles/${p1}/versions`);
    expect(operator.status).toBe(403);
  });
});

describe('cleaning-profiles — toggle status and archive', () => {
  it('toggle refuses while an active filter profile references the profile; deactivates and re-activates with audit rows', async () => {
    const fp = await own.filterProfile('FP-TOGGLE', minimal);
    const blocked = await sa.call('PATCH', `/api/filter-cleaning-profiles/${minimal}/toggle-status`, { body: {} });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Cannot deactivate: 1 active filter profile(s) reference this cleaning profile');
    await prisma.filterProfile.update({ where: { id: fp }, data: { isActive: false } });

    const noPw = await cp.call('PATCH', `/api/filter-cleaning-profiles/${minimal}/toggle-status`, { body: {} });
    expect(noPw.status).toBe(401);
    const off = await cp.call('PATCH', `/api/filter-cleaning-profiles/${minimal}/toggle-status`, { pw: PASSWORD, body: {} });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ success: true, status: 'INACTIVE' });
    expect((await prisma.filterCleaningProfile.findUnique({ where: { id: minimal } }))!.status).toBe('ARCHIVED');
    const [deact] = await auditFor(minimal, 'DEACTIVATED');
    expect(deact.beforeValue).toEqual({ status: 'ACTIVE' });

    const inactive = await sa.call('GET', `/api/filter-cleaning-profiles?status=INACTIVE&search=${own.tag}`);
    expect(inactive.body.data.map((r: any) => r.id)).toEqual([minimal]);

    const on = await sa.call('PATCH', `/api/filter-cleaning-profiles/${minimal}/toggle-status`, { body: {} });
    expect(on.body).toEqual({ success: true, status: 'ACTIVE' });
    const [act] = await auditFor(minimal, 'ACTIVATED');
    expect(act.afterValue).toEqual({ status: 'ACTIVE' });

    const missing = await sa.call('PATCH', `/api/filter-cleaning-profiles/${randomUUID()}/toggle-status`, { body: {} });
    expect(missing.status).toBe(404);
  });

  it('re-activating a profile whose checklist has since been disabled is refused', async () => {
    // FP-MAIN followed the lineage to the newest version on every edit; free it first.
    await prisma.filterProfile.updateMany({ where: { name: own.n('FP-MAIN') }, data: { isActive: false } });
    const off = await sa.call('PATCH', `/api/filter-cleaning-profiles/${p2}/toggle-status`, { body: {} });
    expect(off.body.status).toBe('INACTIVE');
    await prisma.checklistProfile.update({ where: { id: ckOn }, data: { isActive: false } });
    const on = await sa.call('PATCH', `/api/filter-cleaning-profiles/${p2}/toggle-status`, { body: {} });
    expect(on.status).toBe(400);
    expect(on.body.error).toBe('CHECKLIST_DISABLED');
    expect((await prisma.filterCleaningProfile.findUnique({ where: { id: p2 } }))!.status).toBe('ARCHIVED');
    await prisma.checklistProfile.update({ where: { id: ckOn }, data: { isActive: true } });
  });

  it('archive (DELETE) refuses while an active filter profile references it, then archives with an audit row', async () => {
    const fp = await own.filterProfile('FP-ARCH', minimal);
    const blocked = await sa.call('DELETE', `/api/filter-cleaning-profiles/${minimal}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('Cannot archive: 1 active filter profile(s) reference this cleaning profile');
    await prisma.filterProfile.update({ where: { id: fp }, data: { isActive: false } });
    const noPw = await cp.call('DELETE', `/api/filter-cleaning-profiles/${minimal}`);
    expect(noPw.status).toBe(401);
    const res = await cp.call('DELETE', `/api/filter-cleaning-profiles/${minimal}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect((await prisma.filterCleaningProfile.findUnique({ where: { id: minimal } }))!.status).toBe('ARCHIVED');
    const [audit] = await auditFor(minimal, 'ARCHIVED');
    expect(audit.afterValue).toEqual({ status: 'ARCHIVED' });
    const missing = await sa.call('DELETE', `/api/filter-cleaning-profiles/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });
});

describe('cleaning-profiles — deleteProfile (service only; no route calls it)', () => {
  const svc = new CleaningProfileService();
  const ctx = () => ({ userId: sa.username, userSub: sa.id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined }) as any;

  it('refuses while a cycle or a filter-profile assignment references the version, then deletes with an audit row', async () => {
    await expect(svc.deleteProfile(ctx(), randomUUID())).rejects.toMatchObject({ statusCode: 404 });

    const cycle = await own.cycle(filterId, p1, { status: 'COMPLETED', completedAt: new Date() });
    await expect(svc.deleteProfile(ctx(), p1)).rejects.toMatchObject({ statusCode: 409, message: 'Cannot delete: 1 cleaning cycle(s) reference this version. Archive it instead.' });
    await prisma.cleaningCycle.delete({ where: { id: cycle } });

    const fp = await own.filterProfile('FP-DEL', p1);
    await expect(svc.deleteProfile(ctx(), p1)).rejects.toMatchObject({ statusCode: 409, message: 'Cannot delete: 1 filter profile assignment(s) reference this version.' });
    await prisma.filterProfile.delete({ where: { id: fp } });

    await expect(svc.deleteProfile(ctx(), p1)).resolves.toEqual({ success: true });
    expect(await prisma.filterCleaningProfile.count({ where: { id: p1 } })).toBe(0);
    expect(await prisma.filterPipelineStage.count({ where: { profileId: p1 } })).toBe(0);
    const [audit] = await auditFor(p1, 'DELETED');
    expect(audit.beforeValue).toMatchObject({ name: own.n('MAIN'), version: 1 });
  });
});
