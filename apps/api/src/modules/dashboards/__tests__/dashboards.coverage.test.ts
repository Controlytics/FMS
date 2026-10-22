/**
 * Dashboards module — behaviour coverage through the real routes (2026-10-21).
 *
 * Mounted at /api/dashboards exactly as app.ts does, on the production error
 * handler (e2e/test-helper.ts). Every user, role, dashboard and asset this file
 * touches is its own (prefix `cvo`) and is removed in afterAll.
 *
 * What a client or the database observes is asserted: status, body, rows
 * written, and the audit row each mutation must leave (with its chain link to
 * the row before it).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors, authGet, authPost, authPut, authDelete } from '../../../e2e/test-helper.js';
import dashboardRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, createRole, createUser, login, deleteUsers, deleteRoles, runSuffix,
  createHierarchy, deleteHierarchy,
} from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoDash@2026!x';
const ROLE_VIEW = `cvoDV${S}`;     // DASHBOARD_VIEW only
const ROLE_MGR = `cvoDM${S}`;      // create / manage / assign / view
const ROLE_NONE = `cvoDN${S}`;     // nothing
const U = {
  sa: `cvodsa${S}`.toLowerCase(),
  admin: `cvodad${S}`.toLowerCase(),
  v1: `cvodv1${S}`.toLowerCase(),
  v2: `cvodv2${S}`.toLowerCase(),
  mgr: `cvodmg${S}`.toLowerCase(),
  none: `cvodnn${S}`.toLowerCase(),
};

let app: FastifyInstance;
const ids: Record<string, string> = {};
const tok: Record<string, string> = {};
const dashboardIds: string[] = [];
let hier: Awaited<ReturnType<typeof createHierarchy>> | undefined;

/** The audit row this file wrote for (action, targetId), with its predecessor in the chain. */
async function auditWithLink(action: string, targetId: string) {
  const row = await prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });
  expect(row, `${action} row for ${targetId}`).toBeTruthy();
  const prev = await prisma.auditTrail.findFirst({
    where: { chainPosition: { lt: row!.chainPosition! } }, orderBy: { chainPosition: 'desc' },
  });
  expect(row!.previousChecksum).toBe(prev!.checksum);
  return row!;
}

beforeAll(async () => {
  await createRole(ROLE_VIEW, ['DASHBOARD_VIEW']);
  await createRole(ROLE_MGR, ['DASHBOARD_VIEW', 'DASHBOARD_CREATE', 'DASHBOARD_MANAGE', 'DASHBOARD_ASSIGN']);
  await createRole(ROLE_NONE, []);
  ids.sa = await createUser(U.sa, 'SUPER_ADMIN', PW);
  ids.admin = await createUser(U.admin, 'ADMIN', PW);
  ids.v1 = await createUser(U.v1, ROLE_VIEW, PW);
  ids.v2 = await createUser(U.v2, ROLE_VIEW, PW);
  ids.mgr = await createUser(U.mgr, ROLE_MGR, PW);
  ids.none = await createUser(U.none, ROLE_NONE, PW);
  app = await buildApp([{ plugin: dashboardRoutes, prefix: '/api/dashboards' }]);
  for (const k of Object.keys(U) as Array<keyof typeof U>) tok[k] = await login(app, U[k], PW);
  hier = await createHierarchy(`cvoD${S}`);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['dashboards', () => prisma.dashboard.deleteMany({ where: { id: { in: dashboardIds } } })],
    ['hierarchy', () => deleteHierarchy(hier)],
    ['users', () => deleteUsers(Object.values(ids))],
    ['roles', () => deleteRoles([ROLE_VIEW, ROLE_MGR, ROLE_NONE])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

async function createDashboard(title: string, extra: Record<string, unknown> = {}) {
  const res = await authPost(app, '/api/dashboards', tok.mgr, { title, ...extra });
  expect(res.statusCode).toBe(201);
  const d = res.json();
  dashboardIds.push(d.id);
  return d;
}

describe('widget types', () => {
  it('lists the nine widget types to any signed-in user, even one with no permissions', async () => {
    const res = await authGet(app, '/api/dashboards/widget-types', tok.none);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((t: any) => t.type)).toEqual([
      'timeseries_chart', 'gauge', 'value_card', 'entity_table', 'status_indicator', 'scada_symbol', 'map', 'html_widget', 'image',
    ]);
  });

  it('is refused without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboards/widget-types' });
    expect(res.statusCode).toBe(401);
  });
});

