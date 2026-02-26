import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function alarmRoutes(app: FastifyInstance) {

  // 1. GET / — List alarms (paginated, filterable)
  app.get('/', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Alarms'],
      summary: 'List alarms',
      description: 'List alarms with optional filters for status, severity, date range, entityId, alarmType, and pagination.',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'ACKNOWLEDGED', 'CLEARED'], description: 'Filter by alarm status' },
          severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO'], description: 'Filter by severity' },
          from: { type: 'string', format: 'date-time', description: 'Start date (ISO 8601)' },
          to: { type: 'string', format: 'date-time', description: 'End date (ISO 8601)' },
          entityId: { type: 'string', format: 'uuid', description: 'Filter by entity ID' },
          alarmType: { type: 'string', description: 'Filter by alarm type' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          sortBy: { type: 'string', enum: ['createdAt', 'severity', 'status'], default: 'createdAt' },
          sortDir: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const query = req.query as {
      status?: string;
      severity?: string;
      from?: string;
      to?: string;
      entityId?: string;
      alarmType?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortDir?: string;
    };

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = (query.sortDir ?? 'desc') as 'asc' | 'desc';

    const where: Prisma.AlarmWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.severity) {
      where.severity = query.severity;
    }
    if (query.entityId) {
      where.entityId = query.entityId;
    }
    if (query.alarmType) {
      where.alarmType = query.alarmType;
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        where.createdAt.lte = new Date(query.to);
      }
    }

    const orderBy: Record<string, 'asc' | 'desc'> = {};
    orderBy[sortBy] = sortDir;

    const [data, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.alarm.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // 2. GET /:entityId — Entity alarms
  app.get('/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Alarms'],
      summary: 'Get alarms for an entity',
      description: 'List alarms for a specific entity with optional status and severity filters.',
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
          status: { type: 'string', enum: ['ACTIVE', 'ACKNOWLEDGED', 'CLEARED'] },
          severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO'] },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };
    const query = req.query as {
      status?: string;
      severity?: string;
      page?: number;
      limit?: number;
    };

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Prisma.AlarmWhereInput = { entityId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.severity) {
      where.severity = query.severity;
    }

    const [data, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.alarm.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // 3. POST /:id/acknowledge — Acknowledge alarm
  app.post('/:id/acknowledge', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR')],
    schema: {
      tags: ['Alarms'],
      summary: 'Acknowledge an alarm',
      description: 'Acknowledge an active alarm with an electronic signature. The alarm must be in ACTIVE status.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['signerFullName', 'meaning'],
        properties: {
          remarks: { type: 'string' },
          signerFullName: { type: 'string' },
          meaning: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            alarm: { type: 'object', additionalProperties: true },
            signature: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { remarks?: string; signerFullName: string; meaning: string };
    const user = (req as any).user as { id: string; username: string; role: string; fullName?: string };

    const alarm = await prisma.alarm.findUnique({ where: { id } });
    if (!alarm) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alarm not found' });
    }
    if (alarm.status !== 'ACTIVE') {
      return reply.code(400).send({ error: 'INVALID_STATUS', message: 'Alarm must be in ACTIVE status to acknowledge' });
    }

    const signedAt = new Date();

    const recordHash = createHash('sha256')
      .update(JSON.stringify({ alarmId: alarm.id, alarmType: alarm.alarmType, severity: alarm.severity, entityId: alarm.entityId }))
      .digest('hex');

    const signatureHash = createHash('sha256')
      .update(recordHash + user.id + signedAt.toISOString())
      .digest('hex');

    const result = await prisma.$transaction(async (tx) => {
      const signature = await tx.electronicSignature.create({
        data: {
          recordType: 'alarm',
          recordId: alarm.id,
          signerUserId: user.id,
          signerFullName: body.signerFullName,
          signerRole: user.role,
          meaning: body.meaning,
          signedAt,
          recordHash,
          signatureHash,
        },
      });

      const updatedAlarm = await tx.alarm.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledged: true,
          acknowledgedBy: user.id,
          acknowledgedAt: signedAt,
          ackRemarks: body.remarks ?? null,
          ackSignatureId: signature.id,
        },
      });

      return { alarm: updatedAlarm, signature };
    });

    return result;
  });

  // 4. POST /:id/clear — Clear alarm
  app.post('/:id/clear', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR')],
    schema: {
      tags: ['Alarms'],
      summary: 'Clear an alarm',
      description: 'Clear an active or acknowledged alarm with an electronic signature. The alarm must be in ACTIVE or ACKNOWLEDGED status.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['signerFullName', 'meaning'],
        properties: {
          remarks: { type: 'string' },
          signerFullName: { type: 'string' },
          meaning: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            alarm: { type: 'object', additionalProperties: true },
            signature: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { remarks?: string; signerFullName: string; meaning: string };
    const user = (req as any).user as { id: string; username: string; role: string; fullName?: string };

    const alarm = await prisma.alarm.findUnique({ where: { id } });
    if (!alarm) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alarm not found' });
    }
    if (alarm.status !== 'ACTIVE' && alarm.status !== 'ACKNOWLEDGED') {
      return reply.code(400).send({ error: 'INVALID_STATUS', message: 'Alarm must be in ACTIVE or ACKNOWLEDGED status to clear' });
    }

    const signedAt = new Date();

    const recordHash = createHash('sha256')
      .update(JSON.stringify({ alarmId: alarm.id, alarmType: alarm.alarmType, severity: alarm.severity, entityId: alarm.entityId }))
      .digest('hex');

    const signatureHash = createHash('sha256')
      .update(recordHash + user.id + signedAt.toISOString())
      .digest('hex');

    const result = await prisma.$transaction(async (tx) => {
      const signature = await tx.electronicSignature.create({
        data: {
          recordType: 'alarm',
          recordId: alarm.id,
          signerUserId: user.id,
          signerFullName: body.signerFullName,
          signerRole: user.role,
          meaning: body.meaning,
          signedAt,
          recordHash,
          signatureHash,
        },
      });

      const updatedAlarm = await tx.alarm.update({
        where: { id },
        data: {
          status: 'CLEARED',
          cleared: true,
          clearedAt: signedAt,
          clearedBy: user.id,
          clearRemarks: body.remarks ?? null,
          clearSignatureId: signature.id,
        },
      });

      return { alarm: updatedAlarm, signature };
    });

    return result;
  });
}
