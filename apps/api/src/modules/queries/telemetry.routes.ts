import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';
import { errorResponses } from '../../lib/error-schemas.js';

// Valid aggregation functions for time-series queries
const VALID_AGGREGATIONS = ['none', 'avg', 'min', 'max', 'sum', 'count'] as const;
type Aggregation = (typeof VALID_AGGREGATIONS)[number];

// Valid bucket intervals for time_bucket
const VALID_INTERVALS = ['auto', '1m', '5m', '15m', '1h', '1d'] as const;
type Interval = (typeof VALID_INTERVALS)[number];

// Map shorthand intervals to PostgreSQL interval literals
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '1d': '1 day',
};

/**
 * Choose an appropriate bucket interval based on the time range.
 */
function autoInterval(fromMs: number, toMs: number): string {
  const spanMs = toMs - fromMs;
  const spanMinutes = spanMs / 60_000;

  if (spanMinutes <= 60) return '1 minute';
  if (spanMinutes <= 360) return '5 minutes';
  if (spanMinutes <= 1440) return '15 minutes';
  if (spanMinutes <= 10080) return '1 hour';
  return '1 day';
}

export default async function telemetryRoutes(app: FastifyInstance) {

  // ─────────────────────────────────────────────────────────
  // 1. GET /telemetry/:entityId/latest — Latest telemetry values
  // ─────────────────────────────────────────────────────────
  app.get('/telemetry/:entityId/latest', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Telemetry'],
      summary: 'Get latest telemetry values for an entity',
      description: 'Returns the most recent value for every telemetry key associated with the given entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              valueNum: { type: ['number', 'null'], nullable: true },
              valueStr: { type: ['string', 'null'], nullable: true },
              valueBool: { type: ['boolean', 'null'], nullable: true },
              valueJson: { type: ['object', 'null'], nullable: true, additionalProperties: true },
              lastUpdated: { type: 'string', format: 'date-time' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };

    const rows = await prisma.latestTelemetry.findMany({
      where: { entityId },
      select: {
        key: true,
        valueNum: true,
        valueStr: true,
        valueBool: true,
        valueJson: true,
        lastUpdated: true,
      },
    });

    return rows;
  });

  // ─────────────────────────────────────────────────────────
  // 2. GET /telemetry/:entityId/timeseries — Time-range query
  // ─────────────────────────────────────────────────────────
  app.get('/telemetry/:entityId/timeseries', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Telemetry'],
      summary: 'Query telemetry time-series data',
      description: 'Returns telemetry data for an entity within a time range, with optional aggregation and bucketing.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string', format: 'date-time', description: 'ISO 8601 start time' },
          to: { type: 'string', format: 'date-time', description: 'ISO 8601 end time' },
          keys: { type: 'string', description: 'Comma-separated telemetry keys to filter' },
          aggregation: {
            type: 'string',
            enum: ['none', 'avg', 'min', 'max', 'sum', 'count'],
            default: 'none',
            description: 'Aggregation function to apply',
          },
          interval: {
            type: 'string',
            enum: ['auto', '1m', '5m', '15m', '1h', '1d'],
            default: 'auto',
            description: 'Time bucket interval (used with aggregation)',
          },
          limit: {
            type: 'integer',
            default: 10000,
            minimum: 1,
            maximum: 50000,
            description: 'Maximum number of data points to return',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            meta: {
              type: 'object',
              properties: {
                entityId: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                aggregation: { type: 'string' },
                interval: { type: ['string', 'null'], nullable: true },
                totalPoints: { type: 'integer' },
                aggregated: { type: 'boolean' },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const query = req.query as {
      from: string;
      to: string;
      keys?: string;
      aggregation?: string;
      interval?: string;
      limit?: number;
    };

    const from = query.from;
    const to = query.to;
    const keysRaw = query.keys?.split(',').map((k) => k.trim()).filter(Boolean);
    const aggregation: Aggregation = (VALID_AGGREGATIONS as readonly string[]).includes(query.aggregation ?? '')
      ? (query.aggregation as Aggregation)
      : 'none';
    const interval: Interval = (VALID_INTERVALS as readonly string[]).includes(query.interval ?? '')
      ? (query.interval as Interval)
      : 'auto';
    const limit = Math.min(Math.max(query.limit ?? 10000, 1), 50000);

    const pool = getTsdbPool();
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Build key filter clause
    let keyFilterClause = '';
    const baseParams: unknown[] = [entityId, fromDate, toDate];
    let paramIdx = 4; // next param index ($4, $5, ...)

    if (keysRaw && keysRaw.length > 0) {
      const placeholders = keysRaw.map(() => `$${paramIdx++}`);
      keyFilterClause = ` AND key IN (${placeholders.join(', ')})`;
      baseParams.push(...keysRaw);
    }

    let wasAutoAggregated = false;
    let effectiveAggregation = aggregation;
    let effectiveInterval: string | null = null;

    if (aggregation === 'none') {
      // Raw query — but first check count to potentially auto-aggregate
      const countSql = `SELECT COUNT(*)::int AS cnt FROM ts_telemetry WHERE entity_id = $1 AND time >= $2 AND time <= $3${keyFilterClause}`;
      const countResult = await pool.query(countSql, baseParams);
      const rawCount: number = countResult.rows[0]?.cnt ?? 0;

      if (rawCount > limit) {
        // Auto-aggregate with avg
        wasAutoAggregated = true;
        effectiveAggregation = 'avg';
        effectiveInterval = autoInterval(fromDate.getTime(), toDate.getTime());
      }
    }

    let data: unknown[];

    if (effectiveAggregation === 'none') {
      // Raw query
      const sql = `SELECT time, key, value_num, value_str, value_bool, value_json FROM ts_telemetry WHERE entity_id = $1 AND time >= $2 AND time <= $3${keyFilterClause} ORDER BY time ASC LIMIT $${paramIdx}`;
      const params = [...baseParams, limit];
      const result = await pool.query(sql, params);
      data = result.rows;
    } else {
      // Aggregated query
      const resolvedInterval = effectiveInterval
        ?? (interval === 'auto' ? autoInterval(fromDate.getTime(), toDate.getTime()) : INTERVAL_MAP[interval]);
      effectiveInterval = resolvedInterval;

      const aggFn = effectiveAggregation.toUpperCase();
      const sql = `SELECT time_bucket($${paramIdx}::interval, time) AS bucket, key, ${aggFn}(value_num) AS value FROM ts_telemetry WHERE entity_id = $1 AND time >= $2 AND time <= $3${keyFilterClause} GROUP BY bucket, key ORDER BY bucket ASC`;
      const params = [...baseParams, resolvedInterval];
      const result = await pool.query(sql, params);
      data = result.rows;
    }

    if (wasAutoAggregated) {
      reply.header('X-DigiLog-Aggregated', 'true');
    }

    return {
      data,
      meta: {
        entityId,
        from,
        to,
        aggregation: effectiveAggregation,
        interval: effectiveInterval,
        totalPoints: data.length,
        aggregated: effectiveAggregation !== 'none',
      },
    };
  });

  // ─────────────────────────────────────────────────────────
  // 3. GET /telemetry/:entityId/keys — Available telemetry keys
  // ─────────────────────────────────────────────────────────
  app.get('/telemetry/:entityId/keys', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Telemetry'],
      summary: 'List available telemetry keys for an entity',
      description: 'Returns all active data stream keys registered for the given entity.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              dataType: { type: 'string' },
              source: { type: 'string' },
              unsPath: { type: 'string' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };

    const streams = await prisma.dataStream.findMany({
      where: { entityId, isActive: true },
      select: {
        key: true,
        dataType: true,
        source: true,
        unsPath: true,
        updatedAt: true,
      },
    });

    return streams;
  });

  // ─────────────────────────────────────────────────────────
  // 4. GET /attributes/:entityId/:scope — Current attributes by scope
  // ─────────────────────────────────────────────────────────
  app.get('/attributes/:entityId/:scope', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Attributes'],
      summary: 'Get current attributes for an entity by scope',
      description: 'Returns the latest value for each attribute key. Scope can be "client", "server", or "all".',
      params: {
        type: 'object',
        required: ['entityId', 'scope'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          scope: { type: 'string', enum: ['client', 'server', 'all'] },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: ['string', 'number', 'boolean', 'object', 'null'], nullable: true },
              updatedBy: { type: ['string', 'null'], nullable: true },
              lastUpdated: { type: 'string', format: 'date-time' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId, scope } = req.params as { entityId: string; scope: 'client' | 'server' | 'all' };

    if (!['client', 'server', 'all'].includes(scope)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Scope must be "client", "server", or "all".' });
    }

    const pool = getTsdbPool();
    const params: unknown[] = [entityId];
    let scopeClause = '';

    if (scope !== 'all') {
      scopeClause = ' AND scope = $2';
      params.push(scope);
    }

    const sql = `SELECT DISTINCT ON (key) key, value_num, value_str, value_bool, value_json, updated_by, time FROM ts_attributes WHERE entity_id = $1${scopeClause} ORDER BY key, time DESC`;

    const result = await pool.query(sql, params);

    const rows = result.rows.map((row: Record<string, unknown>) => {
      // Coalesce the typed value columns into a single "value"
      let value: unknown = null;
      if (row.value_json !== null && row.value_json !== undefined) {
        value = row.value_json;
      } else if (row.value_bool !== null && row.value_bool !== undefined) {
        value = row.value_bool;
      } else if (row.value_num !== null && row.value_num !== undefined) {
        value = row.value_num;
      } else if (row.value_str !== null && row.value_str !== undefined) {
        value = row.value_str;
      }

      return {
        key: row.key,
        value,
        updatedBy: row.updated_by ?? null,
        lastUpdated: row.time,
      };
    });

    return rows;
  });

  // ─────────────────────────────────────────────────────────
  // 5. GET /attributes/:entityId/history — Attribute change history
  // ─────────────────────────────────────────────────────────
  app.get('/attributes/:entityId/history', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Attributes'],
      summary: 'Get attribute change history for an entity',
      description: 'Returns paginated attribute change history within a time range, optionally filtered by key.',
      params: {
        type: 'object',
        required: ['entityId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string', format: 'date-time', description: 'ISO 8601 start time' },
          to: { type: 'string', format: 'date-time', description: 'ISO 8601 end time' },
          key: { type: 'string', description: 'Optional attribute key to filter' },
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
        },
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
                  time: { type: 'string', format: 'date-time' },
                  key: { type: 'string' },
                  scope: { type: 'string' },
                  valueNum: { type: ['number', 'null'], nullable: true },
                  valueStr: { type: ['string', 'null'], nullable: true },
                  valueBool: { type: ['boolean', 'null'], nullable: true },
                  valueJson: { type: ['object', 'null'], nullable: true, additionalProperties: true },
                  updatedBy: { type: ['string', 'null'], nullable: true },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };
    const query = req.query as {
      from: string;
      to: string;
      key?: string;
      page?: number;
      limit?: number;
    };

    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = (page - 1) * limit;
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);

    const pool = getTsdbPool();
    const params: unknown[] = [entityId, fromDate, toDate];
    let paramIdx = 4;
    let keyClause = '';

    if (query.key) {
      keyClause = ` AND key = $${paramIdx}`;
      params.push(query.key);
      paramIdx++;
    }

    // Count total rows for pagination
    const countSql = `SELECT COUNT(*)::int AS cnt FROM ts_attributes WHERE entity_id = $1 AND time >= $2 AND time <= $3${keyClause}`;
    const countResult = await pool.query(countSql, params);
    const total: number = countResult.rows[0]?.cnt ?? 0;

    // Fetch the page
    const dataSql = `SELECT time, key, scope, value_num, value_str, value_bool, value_json, updated_by FROM ts_attributes WHERE entity_id = $1 AND time >= $2 AND time <= $3${keyClause} ORDER BY time DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(dataSql, dataParams);

    const data = dataResult.rows.map((row: Record<string, unknown>) => ({
      time: row.time,
      key: row.key,
      scope: row.scope,
      valueNum: row.value_num ?? null,
      valueStr: row.value_str ?? null,
      valueBool: row.value_bool ?? null,
      valueJson: row.value_json ?? null,
      updatedBy: row.updated_by ?? null,
    }));

    return {
      data,
      total,
      page,
      limit,
    };
  });

  // ─────────────────────────────────────────────────────────
  // 6. GET /checklist/:entityId/responses — List checklist responses
  // ─────────────────────────────────────────────────────────
  app.get('/checklist/:entityId/responses', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Checklists'],
      summary: 'List checklist responses for an entity',
      description: 'Returns paginated checklist review records for the given entity.',
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
          page: { type: 'integer', default: 1, minimum: 1 },
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
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
    const query = req.query as { page?: number; limit?: number };

    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.checklistReview.findMany({
        where: { entityId },
        orderBy: { performedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.checklistReview.count({
        where: { entityId },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // ─────────────────────────────────────────────────────────
  // 7. GET /checklist/:entityId/responses/:checklistId — Single response
  // ─────────────────────────────────────────────────────────
  app.get('/checklist/:entityId/responses/:checklistId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Checklists'],
      summary: 'Get a single checklist response with review status and answers',
      description: 'Returns the checklist review record from Prisma along with the corresponding answers from the TSDB.',
      params: {
        type: 'object',
        required: ['entityId', 'checklistId'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          checklistId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            review: { type: 'object', additionalProperties: true },
            answers: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId, checklistId } = req.params as { entityId: string; checklistId: string };

    // Fetch the review record from Prisma
    const review = await prisma.checklistReview.findUnique({
      where: { checklistId },
    });

    if (!review || review.entityId !== entityId) {
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: 'Checklist response not found.',
      });
    }

    // Fetch answers from TSDB
    const pool = getTsdbPool();
    const answersSql = `SELECT * FROM ts_checklist_responses WHERE checklist_id = $1 ORDER BY time ASC`;
    const answersResult = await pool.query(answersSql, [checklistId]);

    return {
      review,
      answers: answersResult.rows,
    };
  });
}
