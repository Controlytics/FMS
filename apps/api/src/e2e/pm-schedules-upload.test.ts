/**
 * PM schedules — bulk upload (POST /api/pm-schedules/upload) end to end.
 *
 * Multipart CSV / XLSX through the real route → importSchedules → Prisma on
 * digilog_test_db: file validation, cell normalisation, row-level skips, the
 * append-only + idempotent re-upload rule, the separation check against
 * existing visits, workflow-dependent approval state, one QNN per entry with a
 * shared batch tag, and the upload-role gate.
 *
 * Own SUPER_ADMIN, roles, users and AHUs; PM config served in-process (see
 * pm-fixtures.ts). Visits are in YEAR so no other suite's rows are involved.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, multipartBody, iso, DAY, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMU');
const YEAR = 2091;

let app: FastifyInstance;
let cfg: ConfigOverrides;
let notifyRole: string, uplRole: string, otherRole: string;
let sa: { id: string; username: string };
let upl: { id: string; username: string };
const tok: Record<string, string> = {};
let A: string, B: string, C: string, D: string, X: string; // AHU names
let aId: string, bId: string, cId: string, dId: string;

async function upload(k: string, file: { name: string; content: Buffer } | null, pw?: string, fields: Record<string, string> = {}) {
  const { payload, contentType } = multipartBody(file, fields);
  return app.inject({
    method: 'POST', url: '/api/pm-schedules/upload',
    headers: { authorization: `Bearer ${tok[k]}`, 'content-type': contentType, ...(pw ? { 'x-reauth-password': pw } : {}) },
    payload,
  });
}
const csv = (text: string, name = 'pm.csv') => ({ name, content: Buffer.from(text, 'utf8') });

async function entriesOf(ahuId: string) {
  return prisma.pmScheduleEntry.findMany({
    where: { schedule: { entityId: ahuId, year: YEAR, status: 'ACTIVE' } },
    orderBy: { plannedDate: 'asc' },
  });
}

beforeAll(async () => {
  app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
  notifyRole = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides(defaultPmConfig(notifyRole));
  uplRole = await fx.role('UPL', ['PM_READ', 'PM_UPLOAD']);
  otherRole = await fx.role('OTH', ['PM_READ', 'PM_UPLOAD']);
  const creRole = await fx.role('CRE', ['PM_READ', 'PM_CREATE', 'PM_UPDATE']);

  sa = await fx.user('sa', 'SUPER_ADMIN');
  upl = await fx.user('upl', uplRole);
  const cre = await fx.user('cre', creRole);
  tok.sa = await fx.login(app, sa.username);
  tok.upl = await fx.login(app, upl.username);
  tok.cre = await fx.login(app, cre.username);

  const block = await fx.instance('BLOCK', 'BLOCK');
  aId = await fx.instance('AHU', 'UA', { parentId: block });
  bId = await fx.instance('AHU', 'UB', { parentId: block });
  cId = await fx.instance('AHU', 'UC', { parentId: block });
  dId = await fx.instance('AHU', 'UD', { parentId: block });
  await fx.instance('AHU', 'UX', { parentId: block, isActive: false });
  [A, B, C, D, X] = ['UA', 'UB', 'UC', 'UD', 'UX'].map((n) => `${fx.tag}-${n}`);
}, 120_000);

afterAll(async () => {
  await fx.cleanup(app);
}, 120_000);

beforeEach(() => {
  for (const [k, v] of Object.entries(defaultPmConfig(notifyRole))) cfg.set(k, v);
});

describe('who may upload', () => {
  it('needs PM_UPLOAD — PM_CREATE / PM_UPDATE do not open the upload route', async () => {
    const res = await upload('cre', csv(`ahu_name,scheduled_date\n${A},${YEAR}-01-01\n`));
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_UPLOAD');
  });

  it('asks for the password BEFORE reading the file when UPLOAD_PM_SCHEDULES re-auth is on', async () => {
    cfg.set('action-reauth', { UPLOAD_PM_SCHEDULES: [uplRole] });
    const res = await upload('upl', csv(`ahu_name,scheduled_date\n${A},${YEAR}-01-01\n`));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPLOAD_PM_SCHEDULES' });
    expect(await entriesOf(aId)).toHaveLength(0);
  });

  it('the configured uploadRole is enforced (403 FORBIDDEN_ROLE) — holding PM_UPLOAD is not enough', async () => {
    cfg.set('pm-schedule-approval', { workflowEnabled: false, uploadRole: [otherRole], reviewRole: '', approvalRole: '' });
    const res = await upload('upl', csv(`ahu_name,scheduled_date\n${A},${YEAR}-01-01\n`));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN_ROLE' });
    expect(res.json().message).toContain(`"${otherRole}"`);
    expect(await entriesOf(aId)).toHaveLength(0);
  });
});

describe('file validation', () => {
  it('a non-multipart request is 400 INVALID_REQUEST', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/pm-schedules/upload',
      headers: { authorization: `Bearer ${tok.sa}` }, payload: { rows: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_REQUEST' });
  });

  it('a multipart request with no file part is 400 NO_FILE', async () => {
    const res = await upload('sa', null, undefined, { note: 'no file here' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'NO_FILE' });
  });

  it('only .csv/.xlsx extensions are accepted', async () => {
    const res = await upload('sa', { name: 'schedule.txt', content: Buffer.from('ahu_name\nx\n') });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_FILE_TYPE' });
  });

  it('a file over the 5 MB limit is 413 FILE_TOO_LARGE, not a silently truncated import', async () => {
    const line = `${A},${YEAR}-01-01\n`;
    const big = `ahu_name,scheduled_date\n${line.repeat(Math.ceil((5 * 1024 * 1024 + 1024) / line.length))}`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(5 * 1024 * 1024);
    const res = await upload('sa', csv(big));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'FILE_TOO_LARGE' });
    expect(await entriesOf(aId)).toHaveLength(0);
  });

  it('bytes that are not a workbook are 400 PARSE_ERROR', async () => {
    const res = await upload('sa', { name: 'schedule.xlsx', content: Buffer.from('definitely not a zip archive') });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('PARSE_ERROR');
    expect(res.json().message).toMatch(/^Failed to parse file: /);
  });

  it('a legacy BIFF .xls is refused up front with a save-as hint, and writes nothing', async () => {
    // exceljs reads only OOXML, so .xls is refused before parsing (D9, 2026-10-21).
    const biff = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    const res = await upload('sa', { name: 'legacy.xls', content: biff });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_FILE_TYPE' });
    expect(await entriesOf(aId)).toHaveLength(0);
  });

  it('an empty CSV, and a header-only CSV, are 400 EMPTY_FILE', async () => {
    for (const text of ['', '\r\n\r\n', 'ahu_name,scheduled_date,tolerance_days\n']) {
      const res = await upload('sa', csv(text));
      expect(res.statusCode, JSON.stringify(text)).toBe(400);
      expect(res.json().error).toBe('EMPTY_FILE');
    }
  });

  it('a workbook with no worksheet is 400 EMPTY_FILE', async () => {
    const wb = new ExcelJS.Workbook();
    const res = await upload('sa', { name: 'empty.xlsx', content: Buffer.from(await wb.xlsx.writeBuffer()) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('EMPTY_FILE');
  });

  it('a file whose only rows are #-comments is 400 NO_ROWS', async () => {
    const res = await upload('sa', csv(`ahu_name,scheduled_date\n# fill one row per visit,\n  #another note,x\n`));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('NO_ROWS');
  });
});

describe('CSV import (workflow OFF, SUPER_ADMIN auto-approves)', () => {
  // Row numbers in the report are 1-based file rows with the header as row 1.
  // Built lazily: the AHU names only exist once beforeAll has run.
  const file = () => [
    '﻿ahu_name,scheduled_date,tolerance_days,notes',
    `${A},${YEAR}-01-10,3,"plain, with a comma"`,                 // 2 ✓ ISO
    `${A},15-03-${YEAR},,"he said ""hi"""`,                        // 3 ✓ DMY, default tolerance
    `${B},${YEAR}/06/10,2,slash`,                                  // 4 ✓ ISO with slashes
    `,${YEAR}-02-02,3,no name`,                                    // 5 ✗ Missing ahu_name
    `${A},,3,no date`,                                             // 6 ✗ Missing scheduled_date
    `NoSuchAhu-${fx.tag},${YEAR}-02-02,3,unknown`,                 // 7 ✗ AHU not found
    `${X},${YEAR}-02-02,3,inactive`,                               // 8 ✗ inactive AHU = not found
    `${A},not-a-date,3,bad`,                                       // 9 ✗ invalid date
    `${A},${YEAR}-09-09,abc,bad tol`,                              // 10 ✗ invalid tolerance
    `${A},${YEAR}-10-10,400,too big`,                              // 11 ✗ tolerance > 365
    `${B},${YEAR}-03-05T00:00:00Z,1,fallback parse`,               // 12 ✓ Date() fallback
  ].join('\r\n');

  let result: any;

  it('imports the good rows, reports every bad row with its reason, and writes APPROVED visits', async () => {
    cfg.set('pm-schedule-settings', { ...defaultPmConfig(notifyRole)['pm-schedule-settings'], defaultToleranceDays: 4 });
    const res = await upload('sa', csv(file()));
    expect(res.statusCode).toBe(200);
    result = res.json();
    expect(result.imported).toBe(4);
    expect(result.skipped).toBe(7);
    expect(result.details.imported.map((r: any) => [r.row, r.ahuName, r.plannedDate])).toEqual([
      [2, A, `${YEAR}-01-10`], [3, A, `${YEAR}-03-15`], [4, B, `${YEAR}-06-10`], [12, B, `${YEAR}-03-05`],
    ]);
    const reasons = Object.fromEntries(result.details.skipped.map((s: any) => [s.row, s.reason]));
    expect(reasons).toEqual({
      5: 'Missing ahu_name',
      6: 'Missing scheduled_date',
      7: `AHU "NoSuchAhu-${fx.tag}" not found in your organization`,
      8: `AHU "${X}" not found in your organization`,
      9: 'Invalid scheduled_date "not-a-date" — expected YYYY-MM-DD or DD-MM-YYYY',
      10: 'Invalid tolerance_days "abc" — expected 0-365',
      11: 'Invalid tolerance_days "400" — expected 0-365',
    });

    const a = await entriesOf(aId);
    expect(a.map((e) => [iso(e.plannedDate), e.month, e.toleranceDays, iso(e.windowStart), iso(e.windowEnd)])).toEqual([
      [`${YEAR}-01-10`, 1, 3, `${YEAR}-01-07`, `${YEAR}-01-13`],
      [`${YEAR}-03-15`, 3, 4, `${YEAR}-03-11`, `${YEAR}-03-19`], // default tolerance from settings
    ]);
    for (const e of [...a, ...(await entriesOf(bId))]) {
      expect(e).toMatchObject({ approvalStatus: 'APPROVED', submittedBy: sa.id, submittedByName: sa.username, approvedBy: sa.id, approvedByName: sa.username });
      expect(e.approvedAt).toBeInstanceOf(Date);
    }
    const imported = result.details.imported;
    const entryIdsByRow = Object.fromEntries(imported.map((r: any) => [r.row, r.entryId]));
    expect(entryIdsByRow[2]).toBe(a[0].id);
    expect(entryIdsByRow[3]).toBe(a[1].id);
    expect(new Set(imported.filter((r: any) => r.ahuName === A).map((r: any) => r.scheduleId)).size).toBe(1);
  });

  it('mints one QNN per imported visit, all tagged with one batch reference naming both AHUs', async () => {
    expect(result.qnns).toHaveLength(4);
    expect(result.qnn).toBe(result.qnns[0]);
    const rows = await prisma.qualityNotification.findMany({ where: { qnn: { in: result.qnns } } });
    expect(rows).toHaveLength(4);
    const byQnn = new Map(rows.map((r) => [r.qnn, r]));
    const refs = new Set<string>();
    result.qnns.forEach((q: string, i: number) => {
      const r = byQnn.get(q)!;
      expect(r).toMatchObject({ action: 'UPLOAD', performedBy: sa.id, performedByName: sa.username });
      expect(r.pmScheduleEntryId).toBe(result.details.imported[i].entryId);
      const m = r.message!.match(/\[batch (B-[0-9A-F]{6}), (\d) of 4 across (.+)\]$/);
      expect(m, r.message!).toBeTruthy();
      refs.add(m![1]);
      expect(Number(m![2])).toBe(i + 1);
      expect(m![3]).toBe(`${A}, ${B}`);
      expect(r.message).not.toContain('pending review');
    });
    expect(refs.size).toBe(1);
    // Workflow OFF with no review/approval role → the notification has no role routing.
    const notes = await prisma.notification.findMany({ where: { type: 'PM_SCHEDULE_QNN', createdBy: sa.username } });
    expect(notes.length).toBeGreaterThanOrEqual(4);
  });

  it('audits the import with its counts and the AHUs it touched', async () => {
    const row = await prisma.auditTrail.findFirst({
      where: { action: 'PM_SCHEDULE_IMPORTED', userId: sa.username }, orderBy: { chainPosition: 'desc' },
    });
    expect(row).toMatchObject({ targetType: 'pm_schedule', targetId: 'bulk' });
    expect(row?.afterValue).toEqual({ imported: 4, skipped: 7, ahuNames: [A, B] });
  });

  it('re-uploading the same file adds nothing — every existing visit is reported as left unchanged', async () => {
    const before = (await entriesOf(aId)).map((e) => e.id);
    const res = await upload('sa', csv(file()));
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.imported).toBe(0);
    expect(r.qnn).toBeNull();
    expect(r.qnns).toEqual([]);
    const unchanged = r.details.skipped.filter((s: any) => /is already on the 2091 schedule — left unchanged\.$/.test(s.reason));
    expect(unchanged.map((s: any) => s.row)).toEqual([2, 3, 4, 12]);
    expect((await entriesOf(aId)).map((e) => e.id)).toEqual(before);
  });
});

describe('separation against existing visits and within the file', () => {
  it('a new visit overlapping an EXISTING one is refused, and the AHU\'s other new rows are held back with it', async () => {
    // A has 10 Jan ±3 (7–13 Jan). 12 Jan ±2 opens 10 Jan → overlap.
    const res = await upload('sa', csv(`ahu_name,scheduled_date,tolerance_days\n${A},${YEAR}-01-12,2\n${A},${YEAR}-05-01,2\n`));
    const r = res.json();
    expect(r.imported).toBe(0);
    const reasons = Object.fromEntries(r.details.skipped.map((s: any) => [s.row, s.reason]));
    expect(reasons[2]).toMatch(new RegExp(`^AHU "${A}": ${YEAR}-01-12 \\(tolerance 2d\\) starts on ${YEAR}-01-10`));
    expect(reasons[3]).toBe(`AHU "${A}": not added — another new visit for this AHU overlaps, and an AHU's rows are added together. Fix the flagged row(s) and re-upload.`);
    expect(await entriesOf(aId)).toHaveLength(2);
  });

  it('blames the NEW row even when the existing visit is the later one', async () => {
    // B has 10 Jun ±2 (8–12 Jun). A new 7 Jun ±2 ends 9 Jun → overlap; the new row is the earlier one.
    const res = await upload('sa', csv(`ahu_name,scheduled_date,tolerance_days\n${B},${YEAR}-06-07,2\n`));
    const [s] = res.json().details.skipped;
    expect(s.row).toBe(2);
    expect(s.reason).toContain(`AHU "${B}": ${YEAR}-06-10 (tolerance 2d) starts on ${YEAR}-06-08`);
    expect(await entriesOf(bId)).toHaveLength(2);
  });

  it('two new rows that overlap each other: the later row is blamed, nothing is written for the AHU', async () => {
    const res = await upload('sa', csv(`ahu_name,scheduled_date,tolerance_days\n${C},${YEAR}-02-01,5\n${C},${YEAR}-02-05,5\n`));
    const reasons = Object.fromEntries(res.json().details.skipped.map((s: any) => [s.row, s.reason]));
    expect(reasons[3]).toContain(`${YEAR}-02-05 (tolerance 5d)`);
    expect(reasons[2]).toMatch(/not added — another new visit/);
    expect(await entriesOf(cId)).toHaveLength(0);
    expect(await prisma.pmSchedule.count({ where: { entityId: cId } })).toBe(0);
  });

  it('two rows on the same date are a DUPLICATE_DATE violation, not a silent last-wins', async () => {
    const res = await upload('sa', csv(`ahu_name,scheduled_date,tolerance_days\n${C},${YEAR}-04-04,0\n${C},04-04-${YEAR},0\n`));
    const r = res.json();
    expect(r.imported).toBe(0);
    expect(r.details.skipped.some((s: any) => s.reason.includes(`Two visits are scheduled on the same date (${YEAR}-04-04)`))).toBe(true);
  });
});

describe('approval state depends on who uploads and on the workflow', () => {
  it('workflow OFF, non-SUPER_ADMIN uploader → PENDING with submitter attribution and no approver', async () => {
    const res = await upload('upl', csv(`ahu_name,scheduled_date,tolerance_days\n${D},${YEAR}-01-05,1\n`));
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(1);
    const [e] = await entriesOf(dId);
    expect(e).toMatchObject({ approvalStatus: 'PENDING', submittedBy: upl.id, submittedByName: upl.username, approvedBy: null, approvedAt: null });
    // A single-entry upload carries no batch tag.
    const q = await prisma.qualityNotification.findFirst({ where: { pmScheduleEntryId: e.id } });
    expect(q?.message).toBe(`Uploaded — ${D} (${YEAR}-01-05)`);
  });

  it('workflow ON → PENDING_REVIEW even for SUPER_ADMIN, and the QNN routes to the review role', async () => {
    const reviewRole = fx.roleName('NOTE'); // any role name we own works as the configured reviewer
    cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: '', reviewRole, approvalRole: 'SOME_QA' });
    const res = await upload('sa', csv(`ahu_name,scheduled_date,tolerance_days\n${D},${YEAR}-03-05,1\n${D},${YEAR}-05-05,1\n`));
    expect(res.json().imported).toBe(2);
    const added = (await entriesOf(dId)).filter((e) => [`${YEAR}-03-05`, `${YEAR}-05-05`].includes(iso(e.plannedDate)));
    expect(added).toHaveLength(2);
    for (const e of added) expect(e).toMatchObject({ approvalStatus: 'PENDING_REVIEW', submittedBy: sa.id, approvedBy: null });
    const qnns = await prisma.qualityNotification.findMany({ where: { pmScheduleEntryId: { in: added.map((e) => e.id) } } });
    for (const q of qnns) {
      expect(q.message).toContain('(pending review)');
      // Both visits are the same AHU: the tag counts visits but does not list AHUs.
      expect(q.message).toMatch(/\[batch B-[0-9A-F]{6}, [12] of 2\]$/);
    }
    const notes = await prisma.notification.findMany({ where: { type: 'PM_SCHEDULE_QNN', forRole: reviewRole } });
    expect(notes.length).toBe(2);
    expect(notes[0].message).toMatch(/Action: Uploaded \(UPLOAD\)/);
  });
});

describe('XLSX import — cell shapes', () => {
  it('reads rich text, hyperlinks, formula results, Date cells and Excel serials; rejects junk tolerance cells', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Visits');
    ws.addRow(['ahu_name', 'scheduled_date', 'tolerance_days', '  ', 'remarks']);
    const serial = (Date.UTC(YEAR, 7, 25) - Date.UTC(1899, 11, 30)) / DAY; // 25 Aug
    ws.addRow([{ richText: [{ text: `${fx.tag}-` }, { text: 'UC' }] }, new Date(Date.UTC(YEAR, 7, 1)), { formula: '1+1', result: 2 }, null, 'rich']);
    ws.addRow([{ text: C, hyperlink: 'https://example.invalid/ahu' }, serial, null, null, 'serial + default tol']);
    ws.addRow([C, new Date(Date.UTC(YEAR, 10, 11)), { error: '#N/A' }, null, 'error cell']);
    ws.addRow([C, new Date(Date.UTC(YEAR, 11, 1)), true, null, 'boolean cell']);
    const res = await upload('sa', { name: 'Visits.XLSX', content: Buffer.from(await wb.xlsx.writeBuffer()) });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.details.imported.map((x: any) => [x.row, x.ahuName, x.plannedDate])).toEqual([
      [2, C, `${YEAR}-08-01`], [3, C, `${YEAR}-08-25`],
    ]);
    expect(Object.fromEntries(r.details.skipped.map((s: any) => [s.row, s.reason]))).toEqual({
      4: 'Invalid tolerance_days "[object Object]" — expected 0-365',
      5: 'Invalid tolerance_days "true" — expected 0-365',
    });
    const c = await entriesOf(cId);
    expect(c.map((e) => [iso(e.plannedDate), e.toleranceDays])).toEqual([[`${YEAR}-08-01`, 2], [`${YEAR}-08-25`, 3]]);
  });
});

describe('column-name variants and short rows', () => {
  it('accepts the friendly header spellings, and a row missing its trailing cells takes the default tolerance', async () => {
    const files = [
      `AHU Name,Scheduled Date,Tolerance Days\n${D},${YEAR}-07-07,1\n`,
      `ahuName,scheduledDate,toleranceDays\n${D},${YEAR}-08-08,1\n${D},${YEAR}-09-09\n`,
      `AHU,date\n${D},${YEAR}-10-10\n`,
    ];
    for (const text of files) {
      const res = await upload('sa', csv(text));
      expect(res.statusCode, text).toBe(200);
      expect(res.json().skipped, text).toBe(0);
    }
    const added = (await entriesOf(dId)).filter((e) => e.plannedDate >= new Date(Date.UTC(YEAR, 6, 1)));
    expect(added.map((e) => [iso(e.plannedDate), e.toleranceDays])).toEqual([
      [`${YEAR}-07-07`, 1], [`${YEAR}-08-08`, 1], [`${YEAR}-09-09`, 3], [`${YEAR}-10-10`, 3],
    ]);
  });
});
