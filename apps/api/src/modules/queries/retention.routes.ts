import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { getTsdbPool } from '@digilog/db';
import { errorResponses } from '../../lib/error-schemas.js';

const DEFAULT_RETENTION_CONFIG = {
  telemetry: { retentionDays: 365, compressionAfterDays: 7 },
  attributes: { retentionDays: 730 },
  events: { retentionDays: 365 },
  traces: { retentionHours: 48 },
  checklists: { retentionDays: 2555 },
  autoEnabled: false,
  requiresArchive: true,
};

const VALID_ARCHIVE_DATA_TYPES = ['telemetry', 'attributes', 'events', 'checklists'] as const;
const VALID_EXECUTE_DATA_TYPES = ['telemetry', 'attributes', 'events', 'traces', 'checklists'] as const;

const TSDB_TABLE_MAP: Record<string, string> = {
  telemetry: 'ts_telemetry',
  attributes: 'ts_attributes',
  events: 'ts_device_events',
  traces: 'ts_pipeline_traces',
  checklists: 'ts_checklist_responses',
};

export default async function retentionRoutes(app: FastifyInstance) {

  // 1. GET /config/retention — Get retention policies
  app.get('/config/retention', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Retention'],
      summary: 'Get data retention policies',
      description: 'Retrieve the current data retention configuration. Returns defaults if no custom config exists.',
      response: {
        200: {
          type: 'object',
          properties: {
            telemetry: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
                compressionAfterDays: { type: 'integer' },
              },
            },
            attributes: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
              },
            },
            events: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
              },
            },
            traces: {
              type: 'object',
              properties: {
                retentionHours: { type: 'integer' },
              },
            },
            checklists: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
              },
            },
            autoEnabled: { type: 'boolean' },
            requiresArchive: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    const config = await prisma.systemConfig.findUnique({ where: { configKey: 'retention' } });

    if (!config) {
      return DEFAULT_RETENTION_CONFIG;
    }

    return config.configValue as Record<string, unknown>;
  });

  // 2. PUT /config/retention — Update retention config
  app.put('/config/retention', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Retention'],
      summary: 'Update data retention policies',
      description: 'Create or update the data retention configuration.',
      body: {
        type: 'object',
        required: ['telemetry', 'attributes', 'events', 'traces', 'checklists', 'autoEnabled', 'requiresArchive'],
        properties: {
          telemetry: {
            type: 'object',
            required: ['retentionDays', 'compressionAfterDays'],
            properties: {
              retentionDays: { type: 'integer', minimum: 1 },
              compressionAfterDays: { type: 'integer', minimum: 1 },
            },
          },
          attributes: {
            type: 'object',
            required: ['retentionDays'],
            properties: {
              retentionDays: { type: 'integer', minimum: 1 },
            },
          },
          events: {
            type: 'object',
            required: ['retentionDays'],
            properties: {
              retentionDays: { type: 'integer', minimum: 1 },
            },
          },
          traces: {
            type: 'object',
            required: ['retentionHours'],
            properties: {
              retentionHours: { type: 'integer', minimum: 1 },
            },
          },
          checklists: {
            type: 'object',
            required: ['retentionDays'],
            properties: {
              retentionDays: { type: 'integer', minimum: 1 },
            },
          },
          autoEnabled: { type: 'boolean' },
          requiresArchive: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            telemetry: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
                compressionAfterDays: { type: 'integer' },
              },
            },
            attributes: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
              },
            },
            events: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
              },
            },
            traces: {
              type: 'object',
              properties: {
                retentionHours: { type: 'integer' },
              },
            },
            checklists: {
              type: 'object',
              properties: {
                retentionDays: { type: 'integer' },
              },
            },
            autoEnabled: { type: 'boolean' },
            requiresArchive: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const body = req.body as Record<string, unknown>;

    await prisma.systemConfig.upsert({
      where: { configKey: 'retention' },
      create: { configKey: 'retention', configValue: body as Prisma.InputJsonValue, configType: 'retention' },
      update: { configValue: body as Prisma.InputJsonValue },
    });

    return body;
  });

  // 3. POST /retention/archive — Archive data (stub)
  app.post('/retention/archive', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Retention'],
      summary: 'Archive data',
      description: 'Archive data of the specified type within the given date range. Currently returns a stub response until archive destination is configured.',
      body: {
        type: 'object',
        required: ['dataType', 'from', 'to'],
        properties: {
          dataType: { type: 'string', enum: [...VALID_ARCHIVE_DATA_TYPES] },
          from: { type: 'string', format: 'date-time', description: 'Start date (ISO 8601)' },
          to: { type: 'string', format: 'date-time', description: 'End date (ISO 8601)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            rowsArchived: { type: 'integer' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    return {
      status: 'archived',
      rowsArchived: 0,
      message: 'Archive destination not configured. Configure S3/Azure Blob in system settings.',
    };
  });

  // 4. POST /retention/execute — Execute retention (delete old data)
  app.post('/retention/execute', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Retention'],
      summary: 'Execute data retention',
      description: 'Delete data older than the specified number of days from the time-series database. Requires explicit confirmation.',
      body: {
        type: 'object',
        required: ['dataType', 'olderThanDays', 'confirmed'],
        properties: {
          dataType: { type: 'string', enum: [...VALID_EXECUTE_DATA_TYPES] },
          olderThanDays: { type: 'integer', minimum: 1 },
          confirmed: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            deleted: { type: 'integer' },
            dataType: { type: 'string' },
            olderThanDays: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { dataType, olderThanDays, confirmed } = req.body as {
      dataType: string;
      olderThanDays: number;
      confirmed: boolean;
    };

    if (confirmed !== true) {
      return reply.code(400).send({
        error: 'CONFIRMATION_REQUIRED',
        message: 'You must set confirmed: true to execute data retention. This action is irreversible.',
      });
    }

    const table = TSDB_TABLE_MAP[dataType];
    if (!table) {
      return reply.code(400).send({
        error: 'INVALID_DATA_TYPE',
        message: `Invalid data type: ${dataType}`,
      });
    }

    const pool = getTsdbPool();
    const result = await pool.query(
      `DELETE FROM ${table} WHERE time < (NOW() - make_interval(days => $1))`,
      [olderThanDays]
    );

    return {
      deleted: result.rowCount ?? 0,
      dataType,
      olderThanDays,
    };
  });
  // 5. POST /retention/execute-range — Delete data within a time range (optionally per entity)
  app.post('/retention/execute-range', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Retention'],
      summary: 'Delete data within a time range',
      description: 'Delete data from the specified time-series table within a from/to range, optionally scoped to an entity.',
      body: {
        type: 'object',
        required: ['dataType', 'from', 'to', 'confirmed'],
        properties: {
          dataType: { type: 'string', enum: [...VALID_EXECUTE_DATA_TYPES, 'alarms'] },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          entityId: { type: 'string', format: 'uuid' },
          confirmed: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            deleted: { type: 'integer' },
            dataType: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { dataType, from, to, entityId, confirmed } = req.body as {
      dataType: string;
      from: string;
      to: string;
      entityId?: string;
      confirmed: boolean;
    };

    if (confirmed !== true) {
      return reply.code(400).send({
        error: 'CONFIRMATION_REQUIRED',
        message: 'You must set confirmed: true to execute data deletion. This action is irreversible.',
      });
    }

    // Handle alarms via Prisma (stored in main DB, not TSDB)
    if (dataType === 'alarms') {
      const where: any = {
        createdAt: { gte: new Date(from), lte: new Date(to) },
      };
      if (entityId) where.entityId = entityId;

      const result = await prisma.alarm.deleteMany({ where });
      return { deleted: result.count, dataType, from, to };
    }

    // Handle checklists: delete from both TSDB and PG checklist_reviews
    if (dataType === 'checklists') {
      const pool = getTsdbPool();
      const conditions = ['time >= $1', 'time <= $2'];
      const params: any[] = [new Date(from), new Date(to)];
      if (entityId) {
        conditions.push('entity_id = $3');
        params.push(entityId);
      }

      // Get checklist_ids to also clean PG reviews
      const idsResult = await pool.query(
        `SELECT DISTINCT checklist_id FROM ts_checklist_responses WHERE ${conditions.join(' AND ')}`,
        params
      );
      const checklistIds = idsResult.rows.map((r: any) => r.checklist_id);

      // Delete from TSDB
      const result = await pool.query(
        `DELETE FROM ts_checklist_responses WHERE ${conditions.join(' AND ')}`,
        params
      );

      // Delete corresponding reviews from PG
      if (checklistIds.length > 0) {
        await prisma.checklistReview.deleteMany({
          where: { checklistId: { in: checklistIds } },
        });
      }

      return { deleted: result.rowCount ?? 0, dataType, from, to };
    }

    // Handle time-series tables
    const table = TSDB_TABLE_MAP[dataType];
    if (!table) {
      return reply.code(400).send({
        error: 'INVALID_DATA_TYPE',
        message: `Invalid data type: ${dataType}`,
      });
    }

    const pool = getTsdbPool();
    const conditions = ['time >= $1', 'time <= $2'];
    const params: any[] = [new Date(from), new Date(to)];

    if (entityId) {
      conditions.push('entity_id = $3');
      params.push(entityId);
    }

    const result = await pool.query(
      `DELETE FROM ${table} WHERE ${conditions.join(' AND ')}`,
      params
    );

    return {
      deleted: result.rowCount ?? 0,
      dataType,
      from,
      to,
    };
  });
}
