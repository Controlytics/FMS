/**
 * Filter Operations Routes — Cycle management, advance, bypass, checklist, events, cycles.
 */
import type { FastifyInstance } from 'fastify';
import { FilterOperationsService } from './filter-operations.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';

export default async function filterOperationsRoutes(app: FastifyInstance) {
  const service = new FilterOperationsService();

  app.get('/:id/current-state', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Get filter current state and next actions',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextAllowedStages: { type: 'array', items: { type: 'string' } },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pendingChecklist: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        ...errorResponses,
      },
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
          equipmentGroupId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            cycleCode: { type: 'string' },
            filterId: { type: 'string' },
            status: { type: 'string' },
            sequenceNumber: { type: 'integer' },
          },
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('START_CLEANING_CYCLE', req, reply);
    if (!ok) return;

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
          equipmentGroupId: { type: 'string', format: 'uuid' },
          instrumentReadings: { type: 'object', additionalProperties: { type: 'number' } },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextAllowedStages: { type: 'array', items: { type: 'string' } },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pendingChecklist: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.advance(ctx, id, req.body);
  });

  app.post('/:id/submit-checklist', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Submit checklist answers for current stage',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['answers'],
        properties: {
          answers: {
            type: 'object',
            additionalProperties: true,
            description: 'Map of questionId -> answer value',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextAllowedStages: { type: 'array', items: { type: 'string' } },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pendingChecklist: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.submitChecklist(ctx, id, req.body as any);
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
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextAllowedStages: { type: 'array', items: { type: 'string' } },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pendingChecklist: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('FILTER_BYPASS', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.bypass(ctx, id, req.body);
  });

  // ── Retire a filter ──
  app.post('/:id/retire', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Retire a filter permanently',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['remarks'],
        properties: { remarks: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { remarks } = req.body as { remarks: string };
    return service.retire(ctx, id, remarks);
  });

  // ── Replace a filter ──
  app.post('/:id/replace', {
    preHandler: [app.requirePermission('FILTER_OPERATE')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Replace a filter (retire old + create new)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['remarks'],
        properties: { remarks: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            oldFilterId: { type: 'string' },
            newFilterId: { type: 'string' },
            newFilterName: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { remarks } = req.body as { remarks: string };
    return service.replace(ctx, id, remarks);
  });

  // ── List retired filters ──
  app.get('/retirements', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'List all retired filters',
      response: {
        200: { type: 'array', items: { type: 'object', additionalProperties: true } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getRetirements(ctx);
  });

  // ── List replacements ──
  app.get('/replacements', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'List filter replacement history',
      response: {
        200: { type: 'array', items: { type: 'object', additionalProperties: true } },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getReplacements(ctx);
  });

  app.post('/:id/terminate-cycle', {
    preHandler: [app.requirePermission('FILTER_BYPASS')],
    schema: {
      tags: ['Filter Operations'],
      summary: 'Terminate active cleaning cycle',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['justification'], properties: { justification: { type: 'string', minLength: 10 } } },
      response: {
        200: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string', nullable: true },
            currentState: { type: 'string', nullable: true },
            currentCycle: { type: 'object', nullable: true, additionalProperties: true },
            nextAllowedStages: { type: 'array', items: { type: 'string' } },
            nextBlocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pendingChecklist: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pipelineStages: { type: 'array', items: { type: 'object', additionalProperties: true } },
            profile: { type: 'object', nullable: true, additionalProperties: true },
            filterSet: { type: 'string', nullable: true },
            totalCycles: { type: 'integer' },
            equipmentGroup: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('TERMINATE_CLEANING_CYCLE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.terminateCycle(ctx, id, req.body as { justification: string });
  });
}
