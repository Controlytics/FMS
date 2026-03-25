/**
 * Filter Events & Cleaning Cycles Routes — Query events, cycles, reasons.
 */
import type { FastifyInstance } from 'fastify';
import { FilterOperationsService } from './filter-operations.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function filterEventsRoutes(app: FastifyInstance) {
  const service = new FilterOperationsService();

  app.get('/events', {
    preHandler: [app.requirePermission('EVENT_READ')],
    schema: {
      tags: ['Filter Events'],
      summary: 'List filter events',
      querystring: {
        type: 'object',
        properties: {
          filterId: { type: 'string', format: 'uuid' },
          cycleId: { type: 'string', format: 'uuid' },
          eventType: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
      response: { 200: { type: 'object', properties: { data: { type: 'array' }, total: { type: 'integer' } } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getEvents(ctx, req.query);
  });

  app.get('/cycles', {
    preHandler: [app.requirePermission('CYCLE_READ')],
    schema: {
      tags: ['Cleaning Cycles'],
      summary: 'List cleaning cycles',
      querystring: {
        type: 'object',
        properties: {
          filterId: { type: 'string', format: 'uuid' },
          ahuId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['IN_PROGRESS', 'COMPLETED', 'TERMINATED'] },
          cleaningReasonKey: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
      response: { 200: { type: 'object', properties: { data: { type: 'array' }, total: { type: 'integer' } } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getCycles(ctx, req.query);
  });

  app.get('/cycles/:id', {
    preHandler: [app.requirePermission('CYCLE_READ')],
    schema: {
      tags: ['Cleaning Cycles'],
      summary: 'Get cleaning cycle detail with events',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getCycleById(ctx, id);
  });

  app.get('/reasons', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Get cleaning reasons',
      querystring: {
        type: 'object',
        properties: {
          profileId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 200: { type: 'object', properties: { reasons: { type: 'array' } } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { profileId } = req.query as { profileId?: string };
    const reasons = await service.getCleaningReasons(profileId);
    return { reasons };
  });
}
