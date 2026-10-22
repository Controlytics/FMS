/**
 * /api/audit — a REFUSED electronic signature stops every write (coverage,
 * 2026-10-21).
 *
 * redact / bulk-redact / PUT are SUPER_ADMIN-only, so their re-auth gate can
 * only be made to refuse by enabling re-auth for the shared SUPER_ADMIN role —
 * which would gate every concurrent suite's SUPER_ADMIN. Instead the gate is
 * replaced at its module boundary (lib/reauth-check `enforceReauth`) by one that
 * refuses exactly as the real one does when no password is sent (401
 * REAUTH_REQUIRED + `{ ok: false }`). The real gate is covered in
 * audit-routes.coverage.test.ts on this suite's own role.
 *
 * Asserted for each of the six gated audit routes: the 401 reaches the client,
 * the target row is untouched, and no meta-audit row was written.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../../lib/reauth-check.js', async (orig) => {
  const real = await orig<typeof import('../../../lib/reauth-check.js')>();
  return {
    ...real,
    enforceReauth: async (action: string | string[], _req: unknown, reply: any) => {
      reply.code(401).send({ error: 'REAUTH_REQUIRED', message: 'This action requires password re-authentication.', action: Array.isArray(action) ? action[0] : action });
      return { ok: false };
    },
  };
});

import { type FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { buildApp, authPost, authPut, authDelete, internalErrors } from '../../../e2e/test-helper.js';
import { cleanupAll, runSuffix, createUser, deleteUsers, login } from '../../../e2e/support/owned-fixtures.js';

const SFX = runSuffix();
const PW = 'Cvp@Refuse123';
const MARK = `cvp_rr_mark_${SFX}`.toLowerCase();

let app: FastifyInstance;
let token: string;
let sa: { id: string; username: string };
let rowId: string;

beforeAll(async () => {
  sa = { id: '', username: `cvp_rr_sa_${SFX}`.toLowerCase() };
  sa.id = await createUser(sa.username, 'SUPER_ADMIN', PW);
  app = await buildApp();
  token = await login(app, sa.username, PW);
  rowId = await auditLog({ userId: MARK, userRole: 'OPERATOR', action: 'CVP_FIXTURE_REFUSAL', targetType: 'thing', afterValue: { keep: true } });
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['close app', async () => { await app?.close(); }],
    ['users', () => deleteUsers([sa?.id])],
  ]);
}, 60_000);

const metaBy = (action: string) => prisma.auditTrail.count({ where: { action, userId: sa.username } });

describe.each([
  ['redact', 'REDACT_AUDIT_RECORD', 'AUDIT_RECORD_REDACTED', () => authPost(app, `/api/audit/${rowId}/redact`, token, { reason: 'refused redaction' })],
  ['bulk-redact', 'BULK_REDACT_AUDIT_RECORDS', 'AUDIT_RECORDS_BULK_REDACTED', () => authPost(app, '/api/audit/bulk-redact', token, { ids: [rowId], reason: 'refused bulk redaction' })],
  ['edit', 'UPDATE_AUDIT_RECORD', 'AUDIT_RECORD_UPDATED', () => authPut(app, `/api/audit/${rowId}`, token, { reason: 'refused edit', action: 'CHANGED' })],
  ['delete', 'DELETE_AUDIT_RECORD', 'AUDIT_RECORD_DELETED', () => authDelete(app, `/api/audit/${rowId}`, token, undefined, { reason: 'refused deletion' })],
  ['bulk-delete', 'BULK_DELETE_AUDIT_RECORDS', 'AUDIT_RECORDS_BULK_DELETED', () => authPost(app, '/api/audit/bulk-delete', token, { ids: [rowId], reason: 'refused bulk deletion' })],
  ['report-export-log', 'EXPORT_AUDIT_TRAIL', 'REPORT_GENERATED', () => authPost(app, '/api/audit/report-export-log', token, { reportType: 'Audit Trail', format: 'PDF', recordCount: 1 })],
] as const)('%s with the signature refused', (_name, gateAction, metaAction, send) => {
  it(`answers 401 REAUTH_REQUIRED (${gateAction}) and writes nothing`, async () => {
    internalErrors.length = 0;
    const before = await prisma.auditTrail.findUniqueOrThrow({ where: { id: rowId } });
    const metaBefore = await metaBy(metaAction);
    const res = await send();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: gateAction });
    const after = await prisma.auditTrail.findUnique({ where: { id: rowId } });
    expect(after).toEqual(before);
    expect(await metaBy(metaAction)).toBe(metaBefore);
    expect(internalErrors).toEqual([]);
  });
});
