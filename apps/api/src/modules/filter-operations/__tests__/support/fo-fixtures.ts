/**
 * Owned fixtures for the filter-operations / stage-approvals coverage suites
 * (2026-10-21). Not a test file — vitest never collects it, and the coverage
 * config excludes everything under `__tests__/`.
 *
 * Every row a suite needs is created here and recorded, so `cleanup()` removes
 * exactly what this process made, in FK-safe order, running EVERY step and
 * reporting all failures together (a failed early step never leaks the rest).
 *
 * Isolation rules (digilog_test_db is shared with other agents' suites):
 *  - users and roles are per file (role names <= 20 chars);
 *  - every filter carries its OWN FilterProfile id, so resolveFilterProfile
 *    never falls through to "the oldest ACTIVE profile in the DB", which could
 *    belong to another suite;
 *  - no shared system_config row is written. Suites that need a config value
 *    mock the one getter that reads it (see each file's header);
 *  - audit_trail rows stay behind: the audit_trail_no_delete trigger rejects
 *    deletes by design (21 CFR §11.10(e)).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma.js';
import { hashPassword } from '../../../../lib/password.js';
import { invalidateRolePermsCache } from '../../../../plugins/rbac.js';
import { loginAs } from '../../../../e2e/test-helper.js';
import { computeChecksum } from '../../helpers.js';

export type Kind = 'BLOCK' | 'AREA' | 'AHU' | 'FILTER';

export interface PipelineSpec {
  name: string;
  stages: string[];
  /** Index in `stages` AFTER which a CHECKLIST node sits (its profile id). */
  checklistAfter?: Record<number, string>;
  flowMode?: 'STRICT' | 'BYPASS_ENABLED';
  status?: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  reasons?: Array<{ key: string; name: string; requiresJustification?: boolean }>;
  /** Extra non-stage nodes appended after START (e.g. PARAM_CAPTURE). */
  extraNodes?: Array<{ nodeType: string; configuration: Record<string, unknown> }>;
}

export const DEFAULT_REASONS = [
  { key: 'ROUTINE', name: 'Routine', requiresJustification: false },
  { key: 'BREAKDOWN', name: 'Breakdown', requiresJustification: true },
];

export class FoFixture {
  readonly tag: string;
  readonly password = 'FoCover@2026#x';
  readonly userIds: string[] = [];
  readonly roleNames: string[] = [];
  readonly templateIds = new Map<Kind, string>();
  /** Non-filter asset instances in creation order (deleted in reverse). */
  readonly nodeIds: string[] = [];
  readonly filterIds: string[] = [];
  readonly cleaningProfileIds: string[] = [];
  readonly filterProfileIds: string[] = [];
  readonly checklistProfileIds: string[] = [];
  readonly equipmentGroupIds: string[] = [];
  readonly pmScheduleIds: string[] = [];
  readonly blockChangeIds: string[] = [];
  private seq = 0;

  constructor(prefix: string) {
    // prefix (<= 4) + 6 chars keeps `${tag}_${key}` role names <= 20.
    this.tag = `${prefix}${(Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase()}`;
  }

  name(label: string) { return `${this.tag}-${label}-${++this.seq}`; }

  async role(key: string, permissions: string[]): Promise<string> {
    const name = `${this.tag}_${key}`.slice(0, 20);
    await prisma.role.create({
      data: { name, displayName: name, hierarchyLevel: 1, permissions, isSystem: false, isActive: true, createdBy: 'fo-coverage' },
    });
    this.roleNames.push(name);
    invalidateRolePermsCache(name);
    return name;
  }

  async user(key: string, role: string): Promise<{ id: string; username: string }> {
    const username = `${this.tag}_${key}`.toLowerCase().slice(0, 30);
    const u = await prisma.user.create({
      data: {
        username, fullName: `FO coverage ${key}`, email: `${username}@fo-coverage.local`,
        passwordHash: await hashPassword(this.password), role, status: 'ENABLED',
        forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'fo-coverage',
      },
    });
    this.userIds.push(u.id);
    return { id: u.id, username };
  }

  async login(app: FastifyInstance, username: string): Promise<Record<string, string>> {
    const token = await loginAs(app, username, this.password);
    return { authorization: `Bearer ${token}` };
  }

  async template(kind: Kind): Promise<string> {
    const hit = this.templateIds.get(kind);
    if (hit) return hit;
    await prisma.templateKind.upsert({ where: { code: kind }, update: {}, create: { code: kind, label: kind, isSystem: true } });
    const t = await prisma.assetTemplate.create({ data: { name: `${this.tag} ${kind} Tpl`, templateKind: kind, isActive: true } });
    this.templateIds.set(kind, t.id);
    return t.id;
  }

