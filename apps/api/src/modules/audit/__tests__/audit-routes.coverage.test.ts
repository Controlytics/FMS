/**
 * /api/audit — every route through the real harness on digilog_test_db
 * (coverage, 2026-10-21).
 *
 * Fixture audit rows are written with auditLog() under a unique principal
 * (MARK) so every read can be scoped to this file's rows (`userId=MARK`) while
 * other suites keep writing to the same table. Redact / edit / hard-delete only
 * ever target rows this file wrote. Each meta-audit row the routes write is
 * checked for its content AND its chain link (previousChecksum equals the
 * checksum of the row at chain_position - 1). The whole chain is never asserted
 * valid: other suites hard-delete rows on purpose.
 *
 * Re-auth is exercised for real on this file's OWN role (addReauth/removeReauth
 * merges). The SUPER_ADMIN-only gates' refusal path is in
 * audit-reauth-refusal.coverage.test.ts (gate mocked), because enabling re-auth
 * for the shared SUPER_ADMIN role would gate every concurrent suite.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { buildApp, authGet, authPost, authPut, authDelete, internalErrors } from '../../../e2e/test-helper.js';
import {
  cleanupAll, runSuffix, createRole, createUser, deleteUsers, deleteRoles, login,
  addReauth, removeReauth, type ReauthGrant,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy, createCleaningProfile,
} from '../../../e2e/support/owned-fixtures.js';

const SFX = runSuffix();
const PW = 'Cvp@Audit123';
const MARK = `cvp_ad_mark_${SFX}`.toLowerCase();         // principal of every fixture row
const R_READER = `CVPAR${SFX}`.slice(0, 20);                // AUDIT_READ + AUDIT_DELETE + AUDIT_EXPORT
const R_NONE = `CVPA0${SFX}`.slice(0, 20);                  // nothing

let app: FastifyInstance;
let saTok: string; let saUser: { id: string; username: string };
let sa2Tok: string; let sa2User: { id: string; username: string };
let rdTok: string; let rdUser: { id: string; username: string };
let noneTok: string;
const userIds: string[] = [];
let reauthAdded: ReauthGrant = [];

let hier: Awaited<ReturnType<typeof createHierarchy>> | undefined;
const filterIds: string[] = [];
let profileId: string | undefined;
let cycleId: string | undefined;
let pmScheduleId: string | undefined;
let pmEntryId: string | undefined;
let replScheduleId: string | undefined;
let replEntryId: string | undefined;

/** Ids of the fixture rows, by name. */
const R: Record<string, string> = {};

async function fixtureRow(name: string, entry: Partial<Parameters<typeof auditLog>[0]> = {}) {
  R[name] = await auditLog({ userId: MARK, userRole: 'OPERATOR', action: `CVP_FIXTURE_${name.toUpperCase()}`, ...entry } as any);
  return R[name];
}

async function makeUser(tag: string, role: string) {
  const username = `cvp_ad_${tag}_${SFX}`.toLowerCase();
  const id = await createUser(username, role, PW);
  userIds.push(id);
  return { id, username };
}

/** The row's link to its predecessor in chain_position order. */
async function expectChained(id: string) {
  const row = await prisma.auditTrail.findUniqueOrThrow({ where: { id } });
  const prev = await prisma.auditTrail.findFirst({ where: { chainPosition: (row.chainPosition as bigint) - 1n } });
  expect(prev, `row at chain_position ${row.chainPosition} - 1 exists`).not.toBeNull();
  expect(row.previousChecksum).toBe(prev!.checksum);
  return row;
}

const latestMeta = (action: string, by: string, targetId?: string) =>
  prisma.auditTrail.findFirst({ where: { action, userId: by, ...(targetId ? { targetId } : {}) }, orderBy: { chainPosition: 'desc' } });

const listMine = async (token: string, extra = '') => {
  const res = await authGet(app, `/api/audit?userId=${MARK}&limit=200${extra}`, token);
  expect(res.statusCode).toBe(200);
  return res.json() as { data: any[]; total: number; page: number; limit: number; totalPages: number };
};

