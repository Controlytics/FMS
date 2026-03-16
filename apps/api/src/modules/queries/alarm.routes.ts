import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { errorResponses } from '../../lib/error-schemas.js';
import { dispatchNotification } from '../notification-delivery/notification-dispatcher.js';
import { auditLog } from '../../lib/audit.js';
import { enforceReauth } from '../../lib/reauth-check.js';

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
          status: { type: 'string', enum: ['ACTIVE', 'ACKNOWLEDGED', 'CLEARED', 'MANUALLY_CLEARED'], description: 'Filter by alarm status' },
          severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO'], description: 'Filter by severity' },
          from: { type: 'string', description: 'Start date' },
          to: { type: 'string', description: 'End date' },
          entityId: { type: 'string', format: 'uuid', description: 'Filter by entity ID' },
          alarmType: { type: 'string', description: 'Filter by alarm type' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', minimum: 1 },
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
    const limit = query.limit ? Math.max(query.limit, 1) : undefined;
    const skip = limit ? (page - 1) * limit : 0;
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

    const [alarms, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy,
        ...(limit ? { skip, take: limit } : {}),
      }),
      prisma.alarm.count({ where }),
    ]);

    // Enrich with entity names
    const entityIds = [...new Set(alarms.map((a) => a.entityId))];
    const entities = entityIds.length > 0
      ? await prisma.assetInstance.findMany({
          where: { id: { in: entityIds } },
          select: { id: true, name: true },
        })
      : [];
    const entityNameMap = new Map(entities.map((e) => [e.id, e.name]));

    const data = alarms.map((a) => ({
      ...a,
      entityName: entityNameMap.get(a.entityId) ?? null,
    }));

    return {
      data,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit ? Math.ceil(total / limit) : 1,
    };
  });


  // 1b. GET /summary — Alarm summary counts
  app.get('/summary', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Alarms'],
      summary: 'Get alarm summary counts',
      description: 'Returns counts of alarms by status and critical severity.',
      response: {
        200: {
          type: 'object',
          properties: {
            active: { type: 'integer' },
            acknowledged: { type: 'integer' },
            cleared: { type: 'integer' },
            critical: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    const [active, acknowledged, cleared, critical] = await Promise.all([
      prisma.alarm.count({ where: { status: 'ACTIVE' } }),
      prisma.alarm.count({ where: { status: 'ACKNOWLEDGED' } }),
      prisma.alarm.count({ where: { status: { in: ['CLEARED', 'MANUALLY_CLEARED'] } } }),
      prisma.alarm.count({ where: { severity: 'CRITICAL', status: { notIn: ['CLEARED', 'MANUALLY_CLEARED'] } } }),
    ]);

    return { active, acknowledged, cleared, critical };
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
          status: { type: 'string', enum: ['ACTIVE', 'ACKNOWLEDGED', 'CLEARED', 'MANUALLY_CLEARED'] },
          severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO'] },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', minimum: 1 },
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
    const limit = query.limit ? Math.max(query.limit, 1) : undefined;
    const skip = limit ? (page - 1) * limit : 0;

    const where: Prisma.AlarmWhereInput = { entityId };

    if (query.status) {
      where.status = query.status;
    }
    if (query.severity) {
      where.severity = query.severity;
    }

    const [alarms, total] = await Promise.all([
      prisma.alarm.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(limit ? { skip, take: limit } : {}),
      }),
      prisma.alarm.count({ where }),
    ]);

    // Enrich with entity name
    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { name: true },
    });

    const data = alarms.map((a) => ({
      ...a,
      entityName: entity?.name ?? null,
    }));

    return {
      data,
      total,
      page,
      limit: limit ?? total,
      totalPages: limit ? Math.ceil(total / limit) : 1,
    };
  });

  // 3. POST /:id/acknowledge — Acknowledge alarm
  app.post('/:id/acknowledge', {
    preHandler: [app.requirePermission('ALARM_ACKNOWLEDGE')],
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
    const { ok } = await enforceReauth('ACKNOWLEDGE_ALARM', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as { remarks?: string; signerFullName: string; meaning: string };
    const user = (req as any).user as { sub: string; username: string; role: string; fullName?: string };

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
      .update(recordHash + user.sub + signedAt.toISOString())
      .digest('hex');

    const result = await prisma.$transaction(async (tx) => {
      const signature = await tx.electronicSignature.create({
        data: {
          recordType: 'alarm',
          recordId: alarm.id,
          signerUserId: user.sub,
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
          acknowledgedBy: user.username,
          acknowledgedAt: signedAt,
          ackRemarks: body.remarks ?? null,
          ackSignatureId: signature.id,
        },
      });

      return { alarm: updatedAlarm, signature };
    });

    await auditLog({
      userId: user.username, userRole: user.role, action: 'ALARM_ACKNOWLEDGED',
      targetType: 'alarm', targetId: id,
      afterValue: { name: alarm.alarmType, alarmType: alarm.alarmType, severity: alarm.severity, entityId: alarm.entityId },
      signatureMeaning: body.meaning,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    // Dispatch ALARM_ACKNOWLEDGED notification
    const ackEntity = await prisma.assetInstance.findUnique({ where: { id: alarm.entityId }, select: { name: true, unsPath: true } });
    dispatchNotification({
      eventType: 'ALARM_ACKNOWLEDGED',
      context: { severity: alarm.severity, alarmType: alarm.alarmType },
      variables: {
        alarmId: alarm.id, alarmType: alarm.alarmType, severity: alarm.severity,
        entityName: ackEntity?.name ?? alarm.entityId, entityId: alarm.entityId,
        acknowledgedBy: user.username, remarks: body.remarks ?? 'N/A',
        timestamp: new Date().toISOString(),
      },
    }).catch(err => console.error('[AlarmAck] Notification dispatch failed:', err.message));

    return result;
  });

  // 4. POST /:id/clear — Clear alarm
  app.post('/:id/clear', {
    preHandler: [app.requirePermission('ALARM_CLEAR')],
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
    const { ok } = await enforceReauth('CLEAR_ALARM', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as { remarks?: string; signerFullName: string; meaning: string };
    const user = (req as any).user as { sub: string; username: string; role: string; fullName?: string };

    const alarm = await prisma.alarm.findUnique({ where: { id } });
    if (!alarm) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Alarm not found' });
    }
    if (alarm.status !== 'ACTIVE' && alarm.status !== 'ACKNOWLEDGED') {
      return reply.code(400).send({ error: 'INVALID_STATUS', message: 'Alarm must be in ACTIVE or ACKNOWLEDGED status to clear manually' });
    }

    const signedAt = new Date();

    const recordHash = createHash('sha256')
      .update(JSON.stringify({ alarmId: alarm.id, alarmType: alarm.alarmType, severity: alarm.severity, entityId: alarm.entityId }))
      .digest('hex');

    const signatureHash = createHash('sha256')
      .update(recordHash + user.sub + signedAt.toISOString())
      .digest('hex');

    const result = await prisma.$transaction(async (tx) => {
      const signature = await tx.electronicSignature.create({
        data: {
          recordType: 'alarm',
          recordId: alarm.id,
          signerUserId: user.sub,
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
          status: 'MANUALLY_CLEARED',
          cleared: true,
          clearedAt: signedAt,
          clearedBy: user.username,
          clearRemarks: body.remarks ?? null,
          clearSignatureId: signature.id,
        },
      });

      return { alarm: updatedAlarm, signature };
    });

    await auditLog({
      userId: user.username, userRole: user.role, action: 'ALARM_CLEARED',
      targetType: 'alarm', targetId: id,
      afterValue: { name: alarm.alarmType, alarmType: alarm.alarmType, severity: alarm.severity, entityId: alarm.entityId },
      signatureMeaning: body.meaning,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    // Dispatch ALARM_CLEARED notification
    const clearEntity = await prisma.assetInstance.findUnique({ where: { id: alarm.entityId }, select: { name: true, unsPath: true } });
    dispatchNotification({
      eventType: 'ALARM_CLEARED',
      context: { severity: alarm.severity, alarmType: alarm.alarmType },
      variables: {
        alarmId: alarm.id, alarmType: alarm.alarmType, severity: alarm.severity,
        entityName: clearEntity?.name ?? alarm.entityId, entityId: alarm.entityId,
        clearedBy: user.username, remarks: body.remarks ?? 'N/A',
        timestamp: new Date().toISOString(),
      },
    }).catch(err => console.error('[AlarmClear] Notification dispatch failed:', err.message));

    return result;
  });
}
