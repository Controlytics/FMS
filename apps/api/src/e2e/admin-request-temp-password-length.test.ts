/**
 * Admin Requests temporary password follows the password policy (2026-10-07).
 *
 * Approving a Contact Admin CREATE_USER request used to issue a fixed
 * 14-character password from a private generator that never read the policy,
 * while the Users pages issued `minLength` (8 here) — the operator saw both.
 * Every temporary password now comes from `generatePassword` in
 * @digilog/shared at the policy's minimum length.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { adminRequestService } from '../modules/admin-requests/admin-request.service.js';
import type { RequestContext } from '../types/context.js';

const ACTOR = 'temppw_actor_sa';
// User ID rule in the test DB: exactly 6 upper-case letters/digits.
const NEW_USERS = ['TPWA01', 'TPWB02'];
const requestIds: string[] = [];
let ctx: RequestContext;
let savedPolicy: unknown;

async function approveCreate(username: string) {
  const req = await adminRequestService.create({
    requestType: 'CREATE_USER',
    requesterName: 'Temp Password Test',
    requesterEmployeeId: username,
    requestData: { username, fullName: 'Temp Password Test', requestedRole: 'OPERATOR' },
    remarks: 'temp password length e2e',
  });
  const id = (req as { id?: string; requestId?: string }).id ?? (req as { requestId: string }).requestId;
  requestIds.push(id);
  return adminRequestService.process(id, 'approve', 'approved by e2e', ctx) as Promise<{ temporaryPassword?: string }>;
}

async function setMinLength(minLength: number) {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
  const value = { ...((row?.configValue as Record<string, unknown>) ?? {}), minLength };
  await prisma.systemConfig.upsert({
    where: { configKey: 'password-policy' },
    update: { configValue: value },
    create: { configKey: 'password-policy', configValue: value, configType: 'security' },
  });
}

describe('Admin Requests — temporary password length = policy minLength', () => {
  beforeAll(async () => {
    savedPolicy = (await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } }))?.configValue;
    const actor = await prisma.user.upsert({
      where: { username: ACTOR },
      update: { role: 'SUPER_ADMIN', status: 'ENABLED' },
      create: { username: ACTOR, passwordHash: await hashPassword('TempPw@Actor1'), fullName: 'Temp PW Actor', role: 'SUPER_ADMIN', status: 'ENABLED' },
    });
    ctx = { userId: ACTOR, userSub: actor.id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', sessionId: 'temppw-e2e' };
    await prisma.user.deleteMany({ where: { username: { in: NEW_USERS } } });
  });

  afterAll(async () => {
    if (savedPolicy === undefined) await prisma.systemConfig.deleteMany({ where: { configKey: 'password-policy' } });
    else await prisma.systemConfig.update({ where: { configKey: 'password-policy' }, data: { configValue: savedPolicy as object } });
    if (requestIds.length) await prisma.adminRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.user.deleteMany({ where: { username: { in: [...NEW_USERS, ACTOR] } } });
  });

  it('issues exactly minLength characters (8)', async () => {
    await setMinLength(8);
    const out = await approveCreate(NEW_USERS[0]);
    expect(out.temporaryPassword).toHaveLength(8);
  });

  it('follows the policy when minLength changes (12)', async () => {
    await setMinLength(12);
    const out = await approveCreate(NEW_USERS[1]);
    expect(out.temporaryPassword).toHaveLength(12);
  });
});
