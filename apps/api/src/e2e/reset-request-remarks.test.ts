/**
 * Password reset requests are decisions, and "approval/decision flows require
 * remarks" (CLAUDE.md). POST /api/users/reset-requests/:id/process used to take
 * an approve or a reject with no notes at all (2026-10-22). It now refuses one
 * with blank remarks, before the re-auth gate, so no signature is spent on a
 * request that will be refused.
 *
 * Owns every user, role and reset request it touches (prefix `rrr`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authPost, internalErrors } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../lib/password.js';
import {
  cleanupAll, runSuffix, createUser, createRole, login, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant,
} from './support/owned-fixtures.js';

const S = runSuffix();
const lc = (s: string) => s.toLowerCase();
const PW = 'RrrUser@2026x';
const NEW_PW = 'RrrTemp#2027y';

const SA = lc(`rrr_sa_${S}`);
const SIGNER = lc(`rrr_sg_${S}`);
const TARGET = lc(`rrr_tg_${S}`);
const R_TARGET = `RRR_T_${S}`;
const R_SIGNER = `RRR_S_${S}`;
const MESSAGE = 'Remarks are required to approve or reject a password reset request.';

let app: FastifyInstance;
let saTok = '', signerTok = '';
const ids: Record<string, string> = {};
const requestIds: string[] = [];
let reauthAdded: ReauthGrant = [];

const newRequest = async () => {
  const id = (await prisma.passwordResetRequest.create({ data: { userId: ids.TARGET } })).id;
  requestIds.push(id);
  return id;
};
const statusOf = async (id: string) => (await prisma.passwordResetRequest.findUnique({ where: { id } }))?.status;
const process = (id: string, tok: string, body: Record<string, unknown>, pw?: string) =>
  authPost(app, `/api/users/reset-requests/${id}/process`, tok, body, pw);

describe('reset request decisions need remarks', () => {
  beforeAll(async () => {
    await createRole(R_TARGET, ['USER_READ']);
    await createRole(R_SIGNER, ['USER_READ', 'USER_RESET_PASSWORD']);
    ids.SA = await createUser(SA, 'SUPER_ADMIN', PW);
    ids.SIGNER = await createUser(SIGNER, R_SIGNER, PW);
    ids.TARGET = await createUser(TARGET, R_TARGET, PW);
    reauthAdded = await addReauth([['PROCESS_RESET_REQUEST', R_SIGNER]]);
    app = await buildApp();
    saTok = await login(app, SA, PW);
    signerTok = await login(app, SIGNER, PW);
  }, 60_000);

  afterAll(async () => {
    const usernames = [SA, SIGNER, TARGET];
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['reset requests', () => prisma.passwordResetRequest.deleteMany({ where: { OR: [{ id: { in: requestIds } }, { userId: { in: Object.values(ids) } }] } })],
      ['notifications', () => prisma.notification.deleteMany({ where: { OR: [{ targetUserId: { in: usernames } }, { forUserId: { in: usernames } }] } })],
      ['user configs', () => prisma.userConfig.deleteMany({ where: { userId: { in: Object.values(ids) } } })],
      ['users', () => deleteUsers(Object.values(ids))],
      ['roles', () => deleteRoles([R_TARGET, R_SIGNER])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  it('an approve without remarks is refused and changes nothing', async () => {
    const id = await newRequest();
    const before = (await prisma.user.findUnique({ where: { id: ids.TARGET } }))!.passwordHash;
    const res = await process(id, saTok, { action: 'approve', newPassword: NEW_PW });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION', message: MESSAGE });
    expect(await statusOf(id)).toBe('PENDING');
    expect((await prisma.user.findUnique({ where: { id: ids.TARGET } }))!.passwordHash).toBe(before);
    expect(internalErrors).toEqual([]);
  });

  it('a reject with blank (whitespace) remarks is refused', async () => {
    const id = await newRequest();
    const res = await process(id, saTok, { action: 'reject', notes: '   ' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe(MESSAGE);
    expect(await statusOf(id)).toBe('PENDING');
  });

  it('with remarks, a reject closes the request and stores the remarks trimmed', async () => {
    const id = await newRequest();
    const res = await process(id, saTok, { action: 'reject', notes: '  Not verified by phone  ' });
    expect(res.statusCode).toBe(200);
    const row = await prisma.passwordResetRequest.findUnique({ where: { id } });
    expect(row).toMatchObject({ status: 'REJECTED', notes: 'Not verified by phone' });
  });

  it('with remarks, an approve sets the temporary password and stores the remarks', async () => {
    const id = await newRequest();
    const res = await process(id, saTok, { action: 'approve', newPassword: NEW_PW, notes: 'Identity verified' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.passwordResetRequest.findUnique({ where: { id } })).toMatchObject({ status: 'APPROVED', notes: 'Identity verified' });
    expect(await verifyPassword(NEW_PW, (await prisma.user.findUnique({ where: { id: ids.TARGET } }))!.passwordHash)).toBe(true);
  });

  it('the remarks check comes before the re-auth gate: no signature is asked for (or recorded) for a refused decision', async () => {
    const id = await newRequest();
    const reauthRowsBefore = await prisma.auditTrail.count({ where: { userId: SIGNER, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } });
    const refused = await process(id, signerTok, { action: 'reject' }, PW);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toBe(MESSAGE);
    expect(await prisma.auditTrail.count({ where: { userId: SIGNER, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } })).toBe(reauthRowsBefore);
    // with remarks the gate still applies: no password -> REAUTH_REQUIRED
    const unsigned = await process(id, signerTok, { action: 'reject', notes: 'No contact' });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'PROCESS_RESET_REQUEST' });
    const signed = await process(id, signerTok, { action: 'reject', notes: 'No contact' }, PW);
    expect(signed.statusCode).toBe(200);
    expect(await statusOf(id)).toBe('REJECTED');
  });
});
