/**
 * Repository / service functions no route reaches today (coverage, 2026-10-21),
 * exercised directly against the real test DB so their queries are checked
 * against the real schema, plus the pure subject / name-mask helpers'
 * remaining edge cases.
 *
 *  - authRepository.findActiveSessionsByIp, userRepository.findUsersByUsernames,
 *    adminRequestService.getById: exported, no caller in the codebase.
 *  - adminRequestService.create with no requester employee ID: the public route's
 *    schema makes the field required, so only a direct caller can omit it.
 *
 * Owns every row it creates (prefix `cva`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { authRepository } from '../../auth/auth.repository.js';
import { userRepository } from '../user.repository.js';
import { adminRequestService, describeRequestSubject, subjectFields } from '../../admin-requests/admin-request.service.js';
import { maskFullName } from '../../admin-requests/routes.js';
import { cleanupAll, runSuffix, createUser, deleteUsers } from '../../../e2e/support/owned-fixtures.js';
import { auditFor } from './support/cva-fixtures.js';

const S = runSuffix();
const A = `cva_rp_a_${S}`.toLowerCase();
const B = `cva_rp_b_${S}`.toLowerCase();
const IP = `10.250.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const ids: string[] = [];
const requestIds: string[] = [];

describe('repository functions without a route', () => {
  let aId = '', bId = '';
  let bActive = '';

  beforeAll(async () => {
    aId = await createUser(A, 'OPERATOR', 'CvaRepo@2026x', 'Repo A');
    bId = await createUser(B, 'OPERATOR', 'CvaRepo@2026x', 'Repo B');
    ids.push(aId, bId);
    const mk = (userId: string, extra: Record<string, unknown> = {}) => prisma.session.create({
      data: { userId, tokenHash: `cva-${randomUUID()}`, ipAddress: IP, expiresAt: new Date(Date.now() + 3_600_000), ...extra },
    });
    await mk(aId);
    bActive = (await mk(bId)).id;
    await mk(bId, { isActive: false });
    await mk(bId, { expiresAt: new Date(Date.now() - 60_000) });
  }, 60_000);

  afterAll(async () => {
    await cleanupAll([
      ['notifications', async () => {
        for (const id of requestIds) {
          await prisma.notification.deleteMany({ where: { type: 'USER_CREATION_REQUEST_SUBMITTED', metadata: { path: ['requestId'], equals: id } } });
        }
      }],
      ['requests', () => prisma.adminRequest.deleteMany({ where: { id: { in: requestIds } } })],
      ['users', () => deleteUsers(ids)],
    ]);
  }, 60_000);

  it('findActiveSessionsByIp returns other users\' live sessions on that IP, with their names', async () => {
    const rows = await authRepository.findActiveSessionsByIp(IP, aId);
    expect(rows.map((r) => r.id)).toEqual([bActive]);
    expect(rows[0].user).toEqual({ username: B, fullName: 'Repo B' });
  });

  it('findUsersByUsernames returns only the display fields', async () => {
    const rows = await userRepository.findUsersByUsernames([A, B, `cva_none_${S}`]);
    expect(rows.map((r) => r.username).sort()).toEqual([A, B].sort());
    expect(Object.keys(rows[0]).sort()).toEqual(['department', 'email', 'fullName', 'username']);
  });

  it('adminRequestService.create with no employee ID records the claim as unverified:unknown; getById reads it back', async () => {
    const req = await adminRequestService.create({ requestType: 'UNLOCK', requesterName: 'Walk-in', requestData: { username: A } });
    requestIds.push(req.id);
    expect(req).toMatchObject({ requesterEmployeeId: null, requesterEmail: null, remarks: null, status: 'PENDING' });
    const audit = await auditFor('ADMIN_REQUEST_SUBMITTED', req.id);
    expect(audit).toMatchObject({ userId: 'unverified:unknown', userRole: null });
    expect(audit?.reason).toBe(`Unlock Account request for ${A}, submitted by Walk-in`);
    expect((await adminRequestService.getById(req.id))?.id).toBe(req.id);
    expect(await adminRequestService.getById('00000000-0000-4000-8000-0000000000f1')).toBeNull();
  });
});

describe('pure helpers — remaining edge cases', () => {
  it('describeRequestSubject: missing fields are labelled, a null new value reads "(blank)"', () => {
    expect(describeRequestSubject('CREATE_USER', { fullName: 'No Id', requestedRole: 'OPERATOR' })).toBe('(no user ID) (No Id), role OPERATOR');
    expect(describeRequestSubject('MODIFY_USER', { modifyField: 'role', newValue: null })).toBe('(no user ID), role -> (blank)');
    expect(describeRequestSubject('MODIFY_USER', { username: 'U1' })).toBe('U1');
    expect(describeRequestSubject('MODIFY_USER', {})).toBe('(no user ID)');
    expect(describeRequestSubject('UNLOCK', undefined as unknown as Record<string, unknown>)).toBe('(no user ID)');
  });

  it('subjectFields: empty CREATE_USER / MODIFY_USER fields become null', () => {
    expect(subjectFields('CREATE_USER', {})).toEqual({ targetUsername: null, targetFullName: null, requestedRole: null });
    expect(subjectFields('MODIFY_USER', { username: 'U1' })).toEqual({ targetUsername: 'U1', modifyField: null, newValue: null });
    expect(subjectFields('MODIFY_USER', { username: 'U1', modifyField: 'role', currentRole: 'OPERATOR', newValue: 'QA' }))
      .toEqual({ targetUsername: 'U1', modifyField: 'role', currentRole: 'OPERATOR', newValue: 'QA' });
  });

  it('maskFullName keeps first letters and length, leaves 1-letter words, passes null through', () => {
    expect(maskFullName('Siva Munnangi')).toBe('S*** M*******');
    expect(maskFullName('A B')).toBe('A B');
    expect(maskFullName('  Jo   Li ')).toBe('J* L*');
    expect(maskFullName(null)).toBeNull();
    expect(maskFullName('')).toBeNull();
  });
});
