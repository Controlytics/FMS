/**
 * User Groups routes (coverage, 2026-10-21) — every route through the real
 * Fastify stack and the real test DB: CRUD, membership, SUPER_ADMIN hiding on
 * the member list, permission refusals, the re-auth gate, and the audit rows
 * each mutation writes (with their hash-chain link).
 *
 * Owns its users, roles, groups and re-auth grants (prefix `cva`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, authGet, authPost, authPut, authDelete, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth,
  type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvaGrp@2026x';
const SA = `cva_ug_sa_${S}`.toLowerCase();
const READER = `cva_ug_rd_${S}`.toLowerCase();
const WRITER = `cva_ug_wr_${S}`.toLowerCase();
const SA_MEMBER = `cva_ug_sm_${S}`.toLowerCase();
const PLAIN_MEMBER = `cva_ug_pm_${S}`.toLowerCase();
const ROLE_READ = `CVA_UGR_${S}`.slice(0, 20);
const ROLE_WRITE = `CVA_UGW_${S}`.slice(0, 20);

let app: FastifyInstance;
let saTok = '';
let readerTok = '';
let writerTok = '';
const userIds: string[] = [];
let saMemberId = '';
let plainMemberId = '';
let reauthAdded: ReauthGrant = [];
const groupIds: string[] = [];

/** The audit row this file wrote for (action, target), newest first. */
async function auditFor(action: string, targetId: string) {
  return prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });
}

/** The row's previous_checksum is the checksum of the row before it in the chain. */
async function expectChained(row: { chainPosition: bigint | null; previousChecksum: string | null }) {
  expect(row.chainPosition).not.toBeNull();
  const prev = await prisma.auditTrail.findFirst({
    where: { chainPosition: { lt: row.chainPosition! } },
    orderBy: { chainPosition: 'desc' },
  });
  expect(row.previousChecksum).toBe(prev?.checksum ?? null);
}

