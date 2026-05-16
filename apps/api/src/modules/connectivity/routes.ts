import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { randomBytes } from 'node:crypto';
import { errorResponses } from '../../lib/error-schemas.js';
import { provisionUnsMapping } from '../uns/uns.service.js';
import { getEntityUnsPath } from '../../lib/uns-path.js';
import { renderSnippets } from './snippets/index.js';

export default async function connectivityRoutes(app: FastifyInstance) {

  // ─── GET /:entityId — Get connectivity status ──────────
  app.get('/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Get entity connectivity status',
      description: 'Returns the connectivity status and device credential info for an entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            connectivity: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                entityId: { type: 'string' },
                status: { type: 'string' },
                lastActivityAt: { type: ['string', 'null'], format: 'date-time' },
                lastConnectedAt: { type: ['string', 'null'], format: 'date-time' },
                lastDisconnectedAt: { type: ['string', 'null'], format: 'date-time' },
                protocol: { type: ['string', 'null'] },
                sourceIp: { type: ['string', 'null'] },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
            credential: {
              type: ['object', 'null'],
              nullable: true,
              properties: {
                token: { type: 'string' },
                isActive: { type: 'boolean' },
                createdAt: { type: 'string', format: 'date-time' },
                lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
                allowedIps: { type: 'array', items: { type: 'string' } },
                maxDataRatePerMin: { type: 'integer' },
                allowedTopics: { type: 'array', items: { type: 'string' } },
              },
            },
            unsPath: { type: ['string', 'null'] },
            topics: { type: 'array', items: { type: 'string' } },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };

    const connectivity = await prisma.connectivityStatus.findUnique({
      where: { entityId },
    });

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: {
        accessToken: true,
        isActive: true,
        createdAt: true,
        lastConnectedAt: true,
        allowedIps: true,
        maxDataRatePerMin: true,
        credentialData: true,
      },
    });

    const unsMapping = await prisma.unsMapping.findUnique({
      where: { entityId },
    });

    const connectivityResult = connectivity ?? {
      id: null,
      entityId,
      status: 'UNKNOWN',
      lastActivityAt: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      protocol: null,
      sourceIp: null,
      updatedAt: new Date(),
    };

    const credentialResult = credential
      ? {
          token: credential.accessToken,
          isActive: credential.isActive,
          createdAt: credential.createdAt,
          lastUsedAt: credential.lastConnectedAt,
          allowedIps: credential.allowedIps,
          maxDataRatePerMin: credential.maxDataRatePerMin,
          allowedTopics: (credential.credentialData as Record<string, unknown>)?.allowedTopics as string[] ?? [],
        }
      : null;

    let unsPath = unsMapping?.unsPath ?? null;
    if (!unsPath) {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: entityId },
        include: { template: { select: { name: true } } },
      });
      if (entity) unsPath = getEntityUnsPath(entity);
    }

    return {
      connectivity: connectivityResult,
      credential: credentialResult,
      unsPath,
      topics: credentialResult?.allowedTopics ?? [],
    };
  });

  // ─── POST /:entityId/test — Test entity connectivity ───
  app.post('/:entityId/test', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Test entity connectivity',
      description: 'Tests whether a device is reachable by checking its credential and connectivity status.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        additionalProperties: true,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            reachable: { type: 'boolean' },
            protocol: { type: ['string', 'null'] },
            lastActivityAt: { type: ['string', 'null'], format: 'date-time' },
            tokenStatus: { type: 'string', enum: ['ACTIVE', 'NEVER_USED', 'REVOKED', 'NOT_CONFIGURED'] },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: {
        isActive: true,
        firstConnectedAt: true,
      },
    });

    const connectivity = await prisma.connectivityStatus.findUnique({
      where: { entityId },
    });

    let tokenStatus: 'ACTIVE' | 'NEVER_USED' | 'REVOKED' | 'NOT_CONFIGURED';
    if (!credential) {
      tokenStatus = 'NOT_CONFIGURED';
    } else if (!credential.isActive) {
      tokenStatus = 'REVOKED';
    } else if (!credential.firstConnectedAt) {
      tokenStatus = 'NEVER_USED';
    } else {
      tokenStatus = 'ACTIVE';
    }

    const reachable = connectivity?.status === 'ONLINE' && tokenStatus === 'ACTIVE';

    return {
      reachable,
      protocol: connectivity?.protocol ?? null,
      lastActivityAt: connectivity?.lastActivityAt ?? null,
      tokenStatus,
    };
  });

  // ─── GET /:entityId/snippets — Get connection code snippets ───
  app.get('/:entityId/snippets', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Get connection code snippets',
      description: 'Generates code snippets in multiple languages for connecting a device to the platform.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            snippets: {
              type: 'object',
              properties: {
                python: { type: 'string' },
                nodejs: { type: 'string' },
                curl: { type: 'string' },
                c: { type: 'string' },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      include: { template: { select: { id: true, name: true, transportType: true } } },
    });

    if (!entity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found' });
    }

    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
      select: { accessToken: true, isActive: true },
    });

    const token = credential?.accessToken ?? '<YOUR_DEVICE_TOKEN>';
    const unsPath = getEntityUnsPath(entity);
    const apiUrl = process.env.ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:3000';
    const transport: 'MQTT' | 'HTTP' = entity.template?.transportType === 'MQTT' ? 'MQTT' : 'HTTP';

    return {
      snippets: renderSnippets(transport, {
        entityName: entity.name,
        unsPath,
        token,
        apiUrl,
        mqttHost: apiUrl.replace(/^https?:\/\//, '').split(':')[0],
        telemetryTopic: `${unsPath}/telemetry`,
        attributesTopic: `${unsPath}/attributes`,
      }),
    };
  });

  // ─── POST /:entityId/token — Generate new device token ───
  app.post('/:entityId/token', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Generate new device token',
      description: 'Generates a new 64-character hex device access token. Upserts the device credential for the entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          customToken: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    // Verify entity exists
    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { id: true, unsPath: true, name: true, template: { select: { name: true } } },
    });

    if (!entity) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found' });
    }

    // Provision UNS mapping (builds ISA-95 path from hierarchy)
    try {
      await provisionUnsMapping(entityId);
    } catch {
      // Non-fatal: UNS mapping is best-effort during token provisioning
    }

    // Re-fetch entity to get the freshly computed unsPath
    const updatedEntity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { unsPath: true, name: true, template: { select: { name: true } } },
    });

    const customToken = (req.body as any)?.customToken;
    const token = customToken || randomBytes(32).toString('hex');
    const unsPath = getEntityUnsPath(updatedEntity ?? entity);

    // Build allowed topics from the entity's UNS path
    const allowedTopics = [
      `${unsPath}/telemetry`,
      `${unsPath}/attributes`,
      `${unsPath}/events`,
      `${unsPath}/rpc/request`,
      `${unsPath}/rpc/response`,
    ];

    // Check if custom token is already in use by another entity
    if (customToken) {
      const existing = await prisma.deviceCredential.findUnique({
        where: { accessToken: customToken },
        select: { entityId: true },
      });
      if (existing && existing.entityId !== entityId) {
        return reply.code(409).send({
          error: 'TOKEN_CONFLICT',
          message: 'This token is already in use by another entity. Please choose a different token.',
        });
      }
    }

    const credential = await prisma.deviceCredential.upsert({
      where: { entityId },
      create: {
        entityId,
        accessToken: token,
        status: 'ACTIVE',
        isActive: true,
        credentialData: { allowedTopics },
      },
      update: {
        accessToken: token,
        status: 'ACTIVE',
        isActive: true,
        credentialData: { allowedTopics },
        createdAt: new Date(),
      },
    });

    return {
      token,
      createdAt: credential.createdAt,
    };
  });

  // ─── DELETE /:entityId/token — Revoke device token ─────
  app.delete('/:entityId/token', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Revoke device token',
      description: 'Revokes the device access token and sets connectivity status to OFFLINE.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            revoked: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    // Update device credential to inactive
    const credential = await prisma.deviceCredential.findUnique({
      where: { entityId },
    });

    if (!credential) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No device credential found for this entity' });
    }

    await prisma.deviceCredential.update({
      where: { entityId },
      data: {
        isActive: false,
        status: 'INACTIVE',
      },
    });

    // Update connectivity status to OFFLINE
    await prisma.connectivityStatus.upsert({
      where: { entityId },
      create: {
        entityId,
        status: 'OFFLINE',
        lastDisconnectedAt: new Date(),
      },
      update: {
        status: 'OFFLINE',
        lastDisconnectedAt: new Date(),
      },
    });

    return { revoked: true };
  });

  // ─── GET /:entityId/history — Connection history ───────
  app.get('/:entityId/history', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Connectivity'],
      summary: 'Get connection history',
      description: 'Returns connection/disconnection events from the time-series database for the specified period.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['24h', '7d', '30d'],
            default: '24h',
          },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              time: { type: 'string', format: 'date-time' },
              eventType: { type: 'string' },
              details: { type: ['object', 'null'], additionalProperties: true },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };
    const { period } = req.query as { period?: string };

    const intervalMap: Record<string, string> = {
      '24h': '24 hours',
      '7d': '7 days',
      '30d': '30 days',
    };
    const interval = intervalMap[period ?? '24h'] ?? '24 hours';

    const events = await prisma.$queryRawUnsafe<
      Array<{ time: Date; event_type: string; details: unknown }>
    >(
      `SELECT time, event_type, details
       FROM ts_device_events
       WHERE entity_id = $1::uuid
         AND event_type IN ('CONNECTED', 'DISCONNECTED')
         AND time >= NOW() - $2::interval
       ORDER BY time DESC`,
      entityId,
      interval,
    );

    return events.map((e) => ({
      time: e.time,
      eventType: e.event_type,
      details: e.details ?? null,
    }));
  });
}
