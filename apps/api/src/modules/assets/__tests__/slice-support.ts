/**
 * Shared support for the assets / hierarchy / profiles coverage suites
 * (2026-10-21). Not a test file (no `.test.ts`), and it lives under
 * `__tests__/`, which the coverage config excludes.
 *
 * Every suite builds the REAL harness app (production error handler, real
 * auth + RBAC plugins, real Prisma on digilog_test_db) with the five route
 * modules of this slice that `buildApp()` does not mount by default, and owns
 * every row it writes through a `SliceOwner`, which removes them FK-safe in
 * `cleanup()` (every step runs; failures are reported together).
 *
 * Shared config rows are never written, except `action-reauth`, and only by
 * MERGING this suite's own role into an action's role list (owned-fixtures
 * `addReauth`), which affects no other user.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import {
  addReauth, removeReauth, createRole, createUser, deleteRoles, deleteUsers, login, cleanupAll,
  type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';
import hierarchyRoutes from '../../hierarchy/routes.js';
import filterProfileRoutes from '../../filter-profiles/routes.js';
import cleaningProfileRoutes from '../../cleaning-profiles/routes.js';
import checklistProfileRoutes from '../../checklist-profiles/routes.js';
import equipmentGroupRoutes from '../../equipment-groups/routes.js';

export const PASSWORD = 'CovSlice@2026x';

export async function buildSliceApp(): Promise<FastifyInstance> {
  return buildApp([
    { plugin: hierarchyRoutes, prefix: '/api/hierarchy' },
    { plugin: filterProfileRoutes, prefix: '/api/filter-profiles' },
    { plugin: cleaningProfileRoutes, prefix: '/api/filter-cleaning-profiles' },
    { plugin: checklistProfileRoutes, prefix: '/api/checklist-profiles' },
    { plugin: equipmentGroupRoutes, prefix: '/api/equipment-groups' },
  ]);
}

export interface CallResult {
  status: number;
  body: any;
  headers: Record<string, unknown>;
  raw: Buffer;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A caller bound to one user's token. `pw` sends the re-auth password the way
 * the web client does on a retry (x-reauth-password header).
 */
export function caller(app: FastifyInstance, token: string) {
  return async (method: Method, url: string, opts: { body?: unknown; pw?: string; headers?: Record<string, string> } = {}): Promise<CallResult> => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(opts.headers ?? {}) };
    if (opts.pw) headers['x-reauth-password'] = opts.pw;
    const res = await app.inject({ method, url, headers, ...(opts.body !== undefined ? { payload: opts.body as any } : {}) });
    let body: any = null;
    try { body = res.json(); } catch { body = res.body; }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.rawPayload };
  };
}
export type Caller = ReturnType<typeof caller>;

/** Short unique run tag (upper-case letters/digits). */
export function runTag(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
}

type Kind = 'BLOCK' | 'AREA' | 'AHU' | 'FILTER' | 'OTHER';

/**
 * Tracks and removes everything one suite creates. Names all start with
 * `tag`, so a sweep by prefix also catches rows a route created on its own
 * (bulk upload creating an AHU, a cleaning-profile update creating a new
 * version, …).
 */
export class SliceOwner {
  readonly tag: string;
  readonly userIds: string[] = [];
  readonly roleNames: string[] = [];
  readonly templateIds: string[] = [];
  readonly templateKindCodes: string[] = [];
  readonly cleaningLineages = new Set<string>();
  readonly filterProfileIds: string[] = [];
  readonly checklistProfileIds: string[] = [];
  readonly cycleIds: string[] = [];
  private reauthAdded: ReauthGrant = [];

  constructor(tag: string) { this.tag = tag; }

  n(s: string): string { return `${this.tag}-${s}`; }

  async role(key: string, permissions: string[]): Promise<string> {
    const name = `${this.tag}_${key}`.slice(0, 20);
    await createRole(name, permissions);
    this.roleNames.push(name);
    return name;
  }

  /** Create a user with `role` and log in. Returns its id, username and a caller. */
  async user(app: FastifyInstance, key: string, role: string) {
    const username = `${this.tag.toLowerCase()}_${key}`.slice(0, 50);
    const id = await createUser(username, role, PASSWORD, `Cov ${key}`);
    this.userIds.push(id);
    const token = await login(app, username, PASSWORD);
    return { id, username, role, token, call: caller(app, token) };
  }

  async reauth(actions: string[], role: string): Promise<void> {
    const added = await addReauth(actions.map((a) => [a, role] as [string, string]));
    this.reauthAdded.push(...added);
  }