describe('user-groups routes', () => {
  beforeAll(async () => {
    await createRole(ROLE_READ, ['CONFIG_READ']);
    await createRole(ROLE_WRITE, ['CONFIG_READ', 'CONFIG_UPDATE']);
    userIds.push(await createUser(SA, 'SUPER_ADMIN', PW));
    userIds.push(await createUser(READER, ROLE_READ, PW));
    userIds.push(await createUser(WRITER, ROLE_WRITE, PW));
    saMemberId = await createUser(SA_MEMBER, 'SUPER_ADMIN', PW);
    plainMemberId = await createUser(PLAIN_MEMBER, ROLE_READ, PW);
    userIds.push(saMemberId, plainMemberId);
    // Re-auth for MANAGE_USER_GROUPS on the WRITER role only — never on a shared role.
    reauthAdded = await addReauth([['MANAGE_USER_GROUPS', ROLE_WRITE]]);
    app = await buildApp();
    saTok = await login(app, SA, PW);
    readerTok = await login(app, READER, PW);
    writerTok = await login(app, WRITER, PW);
  }, 60_000);

  afterAll(async () => {
    await cleanupAll([
      ['user groups', () => prisma.userGroup.deleteMany({ where: { id: { in: groupIds } } })],
      ['reauth', () => removeReauth(reauthAdded)],
      ['users', () => deleteUsers(userIds)],
      ['roles', () => deleteRoles([ROLE_READ, ROLE_WRITE])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  beforeEach(() => { internalErrors.length = 0; });

  it('creates a group, lists it with memberCount 0, and audits the creation', async () => {
    const name = `cva-grp-a-${S}`;
    const res = await authPost(app, '/api/user-groups', saTok, { name, description: 'coverage group' });
    expect(res.statusCode).toBe(200);
    const group = res.json();
    groupIds.push(group.id);
    expect(group).toMatchObject({ name, description: 'coverage group', isActive: true, createdBy: SA });

    const list = await authGet(app, '/api/user-groups', readerTok);
    expect(list.statusCode).toBe(200);
    const mine = list.json().find((g: any) => g.id === group.id);
    expect(mine.memberCount).toBe(0);
    expect(mine).not.toHaveProperty('_count');

    const row = await auditFor('USER_GROUP_CREATED', group.id);
    expect(row).toMatchObject({ userId: SA, userRole: 'SUPER_ADMIN', targetType: 'UserGroup', afterValue: { name } });
    await expectChained(row!);
  });

  it('refuses writes to a CONFIG_READ-only role (403) and writes nothing', async () => {
    const name = `cva-grp-denied-${S}`;
    const res = await authPost(app, '/api/user-groups', readerTok, { name });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
    expect(await prisma.userGroup.findUnique({ where: { name } })).toBeNull();
  });

  it('rejects an empty name with 400 VALIDATION_ERROR and no internal error', async () => {
    const res = await authPost(app, '/api/user-groups', saTok, { name: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toHaveLength(0);
  });

  it('demands re-authentication for a role configured for MANAGE_USER_GROUPS on every write route', async () => {
    const gid = groupIds[0];
    const calls = [
      () => authPost(app, '/api/user-groups', writerTok, { name: `cva-grp-x-${S}` }),
      () => authPut(app, `/api/user-groups/${gid}`, writerTok, { description: 'x' }),
      () => authPost(app, `/api/user-groups/${gid}/members`, writerTok, { userIds: [plainMemberId] }),
      () => authDelete(app, `/api/user-groups/${gid}/members/${plainMemberId}`, writerTok),
      () => authDelete(app, `/api/user-groups/${gid}`, writerTok),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'MANAGE_USER_GROUPS' });
    }
    // Nothing changed: the group is still there, unchanged, with no members.
    const g = await prisma.userGroup.findUnique({ where: { id: gid }, include: { members: true } });
    expect(g?.description).toBe('coverage group');
    expect(g?.members).toHaveLength(0);
  });

  it('accepts the write once the writer signs with their password', async () => {
    const name = `cva-grp-w-${S}`;
    const res = await authPost(app, '/api/user-groups', writerTok, { name }, PW);
    expect(res.statusCode).toBe(200);
    groupIds.push(res.json().id);
    const row = await auditFor('USER_GROUP_CREATED', res.json().id);
    expect(row?.userId).toBe(WRITER);
    // The signed write points at its REAUTH_SUCCESS row.
    expect(row?.signatureAuditId).toBeTruthy();
    const sig = await prisma.auditTrail.findUnique({ where: { id: row!.signatureAuditId! } });
    expect(sig).toMatchObject({ action: 'REAUTH_SUCCESS', userId: WRITER });
  });

  it('updates a group, strips undeclared keys, and records before/after', async () => {
    const gid = groupIds[0];
    const res = await authPut(app, `/api/user-groups/${gid}`, saTok, { description: 'renamed', isActive: false, createdBy: 'forged' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: gid, description: 'renamed', isActive: false, createdBy: SA });
    const row = await auditFor('USER_GROUP_UPDATED', gid);
    expect(row?.beforeValue).toMatchObject({ description: 'coverage group', isActive: true });
    expect(row?.afterValue).toMatchObject({ description: 'renamed', isActive: false });
    expect(row?.signatureMeaning).toContain('updated');
  });

  it('answers 404 for update / delete / member writes on an unknown group', async () => {
    const missing = '00000000-0000-4000-8000-000000000123';
    for (const res of [
      await authPut(app, `/api/user-groups/${missing}`, saTok, { description: 'x' }),
      await authDelete(app, `/api/user-groups/${missing}`, saTok),
      await authPost(app, `/api/user-groups/${missing}/members`, saTok, { userIds: [plainMemberId] }),
      await authDelete(app, `/api/user-groups/${missing}/members/${plainMemberId}`, saTok),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'NOT_FOUND', message: 'User group not found' });
    }
    expect(internalErrors).toHaveLength(0);
  });

  it('adds members, reports only rows actually inserted, and audits the change', async () => {
    const gid = groupIds[0];
    const first = await authPost(app, `/api/user-groups/${gid}/members`, saTok, { userIds: [plainMemberId, saMemberId] });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ success: true, added: 2 });

    // Re-adding an existing member is not a new row.
    const again = await authPost(app, `/api/user-groups/${gid}/members`, saTok, { userIds: [plainMemberId] });
    expect(again.json()).toEqual({ success: true, added: 0 });

    const row = await auditFor('USER_GROUP_MEMBERS_ADDED', gid);
    expect(row?.afterValue).toMatchObject({ requestedUserIds: [plainMemberId], addedCount: 0 });
    expect(await prisma.userGroupMember.count({ where: { groupId: gid } })).toBe(2);
  });

  it('lists members with user details, hiding SUPER_ADMIN members from a non-SA caller', async () => {
    const gid = groupIds[0];
    const asSa = await authGet(app, `/api/user-groups/${gid}/members`, saTok);
    expect(asSa.statusCode).toBe(200);
    const saView = asSa.json();
    expect(saView.map((m: any) => m.userId).sort()).toEqual([plainMemberId, saMemberId].sort());
    expect(saView.find((m: any) => m.userId === plainMemberId).user).toMatchObject({ username: PLAIN_MEMBER, role: ROLE_READ });

    const asReader = await authGet(app, `/api/user-groups/${gid}/members`, readerTok);
    expect(asReader.statusCode).toBe(200);
    expect(asReader.json().map((m: any) => m.userId)).toEqual([plainMemberId]);

    // The list count includes every member, whoever views it.
    const list = await authGet(app, '/api/user-groups', saTok);
    expect(list.json().find((g: any) => g.id === gid).memberCount).toBe(2);
  });

  it('shows a member whose user row is gone with user:null', async () => {
    const gid = groupIds[0];
    const ghost = '00000000-0000-4000-8000-0000000000aa';
    await prisma.userGroupMember.create({ data: { groupId: gid, userId: ghost } });
    const res = await authGet(app, `/api/user-groups/${gid}/members`, saTok);
    expect(res.json().find((m: any) => m.userId === ghost)).toMatchObject({ userId: ghost, user: null });
    await prisma.userGroupMember.deleteMany({ where: { groupId: gid, userId: ghost } });
  });

  it('removes a member and writes the audit row first', async () => {
    const gid = groupIds[0];
    const res = await authDelete(app, `/api/user-groups/${gid}/members/${plainMemberId}`, saTok);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.userGroupMember.findMany({ where: { groupId: gid } })).toHaveLength(1);
    const row = await auditFor('USER_GROUP_MEMBER_REMOVED', gid);
    expect(row?.beforeValue).toMatchObject({ userId: plainMemberId });
    await expectChained(row!);
  });

  // D-AUTH-4: a malformed id is refused by the route schema (400
  // VALIDATION_ERROR) and never reaches the database (which answered
  // DATA_CONSTRAINT and logged an ERROR-level "Unmapped Prisma error").
  it('a malformed group or user id is a 400 VALIDATION_ERROR from the route schema, on every route', async () => {
    const gid = groupIds[0];
    const before = await prisma.auditTrail.count({ where: { targetType: 'UserGroup', targetId: gid } });
    const answers = [
      await authGet(app, '/api/user-groups/not-a-uuid/members', saTok),
      await authPut(app, '/api/user-groups/not-a-uuid', saTok, { description: 'x' }),
      await authDelete(app, '/api/user-groups/not-a-uuid', saTok),
      await authPost(app, '/api/user-groups/not-a-uuid/members', saTok, { userIds: [plainMemberId] }),
      await authDelete(app, `/api/user-groups/not-a-uuid/members/${plainMemberId}`, saTok),
      await authDelete(app, `/api/user-groups/${gid}/members/not-a-uuid`, saTok),
      await authPost(app, `/api/user-groups/${gid}/members`, saTok, { userIds: ['not-a-uuid'] }),
    ];
    for (const res of answers) {
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.auditTrail.count({ where: { targetType: 'UserGroup', targetId: gid } })).toBe(before);
    expect(internalErrors).toHaveLength(0);
  });

  // D-AUTH-5: a member id that is no user is refused as a whole — no row, no audit.
  it('adding user ids that match no user is a 404 naming them; nothing is added or audited', async () => {
    const gid = groupIds[0];
    const ghost = '00000000-0000-4000-8000-0000000000bb';
    const membersBefore = await prisma.userGroupMember.count({ where: { groupId: gid } });
    const auditBefore = await prisma.auditTrail.count({ where: { action: 'USER_GROUP_MEMBERS_ADDED', targetId: gid } });

    const res = await authPost(app, `/api/user-groups/${gid}/members`, saTok, { userIds: [ghost] });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND', message: `User not found: ${ghost}` });

    // Mixed with a real user: still all-or-nothing.
    const mixed = await authPost(app, `/api/user-groups/${gid}/members`, saTok, { userIds: [plainMemberId, ghost] });
    expect(mixed.statusCode).toBe(404);
    expect(mixed.json().message).toBe(`User not found: ${ghost}`);

    expect(await prisma.userGroupMember.count({ where: { groupId: gid } })).toBe(membersBefore);
    expect(await prisma.userGroupMember.count({ where: { groupId: gid, userId: ghost } })).toBe(0);
    expect(await prisma.auditTrail.count({ where: { action: 'USER_GROUP_MEMBERS_ADDED', targetId: gid } })).toBe(auditBefore);
    expect(internalErrors).toHaveLength(0);
  });

  it('removing a user who is not a member is a 404 and writes no "member removed" audit row', async () => {
    const gid = groupIds[0];
    const notMember = '00000000-0000-4000-8000-0000000000cc';
    const auditBefore = await prisma.auditTrail.count({ where: { action: 'USER_GROUP_MEMBER_REMOVED', targetId: gid } });
    const res = await authDelete(app, `/api/user-groups/${gid}/members/${notMember}`, saTok);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND', message: 'User is not a member of this group' });
    expect(await prisma.auditTrail.count({ where: { action: 'USER_GROUP_MEMBER_REMOVED', targetId: gid } })).toBe(auditBefore);
  });

  it('deletes the group with its memberships and records the membership it destroyed', async () => {
    const gid = groupIds[0];
    const res = await authDelete(app, `/api/user-groups/${gid}`, saTok);
    expect(res.statusCode).toBe(200);
    expect(await prisma.userGroup.findUnique({ where: { id: gid } })).toBeNull();
    expect(await prisma.userGroupMember.count({ where: { groupId: gid } })).toBe(0);
    const row = await auditFor('USER_GROUP_DELETED', gid);
    expect(row?.beforeValue).toMatchObject({ memberCount: 1, memberUserIds: [saMemberId] });
    expect(row?.signatureMeaning).toContain('1 membership(s) permanently deleted');
  });
});
