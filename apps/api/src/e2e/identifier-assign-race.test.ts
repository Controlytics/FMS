/**
 * D-DB-2 (2026-10-22) — "one identifier per entity" holds under concurrency.
 *
 * identifierService.create() used to read the filter's identifiers (and the
 * current holder of the tag) OUTSIDE its transaction and insert later in a
 * separate one, so two assigns arriving together — two tablets, or a double
 * submit — both passed the check: 10 of 10 filters ended with two RFID tags in
 * test-results/05-database-testing.md §2.4. The checks now run inside the
 * transaction behind per-filter and per-tag advisory locks.
 *
 * Every trial here fires two REAL route calls at the same moment
 * (Promise.all of app.inject) and reads the database afterwards. Trials run
 * one after another, two requests at a time, to stay inside the interactive-
 * transaction connection wait other suites share.
 *
 * Real digilog_test_db through the normal harness. Own SUPER_ADMIN + own
 * inactive FILTER template + throwaway filters, removed in afterAll (the audit
 * rows stay: audit_trail is append-only).
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
import { buildErrorHandler } from '../lib/error-handler.js';

const TEST_USERNAME = 'ident_race_admin';
const TEST_PASSWORD = 'IdentRace@Test1';
const RUN = Date.now().toString(16).toUpperCase();
const PREFIX = `ZZIDRACE-${RUN}`;
// Unfixed, the first case failed on trial 1 of 6 and every other case on trial 0.
const TRIALS = 10;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(authPlugin);
  await app.register(rbacPlugin);
  // The production handler, so a Prisma P2002 / P2025 answers exactly as it
  // would live (409 CONFLICT / 404) instead of a test-only 500.
  app.setErrorHandler(buildErrorHandler({ log: app.log, exposeInternalMessage: true }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(assetRoutes, { prefix: '/api/assets' });
  await app.ready();
  return app;
}

describe('D-DB-2: concurrent identifier assigns keep one identifier per filter', () => {
  let app: FastifyInstance;
  let token: string;
  let testUserId: string;
  let templateId: string;
  let templateVersion: number;
  const created: string[] = [];
  let seq = 0;

  const tag = (label: string) => `${RUN}${label}${(seq++).toString(16).toUpperCase()}`;

  const mkFilter = async (opts: { retired?: boolean } = {}) => {
    const row = await prisma.assetInstance.create({
      data: {
        name: `${PREFIX}-F${seq++}`, templateId, templateVersion, parentId: null, attributes: {},
        status: opts.retired ? 'Retired' : 'Active', isActive: true,
      },
    });
    created.push(row.id);
    return row.id;
  };

  const assign = (assetId: string, identifierValue: string, replaceExisting?: boolean) => app.inject({
    method: 'POST', url: '/api/assets/identifiers',
    headers: { authorization: `Bearer ${token}`, 'x-reauth-password': TEST_PASSWORD },
    payload: { assetId, identifierType: 'RFID', identifierValue, ...(replaceExisting ? { replaceExisting: true } : {}) },
  });

  const tagsOn = (assetId: string) => prisma.assetIdentifier.findMany({ where: { assetId } });
  const outcome = (r: { statusCode: number; body: string }) => {
    const b = JSON.parse(r.body);
    return { status: r.statusCode, code: b.error as string | undefined, value: b.data?.identifierValue as string | undefined };
  };

  beforeAll(async () => {
    app = await buildTestApp();
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const user = await prisma.user.upsert({
      where: { username: TEST_USERNAME },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: {
        username: TEST_USERNAME, passwordHash, fullName: 'Identifier Race Test Admin',
        email: 'ident-race-test@example.test', role: 'SUPER_ADMIN', status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false,
      },
    });
    testUserId = user.id;

    // Own INACTIVE FILTER template: the typed->asset_instances mirror uses the
    // oldest ACTIVE one, so nobody else's filters attach to it.
    await prisma.templateKind.upsert({ where: { code: 'FILTER' }, update: {}, create: { code: 'FILTER', label: 'Filter', isSystem: true } });
    const tpl = await prisma.assetTemplate.create({ data: { name: `${PREFIX} Filter Tpl`, templateKind: 'FILTER', isActive: false } });
    templateId = tpl.id;
    templateVersion = tpl.version;

    const loginRes = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: TEST_USERNAME, password: TEST_PASSWORD, force: true } });
    const body = JSON.parse(loginRes.body);
    if (!body.token) throw new Error(`Login failed: ${loginRes.body}`);
    token = body.token;
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.assetIdentifier.deleteMany({ where: { assetId: { in: created } } });
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: created } } });
      await prisma.assetInstance.deleteMany({ where: { id: { in: created } } });
    }
    if (templateId) await prisma.assetTemplate.delete({ where: { id: templateId } });
    await prisma.session.updateMany({ where: { userId: testUserId }, data: { isActive: false, terminationReason: 'ident_race_test_cleanup' } });
    try { await prisma.user.delete({ where: { id: testUserId } }); }
    catch { await prisma.user.update({ where: { id: testUserId }, data: { status: 'DISABLED', email: `disabled-${testUserId}@example.test` } }); }
    await app.close();
  });

  it('two different tags on one filter at once: one 201, one 409 ENTITY_HAS_IDENTIFIER, one tag left', async () => {
    for (let i = 0; i < TRIALS; i++) {
      const f = await mkFilter();
      const [a, b] = [tag('A'), tag('B')];
      const res = (await Promise.all([assign(f, a), assign(f, b)])).map(outcome);
      const won = res.filter((r) => r.status === 201);
      const lost = res.filter((r) => r.status !== 201);
      expect(won, `trial ${i}: ${JSON.stringify(res)}`).toHaveLength(1);
      expect(lost[0]).toMatchObject({ status: 409, code: 'ENTITY_HAS_IDENTIFIER' });
      const rows = await tagsOn(f);
      expect(rows.map((r) => r.identifierValue)).toEqual([won[0].value]);
    }
  }, 120_000);

  it('the same tag on one filter twice (double submit): one 201, one 409 IDENTIFIER_ALREADY_ON_ENTITY', async () => {
    for (let i = 0; i < TRIALS; i++) {
      const f = await mkFilter();
      const t = tag('D');
      const res = (await Promise.all([assign(f, t), assign(f, t)])).map(outcome);
      expect(res.filter((r) => r.status === 201), `trial ${i}: ${JSON.stringify(res)}`).toHaveLength(1);
      expect(res.find((r) => r.status !== 201)).toMatchObject({ status: 409, code: 'IDENTIFIER_ALREADY_ON_ENTITY' });
      expect((await tagsOn(f)).map((r) => r.identifierValue)).toEqual([t]);
    }
  }, 120_000);

  it('two concurrent replaceExisting assigns: both succeed in turn, one tag left, every release audited once', async () => {
    for (let i = 0; i < TRIALS; i++) {
      const f = await mkFilter();
      const old = tag('X');
      await prisma.assetIdentifier.create({ data: { assetId: f, identifierType: 'RFID', identifierValue: old } });
      const [y, z] = [tag('Y'), tag('Z')];
      const res = (await Promise.all([assign(f, y, true), assign(f, z, true)])).map(outcome);
      // Serialised, the second replace releases the first one's tag — no 404
      // for deleting a row the other request already removed.
      expect(res.map((r) => r.status), `trial ${i}: ${JSON.stringify(res)}`).toEqual([201, 201]);
      const rows = await tagsOn(f);
      expect(rows).toHaveLength(1);
      const kept = rows[0].identifierValue;
      expect([y, z]).toContain(kept);
      const dropped = kept === y ? z : y;
      for (const v of [old, dropped]) {
        const dels = await prisma.auditTrail.count({ where: { action: 'ASSET_IDENTIFIER_DELETED', beforeValue: { path: ['identifierValue'], equals: v } } });
        expect(dels, `release of ${v} audited once`).toBe(1);
      }
      const keptDels = await prisma.auditTrail.count({ where: { action: 'ASSET_IDENTIFIER_DELETED', beforeValue: { path: ['identifierValue'], equals: kept } } });
      expect(keptDels).toBe(0);
    }
  }, 120_000);

  it('a removal and a replace of the same tag at once: the replace always lands, the removal is audited once', async () => {
    for (let i = 0; i < TRIALS; i++) {
      const f = await mkFilter();
      const old = tag('Q');
      const held = await prisma.assetIdentifier.create({ data: { assetId: f, identifierType: 'RFID', identifierValue: old } });
      const next = tag('N');
      const [del, rep] = await Promise.all([
        app.inject({
          method: 'DELETE', url: `/api/assets/identifiers/${held.id}`,
          headers: { authorization: `Bearer ${token}`, 'x-reauth-password': TEST_PASSWORD },
          payload: { reason: 'race test' },
        }),
        assign(f, next, true),
      ]);
      // Whichever runs first, the replace binds the new tag. The removal either
      // removed the old tag first, or found it already released (404).
      expect(outcome(rep), `trial ${i}: delete ${del.statusCode} ${del.body}`).toMatchObject({ status: 201, value: next });
      expect([200, 404]).toContain(del.statusCode);
      expect((await tagsOn(f)).map((r) => r.identifierValue)).toEqual([next]);
      const releases = await prisma.auditTrail.count({ where: { action: 'ASSET_IDENTIFIER_DELETED', targetId: held.id } });
      expect(releases, 'the old tag released once').toBe(1);
    }
  }, 120_000);

  it("two live filters claiming a retired filter's tag at once: one 201, one 409 DUPLICATE_IDENTIFIER_VALUE", async () => {
    for (let i = 0; i < TRIALS; i++) {
      const retired = await mkFilter({ retired: true });
      const t = tag('R');
      const held = await prisma.assetIdentifier.create({ data: { assetId: retired, identifierType: 'RFID', identifierValue: t } });
      const [fa, fb] = [await mkFilter(), await mkFilter()];
      const res = (await Promise.all([assign(fa, t), assign(fb, t)])).map(outcome);
      expect(res.filter((r) => r.status === 201), `trial ${i}: ${JSON.stringify(res)}`).toHaveLength(1);
      expect(res.find((r) => r.status !== 201)).toMatchObject({ status: 409, code: 'DUPLICATE_IDENTIFIER_VALUE' });
      const holders = await prisma.assetIdentifier.findMany({ where: { identifierValue: t } });
      expect(holders).toHaveLength(1);
      expect([fa, fb]).toContain(holders[0].assetId);
      expect(await tagsOn(retired)).toHaveLength(0);
      const releases = await prisma.auditTrail.count({ where: { action: 'ASSET_IDENTIFIER_DELETED', targetId: held.id } });
      expect(releases, 'the retired holder released once').toBe(1);
    }
  }, 120_000);
});
