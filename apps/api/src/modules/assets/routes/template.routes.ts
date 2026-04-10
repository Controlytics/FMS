import type { FastifyInstance } from 'fastify';
import { enforceReauth } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { errorResponses } from '../../../lib/error-schemas.js';
import { createAssetTemplateValidated, updateAssetTemplateSchema, templateQuerySchema, TEMPLATE_CATEGORIES } from '@digilog/shared';
import { templateService } from '../services/template.service.js';

export default async function templateRoutes(app: FastifyInstance) {

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
                  category: { type: 'string' },
                  icon: { type: 'string' },
                  version: { type: 'integer' },
                  attributeSchema: { type: 'array' },
                  telemetrySchema: { type: 'array' },
                  expectedIdentifiers: { type: 'array' },
                  expectedRelationships: { type: 'array' },
                  statusLifecycle: { type: 'array' },
                  alarmRules: { type: 'array' },
                  checklistSchema: { type: 'array' },
                  maxParentConnections: { type: 'integer' },
                  maxConnections: { type: 'integer' },
                  dataIngestionEnabled: { type: 'boolean' },
                  transportType: { type: ['string', 'null'] },
                  credentialType: { type: 'string' },
                  inactivityTimeout: { type: 'integer' },
                  defaultMaxDataRate: { type: 'integer' },
                  autoProvision: { type: 'boolean' },
                  defaultRuleChainId: { type: ['string', 'null'] },
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

    // Inject assignment visibility filter for templates
    const role = req.user?.role;
    const orgId = req.user?.organizationId;
    const userId = req.user?.sub;

    let visibilityFilter: Record<string, unknown> | undefined;

    if (role === "SUPER_ADMIN" || role === "ADMIN") {
      // No filter — see all templates
    } else {
      // Check if user has explicit template assignments
      const { prisma } = await import("../../../lib/prisma.js");
      const templateAssignments = await prisma.templateAssignment.findMany({
        where: {
          OR: [
            { assigneeType: "ORGANIZATION", organizationId: orgId },
            { assigneeType: "USER", userId },
          ],
        },
        select: { templateId: true },
      });

      const assignedIds = templateAssignments.map((a: any) => a.templateId);
      if (assignedIds.length > 0) {
        // User has explicit assignments — show only those
        visibilityFilter = { id: { in: assignedIds } };
      }
      // If no assignments exist, show all templates (user already passed permission check)
      // Templates are blueprints — visibility is gated by permissions, not assignments
    }
    return templateService.list(query, visibilityFilter);
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
            checklistSchema: { type: 'array' },
            maxParentConnections: { type: 'integer' },
            maxConnections: { type: 'integer' },
            dataIngestionEnabled: { type: 'boolean' },
            transportType: { type: ['string', 'null'] },
            credentialType: { type: 'string' },
            inactivityTimeout: { type: 'integer' },
            defaultMaxDataRate: { type: 'integer' },
            autoProvision: { type: 'boolean' },
            defaultRuleChainId: { type: ['string', 'null'] },
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
  }, async (req) => {
    const { id } = req.params as { id: string };
    return templateService.getById(id);
  });

  // 3. POST /templates — Create template
  app.post('/templates', {
    preHandler: [app.requirePermission('ASSET_TEMPLATE_CREATE')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Create entity template',
      description: 'Create a new entity template. Auto-creates version 1 snapshot. Requires ASSET_TEMPLATE_CREATE permission.',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string', enum: ['General', 'Equipment', 'Room', 'Building', 'Sensor', 'Vehicle', 'Utility', 'Process', 'Storage', 'Laboratory'], description: 'Template category' },
          icon: { type: 'string' },
          attributeSchema: { type: 'array' },
          expectedIdentifiers: { type: 'array' },
          expectedRelationships: { type: 'array', description: 'Expected relationship type definitions' },
          statusLifecycle: { type: 'array', description: 'Status definitions with transitions' },
          alarmRules: { type: 'array' },
          checklistSchema: { type: 'array', description: 'Checklist question definitions' },
          maxParentConnections: { type: 'integer', description: 'Number of Parent Connections: 0=not allowed, 1=single parent only, 2+=multiple parents' },
          maxConnections: { type: 'integer', description: 'Max total connections (all types): 0=unlimited, N=limit' },
          dataIngestionEnabled: { type: 'boolean', description: 'Enable data ingestion for entities of this template' },
          transportType: { oneOf: [{ type: 'string', enum: ['MQTT', 'HTTP', 'WEBSOCKET'] }, { type: 'null' }], description: 'Transport protocol' },
          credentialType: { type: 'string', enum: ['TOKEN', 'BASIC', 'X509'], description: 'Device credential type' },
          inactivityTimeout: { type: 'integer', description: 'Inactivity timeout in seconds before marking device offline' },
          defaultMaxDataRate: { type: 'integer', description: 'Max messages per rate-limit window' },
          autoProvision: { type: 'boolean', description: 'Auto-create device credentials on first connect' },
          defaultRuleChainId: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }], description: 'Default rule chain for processing' },
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

    const parsed = createAssetTemplateValidated.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const template = await templateService.create(parsed.data, buildContext(req));
    return reply.code(201).send({ success: true, data: template });
  });

  // 4. PUT /templates/:id — Update template
  app.put('/templates/:id', {
    preHandler: [app.requirePermission('ASSET_TEMPLATE_UPDATE')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Update entity template',
      description: 'Update an entity template. Increments version and creates a new version snapshot. Requires ASSET_TEMPLATE_UPDATE permission.',
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
          category: { type: 'string', enum: ['General', 'Equipment', 'Room', 'Building', 'Sensor', 'Vehicle', 'Utility', 'Process', 'Storage', 'Laboratory'], description: 'Template category' },
          icon: { type: 'string' },
          attributeSchema: { type: 'array' },
          expectedIdentifiers: { type: 'array' },
          expectedRelationships: { type: 'array', description: 'Expected relationship type definitions' },
          statusLifecycle: { type: 'array', description: 'Status definitions with transitions' },
          alarmRules: { type: 'array' },
          checklistSchema: { type: 'array', description: 'Checklist question definitions' },
          maxParentConnections: { type: 'integer', description: 'Number of Parent Connections: 0=not allowed, 1=single parent only, 2+=multiple parents' },
          maxConnections: { type: 'integer', description: 'Max total connections (all types): 0=unlimited, N=limit' },
          dataIngestionEnabled: { type: 'boolean', description: 'Enable data ingestion for entities of this template' },
          transportType: { oneOf: [{ type: 'string', enum: ['MQTT', 'HTTP', 'WEBSOCKET'] }, { type: 'null' }], description: 'Transport protocol' },
          credentialType: { type: 'string', enum: ['TOKEN', 'BASIC', 'X509'], description: 'Device credential type' },
          inactivityTimeout: { type: 'integer', description: 'Inactivity timeout in seconds before marking device offline' },
          defaultMaxDataRate: { type: 'integer', description: 'Max messages per rate-limit window' },
          autoProvision: { type: 'boolean', description: 'Auto-create device credentials on first connect' },
          defaultRuleChainId: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }], description: 'Default rule chain for processing' },
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

    const template = await templateService.update(id, parsed.data, buildContext(req));
    return { success: true, data: template };
  });

  // 5. DELETE /templates/:id — Soft-delete (set isActive=false)
  app.delete('/templates/:id', {
    preHandler: [app.requirePermission('ASSET_TEMPLATE_DELETE')],
    schema: {
      tags: ['Entity Templates'],
      summary: 'Soft-delete entity template',
      description: 'Set isActive=false on an entity template. Requires ASSET_TEMPLATE_DELETE permission.',
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
    await templateService.delete(id, buildContext(req));
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
  }, async (req) => {
    const { id } = req.params as { id: string };
    return templateService.getVersions(id);
  });
}
