/**
 * Bulk filter upload through the HTTP route (2026-10-08).
 *
 * The service-level file (bulk-upload-filter-scope.e2e.test.ts) passes
 * `canCreateHierarchy` in directly. This one proves the route decides it:
 *  - SUPER_ADMIN, Block scope: a row naming a missing AHU creates it, and the
 *    filter lands in it;
 *  - a role holding only FILTER_BULK_UPLOAD (+ ASSET_READ) cannot create an
 *    AHU through the upload, but CAN fill an existing one;
 *  - no scope / a non-UUID scope is a 400.
 * Uses the inline multipart framing from c2-retire-replace-bulk-upload-reauth.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import ExcelJS from 'exceljs';
import authPlugin from '../plugins/auth.js';
import rbacPlugin, { invalidateRolePermsCache } from '../plugins/rbac.js';
import authRoutes from '../modules/auth/routes.js';
import assetRoutes from '../modules/assets/index.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { AppError } from '../lib/errors.js';

const PREFIX = `ZZBULKRT${Date.now()}`;
const PASSWORD = 'BulkRoute@Test1';
const SA_USER = 'bulk_route_sa';
const LIMITED_USER = 'bulk_route_limited';
const LIMITED_ROLE = 'ZZ_BULK_UPLOAD_ONLY';
const n = (s: string) => `${PREFIX}-${s}`;

let app: FastifyInstance;
const templateIds: string[] = [];
const userIds: string[] = [];
let blockId: string;
let ahuId: string;

async function buildApp(): Promise<FastifyInstance> {
  const a = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await a.register(cors, { origin: true, credentials: true });
  await a.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await a.register(authPlugin);
  await a.register(rbacPlugin);
  a.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await a.register(authRoutes, { prefix: '/api/auth' });
  await a.register(assetRoutes, { prefix: '/api/assets' });
  await a.ready();
  return a;
}

async function xlsx(rows: Array<[name: string, ahu: string]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Filters');
  ws.addRow(['name', 'ahu', 'filterSet']);
  for (const [name, ahu] of rows) ws.addRow([name, ahu, 'A']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipartBody(file: Buffer | null, fields: Record<string, string>) {
  const B = '----bulkroutetest';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="f.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
    parts.push(file, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${B}` };
}

async function login(username: string): Promise<string> {
  await prisma.session.updateMany({ where: { user: { username } }, data: { isActive: false } }).catch(() => undefined);
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: PASSWORD, force: true } });
  const token = JSON.parse(res.body).token;
  if (!token) throw new Error(`login failed for ${username}: ${res.body}`);
  return token;
}

async function upload(token: string, file: Buffer | null, fields: Record<string, string>) {
  const { payload, contentType } = multipartBody(file, fields);
  return app.inject({
    method: 'POST', url: '/api/assets/instances/bulk-upload-filters',
    headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PASSWORD, 'content-type': contentType },
    payload,
  });
}

beforeAll(async () => {
  app = await buildApp();
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.role.upsert({
    where: { name: LIMITED_ROLE },
    update: { permissions: ['FILTER_BULK_UPLOAD', 'ASSET_READ'], isActive: true },
    create: { name: LIMITED_ROLE, displayName: 'Bulk upload only (test)', hierarchyLevel: 1, permissions: ['FILTER_BULK_UPLOAD', 'ASSET_READ'] },
  });
  invalidateRolePermsCache(LIMITED_ROLE);
  for (const [username, role] of [[SA_USER, 'SUPER_ADMIN'], [LIMITED_USER, LIMITED_ROLE]] as const) {
    const u = await prisma.user.upsert({
      where: { username },
      update: { passwordHash, role, status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username, passwordHash, fullName: username, email: `${username}@example.test`, role, status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false },
    });
    userIds.push(u.id);
  }
  for (const [code, label] of [['BLOCK', 'Block'], ['AHU', 'AHU']] as const) {
    await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
  }
  const blockTpl = (await prisma.assetTemplate.create({ data: { name: n('Block Tpl'), templateKind: 'BLOCK', maxConnections: 50 } })).id;
  const ahuTpl = (await prisma.assetTemplate.create({ data: { name: n('AHU Tpl'), templateKind: 'AHU', maxConnections: 50 } })).id;
  templateIds.push(blockTpl, ahuTpl);
  blockId = (await prisma.assetInstance.create({ data: { name: n('BLOCK'), templateId: blockTpl } })).id;
  ahuId = (await prisma.assetInstance.create({ data: { name: n('AHU-1'), templateId: ahuTpl, parentId: blockId } })).id;
});

afterAll(async () => {
  const ids = (await prisma.assetInstance.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })).map(m => m.id);
  await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
  await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: ids } }, { targetAssetId: { in: ids } }] } });
  await prisma.filter.deleteMany({ where: { name: { startsWith: PREFIX } } });
  for (const kind of ['FILTER', 'AHU', 'BLOCK']) {
    await prisma.assetInstance.deleteMany({ where: { name: { startsWith: PREFIX }, template: { templateKind: kind } } }).catch(() => undefined);
  }
  await prisma.assetTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => undefined);
  await prisma.session.updateMany({ where: { userId: { in: userIds } }, data: { isActive: false } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  await prisma.role.delete({ where: { name: LIMITED_ROLE } }).catch(() => undefined);
  await app.close();
});

describe('POST /api/assets/instances/bulk-upload-filters — scope + hierarchy permission', () => {
  it('SUPER_ADMIN from a block: a missing AHU is created and the filter lands in it', async () => {
    const token = await login(SA_USER);
    const res = await upload(token, await xlsx([[n('F-SA'), n('AHU-NEW')]]), { blockId });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ created: 1, failed: 0, newAhus: [n('AHU-NEW')] });
    const ahu = await prisma.ahu.findFirst({ where: { name: n('AHU-NEW') } });
    expect(ahu?.blockId).toBe(blockId);
    expect((await prisma.filter.findFirst({ where: { name: n('F-SA') } }))?.ahuId).toBe(ahu!.id);
  });

  it('a bulk-upload-only role fills an existing AHU but cannot create one', async () => {
    const token = await login(LIMITED_USER);
    const res = await upload(token, await xlsx([
      [n('F-LIM-1'), n('AHU-1')],
      [n('F-LIM-2'), n('AHU-DENIED')],
    ]), { blockId });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.created).toBe(1);
    expect(body.newAhus).toEqual([]);
    expect(body.results.find((r: any) => r.name === n('F-LIM-1'))?.status).toBe('success');
    expect(body.results.find((r: any) => r.name === n('F-LIM-2'))?.error).toContain('permission');
    expect(await prisma.assetInstance.count({ where: { name: n('AHU-DENIED') } })).toBe(0);
    expect((await prisma.filter.findFirst({ where: { name: n('F-LIM-1') } }))?.ahuId).toBe(ahuId);
  });

  it('400s with no scope, or a non-UUID scope', async () => {
    const token = await login(SA_USER);
    const file = await xlsx([[n('F-X'), n('AHU-1')]]);
    const none = await upload(token, file, {});
    expect(none.statusCode).toBe(400);
    expect(JSON.parse(none.body).message).toContain('blockId, areaId or ahuId');
    const bad = await upload(token, file, { blockId: 'not-a-uuid' });
    expect(bad.statusCode).toBe(400);
  });
});