beforeAll(async () => {
  await createRole(R_READER, ['AUDIT_READ', 'AUDIT_DELETE', 'AUDIT_EXPORT']);
  await createRole(R_NONE, []);
  saUser = await makeUser('sa', 'SUPER_ADMIN');
  sa2User = await makeUser('sa2', 'SUPER_ADMIN');
  rdUser = await makeUser('rd', R_READER);
  const noneUser = await makeUser('none', R_NONE);
  app = await buildApp();
  saTok = await login(app, saUser.username, PW);
  sa2Tok = await login(app, sa2User.username, PW);
  rdTok = await login(app, rdUser.username, PW);
  noneTok = await login(app, noneUser.username, PW);

  // Read-time enrichment targets: a filter (named), a cycle on a SECOND filter
  // (resolved by the second-pass lookup), a PM entry under the AHU, a
  // replacement entry.
  hier = await createHierarchy(`CVPAD${SFX}`);
  filterIds.push(await createFilter(hier.ahuId, `CVP-AD-F1-${SFX}`));
  filterIds.push(await createFilter(hier.ahuId, `CVP-AD-F2-${SFX}`));
  profileId = await createCleaningProfile(`CVP-AD-PROF-${SFX}`, saUser.id);
  cycleId = (await prisma.cleaningCycle.create({
    data: {
      cycleCode: `CVP-AD-CY-${SFX}`, filterId: filterIds[1], profileId, profileVersion: 3, sequenceNumber: 1,
      cleaningReasonKey: 'PM', cleaningReasonLabel: 'Preventive Maintenance',
    } as any,
  })).id;
  const day = new Date(Date.UTC(2031, 2, 10));
  pmScheduleId = (await prisma.pmSchedule.create({ data: { entityId: hier.ahuId, year: 2031, createdBy: saUser.id } })).id;
  pmEntryId = (await prisma.pmScheduleEntry.create({
    data: { scheduleId: pmScheduleId, month: 3, plannedDate: day, windowStart: day, windowEnd: day },
  })).id;
  replScheduleId = (await prisma.replacementSchedule.create({ data: { uploadedBy: saUser.id } })).id;
  replEntryId = (await prisma.replacementScheduleEntry.create({
    data: {
      scheduleId: replScheduleId, ahuId: hier.ahuId, ahuName: `CVPAD${SFX}-AHU`, filterSize: '610x610', filterMicron: '0.3',
      qty: 2, scheduleDate: day, windowStart: day, windowEnd: day,
    },
  })).id;

  await fixtureRow('byTarget', { targetType: 'filter', targetId: filterIds[0], afterValue: { note: 'target' } });
  await fixtureRow('byAfterFilterId', { targetType: 'thing', afterValue: { filterId: filterIds[0] } });
  await fixtureRow('byBeforeAssetId', { targetType: 'thing', beforeValue: { assetId: filterIds[0] } });
  await fixtureRow('keepsOwnName', { targetType: 'filter', targetId: filterIds[0], afterValue: { filterName: 'as-recorded' } });
  await fixtureRow('cycle', { targetType: 'cleaning_cycle', targetId: cycleId });
  await fixtureRow('pmEntry', { targetType: 'pm_schedule_entry', targetId: pmEntryId });
  await fixtureRow('replEntry', { targetType: 'replacement_schedule_entry', targetId: replEntryId });
  await fixtureRow('nullAfter', { targetType: 'thing', targetId: 'not-a-uuid' });
  await fixtureRow('bySa', { userRole: 'SUPER_ADMIN', targetType: 'thing' });
  await fixtureRow('restricted', { action: 'MANUAL_RECORD_CREATED', targetType: 'thing' });
  for (const n of ['redactOne', 'redactPair1', 'redactPair2', 'redactByGone', 'legacyRedactor', 'edit', 'editRedacted', 'del1', 'delBulk1', 'delBulk2', 'delGated']) {
    await fixtureRow(n, { targetType: 'thing', afterValue: { n } });
  }
}, 120_000);

afterAll(async () => {
  await cleanupAll([
    ['reauth', () => removeReauth(reauthAdded)],
    ['close app', async () => { await app?.close(); }],
    ['replacement schedule', async () => {
      if (replScheduleId) {
        await prisma.replacementScheduleEntry.deleteMany({ where: { scheduleId: replScheduleId } });
        await prisma.replacementSchedule.delete({ where: { id: replScheduleId } });
      }
    }],
    ['pm schedule', async () => {
      if (pmScheduleId) {
        await prisma.pmScheduleEntry.deleteMany({ where: { scheduleId: pmScheduleId } });
        await prisma.pmSchedule.delete({ where: { id: pmScheduleId } });
      }
    }],
    ['filters + cycle', () => deleteFilters(filterIds)],
    ['cleaning profile', async () => { if (profileId) await prisma.filterCleaningProfile.delete({ where: { id: profileId } }); }],
    ['hierarchy', () => deleteHierarchy(hier)],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([R_READER, R_NONE])],
  ]);
}, 120_000);

