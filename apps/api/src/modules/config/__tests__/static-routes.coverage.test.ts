/**
 * Coverage of the config static routes that had no e2e test (2026-10-21):
 * dashboard-cards, export-options, pm-schedule-filters,
 * replacement-schedule-filters, report-labels, report-page-titles,
 * cleaning-profile-assignment, offline-cache, tablet-access (refusals only),
 * access-matrix my-modules, report-signatories resolved, the AHU completion
 * mode read and the two public `/current` reads in routes.ts.
 *
 * Every assertion is what a client or the database observes: status, error
 * code, body, the stored `system_config` value, and the CONFIG_CHANGED audit
 * row with its chain link to the row before it.
 *
 * Shared state rules (many suites share digilog_test_db):
 *  - every key this file writes is snapshotted first and restored in a
 *    `finally`, so the change window is one test long;
 *  - writes to a key other users read are SUPERSETS: they add an entry for
 *    this file's own role and leave every other entry as it was;
 *  - `tablet-access` and `replacement-schedule-filters` are never changed in
 *    value (refusals + an identical-value write only);
 *  - re-auth policy is touched only through addReauth/removeReauth merges on
 *    this file's own role.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { passwordPolicySchema, exportLimitConfigSchema, offlineCacheConfigSchema, getDefaultTemplates } from '@digilog/shared';
import { buildApp, authGet, authPut, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import { TABLET_FEATURES } from '../../../lib/tablet-access.js';
import {
  cleanupAll, runSuffix, createRole, createUser, login, deleteUsers, deleteRoles,
  addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import { stored, restoreKey, withRowAbsent, chainedAuditRow, snapshotRows, restoreRows } from './support/config-rows.js';

const SFX = runSuffix();
const PW = 'CvcStatic@2026';
const SA_USER = `cvcsa${SFX}`.toLowerCase();
const ADM_USER = `cvcadm${SFX}`.toLowerCase();
const RO_USER = `cvcro${SFX}`.toLowerCase();
const ADM_ROLE = `CVC_ADM_${SFX}`;
const RO_ROLE = `CVC_RO_${SFX}`;

let app: FastifyInstance;
let saToken = '';
let admToken = '';
let roToken = '';
const userIds: string[] = [];
let reauthAdded: ReauthGrant = [];

const auditCount = (where: Prisma.AuditTrailWhereInput) => prisma.auditTrail.count({ where });

/** Every shared config row this file writes; put back exactly (value + metadata) in afterAll. */
const TOUCHED_KEYS = ['dashboard-cards', 'export-options', 'pm-schedule-filters', 'replacement-schedule-filters', 'report-labels', 'report-page-titles', 'cleaning-profile-assignment', 'offline-cache', 'tablet-access', 'access-matrix', 'branding', 'user-id', 'report-signatories', 'audit-templates'];
let originalRows: Awaited<ReturnType<typeof snapshotRows>> = new Map();

