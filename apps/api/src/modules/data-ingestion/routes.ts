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
import path from 'path';
import { JOB_PRIORITY } from '@digilog/queue';
import { getTsdbPool } from '@digilog/db';
import { errorResponses } from '../../lib/error-schemas.js';
import { prisma } from '../../lib/prisma.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { resolveEntityByToken } from './entity-resolver.js';
import { normalizeMessage, normalizeBatch } from './message-normalizer.js';
import type { MessageType } from './message-normalizer.js';
import { publishRpcRequest, getRpcResponse } from './rpc-handler.js';
import { enqueueIngestionJob } from './ingestion.service.js';

// ─── Device Token Auth Middleware ─────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    device?: {
      credentialId: string;
      entityId: string;
      entityName: string;
      templateId: string;
      unsPath: string;
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
  });

  const priority = priorityOverride ?? JOB_PRIORITY.TELEMETRY;

  await enqueueIngestionJob(msg, { priority, jobId: msg.messageId });

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
  });

  const messageIds: string[] = [];

  for (const msg of messages) {
    await enqueueIngestionJob(msg, { priority, jobId: msg.messageId });
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

    // Audit 2026-05-09 fix: align reauth posture with the cycle-bound
    // POST /api/filters/:id/submit-checklist (which has gated this with
    // SUBMIT_CHECKLIST_WITH_SIGNATURE since the C2 fixes). Two parallel
    // submission paths must use the same gate so the auditor sees a
    // consistent compliance contract on every checklist submission.
    const { ok } = await enforceReauth('SUBMIT_CHECKLIST_WITH_SIGNATURE', req, reply);
    if (!ok) return;

    const body = req.body as {
      entityId: string;
      templateId?: string;
      responses: Record<string, unknown>;
      remarks?: string;
    };

    // Resolve entity
    const entity = await prisma.assetInstance.findUnique({
      where: { id: body.entityId },
      include: { template: { select: { id: true, name: true } } },
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
      metadata: {
        userId: req.user.username,
        userRole: req.user.role,
        sessionId: req.user.sessionId,
      },
    });

    await enqueueIngestionJob(msg, {
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


  // GET /binary/:entityId — List binary files for an entity
  app.get('/binaries/:entityId', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'List binary files for entity',
      description: 'Returns list of binary files uploaded to an entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: { entityId: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'string' },
                  dataType: { type: 'string' },
                  filePath: { type: 'string' },
                  fileHash: { type: 'string' },
                  fileSize: { type: 'number' },
                  fileName: { type: "string" },
                  mimeType: { type: 'string' },
                  metadata: { type: 'object', additionalProperties: true },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };
    const pool = getTsdbPool();
    const result = await pool.query(
      'SELECT time, data_type, file_path, file_hash, file_size, mime_type, metadata FROM ts_binary_data WHERE entity_id = $1 ORDER BY time DESC LIMIT 100',
      [entityId]
    );
    const data = result.rows.map((r: any) => ({
      time: r.time,
      dataType: r.data_type,
      filePath: r.file_path,
      fileHash: r.file_hash,
      fileSize: Number(r.file_size),
      mimeType: r.mime_type,
      fileName: (r.file_path || "").split("/").pop()?.replace(/^\d+-/, "") || "unknown",
      metadata: r.metadata,
    }));
    return { data, total: data.length };
  });

  // GET /binary/:entityId/file — Serve a binary file
  app.get('/binaries/:entityId/file', {
    preHandler: [app.requirePermission('ASSET_READ')],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Serve binary file',
      description: 'Serves a binary file by path.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: { entityId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: { path: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const filePath = (req.query as any).path as string;
    const uploadsBaseDir = path.resolve(process.cwd(), 'uploads');
    const resolved = filePath ? path.resolve(filePath) : '';
    if (!filePath || filePath.includes('..') || !filePath.includes(entityId) || !resolved.startsWith(uploadsBaseDir)) {
      return reply.code(403).send({ error: 'Access denied' });
    }
    const { existsSync, createReadStream } = await import('fs');
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
      mp4: 'video/mp4', pdf: 'application/pdf',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    reply.type(mime);
    return reply.send(createReadStream(filePath));
  });


  // DELETE /binaries/:entityId — Delete a binary file
  app.delete('/binaries/:entityId', {
    preHandler: [app.requirePermission('ASSET_DELETE')],
    schema: {
      tags: ['Data Ingestion'],
      summary: 'Delete a binary file',
      description: 'Deletes a binary file from disk and TSDB by entity ID and file path.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: { entityId: { type: 'string', format: 'uuid' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const { filePath } = req.query as { filePath: string };

    // Security: ensure filePath belongs to this entity
    if (!filePath || filePath.includes('..') || !filePath.includes(entityId) || !filePath.includes('/uploads/')) {
      throw Object.assign(new Error('Invalid file path'), { statusCode: 400 });
    }

    // Delete from disk
    const { unlinkSync, existsSync } = await import('fs');
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }

    // Delete from TSDB
    const pool = getTsdbPool();
    await pool.query(
      'DELETE FROM ts_binary_data WHERE entity_id = $1 AND file_path = $2',
      [entityId, filePath]
    );

    return { success: true };
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
