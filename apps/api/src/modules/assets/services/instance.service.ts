import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../../lib/errors.js';
import { instanceRepository } from '../repositories/instance.repository.js';
import { relationshipRepository } from '../repositories/relationship.repository.js';
import { identifierRepository } from '../repositories/identifier.repository.js';
import { templateRepository } from '../repositories/template.repository.js';
import { validateAttributeValues } from '../helpers/attribute-validator.js';
import { hasContainsCycle } from '../helpers/cycle-detection.js';
import { collectDescendantIds } from '../helpers/descendant-collector.js';
import { prisma } from '../../../lib/prisma.js';
import { randomBytes } from 'node:crypto';
import { provisionUnsMapping } from '../../uns/uns.service.js';
import { getEntityUnsPath } from '../../../lib/uns-path.js';

export const instanceService = {
  async list(query: { search?: string; templateId?: string; status?: string; parentId?: string | null; isActive?: string; page: number; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    if (query.templateId) where.templateId = query.templateId;
    if (query.status) where.status = query.status;
    if (query.parentId !== undefined) where.parentId = query.parentId === 'null' ? null : query.parentId;
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    const { instances, total } = await instanceRepository.findMany(where, query.page, query.limit);
    return {
      data: instances, total, page: query.page, limit: query.limit ?? total,
      totalPages: query.limit ? Math.ceil(total / query.limit) : 1,
    };
  },

  async getTree() {
    return instanceRepository.findTree();
  },

  async getById(id: string) {
    const instance = await instanceRepository.findById(id);
    if (!instance) throw new NotFoundError('Entity instance not found');
    return instance;
  },

  async create(data: Record<string, any>, ctx: RequestContext) {
    const template = await templateRepository.findById(data.templateId);
    if (!template) throw new ValidationError('Template not found');

    // Check for duplicate entity name (case-insensitive)
    const existingByName = await prisma.assetInstance.findFirst({
      where: { name: { equals: data.name.trim(), mode: 'insensitive' }, isActive: true },
    });
    if (existingByName) throw new ValidationError(`An entity with the name "${data.name.trim()}" already exists`);

    const attrSchema = (template as any).attributeSchema as any[] | undefined;
    if (attrSchema && attrSchema.length > 0 && data.attributes) {
      const attrErrors = validateAttributeValues(data.attributes, attrSchema);
      if (attrErrors.length > 0) throw new ValidationError('ATTRIBUTE_VALIDATION_ERROR', attrErrors);
    }

    if (data.parentId) {
      const parent = await instanceRepository.findByIdSimple(data.parentId);
      if (!parent) throw new ValidationError('Parent entity instance not found');

      const maxParent = (template as any).maxParentConnections ?? 1;
      if (maxParent === 0) {
        throw new ValidationError('This template does not allow parent connections (Number of Parent Connections = 0). Create this entity without a parent.');
      }

      const parentTemplate = await templateRepository.findById(parent.templateId);
      const parentMax = (parentTemplate as any)?.maxConnections ?? 10;
      if (parentMax > 0) {
        const parentUsed = await relationshipRepository.countBySourceAsset(data.parentId);
        if (parentUsed >= parentMax) {
          throw new ValidationError(`Parent entity has reached max connections (${parentUsed}/${parentMax})`);
        }
      }
    }

    // Atomic: create instance + parent relationship in one transaction
    const { instance, containsRel, containedInRel } = await prisma.$transaction(async (tx) => {
      const inst = await tx.assetInstance.create({
        data: {
          name: data.name,
          description: data.description,
          templateId: data.templateId,
          templateVersion: template.version,
          status: data.status,
          attributes: data.attributes as any,
          telemetryConfig: data.telemetryConfig as any,
          customAttributes: data.customAttributes as any,
          parentId: data.parentId ?? null,
          createdBy: ctx.userId,
        } as any,
      });

      let cRel, ciRel;
      if (data.parentId) {
        [cRel, ciRel] = await Promise.all([
          tx.assetRelationship.create({ data: { sourceAssetId: data.parentId, targetAssetId: inst.id, relationshipType: 'CONTAINS', createdBy: ctx.userId } }),
          tx.assetRelationship.create({ data: { sourceAssetId: inst.id, targetAssetId: data.parentId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId } }),
        ]);
      }

      return { instance: inst, containsRel: cRel, containedInRel: ciRel };
    });

    if (data.parentId && containsRel) {
      const parentEntity = await instanceRepository.findByIdWithName(data.parentId);

      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole,
        action: 'ASSET_RELATIONSHIP_CREATED',
        targetType: 'asset_relationship',
        targetId: containsRel.id,
        afterValue: { sourceName: parentEntity?.name || data.parentId, name: instance.name, relationship: containsRel, inverse: containedInRel },
        reason: `Auto-created: "${parentEntity?.name || data.parentId}" CONTAINS "${instance.name}"`,
        signatureMeaning: `CONTAINS relationship auto-created between parent "${parentEntity?.name}" and new child "${instance.name}"`,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_CREATED',
      targetType: 'asset_instance',
      targetId: instance.id,
      afterValue: instance,
      reason: data.parentId ? `Entity created as child of parent ${data.parentId}` : 'Entity created',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    // Auto-provision connectivity for data-ingestion-enabled templates
    if ((template as any).dataIngestionEnabled) {
      try {
        await provisionUnsMapping(instance.id);
        const token = randomBytes(32).toString('hex');
        const updatedEntity = await instanceRepository.findByIdSimple(instance.id);
        const unsPath = (updatedEntity as any)?.unsPath ?? `${template.name}/${instance.name}`;
        const allowedTopics = [
          `${unsPath}/telemetry`,
          `${unsPath}/attributes`,
          `${unsPath}/events`,
          `${unsPath}/rpc/request`,
          `${unsPath}/rpc/response`,
        ];
        await prisma.deviceCredential.create({
          data: {
            entityId: instance.id,
            accessToken: token,
            status: 'ACTIVE',
            isActive: true,
            credentialData: { allowedTopics },
          },
        });
        await prisma.connectivityStatus.create({
          data: {
            entityId: instance.id,
            status: 'OFFLINE',
          },
        });
      } catch (err) {
        // Non-fatal — log but don't fail entity creation
        console.error('Auto-provision connectivity failed:', err);
      }
    }

    return instance;
  },

  async update(id: string, data: Record<string, any>, ctx: RequestContext) {
    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');

    if (data.attributes) {
      const template = await templateRepository.findById(existing.templateId);
      if (template) {
        const attrSchema = (template as any).attributeSchema as any[] | undefined;
        if (attrSchema && attrSchema.length > 0) {
          const attrErrors = validateAttributeValues(data.attributes, attrSchema);
          if (attrErrors.length > 0) throw new ValidationError('ATTRIBUTE_VALIDATION_ERROR', attrErrors);
        }
      }
    }

    const beforeValue = {
      name: existing.name, description: existing.description, status: existing.status,
      parentId: existing.parentId, attributes: existing.attributes,
      telemetryConfig: existing.telemetryConfig, customAttributes: existing.customAttributes,
    };

    const parentIdChanging = data.parentId !== undefined && data.parentId !== existing.parentId;

    if (parentIdChanging && data.parentId) {
      const parent = await instanceRepository.findByIdSimple(data.parentId);
      if (!parent) throw new ValidationError('Parent entity instance not found');
      if (data.parentId === id) throw new ValidationError('Cannot set self as parent');

      const childCount = await relationshipRepository.countContainsChildren(id);
      if (childCount > 0) {
        throw new ValidationError('This entity is already a parent node with children and cannot be connected as a child node');
      }

      const wouldCycle = await hasContainsCycle(data.parentId, id);
      if (wouldCycle) throw new ValidationError('Cannot set parent: would create a cycle in the hierarchy');
    }

    // Check for duplicate entity name on rename (case-insensitive)
    if (data.name !== undefined && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const existingByName = await prisma.assetInstance.findFirst({
        where: { name: { equals: data.name.trim(), mode: 'insensitive' }, isActive: true, id: { not: id } },
      });
      if (existingByName) throw new ValidationError(`An entity with the name "${data.name.trim()}" already exists`);
    }

    const updateData: Record<string, unknown> = { updatedBy: ctx.userId };
    for (const key of ['name', 'description', 'status', 'parentId']) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    for (const key of ['attributes', 'telemetryConfig', 'customAttributes']) {
      if (data[key] !== undefined) updateData[key] = data[key] as any;
    }

    // Atomic: update instance + parent relationship changes in one transaction
    const { instance, newContains, newContainedIn } = await prisma.$transaction(async (tx) => {
      const inst = await tx.assetInstance.update({ where: { id }, data: updateData as any });

      let cRel, ciRel;
      if (parentIdChanging) {
        if (existing.parentId) {
          await tx.assetRelationship.deleteMany({
            where: {
              OR: [
                { sourceAssetId: existing.parentId, targetAssetId: id, relationshipType: 'CONTAINS' },
                { sourceAssetId: id, targetAssetId: existing.parentId, relationshipType: 'CONTAINED_IN' },
              ],
            },
          });
        }
        if (data.parentId) {
          [cRel, ciRel] = await Promise.all([
            tx.assetRelationship.create({ data: { sourceAssetId: data.parentId, targetAssetId: id, relationshipType: 'CONTAINS', createdBy: ctx.userId } }),
            tx.assetRelationship.create({ data: { sourceAssetId: id, targetAssetId: data.parentId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId } }),
          ]);
        }
      }

      return { instance: inst, newContains: cRel, newContainedIn: ciRel };
    });

    if (parentIdChanging) {
      if (existing.parentId) {
        const oldParent = await instanceRepository.findByIdWithName(existing.parentId);
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'ASSET_RELATIONSHIP_DELETED',
          targetType: 'asset_relationship', targetId: id,
          beforeValue: { sourceAssetId: existing.parentId, targetAssetId: id, relationshipType: 'CONTAINS', sourceName: oldParent?.name || existing.parentId, name: existing.name },
          afterValue: { deleted: true },
          reason: `Parent changed: removed CONTAINS from "${oldParent?.name || existing.parentId}"`,
          signatureMeaning: `CONTAINS relationship removed: "${oldParent?.name || existing.parentId}" → "${existing.name}"`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        });
      }

      if (data.parentId && newContains) {
        const newParent = await instanceRepository.findByIdWithName(data.parentId);
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'ASSET_RELATIONSHIP_CREATED',
          targetType: 'asset_relationship', targetId: newContains.id,
          afterValue: { sourceName: newParent?.name || data.parentId, name: instance.name, relationship: newContains, inverse: newContainedIn },
          reason: `Parent changed: "${newParent?.name || data.parentId}" now CONTAINS "${instance.name}"`,
          signatureMeaning: `Parent changed: "${newParent?.name || data.parentId}" now CONTAINS "${instance.name}"`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        });
      }
    }

    const instanceChanges = buildInstanceChangeSummary(existing, data, parentIdChanging);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_UPDATED',
      targetType: 'asset_instance', targetId: id,
      beforeValue, afterValue: instance,
      reason: instanceChanges.length > 0 ? instanceChanges.join('; ') : 'Entity updated',
      signatureMeaning: `Entity "${instance.name}" updated: ${instanceChanges.length > 0 ? instanceChanges.join(', ') : 'updated'}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return instance;
  },

  async changeStatus(id: string, status: string, ctx: RequestContext) {
    if (!status || typeof status !== 'string' || status.trim() === '') {
      throw new ValidationError('Status is required and must be a non-empty string');
    }

    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');

    const instance = await instanceRepository.update(id, {
      status: status.trim(),
      updatedBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_STATUS_CHANGED',
      targetType: 'asset_instance', targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: instance.status },
      reason: `Status: "${existing.status}" → "${instance.status}"`,
      signatureMeaning: `Entity "${instance.name}" status changed from "${existing.status}" to "${instance.status}"`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return instance;
  },

  async delete(id: string, ctx: RequestContext) {
    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');

    const descendantIds = await collectDescendantIds(id);
    const allIds = [id, ...descendantIds];

    // All deletes in one atomic transaction
    await prisma.$transaction(async (tx) => {
      await tx.assetInstance.updateMany({ where: { id: { in: allIds } }, data: { isActive: false, updatedBy: ctx.userId } });
      await tx.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: allIds } }, { targetAssetId: { in: allIds } }] } });
      await tx.assetIdentifier.deleteMany({ where: { assetId: { in: allIds } } });
      await tx.deviceCredential.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.connectivityStatus.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.unsMapping.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.qrCode.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.latestTelemetry.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.dataStream.deleteMany({ where: { entityId: { in: allIds } } });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_DELETED',
      targetType: 'asset_instance', targetId: id,
      beforeValue: { name: existing.name, status: existing.status, isActive: existing.isActive },
      afterValue: { isActive: false, cascadeDeactivated: descendantIds.length },
      signatureMeaning: `Entity "${existing.name}" and ${descendantIds.length} children deactivated`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return allIds.length;
  },

  async getChildren(id: string) {
    const parent = await instanceRepository.findByIdSimple(id);
    if (!parent) throw new NotFoundError('Entity instance not found');
    return instanceRepository.findChildren(id);
  },
};

function buildInstanceChangeSummary(existing: any, data: Record<string, any>, parentIdChanging: boolean): string[] {
  const changes: string[] = [];
  if (data.name !== undefined && data.name !== existing.name) changes.push(`Name: "${existing.name}" → "${data.name}"`);
  if (data.description !== undefined && data.description !== existing.description) changes.push('Description updated');
  if (data.status !== undefined && data.status !== existing.status) changes.push(`Status: "${existing.status}" → "${data.status}"`);
  if (data.attributes !== undefined) {
    const oldAttrs = (existing.attributes as Record<string, any>) || {};
    const newAttrs = (data.attributes as Record<string, any>) || {};
    const allKeys = new Set([...Object.keys(oldAttrs), ...Object.keys(newAttrs)]);
    const attrDiffs: string[] = [];
    for (const key of allKeys) {
      if (JSON.stringify(oldAttrs[key]) !== JSON.stringify(newAttrs[key])) {
        attrDiffs.push(`${key}: ${JSON.stringify(oldAttrs[key] ?? null)} → ${JSON.stringify(newAttrs[key] ?? null)}`);
      }
    }
    changes.push(attrDiffs.length > 0 ? `Attributes changed: ${attrDiffs.join(', ')}` : 'Attributes updated (no value changes)');
  }
  if (data.telemetryConfig !== undefined) changes.push('Telemetry config updated');
  if (data.customAttributes !== undefined) changes.push('Custom attributes updated');
  if (parentIdChanging) changes.push(`Parent: "${existing.parentId || 'none'}" → "${data.parentId || 'none'}"`);
  return changes;
}
