/**
 * Regression test: a checklist question's type is validated by the route
 * schema against the database enum, so an unknown value is a 400 that names
 * the field — it never reaches Prisma (where it surfaced as a generic
 * "One or more values are not valid." and an error-level log line).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ChecklistQuestionType } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVDQ'));
let app: FastifyInstance;
let sa: { call: Caller };
let profileId: string;
let questionId: string;

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  profileId = await own.checklist('CK');
  questionId = (await prisma.checklistQuestion.create({ data: { profileId, question: 'Gloves on?' } })).id;
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('checklist question type is one of the database enum values', () => {
  it('an unknown type is refused at the schema on add and on edit, naming the field, with nothing written', async () => {
    internalErrors.length = 0;
    const versionBefore = (await prisma.checklistProfile.findUnique({ where: { id: profileId } }))!.version;
    const add = await sa.call('POST', `/api/checklist-profiles/${profileId}/questions`, { body: { question: 'q', questionType: 'NUMBER' } });
    expect(add.status).toBe(400);
    expect(add.body.error).toBe('VALIDATION_ERROR');
    expect(add.body.message).toBe('body/questionType must be equal to one of the allowed values');
    const edit = await sa.call('PUT', `/api/checklist-profiles/${profileId}/questions/${questionId}`, { body: { questionType: 'BOGUS' } });
    expect(edit.status).toBe(400);
    expect(edit.body.message).toBe('body/questionType must be equal to one of the allowed values');
    expect((await prisma.checklistProfile.findUnique({ where: { id: profileId } }))!.version).toBe(versionBefore);
    expect(await prisma.checklistQuestion.count({ where: { profileId } })).toBe(1);
    expect(internalErrors).toEqual([]);
  });

  it('every real type is accepted (the list IS the database enum)', async () => {
    for (const questionType of Object.values(ChecklistQuestionType)) {
      const res = await sa.call('POST', `/api/checklist-profiles/${profileId}/questions`, { body: { question: `q-${questionType}`, questionType } });
      expect(res.status, questionType).toBe(201);
      expect(res.body.questionType).toBe(questionType);
    }
    const edit = await sa.call('PUT', `/api/checklist-profiles/${profileId}/questions/${questionId}`, { body: { questionType: 'PASS_FAIL' } });
    expect(edit.body.questionType).toBe('PASS_FAIL');
  });
});
