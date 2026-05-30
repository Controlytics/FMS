// Standalone Filter create — A-01 Tier 2. Writes the typed `filters` table
// directly (source of truth). NO validateParent, NO asset_relationships, NO
// asset-template attributeSchema. The reverse-mirror trigger keeps a legacy
// asset_instances row in sync for un-migrated readers.
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
};
