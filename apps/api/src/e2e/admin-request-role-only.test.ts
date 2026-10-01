/**
 * Contact Admin — Modify User is ROLE-ONLY (2026-10-01, operator request).
 *
 * Locks the server side of the change, because the form is public and its
 * restrictions are only advisory:
 *   - GET /user-lookup discloses the role (needed to show "current role"), but
 *     never a SUPER_ADMIN's.
 *   - POST / with MODIFY_USER refuses any field but `role`, an unknown /
 *     inactive / SUPER_ADMIN / unchanged role, and an unknown target.
 *   - The stored request carries `currentRole` from the users table, not from
 *     the client, so the approver sees the real "from" role.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import authPlugin from '../plugins/auth.js';
import rbacPlugin from '../plugins/rbac.js';
import adminRequestRoutes from '../modules/admin-requests/routes.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { AppError } from '../lib/errors.js';

const TARGET = 'roleonly_target_op';
const SA_TARGET = 'roleonly_target_sa';
const createdRequestIds: string[] = [];

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await app.register(adminRequestRoutes, { prefix: '/api/admin-requests' });
  await app.ready();
  return app;
}

function modify(app: FastifyInstance, requestData: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/admin-requests',
    payload: {
      requestType: 'MODIFY_USER',
      requesterName: 'roleonly-requester',
      requesterEmployeeId: 'roleonly-requester',
      requestData,
      remarks: 'role-only e2e',
    },
  });
}

describe('Contact Admin — Modify User is role-only', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    const passwordHash = await hashPassword('RoleOnly@Test1');
    for (const [username, role] of [[TARGET, 'OPERATOR'], [SA_TARGET, 'SUPER_ADMIN']] as const) {
      await prisma.user.upsert({
        where: { username },
        update: { role, status: 'ENABLED' },
        create: { username, passwordHash, fullName: `Role Only ${role}`, role, status: 'ENABLED' },
      });
    }
  });

  afterAll(async () => {
    if (createdRequestIds.length) await prisma.adminRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.user.deleteMany({ where: { username: { in: [TARGET, SA_TARGET] } } });
    await app.close();
  });

  it('lookup returns the current role', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin-requests/user-lookup?username=${TARGET}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exists).toBe(true);
    expect(body.role).toBe('OPERATOR');
    expect(body.fullName).toBe('Role Only OPERATOR'); // unmasked (2026-10-01)
    expect(typeof body.roleDisplayName).toBe('string');
  });

  it('lookup never discloses a SUPER_ADMIN role', async () => {
    const body = (await app.inject({ method: 'GET', url: `/api/admin-requests/user-lookup?username=${SA_TARGET}` })).json();
    expect(body.exists).toBe(true);
    expect(body.role).toBeNull();
    expect(body.fullName).toBe('R*** O*** S**********'); // SA name stays masked
    expect(body.roleDisplayName).toBeNull();
  });

  it('refuses a field other than role', async () => {
    const res = await modify(app, { username: TARGET, modifyField: 'email', newValue: 'x@example.test' });
    expect(res.statusCode).toBe(400);
  });

  it('refuses an unknown target, an unknown role, SUPER_ADMIN, and an unchanged role', async () => {
    expect((await modify(app, { username: 'no_such_user_xyz', modifyField: 'role', newValue: 'SUPERVISOR' })).statusCode).toBe(400);
    expect((await modify(app, { username: TARGET, modifyField: 'role', newValue: 'NOT_A_ROLE' })).statusCode).toBe(400);
    expect((await modify(app, { username: TARGET, modifyField: 'role', newValue: 'SUPER_ADMIN' })).statusCode).toBe(400);
    expect((await modify(app, { username: SA_TARGET, modifyField: 'role', newValue: 'SUPERVISOR' })).statusCode).toBe(400);
    expect((await modify(app, { username: TARGET, modifyField: 'role', newValue: 'OPERATOR' })).statusCode).toBe(400);
  });

  it('stores currentRole from the database, ignoring a client-supplied one', async () => {
    const res = await modify(app, { username: TARGET, modifyField: 'role', newValue: 'SUPERVISOR', currentRole: 'ADMIN' });
    expect(res.statusCode).toBe(201);
    const id = res.json().requestId as string;
    createdRequestIds.push(id);
    const row = await prisma.adminRequest.findUnique({ where: { id } });
    expect(row?.requestData).toEqual({ username: TARGET, modifyField: 'role', currentRole: 'OPERATOR', newValue: 'SUPERVISOR' });
  });
});
