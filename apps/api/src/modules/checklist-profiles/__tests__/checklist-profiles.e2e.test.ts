/**
 * Checklist profiles + questions — every route through the real harness app
 * (production error handler, real auth / RBAC / re-auth, real Prisma on
 * digilog_test_db). Every mutation is snapshot-then-bump (Phase A.1): the tests
 * read the frozen version rows back, not just the live row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVCK'));
let app: FastifyInstance;
let sa: { id: string; call: Caller };
let ck: { id: string; call: Caller };
let op: { call: Caller };
let profileId: string;
let q1: string;
let q2: string;
let q3: string;
let filterId: string;

const base = '/api/checklist-profiles';

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const ckRole = await own.role('CK', ['FCP_READ', 'CHECKLIST_CREATE', 'CHECKLIST_EDIT', 'CHECKLIST_DELETE']);
  ck = await own.user(app, 'ck', ckRole);
  op = await own.user(app, 'op', await own.role('OP', ['FILTER_OPERATE']));
  await own.reauth(['CREATE_CHECKLIST_PROFILE', 'UPDATE_CHECKLIST_PROFILE', 'DELETE_CHECKLIST_PROFILE'], ckRole);
  await own.template('FILTER', { isActive: true });
  const blockId = await own.instance('BLOCK', await own.template('BLOCK'));
  const ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  filterId = await own.filter('F', ahuId);
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('checklist-profiles — profiles', () => {
  it('create asks for the password, then creates v1 with no questions and audits it', async () => {
    const noPw = await ck.call('POST', base, { body: { name: own.n('CK') } });
    expect(noPw.status).toBe(401);
    expect(noPw.body.action).toBe('CREATE_CHECKLIST_PROFILE');
    const res = await ck.call('POST', base, { pw: PASSWORD, body: { name: own.n('CK'), description: 'pre-wash checks' } });
    expect(res.status).toBe(201);
    profileId = res.body.id;
    expect(res.body).toMatchObject({ name: own.n('CK'), description: 'pre-wash checks', version: 1, isActive: true, createdBy: ck.id });
    const [audit] = await auditFor(profileId, 'CREATED');
    expect(audit.afterValue).toEqual({ name: own.n('CK'), version: 1 });
    const bare = await sa.call('POST', base, { body: { name: own.n('CK-BARE') } });
    expect(bare.body.description).toBeNull();
    const nameless = await sa.call('POST', base, { body: { description: 'x' } });
    expect(nameless.status).toBe(400);
  });

  it('gets one profile with its questions; 404 for an unknown id; operators may list but not open by id', async () => {
    const res = await ck.call('GET', `${base}/${profileId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: profileId, questions: [] });
    const missing = await ck.call('GET', `${base}/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Checklist profile not found');
    expect((await op.call('GET', `${base}?limit=1`)).status).toBe(200);
    expect((await op.call('GET', `${base}/${profileId}`)).status).toBe(403);
  });
});

describe('checklist-profiles — questions', () => {
  it('add question freezes v1, bumps to v2, applies defaults and the next sort order, and audits with the profile name', async () => {
    const noPw = await ck.call('POST', `${base}/${profileId}/questions`, { body: { question: 'Gloves on?' } });
    expect(noPw.status).toBe(401);
    const res = await ck.call('POST', `${base}/${profileId}/questions`, { pw: PASSWORD, body: { question: 'Gloves on?' } });
    expect(res.status).toBe(201);
    q1 = res.body.id;
    expect(res.body).toMatchObject({ question: 'Gloves on?', questionType: 'YES_NO', required: false, section: null, description: null, options: [], validation: {}, sortOrder: 0 });
    const live = await prisma.checklistProfile.findUnique({ where: { id: profileId } });
    expect(live!.version).toBe(2);
    const v1 = await prisma.checklistProfileVersion.findUnique({ where: { profileId_versionNumber: { profileId, versionNumber: 1 } } });
    expect(v1).toMatchObject({ changeNotes: 'question added: Gloves on?', createdBy: ck.id });
    expect((v1!.snapshot as any).questions).toEqual([]);
    const [audit] = await auditFor(profileId, 'CHECKLIST_QUESTION_ADDED');
    expect(audit.afterValue).toMatchObject({ name: own.n('CK'), questionId: q1, question: 'Gloves on?', questionType: 'YES_NO', sortOrder: 0 });

    const second = await sa.call('POST', `${base}/${profileId}/questions`, {
      body: { question: 'Pressure (bar)', questionType: 'NUMERIC', required: true, section: 'Readings', description: 'gauge', options: [], validation: { min: 0, max: 10 } },
    });
    expect(second.status).toBe(201);
    q2 = second.body.id;
    expect(second.body).toMatchObject({ sortOrder: 1, required: true, questionType: 'NUMERIC', section: 'Readings', validation: { min: 0, max: 10 } });
    const third = await sa.call('POST', `${base}/${profileId}/questions`, { body: { question: 'Notes', questionType: 'TEXT', sortOrder: 9 } });
    q3 = third.body.id;
    expect(third.body.sortOrder).toBe(9);
    const missing = await sa.call('POST', `${base}/${randomUUID()}/questions`, { body: { question: 'x' } });
    expect(missing.status).toBe(404);
  });

  it('an unknown question type is a 400, not a 500, and changes nothing', async () => {
    internalErrors.length = 0;
    const before = (await prisma.checklistProfile.findUnique({ where: { id: profileId } }))!.version;
    const res = await sa.call('POST', `${base}/${profileId}/questions`, { body: { question: 'bad', questionType: 'BOGUS' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
    expect((await prisma.checklistProfile.findUnique({ where: { id: profileId } }))!.version).toBe(before);
    expect(await prisma.checklistQuestion.count({ where: { profileId, question: 'bad' } })).toBe(0);
  });

  it('update question changes only the sent fields, snapshots, and audits before/after', async () => {
    const noPw = await ck.call('PUT', `${base}/${profileId}/questions/${q1}`, { body: { required: true } });
    expect(noPw.status).toBe(401);
    const res = await ck.call('PUT', `${base}/${profileId}/questions/${q1}`, {
      pw: PASSWORD,
      body: { question: 'Gloves AND gown on?', required: true, section: 'PPE', description: 'both', options: ['Y', 'N'], validation: { strict: true }, sortOrder: 0, questionType: 'YES_NO' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ question: 'Gloves AND gown on?', required: true, section: 'PPE', description: 'both', options: ['Y', 'N'], validation: { strict: true } });
    const partial = await sa.call('PUT', `${base}/${profileId}/questions/${q1}`, { body: { section: 'PPE-2' } });
    expect(partial.body).toMatchObject({ question: 'Gloves AND gown on?', section: 'PPE-2', required: true });
    const latest = await prisma.checklistProfileVersion.findFirst({ where: { profileId }, orderBy: { versionNumber: 'desc' } });
    expect(latest!.changeNotes).toBe('question updated: Gloves AND gown on?');
    const [audit] = await auditFor(profileId, 'CHECKLIST_QUESTION_UPDATED');
    expect(audit.beforeValue).toMatchObject({ name: own.n('CK'), questionId: q1, section: 'PPE' });
    expect(audit.afterValue).toMatchObject({ section: 'PPE-2' });

    const foreign = await sa.call('PUT', `${base}/${randomUUID()}/questions/${q1}`, { body: { required: false } });
    expect(foreign.status).toBe(404);
    expect(foreign.body.message).toBe('Question not found');
  });

  it('reorder takes exactly this profile\'s questions, once each', async () => {
    const noPw = await ck.call('PUT', `${base}/${profileId}/reorder`, { body: { questionIds: [q3, q2, q1] } });
    expect(noPw.status).toBe(401);
    const otherProfile = await own.checklist('CK-OTHER');
    const otherQ = await prisma.checklistQuestion.create({ data: { profileId: otherProfile, question: 'other' } });
    for (const questionIds of [[q3, q2, otherQ.id], [q3, q2, q2], [q3, q2], [q3, q2, q1, otherQ.id]]) {
      const bad = await sa.call('PUT', `${base}/${profileId}/reorder`, { body: { questionIds } });
      expect(bad.status).toBe(400);
      expect(bad.body).toMatchObject({ error: 'INVALID_QUESTION_ORDER', message: 'questionIds must list every question of this profile exactly once.' });
    }
    expect((await prisma.checklistQuestion.findUnique({ where: { id: otherQ.id } }))!.sortOrder).toBe(0);
    const res = await ck.call('PUT', `${base}/${profileId}/reorder`, { pw: PASSWORD, body: { questionIds: [q3, q2, q1] } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const order = await prisma.checklistQuestion.findMany({ where: { profileId }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
    expect(order.map((q) => q.id)).toEqual([q3, q2, q1]);
    const [audit] = await auditFor(profileId, 'CHECKLIST_QUESTIONS_REORDERED');
    expect(audit.beforeValue).toEqual({ name: own.n('CK'), questionOrder: [q1, q2, q3] });
    expect(audit.afterValue).toEqual({ name: own.n('CK'), questionOrder: [q3, q2, q1] });
    const missing = await sa.call('PUT', `${base}/${randomUUID()}/reorder`, { body: { questionIds: [] } });
    expect(missing.status).toBe(404);
  });

  it('delete question removes it, snapshots and audits; an unknown question is 404', async () => {
    const noPw = await ck.call('DELETE', `${base}/${profileId}/questions/${q3}`);
    expect(noPw.status).toBe(401);
    const res = await ck.call('DELETE', `${base}/${profileId}/questions/${q3}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.checklistQuestion.count({ where: { id: q3 } })).toBe(0);
    const [audit] = await auditFor(profileId, 'CHECKLIST_QUESTION_DELETED');
    expect(audit.beforeValue).toMatchObject({ name: own.n('CK'), questionId: q3, question: 'Notes', questionType: 'TEXT' });
    const again = await sa.call('DELETE', `${base}/${profileId}/questions/${q3}`);
    expect(again.status).toBe(404);
  });
});

describe('checklist-profiles — list, versions, metadata update', () => {
  it('lists with isActive filter and optional inlined questions', async () => {
    await own.checklist('CK-OFF', false);
    const all = await sa.call('GET', `${base}?limit=1000`);
    const mine = all.body.data.find((p: any) => p.id === profileId);
    expect(mine).toMatchObject({ name: own.n('CK'), questionCount: 2, isActive: true });
    expect(mine).not.toHaveProperty('questions');
    const expanded = await op.call('GET', `${base}?limit=1000&expand=questions`);
    const mineX = expanded.body.data.find((p: any) => p.id === profileId);
    expect(mineX.questions.map((q: any) => q.id)).toEqual([q2, q1]);
    const off = await sa.call('GET', `${base}?isActive=false&limit=1000`);
    expect(off.body.data.every((p: any) => p.isActive === false)).toBe(true);
    expect(off.body.data.some((p: any) => p.name === own.n('CK-OFF'))).toBe(true);
    const on = await sa.call('GET', `${base}?isActive=true&limit=1000`);
    expect(on.body.data.every((p: any) => p.isActive === true)).toBe(true);
    const paged = await sa.call('GET', `${base}?page=1&limit=1`);
    expect(paged.body).toMatchObject({ page: 1, limit: 1, totalPages: paged.body.total });
    expect(paged.body.data).toHaveLength(1);
  });

  it('versions list newest first and each version serves its frozen snapshot', async () => {
    const list = await sa.call('GET', `${base}/${profileId}/versions`);
    expect(list.status).toBe(200);
    const numbers = list.body.map((v: any) => v.versionNumber);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(numbers[numbers.length - 1]).toBe(1);
    const v2 = await sa.call('GET', `${base}/${profileId}/versions/2`);
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ profileId, versionNumber: 2, name: own.n('CK'), isActive: true, changeNotes: 'question added: Pressure (bar)' });
    expect(v2.body.questions.map((q: any) => q.question)).toEqual(['Gloves on?']);
    const missing = await sa.call('GET', `${base}/${profileId}/versions/999`);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe(`Version 999 of profile ${profileId} not found`);
  });

  it('metadata update snapshots and audits; 404 for an unknown profile', async () => {
    const noPw = await ck.call('PUT', `${base}/${profileId}`, { body: { description: 'x' } });
    expect(noPw.status).toBe(401);
    const before = (await prisma.checklistProfile.findUnique({ where: { id: profileId } }))!.version;
    const res = await ck.call('PUT', `${base}/${profileId}`, { pw: PASSWORD, body: { name: own.n('CK-renamed'), description: 'renamed' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: own.n('CK-renamed'), description: 'renamed', isActive: true, version: before + 1 });
    const [audit] = await auditFor(profileId, 'UPDATED');
    expect(audit.beforeValue).toMatchObject({ name: own.n('CK'), version: before });
    expect(audit.afterValue).toMatchObject({ name: own.n('CK-renamed'), version: before + 1 });
    const missing = await sa.call('PUT', `${base}/${randomUUID()}`, { body: { name: 'x' } });
    expect(missing.status).toBe(404);
  });

  it('cannot be disabled while a non-archived cleaning profile uses it; can once that profile is archived; re-enabling is always allowed', async () => {
    const cp = await own.cleaningProfile('CP-USES', ['WASH_IN'], sa.id, { status: 'ARCHIVED' });
    await prisma.filterCleaningProfile.update({ where: { id: cp.id }, data: { status: 'DRAFT' } });
    const stage = await prisma.filterPipelineStage.create({ data: { profileId: cp.id, nodeType: 'CHECKLIST', configuration: { checklistProfileId: profileId }, sortOrder: 9 } });
    const blocked = await sa.call('PUT', `${base}/${profileId}`, { body: { isActive: false } });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      error: 'CHECKLIST_IN_USE',
      message: `Cannot disable "${own.n('CK-renamed')}": it is used by cleaning profile "${own.n('CP-USES')}". Remove it from that profile first.`,
      details: { cleaningProfiles: [own.n('CP-USES')] },
    });
    const cp2 = await own.cleaningProfile('CP-USES2', ['WASH_IN'], sa.id, { status: 'DRAFT' });
    await prisma.filterPipelineStage.create({ data: { profileId: cp2.id, nodeType: 'CHECKLIST', configuration: { checklistProfileId: profileId }, sortOrder: 9 } });
    const plural = await sa.call('PUT', `${base}/${profileId}`, { body: { isActive: false } });
    expect(plural.body.message).toMatch(/is used by cleaning profiles ".*", ".*"\. Remove it from those profiles first\.$/);

    // The delete guard counts the same pipeline references.
    const delBlocked = await sa.call('DELETE', `${base}/${profileId}`);
    expect(delBlocked.status).toBe(409);
    expect(delBlocked.body).toMatchObject({ error: 'IN_USE', message: 'Cannot delete: checklist is referenced by 2 pipeline node(s)' });

    await prisma.filterCleaningProfile.updateMany({ where: { id: { in: [cp.id, cp2.id] } }, data: { status: 'ARCHIVED' } });
    const off = await sa.call('PUT', `${base}/${profileId}`, { body: { isActive: false } });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const on = await sa.call('PUT', `${base}/${profileId}`, { body: { isActive: true } });
    expect(on.body.isActive).toBe(true);
    await prisma.filterPipelineStage.delete({ where: { id: stage.id } });
  });
});

describe('checklist-profiles — delete', () => {
  it('refuses while a cycle has a version of it pinned', async () => {
    const cp = await own.cleaningProfile('CP-PIN', ['WASH_IN'], sa.id, { status: 'ARCHIVED' });
    const cycle = await own.cycle(filterId, cp.id, { status: 'COMPLETED', completedAt: new Date(), checklistVersionPins: { [profileId]: 2 } });
    const res = await sa.call('DELETE', `${base}/${profileId}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'IN_USE', message: "Cannot delete: 1 cleaning cycle(s) have audit history pinned to this checklist's versions" });
    expect(await prisma.checklistProfile.count({ where: { id: profileId } })).toBe(1);
    await prisma.cleaningCycle.delete({ where: { id: cycle } });
  });

  it('deletes the profile with its questions and versions, recording what was destroyed', async () => {
    const versions = await prisma.checklistProfileVersion.count({ where: { profileId } });
    const noPw = await ck.call('DELETE', `${base}/${profileId}`);
    expect(noPw.status).toBe(401);
    const res = await ck.call('DELETE', `${base}/${profileId}`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await prisma.checklistProfile.count({ where: { id: profileId } })).toBe(0);
    expect(await prisma.checklistProfileVersion.count({ where: { profileId } })).toBe(0);
    expect(await prisma.checklistQuestion.count({ where: { profileId } })).toBe(0);
    const [audit] = await auditFor(profileId, 'DELETED');
    expect(audit.beforeValue).toMatchObject({ name: own.n('CK-renamed'), questionCount: 2, archivedVersionsDestroyed: versions });
    const again = await sa.call('DELETE', `${base}/${profileId}`);
    expect(again.status).toBe(404);
  });
});
