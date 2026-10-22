/**
 * D03-09 / rule F-42 (2026-10-22), audit trail writes: an edit, redaction or
 * deletion the route will refuse is refused BEFORE the electronic signature, so
 * it costs no password and leaves no REAUTH_SUCCESS / REAUTH_FAILED row.
 * Every case sends the CORRECT password.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { runSuffix, createUser, login, deleteUsers, cleanupAll } from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `d0309_au_${SUF}`.toLowerCase();
const SA_PW = 'D0309Au@2026x';
const MARK = `d0309_mark_${SUF}`.toLowerCase();
const REASON = 'D03-09 audit probe';

let app: FastifyInstance;
let token = '';
const userIds: string[] = [];

const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-reauth-password': SA_PW }, ...(payload ? { payload } : {}) });
const signatures = (since: Date) => prisma.auditTrail.count({
  where: { userId: SA, timestamp: { gte: since }, action: { in: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } },
});
const row = (action = 'CONFIG_CHANGED') => auditLog({ userId: MARK, userRole: 'OPERATOR', action, targetType: 'd0309', afterValue: { probe: true } });

beforeAll(async () => {
  app = await buildApp();
  userIds.push(await createUser(SA, 'SUPER_ADMIN', SA_PW));
  token = await login(app, SA, SA_PW);
});

afterAll(async () => {
  await cleanupAll([
    ['users', () => deleteUsers(userIds)],
    ['app', () => app?.close()],
  ]);
});

async function refusedUnsigned(call: () => Promise<{ statusCode: number; body: string }>, status: number) {
  const since = new Date();
  const res = await call();
  expect(res.statusCode, res.body).toBe(status);
  expect(await signatures(since)).toBe(0);
}

describe('D03-09: audit edit / redact / delete refuse BEFORE the signature', () => {
  it('PUT /api/audit/:id: unknown id 404, meta row 409, bad timestamp 400, nothing to change 400 — none signed', async () => {
    const meta = await row('AUDIT_RECORD_UPDATED');
    const plain = await row();
    await refusedUnsigned(() => send('PUT', `/api/audit/${randomUUID()}`, { reason: REASON, action: 'X' }), 404);
    await refusedUnsigned(() => send('PUT', `/api/audit/${meta}`, { reason: REASON, action: 'X' }), 409);
    await refusedUnsigned(() => send('PUT', `/api/audit/${plain}`, { reason: REASON, timestamp: 'not a date' }), 400);
    await refusedUnsigned(() => send('PUT', `/api/audit/${plain}`, { reason: REASON }), 400);
  });

  it('POST /api/audit/:id/redact: unknown id 404, meta row 409, already redacted 409 — none signed', async () => {
    const meta = await row('AUDIT_RECORD_DELETED');
    const once = await row();
    const first = await send('POST', `/api/audit/${once}/redact`, { reason: REASON });
    expect(first.statusCode, first.body).toBe(200);
    await refusedUnsigned(() => send('POST', `/api/audit/${randomUUID()}/redact`, { reason: REASON }), 404);
    await refusedUnsigned(() => send('POST', `/api/audit/${meta}/redact`, { reason: REASON }), 409);
    await refusedUnsigned(() => send('POST', `/api/audit/${once}/redact`, { reason: REASON }), 409);
  });

  it('POST /api/audit/bulk-redact: a selection with a meta row, or nothing left to redact, is 409 — none signed', async () => {
    const meta = await row('AUDIT_RECORD_REDACTED');
    const plain = await row();
    await refusedUnsigned(() => send('POST', '/api/audit/bulk-redact', { ids: [plain, meta], reason: REASON }), 409);
    await refusedUnsigned(() => send('POST', '/api/audit/bulk-redact', { ids: [randomUUID()], reason: REASON }), 409);
  });

  it('DELETE /api/audit/:id and POST /api/audit/bulk-delete: nothing to delete is 404 — none signed', async () => {
    await refusedUnsigned(() => send('DELETE', `/api/audit/${randomUUID()}`, { reason: REASON }), 404);
    await refusedUnsigned(() => send('POST', '/api/audit/bulk-delete', { ids: [randomUUID()], reason: REASON }), 404);
  });

  it('a valid edit is still signed once', async () => {
    const plain = await row();
    const since = new Date();
    const res = await send('PUT', `/api/audit/${plain}`, { reason: REASON, signatureMeaning: 'edited by the D03-09 test' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await prisma.auditTrail.count({ where: { userId: SA, timestamp: { gte: since }, action: 'REAUTH_SUCCESS' } })).toBe(1);
  });
});