beforeEach(() => { internalErrors.length = 0; });

// ─── GET /api/audit ──────────────────────────────────────────────────────
describe('GET /api/audit — read-time enrichment', () => {
  let byId: Map<string, any>;
  beforeAll(async () => {
    const body = await listMine(saTok);
    byId = new Map(body.data.map((r) => [r.id, r]));
  }, 60_000);

  it('returns every fixture row to SUPER_ADMIN, each verifying its checksum', () => {
    for (const id of Object.values(R)) expect(byId.has(id), id).toBe(true);
    for (const r of byId.values()) expect(r.integrityValid).toBe(true);
  });

  it('stamps the filter name from targetId, afterValue.filterId and beforeValue.assetId', () => {
    for (const n of ['byTarget', 'byAfterFilterId', 'byBeforeAssetId']) {
      expect(byId.get(R[n]).afterValue.filterName, n).toBe(`CVP-AD-F1-${SFX}`);
    }
  });

  it('never overwrites a name the row recorded itself', () => {
    expect(byId.get(R.keepsOwnName).afterValue.filterName).toBe('as-recorded');
  });

  it('resolves a cleaning-cycle row to its cycle code, reason label and (second-pass) filter name', () => {
    expect(byId.get(R.cycle).afterValue).toMatchObject({
      filterName: `CVP-AD-F2-${SFX}`, cleaningReasonLabel: 'Preventive Maintenance', cycleCode: `CVP-AD-CY-${SFX}`,
    });
  });

  it('resolves an old PM-entry row to the AHU name through the entry\'s schedule', () => {
    expect(byId.get(R.pmEntry).afterValue.ahuName).toBe(`CVPAD${SFX}-AHU`);
  });

  it('resolves an old replacement-entry row to the titled descriptor and its fields', () => {
    expect(byId.get(R.replEntry).afterValue).toEqual({
      name: `AHU: CVPAD${SFX}-AHU · Size: 610x610 · Micron: 0.3µ · Qty: 2`,
      ahuName: `CVPAD${SFX}-AHU`, filterSize: '610x610', filterMicron: '0.3', qty: 2,
    });
  });

  it('a row with no payload and a non-uuid target is returned untouched (empty enrichment)', () => {
    const r = byId.get(R.nullAfter);
    expect(r.afterValue).toEqual({});
    expect(r.redactedByName).toBeNull();
  });
});

