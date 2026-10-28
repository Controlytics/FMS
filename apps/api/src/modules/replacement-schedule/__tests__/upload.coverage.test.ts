/**
 * Replacement schedule — template, dry-run validation, upload and export,
 * through the real routes (/api/replacement-schedules, as app.ts mounts them).
 *
 * The workbook is built here with ExcelJS and posted as multipart, so the
 * parser sees exactly what an operator's spreadsheet would give it (rich text,
 * hyperlinks, formulas, error cells, real Date cells). Every row-level rule in
 * service.ts is asserted by the error the operator would read.
 *
 * Owns: a BLOCK + two AHUs + typed filters, its users/roles, and the
 * `replacement-schedule-approval` + `replacement-schedule` config rows
 * (snapshotted, restored exactly). Re-auth keys are merged for this file's
 * own role only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import replacementScheduleRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import { getDatetimeConfig, formatDateWith } from '../../../lib/format-datetime.js';
import {
  cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix, addReauth, removeReauth,
  createHierarchy, deleteHierarchy, deleteFilters, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoRsUp@2026!x';
const ROLE_UP = `cvoRU${S}`;    // upload + view, in uploadRole, re-auth on upload/export
const ROLE_UP2 = `cvoRX${S}`;   // upload permission but NOT in uploadRole
const ROLE_VIEW = `cvoRV${S}`;  // view only
const ROLE_NONE = `cvoRN${S}`;
const U = {
  sa: `cvorsa${S}`.toLowerCase(), up: `cvorup${S}`.toLowerCase(), up2: `cvorux${S}`.toLowerCase(),
  view: `cvorvw${S}`.toLowerCase(), none: `cvornn${S}`.toLowerCase(),
};
const ids: Record<string, string> = {};
const tok: Record<string, string> = {};
let app: FastifyInstance;
let hier: Awaited<ReturnType<typeof createHierarchy>> | undefined;
let ahu2Id = '';
const filterIds: string[] = [];
let AHU = '';
let AHU2 = '';
const cfgSnap: Record<string, any> = {};
let added: ReauthGrant = [];
const FUTURE = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })();
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const HEADERS = ['S.No', 'AHU Name', 'Filter Micron', 'Filter Dimensions', 'Qty', 'Schedule Date', 'Tolerance Days'];

async function xlsx(rows: unknown[][], opts: { headers?: string[]; sheets?: string[]; target?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const name of opts.sheets ?? []) wb.addWorksheet(name).addRow(['decoy']);
  const ws = wb.addWorksheet(opts.target ?? 'Replacements');
  ws.addRow(opts.headers ?? HEADERS);
  for (const r of rows) ws.addRow(r as any[]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipart(file: Buffer | null, fileName = 'sched.xlsx') {
  const B = '----cvoreplupload';
  const parts: Buffer[] = [Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="note"\r\n\r\nx\r\n`)];
  if (file) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
    parts.push(file, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${B}` };
}

async function send(path: '/validate' | '', token: string, file: Buffer | null, opts: { pw?: string; fileName?: string } = {}) {
  const { payload, contentType } = multipart(file, opts.fileName);
  return app.inject({
    method: 'POST', url: `/api/replacement-schedules${path}`, payload,
    headers: { 'content-type': contentType, authorization: `Bearer ${token}`, ...(opts.pw ? { 'x-reauth-password': opts.pw } : {}) },
  });
}

async function setApproval(v: Record<string, unknown>) {
  await prisma.systemConfig.upsert({
    where: { configKey: 'replacement-schedule-approval' },
    update: { configValue: v as any },
    create: { configKey: 'replacement-schedule-approval', configValue: v as any, configType: 'workflow' },
  });
}

async function mySchedules() {
  return prisma.replacementSchedule.findMany({ where: { fileName: { startsWith: `cvo-${S}` } }, include: { entries: true } });
}

beforeAll(async () => {
  for (const k of ['replacement-schedule-approval', 'replacement-schedule']) {
    cfgSnap[k] = await prisma.systemConfig.findUnique({ where: { configKey: k } });
  }
  await createRole(ROLE_UP, ['REPLACEMENT_SCHEDULE_UPLOAD', 'REPLACEMENT_SCHEDULE_VIEW']);
  await createRole(ROLE_UP2, ['REPLACEMENT_SCHEDULE_UPLOAD']);
  await createRole(ROLE_VIEW, ['REPLACEMENT_SCHEDULE_VIEW']);
  await createRole(ROLE_NONE, []);
  ids.sa = await createUser(U.sa, 'SUPER_ADMIN', PW);
  ids.up = await createUser(U.up, ROLE_UP, PW);
  ids.up2 = await createUser(U.up2, ROLE_UP2, PW);
  ids.view = await createUser(U.view, ROLE_VIEW, PW);
  ids.none = await createUser(U.none, ROLE_NONE, PW);
  added = await addReauth([['UPLOAD_REPLACEMENT_SCHEDULE', ROLE_UP], ['EXPORT_REPLACEMENT_SCHEDULE', ROLE_UP]]);
  await setApproval({ workflowEnabled: true, uploadRole: [ROLE_UP], reviewRole: '', approvalRole: '' });

  hier = await createHierarchy(`cvoR${S}`);
  AHU = `cvoR${S}-AHU`;
  AHU2 = `cvoR${S}-AHU2`;
  ahu2Id = (await prisma.assetInstance.create({ data: { name: AHU2, templateId: hier.ahuTemplateId, parentId: hier.blockId } })).id;
  const mk = async (name: string, attributes: Record<string, unknown>) => {
    const f = await prisma.filter.create({ data: { ahuId: hier!.ahuId, name, status: 'Active', attributes } as any });
    filterIds.push(f.id);
  };
  await mk(`cvoR${S}-F1`, { micronSize: '10', filterSize: '610x610x150' });
  await mk(`cvoR${S}-F2`, { micronSize: '10', filterSize: '610 X 610 x 150' });
  await mk(`cvoR${S}-F3`, { micronSize: '5', filterSize: '300*300*50' });
  await mk(`cvoR${S}-F4`, { micronSize: '10' });          // no size → counted, no combo
  await mk(`cvoR${S}-F5`, { filterSize: '1x1x1' });       // no micron
  await mk(`cvoR${S}-F6`, { micronSize: '10', filterSize: '610x610x150' }); // retired below → not counted
  await prisma.filter.update({ where: { id: filterIds[5] }, data: { status: 'Retired' } as any });
  // A micron-10 filter still waiting for approval: not counted until approved (2026-10-26).
  filterIds.push((await prisma.assetInstance.create({ data: {
    name: `cvoR${S}-F7`, templateId: hier.filterTemplateId, parentId: hier.ahuId, status: 'Active',
    approvalStatus: 'PENDING_REVIEW', attributes: { micronSize: '10', filterSize: '610x610x150' },
  } })).id);
  // An orphan filter (no AHU) must not break the per-AHU index.
  filterIds.push((await prisma.filter.create({ data: { ahuId: null, name: `cvoR${S}-ORPHAN`, status: 'Active', attributes: { micronSize: '10', filterSize: '610x610x150' } } as any })).id);

  app = await buildApp([{ plugin: replacementScheduleRoutes, prefix: '/api/replacement-schedules' }]);
  for (const k of Object.keys(U) as Array<keyof typeof U>) tok[k] = await login(app, U[k], PW);
}, 60_000);

afterAll(async () => {
  const sch = await prisma.replacementSchedule.findMany({ where: { fileName: { startsWith: `cvo-${S}` } }, select: { id: true } });
  const schIds = sch.map((s) => s.id);
  await cleanupAll([
    ['qnn', () => prisma.qualityNotification.deleteMany({ where: { scheduleId: { in: schIds } } })],
    ['qnn notifications', () => prisma.notification.deleteMany({ where: { type: 'PM_SCHEDULE_QNN', OR: schIds.map((id) => ({ metadata: { path: ['scheduleId'], equals: id } })) } })],
    ['schedules', () => prisma.replacementSchedule.deleteMany({ where: { id: { in: schIds } } })],
    ['filters', () => deleteFilters(filterIds)],
    ['ahu2', () => prisma.assetInstance.deleteMany({ where: { id: ahu2Id } })],
    ['hierarchy', () => deleteHierarchy(hier)],
    ['config', async () => {
      for (const k of ['replacement-schedule-approval', 'replacement-schedule']) {
        const s = cfgSnap[k];
        if (s) await prisma.systemConfig.update({ where: { configKey: k }, data: { configValue: s.configValue, configType: s.configType } });
        else await prisma.systemConfig.deleteMany({ where: { configKey: k } });
      }
    }],
    ['reauth', () => removeReauth(added)],
    ['users', () => deleteUsers(Object.values(ids))],
    ['roles', () => deleteRoles([ROLE_UP, ROLE_UP2, ROLE_VIEW, ROLE_NONE])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('GET /template.xlsx', () => {
  it('serves the upload template with a live AHU dropdown (hidden list sheet)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/replacement-schedules/template.xlsx', headers: { authorization: `Bearer ${tok.view}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toBe('attachment; filename="replacement-schedule-template.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as any);
    const ws = wb.getWorksheet('Replacements')!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS);
    expect(ws.getCell('B1').note).toBeTruthy();
    // D-OPS-9 (operator decision 2026-10-22): no setting supplies a default; a
    // blank tolerance is 0 days, and the template says so.
    expect(ws.getCell('G1').note).toBe('Optional. +/- days window. Blank = 0 days.');
    const lists = wb.getWorksheet('_lists')!;
    expect(lists.state).toBe('veryHidden');
    const names: string[] = [];
    lists.getColumn(1).eachCell((c) => names.push(String(c.value)));
    expect(names).toEqual(expect.arrayContaining([AHU, AHU2]));
    expect(ws.getCell('B2').dataValidation).toMatchObject({ type: 'list', formulae: [`_lists!$A$1:$A$${names.length}`] });
    expect(ws.getCell('A2').dataValidation).toBeUndefined();
  });

  it('a role with upload-only permission may download it; a role with neither is refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/replacement-schedules/template.xlsx', headers: { authorization: `Bearer ${tok.up2}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/replacement-schedules/template.xlsx', headers: { authorization: `Bearer ${tok.none}` } })).statusCode).toBe(403);
  });
});

describe('POST /validate — file-level refusals', () => {
  it('no file part → 400 VALIDATION', async () => {
    const res = await send('/validate', tok.sa, null);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'VALIDATION', message: 'A file is required' });
  });

  it.each([
    ['not an xlsx at all', async () => Buffer.from('this is not a zip'), 'Invalid .xlsx file'],
    ['no AHU Name column', () => xlsx([['1']], { headers: ['S.No', 'Schedule Date'] }), 'Template is missing an "AHU Name" column'],
    ['no Schedule Date column', () => xlsx([['1']], { headers: ['S.No', 'AHU'] }), 'Template is missing a "Schedule Date" column'],
    ['a header row and no data', () => xlsx([]), 'No data rows found'],
    ['a workbook with no sheets', async () => Buffer.from(await new ExcelJS.Workbook().xlsx.writeBuffer()), 'Workbook has no readable sheet'],
    ['more than 500 rows', () => xlsx(Array.from({ length: 501 }, (_, i) => [i + 1, AHU, '10', '610x610x150', 2, FUTURE])), 'Maximum 500 rows per upload'],
  ])('%s', async (_label, build, error) => {
    const res = await send('/validate', tok.sa, await build());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, created: 0, failed: 1, results: [{ row: 1, status: 'error', error }] });
    expect(internalErrors).toEqual([]);
  });

  it('only the configured uploadRole may validate (FORBIDDEN_ROLE), the permission alone is not enough', async () => {
    const res = await send('/validate', tok.up2, await xlsx([[1, AHU, '10', '610x610x150', 2, FUTURE]]));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN_ROLE');
  });

  it('a view-only role cannot validate', async () => {
    const res = await send('/validate', tok.view, await xlsx([]));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});

describe('POST /validate — every row rule, reported per row and column', () => {
  let results: any[] = [];
  let body: any;

  beforeAll(async () => {
    const past = '2020-01-01';
    const rows: unknown[][] = [
      /* r2  */ [1, AHU, '10', '610 X 610 * 150', 3, FUTURE, ''],
      /* r3  */ [2, '', '10', '610x610x150', 2, FUTURE],
      /* r4  */ [3, `cvoR${S}-NOPE`, '10', '610x610x150', 2, FUTURE],
      /* r5  */ [4, AHU, '10', '610x610x150', '', FUTURE],
      /* r6  */ [5, AHU, '10', '610x610x150', 'abc', FUTURE],
      /* r7  */ [6, AHU, '10', '610x610x150', 3, ''],
      /* r8  */ [7, AHU, '10', '610x610x150', 3, '2026-02-30'],
      /* r9  */ [8, AHU, '10', '610x610x150', 3, past],
      /* r10 */ [9, AHU, '10', '610x610x150', 3, FUTURE, '-1'],
      /* r11 */ [10, AHU, '', '', 2, FUTURE],
      /* r12 */ [11, AHU2, '10', '610x610x150', 2, FUTURE],
      /* r13 */ [12, AHU, '99', '610x610x150', 2, FUTURE],
      /* r14 */ [13, AHU, '10', '1x2x3', 3, FUTURE],
      /* r15 */ [14, AHU, '10', '610x610x150', 4, FUTURE],
      // ExcelJS cell shapes: rich text AHU, hyperlink micron, formula qty, real Date, tolerance 4.
      /* r16 */ ['x', { richText: [{ text: `cvoR${S}` }, { text: '-AHU' }] }, { text: '5', hyperlink: 'http://x' }, '300x300x50', { formula: '0+1', result: 1 }, new Date(`${FUTURE}T00:00:00Z`), 4],
      /* r17 */ [16, AHU, '10', { error: '#N/A' }, 3, FUTURE],
    ];
    const res = await send('/validate', tok.sa, await xlsx(rows));
    expect(res.statusCode).toBe(200);
    body = res.json();
    results = body.results;
  }, 60_000);

  const errs = (row: number) => results.filter((r) => r.row === row && r.status === 'error').map((r) => ({ column: r.column, error: r.error }));

  it('valid rows pass, a real Date / formula / rich text / hyperlink read; dimensions are information only (any value, or none)', () => {
    expect(results.filter((r) => r.status === 'success').map((r) => [r.row, r.ahuName])).toEqual([[2, AHU], [14, AHU], [16, AHU], [17, AHU]]);
  });

  it('AHU: required, must exist, must have filters', () => {
    expect(errs(3)).toEqual([{ column: 'AHU Name', error: 'AHU Name is required' }]);
    expect(errs(4)).toEqual([{ column: 'AHU Name', error: `No AHU named "cvoR${S}-NOPE"` }]);
    expect(errs(12)).toEqual([{ column: 'AHU Name', error: `AHU "${AHU2}" has no approved filters to replace` }]);
  });

  // Matched on micron alone (operator 2026-10-26): F1, F2 and F4 (no size) are
  // micron 10; F6 is retired and F7 awaits approval, so neither counts.
  it('Qty: required, whole number >= 1, equal to the approved filters of that micron (retired and unapproved excluded)', () => {
    expect(errs(5)).toEqual([{ column: 'Qty', error: 'Qty is required' }]);
    expect(errs(6)).toEqual([{ column: 'Qty', error: 'Qty must be a whole number >= 1' }]);
    expect(errs(15)).toEqual([{ column: 'Qty', error: `Qty 4 must equal the 3 approved filter(s) with micron 10 in AHU "${AHU}"` }]);
  });

  it('Schedule Date: required, a real calendar day, not in the past', () => {
    expect(errs(7)).toEqual([{ column: 'Schedule Date', error: 'Schedule Date is required' }]);
    expect(errs(8)).toEqual([{ column: 'Schedule Date', error: 'Schedule Date must be a valid date (YYYY-MM-DD)' }]);
    expect(errs(9)).toEqual([{ column: 'Schedule Date', error: 'Schedule Date cannot be in the past' }]);
  });

  it('Tolerance, micron and dimensions', () => {
    expect(errs(10)).toEqual([{ column: 'Tolerance Days', error: 'Tolerance Days must be a whole number >= 0' }]);
    expect(errs(11)).toEqual([{ column: 'Filter Micron', error: 'Filter Micron is required' }]);
    expect(errs(13)).toEqual([{ column: 'Filter Micron', error: `Micron "99" not found in AHU "${AHU}"` }]);
    // Dimensions are neither required nor checked: a size no filter has passes.
    expect(errs(14)).toEqual([]);
    // An Excel error cell reads as blank, never as "[object Object]".
    expect(errs(17)).toEqual([]);
    expect(body.rows[15].filterSize).toBe('');
  });

  it('results are sorted by row, failed counts every error, nothing is written, and the parsed rows are echoed', async () => {
    expect(results.map((r) => r.row)).toEqual([...results.map((r) => r.row)].sort((a, b) => a - b));
    expect(body.failed).toBe(results.filter((r) => r.status === 'error').length);
    expect(body.created).toBe(0);
    expect(body.rows).toHaveLength(16);
    expect(body.rows[14]).toMatchObject({ slNo: 'x', ahuName: AHU, filterMicron: '5', qty: '1', scheduleDate: FUTURE, toleranceDays: '4' });
    expect(await prisma.replacementScheduleEntry.count({ where: { ahuId: hier!.ahuId } })).toBe(0);
  });

  it('reads the "Replacements" sheet even when it is not the first sheet; header aliases are accepted', async () => {
    const buf = await xlsx([[AHU, '5', '300x300x50', 1, FUTURE]], { headers: ['AHU', 'Micron', 'Size', 'Quantity', 'Date'], sheets: ['Readme'] });
    const res = await send('/validate', tok.sa, buf);
    expect(res.json().results).toEqual([{ row: 2, status: 'success', ahuName: AHU }]);
  });

  it('ignores data under a column it does not recognise', async () => {
    const buf = await xlsx([[AHU, '5', '300x300x50', 1, FUTURE, 'free text note']], { headers: ['AHU Name', 'Filter Micron', 'Filter Dimensions', 'Qty', 'Schedule Date', 'Notes'] });
    const res = await send('/validate', tok.sa, buf);
    expect(res.json().results).toEqual([{ row: 2, status: 'success', ahuName: AHU }]);
    expect(res.json().rows[0]).not.toHaveProperty('Notes');
  });

  it('falls back to the first sheet when there is no "Replacements" sheet', async () => {
    const buf = await xlsx([[AHU, '5', '300x300x50', 1, FUTURE]], { headers: ['AHU Name', 'Filter Micron', 'Dimensions', 'Count', 'Schedule Date'], target: 'Sheet1' });
    const res = await send('/validate', tok.sa, buf);
    expect(res.json().failed).toBe(0);
  });
});

