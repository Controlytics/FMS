/**
 * Equipment Groups Routes — CRUD for equipment groups assigned to blocks.
 */
import type { FastifyInstance } from 'fastify';
import { EquipmentGroupsService } from './equipment-groups.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';

const instrumentSchema = {
  type: 'object' as const,
  required: ['instrumentId', 'uom', 'instrumentMin', 'instrumentMax', 'operatingMin', 'operatingMax', 'leastCount'],
  properties: {
    serialNumber: { type: 'string' as const },
    instrumentId: { type: 'string' as const },
    uom: { type: 'string' as const },
    instrumentMin: { type: 'number' as const },
    instrumentMax: { type: 'number' as const },
    operatingMin: { type: 'number' as const },
    operatingMax: { type: 'number' as const },
    leastCount: { type: 'number' as const },
  },
};

export default async function equipmentGroupRoutes(app: FastifyInstance) {
  const service = new EquipmentGroupsService();

  app.get('/', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'List equipment groups',
      querystring: {
        type: 'object',
        properties: { blockId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { blockId } = req.query as { blockId?: string };
    return service.list(ctx, blockId);
  });

  app.get('/:id', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Get equipment group by ID',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getById(ctx, id);
  });

  app.get('/by-block/:blockId', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Get equipment groups for a block',
      params: { type: 'object', required: ['blockId'], properties: { blockId: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { blockId } = req.params as { blockId: string };
    return service.getByBlock(ctx, blockId);
  });

  app.post('/', {
    preHandler: [app.requirePermission('ASSET_CREATE')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Create equipment group with 3 instruments',
      body: {
        type: 'object',
        required: ['name', 'blockId', 'instruments'],
        properties: {
          name: { type: 'string' },
          blockId: { type: 'string', format: 'uuid' },
          instruments: { type: 'array', items: instrumentSchema, minItems: 3, maxItems: 3 },
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
    preHandler: [app.requirePermission('ASSET_UPDATE')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Update equipment group and instruments',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['instruments'],
        properties: {
          name: { type: 'string' },
          instruments: { type: 'array', items: instrumentSchema, minItems: 3, maxItems: 3 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body);
  });

  app.delete('/:id', {
    preHandler: [app.requirePermission('ASSET_DELETE')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Delete (deactivate) equipment group',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });
}
