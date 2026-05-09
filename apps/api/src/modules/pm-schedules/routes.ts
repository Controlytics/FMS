/**
 * PM Schedule Routes — CRUD + CSV upload + execution tracking.
 */
import type { FastifyInstance } from 'fastify';
import * as XLSX from 'xlsx';
import { PmScheduleService } from './pm-schedule.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';

export default async function pmScheduleRoutes(app: FastifyInstance) {
  const service = new PmScheduleService();

  // ─── Template download ───
  app.get('/template.csv', {
    preHandler: [app.requireAnyPermission('PM_READ', 'PM_DOWNLOAD_TEMPLATE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Download the PM schedule bulk-upload template (CSV)',
      response: { 200: { type: 'string' }, ...errorResponses },
    },
  }, async (_req, reply) => {
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="pm-schedule-template.csv"');
    return service.getTemplateCsv();
  });

  // ─── Bulk upload CSV/XLSX ───
  app.post('/upload', {
    preHandler: [app.requireAnyPermission('PM_CREATE', 'PM_UPLOAD')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Bulk upload PM schedule entries from a CSV or XLSX file',
      description:
        'Accepts multipart/form-data with a single `.csv` or `.xlsx` file. Expected columns: ahu_name, scheduled_date, tolerance_days (optional). Returns per-row imported/skipped counts.',
      consumes: ['multipart/form-data'],
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    // Audit 2026-05-09 fix: bulk PM upload was a high-trust mutation with
    // no password challenge. SUPER_ADMIN uploads auto-approve every row
    // (pm-import.ts:133), so a left-unlocked tablet could blast hundreds
    // of approved entries. Reauth gate runs BEFORE multipart consumption
    // for the same reason as the C2 audit fix on bulk-upload-filters.
    const { ok } = await enforceReauth('UPLOAD_PM_SCHEDULES', req, reply);
    if (!ok) return;
    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: 'NO_FILE', message: 'No file uploaded' });
      }

      const filename = data.filename ?? 'upload';
      const lower = filename.toLowerCase();
      const isXlsx = lower.endsWith('.xlsx') || lower.endsWith('.xls');
      const isCsv = lower.endsWith('.csv');
      if (!isXlsx && !isCsv) {
        return reply.code(400).send({ error: 'INVALID_FILE_TYPE', message: 'Only .csv, .xls, and .xlsx files are accepted' });
      }

      // Buffer the file — xlsx lib needs the full content in memory
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      if (buffer.length > 5 * 1024 * 1024) {
        return reply.code(400).send({ error: 'FILE_TOO_LARGE', message: 'File exceeds 5 MB limit' });
      }

      // Parse with SheetJS — handles both CSV and XLSX via the same API.
      // We deliberately do NOT pass `cellDates: true` or `raw: false`: for CSV
      // uploads the values arrive as strings (natural), and we want to keep
      // them as strings so "2026-04-12" is parsed as UTC midnight, not as a
      // locale-formatted date that gets re-parsed through the server's
      // timezone and shifted by a day. Users uploading XLSX should format
      // date cells as text or use the YYYY-MM-DD ISO format.
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } catch (e: any) {
        return reply.code(400).send({ error: 'PARSE_ERROR', message: `Failed to parse file: ${e.message ?? String(e)}` });
      }
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return reply.code(400).send({ error: 'EMPTY_FILE', message: 'File contains no sheets' });
      }
      const sheet = workbook.Sheets[firstSheetName];
      // raw:true keeps values in their native SheetJS form. For a CSV that
      // means strings stay strings EXCEPT that "2026-04-12"-style cells get
      // auto-parsed as Excel date serial numbers (floats). The service
      // handles both shapes — Date/number/string.
      const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '', raw: true });

      // Skip any row that looks like a comment line (starts with '#' in any column)
      const rows = rawRows.filter(r => {
        const first = Object.values(r)[0];
        return !(typeof first === 'string' && first.trim().startsWith('#'));
      });

      if (rows.length === 0) {
        return reply.code(400).send({ error: 'NO_ROWS', message: 'File has no data rows' });
      }

      const ctx = buildContext(req);
      const result = await service.importSchedules(ctx, rows);
      return result;
    } catch (err: any) {
      app.log.error({ err }, 'PM schedule upload failed');
      if (err.statusCode === 415 || err.message?.includes('multipart')) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Request must be multipart/form-data with a file' });
      }
      return reply.code(500).send({ error: 'UPLOAD_FAILED', message: err.message ?? 'Failed to process upload' });
    }
  });

  // ─── AHU filter-set mode config ───
  // Per-AHU setting controlling which filters count toward PM completion.
  // Stored in AssetInstance.customAttributes.pmFilterSetMode.
  // Listed before the parametric /:entityId route.
  app.get('/ahu-configs', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'List AHUs with their current PM filter-set mode and filter counts',
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.listAhuFilterSetConfigs(ctx);
  });

  app.put('/ahu-configs/:ahuId', {
    preHandler: [app.requirePermission('PM_UPDATE')],
    schema: {
      tags: ['PM Schedules'],
      summary: "Update an AHU's PM filter-set mode",
      params: { type: 'object', required: ['ahuId'], properties: { ahuId: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['mode'],
        properties: {
          mode: { type: 'string', enum: ['BOTH', 'SET_A', 'SET_B', 'DISABLED'] },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    // Audit 2026-05-04 fix #5 (web-routes review H — lower-blast config
    // surfaces). Routed through the umbrella UPDATE_CONFIG_PAGE action.
    const { ok } = await enforceReauth('UPDATE_CONFIG_PAGE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { ahuId } = req.params as { ahuId: string };
    const { mode } = req.body as { mode: 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED' };
    return service.updateAhuFilterSetMode(ctx, ahuId, mode);
  });

  // ─── Entry-level approval workflow ───

  app.get('/entries', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'List schedule entries with approval status',
      querystring: {
        type: 'object',
        properties: {
          approvalStatus: { type: 'string', enum: ['ALL', 'PENDING', 'APPROVED', 'REJECTED'] },
          year: { type: 'integer' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const query = req.query as any;
    return service.listEntries(ctx, query);
  });

  app.get('/entries/pending-counts', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Get counts of pending and rejected entries',
      response: { 200: { type: 'object', properties: { pending: { type: 'integer' }, rejected: { type: 'integer' } } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.pendingCounts(ctx);
  });

  app.post('/entries/approve', {
    preHandler: [app.requirePermission('PM_APPROVE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Approve selected schedule entries',
      body: {
        type: 'object',
        required: ['entryIds'],
        properties: {
          entryIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
          comment: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('APPROVE_PM_SCHEDULE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { entryIds, comment } = req.body as { entryIds: string[]; comment?: string };
    return service.approveEntries(ctx, entryIds, comment);
  });

  app.post('/entries/reject', {
    preHandler: [app.requirePermission('PM_APPROVE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Reject selected schedule entries with remarks',
      body: {
        type: 'object',
        required: ['entryIds', 'remarks'],
        properties: {
          entryIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
          remarks: { type: 'string', minLength: 3 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REJECT_PM_SCHEDULE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { entryIds, remarks } = req.body as { entryIds: string[]; remarks: string };
    return service.rejectEntries(ctx, entryIds, remarks);
  });

  app.post('/entries/:id/resubmit', {
    preHandler: [app.requireAnyPermission('PM_CREATE', 'PM_RESUBMIT')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Re-submit a rejected entry with corrected data',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['plannedDate'],
        properties: {
          plannedDate: { type: 'string' },
          toleranceDays: { type: 'integer', minimum: 0, maximum: 365 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    // Audit 2026-05-09 fix: resubmit flips REJECTED → PENDING. Approve and
    // reject already reauth — gate this for parity so all three lifecycle
    // transitions on a PM entry are challengeable.
    const { ok } = await enforceReauth('RESUBMIT_PM_ENTRY', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as { plannedDate: string; toleranceDays?: number };
    return service.resubmitEntry(ctx, id, body);
  });

  app.put('/entries/:id/edit', {
    preHandler: [app.requireAnyPermission('PM_UPDATE', 'PM_EDIT_ENTRY')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Edit an approved entry (creates pending change for QA review)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['plannedDate'],
        properties: {
          plannedDate: { type: 'string' },
          toleranceDays: { type: 'integer', minimum: 0, maximum: 365 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('EDIT_PM_SCHEDULE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    const body = req.body as { plannedDate: string; toleranceDays?: number };
    return service.editApprovedEntry(ctx, id, body);
  });

  // ─── My Tasks: list due entries ───
  // Registered BEFORE the parametric /:entityId route so /due is matched as a
  // literal path rather than interpreted as an entityId.
  app.get('/due', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'List PM schedule entries currently in their tolerance window',
      description:
        'Returns all active PM entries whose window contains `now`, plus entries whose window closed in the last 30 days and whose filters are not fully cleaned (overdue). Grouped by AHU, with each AHU\'s child filters and per-filter status.',
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.getDueTasks(ctx);
  });

  app.get('/:entityId', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Get active PM schedule for an entity',
      params: { type: 'object', required: ['entityId'], properties: { entityId: { type: 'string', format: 'uuid' } } },
      querystring: { type: 'object', properties: { year: { type: 'integer' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { entityId } = req.params as { entityId: string };
    const { year } = req.query as { year?: number };
    return service.getByEntity(ctx, entityId, year);
  });

  app.post('/', {
    preHandler: [app.requirePermission('PM_CREATE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Create PM schedule',
      body: {
        type: 'object',
        required: ['entityId', 'year', 'entries'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          year: { type: 'integer' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['month', 'plannedDate'],
              properties: {
                month: { type: 'integer', minimum: 1, maximum: 12 },
                plannedDate: { type: 'string', format: 'date' },
                toleranceDays: { type: 'integer', minimum: 0 },
                notes: { type: 'string' },
              },
            },
          },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_PM_SCHEDULE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const result = await service.create(ctx, req.body);
    return reply.code(201).send(result);
  });

  app.put('/:id', {
    preHandler: [app.requirePermission('PM_UPDATE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Update PM schedule (new version)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', properties: { entries: { type: 'array' } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_PM_SCHEDULE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.update(ctx, id, req.body);
  });

  app.delete('/:id', {
    preHandler: [app.requirePermission('PM_DELETE')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Delete PM schedule',
      description: 'Deletes a PM schedule and its entries. Fails if executions are in progress.',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_PM_SCHEDULE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });

  app.get('/:entityId/history', {
    preHandler: [app.requirePermission('PM_READ')],
    schema: {
      tags: ['PM Schedules'],
      summary: 'Get PM schedule version history',
      params: { type: 'object', required: ['entityId'], properties: { entityId: { type: 'string', format: 'uuid' } } },
      response: { 200: { type: 'array', items: { type: 'object', additionalProperties: true } }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const { entityId } = req.params as { entityId: string };
    return service.getHistory(ctx, entityId);
  });
}