  async template(kind: Kind, extra: Record<string, unknown> = {}): Promise<string> {
    for (const [code, label] of [['BLOCK', 'Block'], ['AREA', 'Area'], ['AHU', 'AHU'], ['FILTER', 'Filter'], ['OTHER', 'Other']] as const) {
      await prisma.templateKind.upsert({ where: { code }, update: {}, create: { code, label, isSystem: true } });
    }
    const t = await prisma.assetTemplate.create({
      data: { name: this.n(`${kind}-TPL-${this.templateIds.length}`), templateKind: kind, ...extra } as any,
    });
    this.templateIds.push(t.id);
    return t.id;
  }

  /** asset_instances row (the forward mirror writes the typed blocks/areas/ahus/filters row). */
  async instance(name: string, templateId: string, parentId: string | null = null, extra: Record<string, unknown> = {}): Promise<string> {
    const i = await prisma.assetInstance.create({ data: { name: this.n(name), templateId, parentId, ...extra } as any });
    return i.id;
  }

  /** Typed filter under an AHU (the reverse mirror writes asset_instances) + its FilterDetails. */
  async filter(name: string, ahuId: string | null, details: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await prisma.filter.create({ data: { id, ahuId, name: this.n(name), status: 'Active', attributes: {}, ...extra } as any });
    await prisma.filterDetails.create({ data: { assetInstanceId: id, ...details } as any });
    return id;
  }

