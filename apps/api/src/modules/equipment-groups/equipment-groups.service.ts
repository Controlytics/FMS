/**
 * Equipment Groups Service — CRUD for equipment groups with 3 instruments per group.
 * Each group belongs to a Block and contains:
 *   1. Compressed Air Pressure (WASH_IN)
 *   2. RO Water Pressure (WASH_IN)
 *   3. Dryer Temperature (DRY_IN)
 *
 * Phase A.4 versioning (2026-05-02): every mutation is a snapshot-then-bump.
 * Before applying any change we write the OUTGOING composite (group + all 3
 * instruments, ordered by sortOrder) into `EquipmentGroupVersion.snapshot`,
 * then bump `EquipmentGroup.version`. Cycles do NOT pin a group version —
 * operational drift is already covered by `FilterEvent.attributes
 * .instrumentReadings`, which immutably records description / instrumentCode
 * / uom / leastCount / value at submit time. Versions exist purely for
 * admin-edit history and audit replay.
 */
import type { RequestContext } from '../../types/context.js';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { sanitizeStrings } from '../../lib/sanitize.js';
import { fetchInstrumentValue } from './instrument-fetch.js';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Snapshot the current group + instruments composite into the versions table,
 * then bump the live version pointer. Caller is expected to be inside a
 * transaction and is responsible for the actual mutation that follows.
 * Mirrors the A.1 ChecklistProfile / A.3 FilterProfile pattern.
 */
