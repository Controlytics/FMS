/**
 * Filter Operations Routes — Cycle management, advance, bypass, events, cycles.
 */
import type { FastifyInstance } from 'fastify';
import { FilterOperationsService } from './filter-operations.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function filterOperationsRoutes(app: FastifyInstance) {
  const service = new FilterOperationsService();

  app.get('/:id/current-state', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Get filter current state and next actions',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getCurrentState(ctx, id);
  });

  app.post('/:id/start-cycle', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Start a new cleaning cycle',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['cleaningReasonKey'],
        properties: {
          cleaningReasonKey: { type: 'string' },
          cleaningJustification: { type: 'string' },
          cleaningAreaId: { type: 'string', format: 'uuid' },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const result = await service.startCycle(ctx, id, req.body);
    return reply.code(201).send(result);
  });

  app.post('/:id/advance', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Advance filter to next stage',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['targetState'],
        properties: {
          targetState: { type: 'string' },
          parameters: { type: 'object' },
          equipmentId: { type: 'string', format: 'uuid' },
          cleaningAreaId: { type: 'string', format: 'uuid' },
          remarks: { type: 'string' },
          checklistData: { type: 'object' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.advance(ctx, id, req.body);
  });

  app.post('/:id/bypass', {
    preHandler: [app.requirePermission('FILTER_BYPASS')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Bypass pipeline stage (deviation)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['targetState', 'justification'],
        properties: {
          targetState: { type: 'string' },
          justification: { type: 'string', minLength: 10 },
          parameters: { type: 'object' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.bypass(ctx, id, req.body);
  });
}
