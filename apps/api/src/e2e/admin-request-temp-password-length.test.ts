/**
 * Admin Requests temporary password follows the password policy (2026-10-07).
 *
 * Approving a Contact Admin CREATE_USER request used to issue a fixed
 * 14-character password from a private generator that never read the policy,
 * while the Users pages issued `minLength` (8 here) — the operator saw both.
 * Every temporary password now comes from `generatePassword` in
 * @digilog/shared at the policy's minimum length.
 *
 * The shared `password-policy` row is NOT written (2026-10-22): the generator's
 * one policy read (authRepository.getPasswordPolicyConfig) is answered with the
 * stored policy at a different minLength. Writing the row changed the minimum
 * length for every password set concurrently by other suites.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { adminRequestService } from '../modules/admin-requests/admin-request.service.js';
import { authRepository } from '../modules/auth/auth.repository.js';
import type { RequestContext } from '../types/context.js';

const ACTOR = 'temppw_actor_sa';
// User ID rule in the test DB: exactly 6 upper-case letters/digits.
const NEW_USERS = ['TPWA01', 'TPWB02'];
const requestIds: string[] = [];
let ctx: RequestContext;
let storedPolicy: Record<string, unknown> = {};
let storedMin = 8;

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

/** The generator reads the stored policy with `minLength` overridden; nothing is written. */
function setMinLength(minLength: number) {
  vi.spyOn(authRepository, 'getPasswordPolicyConfig').mockResolvedValue({ ...storedPolicy, minLength });
}

describe('Admin Requests — temporary password length = policy minLength', () => {
  beforeAll(async () => {
    storedPolicy = await authRepository.getPasswordPolicyConfig();
    storedMin = Number(storedPolicy.minLength ?? 8);
    const actor = await prisma.user.upsert({
      where: { username: ACTOR },
      update: { role: 'SUPER_ADMIN', status: 'ENABLED' },
      create: { username: ACTOR, passwordHash: await hashPassword('TempPw@Actor1'), fullName: 'Temp PW Actor', role: 'SUPER_ADMIN', status: 'ENABLED' },
    });
    ctx = { userId: ACTOR, userSub: actor.id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', sessionId: 'temppw-e2e' };
    await prisma.user.deleteMany({ where: { username: { in: NEW_USERS } } });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    // Each request wrote a "request submitted" notification (metadata.requestId)
    // and each approval created a user, which wrote a USER_CREATED notification
    // (metadata.userId). Remove them by those links, or every run leaves four
    // notifications pointing at a request and a user that no longer exist.
    if (requestIds.length) {
      await prisma.notification.deleteMany({
        where: { type: 'USER_CREATION_REQUEST_SUBMITTED', OR: requestIds.map((id) => ({ metadata: { path: ['requestId'], equals: id } })) },
      });
      await prisma.adminRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    const created = await prisma.user.findMany({ where: { username: { in: NEW_USERS } }, select: { id: true } });
    if (created.length) {
      await prisma.notification.deleteMany({
        where: { type: 'USER_CREATED', OR: created.map((u) => ({ metadata: { path: ['userId'], equals: u.id } })) },
      });
    }
    await prisma.user.deleteMany({ where: { username: { in: [...NEW_USERS, ACTOR] } } });
  });

  // Lengths derive from the stored minimum: the created user must still pass the
  // REAL policy check in user.service, which reads the row itself.
  it('issues exactly minLength characters (the stored minimum)', async () => {
    setMinLength(storedMin);
    const out = await approveCreate(NEW_USERS[0]);
    expect(out.temporaryPassword).toHaveLength(storedMin);
  });

  it('follows the policy when minLength changes (stored minimum + 4)', async () => {
    setMinLength(storedMin + 4);
    const out = await approveCreate(NEW_USERS[1]);
    expect(out.temporaryPassword).toHaveLength(storedMin + 4);
  });
});
