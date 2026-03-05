import type { FastifyInstance } from 'fastify';
import { errorResponses } from '../../lib/error-schemas.js';
import {
  provisionUnsMapping,
  removeUnsMapping,
  generateMoveImpact,
  confirmCascadeMove,
  searchByWildcard,
  buildUnsTree,
} from './uns.service.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { enforceReauth } from '../../lib/reauth-check.js';

export default async function unsRoutes(app: FastifyInstance) {
  // GET /tree — Full UNS tree (hierarchical view)
  app.get('/tree', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR')],
    schema: {
      tags: ['UNS'],
      summary: 'Get full UNS tree',
      description: 'Returns the complete Unified Namespace tree in hierarchical format. Requires SUPER_ADMIN, ADMIN, or SUPERVISOR role.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    return buildUnsTree();
  });

  // GET /entity/:entityId — Get entity's UNS mapping
  app.get('/entity/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['UNS'],
      summary: 'Get entity UNS mapping',
      description: 'Retrieve the UNS mapping for a specific entity by its ID. Requires ASSET_VIEW permission.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            entityId: { type: 'string' },
            unsPath: { type: 'string' },
            isOverridden: { type: 'boolean' },
            entityName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    const mapping = await prisma.unsMapping.findUnique({
      where: { entityId },
    });

    if (!mapping) {
      return reply.code(404).send({ error: 'UNS mapping not found for this entity' });
    }

    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { name: true },
    });

    return {
      id: mapping.id,
      entityId: mapping.entityId,
      unsPath: mapping.unsPath,
      isOverridden: mapping.isOverridden,
      entityName: entity?.name ?? null,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    };
  });

  // PUT /entity/:entityId — Override UNS path (manual override)
  app.put('/entity/:entityId', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['UNS'],
      summary: 'Override entity UNS path',
      description: 'Manually override the UNS path for an entity. Sets isOverridden to true. Requires SUPER_ADMIN role.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID' },
        },
      },
      body: {
        type: 'object',
        required: ['unsPath'],
        properties: {
          unsPath: { type: 'string', description: 'New UNS path to set' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            entityId: { type: 'string' },
            unsPath: { type: 'string' },
            isOverridden: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('OVERRIDE_UNS_PATH', req, reply);
    if (!ok) return;

    const { entityId } = req.params as { entityId: string };
    const { unsPath } = req.body as { unsPath: string };
    const user = (req as any).user as { username: string; role: string };

    const existing = await prisma.unsMapping.findUnique({ where: { entityId } });
    if (!existing) {
      return reply.code(404).send({ error: 'UNS mapping not found for this entity' });
    }

    const [updatedMapping] = await prisma.$transaction([
      prisma.unsMapping.update({
        where: { entityId },
        data: {
          unsPath,
          isOverridden: true,
        },
      }),
      prisma.assetInstance.update({
        where: { id: entityId },
        data: { unsPath },
      }),
    ]);

    await auditLog({
      userId: user.username, userRole: user.role, action: 'UNS_PATH_OVERRIDDEN',
      targetType: 'uns_mapping', targetId: entityId,
      beforeValue: { unsPath: existing.unsPath },
      afterValue: { unsPath },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return updatedMapping;
  });

  // POST /entity/:entityId/move — Initiate move (returns impact report)
  app.post('/entity/:entityId/move', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['UNS'],
      summary: 'Generate move impact report',
      description: 'Generates an impact report showing which UNS paths would change if the entity is moved to a new parent. Requires SUPER_ADMIN or ADMIN role.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID to move' },
        },
      },
      body: {
        type: 'object',
        required: ['newParentId'],
        properties: {
          newParentId: { type: ['string', 'null'], description: 'New parent entity ID, or null for root' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            impact: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entityId: { type: 'string' },
                  entityName: { type: 'string' },
                  currentPath: { type: 'string' },
                  newPath: { type: 'string' },
                },
              },
            },
            summary: {
              type: 'object',
              properties: {
                totalAffected: { type: 'integer' },
                directChildren: { type: 'integer' },
                descendants: { type: 'integer' },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const { newParentId } = req.body as { newParentId: string | null };

    try {
      const report = await generateMoveImpact(entityId, newParentId);
      const directChildren = await prisma.assetInstance.count({
        where: { parentId: entityId, isActive: true },
      });
      return {
        impact: report.map((r) => ({
          entityId: r.entityId,
          entityName: r.entityName,
          currentPath: r.oldPath,
          newPath: r.newPath,
        })),
        summary: {
          totalAffected: report.length,
          directChildren,
          descendants: report.length - 1,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate move impact';
      return reply.code(400).send({ error: message });
    }
  });

  // POST /entity/:entityId/move/confirm — Confirm cascade after reviewing impact
  app.post('/entity/:entityId/move/confirm', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['UNS'],
      summary: 'Confirm cascade move',
      description: 'Confirms and executes the cascade move after reviewing the impact report. Updates all affected UNS paths. Requires SUPER_ADMIN or ADMIN role.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid', description: 'Entity instance ID to move' },
        },
      },
      body: {
        type: 'object',
        required: ['newParentId'],
        properties: {
          newParentId: { type: ['string', 'null'], description: 'New parent entity ID, or null for root' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            updated: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_UNS_CONFIG', req, reply);
    if (!ok) return;

    const { entityId } = req.params as { entityId: string };
    const { newParentId } = req.body as { newParentId: string | null };
    const user = (req as any).user as { username: string; role: string };

    try {
      const result = await confirmCascadeMove(entityId, newParentId);

      await auditLog({
        userId: user.username, userRole: user.role, action: 'UNS_CONFIG_UPDATED',
        targetType: 'uns_mapping', targetId: entityId,
        afterValue: { newParentId, updatedCount: result.updated },
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });

      return { success: true, updated: result.updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute cascade move';
      return reply.code(400).send({ error: message });
    }
  });

  // GET /search — Search by wildcard pattern
  app.get('/search', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['UNS'],
      summary: 'Search UNS by wildcard',
      description: 'Search UNS mappings using a wildcard path pattern. Requires ASSET_VIEW permission.',
      querystring: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: 'Wildcard path pattern to search (e.g. site/area/*)' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              entityId: { type: 'string' },
              unsPath: { type: 'string' },
              isOverridden: { type: 'boolean' },
              entityName: { type: 'string' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { path } = req.query as { path: string };
    // URL decoding turns + into space; UNS paths never contain spaces
    // (sanitized to hyphens), so restore spaces back to + wildcards
    const normalizedPath = path.replace(/ /g, '+');
    return searchByWildcard(normalizedPath);
  });
}