async function snapshotAndBump(
  tx: Tx,
  groupId: string,
  changeNotes: string | null,
  ctx: RequestContext,
): Promise<void> {
  const group = await tx.equipmentGroup.findUnique({
    where: { id: groupId },
    include: { instruments: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!group) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');
  await tx.equipmentGroupVersion.create({
    data: {
      groupId,
      versionNumber: group.version,
      snapshot: {
        name: group.name,
        blockId: group.blockId,
        isActive: group.isActive,
        instruments: group.instruments.map((i: any) => ({
          id: i.id,
          description: i.description,
          stageKey: i.stageKey,
          serialNumber: i.serialNumber,
          instrumentId: i.instrumentId,
          uom: i.uom,
          instrumentMin: i.instrumentMin,
          instrumentMax: i.instrumentMax,
          operatingMin: i.operatingMin,
          operatingMax: i.operatingMax,
          leastCount: i.leastCount,
          url: i.url ?? null,
          autoFetchEnabled: i.autoFetchEnabled ?? false,
          sortOrder: i.sortOrder,
        })),
      } as Prisma.InputJsonValue,
      changeNotes,
      createdBy: ctx.userSub,
    },
  });
  await tx.equipmentGroup.update({
    where: { id: groupId },
    data: { version: { increment: 1 } },
  });
}

const INSTRUMENT_DESCRIPTIONS = [
  { description: 'Compressed Air Pressure', stageKey: 'WASH_IN', sortOrder: 1 },
  { description: 'RO Water Pressure', stageKey: 'WASH_IN', sortOrder: 2 },
  { description: 'Dryer Temperature', stageKey: 'DRY_IN', sortOrder: 3 },
] as const;

function validateInstrument(inst: any, idx: number) {
  const prefix = `Instrument ${idx + 1} (${INSTRUMENT_DESCRIPTIONS[idx].description})`;
  if (!inst.instrumentId || !inst.instrumentId.trim()) {
    throw new AppError(400, 'VALIDATION', `${prefix}: Instrument ID is required`);
  }
  if (!inst.uom || !inst.uom.trim()) {
    throw new AppError(400, 'VALIDATION', `${prefix}: UOM is required`);
  }
  if (inst.leastCount <= 0) {
    throw new AppError(400, 'VALIDATION', `${prefix}: Least Count must be greater than 0`);
  }
  if (inst.instrumentMin >= inst.instrumentMax) {
    throw new AppError(400, 'VALIDATION', `${prefix}: Instrument Min must be less than Max`);
  }
  if (inst.operatingMin < inst.instrumentMin || inst.operatingMin > inst.instrumentMax) {
    throw new AppError(400, 'VALIDATION', `${prefix}: Operating Min must be within Instrument range (${inst.instrumentMin}–${inst.instrumentMax})`);
  }
  if (inst.operatingMax < inst.instrumentMin || inst.operatingMax > inst.instrumentMax) {
    throw new AppError(400, 'VALIDATION', `${prefix}: Operating Max must be within Instrument range (${inst.instrumentMin}–${inst.instrumentMax})`);
  }
  if (inst.operatingMin >= inst.operatingMax) {
    throw new AppError(400, 'VALIDATION', `${prefix}: Operating Min must be less than Operating Max`);
  }
  // Auto-fetch (2026-06-13): a URL is mandatory once auto-fetch is enabled, and
  // must be a syntactically valid http(s) URL. Host-level SSRF checks happen in
  // the proxy (Phase 2), not here — this is just input shape.
  if (inst.autoFetchEnabled) {
    const raw = typeof inst.url === 'string' ? inst.url.trim() : '';
    if (!raw) {
      throw new AppError(400, 'VALIDATION', `${prefix}: A reading URL is required when auto-fetch is enabled`);
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new AppError(400, 'VALIDATION', `${prefix}: Reading URL is not a valid URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new AppError(400, 'VALIDATION', `${prefix}: Reading URL must use http or https`);
    }
  }
}

export class EquipmentGroupsService {
  async list(_ctx: RequestContext, blockId?: string, includeInactive = false) {
    // Config UI passes includeInactive=true so admins can see + re-enable
    // disabled groups; the cleaning runtime keeps the default (active only).
    const where: any = includeInactive ? {} : { isActive: true };
    if (blockId) where.blockId = blockId;

    return prisma.equipmentGroup.findMany({
      where,
      include: { instruments: { orderBy: { sortOrder: 'asc' } }, block: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(_ctx: RequestContext, id: string) {
    const group = await prisma.equipmentGroup.findFirst({
      where: { id },
      include: { instruments: { orderBy: { sortOrder: 'asc' } }, block: { select: { id: true, name: true } } },
    });
    if (!group) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');
    return group;
  }

  async getByBlock(_ctx: RequestContext, blockId: string) {
    return prisma.equipmentGroup.findMany({
      where: { blockId, isActive: true },
      include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(ctx: RequestContext, data: any) {
    const sanitized = sanitizeStrings(data);
    const { name, blockId, instruments } = sanitized;

    if (!name?.trim()) throw new AppError(400, 'VALIDATION', 'Group name is required');
    if (!blockId) throw new AppError(400, 'VALIDATION', 'Block ID is required');

    // Verify block exists
    const block = await prisma.assetInstance.findFirst({ where: { id: blockId } });
    if (!block) throw new AppError(404, 'NOT_FOUND', 'Block not found');

    if (!instruments || !Array.isArray(instruments) || instruments.length !== 3) {
      throw new AppError(400, 'VALIDATION', 'Exactly 3 instruments are required');
    }

    // Validate each instrument
    instruments.forEach((inst: any, idx: number) => validateInstrument(inst, idx));

    // Single-active-group invariant: a block may have at most one ACTIVE group
    // (the cleaning runtime resolves one group per block). If the block already
    // has an active group, the new one is created INACTIVE — the admin enables
    // it via setActive() to switch, which flips the others off. This preserves
    // the invariant without silently stealing the active group on create.
    const hasActiveInBlock = await prisma.equipmentGroup.count({ where: { blockId, isActive: true } });
    const createActive = hasActiveInBlock === 0;

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.equipmentGroup.create({
        data: {
          name: name.trim(),
          blockId,
          isActive: createActive,
          createdBy: ctx.userSub,
        },
      });

      for (let i = 0; i < 3; i++) {
        const inst = instruments[i];
        const def = INSTRUMENT_DESCRIPTIONS[i];
        await tx.equipmentGroupInstrument.create({
          data: {
            groupId: created.id,
            description: def.description,
            stageKey: def.stageKey,
            serialNumber: inst.serialNumber?.trim() ?? '',
            instrumentId: inst.instrumentId.trim(),
            uom: inst.uom.trim(),
            instrumentMin: inst.instrumentMin,
            instrumentMax: inst.instrumentMax,
            operatingMin: inst.operatingMin,
            operatingMax: inst.operatingMax,
            leastCount: inst.leastCount,
            url: inst.autoFetchEnabled ? (inst.url?.trim() ?? null) : (inst.url?.trim() || null),
            autoFetchEnabled: inst.autoFetchEnabled === true,
            sortOrder: def.sortOrder,
          },
        });
      }

      return tx.equipmentGroup.findUnique({
        where: { id: created.id },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'EQUIPMENT_GROUP_CREATED',
      targetType: 'equipment_group', targetId: group!.id,
      afterValue: { name, blockId },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return group;
  }

  async update(ctx: RequestContext, id: string, data: any) {
    const sanitized = sanitizeStrings(data);
    const { name, instruments } = sanitized;

    const existing = await prisma.equipmentGroup.findFirst({
      where: { id },
      include: { instruments: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');

    if (!instruments || !Array.isArray(instruments) || instruments.length !== 3) {
      throw new AppError(400, 'VALIDATION', 'Exactly 3 instruments are required');
    }

    instruments.forEach((inst: any, idx: number) => validateInstrument(inst, idx));

    const group = await prisma.$transaction(async (tx) => {
      // Phase A.4: snapshot-then-bump. Freeze the OUTGOING composite (group +
      // 3 instruments, ordered by sortOrder) into the versions table BEFORE
      // mutating anything live, then bump version on the live group row.
      await snapshotAndBump(tx, id, data.changeNotes ?? null, ctx);

      if (name && name.trim() !== existing.name) {
        await tx.equipmentGroup.update({ where: { id }, data: { name: name.trim() } });
      }

      // Update each instrument
      for (let i = 0; i < 3; i++) {
        const inst = instruments[i];
        const existingInst = existing.instruments[i];
        if (existingInst) {
          await tx.equipmentGroupInstrument.update({
            where: { id: existingInst.id },
            data: {
              serialNumber: inst.serialNumber?.trim() ?? '',
              instrumentId: inst.instrumentId.trim(),
              uom: inst.uom.trim(),
              instrumentMin: inst.instrumentMin,
              instrumentMax: inst.instrumentMax,
              operatingMin: inst.operatingMin,
              operatingMax: inst.operatingMax,
              leastCount: inst.leastCount,
              url: inst.autoFetchEnabled ? (inst.url?.trim() ?? null) : (inst.url?.trim() || null),
              autoFetchEnabled: inst.autoFetchEnabled === true,
            },
          });
        }
      }

      return tx.equipmentGroup.findUnique({
        where: { id },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'EQUIPMENT_GROUP_UPDATED',
      targetType: 'equipment_group', targetId: id,
      beforeValue: { name: existing.name, version: existing.version },
      afterValue: { name: name?.trim() ?? existing.name, version: (group?.version ?? existing.version + 1) },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return group;
  }

  /**
   * Enable / disable an equipment group. ENABLING enforces the single-active-
   * group-per-block invariant: every OTHER group in the same block is flipped
   * inactive in the same transaction, so the cleaning runtime always resolves
   * exactly one group per block (no MULTIPLE_EQUIPMENT_GROUPS). Disabling just
   * flips this one off (a block may legitimately have zero active groups).
   *
   * Mirrors `delete()` — this does NOT snapshot-then-bump (isActive flips are
   * not versioned; the next real edit captures the active state in its
   * snapshot), keeping the toggle cheap and consistent with soft-delete.
   */
  async setActive(ctx: RequestContext, id: string, isActive: boolean) {
    const existing = await prisma.equipmentGroup.findFirst({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');

    await prisma.$transaction(async (tx) => {
      if (isActive) {
        // Flip every other group in this block off, then turn this one on.
        await tx.equipmentGroup.updateMany({
          where: { blockId: existing.blockId, isActive: true, id: { not: id } },
          data: { isActive: false },
        });
      }
      await tx.equipmentGroup.update({ where: { id }, data: { isActive } });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: isActive ? 'EQUIPMENT_GROUP_ENABLED' : 'EQUIPMENT_GROUP_DISABLED',
      targetType: 'equipment_group', targetId: id,
      beforeValue: { isActive: existing.isActive },
      afterValue: { name: existing.name, blockId: existing.blockId, isActive },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return prisma.equipmentGroup.findUnique({
      where: { id },
      include: { instruments: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * List archived versions of an equipment group, newest first. The current
   * live composite is NOT in the versions table (versions only contains
   * pre-mutation snapshots), so the response is the history strictly BEFORE
   * the current version pointer.
   */
  async getVersions(_ctx: RequestContext, groupId: string) {
    const group = await prisma.equipmentGroup.findUnique({
      where: { id: groupId },
      select: { id: true, version: true },
    });
    if (!group) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');
    const versions = await prisma.equipmentGroupVersion.findMany({
      where: { groupId },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, changeNotes: true, createdAt: true, createdBy: true },
    });
    return { groupId, currentVersion: group.version, versions };
  }

  /**
   * Read a frozen historical version. Returns the snapshot exactly as it was
   * when that version was archived (group + 3 instruments composite).
   */
  async getVersion(_ctx: RequestContext, groupId: string, versionNumber: number) {
    const v = await prisma.equipmentGroupVersion.findUnique({
      where: { groupId_versionNumber: { groupId, versionNumber } },
    });
    if (!v) throw new AppError(404, 'NOT_FOUND', `Version ${versionNumber} of equipment group ${groupId} not found`);
    return {
      groupId: v.groupId,
      versionNumber: v.versionNumber,
      ...(v.snapshot as any),
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      changeNotes: v.changeNotes,
    };
  }

  /**
   * Resolve the stage's instruments for a cycle, READ-ONLY, mirroring the
   * precedence in advance.ts (cycle pin → block's single active group → live),
   * but WITHOUT persisting a lazy-bind pin — this is a preview, not a write.
   * Returns the instruments (from the frozen snapshot when pinned, else live)
   * for `stageKey`, ordered by sortOrder. Old snapshots lack url/autoFetchEnabled
   * → those come back undefined and are treated as auto-fetch OFF downstream.
   */
  private async resolveStageInstruments(
    cycle: { equipmentGroupId: string | null; equipmentGroupVersionPin: number | null; cleaningAreaId: string | null },
    stageKey: string,
  ): Promise<any[]> {
    let groupId = cycle.equipmentGroupId;
    let pin = cycle.equipmentGroupVersionPin;
    if (!groupId && cycle.cleaningAreaId) {
      const blockGroups = await prisma.equipmentGroup.findMany({
        where: { blockId: cycle.cleaningAreaId, isActive: true },
        select: { id: true, version: true },
      });
      if (blockGroups.length === 1) {
        groupId = blockGroups[0].id;
        pin = blockGroups[0].version;
      }
    }
    if (!groupId) return [];

    let instruments: any[];
    if (pin !== null) {
      const versionRow = await prisma.equipmentGroupVersion.findUnique({
        where: { groupId_versionNumber: { groupId, versionNumber: pin } },
      });
      if (versionRow) {
        instruments = ((versionRow.snapshot as any)?.instruments ?? []) as any[];
      } else {
        const g = await prisma.equipmentGroup.findUnique({
          where: { id: groupId },
          include: { instruments: { orderBy: { sortOrder: 'asc' } } },
        });
        instruments = g?.instruments ?? [];
      }
    } else {
      const g = await prisma.equipmentGroup.findUnique({
        where: { id: groupId },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
      instruments = g?.instruments ?? [];
    }
    return instruments
      .filter((i) => i.stageKey === stageKey)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  /**
   * Server-proxied "Get Values": for a filter's in-progress cycle and a given
   * stage (WASH_IN / DRY_IN), fetch each auto-fetch-enabled instrument's reading
   * from its configured URL. Read-only — does not mutate the cycle. Returns one
   * result per auto instrument; the client owns the retry loop and decides
   * fill-vs-fallback per instrument. Instruments without auto-fetch are omitted
   * (they stay manual).
   */
  async fetchStageReadings(_ctx: RequestContext, filterId: string | undefined, stageKey: string, groupId?: string) {
    if (stageKey !== 'WASH_IN' && stageKey !== 'DRY_IN') {
      throw new AppError(400, 'VALIDATION', 'stageKey must be WASH_IN or DRY_IN');
    }

    // Primary: resolve via the filter's in-progress cycle (pinned snapshot URLs).
    let stageInstruments: any[] = [];
    if (filterId) {
      const fd = await prisma.filterDetails.findUnique({
        where: { assetInstanceId: filterId },
        select: { currentCycleId: true },
      });
      if (fd?.currentCycleId) {
        const cycle = await prisma.cleaningCycle.findUnique({
          where: { id: fd.currentCycleId },
          select: { id: true, equipmentGroupId: true, equipmentGroupVersionPin: true, cleaningAreaId: true, status: true },
        });
        if (cycle && cycle.status === 'IN_PROGRESS') {
          stageInstruments = await this.resolveStageInstruments(cycle, stageKey);
        }
      }
    }

    // Fallback (cycle-start: no cycle yet) — use the dialog's explicit group's
    // LIVE instruments. The client only ever sends ids; the URL is resolved here.
    if (stageInstruments.length === 0 && groupId) {
      const g = await prisma.equipmentGroup.findUnique({
        where: { id: groupId },
        include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      });
      stageInstruments = (g?.instruments ?? []).filter((i) => i.stageKey === stageKey);
    }

    const auto = stageInstruments.filter((i) => i.autoFetchEnabled === true && i.url);

    const results = [];
    for (const inst of auto) {
      const r = await fetchInstrumentValue(inst.url);
      results.push({
        instrumentId: inst.id,
        instrumentCode: inst.instrumentId,
        description: inst.description,
        uom: inst.uom,
        ...r,
      });
    }
    return { stageKey, results };
  }

  /**
   * Admin "Get Latest Values" on the config editor — test a single typed (and
   * possibly unsaved) URL through the same SSRF-hardened fetch the operator
   * proxy uses. Lets an admin verify an endpoint before saving. EG_EDIT gated.
   */
  async testUrl(_ctx: RequestContext, url: string) {
    return fetchInstrumentValue(url);
  }

  async delete(ctx: RequestContext, id: string) {
    const existing = await prisma.equipmentGroup.findFirst({
      where: { id },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');

    // Check if any active cycles reference this group
    const activeCycles = await prisma.cleaningCycle.count({
      where: { equipmentGroupId: id, status: 'IN_PROGRESS' },
    });
    if (activeCycles > 0) {
      throw new AppError(409, 'IN_USE', 'Cannot delete: equipment group is used by active cleaning cycles');
    }

    await prisma.equipmentGroup.update({
      where: { id },
      data: { isActive: false },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'EQUIPMENT_GROUP_DELETED',
      targetType: 'equipment_group', targetId: id,
      afterValue: { name: existing.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true };
  }
}