describe('create / update / delete a dashboard', () => {
  it('refuses a caller without DASHBOARD_CREATE and writes nothing', async () => {
    const title = `cvo-denied-${S}`;
    const res = await authPost(app, '/api/dashboards', tok.v1, { title });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
    expect(await prisma.dashboard.count({ where: { title } })).toBe(0);
  });

  it('rejects a body without a title as a validation error, not a 500', async () => {
    const res = await authPost(app, '/api/dashboards', tok.mgr, { description: 'no title' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
  });

  it('creates a dashboard with defaults, stamps the creator and audits it', async () => {
    const d = await createDashboard(`cvo-plain-${S}`, { description: 'desc' });
    expect(d).toMatchObject({ title: `cvo-plain-${S}`, description: 'desc', layout: {}, isDefault: false, isActive: true, createdBy: ids.mgr });
    const row = await auditWithLink('DASHBOARD_CREATED', d.id);
    expect(row.userId).toBe(U.mgr);
    expect(row.afterValue).toEqual({ title: `cvo-plain-${S}` });
  });

  it('a new default dashboard clears the default flag on the previous default', async () => {
    const a = await createDashboard(`cvo-defA-${S}`, { isDefault: true, layout: { cols: 12 } });
    expect(a.isDefault).toBe(true);
    expect(a.layout).toEqual({ cols: 12 });
    const b = await createDashboard(`cvo-defB-${S}`, { isDefault: true });
    expect(b.isDefault).toBe(true);
    expect((await prisma.dashboard.findUnique({ where: { id: a.id } }))!.isDefault).toBe(false);
  });

  it('PUT updates declared fields, strips provenance keys, re-points the default and audits before/after', async () => {
    const a = await createDashboard(`cvo-upd-${S}`);
    const other = await createDashboard(`cvo-upd-other-${S}`, { isDefault: true });
    const res = await authPut(app, `/api/dashboards/${a.id}`, tok.mgr, {
      title: `cvo-upd2-${S}`, isDefault: true, createdBy: randomUUID(), createdAt: '1990-01-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.dashboard.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ title: `cvo-upd2-${S}`, isDefault: true, createdBy: ids.mgr });
    expect(row!.createdAt.getUTCFullYear()).not.toBe(1990);
    expect((await prisma.dashboard.findUnique({ where: { id: other.id } }))!.isDefault).toBe(false);
    const audit = await auditWithLink('DASHBOARD_UPDATED', a.id);
    expect((audit.beforeValue as any).title).toBe(`cvo-upd-${S}`);
    expect((audit.afterValue as any).title).toBe(`cvo-upd2-${S}`);
  });

  it('PUT without isDefault leaves other dashboards alone', async () => {
    const def = await createDashboard(`cvo-keepdef-${S}`, { isDefault: true });
    const a = await createDashboard(`cvo-nodef-${S}`);
    const res = await authPut(app, `/api/dashboards/${a.id}`, tok.mgr, { description: 'only text' });
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBe('only text');
    expect((await prisma.dashboard.findUnique({ where: { id: def.id } }))!.isDefault).toBe(true);
  });

  it('PUT / DELETE on an unknown dashboard answer 404', async () => {
    const id = randomUUID();
    const put = await authPut(app, `/api/dashboards/${id}`, tok.mgr, { title: 'x' });
    expect(put.statusCode).toBe(404);
    expect(put.json().error).toBe('Dashboard not found');
    const del = await authDelete(app, `/api/dashboards/${id}`, tok.mgr);
    expect(del.statusCode).toBe(404);
    expect(internalErrors).toEqual([]);
  });

  it('PUT requires DASHBOARD_MANAGE', async () => {
    const a = await createDashboard(`cvo-noperm-${S}`);
    const res = await authPut(app, `/api/dashboards/${a.id}`, tok.v1, { title: 'hijack' });
    expect(res.statusCode).toBe(403);
    expect((await prisma.dashboard.findUnique({ where: { id: a.id } }))!.title).toBe(`cvo-noperm-${S}`);
  });

  it('DELETE soft-deletes (isActive=false), audits, and drops it from the list', async () => {
    const a = await createDashboard(`cvo-del-${S}`);
    const res = await authDelete(app, `/api/dashboards/${a.id}`, tok.mgr);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect((await prisma.dashboard.findUnique({ where: { id: a.id } }))!.isActive).toBe(false);
    const audit = await auditWithLink('DASHBOARD_DELETED', a.id);
    expect(audit.afterValue).toEqual({ isActive: false });
    const list = await authGet(app, '/api/dashboards?limit=100', tok.sa);
    expect(list.json().data.map((x: any) => x.id)).not.toContain(a.id);
  });
});

describe('visibility: list + get by id', () => {
  let d1: any; let d2: any;

  beforeAll(async () => {
    d1 = await createDashboard(`cvo-vis1-${S}`);
    d2 = await createDashboard(`cvo-vis2-${S}`);
  }, 60_000);

  it('the list paginates and counts for SUPER_ADMIN / ADMIN (all active dashboards)', async () => {
    for (const t of [tok.sa, tok.admin]) {
      const res = await authGet(app, '/api/dashboards?page=1&limit=1', t);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.limit).toBe(1);
      expect(body.total).toBeGreaterThanOrEqual(2);
      expect(body.totalPages).toBe(body.total);
      expect(body.data[0]._count).toHaveProperty('widgets');
    }
  });

  it('a viewer with no assignment of any kind sees every active dashboard', async () => {
    const res = await authGet(app, '/api/dashboards?limit=100', tok.v1);
    expect(res.statusCode).toBe(200);
    const listed = res.json().data.map((x: any) => x.id);
    expect(listed).toEqual(expect.arrayContaining([d1.id, d2.id]));
  });

  it('a caller without DASHBOARD_VIEW cannot list', async () => {
    const res = await authGet(app, '/api/dashboards', tok.none);
    expect(res.statusCode).toBe(403);
  });

  it('assigning by USER narrows that user to the assigned dashboards; assigning by ROLE narrows the role', async () => {
    const a = await authPost(app, `/api/dashboards/${d1.id}/assign`, tok.mgr, { assigneeType: 'USER', userId: ids.v1 });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ dashboardId: d1.id, assigneeType: 'USER', userId: ids.v1, roleValue: null });
    const audit = await auditWithLink('DASHBOARD_ASSIGNED', d1.id);
    expect(audit.afterValue).toMatchObject({ assignmentId: a.json().id, assigneeType: 'USER', userId: ids.v1 });

    const v1only = (await authGet(app, '/api/dashboards?limit=100', tok.v1)).json().data.map((x: any) => x.id);
    expect(v1only).toEqual([d1.id]);

    const r = await authPost(app, `/api/dashboards/${d2.id}/assign`, tok.mgr, { assigneeType: 'ROLE', roleValue: ROLE_VIEW });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ assigneeType: 'ROLE', roleValue: ROLE_VIEW, userId: null });

    const v2list = (await authGet(app, '/api/dashboards?limit=100', tok.v2)).json().data.map((x: any) => x.id);
    expect(v2list).toEqual([d2.id]);
    const v1list = (await authGet(app, '/api/dashboards?limit=100', tok.v1)).json().data.map((x: any) => x.id).sort();
    expect(v1list).toEqual([d1.id, d2.id].sort());
  });

  it('GET /:id honours the same assignments (a user with no route to the dashboard gets 404)', async () => {
    const ok = await authGet(app, `/api/dashboards/${d1.id}`, tok.v1);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: d1.id, widgets: [], assignments: [expect.objectContaining({ userId: ids.v1 })] });
    const denied = await authGet(app, `/api/dashboards/${d1.id}`, tok.v2);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error).toBe('Dashboard not found');
  });

  it('ADMIN reads any existing dashboard and gets 404 for an unknown id', async () => {
    expect((await authGet(app, `/api/dashboards/${d2.id}`, tok.admin)).statusCode).toBe(200);
    const missing = await authGet(app, `/api/dashboards/${randomUUID()}`, tok.admin);
    expect(missing.statusCode).toBe(404);
  });

  it('a non-uuid id is a validation error', async () => {
    const res = await authGet(app, '/api/dashboards/not-a-uuid', tok.sa);
    expect(res.statusCode).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('removing an assignment checks the dashboard in the path, audits, then deletes the row', async () => {
    const a = await authPost(app, `/api/dashboards/${d1.id}/assign`, tok.mgr, { assigneeType: 'USER', userId: ids.v2 });
    const assignmentId = a.json().id;
    const wrong = await authDelete(app, `/api/dashboards/${d2.id}/assign/${assignmentId}`, tok.mgr);
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json().error).toBe('Assignment not found');
    expect(await prisma.dashboardAssignment.count({ where: { id: assignmentId } })).toBe(1);

    const res = await authDelete(app, `/api/dashboards/${d1.id}/assign/${assignmentId}`, tok.mgr);
    expect(res.statusCode).toBe(200);
    expect(await prisma.dashboardAssignment.count({ where: { id: assignmentId } })).toBe(0);
    const audit = await auditWithLink('DASHBOARD_UNASSIGNED', d1.id);
    expect(audit.beforeValue).toMatchObject({ assignmentId, assigneeType: 'USER', userId: ids.v2 });
    expect(audit.afterValue).toEqual({ removed: true });
  });

  it('assignment endpoints need DASHBOARD_ASSIGN', async () => {
    const res = await authPost(app, `/api/dashboards/${d1.id}/assign`, tok.v1, { assigneeType: 'ROLE', roleValue: ROLE_VIEW });
    expect(res.statusCode).toBe(403);
  });
});

