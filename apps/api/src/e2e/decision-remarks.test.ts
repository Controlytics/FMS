/**
 * D03-13 (functional test, 2026-10-22): "approval / decision flows require
 * remarks" (CLAUDE.md). PM schedule review / approve, Replacement Schedule
 * review / approve and the cleaning-stage approve took NO remarks, and a blank
 * reject-at-review was refused only AFTER the signature. Every decision on these
 * routes now needs remarks (at least 3 characters once trimmed), checked before
 * the re-auth gate: 400 VALIDATION, and no signature is spent.
 *
 * The guard runs before the service, so no entries or approvals are needed: a
 * decision WITH remarks reaching the re-auth gate (401 REAUTH_REQUIRED) is the
 * proof the guard lets it through. Owns every user and role it touches (`drm`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, authPost } from './test-helper.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import replacementRoutes from '../modules/replacement-schedule/routes.js';
import stageApprovalRoutes from '../modules/stage-approvals/routes.js';
import { prisma } from '../lib/prisma.js';
import { DECISION_REMARKS_MESSAGE } from '../lib/decision-remarks.js';
import {
  cleanupAll, runSuffix, createUser, createRole, login, deleteUsers, deleteRoles, addReauth, removeReauth, type ReauthGrant,
} from './support/owned-fixtures.js';

const S = runSuffix();
const USER = `drm_u_${S}`.toLowerCase();
const ROLE = `DRM_R_${S}`;
const PW = 'DrmUser@2026x';

let app: FastifyInstance;
let tok = '';
let userId = '';
let reauthAdded: ReauthGrant = [];

const REFUSED = { error: 'VALIDATION', message: DECISION_REMARKS_MESSAGE };
const id = randomUUID();

// [label, url, body WITHOUT usable remarks, the same body WITH remarks]
const DECISIONS: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
  ['PM review (approve)', '/api/pm-schedules/entries/review', { entryIds: [id], action: 'approve' }, { entryIds: [id], action: 'approve', remarks: 'dates checked' }],
  ['PM review (reject)', '/api/pm-schedules/entries/review', { entryIds: [id], action: 'reject', remarks: '   ' }, { entryIds: [id], action: 'reject', remarks: 'wrong month' }],
  ['PM approve', '/api/pm-schedules/entries/approve', { entryIds: [id], comment: ' ok ' }, { entryIds: [id], comment: 'approved for Q4' }],
  ['PM reject', '/api/pm-schedules/entries/reject', { entryIds: [id], remarks: '    ' }, { entryIds: [id], remarks: 'duplicate visit' }],
  ['Replacement review (approve)', '/api/replacement-schedules/entries/review', { entryIds: [id], action: 'approve', remarks: '' }, { entryIds: [id], action: 'approve', remarks: 'sizes checked' }],
  ['Replacement review (reject)', '/api/replacement-schedules/entries/review', { entryIds: [id], action: 'reject' }, { entryIds: [id], action: 'reject', remarks: 'qty wrong' }],
  ['Replacement approve', '/api/replacement-schedules/entries/approve', { entryIds: [id] }, { entryIds: [id], comment: 'released' }],
  ['Replacement reject', '/api/replacement-schedules/entries/reject', { entryIds: [id], remarks: '\t\t\t' }, { entryIds: [id], remarks: 'not needed' }],
  ['Stage approve', `/api/stage-approvals/${id}/approve`, {}, { remarks: 'looks clean' }],
  ['Stage bulk approve', '/api/stage-approvals/bulk-decide', { ids: [id], action: 'approve', remarks: 'ok' }, { ids: [id], action: 'approve', remarks: 'looks clean' }],
];

describe('every PM / Replacement Schedule / stage decision needs remarks, before the signature', () => {
  beforeAll(async () => {
    await createRole(ROLE, ['PM_REVIEW', 'PM_APPROVE', 'REPLACEMENT_SCHEDULE_REVIEW', 'REPLACEMENT_SCHEDULE_APPROVE', 'STAGE_APPROVAL_DECIDE']);
    userId = await createUser(USER, ROLE, PW);
    reauthAdded = await addReauth([
      'REVIEW_PM_SCHEDULE', 'APPROVE_PM_SCHEDULE', 'REJECT_PM_SCHEDULE',
      'REVIEW_REPLACEMENT_SCHEDULE', 'APPROVE_REPLACEMENT_SCHEDULE', 'REJECT_REPLACEMENT_SCHEDULE',
    ].map((a) => [a, ROLE] as [string, string]));
    app = await buildApp([
      { plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' },
      { plugin: replacementRoutes, prefix: '/api/replacement-schedules' },
      { plugin: stageApprovalRoutes, prefix: '/api/stage-approvals' },
    ]);
    tok = await login(app, USER, PW);
  }, 60_000);

  afterAll(async () => {
    await cleanupAll([
      ['reauth', () => removeReauth(reauthAdded)],
      ['user configs', () => prisma.userConfig.deleteMany({ where: { userId } })],
      ['users', () => deleteUsers([userId])],
      ['roles', () => deleteRoles([ROLE])],
      ['app', async () => { await app?.close(); }],
    ]);
  }, 60_000);

  it.each(DECISIONS)('%s: missing or blank remarks are refused with 400 VALIDATION before the re-auth gate', async (_l, url, blank) => {
    const res = await authPost(app, url, tok, blank);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject(REFUSED);
  });

  it.each(DECISIONS)('%s: with remarks the request reaches the re-auth gate', async (_l, url, _blank, withRemarks) => {
    const res = await authPost(app, url, tok, withRemarks);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('REAUTH_REQUIRED');
  });

  it('a blank decision sent WITH the password is refused and spends no signature', async () => {
    const before = await prisma.auditTrail.count({ where: { userId: USER, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } });
    for (const [, url, blank] of DECISIONS) {
      const res = await authPost(app, url, tok, blank, PW);
      expect(res.statusCode, url).toBe(400);
    }
    const after = await prisma.auditTrail.count({ where: { userId: USER, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } } });
    expect(after).toBe(before);
  });
});
