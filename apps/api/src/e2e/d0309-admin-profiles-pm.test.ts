/**
 * D03-09 / rule F-42 (2026-10-22), second sweep: admin-request decisions, the
 * profile modules (cleaning / checklist / filter profiles, equipment groups) and
 * the PM-schedule writes refuse a request that will be REFUSED before the
 * electronic signature is taken — no password spent, no REAUTH_* row.
 *
 * Every case sends the CORRECT password and a request the route refuses, and
 * asserts the refusal code and NO REAUTH_SUCCESS / REAUTH_FAILED row for this
 * file's own user. The policy-driven gates are switched on for this file's own
 * role only (addReauth), so before the fix the gate verified the password (and
 * wrote REAUTH_SUCCESS) before the refusal. PM review / approve / reject are
 * covered by D03-13, not here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import adminRequestRoutes from '../modules/admin-requests/routes.js';
import cleaningProfileRoutes from '../modules/cleaning-profiles/routes.js';
import checklistProfileRoutes from '../modules/checklist-profiles/routes.js';
import filterProfileRoutes from '../modules/filter-profiles/routes.js';
import equipmentGroupRoutes from '../modules/equipment-groups/routes.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import pmExecutionRoutes from '../modules/pm-schedules/execution-routes.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll, type ReauthGrant,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `d0309b_sa_${SUF}`.toLowerCase();
const SA_PW = 'D0309bSa@2026x';
const MGR = `d0309b_mg_${SUF}`.toLowerCase();
const MGR_PW = 'D0309bMg@2026x';
const MGR_ROLE = `D0309B_${SUF}`;
const NONE = () => randomUUID();

let app: FastifyInstance;
let saToken = '';
let mgrToken = '';
const userIds: string[] = [];
const adminRequestIds: string[] = [];
let grants: ReauthGrant = [];

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const send = (token: string, password: string, method: Method, url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-reauth-password': password }, ...(payload ? { payload } : {}) });
const signatures = (username: string, since: Date) => prisma.auditTrail.count({
  where: { userId: username, timestamp: { gte: since }, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } },
});

/** A multipart upload with one file field (the password rides in the header). */
function multipart(filename: string, content: string) {
  const boundary = `----d0309${SUF}`;
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const INSTRUMENTS = [1, 2, 3].map((i) => ({
  instrumentId: `I${i}`, uom: 'bar', instrumentMin: 0, instrumentMax: 10, operatingMin: 1, operatingMax: 9, leastCount: 0.1,
}));

beforeAll(async () => {
  app = await buildApp([
    { prefix: '/api/admin-requests', plugin: adminRequestRoutes },
    { prefix: '/api/filter-cleaning-profiles', plugin: cleaningProfileRoutes },
    { prefix: '/api/checklist-profiles', plugin: checklistProfileRoutes },
    { prefix: '/api/filter-profiles', plugin: filterProfileRoutes },
    { prefix: '/api/equipment-groups', plugin: equipmentGroupRoutes },
    { prefix: '/api/pm-schedules', plugin: pmScheduleRoutes },
    { prefix: '/api/pm-executions', plugin: pmExecutionRoutes },
  ]);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', SA_PW));
  await createRole(MGR_ROLE, [
    'ADMIN_REQUEST_APPROVE', 'USER_READ',
    'CP_PAGE_CREATE', 'CP_PAGE_EDIT', 'CP_PAGE_DELETE', 'FCP_READ',
    'CHECKLIST_CREATE', 'CHECKLIST_EDIT', 'CHECKLIST_DELETE',
    'FP_CREATE', 'FP_UPDATE', 'FP_DELETE', 'FP_ASSIGN', 'FP_READ',
    'EG_CREATE', 'EG_EDIT', 'EG_DELETE', 'EG_VIEW',
    'PM_READ', 'PM_CREATE', 'PM_UPDATE', 'PM_UPLOAD', 'PM_RESUBMIT', 'PM_EDIT_ENTRY', 'PM_EXECUTE',
  ]);
  await prisma.role.update({ where: { name: MGR_ROLE }, data: { hierarchyLevel: 5 } });
  userIds.push(await createUser(MGR, MGR_ROLE, MGR_PW));
  // Policy-driven gates: switched on for THIS file's role only.
  grants = await addReauth([
    'APPROVE_ADMIN_REQUEST',
    'CREATE_CLEANING_PROFILE', 'UPDATE_CLEANING_PROFILE', 'DELETE_CLEANING_PROFILE',
    'CREATE_CHECKLIST_PROFILE', 'UPDATE_CHECKLIST_PROFILE', 'DELETE_CHECKLIST_PROFILE',
    'CREATE_FILTER_PROFILE', 'UPDATE_FILTER_PROFILE', 'DELETE_FILTER_PROFILE', 'ASSIGN_FILTER_PROFILE',
    'CREATE_EQUIPMENT_GROUP', 'UPDATE_EQUIPMENT_GROUP', 'DELETE_EQUIPMENT_GROUP',
    'CREATE_PM_SCHEDULE', 'UPDATE_PM_SCHEDULE', 'RESUBMIT_PM_ENTRY', 'EDIT_PM_SCHEDULE', 'UPDATE_CONFIG_PAGE',
    'UPLOAD_PM_SCHEDULES', 'START_PM_TASK',
  ].map((a) => [a, MGR_ROLE] as [string, string]));
  saToken = await login(app, SA, SA_PW);
  mgrToken = await login(app, MGR, MGR_PW);
});

afterAll(async () => {
  await cleanupAll([
    ['reauth', () => removeReauth(grants)],
    ['admin requests', () => prisma.adminRequest.deleteMany({ where: { id: { in: adminRequestIds } } })],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([MGR_ROLE])],
    ['app', () => app?.close()],
  ]);
});

