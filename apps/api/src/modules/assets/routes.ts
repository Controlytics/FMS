import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';
import {
  createAssetTemplateSchema, updateAssetTemplateSchema,
  createAssetInstanceSchema, updateAssetInstanceSchema,
  createAssetRelationshipSchema, createAssetIdentifierSchema,
  assetQuerySchema, templateQuerySchema,
  INVERSE_RELATIONSHIP_MAP,
} from '@digilog/shared';

// =============================================
// Helpers
// =============================================

/**
 * Validate attribute values against the template's attribute schema.
 * Returns an array of error messages (empty if all valid).
 */
function validateAttributeValues(
  attributes: Record<string, any>,
  attributeSchema: any[],
): string[] {
  const errors: string[] = [];
  if (!attributeSchema || attributeSchema.length === 0) return errors;

  for (const schemaDef of attributeSchema) {
    const { fieldName, dataType, required } = schemaDef;
    const value = attributes[fieldName];

    // Check required fields
    if (required && (value === undefined || value === null || value === '')) {
      errors.push(`"${fieldName}" is required`);
      continue;
    }

    // Skip validation if value is not provided and not required
    if (value === undefined || value === null || value === '') continue;

    switch (dataType) {
      case 'INTEGER':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`"${fieldName}" must be an integer`);
        } else if (schemaDef.numericConstraints?.enabled) {
          const c = schemaDef.numericConstraints;
          if (c.min !== undefined && value < c.min) errors.push(`"${fieldName}" must be >= ${c.min}`);
          if (c.max !== undefined && value > c.max) errors.push(`"${fieldName}" must be <= ${c.max}`);
        }
        break;
      case 'FLOAT':
        if (typeof value !== 'number' || !isFinite(value)) {
          errors.push(`"${fieldName}" must be a number`);
        } else if (schemaDef.numericConstraints?.enabled) {
          const c = schemaDef.numericConstraints;
          if (c.min !== undefined && value < c.min) errors.push(`"${fieldName}" must be >= ${c.min}`);
          if (c.max !== undefined && value > c.max) errors.push(`"${fieldName}" must be <= ${c.max}`);
        }
        break;
      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          errors.push(`"${fieldName}" must be a boolean (true/false)`);
        }
        break;
      case 'TEXT':
      case 'FILE':
        if (typeof value !== 'string') {
          errors.push(`"${fieldName}" must be a text string`);
        }
        break;
      case 'URL':
        if (typeof value !== 'string') {
          errors.push(`"${fieldName}" must be a URL string`);
        } else {
          try { new URL(value); } catch {
            errors.push(`"${fieldName}" must be a valid URL`);
          }
        }
        break;
      case 'DATE':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push(`"${fieldName}" must be a valid date (YYYY-MM-DD)`);
        }
        break;
      case 'DATETIME':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          errors.push(`"${fieldName}" must be a valid datetime`);
        }
        break;
      case 'DROPDOWN':
        if (typeof value !== 'string') {
          errors.push(`"${fieldName}" must be a string`);
        } else if (schemaDef.dropdownOptions && !schemaDef.dropdownOptions.includes(value)) {
          errors.push(`"${fieldName}" must be one of: ${schemaDef.dropdownOptions.join(', ')}`);
        }
        break;
    }
  }

  return errors;
}

/**
 * Walk up the parent chain from sourceId. If targetId is found, there's a cycle.
 */
async function hasContainsCycle(sourceId: string, targetId: string): Promise<boolean> {
  let currentId: string | null = sourceId;
  const visited = new Set<string>();
  while (currentId) {
    if (currentId === targetId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const record: { parentId: string | null } | null = await prisma.assetInstance.findUnique({ where: { id: currentId }, select: { parentId: true } });
    currentId = record?.parentId ?? null;
  }
  return false;
}

/**
 * Recursively collect all descendant IDs of a given instance.
 */
async function collectDescendantIds(parentId: string): Promise<string[]> {
  const children = await prisma.assetInstance.findMany({
    where: { parentId, isActive: true },
    select: { id: true },
  });
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    const grandchildren = await collectDescendantIds(child.id);
    ids.push(...grandchildren);
  }
  return ids;
}


// =============================================
// Routes
// =============================================

