/**
 * C-07 (2026-10-19) — an RFID tag is stored in its canonical form, and the
 * "already assigned" checks compare canonical values.
 *
 * Before this, every scan LOOKUP normalised (upper-case, stuttered EPC
 * collapsed) but the WRITE stored whatever the assign input sent. A tablet
 * assign that caught a reader stutter stored "ca000bf8ca000bf8"; no later scan
 * ("CA000BF8") could ever match it, and the same physical tag could be bound to
 * a second filter as "CA000BF8" because the exact-match duplicate check missed.
 *
 * Real digilog_test_db through the normal harness. Own SUPER_ADMIN + throwaway
 * FILTER instances, removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import authPlugin from '../plugins/auth.js';
import rbacPlugin from '../plugins/rbac.js';
import authRoutes from '../modules/auth/routes.js';
import assetRoutes from '../modules/assets/index.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { AppError } from '../lib/errors.js';

const TEST_USERNAME = 'rfid_canon_admin';
const TEST_PASSWORD = 'RfidCanon@Test1';
const PREFIX = `ZZRFIDCANON-${Date.now()}`;
// Unique per run so the globally-unique identifier_value never collides.
const EPC = `CA${Date.now().toString(16).toUpperCase()}`;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(assetRoutes, { prefix: '/api/assets' });
  await app.ready();
  return app;
}

describe('RFID identifier — canonical write + canonical duplicate check', () => {
  let app: FastifyInstance;
  let token: string;
  let testUserId: string;
  let filterA: string;
  let filterB: string;
  let filterC: string;
  let filterTemplateId: string;

  const post = (assetId: string, identifierValue: string) => app.inject({
    method: 'POST', url: '/api/assets/identifiers',
    headers: { authorization: `Bearer ${token}`, 'x-reauth-password': TEST_PASSWORD },
    payload: { assetId, identifierType: 'RFID', identifierValue },
  });

  beforeAll(async () => {
    app = await buildTestApp();
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const user = await prisma.user.upsert({
      where: { username: TEST_USERNAME },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: {
        username: TEST_USERNAME, passwordHash, fullName: 'RFID Canonical Test Admin',
        email: 'rfid-canon-test@example.test', role: 'SUPER_ADMIN', status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false,
      },
    });
    testUserId = user.id;

    // Own FILTER template (2026-10-22) instead of borrowing `findFirst` of
    // another suite's — rows hung on a borrowed template block its owner's
    // cleanup. INACTIVE so the typed->asset_instances mirror (which uses the
    // oldest ACTIVE FILTER template) never attaches anyone else's filters to it.
    await prisma.templateKind.upsert({ where: { code: 'FILTER' }, update: {}, create: { code: 'FILTER', label: 'Filter', isSystem: true } });
    const tpl = await prisma.assetTemplate.create({ data: { name: `${PREFIX} Filter Tpl`, templateKind: 'FILTER', isActive: false } });
    filterTemplateId = tpl.id;
    const mk = async (name: string) => (await prisma.assetInstance.create({
      data: { name, templateId: tpl.id, templateVersion: tpl.version, parentId: null, attributes: {}, status: 'Active', isActive: true },
    })).id;
    filterA = await mk(`${PREFIX}-A`);
    filterB = await mk(`${PREFIX}-B`);
    filterC = await mk(`${PREFIX}-C`);

    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: TEST_USERNAME, password: TEST_PASSWORD, force: true } });
    const body = JSON.parse(loginRes.body);
    if (!body.token) throw new Error(`Login failed: ${loginRes.body}`);
    token = body.token;
  });

  afterAll(async () => {
    const ids = [filterA, filterB, filterC].filter(Boolean);
    await prisma.assetIdentifier.deleteMany({ where: { assetId: { in: ids } } });
    await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
    await prisma.assetInstance.deleteMany({ where: { id: { in: ids } } });
    if (filterTemplateId) await prisma.assetTemplate.delete({ where: { id: filterTemplateId } });
    await prisma.session.updateMany({ where: { userId: testUserId }, data: { isActive: false, terminationReason: 'rfid_canon_test_cleanup' } });
    try { await prisma.user.delete({ where: { id: testUserId } }); }
    catch { await prisma.user.update({ where: { id: testUserId }, data: { status: 'DISABLED', email: `disabled-${testUserId}@example.test` } }); }
    await app.close();
  });

  it('a stuttered, lower-case assign is stored canonical (upper-case, single EPC)', async () => {
    const stutter = `  ${EPC.toLowerCase()}${EPC.toLowerCase()}\r\n`;
    const res = await post(filterA, stutter);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.identifierValue).toBe(EPC);
    const row = await prisma.assetIdentifier.findFirst({ where: { assetId: filterA } });
    expect(row?.identifierValue).toBe(EPC);
  });

  it('the same physical tag cannot be bound to a second filter under another casing', async () => {
    const res = await post(filterB, EPC.toLowerCase());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('DUPLICATE_IDENTIFIER_VALUE');
  });

  it('re-assigning the held tag in another casing is "already assigned", not a second tag', async () => {
    const res = await post(filterA, EPC.toLowerCase());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('IDENTIFIER_ALREADY_ON_ENTITY');
  });

  it('a legacy lower-case row (stored before canonical writes) still conflicts and still resolves on lookup', async () => {
    const legacy = `${EPC}LEG`.toLowerCase();
    await prisma.assetIdentifier.create({ data: { assetId: filterC, identifierType: 'RFID', identifierValue: legacy } });

    const dup = await post(filterB, legacy.toUpperCase());
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error).toBe('DUPLICATE_IDENTIFIER_VALUE');

    const look = await app.inject({
      method: 'GET', url: `/api/assets/identifiers/lookup/${encodeURIComponent(legacy.toUpperCase())}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(look.statusCode).toBe(200);
    expect(JSON.parse(look.body).assetId).toBe(filterC);
  });
});
