/**
 * Report Template Routes — CRUD + versioning + toggle status for report templates.
 */
import type { FastifyInstance } from 'fastify';
import { ReportTemplateService } from './report-template.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';

export default async function reportTemplateRoutes(app: FastifyInstance) {
  const service = new ReportTemplateService();

  // GET / — List report templates
  app.get('/', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_READ')],
    schema: {
      tags: ['Report Templates'],
      summary: 'List report templates',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
          status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED', 'DRAFT'] },
          search: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
    const ctx = buildContext(req);
    return service.list(ctx, req.query as any);
  });

  // GET /:id — Get report template with latest config
  app.get('/:id', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_READ')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Get report template detail with latest config',
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
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getById(ctx, id);
  });

  // POST / — Create report template
  app.post('/', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_CREATE')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Create report template',
      body: {
        type: 'object',
        required: ['name', 'config'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          config: { type: 'object', additionalProperties: true },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_REPORT_TEMPLATE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const result = await service.create(ctx, req.body as any);
    return reply.code(201).send(result);
  });

  // PUT /:id — Update report template (creates new version if config changed)
  app.put('/:id', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_UPDATE')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Update report template (new version if config changed)',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          config: { type: 'object', additionalProperties: true },
          changelog: { type: 'string', maxLength: 500 },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_REPORT_TEMPLATE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body as any);
  });

  // PATCH /:id/toggle-status — Toggle ACTIVE/ARCHIVED
  app.patch('/:id/toggle-status', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_UPDATE')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Toggle report template active/archived',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: { type: 'object', additionalProperties: true },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, status: { type: 'string' } } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.toggleStatus(ctx, id);
  });

  // DELETE /:id — Delete template (only if no instances reference it)
  app.delete('/:id', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_DELETE')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Delete report template',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_REPORT_TEMPLATE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });

  // GET /:id/versions — List all versions
  app.get('/:id/versions', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_READ')],
    schema: {
      tags: ['Report Templates'],
      summary: 'List report template versions',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: { type: 'array', items: { type: 'object', additionalProperties: true } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.listVersions(ctx, id);
  });

  // GET /:id/versions/:version — Get specific version config
  app.get('/:id/versions/:version', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_READ')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Get specific template version with config',
      params: {
        type: 'object',
        required: ['id', 'version'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          version: { type: 'integer' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id, version } = req.params as { id: string; version: number };
    return service.getVersion(ctx, id, Number(version));
  });

  // POST /:id/duplicate — Duplicate template
  app.post('/:id/duplicate', {
    preHandler: [app.requirePermission('REPORT_TEMPLATE_CREATE')],
    schema: {
      tags: ['Report Templates'],
      summary: 'Duplicate report template',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_REPORT_TEMPLATE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { name } = req.body as { name: string };
    const result = await service.duplicate(ctx, id, name);
    return reply.code(201).send(result);
  });
}
