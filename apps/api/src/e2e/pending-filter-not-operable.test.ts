/**
 * A filter that has not passed review + approval cannot be RFID-tagged,
 * retired or replaced (2026-10-08, operator).
 *
 * The web Filters page only HID those controls for a pending filter; the tablet
 * RFID-assign and Replace pages, and the API, accepted them. Each route now
 * answers 409 FILTER_NOT_APPROVED and writes nothing. An APPROVED filter is
 * tagged as before (control case, so the gate is not simply "always refuse").
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import authPlugin from '../plugins/auth.js';
import rbacPlugin from '../plugins/rbac.js';
import authRoutes from '../modules/auth/routes.js';
import assetRoutes from '../modules/assets/index.js';
import filterOperationsRoutes from '../modules/filter-operations/routes.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { AppError } from '../lib/errors.js';

const PREFIX = `ZZPENDOP${Date.now()}`;
const USERNAME = 'pending_operable_sa';
const PASSWORD = 'PendOp@Test1';
const n = (s: string) => `${PREFIX}-${s}`;

let app: FastifyInstance;
let token: string;
let userId: string;
const templateIds: string[] = [];
let pendingId: string;
let approvedId: string;

beforeAll(async () => {
  app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(assetRoutes, { prefix: '/api/assets' });
  await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
  await app.ready();

  const user = await prisma.user.upsert({
    where: { username: USERNAME },
    update: { passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
    create: { username: USERNAME, passwordHash: await hashPassword(PASSWORD), fullName: USERNAME, email: `${USERNAME}@example.test`, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false },
  });
  userId = user.id;
  await prisma.session.updateMany({ where: { userId }, data: { isActive: false } });
  token = JSON.parse((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: USERNAME, password: PASSWORD, force: true } })).body).token;

  for (const [code, label] of [['BLOCK', 'Block'], ['AHU', 'AHU'], ['FILTER', 'Filter']] as const) {
    await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
  }
  const tpl = async (kind: string) => {
    const t = await prisma.assetTemplate.create({ data: { name: n(`${kind} Tpl`), templateKind: kind, maxConnections: 50 } });
    templateIds.push(t.id);
    return t.id;
  };
  const blockId = (await prisma.assetInstance.create({ data: { name: n('BLOCK'), templateId: await tpl('BLOCK') } })).id;
  const ahuId = (await prisma.assetInstance.create({ data: { name: n('AHU'), templateId: await tpl('AHU'), parentId: blockId } })).id;
  const filterTpl = await tpl('FILTER');
  const mk = async (name: string, approvalStatus: 'PENDING_REVIEW' | 'APPROVED') => {
    const f = await prisma.assetInstance.create({
      data: { name, templateId: filterTpl, parentId: ahuId, status: 'Active', isActive: true, createdBy: USERNAME, approvalStatus },
    });
    await prisma.filterDetails.create({ data: { assetInstanceId: f.id, filterSet: 'SET_A' } });
    return f.id;
  };
  pendingId = await mk(n('F-00'), 'PENDING_REVIEW');
  approvedId = await mk(n('F-10'), 'APPROVED');
});

afterAll(async () => {
  const ids = (await prisma.assetInstance.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })).map(m => m.id);
  await prisma.assetIdentifier.deleteMany({ where: { assetId: { in: ids } } });
  await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
  await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: ids } }, { targetAssetId: { in: ids } }] } });
  await prisma.filter.deleteMany({ where: { name: { startsWith: PREFIX } } }).catch(() => undefined);
  for (const kind of ['FILTER', 'AHU', 'BLOCK']) {
    await prisma.assetInstance.deleteMany({ where: { name: { startsWith: PREFIX }, template: { templateKind: kind } } }).catch(() => undefined);
  }
  await prisma.assetTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => undefined);
  await prisma.session.updateMany({ where: { userId }, data: { isActive: false } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await app.close();
});

const post = (url: string, payload: Record<string, unknown>) => app.inject({
  method: 'POST', url, payload,
  headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PASSWORD },
});

describe('a filter pending review is not operable', () => {
  it('cannot be RFID-tagged; an approved filter can', async () => {
    const res = await post('/api/assets/identifiers', { assetId: pendingId, identifierType: 'RFID', identifierValue: n('TAG-P') });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('FILTER_NOT_APPROVED');
    expect(await prisma.assetIdentifier.count({ where: { assetId: pendingId } })).toBe(0);

    const ok = await post('/api/assets/identifiers', { assetId: approvedId, identifierType: 'RFID', identifierValue: n('TAG-A') });
    expect(ok.statusCode).toBeLessThan(300);
  });

  it('cannot be retired', async () => {
    const res = await post(`/api/filters/${pendingId}/retire`, { remarks: 'try to retire a pending filter' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('FILTER_NOT_APPROVED');
    expect((await prisma.assetInstance.findUniqueOrThrow({ where: { id: pendingId } })).isActive).toBe(true);
  });

  it('cannot be replaced', async () => {
    const res = await post(`/api/filters/${pendingId}/replace`, { remarks: 'try to replace a pending filter' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('FILTER_NOT_APPROVED');
    expect(await prisma.assetInstance.count({ where: { name: n('F-01') } })).toBe(0);
  });
});
