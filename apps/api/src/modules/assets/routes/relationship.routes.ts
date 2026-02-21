import type { FastifyInstance } from 'fastify';
import { enforceReauth } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { errorResponses } from '../../../lib/error-schemas.js';
import { createAssetRelationshipSchema } from '@digilog/shared';
import { relationshipService } from '../services/relationship.service.js';

export default async function relationshipRoutes(app: FastifyInstance) {

  // 15. GET /relationships — List relationships
  app.get('/relationships', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Entity Relationships'],
      summary: 'List entity relationships',
      description: 'List relationships with optional filter by entity ID (source or target) and type.',
      querystring: {
        type: 'object',
        properties: {
          assetId: { type: 'string', format: 'uuid', description: 'Filter by source or target entity ID' },
          type: { type: 'string', description: 'Filter by relationship type' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              sourceAssetId: { type: 'string' },
              targetAssetId: { type: 'string' },
              relationshipType: { type: 'string' },
              customLabel: { type: 'string' },
              notes: { type: 'string' },
              createdAt: { type: 'string' },
              sourceAsset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
              targetAsset: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { assetId, type } = req.query as { assetId?: string; type?: string };
    return relationshipService.list({ assetId, type });
  });

  // 16. POST /relationships — Create relationship + auto-create inverse
  app.post('/relationships', {
    preHandler: [app.requirePermission('ASSET_RELATIONSHIP_MANAGE')],
    schema: {
      tags: ['Entity Relationships'],
      summary: 'Create entity relationship',
      description: 'Create a relationship between two entities and auto-create the inverse relationship. Validates no self-referencing, no duplicates, and no CONTAINS cycles.',
      body: {
        type: 'object',
        required: ['sourceAssetId', 'targetAssetId', 'relationshipType'],
        properties: {
          sourceAssetId: { type: 'string', format: 'uuid' },
          targetAssetId: { type: 'string', format: 'uuid' },
          relationshipType: { type: 'string' },
          customLabel: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
            inverse: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ASSET_RELATIONSHIP', req, reply);
    if (!ok) return;

    const parsed = createAssetRelationshipSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const result = await relationshipService.create(parsed.data, buildContext(req));
    return reply.code(201).send({
      success: true,
      data: result.relationship,
      inverse: result.inverse,
      connectionInfo: result.connectionInfo,
    });
  });

  // 17. DELETE /relationships/:id — Delete relationship + its inverse
  app.delete('/relationships/:id', {
    preHandler: [app.requirePermission('ASSET_RELATIONSHIP_MANAGE')],
    schema: {
      tags: ['Entity Relationships'],
      summary: 'Delete entity relationship and its inverse',
      description: 'Delete an entity relationship and automatically delete its inverse relationship.',
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
    const { ok } = await enforceReauth('DELETE_ASSET_RELATIONSHIP', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    await relationshipService.delete(id, buildContext(req));
    return { success: true };
  });
}