describe('widgets', () => {
  let d: any; let other: any;

  beforeAll(async () => {
    d = await createDashboard(`cvo-w-${S}`);
    other = await createDashboard(`cvo-w-other-${S}`);
  }, 60_000);

  async function addWidget(dashId: string, body: Record<string, unknown>) {
    const res = await authPost(app, `/api/dashboards/${dashId}/widgets`, tok.mgr, body);
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('adds a widget with server defaults and audits it', async () => {
    const w = await addWidget(d.id, { widgetType: 'gauge', title: 'G' });
    expect(w).toMatchObject({
      dashboardId: d.id, widgetType: 'gauge', title: 'G', config: {}, dataSource: {},
      position: { x: 0, y: 0, w: 4, h: 3 }, refreshInterval: 30,
    });
    const audit = await auditWithLink('DASHBOARD_WIDGET_CREATED', w.id);
    expect(audit.afterValue).toMatchObject({ dashboardId: d.id, dashboardTitle: d.title, widgetType: 'gauge', title: 'G' });
  });

  it('keeps explicit config / position / refreshInterval (0 is not replaced by the default)', async () => {
    const w = await addWidget(d.id, {
      widgetType: 'map', title: 'M', config: { zoom: 3 }, position: { x: 1, y: 2, w: 3, h: 4 }, dataSource: { entityIds: [] }, refreshInterval: 0,
    });
    expect(w).toMatchObject({ config: { zoom: 3 }, position: { x: 1, y: 2, w: 3, h: 4 }, refreshInterval: 0 });
  });

  it('rejects an unknown widget type and an unknown dashboard', async () => {
    const bad = await authPost(app, `/api/dashboards/${d.id}/widgets`, tok.mgr, { widgetType: 'pie', title: 'x' });
    expect(bad.statusCode).toBe(400);
    const missing = await authPost(app, `/api/dashboards/${randomUUID()}/widgets`, tok.mgr, { widgetType: 'gauge', title: 'x' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('Dashboard not found');
    expect(internalErrors).toEqual([]);
  });

  it('PUT updates a widget, cannot re-parent it, and is scoped to its own dashboard', async () => {
    const w = await addWidget(d.id, { widgetType: 'value_card', title: 'V' });
    const res = await authPut(app, `/api/dashboards/${d.id}/widgets/${w.id}`, tok.mgr, {
      title: 'V2', refreshInterval: 5, dashboardId: other.id, widgetType: 'html_widget',
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.dashboardWidget.findUnique({ where: { id: w.id } });
    expect(row).toMatchObject({ title: 'V2', refreshInterval: 5, dashboardId: d.id, widgetType: 'value_card' });
    const audit = await auditWithLink('DASHBOARD_WIDGET_UPDATED', w.id);
    expect((audit.beforeValue as any).title).toBe('V');
    expect((audit.afterValue as any).title).toBe('V2');

    const wrongParent = await authPut(app, `/api/dashboards/${other.id}/widgets/${w.id}`, tok.mgr, { title: 'x' });
    expect(wrongParent.statusCode).toBe(404);
    expect(wrongParent.json().error).toBe('Widget not found');
  });

  it('DELETE audits first, then removes the row; unknown widget is 404', async () => {
    const w = await addWidget(d.id, { widgetType: 'image', title: 'I' });
    const missing = await authDelete(app, `/api/dashboards/${other.id}/widgets/${w.id}`, tok.mgr);
    expect(missing.statusCode).toBe(404);
    const res = await authDelete(app, `/api/dashboards/${d.id}/widgets/${w.id}`, tok.mgr);
    expect(res.statusCode).toBe(200);
    expect(await prisma.dashboardWidget.count({ where: { id: w.id } })).toBe(0);
    const audit = await auditWithLink('DASHBOARD_WIDGET_DELETED', w.id);
    expect((audit.beforeValue as any).title).toBe('I');
    expect(audit.afterValue).toEqual({ deleted: true });
  });

  it('PUT /layout moves the listed widgets and audits the positions', async () => {
    const w1 = await addWidget(d.id, { widgetType: 'gauge', title: 'L1' });
    const w2 = await addWidget(d.id, { widgetType: 'gauge', title: 'L2' });
    const positions = [
      { widgetId: w1.id, x: 5, y: 6, w: 2, h: 2 },
      { widgetId: w2.id, x: 0, y: 9, w: 6, h: 1 },
    ];
    const res = await authPut(app, `/api/dashboards/${d.id}/layout`, tok.mgr, { positions });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, updated: 2 });
    expect((await prisma.dashboardWidget.findUnique({ where: { id: w1.id } }))!.position).toEqual({ x: 5, y: 6, w: 2, h: 2 });
    expect((await prisma.dashboardWidget.findUnique({ where: { id: w2.id } }))!.position).toEqual({ x: 0, y: 9, w: 6, h: 1 });
    const audit = await auditWithLink('DASHBOARD_LAYOUT_UPDATED', d.id);
    expect(audit.afterValue).toEqual({ positions });
  });

  it('PUT /layout with an unknown widget id answers 404, not a 500', async () => {
    const res = await authPut(app, `/api/dashboards/${d.id}/layout`, tok.mgr, {
      positions: [{ widgetId: randomUUID(), x: 0, y: 0, w: 1, h: 1 }],
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
    expect(internalErrors).toEqual([]);
  });
});

describe('widget data', () => {
  let d: any;
  let hidden: any;

  beforeAll(async () => {
    d = await createDashboard(`cvo-data-${S}`);
    hidden = await createDashboard(`cvo-data-hidden-${S}`);
    // v2 gets a ROLE-free, USER assignment to `hidden` only → `d` is invisible to v2.
    await authPost(app, `/api/dashboards/${hidden.id}/assign`, tok.mgr, { assigneeType: 'USER', userId: ids.v2 });
  }, 60_000);

  async function widget(body: Record<string, unknown>) {
    const res = await authPost(app, `/api/dashboards/${d.id}/widgets`, tok.mgr, body);
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('a widget with no entity ids says so', async () => {
    const w = await widget({ widgetType: 'gauge', title: 'none' });
    const res = await authGet(app, `/api/dashboards/${d.id}/data/${w.id}`, tok.sa);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ widgetId: w.id, data: [], message: 'No entity IDs configured' });
  });

  it('telemetry widgets return an empty series (telemetry source removed)', async () => {
    for (const widgetType of ['value_card', 'gauge', 'status_indicator', 'timeseries_chart']) {
      const w = await widget({ widgetType, title: widgetType, dataSource: { entityIds: [hier!.blockId], telemetryKeys: ['t'] } });
      const res = await authGet(app, `/api/dashboards/${d.id}/data/${w.id}`, tok.admin);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ widgetId: w.id, widgetType, data: [] });
    }
  });

  it('entity_table returns the ACTIVE listed entities only', async () => {
    const w = await widget({ widgetType: 'entity_table', title: 'T', dataSource: { entityIds: [hier!.blockId, hier!.ahuId, randomUUID()] } });
    const res = await authGet(app, `/api/dashboards/${d.id}/data/${w.id}`, tok.sa);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.widgetType).toBe('entity_table');
    expect(body.data.map((e: any) => e.id).sort()).toEqual([hier!.blockId, hier!.ahuId].sort());
    expect(body.data[0]).toHaveProperty('templateId');
  });

  it('other widget types report that data fetch is not implemented', async () => {
    const w = await widget({ widgetType: 'scada_symbol', title: 'S', dataSource: { entityIds: [hier!.blockId] } });
    const res = await authGet(app, `/api/dashboards/${d.id}/data/${w.id}`, tok.sa);
    expect(res.json()).toEqual({ widgetId: w.id, widgetType: 'scada_symbol', data: [], message: 'Widget type data fetch not implemented' });
  });

  it('a caller who cannot see the dashboard gets 404; an unknown widget is 404', async () => {
    const w = await widget({ widgetType: 'gauge', title: 'priv' });
    const denied = await authGet(app, `/api/dashboards/${d.id}/data/${w.id}`, tok.v2);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error).toBe('Dashboard not found');
    const missing = await authGet(app, `/api/dashboards/${d.id}/data/${randomUUID()}`, tok.sa);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('Widget not found');
  });
});
