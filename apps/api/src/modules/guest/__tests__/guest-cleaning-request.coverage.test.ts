/**
 * Guest filter-cleaning request — POST /api/guest/cleaning-request (public).
 *
 * Real route on the production error handler (e2e/test-helper.ts), mounted at
 * the app.ts prefix so the auth plugin's public-path allowlist is exercised for
 * real. Asserts what the guest and the plant observe: the status, the
 * GUEST_CLEANING_REQUEST notification it drops, and the §11 audit row (actor =
 * the guest's self-declared name + employee id, role GUEST, chained).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import guestRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { cleanupAll, runSuffix } from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const EMP = `cvoEMP${S}`;
let app: FastifyInstance;

const post = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/guest/cleaning-request', payload, headers });

const valid = () => ({ name: 'Ravi Kumar', employeeId: EMP, block: 'Block A', area: 'Area 1', ahu: 'AHU-07', filter: `F-${S}` });

beforeAll(async () => {
  app = await buildApp([{ plugin: guestRoutes, prefix: '/api/guest' }]);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['notifications', () => prisma.notification.deleteMany({ where: { type: 'GUEST_CLEANING_REQUEST', title: { contains: EMP } } })],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('POST /api/guest/cleaning-request', () => {
  it('is reachable without a token and records notification + chained audit row', async () => {
    const res = await post(valid(), { 'user-agent': 'cvo-guest-kiosk' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const n = await prisma.notification.findFirst({ where: { type: 'GUEST_CLEANING_REQUEST', title: { contains: EMP } } });
    expect(n).toBeTruthy();
    expect(n!.title).toBe(`Filter Cleaning Request from Ravi Kumar (${EMP})`);
    expect(n!.message).toBe(`Block: Block A\nArea: Area 1\nAHU: AHU-07\nFilter: F-${S}`);
    expect(n!.metadata).toMatchObject({ name: 'Ravi Kumar', employeeId: EMP, filter: `F-${S}`, source: 'guest' });
    // Visibility is gated by recipient-role config, not a fixed role on the row.
    expect(n!.forRole).toBeNull();

    const row = await prisma.auditTrail.findFirst({
      where: { action: 'GUEST_CLEANING_REQUEST_SUBMITTED', userId: `Ravi Kumar (${EMP})` }, orderBy: { chainPosition: 'desc' },
    });
    expect(row).toBeTruthy();
    expect(row!.userRole).toBe('GUEST');
    expect(row!.userName).toBe('Ravi Kumar');
    expect(row!.targetType).toBe('guest_cleaning_request');
    expect(row!.userAgent).toBe('cvo-guest-kiosk');
    // The person is `guestName`, never `name` — `name` would render as the filter.
    expect(row!.afterValue).toEqual({
      guestName: 'Ravi Kumar', employeeId: EMP, block: 'Block A', area: 'Area 1', ahu: 'AHU-07', filter: `F-${S}`, filterName: `F-${S}`,
    });
    expect(row!.reason).toBe(`Guest filter cleaning request — Block A / Area 1 / AHU-07 / F-${S}`);
    const prev = await prisma.auditTrail.findFirst({ where: { chainPosition: { lt: row!.chainPosition! } }, orderBy: { chainPosition: 'desc' } });
    expect(row!.previousChecksum).toBe(prev!.checksum);
  });

  it('neutralises HTML in every field before it is stored (escaped, never raw markup)', async () => {
    const res = await post({ ...valid(), name: '<b>Asha</b>', filter: `<script>x</script>F2-${S}` });
    expect(res.statusCode).toBe(200);
    const n = await prisma.notification.findFirst({ where: { type: 'GUEST_CLEANING_REQUEST', title: { contains: `Asha` }, AND: { title: { contains: EMP } } } });
    expect(n).toBeTruthy();
    expect(n!.title).not.toContain('<b>');
    expect(n!.title).toContain('&lt;b&gt;Asha&lt;/b&gt;');
    expect((n!.metadata as any).filter).not.toContain('<script>');
    expect((n!.metadata as any).filter).toContain(`F2-${S}`);
  });

  it('refuses a field that is blank once trimmed (400 VALIDATION), and writes nothing', async () => {
    const before = await prisma.notification.count({ where: { type: 'GUEST_CLEANING_REQUEST', title: { contains: EMP } } });
    const res = await post({ ...valid(), area: '    ' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'VALIDATION', message: 'All fields are required.' });
    expect(await prisma.notification.count({ where: { type: 'GUEST_CLEANING_REQUEST', title: { contains: EMP } } })).toBe(before);
    expect(internalErrors).toEqual([]);
  });

  it('a missing required field is a schema validation error', async () => {
    const { filter: _f, ...rest } = valid();
    const res = await post(rest);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
  });

  it('an over-long field is refused by the schema', async () => {
    const res = await post({ ...valid(), employeeId: 'x'.repeat(61) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('unknown keys never reach the stored record', async () => {
    const res = await post({ ...valid(), name: 'Meena', isAdmin: true, forRole: 'SUPER_ADMIN' });
    expect(res.statusCode).toBe(200);
    const n = await prisma.notification.findFirst({ where: { type: 'GUEST_CLEANING_REQUEST', title: { contains: `Meena (${EMP})` } } });
    expect(n!.forRole).toBeNull();
    expect(n!.metadata).not.toHaveProperty('isAdmin');
  });

  it('the public allowlist exposes no other verb: GET on the path has no route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/guest/cleaning-request' });
    expect(res.statusCode).toBe(404);
  });

  it('a sibling path is NOT public (segment-boundary match)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/guest/cleaning-request-x', payload: valid() });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHORIZED');
  });
});
