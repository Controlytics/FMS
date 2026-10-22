/**
 * Route params that name a uuid row are validated as uuids (2026-10-22).
 *
 * D-PLAT-1 / D-AUTH-4 class: a param declared as a bare string reaches Prisma,
 * which refuses a non-uuid against a @db.Uuid column with P2023. The error
 * handler surfaces that as 400 DATA_CONSTRAINT plus an ERROR-level "Unmapped
 * Prisma error" log line per mistyped URL. With `format: 'uuid'` in the route
 * schema the refusal is a 400 VALIDATION_ERROR naming the `format` keyword on the
 * param, raised before any preHandler or query runs.
 *
 * Every route here was found by the 2026-10-22 sweep of all parameterised
 * routes (audit's four :id routes are covered in
 * modules/audit/__tests__/audit-routes.coverage.test.ts). A well-formed but
 * unknown uuid must still reach the handler: the control below proves the
 * schema change refuses only malformed ids.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from './test-helper.js';
import helpRoutes from '../modules/help/routes.js';
import debugTraceRoutes from '../modules/debug-traces/routes.js';
import notificationRulesRoutes from '../modules/notification-rules/routes.js';
import reportReviewRoutes from '../modules/report-reviews/routes.js';
import checklistProfileRoutes from '../modules/checklist-profiles/routes.js';
import { cleanupAll, createUser, deleteUsers, login, runSuffix } from './support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvsUuid@2026!x';
const USERNAME = `cvsuuid${S}`.toLowerCase();
let app: FastifyInstance;
let token = '';
const userIds: string[] = [];

type Probe = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: (id: string) => string; payload?: Record<string, unknown> };

// [route label, probe]. Payloads are valid for each body schema, so the only
// validation failure a malformed id can produce is the param's own.
const PROBES: Array<[string, Probe]> = [
  ['PUT /api/help/:id', { method: 'PUT', url: (id) => `/api/help/${id}`, payload: { title: 'uuid probe' } }],
  ['GET /api/help/:id/versions', { method: 'GET', url: (id) => `/api/help/${id}/versions` }],
  ['DELETE /api/help/:id', { method: 'DELETE', url: (id) => `/api/help/${id}` }],
  ['GET /api/debug/traces/:id', { method: 'GET', url: (id) => `/api/debug/traces/${id}` }],
  ['GET /api/notification-rules/:id', { method: 'GET', url: (id) => `/api/notification-rules/${id}` }],
  ['PUT /api/notification-rules/:id', { method: 'PUT', url: (id) => `/api/notification-rules/${id}`, payload: { name: 'uuid probe' } }],
  ['DELETE /api/notification-rules/:id', { method: 'DELETE', url: (id) => `/api/notification-rules/${id}` }],
  ['PUT /api/notification-rules/:id/toggle', { method: 'PUT', url: (id) => `/api/notification-rules/${id}/toggle`, payload: {} }],
  ['POST /api/notification-rules/:id/test', { method: 'POST', url: (id) => `/api/notification-rules/${id}/test`, payload: {} }],
  ['PUT /api/notifications/:id/read', { method: 'PUT', url: (id) => `/api/notifications/${id}/read`, payload: {} }],
  ['PUT /api/notifications/:id/unread', { method: 'PUT', url: (id) => `/api/notifications/${id}/unread`, payload: {} }],
  ['DELETE /api/notifications/:id', { method: 'DELETE', url: (id) => `/api/notifications/${id}` }],
  ['DELETE /api/notification-settings/logs/:id', { method: 'DELETE', url: (id) => `/api/notification-settings/logs/${id}` }],
  ['PUT /api/notification-settings/templates/:id', { method: 'PUT', url: (id) => `/api/notification-settings/templates/${id}`, payload: { name: 'uuid probe' } }],
  ['DELETE /api/notification-settings/templates/:id', { method: 'DELETE', url: (id) => `/api/notification-settings/templates/${id}` }],
  ['GET /api/report-reviews/:id', { method: 'GET', url: (id) => `/api/report-reviews/${id}` }],
  ['POST /api/report-reviews/:id/review', { method: 'POST', url: (id) => `/api/report-reviews/${id}/review`, payload: { action: 'reject', remarks: 'uuid probe' } }],
  ['POST /api/report-reviews/:id/approve', { method: 'POST', url: (id) => `/api/report-reviews/${id}/approve`, payload: { action: 'reject', remarks: 'uuid probe' } }],
];

/**
 * Run `fn` while capturing what the app logger prints. lib/logger.ts writes every
 * formatted record to process.stdout synchronously; a P2023 lookup prints an
 * `ERROR  [prisma]` line there (verified 2026-10-22 against an unvalidated id).
 */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; text: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
  try {
    const result = await fn();
    await new Promise((r) => setTimeout(r, 25)); // let any late Prisma log event land
    return { result, text: chunks.join('') };
  } finally {
    spy.mockRestore();
  }
}

