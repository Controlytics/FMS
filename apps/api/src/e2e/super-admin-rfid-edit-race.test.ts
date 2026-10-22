/**
 * D-DB-2 follow-up (2026-10-22) — the SUPER_ADMIN RFID Track Record edit
 * (PUT /api/super-admin/filter-data/rfid-events/:id) honours "one identifier
 * per filter" under concurrency.
 *
 * When the edited row is the tag's latest event, the route corrects the live
 * asset_identifiers row itself (update / create / delete). It read the target
 * filter's tags and the tag's holder OUTSIDE its transaction and wrote inside
 * it, with none of identifierService's locks — so moving a tag onto a filter
 * while an operator assigned that filter a tag left the filter with two.
 * It now takes the same filter + tag locks (lockIdentifierScope) and decides
 * under them.
 *
 * The race is made deterministic: the test plays an assign that is mid-flight
 * exactly as identifierService.create() runs it — a transaction holding the
 * target filter's lock with its new tag inserted but not yet committed — and
 * fires the SA edit at that moment. Unlocked, the edit read "no tag on the
 * target", moved its tag there and committed; the assign then committed too.
 * Locked, the edit waits for the assign and is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { lockIdentifierScope } from '../modules/assets/services/identifier-locks.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import {
  runSuffix, createUser, login, deleteUsers, cleanupAll,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const PREFIX = `ZZSARACE-${SUF}`;
const SA = `cv_sarace_sa_${SUF}`.toLowerCase();
const SA_PW = 'CovSaRace@2026x';
const TRIALS = 3;
// Long enough for the unlocked route to finish (~1 s per edit measured).
const HOLD_MS = 2500;

let app: FastifyInstance;
let saToken = '';
let saId = '';
let h: Awaited<ReturnType<typeof createHierarchy>>;
const filterIds: string[] = [];
let seq = 0;

const tag = (n: string) => `${PREFIX}-${n}${seq++}`.toUpperCase();
const newFilter = async () => { const id = await createFilter(h.ahuId, `${PREFIX}-F${seq++}`); filterIds.push(id); return id; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An Assigned track-record row exactly as identifierService writes it. */
const assignRow = (value: string, assetId: string, at: Date) => auditLog({
  userId: SA, userName: SA, userRole: 'SUPER_ADMIN',
  action: 'ASSET_IDENTIFIER_CREATED',
  targetType: 'asset_identifier', targetId: randomUUID(), timestamp: at,
  afterValue: { assetId, identifierType: 'RFID', identifierValue: value, filterName: 'fx' },
});

beforeAll(async () => {
  app = await buildApp([{ prefix: '/api/super-admin', plugin: superAdminRoutes }]);
  saId = await createUser(SA, 'SUPER_ADMIN', SA_PW, 'RFID Edit Race SA');
  saToken = await login(app, SA, SA_PW);
  h = await createHierarchy(PREFIX);
}, 120_000);

afterAll(async () => {
  try {
    await cleanupAll([
      ['filters', () => deleteFilters(filterIds)],
      ['hierarchy', () => deleteHierarchy(h, [])],
      ['users', () => deleteUsers([saId])],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('SA RFID Track Record edit vs an assign in flight', () => {
  it('moving a tag onto a filter that an uncommitted assign is tagging: the edit waits and is refused, ONE tag', async () => {
    for (let i = 0; i < TRIALS; i++) {
      const [from, to] = [await newFilter(), await newFilter()];
      const moving = tag('M');
      await prisma.assetIdentifier.create({ data: { assetId: from, identifierType: 'RFID', identifierValue: moving, isPrimary: true } });
      const rowId = await assignRow(moving, from, new Date(Date.UTC(2030, 0, 1, 0, 0, i)));
      const other = tag('O');

      let edit!: Promise<{ statusCode: number; body: string; json: () => any }>;
      await prisma.$transaction(async (tx) => {
        await lockIdentifierScope(tx, { assetIds: [to], tagValues: [other] });
        await tx.assetIdentifier.create({ data: { assetId: to, identifierType: 'RFID', identifierValue: other } });
        edit = app.inject({
          method: 'PUT', url: `/api/super-admin/filter-data/rfid-events/${rowId}`,
          headers: { authorization: `Bearer ${saToken}`, 'x-reauth-password': SA_PW },
          payload: { _changeReason: 'race test: tag was on the wrong filter', filterId: to },
        });
        await Promise.race([edit, sleep(HOLD_MS)]);
      }, { timeout: 30_000, maxWait: 10_000 });
      const res = await edit;

      const detail = `trial ${i}: edit ${res.statusCode} ${res.body}`;
      const tags = await prisma.assetIdentifier.findMany({ where: { assetId: to } });
      expect(tags.map((t) => t.identifierValue), detail).toEqual([other]);
      expect(res.statusCode, detail).toBe(409);
      expect(res.json().error).toBe('ENTITY_HAS_IDENTIFIER');
      // Refused whole: the tag stayed on its filter and the history row is unedited.
      expect((await prisma.assetIdentifier.findUnique({ where: { identifierValue: moving } }))?.assetId).toBe(from);
      expect((await prisma.auditTrail.findUnique({ where: { id: rowId } }))?.afterValue).toMatchObject({ assetId: from });
    }
  }, 180_000);
});
