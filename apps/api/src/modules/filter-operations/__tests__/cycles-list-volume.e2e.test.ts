/**
 * D-DB-9 (database test 2026-10-22, test-results/05 §4 P-4): GET /api/filters/cycles
 * with a page of more than ~32k cycles failed. The performer lookup passed every
 * cycle id of the page in ONE `IN (...)` plus three event-type parameters, and
 * Postgres caps a statement at 32,767 bind variables ("too many bind variables in
 * prepared statement, expected maximum of 32767, received 32770"). The error
 * handler then answered that server fault as 400 DATA_CONSTRAINT, so the tablet's
 * Cycles view (limit=1000000) showed a client error.
 *
 * Volume: this file owns one filter and inserts PAGE cycles for it (createMany,
 * in chunks), lists them through the real route, and deletes them in afterAll
 * (FoFixture.cleanup deletes every cycle of its filters).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterEventsRoutes from '../events-routes.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FCV');
let app: FastifyInstance;
let saH: Record<string, string>;
let FILTER = '';
let PERFORMER = '';
/** More cycle ids than one statement can bind (32,767), with room for the other parameters. */
const PAGE = 32_800;

beforeAll(async () => {
  app = await buildApp([{ plugin: filterEventsRoutes, prefix: '/api/filters' }]);
  const sa = await fx.user('sa', 'SUPER_ADMIN');
  PERFORMER = sa.id;
  saH = await fx.login(app, sa.username);
  const block = await fx.node('BLOCK', 'B');
  const ahu = await fx.node('AHU', 'A', block);
  const { filterProfileId, cleaningProfileId } = await fx.pipeline({ name: 'VOL', stages: ['WASH_IN', 'WASH_OUT'] }, sa.id);
  FILTER = await fx.filter('F', ahu, filterProfileId);

  const t0 = Date.now() - PAGE * 60_000;
  const rows = Array.from({ length: PAGE }, (_, i) => ({
    cycleCode: `CC-${fx.tag}-V-${i}`,
    filterId: FILTER,
    profileId: cleaningProfileId,
    profileVersion: 1,
    sequenceNumber: i + 1,
    status: 'COMPLETED' as const,
    startedAt: new Date(t0 + i * 60_000),
    completedAt: new Date(t0 + i * 60_000 + 30_000),
    cleaningReasonKey: 'ROUTINE',
    cleaningReasonLabel: 'Routine',
  }));
  for (let i = 0; i < rows.length; i += 5_000) {
    await prisma.cleaningCycle.createMany({ data: rows.slice(i, i + 5_000) });
  }
  // The performer of the newest and of the oldest cycle (the two ends of the page).
  const ends = await prisma.cleaningCycle.findMany({
    where: { filterId: FILTER }, orderBy: { startedAt: 'asc' }, select: { id: true }, take: 1,
  });
  const newest = await prisma.cleaningCycle.findFirst({ where: { filterId: FILTER }, orderBy: { startedAt: 'desc' }, select: { id: true } });
  for (const c of [ends[0], newest!]) {
    await prisma.filterEvent.create({
      data: { filterId: FILTER, cycleId: c.id, eventType: 'CYCLE_COMPLETED', performedBy: PERFORMER, checksum: 'x', ipAddress: '127.0.0.1', attributes: {} },
    });
  }
}, 300_000);

afterAll(async () => {
  try { await fx.cleanup(); } finally { await app?.close(); }
}, 300_000);

describe('GET /api/filters/cycles with a page larger than one statement can bind', () => {
  it(`lists all ${PAGE} cycles of the page, each with its performer resolved`, async () => {
    internalErrors.length = 0;
    const res = await app.inject({ method: 'GET', url: `/api/filters/cycles?filterId=${FILTER}&limit=1000000`, headers: saH });
    expect([res.statusCode, res.statusCode === 200 ? undefined : res.json().error]).toEqual([200, undefined]);
    const body = res.json();
    expect(body.total).toBe(PAGE);
    expect(body.data).toHaveLength(PAGE);
    // Both ends of the page resolved their performer: the lookup covered every chunk.
    const withPerformer = body.data.filter((c: any) => c.completedBy === PERFORMER);
    expect(withPerformer).toHaveLength(2);
    expect(internalErrors).toEqual([]);
  }, 300_000);
});
