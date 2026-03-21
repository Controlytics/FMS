import type { FastifyInstance } from 'fastify';
import { enforceReauth } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { errorResponses } from '../../../lib/error-schemas.js';
import { createAssetInstanceSchema, updateAssetInstanceSchema, assetQuerySchema } from '@digilog/shared';
import { instanceService } from '../services/instance.service.js';

export default async function instanceRoutes(app: FastifyInstance) {

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
          limit: { type: 'integer' },
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

    // Inject tenant/assignment visibility filter
    const role = req.user?.role;
    const tenantId = req.user?.tenantId;
    const orgId = req.user?.organizationId;
    const userId = req.user?.sub;

    let visibilityFilter: Record<string, unknown> | undefined;

    if (role === "SUPER_ADMIN") {
      // No filter — sees all
    } else if (role === "TENANT_ADMIN" || role === "ADMIN") {
      visibilityFilter = { tenantId };
    } else {
      // Org-scoped users: only see assigned entities
      const { prisma } = await import("../../../lib/prisma.js");

      // Get entity IDs from entity assignments (org + user + role)
      const entityAssignments = await prisma.entityAssignment.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          OR: [
            { assigneeType: "ORGANIZATION", organizationId: orgId },
            { assigneeType: "USER", userId },
            { assigneeType: "ROLE", roleValue: role },
          ],
        },
        select: { entityId: true },
      });

      // Get template IDs from template assignments (org + user)
      const templateAssignments = await prisma.templateAssignment.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          OR: [
            { assigneeType: "ORGANIZATION", organizationId: orgId },
            { assigneeType: "USER", userId },
          ],
        },
        select: { templateId: true },
      });

      const assignedEntityIds = entityAssignments.map((a: any) => a.entityId);
      const assignedTemplateIds = templateAssignments.map((a: any) => a.templateId);

      visibilityFilter = {
        ...(tenantId ? { tenantId } : {}),
        OR: [
          ...(orgId ? [{ organizationId: orgId }] : []),
          ...(assignedEntityIds.length > 0 ? [{ id: { in: assignedEntityIds } }] : []),
          ...(assignedTemplateIds.length > 0 ? [{ templateId: { in: assignedTemplateIds } }] : []),
        ],
      };

      // If no assignments at all, return empty
      if (!orgId && assignedEntityIds.length === 0 && assignedTemplateIds.length === 0) {
        return { data: [], total: 0, page: query.page, limit: query.limit ?? 0, totalPages: 0 };
      }
    }

    return instanceService.list(query, visibilityFilter);
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
  }, async (req) => {
    // Inject same visibility filter for tree
    const role = req.user?.role;
    const tenantId = req.user?.tenantId;
    const orgId = req.user?.organizationId;
    const userId = req.user?.sub;

    if (role === "SUPER_ADMIN") {
      return instanceService.getTree();
    } else if (role === "TENANT_ADMIN" || role === "ADMIN") {
      return instanceService.getTree({ tenantId });
    } else {
      const { prisma } = await import("../../../lib/prisma.js");
      const entityAssignments = await prisma.entityAssignment.findMany({
        where: { ...(tenantId ? { tenantId } : {}), OR: [
          { assigneeType: "ORGANIZATION", organizationId: orgId },
          { assigneeType: "USER", userId },
          { assigneeType: "ROLE", roleValue: role },
        ]},
        select: { entityId: true },
      });
      const templateAssignments = await prisma.templateAssignment.findMany({
        where: { ...(tenantId ? { tenantId } : {}), OR: [
          { assigneeType: "ORGANIZATION", organizationId: orgId },
          { assigneeType: "USER", userId },
        ]},
        select: { templateId: true },
      });
      const eIds = entityAssignments.map((a: any) => a.entityId);
      const tIds = templateAssignments.map((a: any) => a.templateId);
      const orConditions: any[] = [];
      if (orgId) orConditions.push({ organizationId: orgId });
      if (eIds.length) orConditions.push({ id: { in: eIds } });
      if (tIds.length) orConditions.push({ templateId: { in: tIds } });
      if (orConditions.length === 0) return [];
      return instanceService.getTree({ ...(tenantId ? { tenantId } : {}), OR: orConditions });
    }
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
        200: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return instanceService.getById(id);
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

    const instance = await instanceService.create(parsed.data, buildContext(req));
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

    const instance = await instanceService.update(id, parsed.data, buildContext(req));
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
    const instance = await instanceService.changeStatus(id, body.status, buildContext(req));
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
    const deactivatedCount = await instanceService.delete(id, buildContext(req));
    return { success: true, deactivatedCount };
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
  }, async (req) => {
    const { id } = req.params as { id: string };
    return instanceService.getChildren(id);
  });
}
