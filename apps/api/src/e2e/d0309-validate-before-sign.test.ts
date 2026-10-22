/**
 * D03-09 / rule F-42 (2026-10-22): a request that will be REFUSED must be refused
 * before the electronic signature is taken. POST /api/users signed first and
 * validated after, so an invalid User ID cost the operator a password and left a
 * REAUTH_SUCCESS "signature applied for CREATE_USER" row with no USER_CREATED
 * behind it — a signature for nothing.
 *
 * Every case sends the CORRECT password and a body (or target) the route refuses,
 * and asserts: the refusal code, and NO REAUTH_SUCCESS / REAUTH_FAILED row for this
 * file's own user. Policy-driven gates are switched on for this file's own role
 * only (addReauth), so the gate would have verified the password before the fix.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { dateRangeGuard } from '../lib/date-range-guard.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll, type ReauthGrant,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `d0309_sa_${SUF}`.toLowerCase();
const SA_PW = 'D0309Sa@2026x';
const MGR = `d0309_mg_${SUF}`.toLowerCase();
const MGR_PW = 'D0309Mg@2026x';
const MGR_ROLE = `D0309M_${SUF}`;

let app: FastifyInstance;
let saToken = '';
let mgrToken = '';
const userIds: string[] = [];
let grants: ReauthGrant = [];

const send = (token: string, password: string, method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-reauth-password': password }, ...(payload ? { payload } : {}) });
const signatures = (username: string, since: Date) => prisma.auditTrail.count({
  where: { userId: username, timestamp: { gte: since }, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } },
});

beforeAll(async () => {
  app = await buildApp([
    { prefix: '/api/super-admin', plugin: async (a) => { a.addHook('preHandler', dateRangeGuard); await a.register(superAdminRoutes); } },
  ]);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', SA_PW));
  await createRole(MGR_ROLE, ['USER_CREATE', 'USER_READ', 'ROLE_MANAGE', 'CONFIG_UPDATE', 'CONFIG_READ']);
  await prisma.role.update({ where: { name: MGR_ROLE }, data: { hierarchyLevel: 5 } });
  userIds.push(await createUser(MGR, MGR_ROLE, MGR_PW));
  // Policy-driven gates: switched on for THIS file's role only.
  grants = await addReauth([['CREATE_USER', MGR_ROLE], ['UPDATE_CONFIG_PAGE', MGR_ROLE]]);
  saToken = await login(app, SA, SA_PW);
  mgrToken = await login(app, MGR, MGR_PW);
});

afterAll(async () => {
  await cleanupAll([
    ['reauth', () => removeReauth(grants)],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([MGR_ROLE])],
    ['app', () => app?.close()],
  ]);
});

describe('D03-09: a refused request is refused BEFORE the signature', () => {
  it('POST /api/users (CREATE_USER on the policy): an invalid body is 400 and signs nothing', async () => {
    const since = new Date();
    const res = await send(mgrToken, MGR_PW, 'POST', '/api/users', { username: 'ab', fullName: 'X', role: MGR_ROLE, password: 'Aa1!aaaaaaaaaa', confirmPassword: 'Aa1!aaaaaaaaaa' });
    expect(res.statusCode, res.body).toBe(400);
    expect(await signatures(MGR, since)).toBe(0);
  });

  it('POST /api/users: a User ID the CONFIGURED format refuses is 400 and signs nothing (the reported D03-09 case)', async () => {
    const since = new Date();
    // Passes the zod schema (6-50 chars); the site's User ID rules (validateUserId) refuse it.
    const res = await send(mgrToken, MGR_PW, 'POST', '/api/users', { username: 'not-a-valid-user-id-d0309', fullName: 'Bad Id', role: MGR_ROLE, password: 'Aa1!aaaaaaaaaa', confirmPassword: 'Aa1!aaaaaaaaaa' });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().message).toMatch(/User ID/);
    expect(await signatures(MGR, since)).toBe(0);
    expect(await prisma.auditTrail.count({ where: { userId: MGR, timestamp: { gte: since }, action: 'USER_CREATED' } })).toBe(0);
  });

  it('PUT /api/users/:id (UPDATE_USER, always-on): an invalid email is 400 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'PUT', `/api/users/${userIds[1]}`, { email: 'not-an-email' });
    expect(res.statusCode, res.body).toBe(400);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('PUT /api/users/:id: an unknown user is 404 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'PUT', '/api/users/00000000-0000-4000-8000-0000000d0309', { fullName: 'Nobody' });
    expect(res.statusCode, res.body).toBe(404);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('POST /api/users/bulk-delete (always-on): a malformed id list is 400 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'POST', '/api/users/bulk-delete', { userIds: ['not-a-uuid'] });
    expect(res.statusCode, res.body).toBe(400);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('POST /api/roles (always-on): a name that is not UPPER_SNAKE is 400 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'POST', '/api/roles', { name: 'lower case', displayName: 'X', hierarchyLevel: 1 });
    expect(res.statusCode, res.body).toBe(400);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('PUT /api/roles/:name (always-on): an unknown role is 404 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'PUT', `/api/roles/D0309_NONE_${SUF}`, { color: '#000' });
    expect(res.statusCode, res.body).toBe(404);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('DELETE /api/roles/:name (always-on): a system role is 409 and signs nothing', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'DELETE', '/api/roles/SUPER_ADMIN');
    expect(res.statusCode, res.body).toBe(409);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('a Filter Data Management write (SUPER_ADMIN_DATA_EDIT, always-on) without a reason is 400 and signs nothing', async () => {
    const since = new Date();
    // Five spaces pass the body schema's minLength; readChangeReason trims them to nothing.
    const res = await send(saToken, SA_PW, 'PUT', '/api/super-admin/data/notifications/00000000-0000-4000-8000-0000000d0309', { title: 'x', _changeReason: '     ' });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toBe('REASON_REQUIRED');
    expect(await signatures(SA, since)).toBe(0);
  });

  it('PUT /api/config/tablet-access (always-on): an unknown role is 400 and signs nothing; the password field is not a role', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'PUT', '/api/config/tablet-access', { NO_SUCH_ROLE_D0309: ['scan'], _currentPassword: SA_PW });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).not.toContain('_currentPassword');
    expect(await signatures(SA, since)).toBe(0);
  });

  it('PUT /api/config/dashboard-cards (UPDATE_CONFIG_PAGE on the policy): an unknown card is 400 and signs nothing', async () => {
    const since = new Date();
    const res = await send(mgrToken, MGR_PW, 'PUT', '/api/config/dashboard-cards', { configValue: { roles: { [MGR_ROLE]: ['no-such-card'] } } });
    expect(res.statusCode, res.body).toBe(400);
    expect(await signatures(MGR, since)).toBe(0);
  });

  it('a VALID request is still signed (the gate did not move out of the way)', async () => {
    const since = new Date();
    const res = await send(saToken, SA_PW, 'PUT', `/api/users/${userIds[1]}`, { fullName: 'D0309 Renamed' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await prisma.auditTrail.count({ where: { userId: SA, timestamp: { gte: since }, action: 'REAUTH_SUCCESS' } })).toBe(1);
  });
});
