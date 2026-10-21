/**
 * PM schedule defects found by the 2026-10-21 coverage campaign (cov-api-pm
 * report D1-D9) plus two found while fixing them (D10, D11). Each test asserts
 * the CORRECT behaviour and failed before its fix.
 *
 * D2 and D4b were operator decisions (2026-10-21): an approved visit stays in
 * force while a change to its date waits (and a rejected change leaves it
 * approved), and the missed-PM gate needs EVERY counted filter, like My Tasks.
 *
 * Real Prisma on digilog_test_db; PM config is served in-process (pm-fixtures).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import filterOperationsRoutes from '../modules/filter-operations/routes.js';
import { getPendingEarlierPmTasks } from '../modules/pm-schedules/pm-pending-tasks.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, utcDay, iso, DAY, multipartBody, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMD');
const T = utcDay(0);
const at = (d: number, h = 0) => new Date(T.getTime() + d * DAY + h * 3_600_000);
const WORKFLOW_OFF = { workflowEnabled: false, uploadRole: '', reviewRole: '', approvalRole: '' };
const WORKFLOW_ON = { workflowEnabled: true, uploadRole: '', reviewRole: '', approvalRole: '' };

let app: FastifyInstance;
let cfg: ConfigOverrides;
let blockId = '';
const users: Record<string, { id: string; username: string; token: string }> = {};

const as = (who: string, method: string, url: string, payload?: unknown) =>
  app.inject({
    method: method as any,
    url: `/api/pm-schedules${url}`,
    headers: { authorization: `Bearer ${users[who].token}` },
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });

const upload = (name: string, content: Buffer) => {
  const { payload, contentType } = multipartBody({ name, content });
  return app.inject({
    method: 'POST', url: '/api/pm-schedules/upload',
    headers: { authorization: `Bearer ${users.sa.token}`, 'content-type': contentType }, payload,
  });
};

beforeAll(async () => {
  app = await buildApp([
    { plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' },
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
  ]);
  const note = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides(defaultPmConfig(note));
  // Three people, so separation of duties never blocks a step under test:
  // `sa` submits/edits, `rev` reviews, `apr` approves.
  for (const key of ['sa', 'rev', 'apr']) {
    const u = await fx.user(key, 'SUPER_ADMIN');
    users[key] = { ...u, token: await fx.login(app, u.username) };
  }
  blockId = await fx.instance('BLOCK', 'BLOCK');
}, 120_000);

afterAll(async () => { await fx.cleanup(app); }, 120_000);

describe('D1 - the overdue sweep respects a written-off visit', () => {
  it('opens no deviation for a written-off visit, before or after a later PM cleaning', async () => {
    const ahu = await fx.instance('AHU', 'D1a', { parentId: blockId });
    const flt = await fx.filter('d1a-f', ahu);
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{
      plannedDate: at(-15), toleranceDays: 5,
      extra: { skippedAt: at(-1), skipReason: 'written off at cleaning start', skippedByName: users.sa.username },
    }]);
    expect((await as('sa', 'POST', '/deviations/sweep')).statusCode).toBe(200);
    expect(await prisma.deviation.findUnique({ where: { pmScheduleEntryId: s.entryIds[0] } })).toBeNull();

    // The cleaning that prompted the write-off must not later turn the visit
    // into a "completed late" deviation either.
    await fx.cycle(flt, users.sa.id, { status: 'COMPLETED', startedAt: at(0, -2), completedAt: at(0, -1) });
    await as('sa', 'POST', '/deviations/sweep');
    expect(await prisma.deviation.findUnique({ where: { pmScheduleEntryId: s.entryIds[0] } })).toBeNull();
  });

  it('closes an already-open deviation on a written-off visit as SKIPPED, never as completed', async () => {
    const ahu = await fx.instance('AHU', 'D1b', { parentId: blockId });
    const flt = await fx.filter('d1b-f', ahu);
    const reason = 'AHU shut down for retrofit';
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{
      plannedDate: at(-15), toleranceDays: 5,
      extra: { skippedAt: at(-1), skipReason: reason, skippedByName: users.sa.username },
    }]);
    // An OPEN row left from before the fix (the sweep used to open these).
    const dev = await prisma.deviation.create({
      data: {
        pmScheduleEntryId: s.entryIds[0], ahuId: ahu, ahuName: 'D1b', filterIds: [flt], filterCount: 1,
        scheduledDate: at(-15), windowStart: at(-20), windowEnd: at(-10), overdueDaysAtOpen: 3, status: 'OPEN',
      },
    });
    await fx.cycle(flt, users.sa.id, { status: 'COMPLETED', startedAt: at(0, -2), completedAt: at(0, -1) });

    await as('sa', 'POST', '/deviations/sweep');
    const after = await prisma.deviation.findUniqueOrThrow({ where: { id: dev.id } });
    expect(after).toMatchObject({ status: 'CLOSED', closureKind: 'SKIPPED', closureReason: reason, completedAt: null, delayDays: null });
    expect(after.closedAt).not.toBeNull();
  });

  it('a write-off that already closed its deviation causes no daily "could not be opened" alarm', async () => {
    const ahu = await fx.instance('AHU', 'D1c', { parentId: blockId });
    const flt = await fx.filter('d1c-f', ahu);
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{
      plannedDate: at(-15), toleranceDays: 5,
      extra: { skippedAt: at(-1), skipReason: 'not performed', skippedByName: users.sa.username },
    }]);
    const dev = await prisma.deviation.create({
      data: {
        pmScheduleEntryId: s.entryIds[0], ahuId: ahu, ahuName: 'D1c', filterIds: [flt], filterCount: 1,
        scheduledDate: at(-15), windowStart: at(-20), windowEnd: at(-10), overdueDaysAtOpen: 3,
        status: 'CLOSED', closureKind: 'SKIPPED', closureReason: 'not performed', closedAt: at(-1),
      },
    });
    await as('sa', 'POST', '/deviations/sweep');
    expect(await prisma.auditTrail.count({ where: { action: 'DEVIATION_OPEN_BLOCKED', targetId: dev.id } })).toBe(0);
  });
});

describe('D6 - the manual sweep names its actor by user id, not uuid', () => {
  it('records the username on the DEVIATION_OPENED audit row', async () => {
    const ahu = await fx.instance('AHU', 'D6', { parentId: blockId });
    await fx.filter('d6-f', ahu);
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    await as('sa', 'POST', '/deviations/sweep');
    const dev = await prisma.deviation.findUniqueOrThrow({ where: { pmScheduleEntryId: s.entryIds[0] } });
    const row = await prisma.auditTrail.findFirst({ where: { action: 'DEVIATION_OPENED', targetId: dev.id } });
    expect(row?.userId).toBe(users.sa.username);
  });
});

describe('D4a - the missed-PM gate honours the AHU filter-set mode', () => {
  it('a DISABLED AHU asks nothing (My Tasks and the sweep ignore it too)', async () => {
    const ahu = await fx.instance('AHU', 'D4dis', { parentId: blockId, customAttributes: { pmFilterSetMode: 'DISABLED' } });
    const flt = await fx.filter('d4dis-f', ahu);
    await fx.schedule(ahu, 2026, users.sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    expect(await getPendingEarlierPmTasks(flt)).toEqual([]);
  });

  it('on a SET_A AHU, a cleaning of a SET_B filter does not satisfy the visit', async () => {
    const ahu = await fx.instance('AHU', 'D4set', { parentId: blockId, customAttributes: { pmFilterSetMode: 'SET_A' } });
    const fa = await fx.filter('d4a', ahu, { filterSet: 'SET_A' });
    const fb = await fx.filter('d4b', ahu, { filterSet: 'SET_B' });
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    await fx.cycle(fb, users.sa.id, { status: 'COMPLETED', startedAt: at(-3), completedAt: at(-2) });
    const pending = await getPendingEarlierPmTasks(fa);
    expect(pending.map((p) => p.entryId)).toEqual([s.entryIds[0]]);
  });
});

describe('D4b - the missed-PM gate needs every counted filter', () => {
  it('a part-done overdue visit is still pending; once every filter is PM-cleaned it is not', async () => {
    const ahu = await fx.instance('AHU', 'D4all', { parentId: blockId });
    const f1 = await fx.filter('d4b-1', ahu);
    const f2 = await fx.filter('d4b-2', ahu);
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{ plannedDate: at(-15), toleranceDays: 5 }]);
    await fx.cycle(f1, users.sa.id, { status: 'COMPLETED', startedAt: at(-13), completedAt: at(-12) });
    expect((await getPendingEarlierPmTasks(f2)).map((p) => p.entryId)).toEqual([s.entryIds[0]]);

    // Control: the same predicate as My Tasks - a late PM clean of the last filter completes it.
    await fx.cycle(f2, users.sa.id, { status: 'COMPLETED', startedAt: at(-2), completedAt: at(-1) });
    expect(await getPendingEarlierPmTasks(f2)).toEqual([]);
  });
});

describe('D2 - an approved visit stays in force while a change to its date waits', () => {
  it('My Tasks, the missed-PM gate and the sweep keep the visit on its approved date', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_OFF);
    const ahu = await fx.instance('AHU', 'D2a', { parentId: blockId });
    const flt = await fx.filter('d2a-f', ahu);
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{ plannedDate: at(-15), toleranceDays: 5, approvalStatus: 'APPROVED' }]);
    const id = s.entryIds[0];
    expect((await as('sa', 'PUT', `/entries/${id}/edit`, { plannedDate: iso(at(40)) })).statusCode).toBe(200);
    expect((await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } })).approvalStatus).toBe('PENDING');

    const due = (await as('sa', 'GET', '/due')).json();
    expect([...due.tasks, ...due.overdue].some((r: any) => r.entryId === id)).toBe(true);
    expect((await getPendingEarlierPmTasks(flt)).map((p) => p.entryId)).toEqual([id]);
    await as('sa', 'POST', '/deviations/sweep');
    expect(await prisma.deviation.findUnique({ where: { pmScheduleEntryId: id } })).not.toBeNull();
  });

  it('rejecting the change at approval keeps the visit APPROVED on its original date, approver kept', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_OFF);
    const ahu = await fx.instance('AHU', 'D2b', { parentId: blockId });
    const live = new Date(Date.UTC(2097, 2, 1));
    const approvedAt = new Date(Date.UTC(2097, 0, 2));
    const s = await fx.schedule(ahu, 2097, users.sa.id, [{
      plannedDate: live, toleranceDays: 2, approvalStatus: 'APPROVED',
      extra: { approvedBy: users.apr.id, approvedByName: users.apr.username, approvedAt },
    }]);
    const id = s.entryIds[0];
    await as('sa', 'PUT', `/entries/${id}/edit`, { plannedDate: '2097-03-10' });
    expect((await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } })).approvedByName).toBe(users.apr.username);

    const res = await as('apr', 'POST', '/entries/reject', { entryIds: [id], remarks: 'keep the original date' });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(1);
    const row = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ approvalStatus: 'APPROVED', pendingPlannedDate: null, approvedByName: users.apr.username, rejectedAt: null });
    expect(iso(row.plannedDate)).toBe(iso(live));
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'PM_SCHEDULE_REJECTED', targetId: id }, orderBy: { chainPosition: 'desc' } });
    expect(audit?.afterValue).toMatchObject({ stage: 'APPROVAL', changeRejected: true, visitKept: { approvalStatus: 'APPROVED' } });
  });

  it('rejecting the change at review keeps the visit APPROVED too', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_ON);
    const ahu = await fx.instance('AHU', 'D2c', { parentId: blockId });
    const live = new Date(Date.UTC(2097, 5, 1));
    const s = await fx.schedule(ahu, 2097, users.sa.id, [{ plannedDate: live, toleranceDays: 2, approvalStatus: 'APPROVED' }]);
    const id = s.entryIds[0];
    await as('sa', 'PUT', `/entries/${id}/edit`, { plannedDate: '2097-06-12' });
    expect((await as('rev', 'POST', '/entries/review', { entryIds: [id], action: 'reject', remarks: 'not this date' })).statusCode).toBe(200);
    const row = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ approvalStatus: 'APPROVED', pendingPlannedDate: null, reviewedBy: null });
    expect(iso(row.plannedDate)).toBe(iso(live));
  });

  it('replacing the schedule keeps the pending change, and refuses to drop the visit', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_OFF);
    const ahu = await fx.instance('AHU', 'D2d', { parentId: blockId });
    const live = new Date(Date.UTC(2097, 8, 1));
    const s = await fx.schedule(ahu, 2097, users.sa.id, [{ plannedDate: live, toleranceDays: 2, approvalStatus: 'APPROVED' }]);
    await as('sa', 'PUT', `/entries/${s.entryIds[0]}/edit`, { plannedDate: '2097-09-08' });

    const dropIt = await as('sa', 'PUT', `/${s.scheduleId}`, { entries: [{ month: 10, plannedDate: '2097-10-15', toleranceDays: 2 }] });
    expect(dropIt.statusCode).toBe(409);
    expect(dropIt.json().error).toBe('PM_ENTRY_HAS_EVIDENCE');

    const keep = await as('sa', 'PUT', `/${s.scheduleId}`, { entries: [{ month: 9, plannedDate: '2097-09-01', toleranceDays: 2 }] });
    expect(keep.statusCode).toBe(200);
    const active = await prisma.pmSchedule.findFirstOrThrow({ where: { entityId: ahu, year: 2097, status: 'ACTIVE' }, include: { entries: true } });
    expect(active.entries).toHaveLength(1);
    expect(active.entries[0].pendingPlannedDate && iso(active.entries[0].pendingPlannedDate)).toBe('2097-09-08');
  });
});

describe('isPmDue - only a visit in force pre-selects the PM reason', () => {
  it('an unapproved visit in its window is not "PM due"; an approved one is', async () => {
    const ahu = await fx.instance('AHU', 'DUE', { parentId: blockId });
    const flt = await fx.filter('due-f', ahu);
    const s = await fx.schedule(ahu, 2026, users.sa.id, [{ plannedDate: at(0), toleranceDays: 3, approvalStatus: 'PENDING' }]);
    const state = async () => (await app.inject({
      method: 'GET', url: `/api/filters/${flt}/current-state`, headers: { authorization: `Bearer ${users.sa.token}` },
    })).json();
    expect((await state()).isPmDue).toBe(false);
    await prisma.pmScheduleEntry.update({ where: { id: s.entryIds[0] }, data: { approvalStatus: 'APPROVED' } });
    expect((await state()).isPmDue).toBe(true);
  });
});

describe('D3 - bulk approve is all-or-nothing on a separation refusal', () => {
  it('refuses the batch before writing anything when two staged edits would overlap', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_OFF);
    const ahu = await fx.instance('AHU', 'D3a', { parentId: blockId });
    const base = new Date(Date.UTC(2095, 2, 1));
    const bDate = new Date(base.getTime() + 21 * DAY);
    const s = await fx.schedule(ahu, 2095, users.sa.id, [
      { plannedDate: base, toleranceDays: 2, approvalStatus: 'APPROVED' },
      { plannedDate: bDate, toleranceDays: 2, approvalStatus: 'APPROVED' },
    ]);
    const [a, b] = s.entryIds;
    // Each edit is fine against the OTHER's live date; together they collide.
    expect((await as('sa', 'PUT', `/entries/${a}/edit`, { plannedDate: iso(new Date(bDate.getTime() - 9 * DAY)) })).statusCode).toBe(200);
    expect((await as('sa', 'PUT', `/entries/${b}/edit`, { plannedDate: iso(new Date(bDate.getTime() - 5 * DAY)) })).statusCode).toBe(200);

    const res = await as('apr', 'POST', '/entries/approve', { entryIds: [a, b] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_OVERLAP');
    for (const [id, live] of [[a, base], [b, bDate]] as const) {
      const row = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
      expect(row.approvalStatus).toBe('PENDING');
      expect(iso(row.plannedDate)).toBe(iso(live));
      expect(row.pendingPlannedDate).not.toBeNull();
    }
    expect(await prisma.qualityNotification.count({ where: { pmScheduleEntryId: { in: [a, b] }, action: 'APPROVE' } })).toBe(0);
  });

  it('approves a batch whose final dates are clear', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_OFF);
    const ahu = await fx.instance('AHU', 'D3b', { parentId: blockId });
    const base = new Date(Date.UTC(2095, 5, 1));
    const s = await fx.schedule(ahu, 2095, users.sa.id, [
      { plannedDate: base, toleranceDays: 2, approvalStatus: 'APPROVED' },
      { plannedDate: new Date(base.getTime() + 30 * DAY), toleranceDays: 2, approvalStatus: 'APPROVED' },
    ]);
    const [a, b] = s.entryIds;
    await as('sa', 'PUT', `/entries/${a}/edit`, { plannedDate: iso(new Date(base.getTime() + 3 * DAY)) });
    await as('sa', 'PUT', `/entries/${b}/edit`, { plannedDate: iso(new Date(base.getTime() + 40 * DAY)) });
    const res = await as('apr', 'POST', '/entries/approve', { entryIds: [a, b] });
    expect(res.statusCode).toBe(200);
    const rows = await prisma.pmScheduleEntry.findMany({ where: { id: { in: [a, b] } } });
    expect(rows.every((r) => r.approvalStatus === 'APPROVED' && r.pendingPlannedDate === null)).toBe(true);
  });
});

describe('D10 / D11 - a pending edit of an approved visit', () => {
  it('D10: a reviewer adjusting the edit changes the PROPOSED date, never the approved one', async () => {
    cfg.set('pm-schedule-approval', WORKFLOW_ON);
    const ahu = await fx.instance('AHU', 'D10', { parentId: blockId });
    const live = new Date(Date.UTC(2096, 2, 1));
    const s = await fx.schedule(ahu, 2096, users.sa.id, [{ plannedDate: live, toleranceDays: 2, approvalStatus: 'APPROVED' }]);
    const id = s.entryIds[0];
    expect((await as('sa', 'PUT', `/entries/${id}/edit`, { plannedDate: '2096-03-10' })).statusCode).toBe(200);
    expect((await as('rev', 'PUT', `/entries/${id}/review-edit`, { plannedDate: '2096-03-12' })).statusCode).toBe(200);

    let row = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
    expect(iso(row.plannedDate)).toBe(iso(live));
    expect(row.pendingPlannedDate && iso(row.pendingPlannedDate)).toBe('2096-03-12');

    expect((await as('rev', 'POST', '/entries/review', { entryIds: [id], action: 'approve' })).statusCode).toBe(200);
    expect((await as('apr', 'POST', '/entries/approve', { entryIds: [id] })).statusCode).toBe(200);
    row = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
    expect(row.approvalStatus).toBe('APPROVED');
    expect(iso(row.plannedDate)).toBe('2096-03-12');
  });

  it('D11: a stale proposal on a REJECTED entry is not resurrected when the entry is resubmitted', async () => {
    // A review reject used to keep the proposal (D11). Since D2 a rejected CHANGE
    // leaves the visit APPROVED, so such rows now exist only from before the fix:
    // build one directly and check resubmit drops the stale date.
    cfg.set('pm-schedule-approval', WORKFLOW_ON);
    const ahu = await fx.instance('AHU', 'D11', { parentId: blockId });
    const s = await fx.schedule(ahu, 2096, users.sa.id, [{
      plannedDate: new Date(Date.UTC(2096, 5, 1)), toleranceDays: 2, approvalStatus: 'REJECTED',
      extra: { rejectionStage: 'REVIEW', pendingPlannedDate: new Date(Date.UTC(2096, 5, 10)), pendingToleranceDays: 2 },
    }]);
    const id = s.entryIds[0];
    expect((await as('sa', 'POST', `/entries/${id}/resubmit`, { plannedDate: '2096-06-20' })).statusCode).toBe(200);
    expect((await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } })).pendingPlannedDate).toBeNull();
    await as('rev', 'POST', '/entries/review', { entryIds: [id], action: 'approve' });
    expect((await as('apr', 'POST', '/entries/approve', { entryIds: [id] })).statusCode).toBe(200);
    const row = await prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
    expect(iso(row.plannedDate)).toBe('2096-06-20');
  });
});

describe('D5 - an AHU with no schedule for the year answers null', () => {
  it('returns a literal null body (the page shows "No PM schedule exists"), and a schedule when one exists', async () => {
    cfg.set('pm-schedule-settings', defaultPmConfig('x')['pm-schedule-settings']);
    const ahu = await fx.instance('AHU', 'D5', { parentId: blockId });
    const none = await as('sa', 'GET', `/${ahu}?year=2097`);
    expect(none.statusCode).toBe(200);
    expect(none.body).toBe('null');

    await fx.schedule(ahu, 2097, users.sa.id, [{ plannedDate: new Date(Date.UTC(2097, 0, 15)), toleranceDays: 2 }]);
    const some = (await as('sa', 'GET', `/${ahu}?year=2097`)).json();
    expect(some.year).toBe(2097);
    expect(some.entries).toHaveLength(1);
  });
});

describe('D7 - the settings endpoint and the module guard agree', () => {
  it('a missing settings row reads as disabled on both', async () => {
    cfg.missing('pm-schedule-settings');
    expect((await as('sa', 'GET', '/settings')).json()).toEqual({ enabled: false });
    expect((await as('sa', 'GET', '/entries')).statusCode).toBe(404);
  });

  it('the {value: {...}} storage shape reads as enabled on both', async () => {
    cfg.set('pm-schedule-settings', { value: { enabled: true } });
    expect((await as('sa', 'GET', '/settings')).json()).toEqual({ enabled: true });
    expect((await as('sa', 'GET', '/entries')).statusCode).toBe(200);
    cfg.set('pm-schedule-settings', defaultPmConfig('x')['pm-schedule-settings']);
  });
});

describe('D8 - upload errors name the line of the file', () => {
  it('CSV: comment rows and blank lines do not shift the reported line', async () => {
    const ahu = await fx.instance('AHU', 'D8csv', { parentId: blockId });
    const name = (await prisma.assetInstance.findUniqueOrThrow({ where: { id: ahu } })).name;
    const text = `ahu_name,scheduled_date\n# note row,\n\n${name},not-a-date\n`;
    const res = await upload('d8.csv', Buffer.from(text));
    const skipped = res.json().details?.skipped ?? res.json().skipped;
    expect(skipped[0].row).toBe(4);
    expect(skipped[0].data).not.toHaveProperty('__row');
  });

  it('XLSX: an empty sheet row does not shift the reported line', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Visits');
    ws.getRow(1).values = ['ahu_name', 'scheduled_date'];
    ws.getRow(4).values = ['no-such-ahu-d8', '2098-01-10'];
    const res = await upload('d8.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    const skipped = res.json().details?.skipped ?? res.json().skipped;
    expect(skipped[0].row).toBe(4);
  });
});

describe('D9 - an old .xls file is refused up front', () => {
  it('answers 400 INVALID_FILE_TYPE with a save-as hint, not a zip parse error', async () => {
    const biff = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    const res = await upload('legacy.xls', biff);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_FILE_TYPE');
    expect(res.json().message).toMatch(/\.xlsx/);
  });
});
