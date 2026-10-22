/**
 * Filter Data Management: deleting a request deletes the notifications that
 * point at it (2026-10-22).
 *
 * An admin request's "request submitted" notification and a block-change
 * request's REQUESTED / APPROVED / REJECTED notifications carry the request id
 * in `metadata.requestId`. DELETE /api/super-admin/data/{admin,block-change}-requests/:id
 * removed the request and left those notifications behind, each still telling
 * an admin to act on a request that no longer exists. They now go in the same
 * transaction, and the MANUAL_RECORD_DELETED row names them in `_sideEffects`,
 * like the cleaning-cycle delete's cascade.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import { cleanupAll, runSuffix, createUser, login, deleteUsers } from '../../../e2e/support/owned-fixtures.js';
import superAdminRoutes from '../routes.js';
import adminRequestRoutes from '../../admin-requests/routes.js';
import { prisma } from '../../../lib/prisma.js';

const S = runSuffix();
const PW = 'Cvn@Pass1234';
const SA = `cvn_sa_${S}`.toLowerCase();

let app: FastifyInstance;
let saId = '';
let tok = '';
const notificationIds: string[] = [];
const adminRequestIds: string[] = [];
const blockRequestIds: string[] = [];

const linkedTo = (requestId: string) =>
  prisma.notification.findMany({ where: { metadata: { path: ['requestId'], equals: requestId } } });

function consoleDelete(path: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'DELETE',
    url: `/api/super-admin/data/${path}`,
    headers: { authorization: `Bearer ${tok}`, 'x-reauth-password': PW },
    payload: body,
  });
}

/** The MANUAL_RECORD_DELETED row for `targetId`, checked for its chain link. */
async function deletionAudit(targetId: string) {
  const row = await prisma.auditTrail.findFirst({ where: { action: 'MANUAL_RECORD_DELETED', targetId } });
  expect(row).not.toBeNull();
  const prev = await prisma.auditTrail.findFirst({
    where: { chainPosition: { lt: row!.chainPosition } },
    orderBy: { chainPosition: 'desc' },
  });
  expect(row!.previousChecksum).toBe(prev!.checksum);
  return row!;
}