beforeAll(async () => {
  originalRows = await snapshotRows(TOUCHED_KEYS);
  await createRole(ADM_ROLE, ['CONFIG_READ', 'CONFIG_UPDATE', 'ROLE_MANAGE', 'USER_CREATE']);
  await createRole(RO_ROLE, []);
  userIds.push(await createUser(SA_USER, 'SUPER_ADMIN', PW));
  userIds.push(await createUser(ADM_USER, ADM_ROLE, PW));
  userIds.push(await createUser(RO_USER, RO_ROLE, PW));
  app = await buildApp();
  saToken = await login(app, SA_USER, PW);
  admToken = await login(app, ADM_USER, PW);
  roToken = await login(app, RO_USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['config row metadata', () => restoreRows(originalRows)],
    ['re-auth grants', () => removeReauth(reauthAdded)],
    ['app', async () => app?.close()],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles([ADM_ROLE, RO_ROLE])],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

// ─── dashboard-cards ──────────────────────────────────────────────
describe('dashboard-cards', () => {
  it('GET /current returns the stored map, or {} when nothing is stored', async () => {
    const res = await authGet(app, '/api/config/dashboard-cards/current', roToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual((await stored('dashboard-cards')) ?? {});
  });

  it('refuses a role whose cards are not a list, and stores nothing', async () => {
    const before = await stored('dashboard-cards');
    const res = await authPut(app, '/api/config/dashboard-cards', saToken, { configValue: { roles: { [ADM_ROLE]: 'total_users' } } }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'INVALID_CARDS', message: `Cards for role ${ADM_ROLE} must be an array` });
    expect(await stored('dashboard-cards')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('refuses unknown card keys, naming each role:key, and stores nothing', async () => {
    const before = await stored('dashboard-cards');
    const res = await authPut(app, '/api/config/dashboard-cards', saToken,
      { configValue: { roles: { [ADM_ROLE]: ['total_users', 'bogus_card'], [RO_ROLE]: ['nope'] } } }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_CARD_KEY');
    expect(res.json().message).toContain(`${ADM_ROLE}:bogus_card`);
    expect(res.json().message).toContain(`${RO_ROLE}:nope`);
    expect(await stored('dashboard-cards')).toEqual(before);
  });

  it('requires configValue in the body (schema 400)', async () => {
    const res = await authPut(app, '/api/config/dashboard-cards', saToken, {}, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internalErrors).toEqual([]);
  });

  it('is forbidden without CONFIG_UPDATE', async () => {
    const res = await authPut(app, '/api/config/dashboard-cards', roToken, { configValue: { roles: {} } }, PW);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('saves a valid map, serves it on /current, and audits the before/after', async () => {
    const snapshot = await stored('dashboard-cards');
    const existingRoles = ((snapshot as { roles?: Record<string, string[]> } | null)?.roles) ?? {};
    const configValue = { ...(snapshot as object ?? {}), roles: { ...existingRoles, [ADM_ROLE]: ['total_users', 'quick_actions'] } };
    try {
      const res = await authPut(app, '/api/config/dashboard-cards', saToken, { configValue }, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(await stored('dashboard-cards')).toEqual(configValue);

      const cur = await authGet(app, '/api/config/dashboard-cards/current', admToken);
      expect(cur.json().roles[ADM_ROLE]).toEqual(['total_users', 'quick_actions']);

      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'dashboard-cards', userId: SA_USER });
      expect(row.targetType).toBe('system_config');
      expect(row.beforeValue).toEqual(snapshot);
      expect(row.afterValue).toEqual(configValue);

      // A map with no `roles` at all is valid (nothing to check) and replaces the stored one.
      const second = await authPut(app, '/api/config/dashboard-cards', saToken, { configValue: { note: 'no roles' } }, PW);
      expect(second.statusCode).toBe(200);
      expect(await stored('dashboard-cards')).toEqual({ note: 'no roles' });
      const row2 = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'dashboard-cards', userId: SA_USER });
      expect(row2.beforeValue).toEqual(configValue);
      expect(row2.afterValue).toEqual({ note: 'no roles' });
    } finally {
      await restoreKey('dashboard-cards', snapshot);
    }
  });
});

// ─── export-options ───────────────────────────────────────────────
describe('export-options', () => {
  it('GET needs CONFIG_READ and returns the stored matrix', async () => {
    expect((await authGet(app, '/api/config/export-options', roToken)).statusCode).toBe(403);
    const res = await authGet(app, '/api/config/export-options', admToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual((await stored('export-options')) ?? {});
  });

  it('GET /current: SUPER_ADMIN always gets {} (= every format)', async () => {
    const res = await authGet(app, '/api/config/export-options/current', saToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('refuses a surface map that is not an object of strings (schema 400)', async () => {
    const before = await stored('export-options');
    const res = await authPut(app, '/api/config/export-options', saToken, { [ADM_ROLE]: 'PDF' }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(await stored('export-options')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('saves a role entry, serves only that role its own entry on /current, and audits it', async () => {
    const snapshot = await stored('export-options');
    const body = { ...((snapshot as Record<string, Record<string, string>> | null) ?? {}), [ADM_ROLE]: { 'filter-list': 'PDF', 'audit-trail': 'NONE' } };
    try {
      const before = await authGet(app, '/api/config/export-options/current', admToken);
      expect(before.json()).toEqual({}); // no entry yet -> fail open

      const res = await authPut(app, '/api/config/export-options', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      expect(await stored('export-options')).toEqual(body);

      const mine = await authGet(app, '/api/config/export-options/current', admToken);
      expect(mine.json()).toEqual({ 'filter-list': 'PDF', 'audit-trail': 'NONE' });
      const other = await authGet(app, '/api/config/export-options/current', roToken);
      expect(other.json()).toEqual({}); // RO_ROLE has no entry

      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'export-options', userId: SA_USER });
      expect(row.beforeValue ?? null).toEqual(snapshot);
      expect(row.afterValue).toEqual(body);
    } finally {
      await restoreKey('export-options', snapshot);
    }
  });
});

// ─── pm-schedule-filters ──────────────────────────────────────────
describe('pm-schedule-filters', () => {
  it('GET needs CONFIG_READ and returns the stored map', async () => {
    expect((await authGet(app, '/api/config/pm-schedule-filters', roToken)).statusCode).toBe(403);
    const res = await authGet(app, '/api/config/pm-schedule-filters', admToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual((await stored('pm-schedule-filters')) ?? {});
  });

  it('/current: SUPER_ADMIN is always enabled; a role with no entry is not (fail-closed)', async () => {
    expect((await authGet(app, '/api/config/pm-schedule-filters/current', saToken)).json()).toEqual({ enabled: true });
    expect((await authGet(app, '/api/config/pm-schedule-filters/current', roToken)).json()).toEqual({ enabled: false });
  });

  it('refuses a non-boolean value (schema 400) and stores nothing', async () => {
    const before = await stored('pm-schedule-filters');
    const res = await authPut(app, '/api/config/pm-schedule-filters', saToken, { [ADM_ROLE]: 'yes' }, PW);
    expect(res.statusCode).toBe(400);
    expect(await stored('pm-schedule-filters')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('enabling a role turns /current on for that role only, and is audited', async () => {
    const snapshot = await stored('pm-schedule-filters');
    const body = { ...((snapshot as Record<string, boolean> | null) ?? {}), [ADM_ROLE]: true };
    try {
      const res = await authPut(app, '/api/config/pm-schedule-filters', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      expect(await stored('pm-schedule-filters')).toEqual(body);
      expect((await authGet(app, '/api/config/pm-schedule-filters/current', admToken)).json()).toEqual({ enabled: true });
      expect((await authGet(app, '/api/config/pm-schedule-filters/current', roToken)).json()).toEqual({ enabled: false });
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'pm-schedule-filters', userId: SA_USER });
      expect(row.afterValue).toEqual(body);
      expect((await authGet(app, '/api/config/pm-schedule-filters', admToken)).json()).toEqual(body);

      // Turning it off again records the previous map as the before-value.
      const off = { ...body, [ADM_ROLE]: false };
      expect((await authPut(app, '/api/config/pm-schedule-filters', saToken, off, PW)).statusCode).toBe(200);
      expect((await authGet(app, '/api/config/pm-schedule-filters/current', admToken)).json()).toEqual({ enabled: false });
      const row2 = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'pm-schedule-filters', userId: SA_USER });
      expect(row2.beforeValue).toEqual(body);
      expect(row2.afterValue).toEqual(off);
    } finally {
      await restoreKey('pm-schedule-filters', snapshot);
    }
  });
});

// ─── replacement-schedule-filters (value never changed) ───────────
describe('replacement-schedule-filters', () => {
  it('GET needs CONFIG_READ and returns the stored map', async () => {
    expect((await authGet(app, '/api/config/replacement-schedule-filters', roToken)).statusCode).toBe(403);
    const res = await authGet(app, '/api/config/replacement-schedule-filters', admToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual((await stored('replacement-schedule-filters')) ?? {});
  });

  it('/current: SUPER_ADMIN enabled; a role with no entry is not', async () => {
    expect((await authGet(app, '/api/config/replacement-schedule-filters/current', saToken)).json()).toEqual({ enabled: true });
    const map = ((await stored('replacement-schedule-filters')) as Record<string, boolean> | null) ?? {};
    expect((await authGet(app, '/api/config/replacement-schedule-filters/current', roToken)).json()).toEqual({ enabled: !!map[RO_ROLE] });
  });

  it('refuses a non-boolean value (schema 400)', async () => {
    // An object, not 1 / "true": Fastify's AJV coerces those to a boolean, which would pass.
    const res = await authPut(app, '/api/config/replacement-schedule-filters', saToken, { [ADM_ROLE]: { on: true } }, PW);
    expect(res.statusCode).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('an identical-value save succeeds and is audited with matching before/after', async () => {
    const current = await stored('replacement-schedule-filters');
    const body = (current as Record<string, boolean> | null) ?? {};
    try {
      const res = await authPut(app, '/api/config/replacement-schedule-filters', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      expect(await stored('replacement-schedule-filters')).toEqual(body);
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'replacement-schedule-filters', userId: SA_USER });
      expect(row.afterValue).toEqual(body);
    } finally {
      await restoreKey('replacement-schedule-filters', current);
    }
  });
});

// ─── report-labels ────────────────────────────────────────────────
describe('report-labels', () => {
  it('/current is readable by any signed-in user', async () => {
    const res = await authGet(app, '/api/config/report-labels/current', roToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual((await stored('report-labels')) ?? {});
  });

  it('PUT is forbidden without CONFIG_UPDATE', async () => {
    const res = await authPut(app, '/api/config/report-labels', roToken, {}, PW);
    expect(res.statusCode).toBe(403);
  });

  it('saves an override map verbatim, serves it, and audits before/after', async () => {
    const snapshot = await stored('report-labels');
    const probeKey = `cvcProbe${SFX}`;
    const body = { ...((snapshot as Record<string, unknown> | null) ?? {}), [probeKey]: { title: 'Probe title', columns: { a: 'Col A' } } };
    try {
      const res = await authPut(app, '/api/config/report-labels', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      const cur = await authGet(app, '/api/config/report-labels/current', roToken);
      expect(cur.json()[probeKey]).toEqual({ title: 'Probe title', columns: { a: 'Col A' } });
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'report-labels', userId: SA_USER });
      expect(row.afterValue).toEqual(body);
      expect(row.beforeValue ?? null).toEqual(snapshot);
    } finally {
      await restoreKey('report-labels', snapshot);
    }
  });
});

// ─── report-page-titles ───────────────────────────────────────────
describe('report-page-titles', () => {
  it('/current is readable by any signed-in user; the editor read needs CONFIG_READ', async () => {
    const value = (await stored('report-page-titles')) ?? {};
    const cur = await authGet(app, '/api/config/report-page-titles/current', roToken);
    expect(cur.statusCode).toBe(200);
    expect(cur.json()).toEqual(value);
    expect((await authGet(app, '/api/config/report-page-titles', roToken)).statusCode).toBe(403);
    const ed = await authGet(app, '/api/config/report-page-titles', admToken);
    expect(ed.statusCode).toBe(200);
    expect(ed.json()).toEqual(value);
  });

  it('saves the labels, answers with a message, and audits with a signature meaning', async () => {
    const snapshot = await stored('report-page-titles');
    const body = { ...((snapshot as Record<string, unknown> | null) ?? {}), cvcProbe: `probe-${SFX}` };
    try {
      const res = await authPut(app, '/api/config/report-page-titles', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, message: 'Report Page Titles updated' });
      expect(await stored('report-page-titles')).toEqual(body);
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'report-page-titles', userId: SA_USER });
      expect(row.targetType).toBe('config');
      expect(row.signatureMeaning).toBe('Report Page Titles configuration updated');
      expect(row.beforeValue).toEqual(snapshot ?? {});
      expect(row.afterValue).toEqual(body);
    } finally {
      await restoreKey('report-page-titles', snapshot);
    }
  });
});

// ─── cleaning-profile-assignment (identical value only) ──────────
describe('cleaning-profile-assignment', () => {
  const DEFAULT = { mode: 'BY_ENTITY', rules: [] };

  it('GET needs CONFIG_READ; both reads return the stored value or the BY_ENTITY default', async () => {
    const value = (await stored('cleaning-profile-assignment')) ?? DEFAULT;
    expect((await authGet(app, '/api/config/cleaning-profile-assignment', roToken)).statusCode).toBe(403);
    expect((await authGet(app, '/api/config/cleaning-profile-assignment', admToken)).json()).toEqual(value);
    const cur = await authGet(app, '/api/config/cleaning-profile-assignment/current', roToken);
    expect(cur.statusCode).toBe(200);
    expect(cur.json()).toEqual(value);
  });

  it('refuses an unknown mode and a missing rules list (schema 400)', async () => {
    const before = await stored('cleaning-profile-assignment');
    const bad1 = await authPut(app, '/api/config/cleaning-profile-assignment', saToken, { mode: 'BY_MOON', rules: [] }, PW);
    expect(bad1.statusCode).toBe(400);
    const bad2 = await authPut(app, '/api/config/cleaning-profile-assignment', saToken, { mode: 'BY_ENTITY' }, PW);
    expect(bad2.statusCode).toBe(400);
    expect(await stored('cleaning-profile-assignment')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('an identical-value save is stored and audited', async () => {
    const snapshot = await stored('cleaning-profile-assignment');
    const body = (snapshot as { mode: string; rules: unknown[] } | null) ?? DEFAULT;
    try {
      const res = await authPut(app, '/api/config/cleaning-profile-assignment', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(await stored('cleaning-profile-assignment')).toEqual(body);
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'cleaning-profile-assignment', userId: SA_USER });
      expect(row.afterValue).toEqual(body);
      expect(row.beforeValue ?? null).toEqual(snapshot);

      // With a stored row both reads serve it, and a second save records it as the before-value.
      expect((await authGet(app, '/api/config/cleaning-profile-assignment', admToken)).json()).toEqual(body);
      expect((await authGet(app, '/api/config/cleaning-profile-assignment/current', roToken)).json()).toEqual(body);
      expect((await authPut(app, '/api/config/cleaning-profile-assignment', saToken, body, PW)).statusCode).toBe(200);
      const row2 = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'cleaning-profile-assignment', userId: SA_USER });
      expect(row2.beforeValue).toEqual(body);
    } finally {
      await restoreKey('cleaning-profile-assignment', snapshot);
    }
  });
});

// ─── offline-cache ────────────────────────────────────────────────
describe('offline-cache', () => {
  it('the editor read is SUPER_ADMIN-only and returns the parsed config', async () => {
    expect((await authGet(app, '/api/config/offline-cache', admToken)).statusCode).toBe(403);
    const res = await authGet(app, '/api/config/offline-cache', saToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(offlineCacheConfigSchema.parse((await stored('offline-cache')) ?? {}));
  });

  it('PUT is SUPER_ADMIN-only', async () => {
    const res = await authPut(app, '/api/config/offline-cache', admToken, { cacheStalenessHours: 12 }, PW);
    expect(res.statusCode).toBe(403);
  });

  it('a partial save merges over the stored value, drops transport fields, and /current serves it', async () => {
    const snapshot = await stored('offline-cache');
    const prior = offlineCacheConfigSchema.parse(snapshot ?? {});
    const target = prior.cacheStalenessHours === 12 ? 13 : 12;
    try {
      const res = await authPut(app, '/api/config/offline-cache', saToken,
        { cacheStalenessHours: target, _currentPassword: PW, _clientOpId: 'op-1' }, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, data: { cacheStalenessHours: target, cacheHardCutoffHours: prior.cacheHardCutoffHours } });
      const saved = (await stored('offline-cache')) as Record<string, unknown>;
      expect(saved).toEqual({ cacheStalenessHours: target, cacheHardCutoffHours: prior.cacheHardCutoffHours });
      expect(saved).not.toHaveProperty('_clientOpId');
      expect(saved).not.toHaveProperty('_currentPassword');

      const cur = await authGet(app, '/api/config/offline-cache/current', roToken);
      expect(cur.json()).toEqual({ cacheStalenessHours: target, cacheHardCutoffHours: prior.cacheHardCutoffHours });

      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'offline-cache', userId: SA_USER });
      expect(row.signatureMeaning).toBe('System configuration modified: offline-cache');
      expect(JSON.stringify(row.afterValue)).not.toContain(PW);
    } finally {
      await restoreKey('offline-cache', snapshot);
    }
  });

  it('refuses an out-of-range value with VALIDATION_ERROR and stores nothing', async () => {
    const before = await stored('offline-cache');
    const res = await authPut(app, '/api/config/offline-cache', saToken, { cacheHardCutoffHours: 500 }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(await stored('offline-cache')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('with no stored row: /current falls back to 24/24 and a save creates the row from the body alone', async () => {
    const snapshot = await stored('offline-cache');
    try {
      await prisma.systemConfig.deleteMany({ where: { configKey: 'offline-cache' } });
      expect((await authGet(app, '/api/config/offline-cache/current', roToken)).json())
        .toEqual({ cacheStalenessHours: 24, cacheHardCutoffHours: 24 });
      const res = await authPut(app, '/api/config/offline-cache', saToken, { cacheStalenessHours: 6 }, PW);
      expect(res.statusCode).toBe(200);
      // Nothing to merge with: unsent fields take the schema default.
      expect(await stored('offline-cache')).toEqual({ cacheStalenessHours: 6, cacheHardCutoffHours: 24 });
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'offline-cache', userId: SA_USER });
      expect(row.beforeValue).toBeNull();
    } finally {
      if (snapshot === null) await prisma.systemConfig.deleteMany({ where: { configKey: 'offline-cache' } });
      else await prisma.systemConfig.upsert({
        where: { configKey: 'offline-cache' },
        update: { configValue: snapshot as Prisma.InputJsonValue },
        create: { configKey: 'offline-cache', configValue: snapshot as Prisma.InputJsonValue, configType: 'advanced', requiresReauth: true },
      });
    }
  });
});

// ─── tablet-access (value never changed) ──────────────────────────
describe('tablet-access', () => {
  it('GET is SUPER_ADMIN-only (D03-15) and hides entries for roles that no longer exist', async () => {
    expect((await authGet(app, '/api/config/tablet-access', roToken)).statusCode).toBe(403);
    // A CONFIG_READ / CONFIG_UPDATE holder (the ADMIN shape) is refused too.
    expect((await authGet(app, '/api/config/tablet-access', admToken)).statusCode).toBe(403);
    const res = await authGet(app, '/api/config/tablet-access', saToken);
    expect(res.statusCode).toBe(200);
    const raw = ((await stored('tablet-access')) as Record<string, unknown> | null) ?? {};
    const live = new Set((await prisma.role.findMany({ select: { name: true } })).map((r) => r.name));
    expect(res.json()).toEqual(Object.fromEntries(Object.entries(raw).filter(([r]) => live.has(r))));
  });

  it('a save always needs the password, even when the policy names no role', async () => {
    const before = await stored('tablet-access');
    const res = await authPut(app, '/api/config/tablet-access', saToken, {});
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('REAUTH_REQUIRED');
    expect(await stored('tablet-access')).toEqual(before);
  });

  it('refuses SUPER_ADMIN, unknown roles, non-list values and unknown features, naming every problem', async () => {
    const before = await stored('tablet-access');
    const res = await authPut(app, '/api/config/tablet-access', saToken, {
      SUPER_ADMIN: ['login'],
      [`NOPE_${SFX}`]: ['login'],
      [ADM_ROLE]: 'login',
      [RO_ROLE]: ['login', 'teleport'],
    }, PW);
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details.problems).toEqual([
      'SUPER_ADMIN cannot be configured (it always has every tablet feature)',
      `unknown role NOPE_${SFX}`,
      `${ADM_ROLE} must be a list of feature names`,
      `${RO_ROLE}: unknown feature(s) teleport`,
    ]);
    expect(body.message).toContain('Tablet access not saved');
    expect(await stored('tablet-access')).toEqual(before);
    expect(internalErrors).toEqual([]);
  });

  it('refuses a list that is not all strings', async () => {
    const res = await authPut(app, '/api/config/tablet-access', saToken, { [ADM_ROLE]: ['login', 7] }, PW);
    expect(res.statusCode).toBe(400);
    expect(res.json().details.problems).toEqual([`${ADM_ROLE} must be a list of feature names`]);
  });

  it('an identical-value save is accepted and audited', async () => {
    const snapshot = await stored('tablet-access');
    const live = new Set((await prisma.role.findMany({ select: { name: true } })).map((r) => r.name));
    const raw = (snapshot as Record<string, string[]> | null) ?? {};
    // Only possible when every stored entry still names a live role.
    if (Object.keys(raw).some((r) => !live.has(r))) return;
    try {
      const res = await authPut(app, '/api/config/tablet-access', saToken, raw, PW);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(await stored('tablet-access')).toEqual(raw);
      const row = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'tablet-access', userId: SA_USER });
      expect(row.afterValue).toEqual(raw);
    } finally {
      await restoreKey('tablet-access', snapshot);
    }
  });

  it('my-features: SUPER_ADMIN has every feature; another role follows the stored allowlist', async () => {
    const sa = await authGet(app, '/api/config/tablet-access/my-features', saToken);
    expect(sa.statusCode).toBe(200);
    expect(sa.json()).toEqual({ role: 'SUPER_ADMIN', allowed: [...TABLET_FEATURES], configured: false });

    const raw = ((await stored('tablet-access')) as Record<string, string[]> | null) ?? {};
    const mine = await authGet(app, '/api/config/tablet-access/my-features', roToken);
    expect(mine.statusCode).toBe(200);
    // RO_ROLE has no entry: default-allow on an empty config, deny-all once any role is configured.
    expect(mine.json()).toEqual({ role: RO_ROLE, allowed: [], configured: Object.keys(raw).length > 0 });
  });
});

// ─── access-matrix my-modules ────────────────────────────────────
describe('access-matrix', () => {
  it('my-modules lists exactly the modules whose role list names the caller', async () => {
    const snapshot = await stored('access-matrix');
    const matrix = (snapshot as Record<string, string[]> | null) ?? {};
    const moduleKey = `cvc-probe-${SFX.toLowerCase()}`;
    try {
      const before = await authGet(app, '/api/config/access-matrix/my-modules', admToken);
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual({ role: ADM_ROLE, allowed: [] });

      const body = { ...matrix, [moduleKey]: [ADM_ROLE] };
      const put = await authPut(app, '/api/config/access-matrix', saToken, body, PW);
      expect(put.statusCode).toBe(200);

      const after = await authGet(app, '/api/config/access-matrix/my-modules', admToken);
      expect(after.json()).toEqual({ role: ADM_ROLE, allowed: [moduleKey] });
      // Another role sees the modules that name it (none of ours).
      const other = await authGet(app, '/api/config/access-matrix/my-modules', roToken);
      expect(other.json().allowed).not.toContain(moduleKey);
    } finally {
      await restoreKey('access-matrix', snapshot);
    }
  });
});

// ─── small public reads ──────────────────────────────────────────
describe('public reads', () => {
  it('report-signatories/resolved returns the stored label map to any user', async () => {
    const res = await authGet(app, '/api/config/report-signatories/resolved', roToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual((await stored('report-signatories')) ?? {});
  });

  it('ahu-completion-process/current returns the stored mode (NONE unless POPUP/INTERLOCK)', async () => {
    const raw = ((await stored('ahu-completion-process')) as { mode?: string } | null)?.mode;
    const res = await authGet(app, '/api/config/ahu-completion-process/current', roToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: raw === 'POPUP' || raw === 'INTERLOCK' ? raw : 'NONE' });
  });

  it('password-policy/current and export-limit/current are served parsed to any user', async () => {
    const pp = await authGet(app, '/api/config/password-policy/current', roToken);
    expect(pp.statusCode).toBe(200);
    expect(pp.json()).toEqual(passwordPolicySchema.parse((await stored('password-policy')) ?? {}));
    const el = await authGet(app, '/api/config/export-limit/current', roToken);
    expect(el.statusCode).toBe(200);
    expect(el.json()).toEqual(exportLimitConfigSchema.parse((await stored('export-limit')) ?? {}));
  });
});

// ─── reads (and one write) with no stored row ─────────────────────
describe('with no stored row, every read falls back to its documented default', () => {
  it('export-options: the matrix and the per-role read are both {}', async () => {
    await withRowAbsent('export-options', async () => {
      expect((await authGet(app, '/api/config/export-options', admToken)).json()).toEqual({});
      expect((await authGet(app, '/api/config/export-options/current', admToken)).json()).toEqual({});
    });
  });

  it('replacement-schedule-filters: {} and not enabled (only exercised while the stored value is {})', async () => {
    const value = await stored('replacement-schedule-filters');
    if (value !== null && JSON.stringify(value) !== '{}') return; // absent must equal stored for other readers
    await withRowAbsent('replacement-schedule-filters', async () => {
      expect((await authGet(app, '/api/config/replacement-schedule-filters', admToken)).json()).toEqual({});
      expect((await authGet(app, '/api/config/replacement-schedule-filters/current', roToken)).json()).toEqual({ enabled: false });
    });
  });

  it('report-labels: /current is {}', async () => {
    await withRowAbsent('report-labels', async () => {
      expect((await authGet(app, '/api/config/report-labels/current', roToken)).json()).toEqual({});
    });
  });

  it('report-signatories: the matrix and the resolved labels are {}', async () => {
    await withRowAbsent('report-signatories', async () => {
      expect((await authGet(app, '/api/config/report-signatories', admToken)).json()).toEqual({});
      expect((await authGet(app, '/api/config/report-signatories/resolved', roToken)).json()).toEqual({});
    });
  });

  it('access-matrix: the matrix is {} and nobody has a module', async () => {
    await withRowAbsent('access-matrix', async () => {
      expect((await authGet(app, '/api/config/access-matrix', admToken)).json()).toEqual({});
      expect((await authGet(app, '/api/config/access-matrix/my-modules', admToken)).json()).toEqual({ role: ADM_ROLE, allowed: [] });
    });
  });

  it('audit-templates: /current serves the built-in defaults', async () => {
    await withRowAbsent('audit-templates', async () => {
      const res = await authGet(app, '/api/config/audit-templates/current', roToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(getDefaultTemplates());
    });
  });

  it('report-page-titles: both reads are {}, and a first save audits {} as the before-value', async () => {
    await withRowAbsent('report-page-titles', async () => {
      expect((await authGet(app, '/api/config/report-page-titles/current', roToken)).json()).toEqual({});
      expect((await authGet(app, '/api/config/report-page-titles', admToken)).json()).toEqual({});
      const body = { pageLabel: `Probe ${SFX}` };
      const res = await authPut(app, '/api/config/report-page-titles', saToken, body, PW);
      expect(res.statusCode).toBe(200);
      const row = await prisma.systemConfig.findUnique({ where: { configKey: 'report-page-titles' } });
      expect(row).toMatchObject({ configValue: body, configType: 'display', requiresReauth: false, updatedBy: SA_USER });
      const audit = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'report-page-titles', userId: SA_USER });
      expect(audit.beforeValue).toEqual({});
      expect(audit.afterValue).toEqual(body);
    });
  });
});

// ─── policy-driven re-auth on the UPDATE_CONFIG_PAGE family ───────
describe('policy-driven re-auth (UPDATE_CONFIG_PAGE and friends) for a role the policy names', () => {
  beforeAll(async () => {
    reauthAdded = await addReauth([
      ['UPDATE_CONFIG_PAGE', ADM_ROLE],
      ['UPDATE_BRANDING', ADM_ROLE],
      ['UPDATE_USERID_CONFIG', ADM_ROLE],
      ['UPDATE_REAUTH_CONFIG', ADM_ROLE],
    ]);
  }, 60_000);
  afterAll(async () => { await removeReauth(reauthAdded); reauthAdded = []; }, 60_000);

  const cases: Array<[string, string, unknown, string]> = [
    ['dashboard-cards', '/api/config/dashboard-cards', { configValue: { roles: {} } }, 'UPDATE_CONFIG_PAGE'],
    ['export-options', '/api/config/export-options', {}, 'UPDATE_CONFIG_PAGE'],
    ['pm-schedule-filters', '/api/config/pm-schedule-filters', {}, 'UPDATE_CONFIG_PAGE'],
    ['replacement-schedule-filters', '/api/config/replacement-schedule-filters', {}, 'UPDATE_CONFIG_PAGE'],
    ['report-labels', '/api/config/report-labels', {}, 'UPDATE_CONFIG_PAGE'],
    ['report-page-titles', '/api/config/report-page-titles', {}, 'UPDATE_CONFIG_PAGE'],
    ['cleaning-profile-assignment', '/api/config/cleaning-profile-assignment', { mode: 'BY_ENTITY', rules: [] }, 'UPDATE_CONFIG_PAGE'],
    ['branding', '/api/config/branding', {}, 'UPDATE_BRANDING'],
    ['user-id', '/api/config/user-id', {}, 'UPDATE_USERID_CONFIG'],
    ['action-reauth', '/api/config/action-reauth', {}, 'UPDATE_REAUTH_CONFIG'],
  ];

  for (const [key, url, body, action] of cases) {
    it(`${key}: 401 REAUTH_REQUIRED without a password, nothing stored, no CONFIG_CHANGED row`, async () => {
      const before = await stored(key);
      const rowsBefore = await auditCount({ action: 'CONFIG_CHANGED', targetId: key, userId: ADM_USER });
      const res = await authPut(app, url, admToken, body);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action });
      expect(await stored(key)).toEqual(before);
      expect(await auditCount({ action: 'CONFIG_CHANGED', targetId: key, userId: ADM_USER })).toBe(rowsBefore);
      expect(internalErrors).toEqual([]);
    });
  }

  it('with the password a signed save goes through, and its CONFIG_CHANGED row points at the signature row', async () => {
    const snapshot = await stored('report-labels');
    try {
      const res = await authPut(app, '/api/config/report-labels', admToken, (snapshot as object) ?? {}, PW);
      expect(res.statusCode).toBe(200);
      const sig = await chainedAuditRow({ action: 'REAUTH_SUCCESS', userId: ADM_USER });
      expect(sig.afterValue).toMatchObject({ reauthAction: 'UPDATE_CONFIG_PAGE' });
      const change = await chainedAuditRow({ action: 'CONFIG_CHANGED', targetId: 'report-labels', userId: ADM_USER });
      expect(change.signatureAuditId).toBe(sig.id);
      expect(change.chainPosition! > sig.chainPosition!).toBe(true);
    } finally {
      await restoreKey('report-labels', snapshot);
    }
  });

  it('branding and user-id: an empty signed save merges to the stored value unchanged', async () => {
    for (const key of ['branding', 'user-id'] as const) {
      const snapshot = await stored(key);
      try {
        const res = await authPut(app, `/api/config/${key}`, admToken, {}, PW);
        expect(res.statusCode).toBe(200);
        expect(res.json().success).toBe(true);
        // The schema may fill defaults the stored row lacks; every stored key is kept.
        expect(await stored(key)).toMatchObject(snapshot as object);
      } finally {
        await restoreKey(key, snapshot);
      }
    }
  });
});