  /** ACTIVE cleaning profile START → stages… → END (linear), with cleaning reasons. */
  async cleaningProfile(name: string, stateKeys: string[], createdBy: string, extra: Record<string, unknown> = {}): Promise<{ id: string; lineageId: string; stageIds: string[] }> {
    const lineageId = randomUUID();
    this.cleaningLineages.add(lineageId);
    const nodes = [
      { nodeType: 'START', stateKey: null },
      ...stateKeys.map((k) => ({ nodeType: 'STAGE', stateKey: k })),
      { nodeType: 'END', stateKey: null },
    ];
    const p = await prisma.filterCleaningProfile.create({
      data: {
        lineageId, name: this.n(name), version: 1, status: 'ACTIVE', createdBy,
        cleaningReasons: [
          { key: 'PM', name: 'Preventive maintenance', isActive: true },
          { key: 'BD', name: 'Breakdown', isActive: true, requiresJustification: true },
        ],
        stages: { create: nodes.map((s, i) => ({ nodeType: s.nodeType as any, stateKey: s.stateKey, sortOrder: i })) },
        ...extra,
      } as any,
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
    const stageIds = p.stages.map((s) => s.id);
    await prisma.filterPipelineConnection.createMany({
      data: stageIds.slice(0, -1).map((from, i) => ({ profileId: p.id, fromStageId: from, toStageId: stageIds[i + 1], label: 'Next' })),
    });
    return { id: p.id, lineageId, stageIds };
  }

  async filterProfile(name: string, cleaningProfileId: string): Promise<string> {
    const fp = await prisma.filterProfile.create({ data: { name: this.n(name), cleaningProfileId } });
    this.filterProfileIds.push(fp.id);
    return fp.id;
  }

  async checklist(name: string, isActive = true): Promise<string> {
    const c = await prisma.checklistProfile.create({ data: { name: this.n(name), isActive } });
    this.checklistProfileIds.push(c.id);
    return c.id;
  }

  async cycle(filterId: string, profileId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const c = await prisma.cleaningCycle.create({
      data: {
        cycleCode: this.n(`CYC-${this.cycleIds.length}-${randomUUID().slice(0, 6)}`),
        filterId, profileId, profileVersion: 1, sequenceNumber: this.cycleIds.length + 1,
        status: 'IN_PROGRESS', cleaningReasonKey: 'PM', cleaningReasonLabel: 'Preventive maintenance',
        ...extra,
      } as any,
    });
    this.cycleIds.push(c.id);
    return c.id;
  }

  /** Remove everything, FK-safe. Audit rows stay (delete-protected by trigger). */
  async cleanup(): Promise<void> {
    const like = { startsWith: this.tag };
    const instRows = () => prisma.assetInstance.findMany({ where: { name: like }, select: { id: true, parentId: true } });
    await cleanupAll([
      ['reauth', () => removeReauth(this.reauthAdded)],
      ['assignments', async () => {
        await prisma.entityAssignment.deleteMany({ where: { OR: [{ userId: { in: this.userIds } }, { entity: { name: like } }] } });
        await prisma.templateAssignment.deleteMany({ where: { OR: [{ userId: { in: this.userIds } }, { templateId: { in: this.templateIds } }] } });
      }],
      ['cycles+events', async () => {
        const ids = (await instRows()).map((r) => r.id);
        const cycles = await prisma.cleaningCycle.findMany({
          where: { OR: [{ id: { in: this.cycleIds } }, { filterId: { in: ids } }, { profile: { lineageId: { in: [...this.cleaningLineages] } } }, { cycleCode: like }] },
          select: { id: true },
        });
        const cycleIds = cycles.map((c) => c.id);
        await prisma.cleaningStageApproval.deleteMany({ where: { OR: [{ filterId: { in: ids } }, { cycleId: { in: cycleIds } }] } }).catch(() => undefined);
        await prisma.filterDetails.updateMany({ where: { OR: [{ assetInstanceId: { in: ids } }, { currentCycleId: { in: cycleIds } }] }, data: { currentCycleId: null } });
        await prisma.filterEvent.deleteMany({ where: { OR: [{ filterId: { in: ids } }, { cycleId: { in: cycleIds } }] } });
        await prisma.cleaningCycle.deleteMany({ where: { id: { in: cycleIds } } });
      }],
      ['equipment groups', async () => {
        const ids = (await instRows()).map((r) => r.id);
        await prisma.equipmentGroup.deleteMany({ where: { OR: [{ blockId: { in: ids } }, { name: like }] } });
      }],
      ['identifiers+relationships+details', async () => {
        const ids = (await instRows()).map((r) => r.id);
        await prisma.assetIdentifier.deleteMany({ where: { OR: [{ assetId: { in: ids } }, { identifierValue: like }] } });
        await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: ids } }, { targetAssetId: { in: ids } }] } });
        await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
      }],
      ['filter profiles', async () => {
        await prisma.filterDetails.updateMany({ where: { filterProfile: { name: like } }, data: { filterProfileId: null } });
        await prisma.filterProfile.deleteMany({ where: { OR: [{ id: { in: this.filterProfileIds } }, { name: like }] } });
      }],
      ['cleaning profiles', async () => {
        await prisma.filterCleaningProfile.deleteMany({ where: { OR: [{ lineageId: { in: [...this.cleaningLineages] } }, { name: like }] } });
      }],
      ['checklist profiles', async () => {
        await prisma.checklistProfile.deleteMany({ where: { OR: [{ id: { in: this.checklistProfileIds } }, { name: like }] } });
      }],
      ['typed filters', async () => { await prisma.filter.deleteMany({ where: { name: like } }); }],
      ['asset instances (children first)', async () => {
        for (let pass = 0; pass < 10; pass++) {
          const rows = await instRows();
          if (!rows.length) return;
          const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
          const leaves = rows.filter((r) => !parents.has(r.id)).map((r) => r.id);
          await prisma.assetInstance.deleteMany({ where: { id: { in: leaves } } });
        }
        const left = await instRows();
        if (left.length) throw new Error(`${left.length} asset_instances left behind`);
      }],
      ['templates', async () => {
        await prisma.assetTemplateVersion.deleteMany({ where: { templateId: { in: this.templateIds } } });
        // The typed->asset_instances mirror attaches typed filters to the OLDEST
        // active FILTER template — possibly ours, possibly another suite's. Best-effort.
        for (const id of this.templateIds) await prisma.assetTemplate.delete({ where: { id } }).catch(() => undefined);
        await prisma.assetTemplateVersion.deleteMany({ where: { template: { name: like } } }).catch(() => undefined);
        await prisma.assetTemplate.deleteMany({ where: { name: like, instances: { none: {} } } });
      }],
      ['template kinds', async () => { await prisma.templateKind.deleteMany({ where: { code: { in: this.templateKindCodes } } }); }],
      ['users', () => deleteUsers(this.userIds)],
      ['roles', () => deleteRoles(this.roleNames)],
    ]);
  }
}

/** The instruments block the equipment-group routes require (exactly three). */
export function instruments(overrides: Array<Record<string, unknown>> = []) {
  const base = [
    { serialNumber: 'SN-AIR', instrumentId: 'PG-01', uom: 'bar', instrumentMin: 0, instrumentMax: 10, operatingMin: 2, operatingMax: 8, leastCount: 0.1 },
    { serialNumber: 'SN-RO', instrumentId: 'PG-02', uom: 'bar', instrumentMin: 0, instrumentMax: 10, operatingMin: 1, operatingMax: 6, leastCount: 0.1 },
    { serialNumber: 'SN-DRY', instrumentId: 'TT-01', uom: '°C', instrumentMin: 0, instrumentMax: 150, operatingMin: 40, operatingMax: 90, leastCount: 1 },
  ];
  return base.map((b, i) => ({ ...b, ...(overrides[i] ?? {}) }));
}

/** Rows audit_trail holds for one target, newest first. */
export function auditFor(targetId: string, action?: string) {
  return prisma.auditTrail.findMany({ where: { targetId, ...(action ? { action } : {}) }, orderBy: { chainPosition: 'desc' } });
}
