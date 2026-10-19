/**
 * QA-D004 (2026-10-19) regression: simultaneous block-change requests for the
 * same filter and target block must leave exactly ONE PENDING request.
 *
 * Before the fix `create` ran `findFirst(PENDING)` and `create` as separate
 * statements with no transaction and no unique index, so concurrent submits
 * could all pass the duplicate check.
 *
 * Real database (digilog_test_db via vitest.env.ts); the test owns its template,
 * filter and request rows and removes them afterwards (audit rows are immutable
 * and stay, as in every e2e file).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { blockChangeService } from '../block-change.service.js';
import type { RequestContext } from '../../../types/context.js';

const SUFFIX = `qa-d004-${Date.now()}`;
let templateId = '';
let filterId = '';
const fromBlockId = randomUUID();
const toBlockId = randomUUID();

const ctx = {
  userId: `bcr_race_${SUFFIX}`, userSub: randomUUID(), userRole: 'SUPER_ADMIN',
  ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined,
} as unknown as RequestContext;

describe('Block change request — concurrent submits (QA-D004)', () => {
  beforeAll(async () => {
    await prisma.templateKind.upsert({
      where: { code: 'FILTER' }, update: {},
      create: { code: 'FILTER', label: 'Filter', isSystem: true },
    });
    templateId = (await prisma.assetTemplate.create({ data: { name: `BCR Filter Tpl ${SUFFIX}`, templateKind: 'FILTER' } })).id;
    filterId = (await prisma.assetInstance.create({ data: { name: `BCR-${SUFFIX}`, templateId } })).id;
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({ where: { message: { contains: SUFFIX } } });
      await prisma.blockChangeRequest.deleteMany({ where: { filterId } });
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: filterId } });
      await prisma.assetInstance.delete({ where: { id: filterId } }).catch(() => undefined);
      await prisma.assetTemplate.delete({ where: { id: templateId } }).catch(() => undefined);
    } catch { /* cleanup must never mask a real failure */ }
  }, 30_000);

  it('20 simultaneous submits create one PENDING request; the other 19 get 409 DUPLICATE_REQUEST', async () => {
    const N = 20;
    const body = {
      filterId, filterName: `BCR-${SUFFIX}`,
      fromBlockId, fromBlockName: 'From', toBlockId, toBlockName: 'To', reason: 'race test',
    };
    const settled = await Promise.allSettled(Array.from({ length: N }, () => blockChangeService.create(ctx, body)));

    const ok = settled.filter((s) => s.status === 'fulfilled');
    const refused = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(N - 1);
    for (const r of refused) {
      expect(r.reason?.statusCode).toBe(409);
      expect(r.reason?.code).toBe('DUPLICATE_REQUEST');
    }

    const pending = await prisma.blockChangeRequest.findMany({ where: { filterId, toBlockId, status: 'PENDING' } });
    expect(pending).toHaveLength(1);

    const audits = await prisma.auditTrail.findMany({
      where: { action: 'BLOCK_CHANGE_REQUESTED', userId: ctx.userId }, select: { targetId: true },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].targetId).toBe(pending[0].id);

    // QA-D005: the approver notification used to fail the NotificationType enum
    // check and be swallowed, so approvers were never told. It must now exist.
    const notes = await prisma.notification.findMany({
      where: { type: 'BLOCK_CHANGE_REQUESTED', message: { contains: SUFFIX } },
    });
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });
});