  /** BLOCK / AREA / AHU as asset_instances (the forward mirror writes the typed row with the same id). */
  async node(kind: Exclude<Kind, 'FILTER'>, label: string, parentId: string | null = null, customAttributes?: Record<string, unknown>): Promise<string> {
    const row = await prisma.assetInstance.create({
      data: {
        name: this.name(label), templateId: await this.template(kind), parentId,
        ...(customAttributes ? { customAttributes: customAttributes as any } : {}),
      },
    });
    this.nodeIds.push(row.id);
    return row.id;
  }

  /** A FILTER asset_instance + its FilterDetails sidecar, bound to `filterProfileId`. */
  async filter(label: string, parentId: string | null, filterProfileId: string | null, opts: {
    filterSet?: 'SET_A' | 'SET_B' | null; attributes?: Record<string, unknown>; approvalStatus?: string;
    stage?: string | null;
  } = {}): Promise<string> {
    const row = await prisma.assetInstance.create({
      data: {
        name: this.name(label), templateId: await this.template('FILTER'), parentId,
        attributes: (opts.attributes ?? {}) as any,
        ...(opts.approvalStatus ? { approvalStatus: opts.approvalStatus as any } : {}),
      },
    });
    this.filterIds.push(row.id);
    await prisma.filterDetails.create({
      data: {
        assetInstanceId: row.id, filterProfileId, filterSet: (opts.filterSet ?? null) as any,
        currentLifecycleState: opts.stage ?? null,
      },
    });
    return row.id;
  }

