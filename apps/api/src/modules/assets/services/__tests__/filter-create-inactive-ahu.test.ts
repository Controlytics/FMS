/**
 * BR-070 (QA 2026-10-19): the typed filter create (Filters page dialog via
 * POST /api/hierarchy/filters, and every bulk-upload row) must refuse a
 * deactivated AHU, exactly as the generic path's validateParent has since
 * 2026-09-25. Before the fix it only checked that the AHU row existed.
 *
 * Real database (digilog_test_db); owns its block / AHU / templates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../lib/prisma.js';
import { filterService } from '../filter.service.js';
import type { RequestContext } from '../../../../types/context.js';

const PREFIX = `QA-BR070-${Date.now()}`;
const ctx = {
  userId: `br070_${Date.now()}`, userSub: randomUUID(), userRole: 'SUPER_ADMIN',
  ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined,
} as unknown as RequestContext;
const tplIds: string[] = [];
let blockId = '';
let ahuId = '';

describe('typed filter create refuses a deactivated AHU (BR-070)', () => {
  beforeAll(async () => {
    for (const code of ['BLOCK', 'AHU', 'FILTER']) {
      await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label: code, isSystem: true } });
    }
    const blockTpl = (await prisma.assetTemplate.create({ data: { name: `${PREFIX} Block Tpl`, templateKind: 'BLOCK' } })).id;
    const ahuTpl = (await prisma.assetTemplate.create({ data: { name: `${PREFIX} AHU Tpl`, templateKind: 'AHU' } })).id;
    tplIds.push(blockTpl, ahuTpl);
    blockId = (await prisma.assetInstance.create({ data: { name: `${PREFIX}-BLOCK`, templateId: blockTpl } })).id;
    ahuId = (await prisma.assetInstance.create({ data: { name: `${PREFIX}-AHU`, templateId: ahuTpl, parentId: blockId } })).id;
    await prisma.assetInstance.update({ where: { id: ahuId }, data: { isActive: false } });
    const ahu = await prisma.ahu.findUnique({ where: { id: ahuId }, select: { isActive: true } });
    if (!ahu) throw new Error('asset->typed mirror did not produce the ahus row');
    if (ahu.isActive !== false) throw new Error('mirror did not carry isActive=false to ahus — fixture invalid');
  });

  afterAll(async () => {
    try {
      const mine = await prisma.assetInstance.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
      const ids = mine.map((m) => m.id);
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
      await prisma.assetInstance.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
      await prisma.assetInstance.deleteMany({ where: { id: { in: ids } } });
      await prisma.assetTemplate.deleteMany({ where: { id: { in: tplIds } } });
    } catch { /* cleanup must never mask a failure */ }
  });

  it('refuses with the same message as the generic path and creates nothing', async () => {
    await expect(filterService.create({ name: `${PREFIX}-F1`, ahuId } as any, ctx))
      .rejects.toThrow('Parent entity is deactivated and cannot receive children');
    expect(await prisma.filter.count({ where: { name: `${PREFIX}-F1` } })).toBe(0);
  });
});