describe('POST / — create (all-or-nothing, workflow, re-auth, audit, QNN)', () => {
  it('a file with ANY invalid row creates nothing', async () => {
    const buf = await xlsx([[1, AHU, '5', '300x300x50', 1, FUTURE], [2, AHU, '10', '610x610x150', 9, FUTURE]]);
    const res = await send('', tok.sa, buf, { fileName: `cvo-${S}-bad.xlsx`, pw: PW });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: false, created: 0, failed: 1 });
    expect(res.json().results.map((r: any) => r.status)).toEqual(['error']);
    expect((await mySchedules()).filter((s) => s.fileName === `cvo-${S}-bad.xlsx`)).toHaveLength(0);
  });

  it('no file part → 400', async () => {
    const res = await send('', tok.sa, null, { pw: PW });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION');
  });

  it('the uploader role must re-authenticate; without the password nothing is created', async () => {
    const buf = await xlsx([[1, AHU, '5', '300x300x50', 1, FUTURE]]);
    const res = await send('', tok.up, buf, { fileName: `cvo-${S}-noreauth.xlsx` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPLOAD_REPLACEMENT_SCHEDULE' });
    expect((await mySchedules()).filter((s) => s.fileName === `cvo-${S}-noreauth.xlsx`)).toHaveLength(0);
  });

  it('workflow ON: entries land PENDING_REVIEW with the ± tolerance window; audited (signed) + QNN minted', async () => {
    const buf = await xlsx([
      ['7', AHU, '10', '610x610x150', 3, FUTURE, 5],
      ['n/a', AHU, '5', '300x300x50', 1, FUTURE],
    ]);
    const res = await send('', tok.up, buf, { fileName: `cvo-${S}-wf.xlsx`, pw: PW });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ success: true, created: 2, failed: 0 });
    expect(body.results).toEqual([{ row: 2, status: 'success', ahuName: AHU }, { row: 3, status: 'success', ahuName: AHU }]);

    const sch = await prisma.replacementSchedule.findUnique({ where: { id: body.scheduleId }, include: { entries: { orderBy: { filterMicron: 'asc' } } } });
    expect(sch).toMatchObject({ fileName: `cvo-${S}-wf.xlsx`, status: 'ACTIVE', uploadedBy: ids.up, uploadedByName: U.up });
    const [e10, e5] = sch!.entries;
    expect(e10).toMatchObject({ slNo: 7, ahuId: hier!.ahuId, ahuName: AHU, filterMicron: '10', filterSize: '610x610x150', qty: 3, toleranceDays: 5, approvalStatus: 'PENDING_REVIEW', status: 'PENDING', submittedBy: ids.up });
    expect(e10.windowStart.toISOString().slice(0, 10)).toBe(addDays(FUTURE, -5));
    expect(e10.windowEnd.toISOString().slice(0, 10)).toBe(addDays(FUTURE, 5));
    expect(e5).toMatchObject({ slNo: null, toleranceDays: 0 });

    const audit = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_UPLOADED', targetId: body.scheduleId } });
    expect(audit).toBeTruthy();
    expect(audit!.afterValue).toEqual({
      fileName: `cvo-${S}-wf.xlsx`, entries: 2,
      ahus: [`AHU: ${AHU} · Size: 610x610x150 · Micron: 10µ · Qty: 3`, `AHU: ${AHU} · Size: 300x300x50 · Micron: 5µ · Qty: 1`],
    });
    expect(audit!.reason).toBe('Uploaded replacement schedule with 2 entries');
    const sig = await prisma.auditTrail.findFirst({ where: { action: 'REAUTH_SUCCESS', userId: U.up }, orderBy: { chainPosition: 'desc' } });
    expect((audit as any).signatureAuditId).toBe(sig!.id);

    const qnn = await prisma.qualityNotification.findMany({ where: { scheduleId: body.scheduleId } });
    expect(qnn).toHaveLength(1);
    expect(qnn[0]).toMatchObject({ action: 'UPLOAD', performedBy: ids.up });
    expect(qnn[0].message).toBe('Replacement schedule uploaded with 2 rows. Waiting for review.');
  });

  // 2026-10-24 (operator: a Super Admin's own work is not held, lib/super-admin-own-work.ts).
  it('workflow ON, Super Admin uploader: entries APPROVED at once, the audit row records REPLACEMENT_REVIEW, the QNN does not say "pending review"', async () => {
    await setApproval({ workflowEnabled: true, uploadRole: [], reviewRole: '', approvalRole: '' });
    try {
      const res = await send('', tok.sa, await xlsx([[1, AHU, '5', '300x300x50', 1, FUTURE]]), { fileName: `cvo-${S}-sa.xlsx`, pw: PW });
      expect(res.json()).toMatchObject({ success: true, created: 1 });
      const e = await prisma.replacementScheduleEntry.findFirst({ where: { scheduleId: res.json().scheduleId } });
      expect(e).toMatchObject({ approvalStatus: 'APPROVED', submittedBy: ids.sa, reviewedBy: null, approvedBy: null });
      const audit = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_UPLOADED', targetId: res.json().scheduleId } });
      expect(audit!.afterValue).toMatchObject({ entries: 1, superAdminExemptGates: ['REPLACEMENT_REVIEW'] });
      const qnn = await prisma.qualityNotification.findFirst({ where: { scheduleId: res.json().scheduleId } });
      expect(qnn!.message).toBe('Replacement schedule uploaded with 1 row. Approved at once (Super Admin).');
    } finally {
      await setApproval({ workflowEnabled: true, uploadRole: [ROLE_UP], reviewRole: '', approvalRole: '' });
    }
  });

  it('workflow OFF: entries are APPROVED at once; a single entry reads "1 entry"; a blank tolerance is 0 days', async () => {
    await setApproval({ workflowEnabled: false, uploadRole: [], reviewRole: '', approvalRole: '' });
    // A `replacement-schedule` row is planted on purpose: no config def writes
    // that key, and a blank tolerance must be 0 days whatever such a row holds
    // (D-OPS-9, operator decision 2026-10-22).
    await prisma.systemConfig.upsert({
      where: { configKey: 'replacement-schedule' },
      update: { configValue: { value: { defaultToleranceDays: 3.7 } } as any },
      create: { configKey: 'replacement-schedule', configValue: { value: { defaultToleranceDays: 3.7 } } as any, configType: 'workflow' },
    });
    try {
      const res = await send('', tok.sa, await xlsx([[1, AHU, '5', '300x300x50', 1, FUTURE]]), { fileName: `cvo-${S}-off.xlsx`, pw: PW });
      expect(res.json()).toMatchObject({ success: true, created: 1 });
      const e = await prisma.replacementScheduleEntry.findFirst({ where: { scheduleId: res.json().scheduleId } });
      expect(e).toMatchObject({ approvalStatus: 'APPROVED', toleranceDays: 0 });
      expect(e!.windowStart.toISOString().slice(0, 10)).toBe(FUTURE);
      expect(e!.windowEnd.toISOString().slice(0, 10)).toBe(FUTURE);
      const audit = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_UPLOADED', targetId: res.json().scheduleId } });
      expect(audit!.reason).toBe('Uploaded replacement schedule with 1 entry');
      const qnn = await prisma.qualityNotification.findFirst({ where: { scheduleId: res.json().scheduleId } });
      expect(qnn!.message).toBe('Replacement schedule uploaded with 1 row. Approved at once (Super Admin).');
    } finally {
      await setApproval({ workflowEnabled: true, uploadRole: [ROLE_UP], reviewRole: '', approvalRole: '' });
    }
  });

});

