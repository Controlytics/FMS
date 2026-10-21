/**
 * e2e — /api/debug/traces (modules/debug-traces/routes.ts), the operations log
 * served from audit_trail since the TSDB removal.
 *
 * What matters most here is SCOPING (root CLAUDE.md "Visibility: these audit
 * rows are SUPER_ADMIN-only"): a non-SUPER_ADMIN holder of READ_DEBUG_TRACE must
 * never see a row authored by a SUPER_ADMIN nor a MANUAL_RECORD_* / AUDIT_RECORD_*
 * row, on the list, the detail, or the counts. Also: the trace shape, the
 * failure-only filters that can never match, pagination, the date window, the
 * vestigial toggles (config-backed, audited, re-auth gated).
 *
 * Owns its SUPER_ADMIN, three roles/users, and audit rows tagged with a unique
 * token (back-dated to March 1972 so date windows are exact).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { dateRangeGuard } from '../lib/date-range-guard.js';
import debugTraceRoutes from '../modules/debug-traces/routes.js';
import { runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll, type ReauthGrant } from './support/owned-fixtures.js';

const SUF = runSuffix();
const TOKEN = `cvdt${SUF}`.toLowerCase();
const PW = 'CovDebug@2026x';
const SA = `cv_dt_sa_${SUF}`.toLowerCase();
const READER = `cv_dt_r_${SUF}`.toLowerCase();
const MANAGER = `cv_dt_m_${SUF}`.toLowerCase();
const NOBODY = `cv_dt_n_${SUF}`.toLowerCase();
const ROLE_R = `CVDT_R_${SUF}`;
const ROLE_M = `CVDT_M_${SUF}`;
const ROLE_N = `CVDT_N_${SUF}`;

let app: FastifyInstance;
const tok: Record<string, string> = {};
const userIds: string[] = [];
const rows: Record<string, string> = {};
let debugRowBefore: { configValue: unknown } | null = null;
let reauthAdded: ReauthGrant = [];

const get = (url: string, who: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tok[who]}` } });
const put = (url: string, who: string, payload: unknown, withPw = true) => app.inject({
  method: 'PUT', url, payload: payload as Record<string, unknown>,
  headers: { authorization: `Bearer ${tok[who]}`, ...(withPw ? { 'x-reauth-password': PW } : {}) },
});
const at = (day: number, h = 12) => new Date(Date.UTC(1972, 2, day, h, 0, 0));
const ids = (body: any) => body.data.map((t: any) => t.id);

beforeAll(async () => {
  app = await buildApp([{
    prefix: '/api/debug/traces',
    plugin: async (a) => { a.addHook('preHandler', dateRangeGuard); await a.register(debugTraceRoutes); },
  }]);
  await createRole(ROLE_R, ['READ_DEBUG_TRACE']);
  await createRole(ROLE_M, ['READ_DEBUG_TRACE', 'MANAGE_DEBUG_TRACE']);
  await createRole(ROLE_N, ['AUDIT_READ']);
  for (const [u, r] of [[SA, 'SUPER_ADMIN'], [READER, ROLE_R], [MANAGER, ROLE_M], [NOBODY, ROLE_N]] as const) {
    userIds.push(await createUser(u, r, PW));
    tok[u] = await login(app, u, PW);
  }
  // A: ordinary operator row with every optional column -> visible to all readers.
  rows.A = await auditLog({
    userId: READER, userName: READER, userRole: ROLE_R, action: 'CONFIG_CHANGED', targetType: 'system_config', targetId: `${TOKEN}-a`,
    beforeValue: { v: 1 }, afterValue: { v: 2 }, reason: 'why', signatureMeaning: 'meaning', ipAddress: '10.0.0.7', timestamp: at(10),
  });
  // B: written BY a SUPER_ADMIN -> hidden from non-SA (actor rule).
  rows.B = await auditLog({ userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'CONFIG_CHANGED', targetType: 'system_config', targetId: `${TOKEN}-b`, timestamp: at(10, 13) });
  // C: a console action by a non-SA -> hidden from non-SA (action rule).
  rows.C = await auditLog({ userId: READER, userName: READER, userRole: ROLE_R, action: 'MANUAL_RECORD_UPDATED', targetType: 'filter', targetId: `${TOKEN}-c`, timestamp: at(10, 14) });
  // D: system-emitted (no role) -> visible.
  rows.D = await auditLog({ userId: 'system', action: 'CONFIG_CHANGED', targetType: 'system_config', targetId: `${TOKEN}-d`, timestamp: at(12) });
  // E: bare row, found through userId (no target) -> visible; every optional field empty.
  rows.E = await auditLog({ userId: `${TOKEN}-actor`, action: 'CONFIG_CHANGED', timestamp: at(15) });

  debugRowBefore = await prisma.systemConfig.findUnique({ where: { configKey: 'debug' }, select: { configValue: true } });
  reauthAdded = await addReauth([['MANAGE_DEBUG_TRACES', ROLE_M]]);
}, 120_000);

afterAll(async () => {
  try {
    await cleanupAll([
      ['re-auth keys', () => removeReauth(reauthAdded)],
      debugRowBefore
        ? ['debug config (restore)', () => prisma.systemConfig.update({ where: { configKey: 'debug' }, data: { configValue: debugRowBefore!.configValue as any } })]
        : ['debug config (remove)', () => prisma.systemConfig.deleteMany({ where: { configKey: 'debug' } })],
      ['users', () => deleteUsers(userIds)],
      ['roles', () => deleteRoles([ROLE_R, ROLE_M, ROLE_N])],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('GET /api/debug/traces (list)', () => {
  it('maps each audited operation to a single-stage SUCCESS trace, newest chain position first', async () => {
    const res = await get(`/api/debug/traces?entityId=${TOKEN}`, SA);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 5, page: 1, limit: 20, totalPages: 1 });
    expect(ids(body)).toEqual([rows.E, rows.D, rows.C, rows.B, rows.A]);
    const a = body.data.find((t: any) => t.id === rows.A);
    expect(a).toEqual({
      id: rows.A, time: at(10).toISOString(), messageId: rows.A, entityId: `${TOKEN}-a`, entityName: 'system_config',
      transport: 'API', messageType: 'CONFIG_CHANGED', finalStatus: 'SUCCESS', totalDurationMs: 0,
      stages: [{
        stage: 1, name: 'CONFIG_CHANGED', status: 'SUCCESS', durationMs: 0,
        details: { before: { v: 1 }, after: { v: 2 }, signatureMeaning: 'meaning', reason: 'why', user: READER, role: ROLE_R, ipAddress: '10.0.0.7' },
      }],
    });
    const e = body.data.find((t: any) => t.id === rows.E);
    expect(e.entityId).toBeUndefined();
    expect(e.entityName).toBeUndefined();
    expect(e.stages[0].details).toEqual({});
  });

  it('a non-SUPER_ADMIN reader never sees SUPER_ADMIN-authored or console rows', async () => {
    const body = (await get(`/api/debug/traces?entityId=${TOKEN}`, READER)).json();
    expect(body.total).toBe(3);
    expect(ids(body)).toEqual([rows.E, rows.D, rows.A]);
    // A search term matching the hidden rows' own fields cannot widen the scope.
    expect((await get(`/api/debug/traces?entityId=${TOKEN}-b`, READER)).json().total).toBe(0);
    expect((await get(`/api/debug/traces?entityId=MANUAL_RECORD_UPDATED`, READER)).json().data.every((t: any) => t.messageType !== 'MANUAL_RECORD_UPDATED')).toBe(true);
  });

  it('pages with pageSize, and tolerates junk paging values', async () => {
    const p2 = (await get(`/api/debug/traces?entityId=${TOKEN}&page=2&pageSize=2`, SA)).json();
    expect(p2).toMatchObject({ total: 5, page: 2, limit: 2, totalPages: 3 });
    expect(ids(p2)).toEqual([rows.C, rows.B]);
    const junk = (await get(`/api/debug/traces?entityId=${TOKEN}&page=abc&pageSize=0`, SA)).json();
    expect(junk).toMatchObject({ page: 1, limit: 20 });
    const neg = (await get(`/api/debug/traces?entityId=${TOKEN}&page=-3&pageSize=-1`, SA)).json();
    expect(neg).toMatchObject({ page: 1, limit: 1, totalPages: 5 });
    const none = (await get(`/api/debug/traces?entityId=${TOKEN}-zzz`, SA)).json();
    expect(none).toMatchObject({ data: [], total: 0, totalPages: 1 });
  });

  it('failure / non-API / error-code filters can never match an audit row', async () => {
    for (const q of ['status=FAILED', 'transport=MQTT', 'errorCode=E42']) {
      expect((await get(`/api/debug/traces?entityId=${TOKEN}&${q}`, SA)).json()).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 1 });
    }
    expect((await get(`/api/debug/traces?entityId=${TOKEN}&status=SUCCESS&transport=API`, SA)).json().total).toBe(5);
  });

  it('restricts to a date window (full timestamps), and refuses an inverted one', async () => {
    const win = (await get(`/api/debug/traces?entityId=${TOKEN}&from=1972-03-11T00:00:00.000Z&to=1972-03-13T00:00:00.000Z`, SA)).json();
    expect(ids(win)).toEqual([rows.D]);
    expect(ids((await get(`/api/debug/traces?entityId=${TOKEN}&from=1972-03-14T00:00:00.000Z`, SA)).json())).toEqual([rows.E]);
    expect(ids((await get(`/api/debug/traces?entityId=${TOKEN}&to=1972-03-10T12:30:00.000Z`, SA)).json())).toEqual([rows.A]);
    const inverted = await get(`/api/debug/traces?from=1972-03-13&to=1972-03-11`, SA);
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json().error).toBe('INVALID_DATE_RANGE');
  });

  it('a bare-date end covers that whole day (same-day range finds the noon row); an unparseable bound is a 400', async () => {
    expect(ids((await get(`/api/debug/traces?entityId=${TOKEN}&from=1972-03-12&to=1972-03-12`, SA)).json())).toEqual([rows.D]);
    expect(ids((await get(`/api/debug/traces?entityId=${TOKEN}&to=1972-03-12`, SA)).json())).toEqual([rows.D, rows.C, rows.B, rows.A]);
    for (const q of ['from=garbage', 'to=not-a-date', 'from=garbage&to=1972-03-12']) {
      const r = await get(`/api/debug/traces?entityId=${TOKEN}&${q}`, SA);
      expect({ q, status: r.statusCode, error: r.json().error }).toEqual({ q, status: 400, error: 'INVALID_DATE' });
    }
  });

  it('requires READ_DEBUG_TRACE', async () => {
    expect((await get('/api/debug/traces', NOBODY)).statusCode).toBe(403);
    expect((await get('/api/debug/traces/stats', NOBODY)).statusCode).toBe(403);
    expect((await get(`/api/debug/traces/${rows.A}`, NOBODY)).statusCode).toBe(403);
  });
});

describe('GET /api/debug/traces/stats', () => {
  it('reports success-only stats, scoped to what the caller may see', async () => {
    // A row from now, so the 1h / 24h windows are non-empty for both callers.
    await auditLog({ userId: READER, userName: READER, userRole: ROLE_R, action: 'CONFIG_CHANGED', targetType: 'system_config', targetId: `${TOKEN}-now` });
    // Reader first: counts only grow, so SA(later) >= SA(now) >= reader(now).
    const reader = (await get('/api/debug/traces/stats', READER)).json();
    const sa = (await get('/api/debug/traces/stats', SA)).json();
    for (const s of [sa, reader]) {
      expect(s).toMatchObject({ successRate1h: 100, successRate24h: 100, avgDurationMs: 0, topErrors: [] });
      expect(s.byTransport.API.failed).toBe(0);
      expect(s.byTransport.API.total).toBeGreaterThanOrEqual(1);
    }
    // The reader's count excludes every SUPER_ADMIN / console row the SA's includes.
    expect(sa.byTransport.API.total).toBeGreaterThanOrEqual(reader.byTransport.API.total);
  });
});

describe('GET /api/debug/traces/:id (detail)', () => {
  it('returns one trace; a hidden row is a 404 for a non-SUPER_ADMIN even with its id', async () => {
    const res = await get(`/api/debug/traces/${rows.B}`, SA);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: rows.B, messageType: 'CONFIG_CHANGED', stages: [{ details: { role: 'SUPER_ADMIN', user: SA } }] });
    expect((await get(`/api/debug/traces/${rows.A}`, READER)).json().id).toBe(rows.A);
    for (const hidden of [rows.B, rows.C]) {
      const r = await get(`/api/debug/traces/${hidden}`, READER);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ error: 'NOT_FOUND', message: 'Trace not found.' });
    }
    expect((await get(`/api/debug/traces/${randomUUID()}`, SA)).statusCode).toBe(404);
  });
});

describe('vestigial toggles', () => {
  it('GET /operation-trace defaults to enabled when no config exists', async () => {
    if (debugRowBefore) return; // only meaningful on a DB without the row
    expect((await get('/api/debug/traces/operation-trace', READER)).json()).toEqual({ enabled: true });
  });

  it('PUT /operation-trace needs MANAGE_DEBUG_TRACE, honours the re-auth policy, persists and audits', async () => {
    expect((await put('/api/debug/traces/operation-trace', READER, { enabled: false })).statusCode).toBe(403);

    const noPw = await put('/api/debug/traces/operation-trace', MANAGER, { enabled: false }, false);
    expect(noPw.statusCode).toBe(401);
    expect(noPw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'MANAGE_DEBUG_TRACES' });

    const before = await prisma.systemConfig.findUnique({ where: { configKey: 'debug' } });
    const off = await put('/api/debug/traces/operation-trace', MANAGER, { enabled: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ enabled: false });
    expect((await prisma.systemConfig.findUnique({ where: { configKey: 'debug' } }))?.configValue).toEqual({ operation_trace_enabled: false });
    const row = await prisma.auditTrail.findFirst({ where: { action: 'CONFIG_CHANGED', targetId: 'debug', userId: MANAGER }, orderBy: { chainPosition: 'desc' } });
    expect(row).toMatchObject({ userRole: ROLE_M, targetType: 'system_config' });
    expect(row?.beforeValue ?? null).toEqual((before?.configValue as any) ?? null);
    expect(row?.afterValue).toEqual({ operation_trace_enabled: false });
    expect((await get('/api/debug/traces/operation-trace', READER)).json()).toEqual({ enabled: false });

    // A body without `enabled` means false; flipping back records the previous value.
    const on = await put('/api/debug/traces/operation-trace', MANAGER, { enabled: true });
    expect(on.json()).toEqual({ enabled: true });
    const row2 = await prisma.auditTrail.findFirst({ where: { action: 'CONFIG_CHANGED', targetId: 'debug', userId: MANAGER }, orderBy: { chainPosition: 'desc' } });
    expect(row2?.beforeValue).toEqual({ operation_trace_enabled: false });
    expect((await put('/api/debug/traces/operation-trace', MANAGER, {})).json()).toEqual({ enabled: false });
  });

  it('PUT /entity/:id/toggle is a documented no-op behind MANAGE_DEBUG_TRACE', async () => {
    const res = await put(`/api/debug/traces/entity/${randomUUID()}/toggle`, MANAGER, {});
    expect(res.json()).toEqual({ ok: true, note: 'Per-entity tracing was retired with the ingestion/TSDB removal.' });
    expect((await put(`/api/debug/traces/entity/${randomUUID()}/toggle`, READER, {})).statusCode).toBe(403);
  });
});
