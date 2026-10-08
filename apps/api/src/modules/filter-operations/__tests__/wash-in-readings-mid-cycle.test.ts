/**
 * Wash In reached MID-CYCLE needs the equipment readings (2026-10-08).
 *
 * Operator profile: Dry In → Dry Out → Wash In → Wash Out. The tablet and the
 * web page only asked for Wash In readings when a cycle STARTED at Wash In, so
 * the mid-cycle Wash In advance arrived without them and the server refused it
 * (WASH_IN_READINGS_REQUIRED). The clients now ask; this file locks the server
 * rule they mirror:
 *  - the block has a group WITH a Wash In instrument → readings required, and
 *    the same advance succeeds once they are sent (the group is lazily bound);
 *  - the block's only group has NO Wash In instrument → nothing to read, the
 *    advance is allowed. It used to be refused forever (the dialog had no field
 *    to fill, so the cycle could never leave the previous stage).
 *
 * Pipeline: START → S1 → WASH_IN → WASH_OUT → END (S1 stands in for Dry Out,
 * keeping the dryer rules out of this test).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import authPlugin from '../../../plugins/auth.js';
import rbacPlugin from '../../../plugins/rbac.js';
import authRoutes from '../../auth/routes.js';
import filterOperationsRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { AppError } from '../../../lib/errors.js';
import { loginAs } from '../../../e2e/test-helper.js';
import { randomUUID } from 'node:crypto';

const SUFFIX = Date.now().toString(36).slice(-5).toUpperCase();
const USERNAME = `WIRM${SUFFIX}`.slice(0, 16);
const PASSWORD = 'WashIn@Readings#1';
const REASON_KEY = 'ROUTINE';

const instrument = (description: string, stageKey: string, sortOrder: number) => ({
  description, stageKey, serialNumber: `SN-${SUFFIX}-${sortOrder}`, instrumentId: `I-${SUFFIX}-${sortOrder}`,
  uom: 'bar', instrumentMin: 0, instrumentMax: 100, operatingMin: 0, operatingMax: 100, leastCount: 1, sortOrder,
});

describe('Wash In reached mid-cycle — equipment readings rule', () => {
  let app: FastifyInstance;
  let headers: Record<string, string>;
  const templateIds: string[] = [];
  let blockId = '';
  let ahuId = '';
  let filterId = '';
  let profileId = '';
  let filterProfileId = '';
  let washGroupId = '';
  let dryOnlyGroupId = '';
  let washInstrumentId = '';

  const tape = async () =>
    (await app.inject({ method: 'GET', url: `/api/filters/${filterId}/current-state?cleaningAreaId=${blockId}`, headers })).json().tapeVersion as number;

  const advance = async (targetState: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST', url: `/api/filters/${filterId}/advance`, headers,
      payload: { targetState, cleaningAreaId: blockId, tapeVersion: await tape(), _currentPassword: PASSWORD, ...extra },
    });

  /** Fresh cycle parked at S1 — the next step is a MID-CYCLE Wash In. */
  async function parkAtS1() {
    await prisma.filterEvent.deleteMany({ where: { filterId } });
    await prisma.cleaningCycle.deleteMany({ where: { filterId } });
    await prisma.filterDetails.update({ where: { assetInstanceId: filterId }, data: { currentCycleId: null, currentLifecycleState: null } });
    const start = await app.inject({
      method: 'POST', url: `/api/filters/${filterId}/start-cycle`, headers,
      payload: { cleaningReasonKey: REASON_KEY, cleaningAreaId: blockId, _currentPassword: PASSWORD },
    });
    expect(start.statusCode).toBe(201);
    const toS1 = await advance('S1');
    expect(toS1.statusCode).toBe(200);
  }

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: USERNAME, fullName: 'Wash In readings test', email: `${USERNAME.toLowerCase()}@wirm.local`, passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false },
    });
    for (const code of ['BLOCK', 'AHU', 'FILTER'] as const) {
      await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label: code, isSystem: true } });
    }
    const tpl = async (kind: string) => {
      const t = await prisma.assetTemplate.create({ data: { name: `WIRM ${kind} ${SUFFIX}`, templateKind: kind, maxConnections: 50 } });
      templateIds.push(t.id);
      return t.id;
    };
    blockId = (await prisma.assetInstance.create({ data: { name: `WIRM-BLOCK-${SUFFIX}`, templateId: await tpl('BLOCK') } })).id;
    ahuId = (await prisma.assetInstance.create({ data: { name: `WIRM-AHU-${SUFFIX}`, templateId: await tpl('AHU'), parentId: blockId } })).id;
    filterId = (await prisma.assetInstance.create({ data: { name: `WIRM-F-${SUFFIX}`, templateId: await tpl('FILTER'), parentId: ahuId } })).id;

    const profile = await prisma.filterCleaningProfile.create({
      data: {
        name: `WIRM Profile ${SUFFIX}`, lineageId: randomUUID(), status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        cleaningReasons: [{ key: REASON_KEY, name: 'Routine', requiresJustification: false }],
        stages: {
          create: [
            { nodeType: 'START', stateKey: null, sortOrder: 0 },
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'WASH_IN', sortOrder: 2 },
            { nodeType: 'STAGE', stateKey: 'WASH_OUT', sortOrder: 3 },
            { nodeType: 'END', stateKey: null, sortOrder: 4 },
          ],
        },
      },
      include: { stages: true },
    });
    profileId = profile.id;
    const n = (k: string) => profile.stages.find(s => (s.stateKey ?? s.nodeType) === k)!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId, fromStageId: n('START').id, toStageId: n('S1').id },
        { profileId, fromStageId: n('S1').id, toStageId: n('WASH_IN').id },
        { profileId, fromStageId: n('WASH_IN').id, toStageId: n('WASH_OUT').id },
        { profileId, fromStageId: n('WASH_OUT').id, toStageId: n('END').id },
      ],
    });
    filterProfileId = (await prisma.filterProfile.create({ data: { name: `WIRM FP ${SUFFIX}`, cleaningProfileId: profileId } })).id;
    await prisma.filterDetails.create({ data: { assetInstanceId: filterId, filterProfileId, currentCycleId: null, currentLifecycleState: null } });

    const washGroup = await prisma.equipmentGroup.create({
      data: {
        name: `WIRM Wash ${SUFFIX}`, blockId, isActive: true,
        instruments: { create: [instrument('RO Water Pressure', 'WASH_IN', 1), instrument('Dryer Temperature', 'DRY_IN', 2)] },
      },
      include: { instruments: true },
    });
    washGroupId = washGroup.id;
    washInstrumentId = washGroup.instruments.find(i => i.stageKey === 'WASH_IN')!.id;
    dryOnlyGroupId = (await prisma.equipmentGroup.create({
      data: { name: `WIRM DryOnly ${SUFFIX}`, blockId, isActive: false, instruments: { create: [instrument('Dryer Temperature', 'DRY_IN', 3)] } },
    })).id;

    app = Fastify({ logger: false, ajv: { customOptions: { keywords: ['example'] } } });
    await app.register(cors, { origin: true, credentials: true });
    await app.register(authPlugin);
    await app.register(rbacPlugin);
    app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
      if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
      if ((err as any).validation) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: err.message });
      return reply.code(err.statusCode ?? 500).send({ error: err.message || 'Internal Server Error' });
    });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
    await app.ready();
    headers = { authorization: `Bearer ${await loginAs(app, USERNAME, PASSWORD)}` };
  }, 60_000);

  afterAll(async () => {
    try {
      await prisma.filterEvent.deleteMany({ where: { filterId } });
      await prisma.cleaningCycle.deleteMany({ where: { filterId } });
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: filterId } });
      await prisma.equipmentGroup.deleteMany({ where: { id: { in: [washGroupId, dryOnlyGroupId].filter(Boolean) } } });
      for (const id of [filterId, ahuId, blockId].filter(Boolean)) {
        await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: id }, { targetAssetId: id }] } });
        await prisma.assetInstance.delete({ where: { id } }).catch(() => undefined);
      }
      if (filterProfileId) await prisma.filterProfile.delete({ where: { id: filterProfileId } }).catch(() => undefined);
      if (profileId) await prisma.filterCleaningProfile.delete({ where: { id: profileId } }).catch(() => undefined);
      await prisma.assetTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { username: USERNAME } }).catch(() => undefined);
    } catch { /* cleanup must never mask a real failure */ }
    await app.close();
  }, 30_000);

  it('a group WITH a Wash In instrument: refused without readings, accepted with them', async () => {
    await parkAtS1();

    const without = await advance('WASH_IN');
    expect(without.statusCode).toBe(400);
    expect(without.json().error).toBe('WASH_IN_READINGS_REQUIRED');

    const withReadings = await advance('WASH_IN', { instrumentReadings: { [washInstrumentId]: 50 } });
    expect(withReadings.statusCode).toBe(200);
    const cycle = await prisma.cleaningCycle.findFirst({ where: { filterId, status: 'IN_PROGRESS' } });
    expect(cycle?.equipmentGroupId).toBe(washGroupId); // lazily bound at the mid-cycle Wash In
  });

  it('the only group has NO Wash In instrument: nothing to read, the advance is allowed', async () => {
    await prisma.equipmentGroup.update({ where: { id: washGroupId }, data: { isActive: false } });
    await prisma.equipmentGroup.update({ where: { id: dryOnlyGroupId }, data: { isActive: true } });
    try {
      await parkAtS1();
      const res = await advance('WASH_IN');
      expect(res.statusCode).toBe(200);
    } finally {
      await prisma.equipmentGroup.update({ where: { id: dryOnlyGroupId }, data: { isActive: false } });
      await prisma.equipmentGroup.update({ where: { id: washGroupId }, data: { isActive: true } });
    }
  });
});
