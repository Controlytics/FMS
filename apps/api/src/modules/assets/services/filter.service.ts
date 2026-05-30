// Standalone Filter create — A-01 Tier 2. Writes the typed `filters` table
// directly (source of truth). NO validateParent, NO asset_relationships, NO
// asset-template attributeSchema. The reverse-mirror trigger keeps a legacy
// asset_instances row in sync for un-migrated readers.
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { ValidationError } from '../../../lib/errors.js';
import { validateAndBuildFilterAttributes, type FilterFieldInput } from './filter-fields.service.js';
import { identifierService } from './identifier.service.js';

export interface CreateFilterTypedInput extends FilterFieldInput {
  name: string;
  ahuId: string;
  filterSet?: 'A' | 'B';
  filterProfileId?: string;
  rfidTag?: string;
}

export const filterService = {
  async create(input: CreateFilterTypedInput, ctx: RequestContext) {
    const name = input.name?.trim();
    if (!name) throw new ValidationError('Filter Name is required');

    const ahu = await prisma.ahu.findUnique({ where: { id: input.ahuId }, select: { id: true } });
    if (!ahu) throw new ValidationError('AHU not found');

    const existing = await prisma.filter.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, isActive: true }, select: { id: true } });
    if (existing) throw new ValidationError(`A filter with the name "${name}" already exists`);

    const { attributes, errors } = await validateAndBuildFilterAttributes(input);
    if (errors.length > 0) throw new ValidationError('One or more filter fields are invalid', errors as any);

    const filterSetEnum: 'SET_A' | 'SET_B' | undefined =
      input.filterSet === 'A' ? 'SET_A' : input.filterSet === 'B' ? 'SET_B' : undefined;

    const filter = await prisma.$transaction(async (tx) => {
      const f = await tx.filter.create({
        data: {
          // The typed `filters.id` column has no DB default (it was built for
          // the dual-write that always supplies the id). Generate it here so the
          // filter, its asset_instances mirror, FilterDetails, and RFID all share it.
          id: randomUUID(),
          ahuId: input.ahuId,
          name,
          status: 'Active',
          attributes: attributes as any,
          createdBy: ctx.userId,
        } as any,
      });
      // The reverse-mirror trigger has now created the asset_instances row
      // (same id) within this txn, so the FilterDetails FK resolves.
      await tx.filterDetails.create({
        data: {
          assetInstanceId: f.id,
          ...(filterSetEnum ? { filterSet: filterSetEnum } : {}),
          ...(input.filterProfileId ? { filterProfileId: input.filterProfileId } : {}),
        },
      });
      return f;
    });

    if (input.rfidTag) {
      await identifierService.create({ assetId: filter.id, identifierType: 'RFID', identifierValue: input.rfidTag, isPrimary: true }, ctx);
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_CREATED', targetType: 'asset_instance', targetId: filter.id,
      afterValue: { name, ahuId: input.ahuId, filterSet: filterSetEnum, kind: 'FILTER' },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return filter;
  },

  // Typed-direct update (A-01 T2.3). Writes the typed `filters` table + the
  // FilterDetails sidecar; the reverse-mirror trigger keeps asset_instances in
  // sync. No asset-template / attributeSchema. Field-option values are
  // re-validated against the live config and replace the attributes JSON.
  async update(id: string, input: FilterFieldInput & { name?: string; filterSet?: 'A' | 'B' }, ctx: RequestContext) {
    const existing = await prisma.filter.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ValidationError('Filter not found');

    const data: Record<string, unknown> = { updatedBy: ctx.userId };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Filter Name is required');
      const dupe = await prisma.filter.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, isActive: true, id: { not: id } }, select: { id: true } });
      if (dupe) throw new ValidationError(`A filter with the name "${name}" already exists`);
      data.name = name;
    }

    const { attributes, errors } = await validateAndBuildFilterAttributes(input);
    if (errors.length > 0) throw new ValidationError('One or more filter fields are invalid', errors as any);
    data.attributes = attributes; // full field-option set the dialog edits — replace

    const filterSetEnum: 'SET_A' | 'SET_B' | undefined =
      input.filterSet === 'A' ? 'SET_A' : input.filterSet === 'B' ? 'SET_B' : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const f = await tx.filter.update({ where: { id }, data: data as any });
      if (filterSetEnum) {
        await tx.filterDetails.upsert({
          where: { assetInstanceId: id },
          create: { assetInstanceId: id, filterSet: filterSetEnum },
          update: { filterSet: filterSetEnum },
        });
      }
      return f;
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_UPDATED', targetType: 'asset_instance', targetId: id,
      afterValue: { name: data.name, filterSet: filterSetEnum, attributes },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return updated;
  },

  // Typed-direct soft delete (A-01 T2.3). Sets filters.isActive=false; the
  // reverse-mirror trigger flips asset_instances.isActive=false too.
  async softDelete(id: string, ctx: RequestContext) {
    const existing = await prisma.filter.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw new ValidationError('Filter not found');
    const updated = await prisma.filter.update({ where: { id }, data: { isActive: false, updatedBy: ctx.userId } as any });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_DELETED', targetType: 'asset_instance', targetId: id,
      beforeValue: { name: existing.name }, afterValue: { isActive: false },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return updated;
  },
};