describe('GET /api/audit — filters, sorting, paging', () => {
  it('every period keyword keeps rows written just now; "all" applies no date filter', async () => {
    for (const period of ['today', 'week', 'month', 'quarter', 'year', 'all']) {
      const body = await listMine(saTok, `&period=${period}`);
      expect(body.data.some((r) => r.id === R.byTarget), period).toBe(true);
    }
  });

  it('a custom range includes or excludes by timestamp, with either bound alone', async () => {
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const hourAhead = new Date(Date.now() + 3_600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    expect((await listMine(saTok, `&startDate=${hourAgo}&endDate=${hourAhead}`)).data.some((r) => r.id === R.byTarget)).toBe(true);
    expect((await listMine(saTok, `&startDate=${hourAhead}`)).data).toEqual([]);
    expect((await listMine(saTok, `&endDate=${dayAgo}`)).data).toEqual([]);
  });

  it('narrows by action, targetType, targetId and free-text search', async () => {
    const byAction = await listMine(saTok, `&action=CVP_FIXTURE_CYCLE`);
    expect(byAction.data.map((r) => r.id)).toEqual([R.cycle]);
    const byType = await listMine(saTok, `&targetType=pm_schedule_entry`);
    expect(byType.data.map((r) => r.id)).toEqual([R.pmEntry]);
    const byTarget = await listMine(saTok, `&targetId=${replEntryId}`);
    expect(byTarget.data.map((r) => r.id)).toEqual([R.replEntry]);
    // search matches action (case-insensitive) among other columns
    const search = await listMine(saTok, `&search=cvp_fixture_replentry`);
    expect(search.data.map((r) => r.id)).toEqual([R.replEntry]);
  });

  it('sorts by the requested column and direction', async () => {
    const asc = (await listMine(saTok, '&sortBy=action&sortOrder=asc')).data.map((r) => r.action);
    expect(asc).toEqual([...asc].sort());
    const desc = (await listMine(saTok, '&sortBy=action&sortOrder=desc')).data.map((r) => r.action);
    expect(desc).toEqual([...asc].reverse());
  });

  it('pages with page/limit and reports totalPages from the total', async () => {
    const res = await authGet(app, `/api/audit?userId=${MARK}&action=CVP_FIXTURE_CYCLE&page=2&limit=1`, saTok);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], total: 1, page: 2, limit: 1, totalPages: 1 });
  });

  it('caches the total for identical filters while the rows themselves stay live', async () => {
    const q = `/api/audit?userId=${MARK}&targetType=cvp-cache-probe-${SFX}`;
    const first = (await authGet(app, q, saTok)).json();
    expect(first).toMatchObject({ data: [], total: 0 });
    const id = await auditLog({ userId: MARK, userRole: 'OPERATOR', action: 'CVP_FIXTURE_CACHE', targetType: `cvp-cache-probe-${SFX}` });
    const second = (await authGet(app, q, saTok)).json();
    expect(second.data.map((r: any) => r.id)).toEqual([id]); // rows are never cached
    expect(second.total).toBe(0);                             // the count may lag (60 s)
  });

  it('rejects a query value the shared schema refuses (400, no internal error)', async () => {
    const res = await authGet(app, '/api/audit?period=decade', saTok);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
  });

  it('is refused without AUDIT_READ', async () => {
    const res = await authGet(app, '/api/audit', noneTok);
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/audit — visibility for a non-SUPER_ADMIN reader', () => {
  it('hides SUPER_ADMIN-authored rows and super-admin-console actions, shows the rest', async () => {
    const ids = new Set((await listMine(rdTok)).data.map((r) => r.id));
    expect(ids.has(R.byTarget)).toBe(true);
    expect(ids.has(R.bySa)).toBe(false);
    expect(ids.has(R.restricted)).toBe(false);
  });

  it('the detail route applies the same scope (404, not the row)', async () => {
    expect((await authGet(app, `/api/audit/${R.bySa}`, rdTok)).statusCode).toBe(404);
    expect((await authGet(app, `/api/audit/${R.restricted}`, rdTok)).statusCode).toBe(404);
    const ok = await authGet(app, `/api/audit/${R.byTarget}`, rdTok);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: R.byTarget, integrityValid: true, redactedByName: null });
  });
});

