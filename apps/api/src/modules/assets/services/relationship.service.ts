import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../lib/errors.js';
import { INVERSE_RELATIONSHIP_MAP } from '@digilog/shared';
import { relationshipRepository } from '../repositories/relationship.repository.js';
import { instanceRepository } from '../repositories/instance.repository.js';
import { templateRepository } from '../repositories/template.repository.js';
import { hasContainsCycle } from '../helpers/cycle-detection.js';

export const relationshipService = {
  async list(query: { assetId?: string; type?: string }) {
    const where: Record<string, unknown> = {};
    if (query.assetId) {
      where.OR = [
        { sourceAssetId: query.assetId },
        { targetAssetId: query.assetId },
      ];
    }
    if (query.type) where.relationshipType = query.type;
    return relationshipRepository.findMany(where);
  },

  async create(data: { sourceAssetId: string; targetAssetId: string; relationshipType: string; customLabel?: string; notes?: string }, ctx: RequestContext) {
    const { sourceAssetId, targetAssetId, relationshipType, customLabel, notes } = data;

    if (sourceAssetId === targetAssetId) {
      throw new ValidationError('Cannot create a relationship from an entity to itself');
    }

    const [source, target] = await Promise.all([
      instanceRepository.findByIdSimple(sourceAssetId),
      instanceRepository.findByIdSimple(targetAssetId),
    ]);
    if (!source) throw new ValidationError('Source entity not found');
    if (!target) throw new ValidationError('Target entity not found');

    const existingRel = await relationshipRepository.findByCompositeKey(sourceAssetId, targetAssetId, relationshipType);
    if (existingRel) throw new ConflictError('Relationship already exists');

    // Total connection limit enforcement for both assets
    const [sourceTemplate, targetTemplateConn] = await Promise.all([
      templateRepository.findById(source.templateId),
      templateRepository.findById(target.templateId),
    ]);

    const sourceMax = (sourceTemplate as any)?.maxConnections ?? 10;
    const targetMax = (targetTemplateConn as any)?.maxConnections ?? 10;

    const [sourceUsed, targetUsed] = await Promise.all([
      relationshipRepository.countBySourceAsset(sourceAssetId),
      relationshipRepository.countBySourceAsset(targetAssetId),
    ]);

    if (sourceMax > 0 && sourceUsed >= sourceMax) {
      throw new ValidationError(`Source entity has reached max connections (${sourceUsed}/${sourceMax})`);
    }
    if (targetMax > 0 && targetUsed >= targetMax) {
      throw new ValidationError(`Target entity has reached max connections (${targetUsed}/${targetMax})`);
    }

    // CONTAINS: parent-node check, max parent connections check + cycle detection
    if (relationshipType === 'CONTAINS') {
      const targetChildCount = await relationshipRepository.countContainsChildren(targetAssetId);
      if (targetChildCount > 0) {
        throw new ValidationError('This entity is already a parent node with children and cannot be connected as a child node');
      }

      const targetTemplate = await templateRepository.findById(target.templateId);
      const maxParent = (targetTemplate as any)?.maxParentConnections ?? 1;
      if (maxParent === 0) {
        throw new ValidationError("This entity's template does not allow parent connections (Number of Parent Connections = 0)");
      }
      const currentParentCount = await relationshipRepository.countContainsParents(targetAssetId);
      if (currentParentCount >= maxParent) {
        throw new ValidationError(`Target entity has reached the Number of Parent Connections limit (${maxParent}) defined by its template`);
      }

      const wouldCycle = await hasContainsCycle(sourceAssetId, targetAssetId);
      if (wouldCycle) throw new ValidationError('Cannot create CONTAINS relationship: would create a cycle');
    }

    const inverseType = INVERSE_RELATIONSHIP_MAP[relationshipType] ?? relationshipType;

    const [relationship, inverse] = await relationshipRepository.createPairWithParent(
      { sourceAssetId, targetAssetId, relationshipType, customLabel, notes, createdBy: ctx.userId },
      { sourceAssetId: targetAssetId, targetAssetId: sourceAssetId, relationshipType: inverseType, customLabel, notes, createdBy: ctx.userId },
      relationshipType === 'CONTAINS' ? { childId: targetAssetId, parentId: sourceAssetId } : undefined,
    );

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_RELATIONSHIP_CREATED',
      targetType: 'asset_relationship',
      targetId: relationship.id,
      afterValue: { sourceName: source.name, name: target.name, relationship, inverse },
      reason: `"${source.name}" ${relationshipType} "${target.name}"`,
      signatureMeaning: `Relationship created: "${source.name}" ${relationshipType} "${target.name}"`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return {
      relationship,
      inverse,
      connectionInfo: {
        source: { used: sourceUsed + 1, allowed: sourceMax, remaining: sourceMax > 0 ? sourceMax - sourceUsed - 1 : -1 },
        target: { used: targetUsed + 1, allowed: targetMax, remaining: targetMax > 0 ? targetMax - targetUsed - 1 : -1 },
      },
    };
  },

  async delete(id: string, ctx: RequestContext) {
    const existing = await relationshipRepository.findById(id);
    if (!existing) throw new NotFoundError('Relationship not found');

    const inverseType = INVERSE_RELATIONSHIP_MAP[existing.relationshipType] ?? existing.relationshipType;
    const inverse = await relationshipRepository.findInverse(existing.targetAssetId, existing.sourceAssetId, inverseType);

    let clearParent: { instanceId: string } | undefined;
    if (existing.relationshipType === 'CONTAINS') {
      clearParent = { instanceId: existing.targetAssetId };
    } else if (existing.relationshipType === 'CONTAINED_IN') {
      clearParent = { instanceId: existing.sourceAssetId };
    }

    await relationshipRepository.deletePairWithParent(id, inverse?.id, clearParent);

    const [sourceEntity, targetEntity] = await Promise.all([
      instanceRepository.findByIdWithName(existing.sourceAssetId),
      instanceRepository.findByIdWithName(existing.targetAssetId),
    ]);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_RELATIONSHIP_DELETED',
      targetType: 'asset_relationship',
      targetId: id,
      beforeValue: {
        sourceAssetId: existing.sourceAssetId, targetAssetId: existing.targetAssetId,
        relationshipType: existing.relationshipType,
        sourceName: sourceEntity?.name, name: targetEntity?.name,
      },
      afterValue: { deleted: true, inverseDeleted: !!inverse },
      reason: `"${sourceEntity?.name}" ${existing.relationshipType} "${targetEntity?.name}" removed`,
      signatureMeaning: `Relationship removed: "${sourceEntity?.name}" ${existing.relationshipType} "${targetEntity?.name}"`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },
};
