/**
 * Equipment Groups Service — CRUD for equipment groups with 3 instruments per group.
 * Each group belongs to a Block and contains:
 *   1. Compressed Air Pressure (WASH_IN)
 *   2. RO Water Pressure (WASH_IN)
 *   3. Dryer Temperature (DRY_IN)
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { sanitizeStrings } from '../../lib/sanitize.js';

const INSTRUMENT_DESCRIPTIONS = [
  { description: 'Compressed Air Pressure', stageKey: 'WASH_IN', sortOrder: 1 },
  { description: 'RO Water Pressure', stageKey: 'WASH_IN', sortOrder: 2 },
  { description: 'Dryer Temperature', stageKey: 'DRY_IN', sortOrder: 3 },
] as const;

function orgWhere(ctx: RequestContext) {
  if (ctx.scope === 'GLOBAL' || !ctx.organizationId) return {};
  return { organizationId: ctx.organizationId };
}

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
}

export class EquipmentGroupsService {
  async list(ctx: RequestContext, blockId?: string) {
    const where: any = { ...orgWhere(ctx), isActive: true };
    if (blockId) where.blockId = blockId;

    return prisma.equipmentGroup.findMany({
      where,
      include: { instruments: { orderBy: { sortOrder: 'asc' } }, block: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(ctx: RequestContext, id: string) {
    const group = await prisma.equipmentGroup.findFirst({
      where: { id, ...orgWhere(ctx) },
      include: { instruments: { orderBy: { sortOrder: 'asc' } }, block: { select: { id: true, name: true } } },
    });
    if (!group) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');
    return group;
  }

  async getByBlock(ctx: RequestContext, blockId: string) {
    return prisma.equipmentGroup.findMany({
      where: { blockId, isActive: true, ...orgWhere(ctx) },
      include: { instruments: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(ctx: RequestContext, data: any) {
    const sanitized = sanitizeStrings(data);
    const { name, blockId, instruments } = sanitized;

    if (!name?.trim()) throw new AppError(400, 'VALIDATION', 'Group name is required');
    if (!blockId) throw new AppError(400, 'VALIDATION', 'Block ID is required');

    // Verify block exists (allow global blocks with null organizationId)
    const blockWhere = (ctx.scope === 'GLOBAL' || !ctx.organizationId)
      ? { id: blockId }
      : { id: blockId, OR: [{ organizationId: ctx.organizationId }, { organizationId: null }] };
    const block = await prisma.assetInstance.findFirst({ where: blockWhere });
    if (!block) throw new AppError(404, 'NOT_FOUND', 'Block not found');

    if (!instruments || !Array.isArray(instruments) || instruments.length !== 3) {
      throw new AppError(400, 'VALIDATION', 'Exactly 3 instruments are required');
    }

    // Validate each instrument
    instruments.forEach((inst: any, idx: number) => validateInstrument(inst, idx));

    // Resolve organizationId: prefer user's org, then block's org
    // For GLOBAL scope users with no org, find the first available organization
    let orgId = ctx.organizationId || block.organizationId;
    if (!orgId) {
      const firstOrg = await prisma.organization.findFirst({ where: { isActive: true }, select: { id: true } });
      if (!firstOrg) throw new AppError(400, 'VALIDATION', 'No active organization found. Create an organization first.');
      orgId = firstOrg.id;
    }


    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.equipmentGroup.create({
        data: {
          name: name.trim(),
          blockId,
          organizationId: orgId,
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
      where: { id, ...orgWhere(ctx) },
      include: { instruments: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Equipment group not found');

    if (!instruments || !Array.isArray(instruments) || instruments.length !== 3) {
      throw new AppError(400, 'VALIDATION', 'Exactly 3 instruments are required');
    }

    instruments.forEach((inst: any, idx: number) => validateInstrument(inst, idx));

    const group = await prisma.$transaction(async (tx) => {
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
      beforeValue: { name: existing.name },
      afterValue: { name: name?.trim() ?? existing.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return group;
  }

  async delete(ctx: RequestContext, id: string) {
    const existing = await prisma.equipmentGroup.findFirst({
      where: { id, ...orgWhere(ctx) },
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
