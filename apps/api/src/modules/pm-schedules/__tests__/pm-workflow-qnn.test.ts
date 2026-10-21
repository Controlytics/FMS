/**
 * pm-workflow.ts helpers and the single-entry separation guard, called
 * directly against digilog_test_db.
 *
 *  - qnnBatchTag / newQnnBatchRef / normalizeRoles / assertPmRole (pure)
 *  - getReplacementWorkflowConfig: each Replacement field inherits the PM
 *    setting until it is set (config rows served in-process, see pm-fixtures.ts)
 *  - generateQnn: numbering, role routing per action, and that the QNN row is
 *    recorded even when the notification insert fails (a real DB refusal: the
 *    notification title column is varchar(200))
 *  - assertSeparation: the "new candidate" mode (no entry id), grandfathered
 *    overlaps between OTHER entries, and siblings compared on live dates only
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import type { RequestContext } from '../../../types/context.js';
import {
  qnnBatchTag, newQnnBatchRef, normalizeRoles, assertPmRole, getReplacementWorkflowConfig, generateQnn,
} from '../pm-workflow.js';
import { assertSeparation } from '../pm-separation-guard.js';
import { installConfigOverrides, type ConfigOverrides, DAY } from './pm-fixtures.js';

const TAG = `pmwq_${Date.now().toString(36)}`;
const minted: string[] = [];
const scheduleIds: string[] = [];
let cfg: ConfigOverrides;

const ctx = (over: Partial<RequestContext> = {}): RequestContext =>
  ({ userId: TAG, userSub: randomUUID(), userRole: 'SUPERVISOR', ipAddress: '127.0.0.1', ...over } as RequestContext);

async function mint(...args: Parameters<typeof generateQnn>) {
  const q = await generateQnn(...args);
  minted.push(q);
  return q;
}
const noteFor = (qnn: string) =>
  prisma.notification.findFirst({ where: { type: 'PM_SCHEDULE_QNN', metadata: { path: ['qnn'], equals: qnn } } });

beforeAll(() => {
  cfg = installConfigOverrides({});
});

beforeEach(() => {
  cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: ['SUPERVISOR'], reviewRole: 'MANAGER', approvalRole: 'QA' });
  cfg.missing('replacement-schedule-approval');
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { OR: minted.map((q) => ({ metadata: { path: ['qnn'], equals: q } })) } }).catch(() => undefined);
  await prisma.qualityNotification.deleteMany({ where: { qnn: { in: minted } } });
  await prisma.pmSchedule.deleteMany({ where: { id: { in: scheduleIds } } }); // entries cascade
});

describe('qnnBatchTag / newQnnBatchRef', () => {
  it('is empty for a single-entry action or when no batch reference was taken', () => {
    expect(qnnBatchTag(null, 1, 5, ['A', 'B'])).toBe('');
    expect(qnnBatchTag('B-ABC123', 1, 1, ['A', 'B'])).toBe('');
  });

  it('counts visits, and names the AHUs only when more than one is involved (deduped, blanks dropped)', () => {
    expect(qnnBatchTag('B-ABC123', 2, 3)).toBe(' [batch B-ABC123, 2 of 3]');
    expect(qnnBatchTag('B-ABC123', 2, 3, ['AHU-1', 'AHU-1', ''])).toBe(' [batch B-ABC123, 2 of 3]');
    expect(qnnBatchTag('B-ABC123', 1, 3, ['AHU-1', '', 'AHU-2', 'AHU-1'])).toBe(' [batch B-ABC123, 1 of 3 across AHU-1, AHU-2]');
  });

  it('summarises a very wide batch with "+N more" instead of crowding out the message', () => {
    const names = Array.from({ length: 30 }, (_, i) => `AIR-HANDLING-UNIT-${String(i).padStart(3, '0')}`);
    const tag = qnnBatchTag('B-ABC123', 1, 60, names);
    const m = tag.match(/^ \[batch B-ABC123, 1 of 60 across (.+), \+(\d+) more\]$/);
    expect(m).toBeTruthy();
    const shown = m![1].split(', ');
    expect(shown.length + Number(m![2])).toBe(30);
    expect(m![1].length).toBeLessThanOrEqual(220);
    expect(shown).toEqual(names.slice(0, shown.length));
  });

  it('newQnnBatchRef is B- plus six upper-case hex characters, different each time', () => {
    const a = newQnnBatchRef();
    expect(a).toMatch(/^B-[0-9A-F]{6}$/);
    expect(new Set(Array.from({ length: 20 }, newQnnBatchRef)).size).toBeGreaterThan(1);
  });
});

describe('normalizeRoles / assertPmRole', () => {
  it('accepts a single string, a list, or nothing; trims, de-duplicates and drops blanks', () => {
    expect(normalizeRoles(undefined)).toEqual([]);
    expect(normalizeRoles(null)).toEqual([]);
    expect(normalizeRoles(' QA ')).toEqual(['QA']);
    expect(normalizeRoles(['QA', '', ' QA', null, 'MANAGER'])).toEqual(['QA', 'MANAGER']);
  });

  it('a caller with no role at all is refused when a role is configured', () => {
    expect(() => assertPmRole(undefined, 'QA', 'approve')).toThrow(/Only users with role "QA" can approve PM schedules/);
  });
});

describe('getReplacementWorkflowConfig — Replacement inherits each PM field until it is set', () => {
  it('inherits everything when the Replacement row is absent', async () => {
    expect(await getReplacementWorkflowConfig()).toEqual({
      workflowEnabled: true, uploadRole: ['SUPERVISOR'], reviewRole: 'MANAGER', approvalRole: 'QA',
    });
  });

  it('blank Replacement fields still inherit; a non-boolean toggle inherits the PM toggle', async () => {
    cfg.set('replacement-schedule-approval', { workflowEnabled: 'yes', uploadRole: ['', ' '], reviewRole: '  ', approvalRole: '' });
    expect(await getReplacementWorkflowConfig()).toEqual({
      workflowEnabled: true, uploadRole: ['SUPERVISOR'], reviewRole: 'MANAGER', approvalRole: 'QA',
    });
  });

  it('set Replacement fields override, including an explicit workflowEnabled=false', async () => {
    cfg.set('replacement-schedule-approval', { workflowEnabled: false, uploadRole: 'SHIFTOFFICER', reviewRole: 'SUPERVISOR', approvalRole: ' ADMIN ' });
    expect(await getReplacementWorkflowConfig()).toEqual({
      workflowEnabled: false, uploadRole: ['SHIFTOFFICER'], reviewRole: 'SUPERVISOR', approvalRole: 'ADMIN',
    });
  });
});

describe('generateQnn', () => {
  it('numbers QN-<year>-<6 digits>, records the row and routes UPLOAD/EDIT/RESUBMIT to the reviewer, REVIEW to the approver', async () => {
    const expected: Record<string, string | null> = { UPLOAD: 'MANAGER', EDIT: 'MANAGER', RESUBMIT: 'MANAGER', REVIEW: 'QA', APPROVE: null, REJECT: null };
    for (const [action, role] of Object.entries(expected)) {
      const entryId = randomUUID();
      const q = await mint(action as any, { pmScheduleEntryId: entryId, scheduleId: randomUUID(), ahuName: 'AHU-QNN', message: `msg ${action}` }, ctx());
      expect(q).toMatch(new RegExp(`^QN-${new Date().getFullYear()}-\\d{6}$`));
      const row = await prisma.qualityNotification.findUnique({ where: { qnn: q } });
      expect(row).toMatchObject({ action, pmScheduleEntryId: entryId, ahuName: 'AHU-QNN', message: `msg ${action}`, performedByName: TAG });
      const note = await noteFor(q);
      expect(note?.forRole ?? null, action).toBe(role);
      expect(note?.title).toMatch(new RegExp(`^${q} · PM Schedule .+ · by ${TAG}$`));
      expect(note?.message).toContain(`AHU: AHU-QNN\nDetails: msg ${action}\nBy: ${TAG} (SUPERVISOR)\nOn: `);
    }
  });

  it('with no review role an UPLOAD routes to the approver; with neither, and for REVIEW with no approver, it is unrouted', async () => {
    cfg.set('pm-schedule-approval', { workflowEnabled: true, reviewRole: '', approvalRole: 'QA' });
    expect((await noteFor(await mint('UPLOAD', {}, ctx())))?.forRole).toBe('QA');
    cfg.set('pm-schedule-approval', { workflowEnabled: true, reviewRole: '', approvalRole: '' });
    expect((await noteFor(await mint('UPLOAD', {}, ctx())))?.forRole).toBeNull();
    expect((await noteFor(await mint('REVIEW', {}, ctx())))?.forRole).toBeNull();
  });

  it('an anonymous context and empty options still record a QNN with null attribution', async () => {
    const q = await mint('APPROVE', {}, {} as RequestContext);
    expect(await prisma.qualityNotification.findUnique({ where: { qnn: q } })).toMatchObject({
      pmScheduleEntryId: null, scheduleId: null, ahuName: null, message: null, performedBy: null, performedByName: null,
    });
    const note = await noteFor(q);
    expect(note?.title).toBe(`${q} · PM Schedule Approved · by unknown`);
    expect(note?.message).toMatch(/\nBy: unknown\nOn: /);
    expect(note?.createdBy).toBeNull();
  });

  it('the QNN is recorded even when the notification insert is refused by the database', async () => {
    const before = await prisma.notification.count({ where: { createdBy: TAG } });
    // A subject this long makes the notification title exceed varchar(200).
    const q = await mint('REJECT', { subject: 'S'.repeat(250), ahuName: 'AHU-QNN' }, ctx());
    expect(await prisma.qualityNotification.findUnique({ where: { qnn: q } })).toMatchObject({ action: 'REJECT', ahuName: 'AHU-QNN' });
    expect(await noteFor(q)).toBeNull();
    expect(await prisma.notification.count({ where: { createdBy: TAG } })).toBe(before);
  });
});

describe('assertSeparation — single-entry guard', () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  let sid: string;
  let liveWithPendingId: string;

  beforeAll(async () => {
    const s = await prisma.pmSchedule.create({ data: { entityId: randomUUID(), year: 2096, status: 'ACTIVE', createdBy: randomUUID() } });
    scheduleIds.push(s.id);
    sid = s.id;
    const mk = (date: string, tol: number, extra: Record<string, unknown> = {}) => prisma.pmScheduleEntry.create({
      data: {
        scheduleId: sid, month: d(date).getUTCMonth() + 1, plannedDate: d(date), toleranceDays: tol,
        windowStart: new Date(d(date).getTime() - tol * DAY), windowEnd: new Date(d(date).getTime() + tol * DAY), ...extra,
      },
    });
    // Two siblings that already overlap each other (grandfathered).
    await mk('2096-01-10', 5);
    await mk('2096-01-14', 5);
    // A sibling whose staged edit is NOT in force yet.
    liveWithPendingId = (await mk('2096-03-10', 2, { pendingPlannedDate: d('2096-03-20'), pendingToleranceDays: 2 })).id;
  });

  it('returns quietly for a schedule with no other entries', async () => {
    const empty = await prisma.pmSchedule.create({ data: { entityId: randomUUID(), year: 2096, status: 'ACTIVE', createdBy: randomUUID() } });
    scheduleIds.push(empty.id);
    await expect(assertSeparation(empty.id, { plannedDate: d('2096-05-05'), toleranceDays: 30 })).resolves.toBeUndefined();
  });

  it('checks a brand-new candidate (no entry id) against every sibling', async () => {
    await expect(assertSeparation(sid, { plannedDate: d('2096-03-13'), toleranceDays: 1 }, 'New visit'))
      .rejects.toMatchObject({ statusCode: 409, code: 'PM_VISIT_OVERLAP', message: expect.stringMatching(/^New visit cannot be scheduled here\. 2096-03-13 \(tolerance 1d\) starts on 2096-03-12/) });
    await expect(assertSeparation(sid, { plannedDate: d('2096-06-01'), toleranceDays: 3 })).resolves.toBeUndefined();
  });

  it('an overlap between two OTHER entries does not block an unrelated candidate', async () => {
    await expect(assertSeparation(sid, { plannedDate: d('2096-02-10'), toleranceDays: 2 })).resolves.toBeUndefined();
  });

  it('a sibling is compared on its live date, never its staged one; the entry itself is excluded', async () => {
    await expect(assertSeparation(sid, { plannedDate: d('2096-03-20'), toleranceDays: 2 })).resolves.toBeUndefined();
    // Moving the pending-edit entry itself next to its own live date is fine — it is not its own sibling.
    await expect(assertSeparation(sid, { plannedDate: d('2096-03-11'), toleranceDays: 2, entryId: liveWithPendingId })).resolves.toBeUndefined();
  });
});
