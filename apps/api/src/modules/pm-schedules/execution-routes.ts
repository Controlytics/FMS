/**
 * PM Execution Routes — Start/complete PM executions.
 */
import type { FastifyInstance } from 'fastify';
import { PmScheduleService } from './pm-schedule.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function pmExecutionRoutes(app: FastifyInstance) {
  const service = new PmScheduleService();

  app.post('/', {
    preHandler: [app.requirePermission('PM_EXECUTE')],
    schema: {
      tags: ['PM Executions'],
      summary: 'Start PM execution',
      body: {
        type: 'object',
        required: ['scheduleEntryId', 'entityId'],
        properties: {
          scheduleEntryId: { type: 'string', format: 'uuid' },
          entityId: { type: 'string', format: 'uuid' },
          filterSet: { type: 'string', enum: ['SET_A', 'SET_B'] },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const result = await service.createExecution(ctx, req.body);
    return reply.code(201).send(result);
  });

  app.put('/:id', {
    preHandler: [app.requirePermission('PM_EXECUTE')],
    schema: {
      tags: ['PM Executions'],
      summary: 'Update PM execution status',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['COMPLETED', 'OVERDUE', 'MISSED'] },
          notes: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.updateExecution(ctx, id, req.body);
  });
}
