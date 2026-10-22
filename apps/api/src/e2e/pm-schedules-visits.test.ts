/**
 * PM schedules — "Add a visit" (D-OPS-10, operator decision 2026-10-22).
 *
 * The New Schedule dialog used to offer to OVERWRITE the AHU's first visit
 * (entries[0]) whenever a schedule already existed for the year — wrong as soon
 * as an AHU has more than one visit. POST /api/pm-schedules/visits instead adds
 * ONE visit on the chosen date: it creates the year's schedule when missing,
 * never touches existing visits, refuses a duplicate date (409 PM_VISIT_EXISTS)
 * and an overlapping one (409 PM_VISIT_OVERLAP), and the new visit enters the
 * approval workflow exactly as an uploaded row does.
 *
 * Also locks the root cause found alongside: POST / (create) wrote its entries
 * at the column default PENDING with no submitter, so with the 3-step workflow
 * ON they skipped Review. create() now takes the same approval fields.
 *
 * Real Fastify + auth + RBAC + re-auth gate + Prisma on digilog_test_db; own
 * roles, users and AHUs; PM config served in-process (pm-fixtures.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, iso, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMV');
const YEAR = 2094;

let app: FastifyInstance;
let cfg: ConfigOverrides;
let notifyRole: string, UPL: string, OTHER: string;
const u: Record<string, { id: string; username: string }> = {};
const tok: Record<string, string> = {};
let ahuTwoVisits: string, ahuEmpty: string, ahuWf: string, ahuCreate: string, ahuCreateSa: string, ahuRole: string;
let blockId: string, ahuGone: string, ahuArchived: string;
let firstVisitIds: string[] = [];

const post = (url: string, k: string, payload: unknown, pw?: string) =>
  app.inject({
    method: 'POST', url: `/api/pm-schedules${url}`,
    headers: { authorization: `Bearer ${tok[k]}`, ...(pw ? { 'x-reauth-password': pw } : {}) },
    payload: payload as any,
  });
const visit = (entityId: string, plannedDate: string, toleranceDays?: number) =>
  ({ entityId, plannedDate, ...(toleranceDays !== undefined ? { toleranceDays } : {}) });
const entriesOf = async (entityId: string) => {
  const s = await prisma.pmSchedule.findMany({ where: { entityId, year: YEAR }, include: { entries: { orderBy: { plannedDate: 'asc' } } } });
  return { schedules: s, entries: s.flatMap((x) => x.entries) };
};

beforeAll(async () => {
  app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
  notifyRole = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides({
    ...defaultPmConfig(notifyRole),
    // Operator-facing dates in refusals follow Config → Date & Time.
    datetime: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' },
  });
  UPL = await fx.role('UPL', ['PM_READ', 'PM_CREATE']);
  OTHER = await fx.role('OTH', ['PM_READ', 'PM_CREATE']);
  const RO = await fx.role('RO', ['PM_READ']);
  for (const [k, role] of [['sa', 'SUPER_ADMIN'], ['upl', UPL], ['oth', OTHER], ['ro', RO]] as const) {
    u[k] = await fx.user(k, role);
    tok[k] = await fx.login(app, u[k].username);
  }
  const block = await fx.instance('BLOCK', 'BLOCK');
  blockId = block;
  ahuGone = await fx.instance('AHU', 'GONE', { parentId: block });
  await prisma.assetInstance.update({ where: { id: ahuGone }, data: { isActive: false } });
  // An AHU-year holding only an ARCHIVED version (no ACTIVE one).
  ahuArchived = await fx.instance('AHU', 'ARCH', { parentId: block });
  await fx.schedule(ahuArchived, YEAR, u.sa.id, [{ plannedDate: new Date(Date.UTC(YEAR, 0, 20)), toleranceDays: 2 }], 'ARCHIVED');
  ahuTwoVisits = await fx.instance('AHU', 'TWO', { parentId: block });
  ahuEmpty = await fx.instance('AHU', 'EMPTY', { parentId: block });
  ahuWf = await fx.instance('AHU', 'WF', { parentId: block });
  ahuCreate = await fx.instance('AHU', 'CREATE', { parentId: block });
  ahuCreateSa = await fx.instance('AHU', 'CREATE-SA', { parentId: block });
  ahuRole = await fx.instance('AHU', 'ROLE', { parentId: block });
  // An AHU that already has TWO approved visits this year: 10 Mar ±5 and 10 Jun ±5.
  firstVisitIds = (await fx.schedule(ahuTwoVisits, YEAR, u.sa.id, [
    { plannedDate: new Date(Date.UTC(YEAR, 2, 10)), toleranceDays: 5, approvalStatus: 'APPROVED' },
    { plannedDate: new Date(Date.UTC(YEAR, 5, 10)), toleranceDays: 5, approvalStatus: 'APPROVED' },
  ])).entryIds;
}, 120_000);

afterAll(async () => {
  await fx.cleanup(app);
}, 120_000);

beforeEach(() => {
  for (const [k, v] of Object.entries(defaultPmConfig(notifyRole))) cfg.set(k, v);
});

describe('POST /visits — gates', () => {
  it('needs PM_CREATE', async () => {
    const res = await post('/visits', 'ro', visit(ahuEmpty, `${YEAR}-09-14`));
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_CREATE');
  });

  it('asks for the password when CREATE_PM_SCHEDULE re-auth is on', async () => {
    cfg.set('action-reauth', { CREATE_PM_SCHEDULE: [UPL] });
    const res = await post('/visits', 'upl', visit(ahuEmpty, `${YEAR}-09-14`));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_PM_SCHEDULE' });
    expect((await entriesOf(ahuEmpty)).entries).toHaveLength(0);
  });

  it('validates the body (uuid AHU, date-only date, non-negative tolerance)', async () => {
    expect((await post('/visits', 'sa', { entityId: 'nope', plannedDate: `${YEAR}-09-14` })).statusCode).toBe(400);
    expect((await post('/visits', 'sa', { entityId: ahuEmpty, plannedDate: '14/09/2094' })).statusCode).toBe(400);
    expect((await post('/visits', 'sa', { entityId: ahuEmpty, plannedDate: `${YEAR}-09-14`, toleranceDays: -1 })).statusCode).toBe(400);
    expect((await post('/visits', 'sa', { plannedDate: `${YEAR}-09-14` })).statusCode).toBe(400);
  });

  it('only a live AHU can carry visits: an unknown id, a BLOCK and a deactivated AHU are each a 404', async () => {
    expect((await post('/visits', 'sa', visit('00000000-0000-4000-8000-000000000099', `${YEAR}-09-14`))).statusCode).toBe(404);
    const blockRes = await post('/visits', 'sa', visit(blockId, `${YEAR}-09-14`));
    expect(blockRes.statusCode).toBe(404);
    expect(blockRes.json().error).toBe('NOT_FOUND');
    expect((await post('/visits', 'sa', visit(ahuGone, `${YEAR}-09-14`))).statusCode).toBe(404);
    expect(await prisma.pmSchedule.count({ where: { entityId: { in: [blockId, ahuGone] } } })).toBe(0);
  });

  it('with the workflow ON, only the configured upload role may add a visit (step 1 of the SoD chain)', async () => {
    cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: [UPL], reviewRole: 'R', approvalRole: 'A' });
    const res = await post('/visits', 'oth', visit(ahuRole, `${YEAR}-09-14`));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN_ROLE');
    expect((await entriesOf(ahuRole)).entries).toHaveLength(0);
  });
});

describe('POST /visits — adding a visit', () => {
  it('a SECOND visit on an AHU that already has visits is added; the existing visits are untouched', async () => {
    const before = await prisma.pmScheduleEntry.findMany({ where: { id: { in: firstVisitIds } }, orderBy: { plannedDate: 'asc' } });
    const res = await post('/visits', 'sa', visit(ahuTwoVisits, `${YEAR}-09-14`, 4));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ scheduleCreated: false, entry: { plannedDate: expect.stringMatching(new RegExp(`^${YEAR}-09-14`)), toleranceDays: 4 } });

    const { schedules, entries } = await entriesOf(ahuTwoVisits);
    expect(schedules).toHaveLength(1);
    expect(entries.map((e) => iso(e.plannedDate))).toEqual([`${YEAR}-03-10`, `${YEAR}-06-10`, `${YEAR}-09-14`]);
    const added = entries[2];
    expect([iso(added.windowStart), iso(added.windowEnd), added.month]).toEqual([`${YEAR}-09-10`, `${YEAR}-09-18`, 9]);
    // The two existing visits are byte-for-byte what they were.
    const after = await prisma.pmScheduleEntry.findMany({ where: { id: { in: firstVisitIds } }, orderBy: { plannedDate: 'asc' } });
    expect(after).toEqual(before);
    // Workflow OFF + SUPER_ADMIN: approved directly, exactly like an upload.
    expect(added).toMatchObject({ approvalStatus: 'APPROVED', submittedBy: u.sa.id, submittedByName: u.sa.username, approvedBy: u.sa.id, approvedByName: u.sa.username });
    expect(added.approvedAt).toBeInstanceOf(Date);

    // Audited, and one QNN minted for the entry (as the upload does per entry).
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'CREATED', targetId: added.id }, orderBy: { chainPosition: 'desc' } });
    expect(audit).toMatchObject({ userId: u.sa.username, targetType: 'pm_schedule_entry' });
    expect(audit?.afterValue).toMatchObject({ ahuName: `${fx.tag}-TWO`, plannedDate: `${YEAR}-09-14`, toleranceDays: 4, approvalStatus: 'APPROVED', scheduleCreated: false });
    const qnns = await prisma.qualityNotification.findMany({ where: { pmScheduleEntryId: added.id } });
    expect(qnns).toHaveLength(1);
    expect(qnns[0]).toMatchObject({ action: 'UPLOAD', ahuName: `${fx.tag}-TWO` });
    expect(body.qnn).toBe(qnns[0].qnn);
  });

  it('a date already on the schedule is refused 409 PM_VISIT_EXISTS and nothing changes', async () => {
    const res = await post('/visits', 'sa', visit(ahuTwoVisits, `${YEAR}-06-10`, 1));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_EXISTS');
    expect(res.json().message).toContain(`${YEAR}-06-10`);
    expect((await entriesOf(ahuTwoVisits)).entries).toHaveLength(3);
  });

  it('a visit whose window overlaps an existing one is refused 409 PM_VISIT_OVERLAP and nothing changes', async () => {
    // 20 Mar ±6 → 14..26 Mar; the 10 Mar ±5 visit runs to 15 Mar.
    const res = await post('/visits', 'sa', visit(ahuTwoVisits, `${YEAR}-03-20`, 6));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_OVERLAP');
    expect((await entriesOf(ahuTwoVisits)).entries).toHaveLength(3);
  });

  it('an AHU with no schedule for the year gets one, created with its first visit; the tolerance defaults from settings', async () => {
    const res = await post('/visits', 'upl', visit(ahuEmpty, `${YEAR}-02-01`));
    expect(res.statusCode).toBe(201);
    expect(res.json().scheduleCreated).toBe(true);
    const { schedules, entries } = await entriesOf(ahuEmpty);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({ status: 'ACTIVE', year: YEAR, createdBy: u.upl.id });
    expect(entries).toHaveLength(1);
    // defaultToleranceDays = 3 in the fixture settings.
    expect(entries[0]).toMatchObject({ toleranceDays: 3 });
    // Workflow OFF, not a Super Admin: pending approval, with its submitter.
    expect(entries[0]).toMatchObject({ approvalStatus: 'PENDING', submittedBy: u.upl.id, submittedByName: u.upl.username, approvedBy: null });
  });

  it('an AHU-year with only an ARCHIVED version gets a new ACTIVE version (not a colliding v1); the archived one is untouched', async () => {
    const res = await post('/visits', 'sa', visit(ahuArchived, `${YEAR}-07-07`, 2));
    expect(res.statusCode).toBe(201);
    expect(res.json().scheduleCreated).toBe(true);
    const all = await prisma.pmSchedule.findMany({ where: { entityId: ahuArchived, year: YEAR }, orderBy: { version: 'asc' }, include: { entries: true } });
    expect(all.map((x) => [x.version, x.status, x.entries.length])).toEqual([[1, 'ARCHIVED', 1], [2, 'ACTIVE', 1]]);
  });

  it('workflow ON: the new visit goes to review (PENDING_REVIEW) — even for a Super Admin', async () => {
    cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: '', reviewRole: 'R', approvalRole: 'A' });
    const res = await post('/visits', 'sa', visit(ahuWf, `${YEAR}-04-04`, 2));
    expect(res.statusCode).toBe(201);
    const { entries } = await entriesOf(ahuWf);
    expect(entries[0]).toMatchObject({ approvalStatus: 'PENDING_REVIEW', submittedBy: u.sa.id, submittedByName: u.sa.username, approvedBy: null, approvedAt: null });
    const qnn = await prisma.qualityNotification.findFirst({ where: { pmScheduleEntryId: entries[0].id } });
    expect(qnn?.message).toContain('(pending review)');
  });

  it('signed: with CREATE_PM_SCHEDULE re-auth on, the right password adds the visit and the audit row links the signature', async () => {
    cfg.set('action-reauth', { CREATE_PM_SCHEDULE: ['SUPER_ADMIN'] });
    const res = await post('/visits', 'sa', visit(ahuTwoVisits, `${YEAR}-11-20`, 2), fx.password);
    expect(res.statusCode).toBe(201);
    const id = res.json().entry.id;
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'CREATED', targetId: id } });
    const signature = await prisma.auditTrail.findUnique({ where: { id: audit!.signatureAuditId! } });
    expect(signature?.action).toBe('REAUTH_SUCCESS');
  });
});

describe('POST / (create) — the same approval fields as an upload (root cause of the Review skip)', () => {
  it('workflow ON: created entries go to PENDING_REVIEW with their submitter (they used to sit at PENDING, skipping Review)', async () => {
    cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: '', reviewRole: 'R', approvalRole: 'A' });
    const res = await post('', 'upl', { entityId: ahuCreate, year: YEAR, entries: [{ month: 5, plannedDate: `${YEAR}-05-05`, toleranceDays: 2 }] });
    expect(res.statusCode).toBe(201);
    const { entries } = await entriesOf(ahuCreate);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ approvalStatus: 'PENDING_REVIEW', submittedBy: u.upl.id, submittedByName: u.upl.username });
  });

  it('workflow OFF + Super Admin: approved directly with the approver recorded, like an upload', async () => {
    const res = await post('', 'sa', { entityId: ahuCreateSa, year: YEAR, entries: [{ month: 5, plannedDate: `${YEAR}-05-05` }] });
    expect(res.statusCode).toBe(201);
    const { entries } = await entriesOf(ahuCreateSa);
    expect(entries[0]).toMatchObject({ approvalStatus: 'APPROVED', submittedBy: u.sa.id, approvedBy: u.sa.id, approvedByName: u.sa.username });
  });
});
