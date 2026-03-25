/**
 * Filter Profile Routes — CRUD + assign for filter profiles.
 */
import type { FastifyInstance } from 'fastify';
import { FilterProfileService } from './filter-profile.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function filterProfileRoutes(app: FastifyInstance) {
  const service = new FilterProfileService();

  app.get('/', {
    preHandler: [app.requirePermission('FP_READ')],
    schema: {
      tags: ['Filter Profiles'],
      summary: 'List filter profiles',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
      response: {
        200: { type: 'object', properties: { data: { type: 'array' }, total: { type: 'integer' } } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.list(ctx, req.query as any);
  });

  app.get('/:id', {
    preHandler: [app.requirePermission('FP_READ')],
    schema: {
      tags: ['Filter Profiles'],
      summary: 'Get filter profile detail',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getById(ctx, id);
  });

  app.post('/', {
    preHandler: [app.requirePermission('FP_CREATE')],
    schema: {
      tags: ['Filter Profiles'],
      summary: 'Create filter profile',
      body: {
        type: 'object',
        required: ['name', 'cleaningProfileId'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
          cleaningProfileId: { type: 'string', format: 'uuid' },
          applicableTemplates: { type: 'array', items: { type: 'string' } },
          blockRestriction: { type: 'string', enum: ['OWN_BLOCK_ONLY', 'ANY_BLOCK', 'SPECIFIC_BLOCKS'] },
          allowedBlocks: { type: 'array', nullable: true },
          maxCleaningCycles: { type: 'integer', nullable: true },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const result = await service.create(ctx, req.body);
    return reply.code(201).send(result);
  });

  app.put('/:id', {
    preHandler: [app.requirePermission('FP_UPDATE')],
    schema: {
      tags: ['Filter Profiles'],
      summary: 'Update filter profile',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          cleaningProfileId: { type: 'string' },
          applicableTemplates: { type: 'array' },
          blockRestriction: { type: 'string' },
          allowedBlocks: { type: 'array', nullable: true },
          maxCleaningCycles: { type: 'integer', nullable: true },
          isActive: { type: 'boolean' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body);
  });

  app.post('/:id/assign', {
    preHandler: [app.requirePermission('FP_ASSIGN')],
    schema: {
      tags: ['Filter Profiles'],
      summary: 'Assign filter profile to filter instances',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['filterInstanceIds'],
        properties: {
          filterInstanceIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, assignedCount: { type: 'integer' } } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { filterInstanceIds } = req.body as { filterInstanceIds: string[] };
    return service.assign(ctx, id, filterInstanceIds);
  });
}