// ─── POST /api/audit/report-export-log ───────────────────────────────────
describe('POST /api/audit/report-export-log', () => {
  const body = { reportType: 'Audit Trail', format: 'PDF', recordCount: 3 };

  it('SUPER_ADMIN may log any report; defaults are recorded for absent filters', async () => {
    const res = await authPost(app, '/api/audit/report-export-log', saTok, body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    const row = await latestMeta('REPORT_GENERATED', saUser.username);
    expect(row).toMatchObject({
      targetType: 'Audit Trail', userRole: 'SUPER_ADMIN',
      reason: 'Report generated: Audit Trail (3 record(s)) as PDF',
      afterValue: { reportType: 'Audit Trail', format: 'PDF', recordCount: 3, period: 'All Time', search: null, startDate: null, endDate: null },
    });
    await expectChained(row!.id);
  });

  it('records the active filters when they are sent', async () => {
    const res = await authPost(app, '/api/audit/report-export-log', saTok, {
      reportType: 'Filters', format: 'Excel', recordCount: 0, period: 'month', search: 'AHU-1', startDate: '2026-10-01', endDate: '2026-10-21',
    });
    expect(res.statusCode).toBe(200);
    const row = await latestMeta('REPORT_GENERATED', saUser.username);
    expect(row?.afterValue).toEqual({
      reportType: 'Filters', format: 'Excel', recordCount: 0, period: 'month', search: 'AHU-1', startDate: '2026-10-01', endDate: '2026-10-21',
    });
  });

  it('refuses a role without the export permission, writing nothing', async () => {
    const before = await prisma.auditTrail.count({ where: { action: 'REPORT_GENERATED', userId: { startsWith: 'cvp_ad_none' } } });
    const res = await authPost(app, '/api/audit/report-export-log', noneTok, body);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORBIDDEN', message: 'You cannot export the Audit Trail report.' });
    expect(await prisma.auditTrail.count({ where: { action: 'REPORT_GENERATED', userId: { startsWith: 'cvp_ad_none' } } })).toBe(before);
  });

  it('with re-auth on for the role: no password -> REAUTH_REQUIRED, wrong -> REAUTH_FAILED, right -> signed row', async () => {
    reauthAdded = [...reauthAdded, ...(await addReauth([['EXPORT_AUDIT_TRAIL', R_READER]]))];
    try {
      const none = await authPost(app, '/api/audit/report-export-log', rdTok, body);
      expect(none.statusCode).toBe(401);
      expect(none.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'EXPORT_AUDIT_TRAIL' });

      const wrong = await authPost(app, '/api/audit/report-export-log', rdTok, body, 'Wrong@Pass1');
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error).toBe('REAUTH_FAILED');
      const failed = await latestMeta('REAUTH_FAILED', rdUser.username);
      expect(failed?.afterValue).toMatchObject({ reauthAction: 'EXPORT_AUDIT_TRAIL' });

      const ok = await authPost(app, '/api/audit/report-export-log', rdTok, body, PW);
      expect(ok.statusCode).toBe(200);
      const sig = await latestMeta('REAUTH_SUCCESS', rdUser.username);
      const row = await latestMeta('REPORT_GENERATED', rdUser.username);
      expect(row?.signatureAuditId).toBe(sig?.id);
      await expectChained(row!.id);
    } finally {
      await removeReauth(reauthAdded);
      reauthAdded = [];
      await prisma.user.update({ where: { id: rdUser.id }, data: { failedLoginAttempts: 0 } });
    }
  });

  it('rejects a report name outside the fixed list', async () => {
    const res = await authPost(app, '/api/audit/report-export-log', saTok, { ...body, reportType: 'Anything I like' });
    expect(res.statusCode).toBe(400);
    expect(internalErrors).toEqual([]);
  });
});

