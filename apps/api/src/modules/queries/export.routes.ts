import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';
import { errorResponses } from '../../lib/error-schemas.js';
import { getConfigOrDefault } from '../data-ingestion/ingestion-config.service.js';

// ─── Helpers ─────────────────────────────────────────────

function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows.map(row =>
    cols.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  ).join('\n');
  return header + '\n' + body;
}

function validateDateRange(from: string, to: string, maxDays: number): { valid: boolean; error?: string } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return { valid: false, error: 'Invalid date format' };
  if (fromDate >= toDate) return { valid: false, error: 'from must be before to' };
  const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > maxDays) return { valid: false, error: `Date range exceeds maximum of ${maxDays} days` };
  return { valid: true };
}

// ─── Routes ──────────────────────────────────────────────

export default async function exportRoutes(app: FastifyInstance) {

  // 1. GET /telemetry/:entityId — Export telemetry as CSV or JSON
  app.get('/telemetry/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Export'],
      summary: 'Export telemetry data',
      description: 'Export telemetry data for an entity as CSV or JSON. Supports date range filtering, key filtering, and configurable row limits.',
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
          from: { type: 'string', format: 'date-time', description: 'Start date (ISO 8601)' },
          to: { type: 'string', format: 'date-time', description: 'End date (ISO 8601)' },
          format: { type: 'string', enum: ['csv', 'json'], default: 'csv', description: 'Export format' },
          keys: { type: 'string', description: 'Comma-separated telemetry keys to include' },
        },
      },
      response: {
        200: {
          description: 'CSV file stream or JSON array',
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const query = req.query as {
      from: string;
      to: string;
      format?: string;
      keys?: string;
    };

    const format = query.format ?? 'csv';
    const maxRangeDays = await getConfigOrDefault<number>('export.max_range_days', 90);
    const maxRows = Math.min(
      await getConfigOrDefault<number>('export.max_rows', 100000),
      100000 // Hard cap regardless of config
    );

    const rangeCheck = validateDateRange(query.from, query.to, maxRangeDays);
    if (!rangeCheck.valid) {
      return reply.code(400).send({ error: 'INVALID_DATE_RANGE', message: rangeCheck.error });
    }

    const pool = getTsdbPool();
    const params: unknown[] = [entityId, new Date(query.from), new Date(query.to), maxRows + 1];
    let keysFilter = '';

    if (query.keys) {
      const keyList = query.keys.split(',').map(k => k.trim()).filter(Boolean);
      if (keyList.length > 0) {
        keysFilter = ' AND key = ANY($5)';
        params.push(keyList);
      }
    }

    const result = await pool.query(
      `SELECT time, entity_id, key, value_num, value_str, value_bool, value_json, uns_path, source, source_ip
       FROM ts_telemetry
       WHERE entity_id = $1 AND time >= $2 AND time < $3${keysFilter}
       ORDER BY time ASC
       LIMIT $4`,
      params,
    );

    const rows = result.rows as Record<string, unknown>[];
    const truncated = rows.length > maxRows;
    const outputRows = truncated ? rows.slice(0, maxRows) : rows;

    if (truncated) {
      reply.header('X-DigiLog-Truncated', 'true');
    }

    if (format === 'csv') {
      const csvString = toCsv(outputRows);
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="telemetry-${entityId}-${Date.now()}.csv"`);
      return reply.send(csvString);
    }

    return outputRows;
  });

  // 2. GET /checklist/:entityId — Export checklist responses
  app.get('/checklist/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Export'],
      summary: 'Export checklist responses',
      description: 'Export checklist responses for an entity as CSV or JSON. Combines data from ChecklistReview (PG) and ts_checklist_responses (TSDB).',
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
          from: { type: 'string', format: 'date-time', description: 'Start date (ISO 8601)' },
          to: { type: 'string', format: 'date-time', description: 'End date (ISO 8601)' },
          format: { type: 'string', enum: ['csv', 'json'], default: 'csv', description: 'Export format' },
        },
      },
      response: {
        200: {
          description: 'CSV file stream or JSON array',
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const query = req.query as {
      from: string;
      to: string;
      format?: string;
    };

    const format = query.format ?? 'csv';
    const maxRangeDays = await getConfigOrDefault<number>('export.max_range_days', 90);
    const maxRows = Math.min(
      await getConfigOrDefault<number>('export.max_rows', 100000),
      100000 // Hard cap regardless of config
    );

    const rangeCheck = validateDateRange(query.from, query.to, maxRangeDays);
    if (!rangeCheck.valid) {
      return reply.code(400).send({ error: 'INVALID_DATE_RANGE', message: rangeCheck.error });
    }

    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);

    // Fetch ChecklistReview records from PG
    const reviews = await prisma.checklistReview.findMany({
      where: {
        entityId,
        performedAt: { gte: fromDate, lt: toDate },
      },
      orderBy: { performedAt: 'asc' },
      take: maxRows,
    });

    // Fetch ts_checklist_responses from TSDB
    const pool = getTsdbPool();
    const tsResult = await pool.query(
      `SELECT time, entity_id, template_id, checklist_id, submitted_by, answers, answers_hash, uns_path, source_ip
       FROM ts_checklist_responses
       WHERE entity_id = $1 AND time >= $2 AND time < $3
       ORDER BY time ASC
       LIMIT $4`,
      [entityId, fromDate, toDate, maxRows + 1],
    );

    const tsRows = tsResult.rows as Record<string, unknown>[];
    const truncated = tsRows.length > maxRows;
    const outputTsRows = truncated ? tsRows.slice(0, maxRows) : tsRows;

    if (truncated) {
      reply.header('X-DigiLog-Truncated', 'true');
    }

    // Merge: build a map from checklistId -> review, then combine with TSDB rows
    const reviewMap = new Map(reviews.map(r => [r.checklistId, r]));
    const mergedRows = outputTsRows.map(tsRow => {
      const review = reviewMap.get(tsRow.checklist_id as string);
      return {
        time: tsRow.time,
        entity_id: tsRow.entity_id,
        template_id: tsRow.template_id,
        checklist_id: tsRow.checklist_id,
        submitted_by: tsRow.submitted_by,
        answers: tsRow.answers,
        answers_hash: tsRow.answers_hash,
        uns_path: tsRow.uns_path,
        source_ip: tsRow.source_ip,
        review_status: review?.currentStep ?? null,
        review_sequence: review?.currentSequence ?? null,
        checked_by: review?.checkedBy ?? null,
        checked_at: review?.checkedAt ?? null,
        checked_remarks: review?.checkedRemarks ?? null,
      };
    });

    if (format === 'csv') {
      const csvString = toCsv(mergedRows as Record<string, unknown>[]);
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="checklist-${entityId}-${Date.now()}.csv"`);
      return reply.send(csvString);
    }

    return mergedRows;
  });

  // 3. GET /attributes/:entityId — Export attribute history
  app.get('/attributes/:entityId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Export'],
      summary: 'Export attribute history',
      description: 'Export attribute change history for an entity from TSDB as CSV or JSON. Optionally filter by attribute key.',
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
          from: { type: 'string', format: 'date-time', description: 'Start date (ISO 8601)' },
          to: { type: 'string', format: 'date-time', description: 'End date (ISO 8601)' },
          format: { type: 'string', enum: ['csv', 'json'], default: 'csv', description: 'Export format' },
          key: { type: 'string', description: 'Filter by attribute key' },
        },
      },
      response: {
        200: {
          description: 'CSV file stream or JSON array',
          type: 'array',
          items: { type: 'object', additionalProperties: true },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const query = req.query as {
      from: string;
      to: string;
      format?: string;
      key?: string;
    };

    const format = query.format ?? 'csv';
    const maxRangeDays = await getConfigOrDefault<number>('export.max_range_days', 90);
    const maxRows = Math.min(
      await getConfigOrDefault<number>('export.max_rows', 100000),
      100000 // Hard cap regardless of config
    );

    const rangeCheck = validateDateRange(query.from, query.to, maxRangeDays);
    if (!rangeCheck.valid) {
      return reply.code(400).send({ error: 'INVALID_DATE_RANGE', message: rangeCheck.error });
    }

    const pool = getTsdbPool();
    const params: unknown[] = [entityId, new Date(query.from), new Date(query.to), maxRows + 1];
    let keyFilter = '';

    if (query.key) {
      keyFilter = ' AND key = $5';
      params.push(query.key);
    }

    const result = await pool.query(
      `SELECT time, entity_id, scope, key, value_num, value_str, value_bool, value_json, updated_by, uns_path, source_ip
       FROM ts_attributes
       WHERE entity_id = $1 AND time >= $2 AND time < $3${keyFilter}
       ORDER BY time ASC
       LIMIT $4`,
      params,
    );

    const rows = result.rows as Record<string, unknown>[];
    const truncated = rows.length > maxRows;
    const outputRows = truncated ? rows.slice(0, maxRows) : rows;

    if (truncated) {
      reply.header('X-DigiLog-Truncated', 'true');
    }

    if (format === 'csv') {
      const csvString = toCsv(outputRows);
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="attributes-${entityId}-${Date.now()}.csv"`);
      return reply.send(csvString);
    }

    return outputRows;
  });

  // 4. GET /status/:jobId — Check async export job status (stub)
  app.get('/status/:jobId', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Export'],
      summary: 'Check async export job status',
      description: 'Stub endpoint for future async export processing. Returns not_implemented status.',
      params: {
        type: 'object',
        required: ['jobId'],
        properties: {
          jobId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async () => {
    return {
      status: 'not_implemented',
      message: 'Async exports will be available in a future update',
    };
  });
}
