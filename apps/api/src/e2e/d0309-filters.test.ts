/**
 * D03-09 / rule F-42 (2026-10-22), filter routes: a request that will be REFUSED
 * must be refused before the electronic signature is taken — otherwise a refused
 * review, retire, lifecycle move or upload costs the operator a password and
 * leaves a "signature applied" REAUTH_SUCCESS row with nothing signed behind it.
 *
 * Every case sends the CORRECT password and a request the route refuses, and
 * asserts: a 4xx that is not the gate's 401, and NO REAUTH_SUCCESS /
 * REAUTH_FAILED row for this file's own user. Policy-driven gates are switched
 * on for this file's own role only (addReauth), so on the old order the gate
 * verified the password — and wrote the row — before the refusal.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import hierarchyRoutes from '../modules/hierarchy/routes.js';
import filterOperationsRoutes from '../modules/filter-operations/routes.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy, type ReauthGrant,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `d0309f_sa_${SUF}`.toLowerCase();
const SA_PW = 'D0309fSa@2026x';
const MGR = `d0309f_mg_${SUF}`.toLowerCase();
const MGR_PW = 'D0309fMg@2026x';
const MGR_ROLE = `D0309F_${SUF}`;
const NONE = () => randomUUID();

let app: FastifyInstance;
let saToken = '';
let mgrToken = '';
const userIds: string[] = [];
const filterIds: string[] = [];
let grants: ReauthGrant = [];
let h: Awaited<ReturnType<typeof createHierarchy>> | undefined;

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const send = (token: string, password: string, method: Method, url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-reauth-password': password }, ...(payload ? { payload } : {}) });
const signatures = (username: string, since: Date) => prisma.auditTrail.count({
  where: { userId: username, timestamp: { gte: since }, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } },
});
/** Refused by the route (4xx), not by the gate (401), and nothing signed. */
async function refusedUnsigned(res: { statusCode: number; body: string }, username: string, since: Date, status?: number) {
  if (status) expect(res.statusCode, res.body).toBe(status);
  else {
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(res.statusCode, res.body).toBeLessThan(500);
  }
  expect(res.statusCode, res.body).not.toBe(401);
  expect(await signatures(username, since)).toBe(0);
}

beforeAll(async () => {
  app = await buildApp([
    { prefix: '/api/hierarchy', plugin: hierarchyRoutes },
    { prefix: '/api/filters', plugin: filterOperationsRoutes },
  ]);
  h = await createHierarchy(`D0309F-${SUF}`);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', SA_PW));
  await createRole(MGR_ROLE, [
    'ASSET_READ', 'ASSET_VIEW', 'ASSET_CREATE', 'ASSET_UPDATE', 'FILTER_CREATE', 'FILTER_EDIT', 'FILTER_BULK_UPLOAD',
    'FILTER_REVIEW', 'FILTER_APPROVE', 'FILTER_RETIRE', 'FILTER_REPLACE', 'FILTER_STATUS_UPDATE',
  ]);
  userIds.push(await createUser(MGR, MGR_ROLE, MGR_PW));
  // Policy-driven gates: switched on for THIS file's role only.
  grants = await addReauth([
    ['BULK_UPLOAD_FILTERS', MGR_ROLE], ['CREATE_ASSET', MGR_ROLE], ['CREATE_FILTER', MGR_ROLE], ['EDIT_FILTER', MGR_ROLE],
    ['UPDATE_ASSET', MGR_ROLE], ['REVIEW_FILTER', MGR_ROLE], ['APPROVE_FILTER', MGR_ROLE], ['REJECT_FILTER', MGR_ROLE],
    ['RESUBMIT_FILTER', MGR_ROLE], ['RETIRE_FILTER', MGR_ROLE], ['REPLACE_FILTER', MGR_ROLE],
  ]);
  saToken = await login(app, SA, SA_PW);
  mgrToken = await login(app, MGR, MGR_PW);
});