  async checklist(label: string, questions: Array<{ question: string; required?: boolean; questionType?: string }>, isActive = true) {
    const cp = await prisma.checklistProfile.create({
      data: {
        name: this.name(label), isActive,
        questions: {
          create: questions.map((q, i) => ({
            question: q.question, questionType: (q.questionType ?? 'YES_NO') as any, required: q.required ?? true, sortOrder: i + 1,
          })),
        },
      },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    this.checklistProfileIds.push(cp.id);
    return { id: cp.id, questionIds: cp.questions.map((q) => q.id), version: cp.version };
  }

  /**
   * START → stages… (with optional CHECKLIST nodes) → END, chained in order,
   * plus a FilterProfile pointing at it. Returns both ids.
   */
  async pipeline(spec: PipelineSpec, createdBy: string): Promise<{ cleaningProfileId: string; filterProfileId: string }> {
    const nodes: any[] = [{ nodeType: 'START', stateKey: null, sortOrder: 0 }];
    let order = 1;
    for (const n of spec.extraNodes ?? []) nodes.push({ nodeType: n.nodeType, stateKey: null, sortOrder: order++, configuration: n.configuration });
    spec.stages.forEach((k, i) => {
      nodes.push({ nodeType: 'STAGE', stateKey: k, sortOrder: order++ });
      const cl = spec.checklistAfter?.[i];
      if (cl) nodes.push({ nodeType: 'CHECKLIST', stateKey: null, sortOrder: order++, configuration: { checklistProfileId: cl } });
    });
    nodes.push({ nodeType: 'END', stateKey: null, sortOrder: order++ });
    const cp = await prisma.filterCleaningProfile.create({
      data: {
        name: this.name(spec.name), lineageId: randomUUID(), status: spec.status ?? 'ACTIVE',
        flowMode: spec.flowMode ?? 'STRICT', createdBy,
        cleaningReasons: (spec.reasons ?? DEFAULT_REASONS) as any,
        stages: { create: nodes },
      },
      include: { stages: true },
    });
    this.cleaningProfileIds.push(cp.id);
    const ordered = [...cp.stages].sort((a, b) => a.sortOrder - b.sortOrder);
    await prisma.filterPipelineConnection.createMany({
      data: ordered.slice(0, -1).map((from, i) => ({ profileId: cp.id, fromStageId: from.id, toStageId: ordered[i + 1].id })),
    });
    const fp = await prisma.filterProfile.create({ data: { name: this.name(`FP ${spec.name}`), cleaningProfileId: cp.id } });
    this.filterProfileIds.push(fp.id);
    return { cleaningProfileId: cp.id, filterProfileId: fp.id };
  }

  async equipmentGroup(blockId: string, label: string, instruments: Array<{ stageKey: string; min?: number; max?: number; description?: string }>, opts: { version?: number; isActive?: boolean } = {}) {
    const g = await prisma.equipmentGroup.create({
      data: {
        name: this.name(label), blockId, version: opts.version ?? 1, isActive: opts.isActive ?? true,
        instruments: {
          create: instruments.map((i, n) => ({
            description: i.description ?? `${i.stageKey} instrument ${n + 1}`, stageKey: i.stageKey,
            serialNumber: `SN-${this.tag}-${n}`, instrumentId: `INS-${this.tag}-${n}`, uom: 'bar',
            instrumentMin: 0, instrumentMax: 100, operatingMin: i.min ?? 10, operatingMax: i.max ?? 20,
            leastCount: 0.1, sortOrder: n,
          })),
        },
      },
      include: { instruments: { orderBy: { sortOrder: 'asc' } } },
    });
    this.equipmentGroupIds.push(g.id);
    return g;
  }

  /**
   * A cleaning cycle written straight to the DB (for read-path rows whose shape
   * no route produces any more: unknown performers, missing area/profile, …).
   * Events are checksummed exactly as the services do.
   */
  async rawCycle(filterId: string, profileId: string, opts: {
    status?: 'IN_PROGRESS' | 'COMPLETED' | 'TERMINATED'; terminationReason?: string | null; startedAt?: Date;
    completedAt?: Date | null; cleaningAreaId?: string | null; reasonKey?: string; reasonLabel?: string;
    checklistVersionPins?: Record<string, number>; equipmentGroupId?: string | null; equipmentGroupVersionPin?: number | null;
    sequenceNumber?: number;
  } = {}) {
    const n = ++this.seq;
    return prisma.cleaningCycle.create({
      data: {
        cycleCode: `CC-${this.tag}-${n}-${randomUUID().slice(0, 6)}`, filterId, profileId, profileVersion: 1,
        sequenceNumber: opts.sequenceNumber ?? n, status: opts.status ?? 'COMPLETED',
        startedAt: opts.startedAt ?? new Date(), completedAt: opts.completedAt === undefined ? new Date() : opts.completedAt,
        terminationReason: opts.terminationReason ?? null,
        ...(opts.status === 'TERMINATED' ? { terminatedAt: new Date() } : {}),
        cleaningAreaId: opts.cleaningAreaId ?? null,
        cleaningReasonKey: opts.reasonKey ?? 'ROUTINE', cleaningReasonLabel: opts.reasonLabel ?? 'Routine',
        checklistVersionPins: (opts.checklistVersionPins ?? {}) as any,
        equipmentGroupId: opts.equipmentGroupId ?? null, equipmentGroupVersionPin: opts.equipmentGroupVersionPin ?? null,
      },
    });
  }

  async rawEvent(data: {
    filterId: string; cycleId?: string | null; eventType: string; fromState?: string | null; toState?: string | null;
    performedBy: string; performedAt?: Date; attributes?: Record<string, unknown>; remarks?: string | null;
  }) {
    const base = {
      filterId: data.filterId, cycleId: data.cycleId ?? null, eventType: data.eventType as any,
      fromState: data.fromState ?? null, toState: data.toState ?? null, performedBy: data.performedBy,
      attributes: (data.attributes ?? {}) as any, remarks: data.remarks ?? null,
    };
    return prisma.filterEvent.create({
      data: { ...base, checksum: computeChecksum(base), ipAddress: '127.0.0.1', telemetrySnapshot: {}, ...(data.performedAt ? { performedAt: data.performedAt } : {}) },
    });
  }

  /** An ACTIVE PM schedule on `ahuId` with one APPROVED entry whose window closed `daysAgo` days ago. */
  async overduePm(ahuId: string, createdBy: string, daysAgo = 10) {
    const today = new Date();
    const utc = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
    const planned = utc(-daysAgo - 2);
    const s = await prisma.pmSchedule.create({
      data: {
        entityId: ahuId, year: planned.getUTCFullYear(), status: 'ACTIVE', createdBy,
        entries: {
          create: [{
            month: planned.getUTCMonth() + 1, plannedDate: planned, toleranceDays: 2,
            windowStart: utc(-daysAgo - 4), windowEnd: utc(-daysAgo), approvalStatus: 'APPROVED',
          }],
        },
      },
      include: { entries: true },
    });
    this.pmScheduleIds.push(s.id);
    return { scheduleId: s.id, entryId: s.entries[0].id };
  }

  async blockChange(filterId: string, fromBlockId: string, toBlockId: string, requestedBy: string, status: 'APPROVED' | 'PENDING' = 'APPROVED') {
    const r = await prisma.blockChangeRequest.create({
      data: {
        filterId, filterName: 'fo', fromBlockId, fromBlockName: 'from', toBlockId, toBlockName: 'to',
        status, requestedBy, requestedByName: 'fo', processedAt: status === 'APPROVED' ? new Date() : null,
      },
    });
    this.blockChangeIds.push(r.id);
    return r.id;
  }

  /** Remove everything this fixture created. Runs every step; throws once with all failures. */
  async cleanup(extra: { filterIds?: string[] } = {}): Promise<void> {
    const failures: string[] = [];
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { failures.push(`${label}: ${(e as Error)?.message ?? String(e)}`); }
    };
    const filters = [...this.filterIds, ...(extra.filterIds ?? [])];
    const allAssets = [...filters, ...this.nodeIds];
    const usernames = this.userIds.length
      ? (await prisma.user.findMany({ where: { id: { in: this.userIds } }, select: { username: true } })).map((u) => u.username)
      : [];

    // Cycle rows are keyed by allAssets, not just filters: a probe that sends a
    // non-filter id to a filter endpoint must not leak a cycle if it is accepted.
    await step('stage approvals', () => prisma.cleaningStageApproval.deleteMany({ where: { filterId: { in: allAssets } } }));
    await step('filter details cycle ptr', () => prisma.filterDetails.updateMany({ where: { assetInstanceId: { in: allAssets } }, data: { currentCycleId: null } }));
    await step('filter events', () => prisma.filterEvent.deleteMany({ where: { filterId: { in: allAssets } } }));
    await step('cycles', () => prisma.cleaningCycle.deleteMany({ where: { filterId: { in: allAssets } } }));
    await step('identifiers', () => prisma.assetIdentifier.deleteMany({ where: { assetId: { in: allAssets } } }));
    await step('relationships', () => prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: allAssets } }, { targetAssetId: { in: allAssets } }] } }));
    await step('block change requests', () => prisma.blockChangeRequest.deleteMany({ where: { OR: [{ id: { in: this.blockChangeIds } }, { filterId: { in: filters } }] } }));
    await step('pm schedules', () => prisma.pmSchedule.deleteMany({ where: { id: { in: this.pmScheduleIds } } }));
    await step('equipment groups', () => prisma.equipmentGroup.deleteMany({ where: { id: { in: this.equipmentGroupIds } } }));
    await step('filter details', () => prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: allAssets } } }));
    // Children before parents: filters, then nodes in reverse creation order.
    await step('filters', () => prisma.assetInstance.deleteMany({ where: { id: { in: filters } } }));
    for (const id of [...this.nodeIds].reverse()) {
      await step(`node ${id}`, () => prisma.assetInstance.deleteMany({ where: { id } }));
    }
    await step('filter profiles', () => prisma.filterProfile.deleteMany({ where: { id: { in: this.filterProfileIds } } }));
    await step('cleaning profiles', () => prisma.filterCleaningProfile.deleteMany({ where: { id: { in: this.cleaningProfileIds } } }));
    await step('checklist profiles', () => prisma.checklistProfile.deleteMany({ where: { id: { in: this.checklistProfileIds } } }));
    // Best-effort, as in e2e/support/owned-fixtures.ts: the typed→asset_instances
    // mirror attaches a typed filter created by ANY suite to the oldest active
    // FILTER template, which may be ours; that row's FK then keeps the template.
    // A leftover template row is harmless; failing this file over it is not.
    for (const id of this.templateIds.values()) {
      await prisma.assetTemplate.delete({ where: { id } }).catch(() => undefined);
    }
    await step('notifications', () => prisma.notification.deleteMany({
      where: { OR: [{ forRole: { in: this.roleNames } }, { forUserId: { in: usernames } }, { createdBy: { in: usernames } }] },
    }));
    await step('sessions', () => prisma.session.deleteMany({ where: { userId: { in: this.userIds } } }));
    await step('password history', () => prisma.passwordHistory.deleteMany({ where: { userId: { in: this.userIds } } }));
    await step('users', () => prisma.user.deleteMany({ where: { id: { in: this.userIds } } }));
    await step('role configs', () => prisma.roleConfig.deleteMany({ where: { role: { in: this.roleNames } } }));
    await step('roles', () => prisma.role.deleteMany({ where: { name: { in: this.roleNames } } }));
    invalidateRolePermsCache();
    if (failures.length) throw new Error(`${failures.length} cleanup step(s) failed: ${failures.join(' | ')}`);
  }
}