// ─── POST /api/audit/:id/redact, /bulk-redact ────────────────────────────
describe('redaction', () => {
  it('redacts one row: payload nulled, stamps set, meta row chained, then reported on read', async () => {
    const res = await authPost(app, `/api/audit/${R.redactOne}/redact`, saTok, { reason: 'Contains personal data' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    const row = await prisma.auditTrail.findUniqueOrThrow({ where: { id: R.redactOne } });
    expect(row).toMatchObject({ beforeValue: null, afterValue: null, redactedBy: saUser.id, redactionReason: 'Contains personal data' });
    expect(row.redactedAt).toBeInstanceOf(Date);
    const meta = await latestMeta('AUDIT_RECORD_REDACTED', saUser.username, R.redactOne);
    expect(meta).toMatchObject({ targetType: 'audit_trail', reason: 'Contains personal data' });
    expect(meta?.beforeValue).toMatchObject({ id: R.redactOne, action: 'CVP_FIXTURE_REDACTONE', userId: MARK });
    await expectChained(meta!.id);

    const detail = (await authGet(app, `/api/audit/${R.redactOne}`, saTok)).json();
    expect(detail).toMatchObject({ redactedBy: saUser.id, redactedByName: saUser.username, redactionReason: 'Contains personal data', integrityValid: true });
    const listed = (await listMine(saTok, `&action=CVP_FIXTURE_REDACTONE`)).data[0];
    expect(listed.redactedByName).toBe(saUser.username);
  });

  it('refuses to redact twice (the first redactor is never overwritten)', async () => {
    const res = await authPost(app, `/api/audit/${R.redactOne}/redact`, saTok, { reason: 'Second attempt here' }, PW);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ALREADY_REDACTED');
  });

  it('404s an unknown id and refuses a non-SUPER_ADMIN', async () => {
    expect((await authPost(app, `/api/audit/${randomUUID()}/redact`, saTok, { reason: 'Nothing here' }, PW)).statusCode).toBe(404);
    expect((await authPost(app, `/api/audit/${R.redactPair1}/redact`, rdTok, { reason: 'Not allowed' }, PW)).statusCode).toBe(403);
    expect((await prisma.auditTrail.findUniqueOrThrow({ where: { id: R.redactPair1 } })).redactedAt).toBeNull();
  });

  it('bulk-redacts only the un-redacted ids and records them in one meta row', async () => {
    const res = await authPost(app, '/api/audit/bulk-redact', saTok, { ids: [R.redactPair1, R.redactPair2, R.redactOne], reason: 'Bulk privacy cleanup' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, count: 2 });
    for (const id of [R.redactPair1, R.redactPair2]) {
      expect((await prisma.auditTrail.findUniqueOrThrow({ where: { id } })).redactionReason).toBe('Bulk privacy cleanup');
    }
    // The already-redacted row keeps its original reason.
    expect((await prisma.auditTrail.findUniqueOrThrow({ where: { id: R.redactOne } })).redactionReason).toBe('Contains personal data');
    const meta = await latestMeta('AUDIT_RECORDS_BULK_REDACTED', saUser.username);
    expect(meta?.targetId).toBeNull();
    expect((meta?.beforeValue as any).recordCount).toBe(2);
    expect((meta?.beforeValue as any).records.map((r: any) => r.id).sort()).toEqual([R.redactPair1, R.redactPair2].sort());
    await expectChained(meta!.id);
  });

  it('bulk-redact 409s when nothing matching is left to redact', async () => {
    const res = await authPost(app, '/api/audit/bulk-redact', saTok, { ids: [R.redactOne, randomUUID()], reason: 'Nothing to do here' }, PW);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ALREADY_REDACTED_OR_MISSING');
  });

  it('shows the raw redactor id once the redactor account no longer exists', async () => {
    expect((await authPost(app, `/api/audit/${R.redactByGone}/redact`, sa2Tok, { reason: 'Redacted by a leaver' }, PW)).statusCode).toBe(200);
    await deleteUsers([sa2User.id]);
    const detail = (await authGet(app, `/api/audit/${R.redactByGone}`, saTok)).json();
    expect(detail.redactedByName).toBe(sa2User.id);
    const listed = (await listMine(saTok, '&action=CVP_FIXTURE_REDACTBYGONE')).data[0];
    expect(listed.redactedByName).toBe(sa2User.id);
  });

  it('a legacy non-uuid redactor is shown as stored, without a user lookup', async () => {
    // Legacy rows stored a free-text redactor; the column is varchar.
    await prisma.$executeRaw`UPDATE audit_trail SET redacted_at = now(), redacted_by = 'legacy-import', redaction_reason = 'legacy' WHERE id = ${R.legacyRedactor}::uuid`;
    const detail = await authGet(app, `/api/audit/${R.legacyRedactor}`, saTok);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().redactedByName).toBe('legacy-import');
    const listed = (await listMine(saTok, '&action=CVP_FIXTURE_LEGACYREDACTOR')).data[0];
    expect(listed.redactedByName).toBe('legacy-import');
    expect(internalErrors).toEqual([]);
  });
});

// ─── PUT /api/audit/:id ─────────────────────────────────────────────────
describe('PUT /api/audit/:id (edit in place)', () => {
  it('edits the row, writes the ORIGINAL values into a chained meta row, and the row no longer verifies', async () => {
    const original = await prisma.auditTrail.findUniqueOrThrow({ where: { id: R.edit } });
    const res = await authPut(app, `/api/audit/${R.edit}`, saTok, {
      reason: 'Correct the mis-keyed name', userName: 'Corrected Name', userRole: 'OPERATOR', targetType: '',
      targetId: 'T-1', signatureMeaning: 'corrected', afterValue: { n: 'fixed' }, beforeValue: { n: 'was' },
      timestamp: '2026-01-02T03:04:05.000Z',
    }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, chainBroken: true });
    const row = await prisma.auditTrail.findUniqueOrThrow({ where: { id: R.edit } });
    expect(row).toMatchObject({ userName: 'Corrected Name', targetType: null, targetId: 'T-1', signatureMeaning: 'corrected', afterValue: { n: 'fixed' }, beforeValue: { n: 'was' } });
    expect(row.timestamp.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(row.checksum).toBe(original.checksum); // never recomputed
    const meta = await latestMeta('AUDIT_RECORD_UPDATED', saUser.username, R.edit);
    expect(meta?.beforeValue).toMatchObject({ action: original.action, targetType: 'thing', afterValue: { n: 'edit' } });
    expect(meta?.afterValue).toMatchObject({ userName: 'Corrected Name', targetType: null });
    await expectChained(meta!.id);
    expect((await authGet(app, `/api/audit/${R.edit}`, saTok)).json().integrityValid).toBe(false);
  });

  it('refuses to edit a meta-audit row', async () => {
    const meta = await latestMeta('AUDIT_RECORD_UPDATED', saUser.username, R.edit);
    const res = await authPut(app, `/api/audit/${meta!.id}`, saTok, { reason: 'rewrite history', action: 'X' }, PW);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('META_AUDIT_IMMUTABLE');
  });

  it('refuses to edit a redacted row', async () => {
    await authPost(app, `/api/audit/${R.editRedacted}/redact`, saTok, { reason: 'mask before edit' }, PW);
    const res = await authPut(app, `/api/audit/${R.editRedacted}`, saTok, { reason: 'try an edit', action: 'X' }, PW);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('REDACTED');
  });

  it('400s an unparseable timestamp and an edit with no editable field, changing nothing', async () => {
    const t = await authPut(app, `/api/audit/${R.del1}`, saTok, { reason: 'bad date edit', timestamp: 'not a date' }, PW);
    expect(t.statusCode).toBe(400);
    expect(t.json().error).toBe('INVALID');
    const empty = await authPut(app, `/api/audit/${R.del1}`, saTok, { reason: 'nothing to change' }, PW);
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe('NO_CHANGES');
    expect(await latestMeta('AUDIT_RECORD_UPDATED', saUser.username, R.del1)).toBeNull();
  });

  it('404s an unknown id; refuses non-SUPER_ADMIN', async () => {
    expect((await authPut(app, `/api/audit/${randomUUID()}`, saTok, { reason: 'no such row', action: 'X' }, PW)).statusCode).toBe(404);
    expect((await authPut(app, `/api/audit/${R.del1}`, rdTok, { reason: 'not mine to edit', action: 'X' }, PW)).statusCode).toBe(403);
  });
});

// ─── DELETE /api/audit/:id, POST /bulk-delete ────────────────────────────
describe('hard delete (AUDIT_DELETE)', () => {
  it('a non-SUPER_ADMIN holder deletes a row it can see; the meta row is written first and chained', async () => {
    const res = await authDelete(app, `/api/audit/${R.del1}`, rdTok, PW, { reason: 'Duplicate test entry' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.auditTrail.findUnique({ where: { id: R.del1 } })).toBeNull();
    const meta = await latestMeta('AUDIT_RECORD_DELETED', rdUser.username, R.del1);
    expect(meta).toMatchObject({ targetType: 'audit_trail', reason: 'Duplicate test entry', userRole: R_READER });
    expect(meta?.beforeValue).toMatchObject({ id: R.del1, action: 'CVP_FIXTURE_DEL1', userId: MARK });
    await expectChained(meta!.id);
    // The trigger is back on after the endpoint's transaction.
    const trig = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled FROM pg_trigger WHERE tgname = 'audit_trail_no_delete'`;
    for (const t of trig) expect(t.tgenabled).not.toBe('D');
  });

  it('cannot delete what it cannot see: a SUPER_ADMIN-authored row is a 404 and survives', async () => {
    const res = await authDelete(app, `/api/audit/${R.bySa}`, rdTok, PW, { reason: 'Reach a hidden row' });
    expect(res.statusCode).toBe(404);
    expect(await prisma.auditTrail.findUnique({ where: { id: R.bySa } })).not.toBeNull();
  });

  it('is refused to a role without AUDIT_DELETE', async () => {
    const res = await authDelete(app, `/api/audit/${R.delGated}`, noneTok, PW, { reason: 'No permission here' });
    expect(res.statusCode).toBe(403);
  });

  // OD-01 (2026-10-22): the delete ALWAYS takes the password — no policy row is
  // added here, and the policy has never heard of this file's role.
  it('a delete without the password writes nothing, whatever the re-auth policy says', async () => {
    const one = await authDelete(app, `/api/audit/${R.delGated}`, rdTok, undefined, { reason: 'Needs a signature' });
    expect(one.statusCode).toBe(401);
    expect(one.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'DELETE_AUDIT_RECORD' });
    const bulk = await authPost(app, '/api/audit/bulk-delete', rdTok, { ids: [R.delGated], reason: 'Needs a signature' });
    expect(bulk.statusCode).toBe(401);
    expect(bulk.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'BULK_DELETE_AUDIT_RECORDS' });
    expect(await prisma.auditTrail.findUnique({ where: { id: R.delGated } })).not.toBeNull();
    expect(await latestMeta('AUDIT_RECORD_DELETED', rdUser.username, R.delGated)).toBeNull();

    const signed = await authDelete(app, `/api/audit/${R.delGated}`, rdTok, PW, { reason: 'Signed deletion' });
    expect(signed.statusCode).toBe(200);
    const meta = await latestMeta('AUDIT_RECORD_DELETED', rdUser.username, R.delGated);
    const sig = await latestMeta('REAUTH_SUCCESS', rdUser.username);
    expect(meta?.signatureAuditId).toBe(sig?.id);
  });

  it('404s a single delete of an unknown id', async () => {
    const res = await authDelete(app, `/api/audit/${randomUUID()}`, saTok, PW, { reason: 'Unknown row id' });
    expect(res.statusCode).toBe(404);
  });

  it('bulk-deletes only the visible ids and records them in one meta row', async () => {
    const res = await authPost(app, '/api/audit/bulk-delete', rdTok, { ids: [R.delBulk1, R.delBulk2, R.bySa], reason: 'Bulk test cleanup' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, count: 2 });
    expect(await prisma.auditTrail.count({ where: { id: { in: [R.delBulk1, R.delBulk2] } } })).toBe(0);
    expect(await prisma.auditTrail.findUnique({ where: { id: R.bySa } })).not.toBeNull();
    const meta = await latestMeta('AUDIT_RECORDS_BULK_DELETED', rdUser.username);
    expect((meta?.beforeValue as any).recordCount).toBe(2);
    expect((meta?.beforeValue as any).records.map((r: any) => r.id).sort()).toEqual([R.delBulk1, R.delBulk2].sort());
    await expectChained(meta!.id);
  });

  it('bulk-delete 404s when no id is visible to the caller', async () => {
    const res = await authPost(app, '/api/audit/bulk-delete', rdTok, { ids: [R.bySa, randomUUID()], reason: 'Only hidden ids' }, PW);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NO_MATCHING_RECORDS');
  });
});

describe('a malformed record id', () => {
  it('is a client error on every :id route (400), never an internal error, and logs no ERROR', async () => {
    // lib/logger.ts prints every record to process.stdout synchronously; an
    // unvalidated id used to print an `ERROR  [prisma]` P2023 line per request.
    const printed: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { printed.push(String(c)); return true; }) as never);
    let answers;
    try {
      answers = [
        await authGet(app, '/api/audit/not-a-uuid', saTok),
        await authPost(app, '/api/audit/not-a-uuid/redact', saTok, { reason: 'malformed id probe' }),
        await authPut(app, '/api/audit/not-a-uuid', saTok, { reason: 'malformed id probe', action: 'X' }),
        await authDelete(app, '/api/audit/not-a-uuid', saTok, undefined, { reason: 'malformed id probe' }),
      ];
      await new Promise((r) => setTimeout(r, 25)); // let any late Prisma log event land
    } finally {
      spy.mockRestore();
    }
    expect(printed.join('')).not.toMatch(/\bERROR\b/);
    // D-PLAT-1: the route schema rejects the id (format: uuid) before any
    // handler or query runs. It used to reach Prisma and come back as P2023 ->
    // 400 DATA_CONSTRAINT, with an ERROR-level "Unmapped Prisma error" line per
    // request. A schema refusal names the `format` keyword on the `id` param,
    // which is what proves no database call was made.
    for (const res of answers) {
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ keyword: 'format', instancePath: '/id', params: { format: 'uuid' } }),
      ]));
    }
    expect(internalErrors).toEqual([]);
  });
});

// ─── GET /api/audit/verify-chain ────────────────────────────────────────
describe('GET /api/audit/verify-chain', () => {
  it('walks a bounded window and reports the verifier result shape', async () => {
    const row = await prisma.auditTrail.findUniqueOrThrow({ where: { id: R.byTarget } });
    const pos = Number(row.chainPosition);
    const res = await authGet(app, `/api/audit/verify-chain?fromPosition=${pos}&toPosition=${pos + 2}&maxAnomalies=5`, saTok);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.intact).toBe('boolean');
    expect(body.totalRowsChecked).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.anomalies)).toBe(true);
  });

  it('is SUPER_ADMIN only', async () => {
    expect((await authGet(app, '/api/audit/verify-chain', rdTok)).statusCode).toBe(403);
  });
});
