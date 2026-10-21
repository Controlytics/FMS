/**
 * e2e — /api/block-change-requests (routes.ts + block-change.service.ts).
 *
 * Submit (re-auth, strict body, duplicate guard, approver notification), list
 * (status / mine / paging, requester-or-approver access), pending count, and
 * the decision path: re-auth, the configured approval role (SUPER_ADMIN always
 * allowed, a blank role = permission gate alone), self-decision refusal,
 * single-decision under concurrency, the audit row and the requester's
 * notification.
 *
 * Owns its roles (requester / approver / no-access) and users, a BLOCK -> AHU ->
 * FILTER fixture, and every request + notification it creates. The shared
 * `block-change-approval` config is only ever touched in its `approvalRole`
 * key (re-read and restored around the one test that needs it); `mode`, which
 * start-cycle reads, is never written.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import blockChangeRoutes from '../modules/block-change-requests/routes.js';
import { blockChangeService } from '../modules/block-change-requests/block-change.service.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll, type ReauthGrant,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const PREFIX = `ZZBCR-${SUF}`;
const PW = 'CovBcr@2026x';
const SA = `cv_bcr_sa_${SUF}`.toLowerCase();
const REQ = `cv_bcr_req_${SUF}`.toLowerCase();
const APR = `cv_bcr_apr_${SUF}`.toLowerCase();
const NOBODY = `cv_bcr_no_${SUF}`.toLowerCase();
const ROLE_REQ = `CVBC_Q_${SUF}`;
const ROLE_APR = `CVBC_A_${SUF}`;
const ROLE_NO = `CVBC_N_${SUF}`;

let app: FastifyInstance;
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
let h: Awaited<ReturnType<typeof createHierarchy>>;
let filterId = '';
let reauthAdded: ReauthGrant = [];

const base = '/api/block-change-requests';
const req = (method: 'GET' | 'POST', url: string, who: string, payload?: unknown, withPw = true) =>
  app.inject({
    method, url,
    headers: { authorization: `Bearer ${tok[who]}`, ...(withPw ? { 'x-reauth-password': PW } : {}) },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
const body = (toBlockId = randomUUID(), extra: Record<string, unknown> = {}) => ({
  filterId, filterName: `${PREFIX}-F`, fromBlockId: h.blockId, fromBlockName: `${PREFIX}-B1`, toBlockId, toBlockName: `${PREFIX}-B2`, ...extra,
});
const submit = async (who = REQ, extra: Record<string, unknown> = {}) => {
  const res = await req('POST', base, who, body(randomUUID(), extra));
  expect(res.statusCode).toBe(201);
  return res.json();
};
const readApprovalRole = async () =>
  ((await prisma.systemConfig.findUnique({ where: { configKey: 'block-change-approval' } }))?.configValue as any)?.approvalRole as string | undefined;
const setApprovalRole = async (role: string | undefined) => {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'block-change-approval' } });
  const value = { ...((row?.configValue as Record<string, unknown>) ?? {}) };
  if (role === undefined) delete value.approvalRole; else value.approvalRole = role;
  await prisma.systemConfig.update({ where: { configKey: 'block-change-approval' }, data: { configValue: value as any } });
};

beforeAll(async () => {
  app = await buildApp([{ prefix: base, plugin: blockChangeRoutes }]);
  await createRole(ROLE_REQ, ['BLOCK_CHANGE_REQUEST']);
  await createRole(ROLE_APR, ['BLOCK_CHANGE_APPROVE']);
  await createRole(ROLE_NO, ['AUDIT_READ']);
  for (const [u, r] of [[SA, 'SUPER_ADMIN'], [REQ, ROLE_REQ], [APR, ROLE_APR], [NOBODY, ROLE_NO]] as const) {
    uid[u] = await createUser(u, r, PW, `BCR ${u}`);
    tok[u] = await login(app, u, PW);
  }
  h = await createHierarchy(PREFIX);
  filterId = await createFilter(h.ahuId, `${PREFIX}-F`);
  reauthAdded = await addReauth([['REQUEST_BLOCK_CHANGE', ROLE_REQ], ['APPROVE_BLOCK_CHANGE', ROLE_APR], ['REJECT_BLOCK_CHANGE', ROLE_APR]]);
  // The fixture assumes the row exists (seeded on every install).
  expect(await prisma.systemConfig.findUnique({ where: { configKey: 'block-change-approval' } })).not.toBeNull();
}, 120_000);

afterAll(async () => {
  try {
    await cleanupAll([
      ['re-auth keys', () => removeReauth(reauthAdded)],
      ['notifications', () => prisma.notification.deleteMany({ where: { OR: [{ message: { contains: PREFIX } }, { forUserId: { in: [SA, REQ, APR, NOBODY] } }] } })],
      filterId ? ['requests', () => prisma.blockChangeRequest.deleteMany({ where: { filterId } })] : null,
      ['filter', () => deleteFilters([filterId])],
      ['hierarchy', () => deleteHierarchy(h)],
      ['users', () => deleteUsers(Object.values(uid))],
      ['roles', () => deleteRoles([ROLE_REQ, ROLE_APR, ROLE_NO])],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('POST / (submit)', () => {
  it('is gated by permission, the re-auth policy and a strict body', async () => {
    expect((await req('POST', base, APR, body())).statusCode).toBe(403);
    const noPw = await req('POST', base, REQ, body(), false);
    expect(noPw.statusCode).toBe(401);
    expect(noPw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'REQUEST_BLOCK_CHANGE' });
    expect((await req('POST', base, REQ, { ...body(), filterName: undefined })).statusCode).toBe(400);
    expect(await prisma.blockChangeRequest.count({ where: { filterId } })).toBe(0);
  });

  it('a forged status / manualEntry can never self-approve a request', async () => {
    // The invariant that matters: no caller-supplied column reaches the row.
    // (Fastify's default AJV `removeAdditional` strips the unknown keys - see the
    // report: the route comment expects a 400 here, which does not happen.)
    const toBlockId = randomUUID();
    const forged = await req('POST', base, REQ, body(toBlockId, { status: 'APPROVED', manualEntry: true, processedBy: uid[SA] }));
    expect(forged.statusCode).toBe(201);
    const row = await prisma.blockChangeRequest.findFirst({ where: { filterId, toBlockId } });
    expect(row).toMatchObject({ status: 'PENDING', manualEntry: false, processedBy: null, requestedBy: uid[REQ] });
    expect(await blockChangeService.hasApproval(filterId, toBlockId)).toBe(false);
  });

  it('creates a PENDING request stamped with the requester, audits it, and notifies the approvers', async () => {
    const toBlockId = randomUUID();
    const res = await req('POST', base, REQ, body(toBlockId, { reason: `${PREFIX} wrong block on the trolley` }));
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r).toMatchObject({ status: 'PENDING', requestedBy: uid[REQ], requestedByName: REQ, toBlockId, manualEntry: false, processedBy: null });

    const audit = await prisma.auditTrail.findFirst({ where: { action: 'BLOCK_CHANGE_REQUESTED', targetId: r.id } });
    expect(audit).toMatchObject({ userId: REQ, userRole: ROLE_REQ, targetType: 'block_change_request' });
    expect(audit?.afterValue).toEqual({ filterId, fromBlock: `${PREFIX}-B1`, toBlock: `${PREFIX}-B2` });

    const role = (await readApprovalRole())?.trim() || 'ADMIN';
    const notes = await prisma.notification.findMany({ where: { type: 'BLOCK_CHANGE_REQUESTED', metadata: { path: ['requestId'], equals: r.id } } });
    expect(notes.map((n) => n.forRole).sort()).toEqual(role === 'SUPER_ADMIN' ? ['SUPER_ADMIN'] : [role, 'SUPER_ADMIN'].sort());
    expect(notes[0].message).toBe(`${REQ} requested approval to clean ${PREFIX}-F (from ${PREFIX}-B1) in ${PREFIX}-B2. Reason: ${PREFIX} wrong block on the trolley`);

    const dupe = await req('POST', base, REQ, body(toBlockId));
    expect(dupe.statusCode).toBe(409);
    expect(dupe.json().error).toBe('DUPLICATE_REQUEST');
    expect(await prisma.blockChangeRequest.count({ where: { filterId, toBlockId } })).toBe(1);
  });

  it('a request without a reason notifies without one', async () => {
    const r = await submit();
    const note = await prisma.notification.findFirst({ where: { metadata: { path: ['requestId'], equals: r.id } } });
    expect(note?.message).toBe(`${REQ} requested approval to clean ${PREFIX}-F (from ${PREFIX}-B1) in ${PREFIX}-B2.`);
  });
});

describe('GET / , /pending-count', () => {
  it('requesters and approvers may list; others may not', async () => {
    expect((await req('GET', base, NOBODY)).statusCode).toBe(403);
    expect((await req('GET', base, APR)).statusCode).toBe(200);
    const mine = (await req('GET', `${base}?mine=true&status=PENDING`, REQ)).json();
    expect(mine.data.length).toBeGreaterThanOrEqual(2);
    expect(mine.data.every((r: any) => r.requestedBy === uid[REQ] && r.status === 'PENDING')).toBe(true);
    expect(mine.total).toBe(await prisma.blockChangeRequest.count({ where: { requestedBy: uid[REQ], status: 'PENDING' } }));
  });

  it('pages, honours ALL, and orders newest first', async () => {
    const all = (await req('GET', `${base}?mine=true&status=ALL&limit=100`, REQ)).json();
    const created = all.data.map((r: any) => new Date(r.createdAt).getTime());
    expect([...created].sort((a, b) => b - a)).toEqual(created);
    const p2 = (await req('GET', `${base}?mine=true&page=2&limit=1`, REQ)).json();
    expect(p2).toMatchObject({ page: 2, limit: 1, total: all.total, totalPages: all.total });
    expect(p2.data[0].id).toBe(all.data[1].id);
    const def = (await req('GET', `${base}?mine=false`, SA)).json();
    expect(def).toMatchObject({ page: 1, limit: 20 });
    expect((await req('GET', `${base}?status=BOGUS`, SA)).statusCode).toBe(400);
  });

  it('pending count needs BLOCK_CHANGE_APPROVE and counts PENDING rows', async () => {
    expect((await req('GET', `${base}/pending-count`, REQ)).statusCode).toBe(403);
    const before = await prisma.blockChangeRequest.count({ where: { status: 'PENDING' } });
    const res = (await req('GET', `${base}/pending-count`, APR)).json();
    expect(res.count).toBeGreaterThanOrEqual(Math.min(before, 2));
    expect(res.count).toBeGreaterThanOrEqual(2); // at least this file's two pending requests
  });
});

describe('POST /:id/approve | /:id/reject', () => {
  it('an approver outside the configured role passes re-auth and is then refused (FORBIDDEN_ROLE)', async () => {
    const r = await submit();
    const configured = (await readApprovalRole())?.trim();
    const noPw = await req('POST', `${base}/${r.id}/approve`, APR, {}, false);
    expect(noPw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'APPROVE_BLOCK_CHANGE' });
    const noPwReject = await req('POST', `${base}/${r.id}/reject`, APR, {}, false);
    expect(noPwReject.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'REJECT_BLOCK_CHANGE' });
    if (configured) {
      const res = await req('POST', `${base}/${r.id}/approve`, APR, { comment: 'ok' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'FORBIDDEN_ROLE', message: `Only users with role "${configured}" can approve block change requests` });
      expect((await req('POST', `${base}/${r.id}/reject`, APR, { comment: 'no' })).json().error).toBe('FORBIDDEN_ROLE');
    }
    expect((await prisma.blockChangeRequest.findUnique({ where: { id: r.id } }))?.status).toBe('PENDING');
    expect((await req('POST', `${base}/${r.id}/approve`, REQ, {})).statusCode).toBe(403); // no APPROVE permission
  });

  it('SUPER_ADMIN approves: row decided, audited, requester notified with the note; a second decision is 409', async () => {
    const r = await submit();
    const res = await req('POST', `${base}/${r.id}/approve`, SA, { comment: 'checked trolley' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: r.id, status: 'APPROVED', processedBy: uid[SA], processedByName: SA, processedComment: 'checked trolley' });
    expect(res.json().processedAt).toBeTruthy();
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'BLOCK_CHANGE_APPROVED', targetId: r.id } });
    expect(audit).toMatchObject({ userId: SA, userRole: 'SUPER_ADMIN' });
    expect(audit?.beforeValue).toEqual({ status: 'PENDING' });
    expect(audit?.afterValue).toEqual({ status: 'APPROVED', comment: 'checked trolley' });
    const note = await prisma.notification.findFirst({ where: { type: 'BLOCK_CHANGE_APPROVED', forUserId: REQ, metadata: { path: ['requestId'], equals: r.id } } });
    expect(note?.message).toBe(`Your request to clean ${PREFIX}-F in ${PREFIX}-B2 was approved by ${SA}. Note: checked trolley`);

    expect(await blockChangeService.hasApproval(filterId, r.toBlockId)).toBe(true);

    // Approved without a note: the requester's message carries none.
    const plain = await submit();
    expect((await req('POST', `${base}/${plain.id}/approve`, SA, {})).json()).toMatchObject({ status: 'APPROVED', processedComment: null });
    const plainNote = await prisma.notification.findFirst({ where: { type: 'BLOCK_CHANGE_APPROVED', metadata: { path: ['requestId'], equals: plain.id } } });
    expect(plainNote?.message).toBe(`Your request to clean ${PREFIX}-F in ${PREFIX}-B2 was approved by ${SA}.`);

    const again = await req('POST', `${base}/${r.id}/reject`, SA, {});
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'ALREADY_PROCESSED', message: 'Request already approved' });
  });

  it('SUPER_ADMIN rejects, with and without a comment', async () => {
    const r = await submit();
    const res = await req('POST', `${base}/${r.id}/reject`, SA, { comment: 'wrong area' });
    expect(res.json()).toMatchObject({ status: 'REJECTED', processedComment: 'wrong area' });
    expect(await prisma.auditTrail.count({ where: { action: 'BLOCK_CHANGE_REJECTED', targetId: r.id } })).toBe(1);
    const note = await prisma.notification.findFirst({ where: { type: 'BLOCK_CHANGE_REJECTED', metadata: { path: ['requestId'], equals: r.id } } });
    expect(note?.message).toBe(`Your request to clean ${PREFIX}-F in ${PREFIX}-B2 was rejected by ${SA}. Reason: wrong area`);
    expect(await blockChangeService.hasApproval(filterId, r.toBlockId)).toBe(false);

    const r2 = await submit();
    // No body at all is refused by the body schema; the UI always sends an object.
    const noBody = await app.inject({ method: 'POST', url: `${base}/${r2.id}/reject`, headers: { authorization: `Bearer ${tok[SA]}` } });
    expect(noBody.statusCode).toBe(400);
    expect((await prisma.blockChangeRequest.findUnique({ where: { id: r2.id } }))?.status).toBe('PENDING');
    const res2 = await req('POST', `${base}/${r2.id}/reject`, SA, {});
    expect(res2.json()).toMatchObject({ status: 'REJECTED', processedComment: null });
    const note2 = await prisma.notification.findFirst({ where: { type: 'BLOCK_CHANGE_REJECTED', metadata: { path: ['requestId'], equals: r2.id } } });
    expect(note2?.message).toBe(`Your request to clean ${PREFIX}-F in ${PREFIX}-B2 was rejected by ${SA}.`);
  });

  it('a requester can never decide their own request — not even a SUPER_ADMIN', async () => {
    const own = await submit(SA);
    const res = await req('POST', `${base}/${own.id}/approve`, SA, {});
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await prisma.blockChangeRequest.findUnique({ where: { id: own.id } }))?.status).toBe('PENDING');
    expect(await prisma.auditTrail.count({ where: { targetId: own.id, action: { in: ['BLOCK_CHANGE_APPROVED', 'BLOCK_CHANGE_REJECTED'] } } })).toBe(0);
  });

  it('unknown request 404; a malformed id is refused by the schema', async () => {
    expect((await req('POST', `${base}/${randomUUID()}/approve`, SA, {})).json()).toMatchObject({ error: 'NOT_FOUND' });
    expect((await req('POST', `${base}/not-a-uuid/approve`, SA, {})).statusCode).toBe(400);
  });

  it('concurrent decisions on one request: exactly one wins, one audit row, the rest 409', async () => {
    const r = await submit();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      req('POST', `${base}/${r.id}/${i % 2 ? 'reject' : 'approve'}`, SA, { comment: `race ${i}` })));
    const ok = results.filter((x) => x.statusCode === 200);
    expect(ok).toHaveLength(1);
    expect(results.filter((x) => x.statusCode === 409).every((x) => x.json().error === 'ALREADY_PROCESSED')).toBe(true);
    expect(results.filter((x) => x.statusCode === 409)).toHaveLength(9);
    const decided = await prisma.auditTrail.count({ where: { targetId: r.id, action: { in: ['BLOCK_CHANGE_APPROVED', 'BLOCK_CHANGE_REJECTED'] } } });
    expect(decided).toBe(1);
    const final = await prisma.blockChangeRequest.findUnique({ where: { id: r.id } });
    expect(final?.status).toBe(ok[0].json().status);
    expect(final?.processedComment).toBe(ok[0].json().processedComment);
  });

  it('the configured approval role may decide; a blank role leaves the permission gate alone', async () => {
    const original = await readApprovalRole();
    try {
      await setApprovalRole(ROLE_APR);
      const r = await submit();
      const ok = await req('POST', `${base}/${r.id}/approve`, APR, { comment: 'my role' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ status: 'APPROVED', processedBy: uid[APR] });
      const note = await prisma.notification.findFirst({ where: { type: 'BLOCK_CHANGE_REQUESTED', forRole: ROLE_APR, metadata: { path: ['requestId'], equals: r.id } } });
      expect(note).not.toBeNull();

      await setApprovalRole('   ');
      const r2 = await submit();
      expect((await req('POST', `${base}/${r2.id}/reject`, APR, { comment: 'blank role' })).statusCode).toBe(200);
      // With no role configured the approver notification falls back to ADMIN.
      expect(await prisma.notification.count({ where: { forRole: 'ADMIN', metadata: { path: ['requestId'], equals: r2.id } } })).toBe(1);

      await setApprovalRole('SUPER_ADMIN');
      const r3 = await submit();
      // SUPER_ADMIN is the configured role: notified once, not twice.
      expect(await prisma.notification.count({ where: { metadata: { path: ['requestId'], equals: r3.id } } })).toBe(1);
    } finally {
      await setApprovalRole(original);
    }
    expect(await readApprovalRole()).toBe(original);
  });
});

describe('service: approval window, mode', () => {
  it('an approval older than the configured window is not usable; a legacy row falls back to createdAt', async () => {
    const hours = await blockChangeService.getAutoExpireHours();
    const r = await submit();
    await prisma.blockChangeRequest.update({ where: { id: r.id }, data: { status: 'APPROVED', processedAt: new Date(Date.now() - (hours + 1) * 3_600_000) } });
    expect(await blockChangeService.hasApproval(filterId, r.toBlockId)).toBe(hours === 0);
    await prisma.blockChangeRequest.update({ where: { id: r.id }, data: { processedAt: null } });
    expect(await blockChangeService.hasApproval(filterId, r.toBlockId)).toBe(true); // createdAt is now
    expect(await blockChangeService.hasApproval(filterId, randomUUID())).toBe(false);
    expect(['NONE', 'CONFIRM', 'APPROVAL']).toContain(await blockChangeService.getMode());
  });
});
