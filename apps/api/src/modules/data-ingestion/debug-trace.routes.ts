/**
 * Debug Traces Routes — Query pipeline execution traces from ts_pipeline_traces.
 *
 * GET  /             — Paginated list of traces
 * GET  /stats        — Summary statistics (success rates, avg duration, top errors)
 * GET  /:id          — Single trace detail
 * PUT  /entity/:entityId/toggle — Toggle per-entity tracing
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';
import { errorResponses } from '../../lib/error-schemas.js';
import { auditLog } from '../../lib/audit.js';

export default async function debugTraceRoutes(app: FastifyInstance) {

  const pool = getTsdbPool();

  // 1. GET / — Paginated list of traces
  app.get('/', {
    preHandler: [app.requirePermission('READ_DEBUG_TRACE')],
    schema: {
      tags: ['Debug Traces'],
      summary: 'List pipeline traces',
      description: 'Paginated list of pipeline execution traces with optional filters.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1, minimum: 1 },
          pageSize: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          status: { type: 'string', enum: ['SUCCESS', 'SUCCESS_WITH_WARNINGS', 'FAILED', 'DLQ'] },
          transport: { type: 'string', enum: ['MQTT', 'HTTP', 'WebSocket', 'mqtt', 'http', 'websocket'] },
          errorCode: { type: 'string' },
          entityId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
      page?: number;
      pageSize?: number;
      status?: string;
      transport?: string;
      errorCode?: string;
      entityId?: string;
      from?: string;
      to?: string;
    };

    const page = query.page ?? 1;
    const limit = Math.min(query.pageSize ?? 20, 100);
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (query.status) {
      conditions.push(`final_status = $${paramIdx++}`);
      params.push(query.status);
    }
    if (query.transport) {
      conditions.push(`LOWER(transport) = LOWER($${paramIdx++})`);
      params.push(query.transport);
    }
    if (query.errorCode) {
      conditions.push(`error_code ILIKE $${paramIdx++}`);
      params.push(`%${query.errorCode}%`);
    }
    if (query.entityId) {
      conditions.push(`(entity_id::text ILIKE $${paramIdx} OR entity_name ILIKE $${paramIdx})`);
      params.push(`%${query.entityId}%`);
      paramIdx++;
    }
    if (query.from) {
      conditions.push(`time >= $${paramIdx++}`);
      params.push(new Date(query.from));
    }
    if (query.to) {
      conditions.push(`time <= $${paramIdx++}`);
      params.push(new Date(query.to));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total FROM ts_pipeline_traces ${whereClause}`,
      params,
    );
    const total = countResult.rows[0]?.total ?? 0;

    const dataResult = await pool.query(
      `SELECT id, time, message_id as "messageId", entity_id as "entityId",
              entity_name as "entityName", transport, message_type as "messageType",
              payload_size as "payloadSize", stages, final_status as "finalStatus",
              failed_stage as "failedStage", error_code as "errorCode",
              error_message as "errorMessage", warnings,
              total_duration_ms as "totalDurationMs"
       FROM ts_pipeline_traces ${whereClause}
       ORDER BY time DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return {
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  });

  // 2. GET /stats — Summary statistics
  app.get('/stats', {
    preHandler: [app.requirePermission('READ_DEBUG_TRACE')],
    schema: {
      tags: ['Debug Traces'],
      summary: 'Get pipeline trace statistics',
      description: 'Returns success rates, average duration, top errors, and breakdown by transport.',
      response: {
        200: {
          type: 'object',
          properties: {
            successRate1h: { type: 'number' },
            successRate24h: { type: 'number' },
            avgDurationMs: { type: 'number' },
            topErrors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  count: { type: 'integer' },
                },
              },
            },
            byTransport: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  failed: { type: 'integer' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    const rate1h = await pool.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE final_status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS'))::int as success
      FROM ts_pipeline_traces
      WHERE time > NOW() - INTERVAL '1 hour'
    `);
    const total1h = rate1h.rows[0]?.total ?? 0;
    const success1h = rate1h.rows[0]?.success ?? 0;
    const successRate1h = total1h > 0 ? Math.round((success1h / total1h) * 10000) / 100 : 0;

    const rate24h = await pool.query(`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE final_status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS'))::int as success
      FROM ts_pipeline_traces
      WHERE time > NOW() - INTERVAL '24 hours'
    `);
    const total24h = rate24h.rows[0]?.total ?? 0;
    const success24h = rate24h.rows[0]?.success ?? 0;
    const successRate24h = total24h > 0 ? Math.round((success24h / total24h) * 10000) / 100 : 0;

    const avgResult = await pool.query(`
      SELECT COALESCE(AVG(total_duration_ms), 0)::float as avg_ms
      FROM ts_pipeline_traces
      WHERE time > NOW() - INTERVAL '24 hours'
    `);
    const avgDurationMs = Math.round(avgResult.rows[0]?.avg_ms ?? 0);

    const errorsResult = await pool.query(`
      SELECT error_code as code, COUNT(*)::int as count
      FROM ts_pipeline_traces
      WHERE error_code IS NOT NULL AND time > NOW() - INTERVAL '24 hours'
      GROUP BY error_code
      ORDER BY count DESC
      LIMIT 10
    `);

    const transportResult = await pool.query(`
      SELECT
        transport,
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE final_status IN ('FAILED', 'DLQ'))::int as failed
      FROM ts_pipeline_traces
      WHERE time > NOW() - INTERVAL '24 hours'
      GROUP BY transport
    `);

    const byTransport: Record<string, { total: number; failed: number }> = {};
    for (const row of transportResult.rows) {
      byTransport[row.transport] = { total: row.total, failed: row.failed };
    }

    return {
      successRate1h,
      successRate24h,
      avgDurationMs,
      topErrors: errorsResult.rows,
      byTransport,
    };
  });

  // 3. GET /:id — Single trace detail
  app.get('/:id', {
    preHandler: [app.requirePermission('READ_DEBUG_TRACE')],
    schema: {
      tags: ['Debug Traces'],
      summary: 'Get trace detail',
      description: 'Returns full detail for a single pipeline trace by ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const result = await pool.query(
      `SELECT id, time, message_id as "messageId", entity_id as "entityId",
              entity_name as "entityName", transport, message_type as "messageType",
              payload_size as "payloadSize", stages, final_status as "finalStatus",
              failed_stage as "failedStage", error_code as "errorCode",
              error_message as "errorMessage", warnings,
              total_duration_ms as "totalDurationMs"
       FROM ts_pipeline_traces WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Trace not found' });
    }

    return result.rows[0];
  });

  // 4. PUT /entity/:entityId/toggle — Toggle per-entity tracing
  app.put('/entity/:entityId/toggle', {
    preHandler: [app.requirePermission('MANAGE_DEBUG_TRACE')],
    schema: {
      tags: ['Debug Traces'],
      summary: 'Toggle entity tracing',
      description: 'Enable or disable pipeline tracing for a specific entity.',
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
            entityId: { type: 'string' },
            traceEnabled: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { entityId } = req.params as { entityId: string };
    const user = (req as any).user as { username: string; role: string };
    const cfgKey = `pipeline.trace_entity.${entityId}`;

    const existing = await prisma.ingestionSystemConfig.findUnique({
      where: { key: cfgKey },
    });

    const currentlyEnabled = existing?.value === 'true';
    const newValue = !currentlyEnabled;

    await prisma.ingestionSystemConfig.upsert({
      where: { key: cfgKey },
      create: {
        key: cfgKey,
        value: String(newValue),
        dataType: 'BOOLEAN',
        category: 'pipeline',
        label: `Trace entity ${entityId}`,
        defaultValue: 'false',
      },
      update: { value: String(newValue) },
    });

    await auditLog({
      userId: user.username, userRole: user.role, action: 'CONFIG_CHANGED',
      targetType: 'debug_trace', targetId: entityId,
      beforeValue: { traceEnabled: currentlyEnabled },
      afterValue: { traceEnabled: newValue },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return { entityId, traceEnabled: newValue };
  });
}