export default async function assetRoutes(app: FastifyInstance) {

  // =========================================================================
  // TEMPLATE ENDPOINTS (tag: 'Entity Templates')
  // =========================================================================

  // 1. GET /templates — List templates with search/pagination
  app.get('/templates', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'List entity templates',
      description: 'List templates with optional search, isActive filter, and pagination.',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by name' },
          isActive: { type: 'string', description: '"true" or "false"' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 50 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  category: { type: 'string' },
                  icon: { type: 'string' },
                  version: { type: 'integer' },
                  attributeSchema: { type: 'array' },
                  telemetrySchema: { type: 'array' },
                  expectedIdentifiers: { type: 'array' },
                  expectedRelationships: { type: 'array' },
                  statusLifecycle: { type: 'array' },
                  alarmRules: { type: 'array' },
                  maxParentConnections: { type: 'integer' },
                  maxConnections: { type: 'integer' },
                  isActive: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  createdBy: { type: 'string' },
                  _count: { type: 'object', properties: { instances: { type: 'integer' } } },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const query = templateQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    const [templates, total] = await Promise.all([
      prisma.assetTemplate.findMany({
        where: where as any,
        include: { _count: { select: { instances: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.assetTemplate.count({ where: where as any }),
    ]);

    return {
      data: templates,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  });

  // 2. GET /templates/:id — Get single template by UUID
  app.get('/templates/:id', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Get entity template by ID',
      description: 'Retrieve a single entity template by its UUID, including instance count.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            icon: { type: 'string' },
            version: { type: 'integer' },
            attributeSchema: { type: 'array' },
            telemetrySchema: { type: 'array' },
            expectedIdentifiers: { type: 'array' },
            expectedRelationships: { type: 'array' },
            statusLifecycle: { type: 'array' },
            alarmRules: { type: 'array' },
            maxParentConnections: { type: 'integer' },
            maxConnections: { type: 'integer' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            createdBy: { type: 'string' },
            updatedBy: { type: 'string' },
            _count: { type: 'object', properties: { instances: { type: 'integer' } } },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await prisma.assetTemplate.findUnique({
      where: { id },
      include: { _count: { select: { instances: true } } },
    });
    if (!template) {
      return reply.code(404).send({ error: 'Template not found' });
    }
    return template;
  });

  // 3. POST /templates — Create template
  app.post('/templates', {
    preHandler: [app.requirePermission('ASSET_TEMPLATE_MANAGE')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Create entity template',
      description: 'Create a new entity template. Auto-creates version 1 snapshot. Requires ASSET_TEMPLATE_MANAGE permission.',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', description: 'Template category (Equipment, Room, Building, etc.)' },
          icon: { type: 'string' },
          attributeSchema: { type: 'array' },
          expectedIdentifiers: { type: 'array' },
          expectedRelationships: { type: 'array', description: 'Expected relationship type definitions' },
          statusLifecycle: { type: 'array', description: 'Status definitions with transitions' },
          alarmRules: { type: 'array' },
          maxParentConnections: { type: 'integer', description: 'Number of Parent Connections: 0=not allowed, 1=single parent only, 2+=multiple parents' },
          maxConnections: { type: 'integer', description: 'Max total connections (all types): 0=unlimited, N=limit' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ASSET_TEMPLATE', req, reply);
    if (!ok) return;

    const parsed = createAssetTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    // Check unique name
    const existing = await prisma.assetTemplate.findUnique({ where: { name: parsed.data.name } });
    if (existing) {
      return reply.code(409).send({ error: 'Template name already exists' });
    }

    const template = await prisma.assetTemplate.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        icon: parsed.data.icon,
        version: 1,
        attributeSchema: parsed.data.attributeSchema as any,
        telemetrySchema: parsed.data.telemetrySchema as any,
        expectedIdentifiers: parsed.data.expectedIdentifiers as any,
        expectedRelationships: parsed.data.expectedRelationships as any,
        statusLifecycle: parsed.data.statusLifecycle as any,
        alarmRules: parsed.data.alarmRules as any,
        maxParentConnections: parsed.data.maxParentConnections ?? 1,
        maxConnections: parsed.data.maxConnections ?? 10,
        createdBy: req.user.username,
      },
    });

    // Auto-create version 1 snapshot
    await prisma.assetTemplateVersion.create({
      data: {
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
          maxParentConnections: template.maxParentConnections,
          maxConnections: template.maxConnections,
        },
        changeNotes: 'Initial version',
        createdBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_TEMPLATE_CREATED',
      targetType: 'asset_template',
      targetId: template.id,
      afterValue: template,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send({ success: true, data: template });
  });

  // 4. PUT /templates/:id — Update template
  app.put('/templates/:id', {
    preHandler: [app.requirePermission('ASSET_TEMPLATE_MANAGE')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Update entity template',
      description: 'Update an entity template. Increments version and creates a new version snapshot. Requires ASSET_TEMPLATE_MANAGE permission.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', description: 'Template category (Equipment, Room, Building, etc.)' },
          icon: { type: 'string' },
          attributeSchema: { type: 'array' },
          expectedIdentifiers: { type: 'array' },
          expectedRelationships: { type: 'array', description: 'Expected relationship type definitions' },
          statusLifecycle: { type: 'array', description: 'Status definitions with transitions' },
          alarmRules: { type: 'array' },
          maxParentConnections: { type: 'integer', description: 'Number of Parent Connections: 0=not allowed, 1=single parent only, 2+=multiple parents' },
          maxConnections: { type: 'integer', description: 'Max total connections (all types): 0=unlimited, N=limit' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_ASSET_TEMPLATE', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const parsed = updateAssetTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    // If name is changing, check uniqueness
    if (parsed.data.name && parsed.data.name !== existing.name) {
      const dup = await prisma.assetTemplate.findUnique({ where: { name: parsed.data.name } });
      if (dup) {
        return reply.code(409).send({ error: 'Template name already exists' });
      }
    }

    const newVersion = existing.version + 1;

    const template = await prisma.assetTemplate.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.category !== undefined && { category: parsed.data.category }),
        ...(parsed.data.icon !== undefined && { icon: parsed.data.icon }),
        ...(parsed.data.attributeSchema !== undefined && { attributeSchema: parsed.data.attributeSchema as any }),
        ...(parsed.data.telemetrySchema !== undefined && { telemetrySchema: parsed.data.telemetrySchema as any }),
        ...(parsed.data.expectedIdentifiers !== undefined && { expectedIdentifiers: parsed.data.expectedIdentifiers as any }),
        ...(parsed.data.expectedRelationships !== undefined && { expectedRelationships: parsed.data.expectedRelationships as any }),
        ...(parsed.data.statusLifecycle !== undefined && { statusLifecycle: parsed.data.statusLifecycle as any }),
        ...(parsed.data.alarmRules !== undefined && { alarmRules: parsed.data.alarmRules as any }),
        ...(parsed.data.maxParentConnections !== undefined && { maxParentConnections: parsed.data.maxParentConnections }),
        ...(parsed.data.maxConnections !== undefined && { maxConnections: parsed.data.maxConnections }),
        version: newVersion,
        updatedBy: req.user.username,
      },
    });

    // Auto-create new version snapshot
    await prisma.assetTemplateVersion.create({
      data: {
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
          maxParentConnections: template.maxParentConnections,
          maxConnections: template.maxConnections,
        },
        changeNotes: `Updated to version ${newVersion}`,
        createdBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_TEMPLATE_UPDATED',
      targetType: 'asset_template',
      targetId: template.id,
      beforeValue: existing,
      afterValue: template,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, data: template };
  });

  // 5. DELETE /templates/:id — Soft-delete (set isActive=false)
  app.delete('/templates/:id', {
    preHandler: [app.requirePermission('ASSET_TEMPLATE_MANAGE')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Soft-delete entity template',
      description: 'Set isActive=false on an entity template. Requires ASSET_TEMPLATE_MANAGE permission.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_ASSET_TEMPLATE', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const existing = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    await prisma.assetTemplate.update({
      where: { id },
      data: { isActive: false, updatedBy: req.user.username },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_TEMPLATE_DELETED',
      targetType: 'asset_template',
      targetId: id,
      beforeValue: { name: existing.name, isActive: existing.isActive },
      afterValue: { isActive: false },
      signatureMeaning: `Entity template "${existing.name}" deactivated`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // 6. GET /templates/:id/versions — List versions for a template
  app.get('/templates/:id/versions', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'List template versions',
      description: 'Get all version snapshots for an entity template, ordered by version number descending.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              templateId: { type: 'string' },
              versionNumber: { type: 'integer' },
              snapshot: { type: 'object', additionalProperties: true },
              changeNotes: { type: 'string' },
              createdAt: { type: 'string' },
              createdBy: { type: 'string' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    // Verify template exists
    const template = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!template) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    const versions = await prisma.assetTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { versionNumber: 'desc' },
    });

    return versions;
  });

  // =========================================================================
  // INSTANCE ENDPOINTS (tag: 'Entities')
  // =========================================================================

  // 7. GET /instances — List instances with search/filter/pagination
  app.get('/instances', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'List entity instances',
      description: 'List entity instances with optional search, filter by templateId, status, parentId, isActive, and pagination.',
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by name' },
          templateId: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          parentId: { type: 'string' },
          isActive: { type: 'string', description: '"true" or "false"' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 50 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  templateId: { type: 'string' },
                  templateVersion: { type: 'integer' },
                  status: { type: 'string' },
                  attributes: { type: 'object', additionalProperties: true },
                  parentId: { type: ['string', 'null'], nullable: true },
                  isActive: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  createdBy: { type: 'string' },
                  template: {
                    type: 'object',
                    properties: { name: { type: 'string' }, icon: { type: 'string' } },
                  },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const query = assetQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }
    if (query.templateId) {
      where.templateId = query.templateId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.parentId !== undefined) {
      where.parentId = query.parentId === 'null' ? null : query.parentId;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    const [instances, total] = await Promise.all([
      prisma.assetInstance.findMany({
        where: where as any,
        include: {
          template: { select: { name: true, icon: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.assetInstance.count({ where: where as any }),
    ]);

    return {
      data: instances,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  });

  // 8. GET /instances/tree — Get full asset tree
  app.get('/instances/tree', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Get entity instance tree',
      description: 'Return all active instances with parentId relationships as a flat array. The frontend builds the tree from this.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              parentId: { type: ['string', 'null'], nullable: true },
              templateId: { type: 'string' },
              status: { type: 'string' },
              template: {
                type: 'object',
                properties: { name: { type: 'string' }, icon: { type: 'string' } },
              },
              _count: { type: 'object', properties: { children: { type: 'integer' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    const instances = await prisma.assetInstance.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        parentId: true,
        templateId: true,
        status: true,
        template: { select: { name: true, icon: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });
    return instances;
  });

  // 9. GET /instances/:id — Get single instance
  app.get('/instances/:id', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Get entity instance by ID',
      description: 'Retrieve a single entity instance with template info, relationships, identifiers, and parent info.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const instance = await prisma.assetInstance.findUnique({
      where: { id },
      include: {
        template: {
          select: {
            id: true, name: true, icon: true,
            attributeSchema: true,
            telemetrySchema: true,
            expectedIdentifiers: true,
            version: true,
            maxConnections: true,
            maxParentConnections: true,
          },
        },
        parent: { select: { id: true, name: true, templateId: true } },
        sourceRelations: {
          include: { targetAsset: { select: { id: true, name: true } } },
        },
        targetRelations: {
          include: { sourceAsset: { select: { id: true, name: true } } },
        },
        identifiers: true,
        _count: { select: { sourceRelations: true } },
      },
    });
    if (!instance) {
      return reply.code(404).send({ error: 'Entity instance not found' });
    }
    return instance;
  });

  // 10. POST /instances — Create instance from template
  app.post('/instances', {
    preHandler: [app.requirePermission('ASSET_CREATE')],
    schema: {
      tags: ['Entities'],
      summary: 'Create entity instance',
      description: 'Create a new entity instance from a template. If parentId is set, auto-creates CONTAINS/CONTAINED_IN relationships.',
      body: {
        type: 'object',
        required: ['name', 'templateId'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          templateId: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
          telemetryConfig: { type: 'object', additionalProperties: true },
          customAttributes: { type: 'object', additionalProperties: true },
          parentId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ASSET', req, reply);
    if (!ok) return;

    const parsed = createAssetInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    // Verify template exists
    const template = await prisma.assetTemplate.findUnique({ where: { id: parsed.data.templateId } });
    if (!template) {
      return reply.code(400).send({ error: 'Template not found' });
    }

    // Validate attribute values against template schema
    const attrSchema = (template as any).attributeSchema as any[] | undefined;
    if (attrSchema && attrSchema.length > 0 && parsed.data.attributes) {
      const attrErrors = validateAttributeValues(parsed.data.attributes, attrSchema);
      if (attrErrors.length > 0) {
        return reply.code(400).send({ error: 'ATTRIBUTE_VALIDATION_ERROR', details: attrErrors });
      }
    }

    // If parentId is set, verify parent exists and check parent connection limit
    if (parsed.data.parentId) {
      const parent = await prisma.assetInstance.findUnique({ where: { id: parsed.data.parentId } });
      if (!parent) {
        return reply.code(400).send({ error: 'Parent entity instance not found' });
      }
      const maxParent = (template as any).maxParentConnections ?? 1;
      if (maxParent === 0) {
        return reply.code(400).send({ error: 'This template does not allow parent connections (Number of Parent Connections = 0). Create this entity without a parent.' });
      }

      // Check parent's total connection limit
      const parentTemplate = await prisma.assetTemplate.findUnique({ where: { id: parent.templateId }, select: { maxConnections: true } });
      const parentMax = parentTemplate?.maxConnections ?? 10;
      if (parentMax > 0) {
        const parentUsed = await prisma.assetRelationship.count({ where: { sourceAssetId: parsed.data.parentId! } });
        if (parentUsed >= parentMax) {
          return reply.code(400).send({ error: `Parent entity has reached max connections (${parentUsed}/${parentMax})` });
        }
      }
    }

    const instance = await prisma.assetInstance.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        templateId: parsed.data.templateId,
        templateVersion: template.version,
        status: parsed.data.status,
        attributes: parsed.data.attributes as any,
        telemetryConfig: parsed.data.telemetryConfig as any,
        customAttributes: parsed.data.customAttributes as any,
        parentId: parsed.data.parentId ?? null,
        createdBy: req.user.username,
      },
    });

    // If parentId is set, auto-create CONTAINS/CONTAINED_IN relationships
    if (parsed.data.parentId) {
      await prisma.$transaction([
        prisma.assetRelationship.create({
          data: {
            sourceAssetId: parsed.data.parentId,
            targetAssetId: instance.id,
            relationshipType: 'CONTAINS',
            createdBy: req.user.username,
          },
        }),
        prisma.assetRelationship.create({
          data: {
            sourceAssetId: instance.id,
            targetAssetId: parsed.data.parentId,
            relationshipType: 'CONTAINED_IN',
            createdBy: req.user.username,
          },
        }),
      ]);
    }

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_CREATED',
      targetType: 'asset_instance',
      targetId: instance.id,
      afterValue: instance,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send({ success: true, data: instance });
  });

  // 11. PUT /instances/:id — Update instance
  app.put('/instances/:id', {
    preHandler: [app.requirePermission('ASSET_UPDATE')],
    schema: {
      tags: ['Entities'],
      summary: 'Update entity instance',
      description: 'Update an entity instance. If parentId changes, updates CONTAINS relationships.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          attributes: { type: 'object', additionalProperties: true },
          telemetryConfig: { type: 'object', additionalProperties: true },
          customAttributes: { type: 'object', additionalProperties: true },
          parentId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_ASSET', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const parsed = updateAssetInstanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.assetInstance.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Entity instance not found' });
    }

    // Validate attribute values against template schema if attributes are being updated
    if (parsed.data.attributes) {
      const template = await prisma.assetTemplate.findUnique({ where: { id: existing.templateId } });
      if (template) {
        const attrSchema = (template as any).attributeSchema as any[] | undefined;
        if (attrSchema && attrSchema.length > 0) {
          const attrErrors = validateAttributeValues(parsed.data.attributes, attrSchema);
          if (attrErrors.length > 0) {
            return reply.code(400).send({ error: 'ATTRIBUTE_VALIDATION_ERROR', details: attrErrors });
          }
        }
      }
    }

    const beforeValue = {
      name: existing.name,
      description: existing.description,
      status: existing.status,
      parentId: existing.parentId,
    };

    // Check if parentId is changing
    const parentIdChanging = parsed.data.parentId !== undefined && parsed.data.parentId !== existing.parentId;

    // If parentId is changing, verify new parent exists (if not null)
    if (parentIdChanging && parsed.data.parentId) {
      const parent = await prisma.assetInstance.findUnique({ where: { id: parsed.data.parentId } });
      if (!parent) {
        return reply.code(400).send({ error: 'Parent entity instance not found' });
      }

      // Prevent setting self as parent
      if (parsed.data.parentId === id) {
        return reply.code(400).send({ error: 'Cannot set self as parent' });
      }

      // If this asset is already a parent (has children), it cannot become a child
      const childCount = await prisma.assetRelationship.count({
        where: { sourceAssetId: id, relationshipType: 'CONTAINS' },
      });
      if (childCount > 0) {
        return reply.code(400).send({ error: 'This entity is already a parent node with children and cannot be connected as a child node' });
      }

      // Prevent cycle: ensure new parent is not a descendant
      const wouldCycle = await hasContainsCycle(parsed.data.parentId, id);
      if (wouldCycle) {
        return reply.code(400).send({ error: 'Cannot set parent: would create a cycle in the hierarchy' });
      }
    }

    const instance = await prisma.assetInstance.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.status !== undefined && { status: parsed.data.status }),
        ...(parsed.data.attributes !== undefined && { attributes: parsed.data.attributes as any }),
        ...(parsed.data.telemetryConfig !== undefined && { telemetryConfig: parsed.data.telemetryConfig as any }),
        ...(parsed.data.customAttributes !== undefined && { customAttributes: parsed.data.customAttributes as any }),
        ...(parsed.data.parentId !== undefined && { parentId: parsed.data.parentId }),
        updatedBy: req.user.username,
      },
    });

    // If parentId changed, update CONTAINS/CONTAINED_IN relationships
    if (parentIdChanging) {
      // Remove old CONTAINS relationships with previous parent
      if (existing.parentId) {
        await prisma.assetRelationship.deleteMany({
          where: {
            OR: [
              { sourceAssetId: existing.parentId, targetAssetId: id, relationshipType: 'CONTAINS' },
              { sourceAssetId: id, targetAssetId: existing.parentId, relationshipType: 'CONTAINED_IN' },
            ],
          },
        });
      }

      // Create new CONTAINS relationships with new parent
      if (parsed.data.parentId) {
        await prisma.$transaction([
          prisma.assetRelationship.create({
            data: {
              sourceAssetId: parsed.data.parentId,
              targetAssetId: id,
              relationshipType: 'CONTAINS',
              createdBy: req.user.username,
            },
          }),
          prisma.assetRelationship.create({
            data: {
              sourceAssetId: id,
              targetAssetId: parsed.data.parentId,
              relationshipType: 'CONTAINED_IN',
              createdBy: req.user.username,
            },
          }),
        ]);
      }
    }

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_UPDATED',
      targetType: 'asset_instance',
      targetId: id,
      beforeValue,
      afterValue: instance,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, data: instance };
  });

  // 12. PATCH /instances/:id/status — Change status
  app.patch('/instances/:id/status', {
    preHandler: [app.requirePermission('ASSET_UPDATE')],
    schema: {
      tags: ['Entities'],
      summary: 'Change entity instance status',
      description: 'Update the status of an entity instance. Requires ASSET_UPDATE permission.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', description: 'New status value' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_ASSET', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as { status: string };

    if (!body.status || typeof body.status !== 'string' || body.status.trim() === '') {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Status is required and must be a non-empty string' });
    }

    const existing = await prisma.assetInstance.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Entity instance not found' });
    }

    const instance = await prisma.assetInstance.update({
      where: { id },
      data: {
        status: body.status.trim(),
        updatedBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_STATUS_CHANGED',
      targetType: 'asset_instance',
      targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: instance.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, data: instance };
  });

  // 13. DELETE /instances/:id — Soft-delete with cascade
  app.delete('/instances/:id', {
    preHandler: [app.requirePermission('ASSET_DELETE')],
    schema: {
      tags: ['Entities'],
      summary: 'Soft-delete entity instance',
      description: 'Set isActive=false on an entity instance and cascade to all children. Also removes related relationships and identifiers.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            deactivatedCount: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_ASSET', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const existing = await prisma.assetInstance.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Entity instance not found' });
    }

    // Collect all descendant IDs for cascade soft-delete
    const descendantIds = await collectDescendantIds(id);
    const allIds = [id, ...descendantIds];

    // Soft-delete all instances (self + descendants)
    await prisma.assetInstance.updateMany({
      where: { id: { in: allIds } },
      data: { isActive: false, updatedBy: req.user.username },
    });

    // Delete related relationships for all deactivated instances
    await prisma.assetRelationship.deleteMany({
      where: {
        OR: [
          { sourceAssetId: { in: allIds } },
          { targetAssetId: { in: allIds } },
        ],
      },
    });

    // Delete related identifiers for all deactivated instances
    await prisma.assetIdentifier.deleteMany({
      where: { assetId: { in: allIds } },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_DELETED',
      targetType: 'asset_instance',
      targetId: id,
      beforeValue: { name: existing.name, status: existing.status, isActive: existing.isActive },
      afterValue: { isActive: false, cascadeDeactivated: descendantIds.length },
      signatureMeaning: `Entity "${existing.name}" and ${descendantIds.length} children deactivated`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, deactivatedCount: allIds.length };
  });

  // 14. GET /instances/:id/children — Get direct children
  app.get('/instances/:id/children', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entities'],
      summary: 'Get direct children of an entity instance',
      description: 'Return the direct children of an entity instance.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              templateId: { type: 'string' },
              status: { type: 'string' },
              isActive: { type: 'boolean' },
              template: {
                type: 'object',
                properties: { name: { type: 'string' }, icon: { type: 'string' } },
              },
              _count: { type: 'object', properties: { children: { type: 'integer' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    // Verify parent exists
    const parent = await prisma.assetInstance.findUnique({ where: { id } });
    if (!parent) {
      return reply.code(404).send({ error: 'Entity instance not found' });
    }

    const children = await prisma.assetInstance.findMany({
      where: { parentId: id, isActive: true },
      select: {
        id: true,
        name: true,
        templateId: true,
        status: true,
        isActive: true,
        template: { select: { name: true, icon: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });

    return children;
  });

  // =========================================================================
  // RELATIONSHIP ENDPOINTS (tag: 'Entity Relationships')
  // =========================================================================

  // 15. GET /relationships — List relationships
  app.get('/relationships', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Relationships'],
      summary: 'List entity relationships',
      description: 'List relationships with optional filter by entity ID (source or target) and type.',
      querystring: {
        type: 'object',
        properties: {
          assetId: { type: 'string', format: 'uuid', description: 'Filter by source or target entity ID' },
          type: { type: 'string', description: 'Filter by relationship type' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              sourceAssetId: { type: 'string' },
              targetAssetId: { type: 'string' },
              relationshipType: { type: 'string' },
              customLabel: { type: 'string' },
              notes: { type: 'string' },
              createdAt: { type: 'string' },
              sourceAsset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
              targetAsset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { assetId, type } = req.query as { assetId?: string; type?: string };
    const where: Record<string, unknown> = {};

    if (assetId) {
      where.OR = [
        { sourceAssetId: assetId },
        { targetAssetId: assetId },
      ];
    }
    if (type) {
      where.relationshipType = type;
    }

    const relationships = await prisma.assetRelationship.findMany({
      where: where as any,
      include: {
        sourceAsset: { select: { id: true, name: true } },
        targetAsset: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return relationships;
  });

  // 16. POST /relationships — Create relationship + auto-create inverse
  app.post('/relationships', {
    preHandler: [app.requirePermission('ASSET_RELATIONSHIP_MANAGE')],
    schema: {
      tags: ['Entity Relationships'],
      summary: 'Create entity relationship',
      description: 'Create a relationship between two entities and auto-create the inverse relationship. Validates no self-referencing, no duplicates, and no CONTAINS cycles.',
      body: {
        type: 'object',
        required: ['sourceAssetId', 'targetAssetId', 'relationshipType'],
        properties: {
          sourceAssetId: { type: 'string', format: 'uuid' },
          targetAssetId: { type: 'string', format: 'uuid' },
          relationshipType: { type: 'string' },
          customLabel: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
            inverse: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ASSET_RELATIONSHIP', req, reply);
    if (!ok) return;

    const parsed = createAssetRelationshipSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { sourceAssetId, targetAssetId, relationshipType, customLabel, notes } = parsed.data;

    // No self-referencing
    if (sourceAssetId === targetAssetId) {
      return reply.code(400).send({ error: 'Cannot create a relationship from an entity to itself' });
    }

    // Verify both assets exist
    const [source, target] = await Promise.all([
      prisma.assetInstance.findUnique({ where: { id: sourceAssetId } }),
      prisma.assetInstance.findUnique({ where: { id: targetAssetId } }),
    ]);
    if (!source) {
      return reply.code(400).send({ error: 'Source entity not found' });
    }
    if (!target) {
      return reply.code(400).send({ error: 'Target entity not found' });
    }

    // No duplicate
    const existingRel = await prisma.assetRelationship.findUnique({
      where: {
        sourceAssetId_targetAssetId_relationshipType: {
          sourceAssetId, targetAssetId, relationshipType,
        },
      },
    });
    if (existingRel) {
      return reply.code(409).send({ error: 'Relationship already exists' });
    }

    // ---- Total connection limit enforcement for BOTH assets ----
    const [sourceTemplate, targetTemplate_conn] = await Promise.all([
      prisma.assetTemplate.findUnique({ where: { id: source.templateId }, select: { maxConnections: true } }),
      prisma.assetTemplate.findUnique({ where: { id: target.templateId }, select: { maxConnections: true } }),
    ]);

    const sourceMax = sourceTemplate?.maxConnections ?? 10;
    const targetMax = targetTemplate_conn?.maxConnections ?? 10;

    // Count existing connections (each row where asset is source = 1 logical connection)
    const [sourceUsed, targetUsed] = await Promise.all([
      prisma.assetRelationship.count({ where: { sourceAssetId } }),
      prisma.assetRelationship.count({ where: { sourceAssetId: targetAssetId } }),
    ]);

    if (sourceMax > 0 && sourceUsed >= sourceMax) {
      return reply.code(400).send({
        error: `Source entity has reached max connections (${sourceUsed}/${sourceMax})`,
        connectionInfo: { entity: 'source', used: sourceUsed, allowed: sourceMax },
      });
    }
    if (targetMax > 0 && targetUsed >= targetMax) {
      return reply.code(400).send({
        error: `Target entity has reached max connections (${targetUsed}/${targetMax})`,
        connectionInfo: { entity: 'target', used: targetUsed, allowed: targetMax },
      });
    }

    // CONTAINS: parent-node check, max parent connections check + cycle detection
    if (relationshipType === 'CONTAINS') {
      // If target asset is already a parent (has children), it cannot become a child
      const targetChildCount = await prisma.assetRelationship.count({
        where: { sourceAssetId: targetAssetId, relationshipType: 'CONTAINS' },
      });
      if (targetChildCount > 0) {
        return reply.code(400).send({ error: 'This entity is already a parent node with children and cannot be connected as a child node' });
      }

      // Check max parent connections on target asset's template
      const targetTemplate = await prisma.assetTemplate.findUnique({
        where: { id: target.templateId },
        select: { maxParentConnections: true },
      });
      const maxParent = targetTemplate?.maxParentConnections ?? 1;
      if (maxParent === 0) {
        return reply.code(400).send({ error: 'This entity\'s template does not allow parent connections (Number of Parent Connections = 0)' });
      }
      const currentParentCount = await prisma.assetRelationship.count({
        where: { targetAssetId, relationshipType: 'CONTAINS' },
      });
      if (currentParentCount >= maxParent) {
        return reply.code(400).send({ error: `Target entity has reached the Number of Parent Connections limit (${maxParent}) defined by its template` });
      }

      const wouldCycle = await hasContainsCycle(sourceAssetId, targetAssetId);
      if (wouldCycle) {
        return reply.code(400).send({ error: 'Cannot create CONTAINS relationship: would create a cycle' });
      }
    }

    const inverseType = INVERSE_RELATIONSHIP_MAP[relationshipType] ?? relationshipType;

    const txOps: any[] = [
      prisma.assetRelationship.create({
        data: {
          sourceAssetId,
          targetAssetId,
          relationshipType,
          customLabel,
          notes,
          createdBy: req.user.username,
        },
      }),
      prisma.assetRelationship.create({
        data: {
          sourceAssetId: targetAssetId,
          targetAssetId: sourceAssetId,
          relationshipType: inverseType,
          customLabel,
          notes,
          createdBy: req.user.username,
        },
      }),
    ];

    // CONTAINS: also set parentId on child asset so tree hierarchy is updated
    if (relationshipType === 'CONTAINS') {
      txOps.push(
        prisma.assetInstance.update({
          where: { id: targetAssetId },
          data: { parentId: sourceAssetId },
        }),
      );
    }

    const [relationship, inverse] = await prisma.$transaction(txOps);

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_RELATIONSHIP_CREATED',
      targetType: 'asset_relationship',
      targetId: relationship.id,
      afterValue: { relationship, inverse },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send({
      success: true,
      data: relationship,
      inverse,
      connectionInfo: {
        source: { used: sourceUsed + 1, allowed: sourceMax, remaining: sourceMax > 0 ? sourceMax - sourceUsed - 1 : -1 },
        target: { used: targetUsed + 1, allowed: targetMax, remaining: targetMax > 0 ? targetMax - targetUsed - 1 : -1 },
      },
    });
  });

  // 17. DELETE /relationships/:id — Delete relationship + its inverse
  app.delete('/relationships/:id', {
    preHandler: [app.requirePermission('ASSET_RELATIONSHIP_MANAGE')],
    schema: {
      tags: ['Entity Relationships'],
      summary: 'Delete entity relationship and its inverse',
      description: 'Delete an entity relationship and automatically delete its inverse relationship.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_ASSET_RELATIONSHIP', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const existing = await prisma.assetRelationship.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Relationship not found' });
    }

    const inverseType = INVERSE_RELATIONSHIP_MAP[existing.relationshipType] ?? existing.relationshipType;

    // Find the inverse relationship
    const inverse = await prisma.assetRelationship.findFirst({
      where: {
        sourceAssetId: existing.targetAssetId,
        targetAssetId: existing.sourceAssetId,
        relationshipType: inverseType,
      },
    });

    // Delete both in a transaction + clear parentId if CONTAINS
    const deleteOps: any[] = [prisma.assetRelationship.delete({ where: { id } })];
    if (inverse) {
      deleteOps.push(prisma.assetRelationship.delete({ where: { id: inverse.id } }));
    }
    // If deleting a CONTAINS relationship, clear parentId on the child asset
    if (existing.relationshipType === 'CONTAINS') {
      deleteOps.push(
        prisma.assetInstance.update({
          where: { id: existing.targetAssetId },
          data: { parentId: null },
        }),
      );
    } else if (existing.relationshipType === 'CONTAINED_IN') {
      deleteOps.push(
        prisma.assetInstance.update({
          where: { id: existing.sourceAssetId },
          data: { parentId: null },
        }),
      );
    }
    await prisma.$transaction(deleteOps);

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_RELATIONSHIP_DELETED',
      targetType: 'asset_relationship',
      targetId: id,
      beforeValue: {
        sourceAssetId: existing.sourceAssetId,
        targetAssetId: existing.targetAssetId,
        relationshipType: existing.relationshipType,
      },
      afterValue: { deleted: true, inverseDeleted: !!inverse },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // =========================================================================
  // IDENTIFIER ENDPOINTS (tag: 'Entity Identifiers')
  // =========================================================================

  // 18. GET /identifiers — List identifiers
  app.get('/identifiers', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'List entity identifiers',
      description: 'List identifiers with optional filter by entity ID and type.',
      querystring: {
        type: 'object',
        properties: {
          assetId: { type: 'string', format: 'uuid', description: 'Filter by entity ID' },
          type: { type: 'string', description: 'Filter by identifier type' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              assetId: { type: 'string' },
              identifierType: { type: 'string' },
              identifierValue: { type: 'string' },
              label: { type: 'string' },
              isPrimary: { type: 'boolean' },
              createdAt: { type: 'string' },
              asset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { assetId, type } = req.query as { assetId?: string; type?: string };
    const where: Record<string, unknown> = {};

    if (assetId) {
      where.assetId = assetId;
    }
    if (type) {
      where.identifierType = type;
    }

    const identifiers = await prisma.assetIdentifier.findMany({
      where: where as any,
      include: {
        asset: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return identifiers;
  });

  // 19. GET /identifiers/lookup/:value — Lookup asset by identifier value
  app.get('/identifiers/lookup/:value', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'Lookup entity by identifier value',
      description: 'Find an entity by scanning or entering an identifier value (QR, barcode, RFID, etc.).',
      params: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string', description: 'The identifier value to look up' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { value } = req.params as { value: string };

    const identifier = await prisma.assetIdentifier.findUnique({
      where: { identifierValue: value },
      include: {
        asset: {
          include: {
            template: {
              select: {
                id: true, name: true, icon: true,
                attributeSchema: true,
              },
            },
            parent: { select: { id: true, name: true } },
            identifiers: true,
          },
        },
      },
    });

    if (!identifier) {
      return reply.code(404).send({ error: 'Identifier not found' });
    }

    return identifier;
  });

  // 20. POST /identifiers — Create identifier
  app.post('/identifiers', {
    preHandler: [app.requirePermission('ASSET_IDENTIFIER_MANAGE')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'Create entity identifier',
      description: 'Attach a physical identifier (QR, barcode, RFID, NFC, manual) to an entity.',
      body: {
        type: 'object',
        required: ['assetId', 'identifierType', 'identifierValue'],
        properties: {
          assetId: { type: 'string', format: 'uuid' },
          identifierType: { type: 'string' },
          identifierValue: { type: 'string' },
          label: { type: 'string' },
          isPrimary: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ASSET_IDENTIFIER', req, reply);
    if (!ok) return;

    const parsed = createAssetIdentifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    // Verify asset exists
    const asset = await prisma.assetInstance.findUnique({ where: { id: parsed.data.assetId } });
    if (!asset) {
      return reply.code(400).send({ error: 'Entity instance not found' });
    }

    // Check unique value
    const existingIdent = await prisma.assetIdentifier.findUnique({
      where: { identifierValue: parsed.data.identifierValue },
    });
    if (existingIdent) {
      return reply.code(409).send({ error: 'Identifier value already exists' });
    }

    const identifier = await prisma.assetIdentifier.create({
      data: {
        assetId: parsed.data.assetId,
        identifierType: parsed.data.identifierType,
        identifierValue: parsed.data.identifierValue,
        label: parsed.data.label,
        isPrimary: parsed.data.isPrimary,
        createdBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_IDENTIFIER_CREATED',
      targetType: 'asset_identifier',
      targetId: identifier.id,
      afterValue: identifier,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send({ success: true, data: identifier });
  });

  // 21. DELETE /identifiers/:id — Delete identifier
  app.delete('/identifiers/:id', {
    preHandler: [app.requirePermission('ASSET_IDENTIFIER_MANAGE')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'Delete entity identifier',
      description: 'Remove a physical identifier from an entity.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_ASSET_IDENTIFIER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const existing = await prisma.assetIdentifier.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Identifier not found' });
    }

    await prisma.assetIdentifier.delete({ where: { id } });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ASSET_IDENTIFIER_DELETED',
      targetType: 'asset_identifier',
      targetId: id,
      beforeValue: {
        assetId: existing.assetId,
        identifierType: existing.identifierType,
        identifierValue: existing.identifierValue,
      },
      afterValue: { deleted: true },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

}
