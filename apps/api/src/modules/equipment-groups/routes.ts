/**
 * Equipment Groups Routes — CRUD for equipment groups assigned to blocks.
 */
import type { FastifyInstance } from 'fastify';
import { EquipmentGroupsService } from './equipment-groups.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';

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
    // Auto-fetch (2026-06-13): MUST be listed here or Fastify strips them from
    // the request body before the service sees them.
    url: { type: 'string' as const },
    autoFetchEnabled: { type: 'boolean' as const },
  },
};

export default async function equipmentGroupRoutes(app: FastifyInstance) {
  const service = new EquipmentGroupsService();

  app.get('/', {
    preHandler: [app.requireAnyPermission('ASSET_READ', 'EG_VIEW', 'VERSION_HISTORY_VIEW')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'List equipment groups',
      querystring: {
        type: 'object',
        properties: {
          blockId: { type: 'string', format: 'uuid' },
          includeInactive: { type: 'boolean' },
        },
      },
      response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { blockId, includeInactive } = req.query as { blockId?: string; includeInactive?: boolean };
    return service.list(ctx, blockId, includeInactive === true);
  });

  app.get('/:id', {
    preHandler: [app.requireAnyPermission('ASSET_READ', 'EG_VIEW', 'VERSION_HISTORY_VIEW')],
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

  // Phase A.4: list archived versions for audit replay / admin history.
  app.get('/:id/versions', {
    preHandler: [app.requireAnyPermission('ASSET_READ', 'EG_VIEW', 'VERSION_HISTORY_VIEW')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'List archived versions of an equipment group (Phase A.4)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getVersions(ctx, id);
  });

  // Phase A.4: read a frozen historical version of an equipment group composite.
  app.get('/:id/versions/:versionNumber', {
    preHandler: [app.requireAnyPermission('ASSET_READ', 'EG_VIEW', 'VERSION_HISTORY_VIEW')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Get frozen snapshot of equipment group at a specific version (Phase A.4)',
      params: {
        type: 'object',
        required: ['id', 'versionNumber'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          versionNumber: { type: 'integer', minimum: 1 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { id, versionNumber } = req.params as { id: string; versionNumber: number };
    return service.getVersion(ctx, id, Number(versionNumber));
  });

  app.get('/by-block/:blockId', {
    preHandler: [app.requireAnyPermission('ASSET_READ', 'EG_VIEW')],
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
    preHandler: [app.requireAnyPermission('ASSET_CREATE', 'EG_CREATE')],
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
    const { ok } = await enforceReauth('CREATE_EQUIPMENT_GROUP', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const result = await service.create(ctx, req.body);
    return reply.code(201).send(result);
  });

  app.put('/:id', {
    preHandler: [app.requireAnyPermission('ASSET_UPDATE', 'EG_EDIT')],
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
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_EQUIPMENT_GROUP', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body);
  });

  // Enable / disable a group. Enabling flips every other group in the same
  // block off (single-active-group-per-block invariant — see service.setActive).
  app.patch('/:id/active', {
    preHandler: [app.requireAnyPermission('ASSET_UPDATE', 'EG_EDIT')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Enable or disable an equipment group',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['isActive'],
        properties: { isActive: { type: 'boolean' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_EQUIPMENT_GROUP', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const { isActive } = req.body as { isActive: boolean };
    return service.setActive(ctx, id, isActive);
  });

  app.delete('/:id', {
    preHandler: [app.requireAnyPermission('ASSET_DELETE', 'EG_DELETE')],
    schema: {
      tags: ['Equipment Groups'],
      summary: 'Delete (deactivate) equipment group',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_EQUIPMENT_GROUP', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });
}