afterAll(async () => {
  await cleanupAll([
    ['reauth', () => removeReauth(grants)],
    ['filters', () => deleteFilters(filterIds)],
    ['hierarchy', () => deleteHierarchy(h)],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([MGR_ROLE])],
    ['app', () => app?.close()],
  ]);
});

describe('D03-09: filter routes refuse BEFORE the signature', () => {
  it('bulk filter upload with no file is 400 and signs nothing (the multipart is read once, before the gate)', async () => {
    const since = new Date();
    const boundary = `----d0309${SUF}`;
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="ahuId"\r\n\r\n${h!.ahuId}\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST', url: '/api/assets/instances/bulk-upload-filters', payload,
      headers: { authorization: `Bearer ${mgrToken}`, 'x-reauth-password': MGR_PW, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    await refusedUnsigned(res, MGR, since, 400);
  });

  it('review / approve / reject / resubmit of a filter that does not exist sign nothing', async () => {
    for (const [url, body] of [
      ['/api/assets/instances/review', { filterIds: [NONE()], remarks: 'D03-09 review' }],
      ['/api/assets/instances/approve', { filterIds: [NONE()], remarks: 'D03-09 approve' }],
      ['/api/assets/instances/reject', { filterIds: [NONE()], remarks: 'D03-09 reject' }],
      [`/api/assets/instances/${NONE()}/resubmit`, undefined],
    ] as const) {
      const since = new Date();
      const res = await send(mgrToken, MGR_PW, 'POST', url, body as Record<string, unknown> | undefined);
      await refusedUnsigned(res, MGR, since);
    }
  });

  it('PATCH /instances/:id/status on an unknown entity is 404 and signs nothing', async () => {
    const since = new Date();
    const res = await send(mgrToken, MGR_PW, 'PATCH', `/api/assets/instances/${NONE()}/status`, { status: 'Active', remarks: 'x' });
    await refusedUnsigned(res, MGR, since, 404);
  });

  it('PATCH /instances/:id/lifecycle-state (always-on): an unknown filter is 404 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'PATCH', `/api/assets/instances/${NONE()}/lifecycle-state`, { lifecycleState: 'INSTALLED', remarks: 'D03-09' });
    await refusedUnsigned(res, SA, since, 404);
  });

  it('POST /api/hierarchy/filters under an AHU that does not exist is 400 and signs nothing', async () => {
    const since = new Date();
    const res = await send(mgrToken, MGR_PW, 'POST', '/api/hierarchy/filters', { name: `D0309F-NEW-${SUF}`, ahuId: NONE() });
    await refusedUnsigned(res, MGR, since, 400);
  });

  it('PUT /api/hierarchy/filters/:id on an unknown filter is 404 and signs nothing', async () => {
    const since = new Date();
    const res = await send(mgrToken, MGR_PW, 'PUT', `/api/hierarchy/filters/${NONE()}`, { name: 'x' });
    await refusedUnsigned(res, MGR, since, 404);
  });

  it('DELETE /api/hierarchy/filters/:id (always-on) on an unknown filter is 404 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'DELETE', `/api/hierarchy/filters/${NONE()}`);
    await refusedUnsigned(res, SA, since, 404);
  });

  it('retire / replace an unknown filter sign nothing', async () => {
    for (const verb of ['retire', 'replace']) {
      const since = new Date();
      const res = await send(mgrToken, MGR_PW, 'POST', `/api/filters/${NONE()}/${verb}`, { remarks: `D03-09 ${verb}` });
      await refusedUnsigned(res, MGR, since, 404);
    }
  });

  it('a VALID request is still signed: renaming an owned filter writes one REAUTH_SUCCESS', async () => {
    const id = await createFilter(h!.ahuId, `D0309F-OK-${SUF}`);
    filterIds.push(id);
    const since = new Date();
    const res = await send(mgrToken, MGR_PW, 'PUT', `/api/hierarchy/filters/${id}`, { name: `D0309F-OK2-${SUF}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(await prisma.auditTrail.count({ where: { userId: MGR, timestamp: { gte: since }, action: 'REAUTH_SUCCESS' } })).toBe(1);
  });
});
