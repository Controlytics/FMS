/**
 * D03-09 / rule F-42 (2026-10-22), uploads: an upload that will be REFUSED is
 * refused before the electronic signature is taken — read the file once, check
 * it, THEN sign. Before this, POST /api/backup/restore and the replacement
 * schedule upload signed first, so a missing / unreadable file cost a password
 * and left a REAUTH_SUCCESS row with nothing behind it.
 *
 * Each case sends the CORRECT password with an upload the route refuses and
 * asserts the refusal plus NO REAUTH_SUCCESS / REAUTH_FAILED row for this file's
 * own user. The replacement upload's gate is policy-driven, so it is switched on
 * for this file's role only (addReauth).
 *
 * Not covered here (still after the gate, by design): a restore whose content
 * fails to parse or verify — parsing, checksum and audit-chain checks run inside
 * backupService.restore together with the write; moving them would parse the
 * file twice. A file over the 100 MB limit (FILE_TOO_LARGE) is checked before
 * the gate but is too large to upload in a test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import replacementScheduleRoutes from '../modules/replacement-schedule/routes.js';
import { getReplacementWorkflowConfig } from '../modules/pm-schedules/pm-workflow.js';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll, type ReauthGrant,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `d0309u_sa_${SUF}`.toLowerCase();
const SA_PW = 'D0309uSa@2026x';
const UP = `d0309u_up_${SUF}`.toLowerCase();
const UP_PW = 'D0309uUp@2026x';
const UP_ROLE = `D0309U_${SUF}`;

let app: FastifyInstance;
let saToken = '';
let upToken = '';
const userIds: string[] = [];
let grants: ReauthGrant = [];

/** A multipart body: optional extra fields, then an optional `file` part. */
function multipart(file: { name: string; content: Buffer | string; type?: string } | null, fields: Record<string, string> = {}) {
  const boundary = `----d0309${SUF}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`));
    parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const post = (token: string, password: string, url: string, body?: ReturnType<typeof multipart>) => app.inject({
  method: 'POST', url,
  headers: {
    authorization: `Bearer ${token}`, 'x-reauth-password': password,
    ...(body ? { 'content-type': body.contentType } : {}),
  },
  ...(body ? { payload: body.payload } : {}),
});
const signatures = (username: string, since: Date) => prisma.auditTrail.count({
  where: { userId: username, timestamp: { gte: since }, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } },
});

beforeAll(async () => {
  app = await buildApp([{ prefix: '/api/replacement-schedules', plugin: replacementScheduleRoutes }]);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', SA_PW));
  await createRole(UP_ROLE, ['REPLACEMENT_SCHEDULE_UPLOAD', 'REPLACEMENT_SCHEDULE_VIEW']);
  userIds.push(await createUser(UP, UP_ROLE, UP_PW));
  grants = await addReauth([['UPLOAD_REPLACEMENT_SCHEDULE', UP_ROLE]]);
  saToken = await login(app, SA, SA_PW);
  upToken = await login(app, UP, UP_PW);
});

afterAll(async () => {
  await cleanupAll([
    ['reauth', () => removeReauth(grants)],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([UP_ROLE])],
    ['app', () => app?.close()],
  ]);
});

describe('D03-09: POST /api/backup/restore (RESTORE_BACKUP, always-on) refuses a bad upload before signing', () => {
  it('no multipart body at all: a 4xx and no signature', async () => {
    const since = new Date();
    const res = await post(saToken, SA_PW, '/api/backup/restore');
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(res.statusCode, res.body).toBeLessThan(500);
    expect(await signatures(SA, since)).toBe(0);
  });

  it('a multipart body with no file part: 400 NO_FILE and no signature', async () => {
    const since = new Date();
    const res = await post(saToken, SA_PW, '/api/backup/restore', multipart(null, { force: 'false' }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toBe('NO_FILE');
    expect(await signatures(SA, since)).toBe(0);
  });
});

describe('D03-09: POST /api/replacement-schedules (UPLOAD_REPLACEMENT_SCHEDULE on the policy) refuses a bad upload before signing', () => {
  it('no file: 400 and no signature', async () => {
    const since = new Date();
    const res = await post(upToken, UP_PW, '/api/replacement-schedules', multipart(null, { note: 'x' }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
    expect(await signatures(UP, since)).toBe(0);
  });

  it('a file that is not a spreadsheet: refused and no signature, nothing created', async () => {
    const wf = await getReplacementWorkflowConfig();
    const allowed = ([] as string[]).concat(wf.uploadRole ?? []).filter(Boolean);
    const since = new Date();
    const before = await prisma.replacementSchedule.count();
    const res = await post(upToken, UP_PW, '/api/replacement-schedules', multipart({ name: 'schedule.xlsx', content: 'this is not an xlsx file' }));
    if (allowed.length && !allowed.includes(UP_ROLE)) {
      // The configured upload role excludes this role: refused for that, before signing.
      expect(res.statusCode, res.body).toBe(403);
    } else {
      // The content check (the dry-run of the same processUpload) refuses the file.
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ success: false, created: 0 });
      expect(res.json().failed).toBeGreaterThan(0);
    }
    expect(await signatures(UP, since)).toBe(0);
    expect(await prisma.replacementSchedule.count()).toBe(before);
  });
});
