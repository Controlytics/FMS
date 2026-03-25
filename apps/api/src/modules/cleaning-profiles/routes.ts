/**
 * Cleaning Profile Routes — CRUD + validate + simulate for filter cleaning profiles.
 */
import type { FastifyInstance } from 'fastify';
import { CleaningProfileService } from './cleaning-profile.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function cleaningProfileRoutes(app: FastifyInstance) {
  const service = new CleaningProfileService();

  // GET / — List cleaning profiles
  app.get('/', {
    preHandler: [app.requirePermission('FCP_READ')],
    schema: {
      tags: ['Cleaning Profiles'],
      summary: 'List cleaning profiles',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
          status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] },
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

  // GET /:id — Get cleaning profile with stages and connections
  app.get('/:id', {
    preHandler: [app.requirePermission('FCP_READ')],
    schema: {
      tags: ['Cleaning Profiles'],
      summary: 'Get cleaning profile detail',
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

  // POST / — Create cleaning profile
  app.post('/', {
    preHandler: [app.requirePermission('FCP_CREATE')],
    schema: {
      tags: ['Cleaning Profiles'],
      summary: 'Create cleaning profile',
      body: {
        type: 'object',
        required: ['name', 'stages'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
          flowMode: { type: 'string', enum: ['STRICT', 'BYPASS_ENABLED'] },
          alarmOnForwardSkip: { type: 'boolean' },
          alarmOnBackwardJump: { type: 'boolean' },
          alarmOnOutOfSequence: { type: 'boolean' },
          cleaningReasons: { type: 'array', nullable: true },
          stages: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              required: ['nodeType'],
              properties: {
                stateKey: { type: 'string', nullable: true },
                nodeType: { type: 'string' },
                configuration: { type: 'object' },
                positionX: { type: 'number' },
                positionY: { type: 'number' },
                sortOrder: { type: 'integer' },
              },
            },
          },
          connections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fromIndex: { type: 'integer' },
                toIndex: { type: 'integer' },
                fromStageId: { type: 'string' },
                toStageId: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const result = await service.create(ctx, req.body);
    return reply.code(201).send(result);
  });

  // PUT /:id — Update (creates new version)
  app.put('/:id', {
    preHandler: [app.requirePermission('FCP_UPDATE')],
    schema: {
      tags: ['Cleaning Profiles'],
      summary: 'Update cleaning profile (new version)',
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
          flowMode: { type: 'string', enum: ['STRICT', 'BYPASS_ENABLED'] },
          alarmOnForwardSkip: { type: 'boolean' },
          alarmOnBackwardJump: { type: 'boolean' },
          alarmOnOutOfSequence: { type: 'boolean' },
          cleaningReasons: { type: 'array', nullable: true },
          stages: { type: 'array' },
          connections: { type: 'array' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body);
  });

  // DELETE /:id — Archive
  app.delete('/:id', {
    preHandler: [app.requirePermission('FCP_DELETE')],
    schema: {
      tags: ['Cleaning Profiles'],
      summary: 'Archive cleaning profile',
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
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.archive(ctx, id);
  });

  // POST /:id/validate — Validate pipeline
  app.post('/:id/validate', {
    preHandler: [app.requirePermission('FCP_READ')],
    schema: {
      tags: ['Cleaning Profiles'],
      summary: 'Validate pipeline structure',
      body: {
        type: 'object',
        properties: {
          stages: { type: 'array' },
          connections: { type: 'array' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.validate(ctx, req.body);
  });
}
