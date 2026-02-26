/**
 * MQTT Auth Callback Routes — Called by EMQX for authentication and ACL checks.
 * These are internal endpoints not exposed to public users.
 *
 * POST /auth   — Validate device access token
 * POST /acl    — Validate topic publish/subscribe permissions
 * POST /superuser — Always deny (no superuser allowed)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';

const UNS_ROOT = process.env.UNS_ROOT_PREFIX ?? 'digilog/v1';
const SERVER_PREFIX = '__server__';

export default async function mqttAuthRoutes(app: FastifyInstance) {

  // POST /auth — Validate device access token from EMQX
  app.post('/auth', {
    schema: {
      tags: ['Internal — MQTT'],
      summary: 'MQTT authentication callback',
      description: 'Validates device access tokens for EMQX broker authentication.',
      security: [],
      body: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
          clientid: { type: 'string' },
          peerhost: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: ['allow', 'deny'] },
          },
        },
        401: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: ['deny'] },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, peerhost } = req.body as {
      username?: string;
      password?: string;
      clientid?: string;
      peerhost?: string;
    };

    if (!username) {
      return reply.code(401).send({ result: 'deny', message: 'Missing username (access token)' });
    }

    // Allow server client (internal DigiLog server)
    if (username.startsWith(SERVER_PREFIX)) {
      const expectedPassword = process.env.EMQX_ADMIN_PASSWORD ?? '';
      const { password } = req.body as { password?: string };
      if (password === expectedPassword) {
        return { result: 'allow' };
      }
      return reply.code(401).send({ result: 'deny', message: 'Invalid server credentials' });
    }

    // Look up DeviceCredential where accessToken = username
    const credential = await prisma.deviceCredential.findUnique({
      where: { accessToken: username },
    });

    if (!credential || credential.status !== 'ACTIVE' || !credential.isActive) {
      return reply.code(401).send({ result: 'deny', message: 'Invalid or inactive credential' });
    }

    // Check allowed IPs if configured
    if (credential.allowedIps.length > 0 && peerhost) {
      if (!credential.allowedIps.includes(peerhost)) {
        return reply.code(401).send({ result: 'deny', message: 'IP not allowed' });
      }
    }

    // On first auth, set firstConnectedAt
    const updateData: Record<string, unknown> = {
      lastConnectedAt: new Date(),
      lastSourceIp: peerhost ?? null,
    };
    if (!credential.firstConnectedAt) {
      updateData.firstConnectedAt = new Date();
    }

    await prisma.deviceCredential.update({
      where: { id: credential.id },
      data: updateData,
    });

    // Update connectivity status to ONLINE
    await prisma.connectivityStatus.upsert({
      where: { entityId: credential.entityId },
      update: {
        status: 'ONLINE',
        lastConnectedAt: new Date(),
        lastActivityAt: new Date(),
        protocol: 'MQTT',
        sourceIp: peerhost ?? null,
      },
      create: {
        entityId: credential.entityId,
        status: 'ONLINE',
        lastConnectedAt: new Date(),
        lastActivityAt: new Date(),
        protocol: 'MQTT',
        sourceIp: peerhost ?? null,
      },
    });

    return { result: 'allow' };
  });

  // POST /acl — Validate topic publish/subscribe permissions
  app.post('/acl', {
    schema: {
      tags: ['Internal — MQTT'],
      summary: 'MQTT ACL callback',
      description: 'Validates topic permissions for EMQX broker.',
      security: [],
      body: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          topic: { type: 'string' },
          action: { type: 'string', enum: ['publish', 'subscribe'] },
          clientid: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: ['allow', 'deny'] },
          },
        },
        403: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: ['deny'] },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, topic, action } = req.body as {
      username?: string;
      topic?: string;
      action?: 'publish' | 'subscribe';
      clientid?: string;
    };

    if (!username || !topic || !action) {
      return reply.code(403).send({ result: 'deny', message: 'Missing required fields' });
    }

    // Server client: can subscribe to digilog/v1/# and publish to anything
    if (username.startsWith(SERVER_PREFIX)) {
      if (action === 'subscribe') {
        if (topic.startsWith(`${UNS_ROOT}/`)) {
          return { result: 'allow' };
        }
        // Also allow subscribing to exact digilog/v1/#
        if (topic === `${UNS_ROOT}/#`) {
          return { result: 'allow' };
        }
        return reply.code(403).send({ result: 'deny', message: 'Server cannot subscribe to this topic' });
      }
      // Server can publish to anything
      return { result: 'allow' };
    }

    // Device client: resolve entity from token
    const credential = await prisma.deviceCredential.findUnique({
      where: { accessToken: username },
    });

    if (!credential || credential.status !== 'ACTIVE') {
      return reply.code(403).send({ result: 'deny', message: 'Invalid credential' });
    }

    // Resolve entity's UNS path
    const unsMapping = await prisma.unsMapping.findUnique({
      where: { entityId: credential.entityId },
    });

    let entityUnsPath: string | null = null;
    if (unsMapping) {
      entityUnsPath = unsMapping.unsPath;
    } else {
      // Fallback to entity's unsPath field
      const entity = await prisma.assetInstance.findUnique({
        where: { id: credential.entityId },
        select: { unsPath: true },
      });
      entityUnsPath = entity?.unsPath ?? null;
    }

    if (!entityUnsPath) {
      return reply.code(403).send({ result: 'deny', message: 'No UNS path configured for entity' });
    }

    // ACL rules based on action type
    if (action === 'publish') {
      // Entity can publish to: telemetry, attributes, events, rpc/response, binary/#
      const allowedPublishSuffixes = [
        '/telemetry',
        '/attributes',
        '/events',
        '/rpc/response',
        '/binary/',
      ];

      const isAllowed = allowedPublishSuffixes.some((suffix) => {
        if (suffix.endsWith('/')) {
          // Wildcard: topic must start with entity path + suffix
          return topic.startsWith(`${entityUnsPath}${suffix}`);
        }
        // Exact match or with trailing path segments (for rpc/response/requestId)
        return topic === `${entityUnsPath}${suffix}` || topic.startsWith(`${entityUnsPath}${suffix}/`);
      });

      if (isAllowed) {
        return { result: 'allow' };
      }
      return reply.code(403).send({ result: 'deny', message: 'Not authorized to publish to this topic' });
    }

    if (action === 'subscribe') {
      // Entity can subscribe to: rpc/request, attributes/shared, config, ota
      const allowedSubscribeSuffixes = [
        '/rpc/request',
        '/rpc/request/#',
        '/attributes/shared',
        '/attributes/shared/#',
        '/config',
        '/config/#',
        '/ota',
        '/ota/#',
      ];

      const isAllowed = allowedSubscribeSuffixes.some((suffix) => {
        return topic === `${entityUnsPath}${suffix}` || topic.startsWith(`${entityUnsPath}${suffix}/`);
      });

      if (isAllowed) {
        return { result: 'allow' };
      }
      return reply.code(403).send({ result: 'deny', message: 'Not authorized to subscribe to this topic' });
    }

    return reply.code(403).send({ result: 'deny', message: 'Unknown action' });
  });

  // POST /superuser — Always deny
  app.post('/superuser', {
    schema: {
      tags: ['Internal — MQTT'],
      summary: 'MQTT superuser callback',
      description: 'Always returns deny — no MQTT superuser is allowed.',
      security: [],
      body: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          clientid: { type: 'string' },
        },
      },
      response: {
        403: {
          type: 'object',
          properties: {
            result: { type: 'string', enum: ['deny'] },
          },
        },
      },
    },
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(403).send({ result: 'deny' });
  });
}
