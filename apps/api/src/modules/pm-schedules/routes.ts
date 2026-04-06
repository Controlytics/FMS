/**
 * PM Schedule Routes — CRUD + CSV upload + execution tracking.
 */
import type { FastifyInstance } from 'fastify';
import { PmScheduleService } from './pm-schedule.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function pmScheduleRoutes(app: FastifyInstance) {
  const service = new PmScheduleService();

  app.get('/:entityId', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Get active PM schedule for an entity',
      params: { type: 'object', required: ['entityId'], properties: { entityId: { type: 'string', format: 'uuid' } } },
      querystring: { type: 'object', properties: { year: { type: 'integer' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { entityId } = req.params as { entityId: string };
    const { year } = req.query as { year?: number };
    return service.getByEntity(ctx, entityId, year);
  });

  app.post('/', {
    preHandler: [app.requirePermission('PM_CREATE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Create PM schedule',
      body: {
        type: 'object',
        required: ['entityId', 'year', 'entries'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          year: { type: 'integer' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['month', 'plannedDate'],
              properties: {
                month: { type: 'integer', minimum: 1, maximum: 12 },
                plannedDate: { type: 'string', format: 'date' },
                toleranceDays: { type: 'integer', minimum: 0 },
                notes: { type: 'string' },
              },
            },
          },
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
    preHandler: [app.requirePermission('PM_UPDATE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Update PM schedule (new version)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', properties: { entries: { type: 'array' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body);
  });

  app.delete('/:id', {
    preHandler: [app.requirePermission('PM_DELETE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Delete PM schedule',
      description: 'Deletes a PM schedule and its entries. Fails if executions are in progress.',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });

  app.get('/:entityId/history', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Get PM schedule version history',
      params: { type: 'object', required: ['entityId'], properties: { entityId: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { entityId } = req.params as { entityId: string };
    return service.getHistory(ctx, entityId);
  });
}
