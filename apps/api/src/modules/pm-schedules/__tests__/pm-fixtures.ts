/**
 * Shared fixtures for the PM-schedule integration suites (src/e2e/pm-*.test.ts).
 *
 * Not a test file (no `.test.ts` suffix) — vitest never collects it, and the
 * coverage config excludes everything under `__tests__/`.
 *
 * ## Config isolation
 *
 * The PM module reads five `system_config` rows (pm-schedule-settings,
 * pm-schedule-approval, filter-cleaning-reasons, qnn-notifications,
 * action-reauth). `digilog_test_db` is shared by several agents running suites
 * at the same time, and `getReplacementWorkflowConfig` inherits the PM workflow
 * row, so writing those rows — even with snapshot/restore — leaks into other
 * processes. Instead `installConfigOverrides` intercepts
 * `prisma.systemConfig.findUnique` IN THIS PROCESS for the named keys only;
 * every other read (and every other model) goes to the real database. The
 * services still parse the values themselves — only the row fetch is served
 * from memory.
 *
 * `vi.spyOn(...).mockRestore()` must NOT be used on a Prisma delegate: the
 * delegate is a proxy whose property descriptor reports `value: undefined`, so
 * restore leaves `findUnique` undefined. The override stays installed and falls
 * through to the real method for any key that is not overridden.
 */
import { vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { hashPassword } from '../../../lib/password.js';
import { invalidateReauthCache } from '../../../lib/reauth-check.js';
import { invalidateRolePermsCache } from '../../../plugins/rbac.js';

export const DAY = 86_400_000;

/** UTC midnight `offset` days from today — matches how `@db.Date` columns round-trip. */
export function utcDay(offset = 0, base = new Date()): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offset));
}
export const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Marker value: serve "no such row" for this key. */
export const MISSING = Symbol('missing-config-row');

export interface ConfigOverrides {
  set(key: string, value: unknown): void;
  /** Make the key read as an absent row. */
  missing(key: string): void;
  /** Make the read for this key reject (simulates a failing config query). */
  fail(key: string, err?: Error): void;
  /** Stop overriding this key — reads go to the real row again. */
  passthrough(key: string): void;
}

export function installConfigOverrides(initial: Record<string, unknown> = {}): ConfigOverrides {
  const values = new Map<string, unknown>(Object.entries(initial));
  const real = prisma.systemConfig.findUnique.bind(prisma.systemConfig);
  vi.spyOn(prisma.systemConfig, 'findUnique').mockImplementation(((args: any) => {
    const key = args?.where?.configKey;
    if (typeof key === 'string' && values.has(key)) {
      const v = values.get(key);
      if (v === MISSING) return Promise.resolve(null);
      if (v instanceof Error) return Promise.reject(v);
      return Promise.resolve({ id: `override-${key}`, configKey: key, configValue: v });
    }
    return real(args);
  }) as any);
  const changed = () => {
    invalidateReauthCache();
    invalidateRolePermsCache();
  };
  changed();
  return {
    set(key, value) { values.set(key, value); changed(); },
    missing(key) { values.set(key, MISSING); changed(); },
    fail(key, err = new Error(`simulated config read failure for ${key}`)) { values.set(key, err); changed(); },
    passthrough(key) { values.delete(key); changed(); },
  };
}

/** The PM config a suite runs with unless a test says otherwise. */
export function defaultPmConfig(notifyRole: string) {
  return {
    'pm-schedule-settings': {
      enabled: true, taskVisibility: 'GLOBAL', defaultToleranceDays: 3,
      showOverdueSeparately: true, overdueNotificationRoles: [notifyRole],
    },
    'pm-schedule-approval': { workflowEnabled: false, uploadRole: '', reviewRole: '', approvalRole: '' },
    'filter-cleaning-reasons': {
      value: [
        { key: 'PM', name: 'PM', isActive: true },
        { key: 'BREAKDOWN', name: 'Breakdown', isActive: true },
      ],
    },
    'qnn-notifications': { visibleRoles: ['ADMIN'] },
    'action-reauth': {},
  };
}

type Kind = 'BLOCK' | 'AREA' | 'AHU' | 'FILTER' | 'OTHER';

/**
 * Owns every row a suite creates and removes them in FK-safe order. Audit rows
 * stay behind — `audit_trail` is delete-protected by trigger.
 */
export class PmFixture {
  readonly tag: string;
  readonly password = 'PmSuite@2026x';
  readonly userIds: string[] = [];
  readonly usernames: string[] = [];
  readonly roleNames: string[] = [];
  readonly templateIds = new Map<Kind, string>();
  readonly instanceIds: string[] = []; // creation order → delete reversed
  readonly ahuIds: string[] = [];
  readonly filterIds: string[] = [];
  readonly profileIds: string[] = [];
  private cycleSeq = 0;