function send(p: Probe, id: string) {
  return app.inject({
    method: p.method,
    url: p.url(id),
    headers: { authorization: `Bearer ${token}` },
    ...(p.payload !== undefined ? { payload: p.payload } : {}),
  });
}

/** True when the response is a schema refusal of the `id` path param. */
function isIdParamRefusal(body: any): boolean {
  return body?.error === 'VALIDATION_ERROR'
    && Array.isArray(body.details)
    && body.details.some((d: any) => d.instancePath === '/id' && d.keyword === 'format');
}

beforeAll(async () => {
  app = await buildApp([
    { plugin: helpRoutes, prefix: '/api/help' },
    { plugin: debugTraceRoutes, prefix: '/api/debug/traces' },
    { plugin: notificationRulesRoutes, prefix: '/api/notification-rules' },
    { plugin: reportReviewRoutes, prefix: '/api/report-reviews' },
    { plugin: checklistProfileRoutes, prefix: '/api/checklist-profiles' },
  ]);
  userIds.push(await createUser(USERNAME, 'SUPER_ADMIN', PW));
  token = await login(app, USERNAME, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['users', () => deleteUsers(userIds)],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('uuid route params are validated by the route schema', () => {
  it.each(PROBES)('%s refuses a malformed id with 400 VALIDATION_ERROR (format: uuid), not DATA_CONSTRAINT, and logs no ERROR', async (_label, probe) => {
    const { result: res, text } = await captureStdout(() => send(probe, 'not-a-uuid'));
    expect(text).not.toMatch(/\bERROR\b/);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'format', instancePath: '/id', params: { format: 'uuid' } }),
    ]));
    expect(internalErrors).toEqual([]);
  });

  it.each(PROBES)('%s still lets a well-formed unknown uuid through to the handler', async (_label, probe) => {
    const res = await send(probe, randomUUID());
    expect(isIdParamRefusal(res.json())).toBe(false);
    expect(res.statusCode).not.toBe(500);
    expect(internalErrors).toEqual([]);
  });
});

// Same class in request BODIES (2026-10-22): an id list declared as bare strings
// reached `id: { in: ids }` and came back as 400 DATA_CONSTRAINT + an ERROR line.
// [route label, method, url, body key, path of the first item].
type BodyProbe = [string, 'PUT' | 'POST', string, string];
const BODY_PROBES: BodyProbe[] = [
  ['PUT /api/notifications/bulk-read', 'PUT', '/api/notifications/bulk-read', 'ids'],
  ['PUT /api/notifications/bulk-unread', 'PUT', '/api/notifications/bulk-unread', 'ids'],
  ['POST /api/notifications/bulk-delete', 'POST', '/api/notifications/bulk-delete', 'ids'],
  ['PUT /api/checklist-profiles/:id/reorder', 'PUT', `/api/checklist-profiles/${randomUUID()}/reorder`, 'questionIds'],
];

function sendBody(method: 'PUT' | 'POST', url: string, key: string, ids: string[]) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: { [key]: ids } });
}

describe('uuid id lists in request bodies are validated by the route schema', () => {
  it.each(BODY_PROBES)('%s refuses a malformed id in the list with 400 VALIDATION_ERROR (format: uuid), and logs no ERROR', async (_label, method, url, key) => {
    const { result: res, text } = await captureStdout(() => sendBody(method, url, key, [randomUUID(), 'not-a-uuid']));
    expect(text).not.toMatch(/\bERROR\b/);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'format', instancePath: `/${key}/1`, params: { format: 'uuid' } }),
    ]));
    expect(internalErrors).toEqual([]);
  });

  it.each(BODY_PROBES)('%s still lets well-formed unknown uuids through to the handler', async (_label, method, url, key) => {
    const res = await sendBody(method, url, key, [randomUUID()]);
    expect(res.json()?.error).not.toBe('VALIDATION_ERROR');
    expect(res.statusCode).not.toBe(500);
    expect(internalErrors).toEqual([]);
  });
});