describe('GET / and GET /export.xlsx', () => {
  it('the list returns this file\'s schedules with each entry\'s computed status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/replacement-schedules', headers: { authorization: `Bearer ${tok.view}` } });
    expect(res.statusCode).toBe(200);
    const mine = res.json().data.filter((s: any) => s.fileName === `cvo-${S}-wf.xlsx`);
    expect(mine).toHaveLength(1);
    expect(mine[0].entries.every((e: any) => e.computedStatus === 'PENDING')).toBe(true);
  });

  it('export needs the re-auth password, then returns the trail as .xlsx with labelled statuses + configured date format', async () => {
    const denied = await app.inject({ method: 'GET', url: '/api/replacement-schedules/export.xlsx', headers: { authorization: `Bearer ${tok.up}` } });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error).toBe('REAUTH_REQUIRED');

    const res = await app.inject({ method: 'GET', url: '/api/replacement-schedules/export.xlsx', headers: { authorization: `Bearer ${tok.up}`, 'x-reauth-password': PW } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="replacement-schedule.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as any);
    const ws = wb.getWorksheet('Replacement Schedule')!;
    // Qty is the row's Qty today, the uploaded one beside it (2026-10-26).
    expect([5, 6, 7, 12].map((c) => ws.getRow(1).getCell(c).value)).toEqual(['Qty', 'Uploaded Qty', 'Replaced', 'Status']);
    const rows: any[] = [];
    ws.eachRow((r, n) => { if (n > 1 && r.getCell(2).value === AHU) rows.push(r); });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const statuses = rows.map((r) => r.getCell(12).value);
    expect(statuses).toEqual(expect.arrayContaining(['To Review', 'Approved']));
    const entry = await prisma.replacementScheduleEntry.findFirst({ where: { ahuId: hier!.ahuId, slNo: 7 } });
    const row7 = rows.find((r) => r.getCell(1).value === 7);
    expect(row7.getCell(8).value).toBe(formatDateWith(await getDatetimeConfig(), entry!.scheduleDate));
    expect(row7.getCell(13).value).toBe(U.up);
    expect([row7.getCell(5).value, row7.getCell(6).value, row7.getCell(7).value]).toEqual([3, 3, 0]);
  });

  it('export renders blanks (never "null") for an entry with no micron / size / uploader name', async () => {
    const sch = await prisma.replacementSchedule.create({ data: { fileName: `cvo-${S}-raw.xlsx`, status: 'ACTIVE', uploadedBy: ids.sa, uploadedByName: null } });
    const now = new Date();
    await prisma.replacementScheduleEntry.create({ data: {
      scheduleId: sch.id, slNo: null, ahuId: hier!.ahuId, ahuName: `cvoR${S}-RAWAHU`, filterMicron: null, filterSize: null, qty: 1,
      scheduleDate: now, toleranceDays: 0, windowStart: now, windowEnd: now, status: 'PENDING', approvalStatus: 'REJECTED',
      rejectionStage: 'REVIEW', rejectedByName: 'someone', reviewRemarks: 'see notes',
    } as any });
    const res = await app.inject({ method: 'GET', url: '/api/replacement-schedules/export.xlsx', headers: { authorization: `Bearer ${tok.sa}`, 'x-reauth-password': PW } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as any);
    let row: any;
    wb.getWorksheet('Replacement Schedule')!.eachRow((r) => { if (r.getCell(2).value === `cvoR${S}-RAWAHU`) row = r; });
    expect(row).toBeTruthy();
    expect([row.getCell(3).text, row.getCell(4).text, row.getCell(13).text]).toEqual(['', '', '']);
    expect(typeof row.getCell(1).value).toBe('number');
    expect([row.getCell(12).value, row.getCell(18).value, row.getCell(19).value, row.getCell(20).value]).toEqual(['Rejected', 'someone', 'REVIEW', 'see notes']);
  });

  it('the list and export need REPLACEMENT_SCHEDULE_VIEW', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/replacement-schedules', headers: { authorization: `Bearer ${tok.up2}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/replacement-schedules/export.xlsx', headers: { authorization: `Bearer ${tok.none}` } })).statusCode).toBe(403);
  });
});
