/**
 * Task 8 — TDD test for GET /api/filters/cleaning-profiles/without-final-checklist
 *
 * Seeds three cleaning profiles:
 *   Profile 1: S1 → S2 → END                             (no terminal checklist → NOT enforceable)
 *   Profile 2: S1 → S2 → CHECKLIST → END                 (has terminal checklist → enforceable)
 *   Profile 3: S1 branches to S2→END and S3→CHECKLIST→END (diamond — mixed: one unenforceable path)
 *
 * Asserts the endpoint returns Profile 1 and Profile 3 but NOT Profile 2.
 *
 * Profile 3 exercises the branching-pipeline fix: the profile is unenforceable
 * because ANY final stage that reaches END without a CHECKLIST is sufficient to
 * flag it.  An earlier incorrect implementation would have found S3's CHECKLIST,
 * set hasFinalChecklist=true, and excluded the profile — even though S2 reaches
 * END with no gate.
 *
 * Isolation note: the endpoint is unscoped (returns all ACTIVE profiles) and
 * the test DB accumulates rows from other files. Never assert exact array
 * length — assert membership (toContain / not.toContain) so other files'
 * fixtures don't cause flakes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from '../../../plugins/auth.js';
import rbacPlugin from '../../../plugins/rbac.js';
import authRoutes from '../../auth/routes.js';
import filterOperationsRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { AppError } from '../../../lib/errors.js';
import { loginAs } from '../../../e2e/test-helper.js';
import { randomUUID } from 'node:crypto';

// ── Unique test user (derived from file name + timestamp) ─────────────────────
const SUFFIX = Date.now().toString(36).slice(-4).toUpperCase();
const WFC_USERNAME = `WFCT${SUFFIX}`.slice(0, 16).toUpperCase();
const WFC_PASSWORD = 'WfcTest@Digilog#8';

// ── Minimal Fastify app builder ───────────────────────────────────────────────
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { keywords: ['example'] } },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(authPlugin);
  await app.register(rbacPlugin);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    if ((err as any).code === 'FST_ERR_VALIDATION' || (err as any).validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: err.message,
        ...((err as any).validation ? { details: (err as any).validation } : {}),
      });
    }
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: err.message || 'Internal Server Error' });
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(filterOperationsRoutes, { prefix: '/api/filters' });
  await app.ready();
  return app;
}

describe('GET /api/filters/cleaning-profiles/without-final-checklist', () => {
  let app: FastifyInstance;
  let authHeaders: Record<string, string>;

  // Profile IDs seeded by this test file
  let profile1Id: string; // S1 → S2 → END (unenforceable — should be returned)
  let profile2Id: string; // S1 → S2 → CHECKLIST → END (enforceable — should NOT be returned)
  let profile3Id: string; // diamond: S1 → {S2→END, S3→CHECKLIST→END} (mixed — should be returned)

  beforeAll(async () => {
    // ── Provision unique SUPER_ADMIN ──────────────────────────────────────────
    const passwordHash = await hashPassword(WFC_PASSWORD);
    await prisma.user.upsert({
      where: { username: WFC_USERNAME },
      update: {
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ENABLED',
        forcePasswordChange: false,
        isTemporaryPassword: false,
        failedLoginAttempts: 0,
        lockedAt: null,
        lockoutUntil: null,
      },
      create: {
        username: WFC_USERNAME,
        fullName: 'Without Final Checklist Test',
        email: `${WFC_USERNAME.toLowerCase()}@wfc-test.local`,
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ENABLED',
        forcePasswordChange: false,
        isTemporaryPassword: false,
        createdBy: 'wfc-test',
      },
    });

    // ── Seed Profile 1: S1 → S2 → END (no terminal checklist) ─────────────────
    const cp1 = await prisma.filterCleaningProfile.create({
      data: {
        name: `T8 NoChecklist ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        stages: {
          create: [
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 2 },
            { nodeType: 'END', stateKey: null, sortOrder: 3 },
          ],
        },
      },
      include: { stages: true },
    });
    profile1Id = cp1.id;

    const p1s1 = cp1.stages.find(s => s.stateKey === 'S1')!;
    const p1s2 = cp1.stages.find(s => s.stateKey === 'S2')!;
    const p1end = cp1.stages.find(s => s.nodeType === 'END')!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId: profile1Id, fromStageId: p1s1.id, toStageId: p1s2.id },
        { profileId: profile1Id, fromStageId: p1s2.id, toStageId: p1end.id },
      ],
    });

    // ── Seed Profile 2: S1 → S2 → CHECKLIST → END (enforceable) ──────────────
    const cp2 = await prisma.filterCleaningProfile.create({
      data: {
        name: `T8 WithChecklist ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        stages: {
          create: [
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 2 },
            { nodeType: 'CHECKLIST', stateKey: null, sortOrder: 3 },
            { nodeType: 'END', stateKey: null, sortOrder: 4 },
          ],
        },
      },
      include: { stages: true },
    });
    profile2Id = cp2.id;

    const p2s1 = cp2.stages.find(s => s.stateKey === 'S1')!;
    const p2s2 = cp2.stages.find(s => s.stateKey === 'S2')!;
    const p2cl = cp2.stages.find(s => s.nodeType === 'CHECKLIST')!;
    const p2end = cp2.stages.find(s => s.nodeType === 'END')!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId: profile2Id, fromStageId: p2s1.id, toStageId: p2s2.id },
        { profileId: profile2Id, fromStageId: p2s2.id, toStageId: p2cl.id },
        { profileId: profile2Id, fromStageId: p2cl.id, toStageId: p2end.id },
      ],
    });

    // ── Seed Profile 3: diamond — S1 → {S2→END, S3→CHECKLIST→END} ───────────
    // One branch (S2) reaches END with no CHECKLIST — the profile is unenforceable
    // even though the other branch (S3) does have a CHECKLIST.
    // This fixture locks the fix that prevents breaking early on the first
    // enforceable final stage.
    const cp3 = await prisma.filterCleaningProfile.create({
      data: {
        name: `T8 Diamond ${SUFFIX}`,
        lineageId: randomUUID(),
        status: 'ACTIVE',
        createdBy: '00000000-0000-0000-0000-000000000001',
        stages: {
          create: [
            { nodeType: 'STAGE', stateKey: 'S1', sortOrder: 1 },
            { nodeType: 'STAGE', stateKey: 'S2', sortOrder: 2 },  // final, no checklist
            { nodeType: 'STAGE', stateKey: 'S3', sortOrder: 3 },  // final, has checklist
            { nodeType: 'CHECKLIST', stateKey: null, sortOrder: 4 },
            { nodeType: 'END', stateKey: null, sortOrder: 5 },
          ],
        },
      },
      include: { stages: true },
    });
    profile3Id = cp3.id;

    const p3s1 = cp3.stages.find(s => s.stateKey === 'S1')!;
    const p3s2 = cp3.stages.find(s => s.stateKey === 'S2')!;
    const p3s3 = cp3.stages.find(s => s.stateKey === 'S3')!;
    const p3cl = cp3.stages.find(s => s.nodeType === 'CHECKLIST')!;
    const p3end = cp3.stages.find(s => s.nodeType === 'END')!;
    await prisma.filterPipelineConnection.createMany({
      data: [
        { profileId: profile3Id, fromStageId: p3s1.id, toStageId: p3s2.id },   // S1→S2
        { profileId: profile3Id, fromStageId: p3s1.id, toStageId: p3s3.id },   // S1→S3
        { profileId: profile3Id, fromStageId: p3s2.id, toStageId: p3end.id },  // S2→END (no gate)
        { profileId: profile3Id, fromStageId: p3s3.id, toStageId: p3cl.id },   // S3→CHECKLIST
        { profileId: profile3Id, fromStageId: p3cl.id, toStageId: p3end.id },  // CHECKLIST→END
      ],
    });

    // ── Build app and log in ──────────────────────────────────────────────────
    app = await buildApp();
    const token = await loginAs(app, WFC_USERNAME, WFC_PASSWORD);
    authHeaders = { authorization: `Bearer ${token}` };
  }, 30_000);

  afterAll(async () => {
    // Cascade deletes stages + connections via onDelete:Cascade in schema.
    try {
      if (profile1Id) await prisma.filterCleaningProfile.delete({ where: { id: profile1Id } });
    } catch { /* swallow */ }
    try {
      if (profile2Id) await prisma.filterCleaningProfile.delete({ where: { id: profile2Id } });
    } catch { /* swallow */ }
    try {
      if (profile3Id) await prisma.filterCleaningProfile.delete({ where: { id: profile3Id } });
    } catch { /* swallow */ }
    try { await app.close(); } catch { /* swallow */ }
  }, 10_000);

  it('returns 200 with the no-checklist profile and excludes the with-checklist profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/filters/cleaning-profiles/without-final-checklist',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { profiles: { id: string; name: string }[] };
    expect(Array.isArray(body.profiles)).toBe(true);

    const ids = body.profiles.map((p) => p.id);

    // Profile 1 (S1→S2→END) must appear — no checklist before END, not enforceable
    expect(ids).toContain(profile1Id);

    // Profile 2 (S1→S2→CHECKLIST→END) must NOT appear — enforceable
    expect(ids).not.toContain(profile2Id);

    // Profile 3 (diamond: S1→{S2→END, S3→CHECKLIST→END}) must appear — unenforceable
    // because the S2 branch reaches END with no CHECKLIST.  This assertion catches the
    // regression where the loop broke early on S3's CHECKLIST and excluded the profile.
    expect(ids).toContain(profile3Id);
  });
});
