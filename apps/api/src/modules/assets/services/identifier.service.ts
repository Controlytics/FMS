import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../lib/errors.js';
import { identifierRepository } from '../repositories/identifier.repository.js';
import { instanceRepository } from '../repositories/instance.repository.js';

export const identifierService = {
  async list(query: { assetId?: string; type?: string }) {
    const where: Record<string, unknown> = {};
    if (query.assetId) where.assetId = query.assetId;
    if (query.type) where.identifierType = query.type;
    return identifierRepository.findMany(where);
  },

  async lookupByValue(value: string) {
    const identifier = await identifierRepository.findByValue(value);
    if (!identifier) throw new NotFoundError('Identifier not found');
    return identifier;
  },

  async create(data: { assetId: string; identifierType: string; identifierValue: string; label?: string; isPrimary?: boolean }, ctx: RequestContext) {
    const asset = await instanceRepository.findByIdSimple(data.assetId);
    if (!asset) throw new ValidationError('Entity instance not found');

    const existingIdent = await identifierRepository.findByIdentifierValue(data.identifierValue);
    if (existingIdent) throw new ConflictError('Identifier value already exists');

    const identifier = await identifierRepository.create({
      assetId: data.assetId,
      identifierType: data.identifierType,
      identifierValue: data.identifierValue,
      label: data.label,
      isPrimary: data.isPrimary,
      createdBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_IDENTIFIER_CREATED',
      targetType: 'asset_identifier',
      targetId: identifier.id,
      afterValue: identifier,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return identifier;
  },

  async delete(id: string, ctx: RequestContext) {
    const existing = await identifierRepository.findById(id);
    if (!existing) throw new NotFoundError('Identifier not found');

    await identifierRepository.delete(id);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_IDENTIFIER_DELETED',
      targetType: 'asset_identifier',
      targetId: id,
      beforeValue: {
        assetId: existing.assetId,
        identifierType: existing.identifierType,
        identifierValue: existing.identifierValue,
      },
      afterValue: { deleted: true },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },
};
