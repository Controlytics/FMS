import type { FastifyInstance } from 'fastify';
import { enforceReauth } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { errorResponses } from '../../../lib/error-schemas.js';
import { createAssetIdentifierSchema } from '@digilog/shared';
import { identifierService } from '../services/identifier.service.js';

export default async function identifierRoutes(app: FastifyInstance) {

  // 18. GET /identifiers — List identifiers
  app.get('/identifiers', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'List entity identifiers',
      description: 'List identifiers with optional filter by entity ID and type.',
      querystring: {
        type: 'object',
        properties: {
          assetId: { type: 'string', format: 'uuid', description: 'Filter by entity ID' },
          type: { type: 'string', description: 'Filter by identifier type' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              assetId: { type: 'string' },
              identifierType: { type: 'string' },
              identifierValue: { type: 'string' },
              label: { type: 'string' },
              isPrimary: { type: 'boolean' },
              createdAt: { type: 'string' },
              asset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { assetId, type } = req.query as { assetId?: string; type?: string };
    return identifierService.list({ assetId, type });
  });

  // 19. GET /identifiers/lookup/:value — Lookup asset by identifier value
  app.get('/identifiers/lookup/:value', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'Lookup entity by identifier value',
      description: 'Find an entity by scanning or entering an identifier value (QR, barcode, RFID, etc.).',
      params: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string', description: 'The identifier value to look up' } },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { value } = req.params as { value: string };
    return identifierService.lookupByValue(value);
  });

  // 20. POST /identifiers — Create identifier
  app.post('/identifiers', {
    preHandler: [app.requirePermission('ASSET_IDENTIFIER_MANAGE')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'Create entity identifier',
      description: 'Attach a physical identifier (QR, barcode, RFID, NFC, manual) to an entity.',
      body: {
        type: 'object',
        required: ['assetId', 'identifierType', 'identifierValue'],
        properties: {
          assetId: { type: 'string', format: 'uuid' },
          identifierType: { type: 'string' },
          identifierValue: { type: 'string' },
          label: { type: 'string' },
          isPrimary: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ASSET_IDENTIFIER', req, reply);
    if (!ok) return;

    const parsed = createAssetIdentifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const identifier = await identifierService.create(parsed.data, buildContext(req));
    return reply.code(201).send({ success: true, data: identifier });
  });

  // 21. DELETE /identifiers/:id — Delete identifier
  app.delete('/identifiers/:id', {
    preHandler: [app.requirePermission('ASSET_IDENTIFIER_MANAGE')],
    schema: {
      tags: ['Entity Identifiers'],
      summary: 'Delete entity identifier',
      description: 'Remove a physical identifier from an entity.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_ASSET_IDENTIFIER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    await identifierService.delete(id, buildContext(req));
    return { success: true };
  });
}
