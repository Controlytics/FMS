/**
 * QA Phase 5, P5-01 (2026-10-21) + P4-09.
 *
 * A filter's `status` belongs to its lifecycle: retire() / replace() write
 * Retired / Replaced together with isActive=false, unretire() writes Active
 * back. The generic edit (PUT /api/assets/instances/:id) and
 * PATCH /api/assets/instances/:id/status used to copy a free-text status
 * verbatim, so `{status:"Active"}` on a retired filter dropped it from the
 * Retirement List (status='Retired' AND isActive=false) while it stayed
 * deactivated. Both now refuse; editing a retired filter is refused until it is
 * restored. P4-09: an unknown filter on PUT /api/hierarchy/filters/:id is 404.
 *
 * Real Fastify + auth + Prisma on digilog_test_db; own SUPER_ADMIN and own
 * BLOCK -> AHU -> FILTER fixture, removed in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import hierarchyRoutes from '../modules/hierarchy/routes.js';

const USERNAME = `qa_p501_${Date.now()}`;
const PASSWORD = 'QaP501@Test2026';
const PREFIX = `ZZP501-${Date.now()}`;

let app: FastifyInstance;
let token: string;
let userId: string;
let blockTemplateId: string, ahuTemplateId: string, blockId: string, ahuId: string;
let retiredId: string, activeId: string;

const headers = () => ({ authorization: `Bearer ${token}`, 'x-reauth-password': PASSWORD });
const statusOf = async (id: string) =>
  prisma.assetInstance.findUnique({ where: { id }, select: { status: true, isActive: true, name: true } });

describe('filter status is lifecycle-owned (P5-01)', () => {
  beforeAll(async () => {
    app = await buildApp([{ prefix: '/api/hierarchy', plugin: hierarchyRoutes }]);
    userId = (await prisma.user.create({
      data: {
        username: USERNAME, fullName: 'QA P5-01', passwordHash: await hashPassword(PASSWORD),
        role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-p501-test',
      },
    })).id;
    for (const [code, label] of [['BLOCK', 'Block'], ['AHU', 'AHU']] as const) {
      await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
    }
    blockTemplateId = (await prisma.assetTemplate.create({ data: { name: `${PREFIX} Block Tpl`, templateKind: 'BLOCK' } })).id;
    ahuTemplateId = (await prisma.assetTemplate.create({ data: { name: `${PREFIX} AHU Tpl`, templateKind: 'AHU' } })).id;
    blockId = (await prisma.assetInstance.create({ data: { name: `${PREFIX}-BLOCK`, templateId: blockTemplateId } })).id;
    ahuId = (await prisma.assetInstance.create({ data: { name: `${PREFIX}-AHU`, templateId: ahuTemplateId, parentId: blockId } })).id;
    activeId = (await prisma.filter.create({ data: { id: randomUUID(), ahuId, name: `${PREFIX}-ACTIVE`, status: 'Active', attributes: {} } as any })).id;
    retiredId = (await prisma.filter.create({ data: { id: randomUUID(), ahuId, name: `${PREFIX}-RETIRED`, status: 'Active', attributes: {} } as any })).id;
    // what retire() leaves behind: Retired + deactivated (typed row; the reverse mirror copies it)
    await prisma.filter.update({ where: { id: retiredId }, data: { status: 'Retired', isActive: false } as any });
    expect(await statusOf(retiredId)).toMatchObject({ status: 'Retired', isActive: false });

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: USERNAME, password: PASSWORD, force: true } });
    token = login.json().token;
    if (!token) throw new Error(`login failed: ${login.body}`);
  });

  afterAll(async () => {
    const ids = [activeId, retiredId].filter(Boolean);
    await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
    await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: [...ids, ahuId, blockId] } }, { targetAssetId: { in: [...ids, ahuId, blockId] } }] } });
    await prisma.filter.deleteMany({ where: { id: { in: ids } } });
    await prisma.assetInstance.deleteMany({ where: { id: { in: ids } } });
    if (ahuId) await prisma.assetInstance.delete({ where: { id: ahuId } }).catch(() => undefined);
    if (blockId) await prisma.assetInstance.delete({ where: { id: blockId } }).catch(() => undefined);
    if (ahuTemplateId) await prisma.assetTemplate.delete({ where: { id: ahuTemplateId } }).catch(() => undefined);
    if (blockTemplateId) await prisma.assetTemplate.delete({ where: { id: blockTemplateId } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.passwordHistory.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await app?.close();
  });

  it('generic edit cannot set a retired filter back to Active', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/assets/instances/${retiredId}`, headers: headers(), payload: { status: 'Active' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('FILTER_STATUS_LIFECYCLE_OWNED');
    expect(await statusOf(retiredId)).toMatchObject({ status: 'Retired', isActive: false });
  });

  it('PATCH /status cannot change a filter status either', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/assets/instances/${retiredId}/status`, headers: headers(), payload: { status: 'Active', remarks: 'qa p5-01' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('FILTER_STATUS_LIFECYCLE_OWNED');
    expect(await statusOf(retiredId)).toMatchObject({ status: 'Retired' });
  });

  it('an active filter cannot be marked Retired by an edit (retire() owns that)', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/assets/instances/${activeId}`, headers: headers(), payload: { status: 'Retired' } });
    expect(res.statusCode).toBe(409);
    expect(await statusOf(activeId)).toMatchObject({ status: 'Active', isActive: true });
  });

  it('a retired filter cannot be edited on either edit path', async () => {
    const generic = await app.inject({ method: 'PUT', url: `/api/assets/instances/${retiredId}`, headers: headers(), payload: { name: `${PREFIX}-RENAMED` } });
    expect(generic.statusCode).toBe(409);
    expect(generic.json().error).toBe('FILTER_INACTIVE');
    const typed = await app.inject({ method: 'PUT', url: `/api/hierarchy/filters/${retiredId}`, headers: headers(), payload: { name: `${PREFIX}-RENAMED` } });
    expect(typed.statusCode).toBe(409);
    expect(typed.json().error).toBe('FILTER_INACTIVE');
    expect((await statusOf(retiredId))?.name).toBe(`${PREFIX}-RETIRED`);
  });

  it('unchanged behaviour: an active filter still renames, and sending its own status is a no-op', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/assets/instances/${activeId}`, headers: headers(), payload: { name: `${PREFIX}-ACTIVE2`, status: 'Active' } });
    expect(res.statusCode).toBe(200);
    expect(await statusOf(activeId)).toMatchObject({ name: `${PREFIX}-ACTIVE2`, status: 'Active', isActive: true });
  });

  it('P4-09: an unknown filter on PUT /api/hierarchy/filters/:id is 404, not 400', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/hierarchy/filters/${randomUUID()}`, headers: headers(), payload: { name: 'nope' } });
    expect(res.statusCode).toBe(404);
  });
});