/** Send as the manager (policy row on) with the right password; expect `code` and no signature. */
async function refusedUnsigned(code: number, method: Method, url: string, payload?: Record<string, unknown>, as: 'mgr' | 'sa' = 'mgr') {
  const [token, pw, user] = as === 'sa' ? [saToken, SA_PW, SA] : [mgrToken, MGR_PW, MGR];
  const since = new Date();
  const res = await send(token, pw, method, url, payload);
  expect(res.statusCode, res.body).toBe(code);
  expect(await signatures(user, since)).toBe(0);
  return res;
}

describe('D03-09: admin-request decisions refuse before the signature', () => {
  it('approving an unknown request is 404 and signs nothing', async () => {
    await refusedUnsigned(404, 'POST', `/api/admin-requests/${NONE()}/process`, { action: 'approve', adminRemarks: 'D03-09 test' });
  });

  it('approving a MODIFY_USER request for a field that cannot be modified is 400 and signs nothing (read from the STORED request)', async () => {
    const r = await prisma.adminRequest.create({
      data: { requestType: 'MODIFY_USER', requesterName: 'D03-09', requestData: { username: SA, modifyField: 'passwordHash', newValue: 'x' } },
    });
    adminRequestIds.push(r.id);
    const res = await refusedUnsigned(400, 'POST', `/api/admin-requests/${r.id}/process`, { action: 'approve', adminRemarks: 'D03-09 test' });
    expect(res.json().message).toMatch(/cannot be modified/);
    expect((await prisma.adminRequest.findUnique({ where: { id: r.id } }))?.status).toBe('PENDING');
  });

  it('approving a MODIFY_USER request for an unknown user is 404 and signs nothing', async () => {
    const r = await prisma.adminRequest.create({
      data: { requestType: 'MODIFY_USER', requesterName: 'D03-09', requestData: { username: `nobody_${SUF}`, modifyField: 'fullName', newValue: 'X' } },
    });
    adminRequestIds.push(r.id);
    await refusedUnsigned(404, 'POST', `/api/admin-requests/${r.id}/process`, { action: 'approve', adminRemarks: 'D03-09 test' });
  });
});

