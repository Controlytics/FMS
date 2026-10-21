/**
 * PM schedules — schedule CRUD, settings mirrors, template download and the
 * per-AHU filter-set config, through the real routes.
 *
 * Real Fastify + auth + RBAC + re-auth gate + Prisma on digilog_test_db. The
 * suite owns its SUPER_ADMIN, throwaway roles/users and BLOCK → AREA → AHU →
 * FILTER hierarchy, and removes them in afterAll. The five PM config rows are
 * served from an in-process override (see pm-fixtures.ts) so nothing shared in
 * `system_config` is written.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import pmExecutionRoutes from '../modules/pm-schedules/execution-routes.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, utcDay, iso, DAY, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMC');
const YEAR = 2093;

let app: FastifyInstance;
let cfg: ConfigOverrides;
let sa: { id: string; username: string };
const tok: Record<string, string> = {};
const users: Record<string, { id: string; username: string }> = {};
let blockId: string, areaId: string, ahuId: string, ahu2Id: string, ahuFreshId: string;
let notifyRole: string;

const H = (k: string, pw?: string) => ({
  authorization: `Bearer ${tok[k]}`,
  ...(pw ? { 'x-reauth-password': pw } : {}),
});
const inject = (method: string, url: string, k: string, payload?: unknown, pw?: string) =>
  app.inject({ method: method as any, url, headers: H(k, pw), ...(payload !== undefined ? { payload: payload as any } : {}) });

async function latestAudit(action: string, targetId: string) {
  return prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });
}

beforeAll(async () => {
  app = await buildApp([
    { plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' },
    { plugin: pmExecutionRoutes, prefix: '/api/pm-executions' },
  ]);
  notifyRole = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides(defaultPmConfig(notifyRole));

  sa = await fx.user('sa', 'SUPER_ADMIN');
  const roles = {
    read: await fx.role('READ', ['PM_READ']),
    none: await fx.role('NONE', ['DASHBOARD_VIEW']),
    tmpl: await fx.role('TMPL', ['PM_DOWNLOAD_TEMPLATE']),
    del: await fx.role('DEL', ['PM_READ', 'PM_DELETE']),
    upd: await fx.role('UPD', ['PM_READ', 'PM_UPDATE']),
    cre: await fx.role('CRE', ['PM_READ', 'PM_CREATE']),
  };
  for (const [k, role] of Object.entries(roles)) {
    const u = await fx.user(k, role);
    users[k] = u;
    tok[k] = await fx.login(app, u.username);
  }
  tok.sa = await fx.login(app, sa.username);

  blockId = await fx.instance('BLOCK', 'BLOCK');
  areaId = await fx.instance('AREA', 'AREA', { parentId: blockId });
  ahuId = await fx.instance('AHU', 'AHU-1', { parentId: areaId, customAttributes: { keepMe: 'yes' } });
  ahu2Id = await fx.instance('AHU', 'AHU-2', { parentId: blockId });
  ahuFreshId = await fx.instance('AHU', 'AHU-FRESH', { parentId: blockId });
  await fx.filter('F-A', ahuId, { filterSet: 'SET_A' });
  await fx.filter('F-B', ahuId, { filterSet: 'SET_B' });
  await fx.filter('F-N', ahuId, { filterSet: null });
  await fx.filter('F-RET', ahuId, { filterSet: 'SET_A', status: 'Retired' }); // retired: never counted
}, 120_000);

afterAll(async () => {
  await fx.cleanup(app);
}, 120_000);

beforeEach(() => {
  // Each test starts from the default config; tests that need more set it.
  const d = defaultPmConfig(notifyRole);
  for (const [k, v] of Object.entries(d)) cfg.set(k, v);
});

describe('module switch', () => {
  it('every service route answers 404 PM_DISABLED when the module is off', async () => {
    cfg.set('pm-schedule-settings', { enabled: false });
    for (const url of [`/api/pm-schedules/${ahuId}`, '/api/pm-schedules/entries', '/api/pm-schedules/ahu-configs', '/api/pm-schedules/due', `/api/pm-schedules/${ahuId}/history`]) {
      const res = await inject('GET', url, 'sa');
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toMatchObject({ error: 'PM_DISABLED' });
    }
    const create = await inject('POST', '/api/pm-schedules', 'sa', {
      entityId: ahu2Id, year: YEAR, entries: [{ month: 1, plannedDate: `${YEAR}-01-10` }],
    });
    expect(create.statusCode).toBe(404);
    expect(await prisma.pmSchedule.count({ where: { entityId: ahu2Id } })).toBe(0);
  });

  it('a missing settings row also means disabled (no implicit enable in the service guard)', async () => {
    cfg.missing('pm-schedule-settings');
    const res = await inject('GET', '/api/pm-schedules/entries', 'sa');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('PM_DISABLED');
  });
});

describe('GET /settings (PM_READ mirror of the enabled flag)', () => {
  it('reports the flat stored flag', async () => {
    cfg.set('pm-schedule-settings', { enabled: true });
    expect((await inject('GET', '/api/pm-schedules/settings', 'read')).json()).toEqual({ enabled: true });
    cfg.set('pm-schedule-settings', { enabled: false });
    expect((await inject('GET', '/api/pm-schedules/settings', 'read')).json()).toEqual({ enabled: false });
  });

  it('reads the legacy {value:{enabled}} wrapper too (no current writer produces it)', async () => {
    cfg.set('pm-schedule-settings', { value: { enabled: false } });
    expect((await inject('GET', '/api/pm-schedules/settings', 'read')).json()).toEqual({ enabled: false });
  });

  // (The absent-row case is deliberately not pinned here: /settings answers
  // enabled:true while the service guard and the config def default answer
  // disabled — reported as a defect, not encoded as expected.)
  it('only a literal true counts as on', async () => {
    cfg.set('pm-schedule-settings', { enabled: 'yes' });
    expect((await inject('GET', '/api/pm-schedules/settings', 'read')).json()).toEqual({ enabled: false });
  });

  it('is refused to a role without PM_READ', async () => {
    const res = await inject('GET', '/api/pm-schedules/settings', 'none');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN', requiredPermission: 'PM_READ' });
  });
});

describe('GET /workflow-config', () => {
  it('normalises the stored roles (legacy single string, list with blanks/dupes, padded names)', async () => {
    cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: ['SUPERVISOR', ' ', 'SUPERVISOR', 'SHIFTOFFICER'], reviewRole: ' MANAGER ', approvalRole: 'QA' });
    expect((await inject('GET', '/api/pm-schedules/workflow-config', 'read')).json()).toEqual({
      workflowEnabled: true, uploadRole: ['SUPERVISOR', 'SHIFTOFFICER'], reviewRole: 'MANAGER', approvalRole: 'QA',
    });
    cfg.set('pm-schedule-approval', { workflowEnabled: 'true', uploadRole: 'SUPERVISOR' });
    expect((await inject('GET', '/api/pm-schedules/workflow-config', 'read')).json()).toEqual({
      workflowEnabled: false, uploadRole: ['SUPERVISOR'], reviewRole: '', approvalRole: '',
    });
  });

  it('defaults to workflow OFF with no roles when the row is absent', async () => {
    cfg.missing('pm-schedule-approval');
    expect((await inject('GET', '/api/pm-schedules/workflow-config', 'read')).json()).toEqual({
      workflowEnabled: false, uploadRole: [], reviewRole: '', approvalRole: '',
    });
  });
});

describe('GET /template.csv', () => {
  it('serves the CSV header with download headers to PM_READ or PM_DOWNLOAD_TEMPLATE holders', async () => {
    for (const k of ['sa', 'read', 'tmpl']) {
      const res = await inject('GET', '/api/pm-schedules/template.csv', k);
      expect(res.statusCode, k).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toBe('attachment; filename="pm-schedule-template.csv"');
      expect(res.body).toBe('ahu_name,scheduled_date,tolerance_days\n');
    }
  });

  it('is refused to a role holding neither permission', async () => {
    const res = await inject('GET', '/api/pm-schedules/template.csv', 'none');
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermissions).toEqual(['PM_READ', 'PM_DOWNLOAD_TEMPLATE']);
  });
});

describe('POST / — create a schedule', () => {
  const body = () => ({
    entityId: ahu2Id, year: YEAR,
    entries: [
      { month: 3, plannedDate: `${YEAR}-03-10`, toleranceDays: 5, notes: 'first visit' },
      { month: 1, plannedDate: `${YEAR}-01-10` }, // no tolerance → 0
    ],
  });

  it('refuses a role without PM_CREATE before any write', async () => {
    const res = await inject('POST', '/api/pm-schedules', 'read', body());
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_CREATE');
    expect(await prisma.pmSchedule.count({ where: { entityId: ahu2Id, year: YEAR } })).toBe(0);
  });

  it('rejects a schema-invalid body with 400', async () => {
    const bad = await inject('POST', '/api/pm-schedules', 'sa', { entityId: ahu2Id, year: YEAR, entries: [{ month: 13, plannedDate: `${YEAR}-01-01` }] });
    expect(bad.statusCode).toBe(400);
    const missing = await inject('POST', '/api/pm-schedules', 'sa', { entityId: ahu2Id, year: YEAR });
    expect(missing.statusCode).toBe(400);
    const notUuid = await inject('POST', '/api/pm-schedules', 'sa', { entityId: 'nope', year: YEAR, entries: [] });
    expect(notUuid.statusCode).toBe(400);
  });

  it('refuses overlapping visits with 409 PM_VISIT_OVERLAP and writes nothing', async () => {
    const res = await inject('POST', '/api/pm-schedules', 'sa', {
      entityId: ahu2Id, year: YEAR,
      entries: [
        { month: 3, plannedDate: `${YEAR}-03-10`, toleranceDays: 15 },
        { month: 4, plannedDate: `${YEAR}-04-05`, toleranceDays: 20 }, // 16–25 Mar overlap
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_OVERLAP');
    expect(res.json().message).toContain(`The ${YEAR} schedule`);
    expect(await prisma.pmSchedule.count({ where: { entityId: ahu2Id, year: YEAR } })).toBe(0);
  });

  it('requires the password when CREATE_PM_SCHEDULE re-auth is configured for the role', async () => {
    cfg.set('action-reauth', { CREATE_PM_SCHEDULE: ['SUPER_ADMIN'] });
    const res = await inject('POST', '/api/pm-schedules', 'sa', body());
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'CREATE_PM_SCHEDULE' });
    expect(await prisma.pmSchedule.count({ where: { entityId: ahu2Id, year: YEAR } })).toBe(0);
  });

  it('a wrong password is refused and audited as REAUTH_FAILED', async () => {
    cfg.set('action-reauth', { CREATE_PM_SCHEDULE: ['SUPER_ADMIN'] });
    const res = await inject('POST', '/api/pm-schedules', 'sa', body(), 'Wrong@Password1');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('REAUTH_FAILED');
    const row = await prisma.auditTrail.findFirst({ where: { action: 'REAUTH_FAILED', targetId: sa.id }, orderBy: { chainPosition: 'desc' } });
    expect((row?.afterValue as any)?.reauthAction).toBe('CREATE_PM_SCHEDULE');
    await prisma.user.update({ where: { id: sa.id }, data: { failedLoginAttempts: 0 } });
    expect(await prisma.pmSchedule.count({ where: { entityId: ahu2Id, year: YEAR } })).toBe(0);
  });

  it('creates the schedule + windows, audits CREATED and links the audit row to its signature', async () => {
    cfg.set('action-reauth', { CREATE_PM_SCHEDULE: ['SUPER_ADMIN'] });
    const res = await inject('POST', '/api/pm-schedules', 'sa', body(), fx.password);
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({ entityId: ahu2Id, year: YEAR, status: 'ACTIVE', version: 1, createdBy: sa.id });
    // ordered by month
    expect(created.entries.map((e: any) => e.month)).toEqual([1, 3]);

    const rows = await prisma.pmScheduleEntry.findMany({ where: { scheduleId: created.id }, orderBy: { plannedDate: 'asc' } });
    expect(rows.map((r) => [iso(r.plannedDate), r.toleranceDays, iso(r.windowStart), iso(r.windowEnd), r.notes])).toEqual([
      [`${YEAR}-01-10`, 0, `${YEAR}-01-10`, `${YEAR}-01-10`, null],
      [`${YEAR}-03-10`, 5, `${YEAR}-03-05`, `${YEAR}-03-15`, 'first visit'],
    ]);
    // Column default — a directly created schedule's entries await approval.
    expect(rows.every((r) => r.approvalStatus === 'PENDING')).toBe(true);

    const audit = await latestAudit('CREATED', created.id);
    expect(audit).toMatchObject({ userId: sa.username, userRole: 'SUPER_ADMIN', targetType: 'pm_schedule' });
    expect(audit?.afterValue).toEqual({ entityId: ahu2Id, year: YEAR, entryCount: 2 });
    const signature = await prisma.auditTrail.findUnique({ where: { id: audit!.signatureAuditId! } });
    expect(signature?.action).toBe('REAUTH_SUCCESS');
  });

  it('a second ACTIVE schedule for the same AHU/year is a 409 CONFLICT', async () => {
    const res = await inject('POST', '/api/pm-schedules', 'sa', body());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'CONFLICT' });
    expect(res.json().message).toContain(String(YEAR));
    expect(await prisma.pmSchedule.count({ where: { entityId: ahu2Id, year: YEAR } })).toBe(1);
  });
});

describe('GET /:entityId and /:entityId/history', () => {
  it('returns the ACTIVE schedule for the requested year with each entry\'s latest execution', async () => {
    const res = await inject('GET', `/api/pm-schedules/${ahu2Id}?year=${YEAR}`, 'read');
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s).toMatchObject({ entityId: ahu2Id, year: YEAR, status: 'ACTIVE' });
    expect(s.entries).toHaveLength(2);
    expect(s.entries.every((e: any) => e.execution === null)).toBe(true);
  });

  it('defaults to the current year, where this AHU has no schedule', async () => {
    const res = await inject('GET', `/api/pm-schedules/${ahu2Id}`, 'read');
    expect(res.statusCode).toBe(200);
    // Only "no schedule" is asserted. The exact body is NOT pinned: the service
    // returns null but the object response schema serialises it as {}, which the
    // detail page reads as a schedule — reported as a defect.
    expect(res.json()?.id).toBeUndefined();
    expect(res.json()?.entries).toBeUndefined();
  });

  it('rejects a non-uuid entity id', async () => {
    expect((await inject('GET', '/api/pm-schedules/not-a-uuid', 'read')).statusCode).toBe(400);
  });

  it('lists every version, newest first', async () => {
    const res = await inject('GET', `/api/pm-schedules/${ahu2Id}/history`, 'read');
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ year: YEAR, version: 1, status: 'ACTIVE' });
    expect(Object.keys(rows[0]).sort()).toEqual(['createdAt', 'id', 'status', 'version', 'year']);
  });
});

describe('PUT /:id — new version (archive + recreate)', () => {
  let scheduleId: string;
  let approvedEntryId: string;
  let executionId: string;
  const year = YEAR + 1;

  beforeAll(async () => {
    const s = await fx.schedule(ahuId, year, sa.id, [
      { plannedDate: new Date(`${year}-02-10`), toleranceDays: 3, approvalStatus: 'APPROVED',
        extra: { approvedBy: sa.id, approvedByName: 'qa-signer', approvedAt: new Date(), submittedByName: 'uploader', skipReason: null } },
      { plannedDate: new Date(`${year}-05-10`), toleranceDays: 3, approvalStatus: 'PENDING' },
    ]);
    scheduleId = s.scheduleId;
    approvedEntryId = s.entryIds[0];
    executionId = (await prisma.pmExecution.create({
      data: { scheduleEntryId: approvedEntryId, entityId: ahuId, status: 'COMPLETED', startedAt: new Date(), performedBy: sa.id },
    })).id;
  });

  it('refuses a role without PM_UPDATE', async () => {
    const res = await inject('PUT', `/api/pm-schedules/${scheduleId}`, 'read', { entries: [{ month: 2, plannedDate: `${year}-02-10` }] });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_UPDATE');
  });

  it('an empty entry list fails schema validation (minItems) before the handler', async () => {
    const res = await inject('PUT', `/api/pm-schedules/${scheduleId}`, 'sa', { entries: [] });
    expect(res.statusCode).toBe(400);
    expect((await prisma.pmSchedule.findUnique({ where: { id: scheduleId } }))?.status).toBe('ACTIVE');
  });

  it('404s for an unknown schedule', async () => {
    const res = await inject('PUT', '/api/pm-schedules/00000000-0000-4000-8000-000000000000', 'sa', { entries: [{ month: 2, plannedDate: `${year}-02-10` }] });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('refuses to drop a visit that carries evidence (approval / execution) — 409, nothing archived', async () => {
    const res = await inject('PUT', `/api/pm-schedules/${scheduleId}`, 'sa', { entries: [{ month: 5, plannedDate: `${year}-05-10`, toleranceDays: 3 }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_ENTRY_HAS_EVIDENCE');
    expect(res.json().message).toContain(`${year}-02-10`);
    expect((await prisma.pmSchedule.findUnique({ where: { id: scheduleId } }))?.status).toBe('ACTIVE');
  });

  it('refuses an overlapping replacement set — 409 PM_VISIT_OVERLAP, nothing archived', async () => {
    const res = await inject('PUT', `/api/pm-schedules/${scheduleId}`, 'sa', {
      entries: [
        { month: 2, plannedDate: `${year}-02-10`, toleranceDays: 3 },
        { month: 2, plannedDate: `${year}-02-14`, toleranceDays: 3 },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_OVERLAP');
    expect((await prisma.pmSchedule.findUnique({ where: { id: scheduleId } }))?.status).toBe('ACTIVE');
  });

  it('archives v1, creates v2, carries the approved visit forward and re-points its execution', async () => {
    cfg.set('action-reauth', { UPDATE_PM_SCHEDULE: [fx.roleName('UPD')] });
    const res = await inject('PUT', `/api/pm-schedules/${scheduleId}`, 'upd', {
      entries: [
        { month: 2, plannedDate: `${year}-02-10`, toleranceDays: 3 },  // same date as the approved visit
        { month: 8, plannedDate: `${year}-08-10`, toleranceDays: 4, notes: 'new' }, // the PENDING May visit is dropped (no evidence)
      ],
    }, fx.password);
    expect(res.statusCode).toBe(200);
    const v2 = res.json();
    expect(v2).toMatchObject({ entityId: ahuId, year, version: 2, status: 'ACTIVE' });

    expect((await prisma.pmSchedule.findUnique({ where: { id: scheduleId } }))?.status).toBe('ARCHIVED');
    const entries = await prisma.pmScheduleEntry.findMany({ where: { scheduleId: v2.id }, orderBy: { plannedDate: 'asc' } });
    expect(entries.map((e) => iso(e.plannedDate))).toEqual([`${year}-02-10`, `${year}-08-10`]);
    // Carried forward: approval + attribution.
    expect(entries[0]).toMatchObject({ approvalStatus: 'APPROVED', approvedBy: sa.id, approvedByName: 'qa-signer', submittedByName: 'uploader' });
    // A brand-new visit starts from the column defaults.
    expect(entries[1]).toMatchObject({ approvalStatus: 'PENDING', approvedBy: null, notes: 'new', toleranceDays: 4 });
    expect(iso(entries[1].windowStart)).toBe(`${year}-08-06`);
    // Execution evidence follows the visit to the new version.
    expect((await prisma.pmExecution.findUnique({ where: { id: executionId } }))?.scheduleEntryId).toBe(entries[0].id);

    const audit = await latestAudit('UPDATED', v2.id);
    expect(audit).toMatchObject({ userId: users.upd.username, userRole: fx.roleName('UPD'), targetType: 'pm_schedule' });
    expect(audit?.beforeValue).toEqual({ version: 1 });
    expect(audit?.afterValue).toEqual({ version: 2 });
    expect(audit?.signatureAuditId).toBeTruthy();

    const history = (await inject('GET', `/api/pm-schedules/${ahuId}/history`, 'read')).json();
    expect(history.filter((h: any) => h.year === year).map((h: any) => [h.version, h.status])).toEqual([[2, 'ACTIVE'], [1, 'ARCHIVED']]);
  });

  it('a further version: re-auth is asked first, and a visit sent without a tolerance gets a zero-day window', async () => {
    const v2 = await prisma.pmSchedule.findFirstOrThrow({ where: { entityId: ahuId, year, status: 'ACTIVE' } });
    cfg.set('action-reauth', { UPDATE_PM_SCHEDULE: ['SUPER_ADMIN'] });
    const body = { entries: [{ month: 2, plannedDate: `${year}-02-10` }, { month: 8, plannedDate: `${year}-08-10`, toleranceDays: 4 }] };
    const refused = await inject('PUT', `/api/pm-schedules/${v2.id}`, 'sa', body);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toBe('REAUTH_REQUIRED');
    expect((await prisma.pmSchedule.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe('ACTIVE');

    const res = await inject('PUT', `/api/pm-schedules/${v2.id}`, 'sa', body, fx.password);
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(3);
    const feb = (await prisma.pmScheduleEntry.findMany({ where: { scheduleId: res.json().id }, orderBy: { plannedDate: 'asc' } }))[0];
    expect([feb.toleranceDays, iso(feb.windowStart), iso(feb.windowEnd), feb.approvalStatus]).toEqual([0, `${year}-02-10`, `${year}-02-10`, 'APPROVED']);
    expect((await prisma.pmExecution.findUniqueOrThrow({ where: { id: executionId } })).scheduleEntryId).toBe(feb.id);
  });
});

describe('DELETE /:id', () => {
  let scheduleId: string;
  let entryId: string;
  const year = YEAR + 2;

  beforeAll(async () => {
    const s = await fx.schedule(ahu2Id, year, sa.id, [{ plannedDate: new Date(`${year}-04-04`), toleranceDays: 2 }]);
    scheduleId = s.scheduleId;
    entryId = s.entryIds[0];
  });

  it('is SUPER_ADMIN-only — PM_DELETE alone does not open it', async () => {
    const res = await inject('DELETE', `/api/pm-schedules/${scheduleId}`, 'del');
    expect(res.statusCode).toBe(403);
    expect(await prisma.pmSchedule.count({ where: { id: scheduleId } })).toBe(1);
  });

  it('refuses while an execution is IN_PROGRESS', async () => {
    const ex = await prisma.pmExecution.create({ data: { scheduleEntryId: entryId, entityId: ahu2Id, status: 'IN_PROGRESS', startedAt: new Date() } });
    const res = await inject('DELETE', `/api/pm-schedules/${scheduleId}`, 'sa');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
    expect(res.json().message).toMatch(/in progress/);
    await prisma.pmExecution.update({ where: { id: ex.id }, data: { status: 'COMPLETED' } });
  });

  it('deletes the schedule, its entries and their executions, and audits DELETED', async () => {
    cfg.set('action-reauth', { DELETE_PM_SCHEDULE: ['SUPER_ADMIN'] });
    expect((await inject('DELETE', `/api/pm-schedules/${scheduleId}`, 'sa')).statusCode).toBe(401);
    const res = await inject('DELETE', `/api/pm-schedules/${scheduleId}`, 'sa', undefined, fx.password);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(await prisma.pmSchedule.count({ where: { id: scheduleId } })).toBe(0);
    expect(await prisma.pmScheduleEntry.count({ where: { id: entryId } })).toBe(0);
    expect(await prisma.pmExecution.count({ where: { scheduleEntryId: entryId } })).toBe(0);
    const audit = await latestAudit('DELETED', scheduleId);
    expect(audit?.beforeValue).toEqual({ entityId: ahu2Id, year, version: 1 });
  });

  it('404s for an unknown schedule', async () => {
    const res = await inject('DELETE', `/api/pm-schedules/${scheduleId}`, 'sa');
    expect(res.statusCode).toBe(404);
  });
});

describe('AHU filter-set config', () => {
  const row = async (id: string) => {
    const res = await inject('GET', '/api/pm-schedules/ahu-configs', 'read');
    expect(res.statusCode).toBe(200);
    return res.json().ahus.find((a: any) => a.ahuId === id);
  };

  it('lists each active AHU with its mode, per-set counts (retired excluded) and schedule flag', async () => {
    expect(await row(ahuId)).toEqual({
      ahuId, ahuName: `${fx.tag}-AHU-1`, mode: 'BOTH',
      setACount: 1, setBCount: 1, noSetCount: 1, totalFilters: 3, hasActiveSchedule: true,
    });
    expect(await row(ahuFreshId)).toMatchObject({ mode: 'BOTH', totalFilters: 0, hasActiveSchedule: false });
  });

  it('refuses PUT to a role without PM_UPDATE, and an unknown mode at the schema', async () => {
    const forbidden = await inject('PUT', `/api/pm-schedules/ahu-configs/${ahuId}`, 'read', { mode: 'SET_A' });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().requiredPermission).toBe('PM_UPDATE');
    const bad = await inject('PUT', `/api/pm-schedules/ahu-configs/${ahuId}`, 'sa', { mode: 'SET_C' });
    expect(bad.statusCode).toBe(400);
  });

  it('404s for an unknown AHU', async () => {
    const res = await inject('PUT', '/api/pm-schedules/ahu-configs/00000000-0000-4000-8000-000000000000', 'sa', { mode: 'SET_A' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('sets the mode, preserves the other customAttributes keys and audits the before/after', async () => {
    cfg.set('action-reauth', { UPDATE_CONFIG_PAGE: [fx.roleName('UPD')] });
    expect((await inject('PUT', `/api/pm-schedules/ahu-configs/${ahuId}`, 'upd', { mode: 'SET_B' })).statusCode).toBe(401);
    const res = await inject('PUT', `/api/pm-schedules/ahu-configs/${ahuId}`, 'upd', { mode: 'SET_B' }, fx.password);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ahuId, ahuName: `${fx.tag}-AHU-1`, mode: 'SET_B' });
    const attrs = (await prisma.assetInstance.findUnique({ where: { id: ahuId } }))?.customAttributes as any;
    expect(attrs).toEqual({ keepMe: 'yes', pmFilterSetMode: 'SET_B' });
    const audit = await latestAudit('AHU_PM_FILTER_SET_MODE_UPDATED', ahuId);
    expect(audit?.beforeValue).toEqual({ pmFilterSetMode: 'BOTH' });
    expect(audit?.afterValue).toEqual({ pmFilterSetMode: 'SET_B', ahuName: `${fx.tag}-AHU-1` });
    expect((await row(ahuId)).mode).toBe('SET_B');

    // Back to DISABLED and then BOTH: the before value tracks the stored mode.
    await inject('PUT', `/api/pm-schedules/ahu-configs/${ahuId}`, 'sa', { mode: 'DISABLED' });
    expect((await row(ahuId)).mode).toBe('DISABLED');
    await inject('PUT', `/api/pm-schedules/ahu-configs/${ahuId}`, 'sa', { mode: 'BOTH' });
    expect((await latestAudit('AHU_PM_FILTER_SET_MODE_UPDATED', ahuId))?.beforeValue).toEqual({ pmFilterSetMode: 'DISABLED' });
  });

  it('an unrecognised stored mode reads back as BOTH', async () => {
    await prisma.assetInstance.update({ where: { id: ahuFreshId }, data: { customAttributes: { pmFilterSetMode: 'LEGACY' } } });
    expect((await row(ahuFreshId)).mode).toBe('BOTH');
  });
});

describe('POST /api/pm-executions — start a PM task', () => {
  let approvedEntry: string;
  let pendingEntry: string;
  const today = utcDay(0);

  beforeAll(async () => {
    const s = await fx.schedule(ahuFreshId, today.getUTCFullYear() + 10, sa.id, [
      { plannedDate: today, toleranceDays: 2, approvalStatus: 'APPROVED' },
      { plannedDate: new Date(today.getTime() + 60 * DAY), toleranceDays: 2, approvalStatus: 'PENDING' },
    ]);
    [approvedEntry, pendingEntry] = s.entryIds;
  });

  it('requires PM_EXECUTE', async () => {
    const res = await inject('POST', '/api/pm-executions', 'read', { scheduleEntryId: approvedEntry, entityId: ahuFreshId });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_EXECUTE');
  });

  it('404s an unknown entry and refuses an entry that is not APPROVED', async () => {
    const missing = await inject('POST', '/api/pm-executions', 'sa', { scheduleEntryId: '00000000-0000-4000-8000-000000000000', entityId: ahuFreshId });
    expect(missing.statusCode).toBe(404);
    const pending = await inject('POST', '/api/pm-executions', 'sa', { scheduleEntryId: pendingEntry, entityId: ahuFreshId });
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error).toBe('ENTRY_NOT_APPROVED');
  });

  it('starts an execution against the entry\'s own AHU (never the body\'s), and audits PM_STARTED', async () => {
    cfg.set('action-reauth', { START_PM_TASK: ['SUPER_ADMIN'] });
    expect((await inject('POST', '/api/pm-executions', 'sa', { scheduleEntryId: approvedEntry, entityId: ahuId })).statusCode).toBe(401);
    const res = await inject('POST', '/api/pm-executions', 'sa', { scheduleEntryId: approvedEntry, entityId: ahuId, filterSet: 'SET_A' }, fx.password);
    expect(res.statusCode).toBe(201);
    const ex = res.json();
    expect(ex).toMatchObject({ scheduleEntryId: approvedEntry, entityId: ahuFreshId, status: 'IN_PROGRESS', performedBy: sa.id, filterSet: 'SET_A' });
    // `today` sits inside its own window — but the window's end is UTC midnight
    // today + 2 days, so this is robust to the run time of day.
    expect(ex.isWithinWindow).toBe(true);
    const audit = await latestAudit('PM_STARTED', ex.id);
    expect(audit?.afterValue).toMatchObject({ entityId: ahuFreshId, isWithinWindow: true, filterSet: 'SET_A' });

    const again = await inject('POST', '/api/pm-executions', 'sa', { scheduleEntryId: approvedEntry, entityId: ahuFreshId }, fx.password);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('CONFLICT');
  });
});
