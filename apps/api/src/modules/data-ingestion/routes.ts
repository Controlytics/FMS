/**
 * HTTP Data Ingestion Routes — Device token and JWT-authenticated endpoints.
 *
 * POST /telemetry  — Device token auth, normalize, enqueue
 * POST /attributes — Device token auth, normalize, enqueue
 * GET  /attributes — Device token auth, return shared attributes
 * POST /checklist  — User JWT ONLY, normalize, enqueue
 * POST /binary     — Device token auth, multipart, normalize, enqueue
 * POST /event      — Device token auth, normalize, enqueue
 * POST /rpc        — User JWT, publish to device's rpc/request topic
 * GET  /rpc/response/:requestId — User JWT, check Redis for response
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Queue } from 'bullmq';
import { getRedisConnection, QUEUES, JOB_PRIORITY } from '@digilog/queue';
import { errorResponses } from '../../lib/error-schemas.js';
import { prisma } from '../../lib/prisma.js';
import { resolveEntityByToken } from './entity-resolver.js';
import { normalizeMessage, normalizeBatch } from './message-normalizer.js';
import type { MessageType } from './message-normalizer.js';
import { publishRpcRequest, getRpcResponse } from './rpc-handler.js';

let ingestionQueue: Queue | null = null;

function getIngestionQueue(): Queue {
  if (!ingestionQueue) {
    ingestionQueue = new Queue(QUEUES.INGESTION.name, {
      connection: getRedisConnection(),
      defaultJobOptions: QUEUES.INGESTION.defaultJobOptions,
    });
  }
  return ingestionQueue;
}

// ─── Device Token Auth Middleware ─────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    device?: {
      credentialId: string;
      entityId: string;
      entityName: string;
      templateId: string;
      unsPath: string;
      ruleChainId: string | null;
      accessToken: string;
    };
  }
}

/**
 * Fastify preHandler that authenticates device token from Authorization header.
 * Sets req.device with resolved entity info.
 */
async function authenticateDeviceToken(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing device access token' });
    return;
  }

  const token = header.slice(7);
  const resolved = await resolveEntityByToken(token);

  if (!resolved) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or inactive device token' });
    return;
  }

  req.device = {
    credentialId: resolved.credentialId,
    entityId: resolved.entityId,
    entityName: resolved.entityName,
    templateId: resolved.templateId,
    unsPath: resolved.unsPath,
    ruleChainId: resolved.ruleChainId,
    accessToken: token,
  };
}

/**
 * Helper to enqueue a single normalized message.
 */
async function enqueueMessage(
  messageType: MessageType,
  req: FastifyRequest,
  rawPayload: unknown,
  device: NonNullable<FastifyRequest['device']>,
  priorityOverride?: number,
): Promise<{ messageId: string }> {
  const msg = normalizeMessage({
    protocol: 'http',
    entityId: device.entityId,
    entityName: device.entityName,
    templateId: device.templateId,
    unsPath: device.unsPath,
    credentialId: device.credentialId,
    sourceIp: req.ip,
    messageType,
    rawPayload,
    ruleChainId: device.ruleChainId,
  });

  const queue = getIngestionQueue();
  const priority = priorityOverride ?? JOB_PRIORITY.TELEMETRY;

  await queue.add(messageType, msg, { priority, jobId: msg.messageId });

  return { messageId: msg.messageId };
}

/**
 * Helper to enqueue batch messages.
 */
async function enqueueBatch(
  messageType: MessageType,
  req: FastifyRequest,
  rawPayload: unknown,
  device: NonNullable<FastifyRequest['device']>,
  priority: number,
): Promise<{ messageIds: string[] }> {
  const messages = normalizeBatch({
    protocol: 'http',
    entityId: device.entityId,
    entityName: device.entityName,
    templateId: device.templateId,
    unsPath: device.unsPath,
    credentialId: device.credentialId,
    sourceIp: req.ip,
    messageType,
    rawPayload,
    ruleChainId: device.ruleChainId,
  });

  const queue = getIngestionQueue();
  const messageIds: string[] = [];

  for (const msg of messages) {
    await queue.add(messageType, msg, { priority, jobId: msg.messageId });
    messageIds.push(msg.messageId);
  }

  return { messageIds };
}

// ─── Route Definitions ───────────────────────────────────

