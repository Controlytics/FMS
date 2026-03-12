import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { NotFoundError, ConflictError } from '../../../lib/errors.js';
import { templateRepository } from '../repositories/template.repository.js';

export const templateService = {
  async list(query: { search?: string; isActive?: string; page: number; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    const { templates, total } = await templateRepository.findMany(where, query.page, query.limit);
    return {
      data: templates,
      total,
      page: query.page,
      limit: query.limit ?? total,
      totalPages: query.limit ? Math.ceil(total / query.limit) : 1,
    };
  },

  async getById(id: string) {
    const template = await templateRepository.findById(id);
    if (!template) throw new NotFoundError('Template not found');
    return template;
  },

  async create(data: Record<string, any>, ctx: RequestContext) {
    const existing = await templateRepository.findByName(data.name);
    if (existing) throw new ConflictError('Template name already exists');

    const template = await templateRepository.create({
      name: data.name,
      description: data.description,
      category: data.category,
      icon: data.icon,
      attributeSchema: data.attributeSchema,
      telemetrySchema: data.telemetrySchema,
      expectedIdentifiers: data.expectedIdentifiers,
      expectedRelationships: data.expectedRelationships,
      statusLifecycle: data.statusLifecycle,
      alarmRules: data.alarmRules,
      checklistSchema: data.checklistSchema,
      maxParentConnections: data.maxParentConnections,
      maxConnections: data.maxConnections,
      dataIngestionEnabled: data.dataIngestionEnabled,
      transportType: data.transportType,
      credentialType: data.credentialType,
      inactivityTimeout: data.inactivityTimeout,
      defaultMaxDataRate: data.defaultMaxDataRate,
      autoProvision: data.autoProvision,
      defaultRuleChainId: data.defaultRuleChainId,
      createdBy: ctx.userId,
    });

    await templateRepository.createVersion({
      templateId: template.id,
      versionNumber: 1,
      snapshot: {
        name: template.name,
        description: template.description,
        category: template.category,
        icon: template.icon,
        attributeSchema: template.attributeSchema,
        telemetrySchema: template.telemetrySchema,
        expectedIdentifiers: template.expectedIdentifiers,
        expectedRelationships: template.expectedRelationships,
        statusLifecycle: template.statusLifecycle,
        alarmRules: template.alarmRules,
        checklistSchema: template.checklistSchema,
        maxParentConnections: template.maxParentConnections,
        maxConnections: template.maxConnections,
        dataIngestionEnabled: template.dataIngestionEnabled,
        transportType: template.transportType,
        credentialType: template.credentialType,
        inactivityTimeout: template.inactivityTimeout,
        defaultMaxDataRate: template.defaultMaxDataRate,
        autoProvision: template.autoProvision,
        defaultRuleChainId: template.defaultRuleChainId,
      },
      changeNotes: 'Initial version',
      createdBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_TEMPLATE_VERSION_CREATED',
      targetType: 'asset_template_version',
      targetId: template.id,
      afterValue: { name: template.name, templateId: template.id, versionNumber: 1, changeNotes: 'Initial version' },
      signatureMeaning: `Version 1 of template "${template.name}" created`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_TEMPLATE_CREATED',
      targetType: 'asset_template',
      targetId: template.id,
      afterValue: template,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return template;
  },

  async update(id: string, data: Record<string, any>, ctx: RequestContext) {
    const existing = await templateRepository.findById(id);
    if (!existing) throw new NotFoundError('Template not found');

    if (data.name && data.name !== existing.name) {
      const dup = await templateRepository.findByName(data.name);
      if (dup) throw new ConflictError('Template name already exists');
    }

    const newVersion = existing.version + 1;

    const updateData: Record<string, unknown> = { version: newVersion, updatedBy: ctx.userId };
    for (const key of ['name', 'description', 'category', 'icon', 'maxParentConnections', 'maxConnections',
      'dataIngestionEnabled', 'transportType', 'credentialType', 'inactivityTimeout', 'defaultMaxDataRate', 'autoProvision', 'defaultRuleChainId']) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    for (const key of ['attributeSchema', 'telemetrySchema', 'expectedIdentifiers', 'expectedRelationships', 'statusLifecycle', 'alarmRules', 'checklistSchema']) {
      if (data[key] !== undefined) updateData[key] = data[key] as any;
    }

    const template = await templateRepository.update(id, updateData);

    await templateRepository.createVersion({
      templateId: template.id,
      versionNumber: newVersion,
      snapshot: {
        name: template.name,
        description: template.description,
        category: template.category,
        icon: template.icon,
        attributeSchema: template.attributeSchema,
        telemetrySchema: template.telemetrySchema,
        expectedIdentifiers: template.expectedIdentifiers,
        expectedRelationships: template.expectedRelationships,
        statusLifecycle: template.statusLifecycle,
        alarmRules: template.alarmRules,
        checklistSchema: template.checklistSchema,
        maxParentConnections: template.maxParentConnections,
        maxConnections: template.maxConnections,
        dataIngestionEnabled: template.dataIngestionEnabled,
        transportType: template.transportType,
        credentialType: template.credentialType,
        inactivityTimeout: template.inactivityTimeout,
        defaultMaxDataRate: template.defaultMaxDataRate,
        autoProvision: template.autoProvision,
        defaultRuleChainId: template.defaultRuleChainId,
      },
      changeNotes: `Updated to version ${newVersion}`,
      createdBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_TEMPLATE_VERSION_CREATED',
      targetType: 'asset_template_version',
      targetId: template.id,
      afterValue: { name: template.name, templateId: template.id, versionNumber: newVersion, changeNotes: `Updated to version ${newVersion}` },
      signatureMeaning: `Version ${newVersion} of template "${template.name}" created`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    const changes = buildChangeSummary(existing, data);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_TEMPLATE_UPDATED',
      targetType: 'asset_template',
      targetId: template.id,
      beforeValue: existing,
      afterValue: template,
      reason: changes.length > 0 ? changes.join('; ') : 'Template updated',
      signatureMeaning: `Template "${template.name}" v${newVersion}: ${changes.length > 0 ? changes.join(', ') : 'updated'}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return template;
  },

  async delete(id: string, ctx: RequestContext) {
    const existing = await templateRepository.findById(id);
    if (!existing) throw new NotFoundError('Template not found');

    await templateRepository.softDelete(id, ctx.userId);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_TEMPLATE_DELETED',
      targetType: 'asset_template',
      targetId: id,
      beforeValue: { name: existing.name, isActive: existing.isActive },
      afterValue: { isActive: false },
      signatureMeaning: `Entity template "${existing.name}" deactivated`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },

  async getVersions(id: string) {
    const template = await templateRepository.findById(id);
    if (!template) throw new NotFoundError('Template not found');
    return templateRepository.findVersions(id);
  },
};

function buildChangeSummary(existing: any, data: Record<string, any>): string[] {
  const changes: string[] = [];
  if (data.name !== undefined && data.name !== existing.name) {
    changes.push(`Name: "${existing.name}" → "${data.name}"`);
  }
  if (data.description !== undefined && data.description !== existing.description) {
    changes.push('Description updated');
  }
  if (data.category !== undefined && data.category !== existing.category) {
    changes.push(`Category: "${existing.category || 'none'}" → "${data.category}"`);
  }
  if (data.attributeSchema !== undefined) {
    const oldCount = Array.isArray(existing.attributeSchema) ? (existing.attributeSchema as any[]).length : 0;
    changes.push(`Attribute schema: ${oldCount} → ${data.attributeSchema.length} fields`);
  }
  if (data.telemetrySchema !== undefined) {
    const oldCount = Array.isArray(existing.telemetrySchema) ? (existing.telemetrySchema as any[]).length : 0;
    changes.push(`Telemetry schema: ${oldCount} → ${data.telemetrySchema.length} fields`);
  }
  if (data.expectedIdentifiers !== undefined) {
    const oldCount = Array.isArray(existing.expectedIdentifiers) ? (existing.expectedIdentifiers as any[]).length : 0;
    changes.push(`Expected identifiers: ${oldCount} → ${data.expectedIdentifiers.length}`);
  }
  if (data.statusLifecycle !== undefined) changes.push('Status lifecycle updated');
  if (data.alarmRules !== undefined) {
    const oldCount = Array.isArray(existing.alarmRules) ? (existing.alarmRules as any[]).length : 0;
    changes.push(`Alarm rules: ${oldCount} → ${data.alarmRules.length}`);
  }
  if (data.checklistSchema !== undefined) {
    const oldCount = Array.isArray(existing.checklistSchema) ? (existing.checklistSchema as any[]).length : 0;
    changes.push(`Checklist items: ${oldCount} → ${data.checklistSchema.length}`);
  }
  if (data.maxParentConnections !== undefined && data.maxParentConnections !== existing.maxParentConnections) {
    changes.push(`Max parent connections: ${existing.maxParentConnections} → ${data.maxParentConnections}`);
  }
  if (data.maxConnections !== undefined && data.maxConnections !== existing.maxConnections) {
    changes.push(`Max connections: ${existing.maxConnections} → ${data.maxConnections}`);
  }
  if (data.dataIngestionEnabled !== undefined && data.dataIngestionEnabled !== existing.dataIngestionEnabled) {
    changes.push(`Data ingestion: ${data.dataIngestionEnabled ? 'enabled' : 'disabled'}`);
  }
  if (data.transportType !== undefined && data.transportType !== existing.transportType) {
    changes.push(`Transport: ${existing.transportType || 'none'} → ${data.transportType || 'none'}`);
  }
  if (data.credentialType !== undefined && data.credentialType !== existing.credentialType) {
    changes.push(`Credential type: ${existing.credentialType || 'TOKEN'} → ${data.credentialType}`);
  }
  return changes;
}