  constructor(prefix: string) {
    // ≤ 20 chars for role names: prefix (≤ 6) + '_' + key (≤ 5) + '_' + 5.
    this.tag = `${prefix}${Date.now().toString(36).slice(-5).toUpperCase()}`;
  }

  roleName(key: string) { return `${this.tag}_${key}`.slice(0, 20); }

  async role(key: string, permissions: string[]): Promise<string> {
    const name = this.roleName(key);
    await prisma.role.create({
      data: {
        name, displayName: `PM suite ${key}`, hierarchyLevel: 1, permissions,
        isSystem: false, createdBy: 'pm-suite',
      },
    });
    this.roleNames.push(name);
    return name;
  }

  async user(key: string, role: string): Promise<{ id: string; username: string; role: string }> {
    const username = `${this.tag.toLowerCase()}_${key}`;
    const u = await prisma.user.create({
      data: {
        username, fullName: `PM suite ${key}`, email: `${username}@example.com`,
        passwordHash: await hashPassword(this.password), role,
        status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'pm-suite',
      },
    });
    this.userIds.push(u.id);
    this.usernames.push(username);
    return { id: u.id, username, role };
  }

  async login(app: FastifyInstance, username: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username, password: this.password, force: true },
    });
    const token = res.json().token;
    if (!token) throw new Error(`login failed for ${username}: ${res.body}`);
    return token;
  }

  async template(kind: Kind): Promise<string> {
    const existing = this.templateIds.get(kind);
    if (existing) return existing;
    await prisma.templateKind.upsert({ where: { code: kind }, update: {}, create: { code: kind, label: kind, isSystem: true } });
    const t = await prisma.assetTemplate.create({ data: { name: `${this.tag} ${kind} Tpl`, templateKind: kind } });
    this.templateIds.set(kind, t.id);
    return t.id;
  }

  async instance(kind: Kind, name: string, opts: {
    parentId?: string | null; isActive?: boolean; status?: string; customAttributes?: Record<string, unknown>;
  } = {}): Promise<string> {
    const row = await prisma.assetInstance.create({
      data: {
        name: `${this.tag}-${name}`,
        templateId: await this.template(kind),
        parentId: opts.parentId ?? null,
        isActive: opts.isActive ?? true,
        status: opts.status ?? 'Active',
        ...(opts.customAttributes ? { customAttributes: opts.customAttributes as any } : {}),
      },
    });
    this.instanceIds.push(row.id);
    if (kind === 'AHU') this.ahuIds.push(row.id);
    return row.id;
  }

  async filter(name: string, ahuId: string, opts: {
    filterSet?: 'SET_A' | 'SET_B' | null; stage?: string | null; isActive?: boolean; status?: string;
  } = {}): Promise<string> {
    const id = await this.instance('FILTER', name, { parentId: ahuId, isActive: opts.isActive, status: opts.status });
    await prisma.filterDetails.create({
      data: { assetInstanceId: id, filterSet: opts.filterSet ?? null, currentLifecycleState: opts.stage ?? null },
    });
    this.filterIds.push(id);
    return id;
  }

  async profile(createdBy: string): Promise<string> {
    if (this.profileIds[0]) return this.profileIds[0];
    const p = await prisma.filterCleaningProfile.create({
      data: { lineageId: randomUUID(), name: `${this.tag} profile`, version: 1, createdBy },
    });
    this.profileIds.push(p.id);
    return p.id;
  }

  async cycle(filterId: string, createdBy: string, opts: {
    status: 'IN_PROGRESS' | 'COMPLETED' | 'TERMINATED'; reason?: string; startedAt: Date; completedAt?: Date | null;
  }): Promise<string> {
    const reason = opts.reason ?? 'PM';
    const c = await prisma.cleaningCycle.create({
      data: {
        cycleCode: `${this.tag}-C${++this.cycleSeq}`,
        filterId, profileId: await this.profile(createdBy), profileVersion: 1, sequenceNumber: this.cycleSeq,
        status: opts.status, cleaningReasonKey: reason, cleaningReasonLabel: reason,
        startedAt: opts.startedAt, completedAt: opts.completedAt ?? null,
      },
    });
    return c.id;
  }

  async cycleCompletedEvent(filterId: string, cycleId: string, performedBy: string, performedAt: Date) {
    await prisma.filterEvent.create({
      data: {
        filterId, cycleId, eventType: 'CYCLE_COMPLETED', performedBy, performedAt,
        checksum: `${this.tag}-fixture`, ipAddress: '127.0.0.1',
      },
    });
  }

  /** A schedule written straight to the DB (bypasses the API so a test controls every column). */
  async schedule(entityId: string, year: number, createdBy: string, entries: Array<{
    plannedDate: Date; toleranceDays?: number; approvalStatus?: any; extra?: Record<string, unknown>;
  }>, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') {
    const s = await prisma.pmSchedule.create({ data: { entityId, year, status, createdBy } });
    const ids: string[] = [];
    for (const e of entries) {
      const tol = e.toleranceDays ?? 0;
      const row = await prisma.pmScheduleEntry.create({
        data: {
          scheduleId: s.id, month: e.plannedDate.getUTCMonth() + 1, plannedDate: e.plannedDate, toleranceDays: tol,
          windowStart: new Date(e.plannedDate.getTime() - tol * DAY),
          windowEnd: new Date(e.plannedDate.getTime() + tol * DAY),
          approvalStatus: e.approvalStatus ?? 'APPROVED',
          ...(e.extra ?? {}),
        },
      });
      ids.push(row.id);
    }
    return { scheduleId: s.id, entryIds: ids };
  }

  async cleanup(app?: FastifyInstance) {
    const ahuIds = this.ahuIds;
    const schedules = ahuIds.length
      ? await prisma.pmSchedule.findMany({ where: { entityId: { in: ahuIds } }, select: { id: true } })
      : [];
    const scheduleIds = schedules.map((s) => s.id);
    const entryIds = scheduleIds.length
      ? (await prisma.pmScheduleEntry.findMany({ where: { scheduleId: { in: scheduleIds } }, select: { id: true } })).map((e) => e.id)
      : [];
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { console.warn(`[pm-fixture ${this.tag}] cleanup ${label} failed:`, (e as Error).message); }
    };
    await step('notifications', () => prisma.notification.deleteMany({
      where: { OR: [{ createdBy: { in: this.usernames } }, { forRole: { in: this.roleNames } }] },
    }));
    await step('qnn', () => prisma.qualityNotification.deleteMany({
      where: { OR: [{ scheduleId: { in: scheduleIds } }, { pmScheduleEntryId: { in: entryIds } }, { performedBy: { in: this.userIds } }] },
    }));
    await step('deviations', () => prisma.deviation.deleteMany({ where: { OR: [{ ahuId: { in: ahuIds } }, { pmScheduleEntryId: { in: entryIds } }] } }));
    await step('executions', () => prisma.pmExecution.deleteMany({ where: { OR: [{ scheduleEntryId: { in: entryIds } }, { entityId: { in: ahuIds } }] } }));
    await step('entries', () => prisma.pmScheduleEntry.deleteMany({ where: { scheduleId: { in: scheduleIds } } }));
    await step('schedules', () => prisma.pmSchedule.deleteMany({ where: { id: { in: scheduleIds } } }));
    await step('events', () => prisma.filterEvent.deleteMany({ where: { filterId: { in: this.filterIds } } }));
    await step('details', () => prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: this.instanceIds } } }));
    await step('cycles', () => prisma.cleaningCycle.deleteMany({ where: { filterId: { in: this.filterIds } } }));
    await step('relationships', () => prisma.assetRelationship.deleteMany({
      where: { OR: [{ sourceAssetId: { in: this.instanceIds } }, { targetAssetId: { in: this.instanceIds } }] },
    }));
    for (const id of [...this.instanceIds].reverse()) {
      await step(`instance ${id}`, () => prisma.assetInstance.deleteMany({ where: { id } }));
    }
    await step('profiles', () => prisma.filterCleaningProfile.deleteMany({ where: { id: { in: this.profileIds } } }));
    await step('templates', () => prisma.assetTemplate.deleteMany({ where: { id: { in: [...this.templateIds.values()] } } }));
    await step('sessions', () => prisma.session.deleteMany({ where: { userId: { in: this.userIds } } }));
    await step('password history', () => prisma.passwordHistory.deleteMany({ where: { userId: { in: this.userIds } } }));
    await step('users', () => prisma.user.deleteMany({ where: { id: { in: this.userIds } } }));
    await step('roles', () => prisma.role.deleteMany({ where: { name: { in: this.roleNames } } }));
    if (app) await app.close();
  }
}

/** Hand-framed multipart body (no form-data dependency in this repo). */
export function multipartBody(file: { name: string; content: Buffer; type?: string } | null, fields: Record<string, string> = {}) {
  const B = '----pmsuiteboundary';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(
      `--${B}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
      `Content-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`,
    ));
    parts.push(file.content, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${B}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${B}` };
}