export default async function dataIngestionRoutes(app: FastifyInstance) {

  // POST /telemetry — Device Token auth, normalize, enqueue
  app.post('/telemetry', {
    preHandler: [authenticateDeviceToken],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Submit telemetry data',
      description: 'Accepts telemetry data from devices. Supports simple, timestamped, and batch formats.',
      security: [{ bearerAuth: [] }],
      body: {
        type: ['object', 'array'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            messageId: { type: 'string' },
            messageIds: { type: 'array', items: { type: 'string' } },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const device = req.device!;
    const payload = req.body;

    if (Array.isArray(payload)) {
      const result = await enqueueBatch('POST_TELEMETRY', req, payload, device, JOB_PRIORITY.TELEMETRY);
      return { success: true, messageIds: result.messageIds };
    }

    const result = await enqueueMessage('POST_TELEMETRY', req, payload, device, JOB_PRIORITY.TELEMETRY);
    return { success: true, messageId: result.messageId };
  });

  // POST /attributes — Device Token auth, normalize, enqueue
  app.post('/attributes', {
    preHandler: [authenticateDeviceToken],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Submit device attributes',
      description: 'Accepts device-reported attributes. Payload is a key-value object.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            messageId: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const device = req.device!;
    const result = await enqueueMessage('POST_ATTRIBUTES', req, req.body, device, JOB_PRIORITY.ATTRIBUTE_UPDATE);
    return { success: true, messageId: result.messageId };
  });

  // GET /attributes — Device Token auth, return shared attributes from entity
  app.get('/attributes', {
    preHandler: [authenticateDeviceToken],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Get shared attributes',
      description: 'Returns the shared attributes for the device\'s entity.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const device = req.device!;
    const entity = await prisma.assetInstance.findUnique({
      where: { id: device.entityId },
      select: { attributes: true, customAttributes: true },
    });

    if (!entity) {
      return {};
    }

    return {
      ...(entity.attributes as Record<string, unknown>),
      ...(entity.customAttributes as Record<string, unknown>),
    };
  });

  // POST /checklist — User JWT ONLY (never device token), normalize, enqueue
  app.post('/checklist', {
    preHandler: [app.requirePermission('CHECKLIST_SUBMIT')],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Submit checklist response',
      description: 'Accepts checklist responses from users. Requires JWT authentication (not device tokens).',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['entityId', 'responses'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          templateId: { type: 'string', format: 'uuid' },
          responses: { type: 'object', additionalProperties: true },
          remarks: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            messageId: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    // This endpoint uses standard JWT auth (handled by the auth plugin)
    if (!req.user?.sub) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'User JWT required' });
    }

    const body = req.body as {
      entityId: string;
      templateId?: string;
      responses: Record<string, unknown>;
      remarks?: string;
    };

    // Resolve entity
    const entity = await prisma.assetInstance.findUnique({
      where: { id: body.entityId },
      include: { template: { select: { id: true, name: true, defaultRuleChainId: true } } },
    });

    if (!entity || !entity.isActive) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Entity not found or inactive' });
    }

    const unsMapping = await prisma.unsMapping.findUnique({
      where: { entityId: entity.id },
    });

    const msg = normalizeMessage({
      protocol: 'http',
      entityId: entity.id,
      entityName: entity.name,
      templateId: entity.template.id,
      unsPath: unsMapping?.unsPath ?? entity.unsPath ?? '',
      credentialId: '',
      sourceIp: req.ip,
      messageType: 'POST_CHECKLIST',
      rawPayload: {
        ...body.responses,
        _remarks: body.remarks,
        _userId: req.user.username,
        _userSub: req.user.sub,
      },
      ruleChainId: entity.template.defaultRuleChainId,
      metadata: {
        userId: req.user.username,
        userRole: req.user.role,
        sessionId: req.user.sessionId,
      },
    });

    const queue = getIngestionQueue();
    await queue.add('POST_CHECKLIST', msg, {
      priority: JOB_PRIORITY.CHECKLIST_SUBMISSION,
      jobId: msg.messageId,
    });

    return { success: true, messageId: msg.messageId };
  });

  // POST /binary — Device Token auth, multipart, normalize, enqueue
  app.post('/binary', {
    preHandler: [authenticateDeviceToken],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Submit binary data',
      description: 'Accepts binary file uploads from devices via multipart form data.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            messageId: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const device = req.device!;

    // Handle multipart upload
    const file = await req.file();
    if (!file) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'No file uploaded' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const rawPayload = {
      filename: file.filename,
      mimetype: file.mimetype,
      size: buffer.length,
      encoding: file.encoding,
      data: buffer.toString('base64'),
    };

    const result = await enqueueMessage('POST_BINARY', req, rawPayload, device, JOB_PRIORITY.BINARY_METADATA);
    return { success: true, messageId: result.messageId };
  });

  // POST /event — Device Token auth, normalize, enqueue
  app.post('/event', {
    preHandler: [authenticateDeviceToken],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Submit device event',
      description: 'Accepts device events (status changes, alerts, etc.).',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['event'],
        properties: {
          event: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          timestamp: { type: 'number' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            messageId: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const device = req.device!;
    const result = await enqueueMessage('DEVICE_EVENT', req, req.body, device, JOB_PRIORITY.DEVICE_EVENT);
    return { success: true, messageId: result.messageId };
  });

  // POST /rpc — User JWT, publish RPC request to device via MQTT
  app.post('/rpc', {
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Send RPC request to device',
      description: 'Sends an RPC command to a device via MQTT. Requires user JWT.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['entityId', 'method'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          method: { type: 'string' },
          params: { type: 'object', additionalProperties: true },
          timeout: { type: 'integer', description: 'Timeout in seconds (default 30)', default: 30 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            requestId: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    if (!req.user?.sub) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'User JWT required' });
    }

    const body = req.body as {
      entityId: string;
      method: string;
      params?: Record<string, unknown>;
      timeout?: number;
    };

    try {
      const requestId = await publishRpcRequest(
        body.entityId,
        body.method,
        body.params ?? {},
        body.timeout ?? 30,
      );

      return { success: true, requestId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish RPC request';
      return reply.code(400).send({ error: 'RPC_ERROR', message });
    }
  });

  // GET /rpc/response/:requestId — User JWT, check Redis for response
  app.get('/rpc/response/:requestId', {
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Get RPC response',
      description: 'Polls for an RPC response by request ID. Returns null data if not yet received.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['requestId'],
        properties: {
          requestId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            requestId: { type: 'string' },
            response: {
              type: ['object', 'null'],
              properties: {
                requestId: { type: 'string' },
                data: { type: 'object', additionalProperties: true },
                receivedAt: { type: 'string' },
              },
              nullable: true,
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    if (!req.user?.sub) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'User JWT required' });
    }

    const { requestId } = req.params as { requestId: string };
    const response = await getRpcResponse(requestId);

    return {
      success: true,
      requestId,
      response: response ?? null,
    };
  });
}