beforeAll(async () => {
  saId = await createUser(SA, 'SUPER_ADMIN', PW);
  app = await buildApp([
    { plugin: superAdminRoutes, prefix: '/api/super-admin' },
    { plugin: adminRequestRoutes, prefix: '/api/admin-requests' },
  ]);
  tok = await login(app, SA, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['notifications', async () => {
      await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
      for (const id of [...adminRequestIds, ...blockRequestIds]) {
        await prisma.notification.deleteMany({ where: { metadata: { path: ['requestId'], equals: id } } });
      }
    }],
    ['admin requests', () => prisma.adminRequest.deleteMany({ where: { id: { in: adminRequestIds } } })],
    ['block change requests', () => prisma.blockChangeRequest.deleteMany({ where: { id: { in: blockRequestIds } } })],
    ['users', () => deleteUsers([saId])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('DELETE /api/super-admin/data/admin-requests/:id', () => {
  it('deletes the request\'s notification in the same transaction and names it in _sideEffects', async () => {
    // The real public submit path writes the request and its notification.
    const submit = await app.inject({
      method: 'POST',
      url: '/api/admin-requests',
      payload: { requestType: 'UNLOCK', requesterName: `cvn ${S}`, requesterEmployeeId: `CVN${S}`, requestData: { username: `cvn_u_${S}` } },
    });
    expect(submit.statusCode).toBe(201);
    const requestId = submit.json().requestId as string;
    adminRequestIds.push(requestId);
    const before = await linkedTo(requestId);
    expect(before).toHaveLength(1);
    expect(before[0].type).toBe('USER_CREATION_REQUEST_SUBMITTED');

    // A notification about a different request must survive.
    const other = await prisma.notification.create({
      data: { type: 'USER_CREATION_REQUEST_SUBMITTED', title: 'cvn other', message: 'cvn other', forRole: 'SUPER_ADMIN', metadata: { requestId: randomUUID() } },
    });
    notificationIds.push(other.id);

    const res = await consoleDelete(`admin-requests/${requestId}`, { _changeReason: 'cvn duplicate request' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    expect(await prisma.adminRequest.findUnique({ where: { id: requestId } })).toBeNull();
    expect(await linkedTo(requestId)).toHaveLength(0);
    expect(await prisma.notification.findUnique({ where: { id: other.id } })).not.toBeNull();

    const audit = await deletionAudit(requestId);
    expect(audit.targetType).toBe('admin_request');
    expect(audit.reason).toBe('cvn duplicate request');
    expect((audit.beforeValue as any).id).toBe(requestId);
    expect((audit.afterValue as any)._sideEffects).toMatchObject({
      deletedNotificationCount: 1,
      deletedNotifications: [{ id: before[0].id, type: 'USER_CREATION_REQUEST_SUBMITTED', title: before[0].title }],
    });
    expect(internalErrors).toEqual([]);
  });

  it('a refused delete (no reason) removes neither the request nor its notification', async () => {
    const req = await prisma.adminRequest.create({ data: { requestType: 'UNLOCK', requesterName: `cvn ${S} b` } });
    adminRequestIds.push(req.id);
    const n = await prisma.notification.create({
      data: { type: 'USER_CREATION_REQUEST_SUBMITTED', title: 'cvn b', message: 'cvn b', forRole: 'SUPER_ADMIN', metadata: { requestId: req.id } },
    });
    notificationIds.push(n.id);

    const res = await consoleDelete(`admin-requests/${req.id}`, { _changeReason: '' });
    expect(res.statusCode).toBe(400);
    expect(await prisma.adminRequest.findUnique({ where: { id: req.id } })).not.toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: n.id } })).not.toBeNull();
    expect(await prisma.auditTrail.count({ where: { action: 'MANUAL_RECORD_DELETED', targetId: req.id } })).toBe(0);
  });

  it('a request with no notification deletes cleanly and records an empty cascade', async () => {
    const req = await prisma.adminRequest.create({ data: { requestType: 'UNLOCK', requesterName: `cvn ${S} c` } });
    adminRequestIds.push(req.id);
    const res = await consoleDelete(`admin-requests/${req.id}`, { _changeReason: 'cvn no notification' });
    expect(res.statusCode).toBe(200);
    const audit = await deletionAudit(req.id);
    expect((audit.afterValue as any)._sideEffects).toEqual({ deletedNotifications: [], deletedNotificationCount: 0 });
  });
});

describe('DELETE /api/super-admin/data/block-change-requests/:id', () => {
  it('deletes the request\'s REQUESTED and APPROVED notifications with it', async () => {
    const bcr = await prisma.blockChangeRequest.create({
      data: {
        filterId: randomUUID(), filterName: `cvn-F-${S}`, fromBlockId: randomUUID(), fromBlockName: 'cvn-B1',
        toBlockId: randomUUID(), toBlockName: 'cvn-B2', requestedBy: saId, requestedByName: SA,
      },
    });
    blockRequestIds.push(bcr.id);
    const made = await Promise.all([
      prisma.notification.create({ data: { type: 'BLOCK_CHANGE_REQUESTED', title: 'cvn req', message: 'cvn req', forRole: 'ADMIN', metadata: { requestId: bcr.id } } }),
      prisma.notification.create({ data: { type: 'BLOCK_CHANGE_APPROVED', title: 'cvn ok', message: 'cvn ok', forUserId: SA, metadata: { requestId: bcr.id } } }),
    ]);

    const res = await consoleDelete(`block-change-requests/${bcr.id}`, { _changeReason: 'cvn wrong block' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.blockChangeRequest.findUnique({ where: { id: bcr.id } })).toBeNull();
    expect(await linkedTo(bcr.id)).toHaveLength(0);

    const audit = await deletionAudit(bcr.id);
    expect(audit.targetType).toBe('block_change_request');
    const side = (audit.afterValue as any)._sideEffects;
    expect(side.deletedNotificationCount).toBe(2);
    expect(side.deletedNotifications.map((n: any) => n.id).sort()).toEqual(made.map((n) => n.id).sort());
    expect(internalErrors).toEqual([]);
  });
});