describe('D03-09: profile modules refuse before the signature', () => {
  it('cleaning profile: an invalid pipeline (two START nodes) is 400', async () => {
    await refusedUnsigned(400, 'POST', '/api/filter-cleaning-profiles', { name: `D0309 ${SUF}`, stages: [{ nodeType: 'START' }, { nodeType: 'START' }], connections: [] });
  });
  it('cleaning profile: update / toggle / archive of an unknown profile are 404', async () => {
    await refusedUnsigned(404, 'PUT', `/api/filter-cleaning-profiles/${NONE()}`, { name: 'x' });
    await refusedUnsigned(404, 'PATCH', `/api/filter-cleaning-profiles/${NONE()}/toggle-status`, {});
    await refusedUnsigned(404, 'DELETE', `/api/filter-cleaning-profiles/${NONE()}`);
  });

  it('checklist profile: update / delete / question writes / reorder on an unknown profile are 404', async () => {
    await refusedUnsigned(404, 'PUT', `/api/checklist-profiles/${NONE()}`, { name: 'x' });
    await refusedUnsigned(404, 'DELETE', `/api/checklist-profiles/${NONE()}`);
    await refusedUnsigned(404, 'POST', `/api/checklist-profiles/${NONE()}/questions`, { question: 'Q?' });
    await refusedUnsigned(404, 'PUT', `/api/checklist-profiles/${NONE()}/questions/${NONE()}`, { question: 'Q?' });
    await refusedUnsigned(404, 'DELETE', `/api/checklist-profiles/${NONE()}/questions/${NONE()}`);
    await refusedUnsigned(404, 'PUT', `/api/checklist-profiles/${NONE()}/reorder`, { questionIds: [] });
  });

  it('filter profile: an unknown cleaning profile is 400; update / delete / assign on an unknown profile are 404', async () => {
    await refusedUnsigned(400, 'POST', '/api/filter-profiles', { name: `D0309 ${SUF}`, cleaningProfileId: NONE() });
    await refusedUnsigned(404, 'PUT', `/api/filter-profiles/${NONE()}`, { name: 'x' });
    await refusedUnsigned(404, 'DELETE', `/api/filter-profiles/${NONE()}`);
    await refusedUnsigned(404, 'POST', `/api/filter-profiles/${NONE()}/assign`, { filterInstanceIds: [NONE()] });
  });

  it('equipment group: an unknown block is 404; update / delete of an unknown group are 404', async () => {
    await refusedUnsigned(404, 'POST', '/api/equipment-groups', { name: `D0309 ${SUF}`, blockId: NONE(), instruments: INSTRUMENTS });
    await refusedUnsigned(404, 'PUT', `/api/equipment-groups/${NONE()}`, { instruments: INSTRUMENTS });
    await refusedUnsigned(404, 'DELETE', `/api/equipment-groups/${NONE()}`);
  });
});

describe('D03-09: PM-schedule writes refuse before the signature', () => {
  it('create / add a visit for an unknown AHU are 404 (AHU not found, or PM disabled)', async () => {
    await refusedUnsigned(404, 'POST', '/api/pm-schedules', { entityId: NONE(), year: 2027, entries: [{ month: 1, plannedDate: '2027-01-10' }] });
    await refusedUnsigned(404, 'POST', '/api/pm-schedules/visits', { entityId: NONE(), plannedDate: '2027-01-10' });
  });
  it('update an unknown schedule / resubmit or edit an unknown entry / AHU config of an unknown AHU are 404', async () => {
    await refusedUnsigned(404, 'PUT', `/api/pm-schedules/${NONE()}`, { entries: [{ month: 1, plannedDate: '2027-01-10' }] });
    await refusedUnsigned(404, 'POST', `/api/pm-schedules/entries/${NONE()}/resubmit`, { plannedDate: '2027-01-10' });
    await refusedUnsigned(404, 'PUT', `/api/pm-schedules/entries/${NONE()}/edit`, { plannedDate: '2027-01-10' });
    await refusedUnsigned(404, 'PUT', `/api/pm-schedules/ahu-configs/${NONE()}`, { mode: 'BOTH' });
  });
  it('starting a PM task on an unknown entry is 404', async () => {
    await refusedUnsigned(404, 'POST', '/api/pm-executions', { scheduleEntryId: NONE(), entityId: NONE() });
  });
  it('delete (SUPER_ADMIN) of an unknown schedule is 404; acknowledging an unknown deviation (always-on) is 404', async () => {
    await refusedUnsigned(404, 'DELETE', `/api/pm-schedules/${NONE()}`, undefined, 'sa');
    await refusedUnsigned(404, 'POST', `/api/pm-schedules/deviations/${NONE()}/acknowledge`, undefined, 'sa');
  });
  it('an upload of a file that is not .csv / .xlsx is 400 and signs nothing (the file is checked before the gate)', async () => {
    const mp = multipart('schedule.txt', 'not a schedule');
    const since = new Date();
    const res = await app.inject({
      method: 'POST', url: '/api/pm-schedules/upload',
      headers: { authorization: `Bearer ${mgrToken}`, 'x-reauth-password': MGR_PW, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toBe('INVALID_FILE_TYPE');
    expect(await signatures(MGR, since)).toBe(0);
  });
});
