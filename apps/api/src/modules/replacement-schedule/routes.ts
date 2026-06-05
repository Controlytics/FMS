import type { FastifyInstance } from 'fastify';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { buildReplacementScheduleTemplate } from './template.service.js';
import { processUpload, listSchedules, listDueEntries, executeReplacement } from './service.js';

// Registered at prefix /api/replacement-schedules (see app.ts).
// Upload is gated by REPLACEMENT_SCHEDULE_UPLOAD — the permission SUPER_ADMIN
// grants to whichever role may upload. Reads gated by REPLACEMENT_SCHEDULE_VIEW.
// NOTE: reauth on upload is intentionally deferred to the polish phase (the
// create is permission-gated + audited for now).
export default async function replacementScheduleRoutes(app: FastifyInstance) {
  // Helper: read a single multipart file buffer + optional fields.
  async function readUpload(req: any): Promise<{ buffer: Buffer | null; fileName?: string }> {
    let buffer: Buffer | null = null;
    let fileName: string | undefined;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileName = part.filename;
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      }
    }
    return { buffer, fileName };
  }

  // Download the upload template (.xlsx) with a live AHU-name dropdown.
  app.get('/template.xlsx', {
    preHandler: [app.requireAnyPermission('REPLACEMENT_SCHEDULE_VIEW', 'REPLACEMENT_SCHEDULE_UPLOAD')],
    schema: {
      tags: ['Replacement Schedule'],
      summary: 'Download the replacement-schedule upload template',
      description: 'Columns: S.No, AHU Name (live dropdown), Filter Micron, Filter Size, Qty, Schedule Date, Tolerance Days.',
    },
  }, async (_req, reply) => {
    const buf = await buildReplacementScheduleTemplate();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="replacement-schedule-template.xlsx"')
      .send(buf);
  });

  const uploadResultSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean' },
      created: { type: 'integer' },
      failed: { type: 'integer' },
      scheduleId: { type: 'string' },
      results: { type: 'array', items: { type: 'object', additionalProperties: true } },
      rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  };

  // Dry-run: parse + validate, return per-row errors + parsed rows (no DB write).
  app.post('/validate', {
    preHandler: [app.requirePermission('REPLACEMENT_SCHEDULE_UPLOAD')],
    schema: { tags: ['Replacement Schedule'], summary: 'Validate an upload (dry-run)', consumes: ['multipart/form-data'], response: { 200: uploadResultSchema, ...errorResponses } },
  }, async (req, reply) => {
    const { buffer, fileName } = await readUpload(req);
    if (!buffer || buffer.length === 0) return reply.code(400).send({ error: 'VALIDATION', message: 'A file is required' });
    const result = await processUpload(buffer, fileName, buildContext(req), { validateOnly: true });
    return { success: true, ...result };
  });

  // Create a schedule from the uploaded file (all-or-nothing — rejects if any row invalid).
  app.post('/', {
    preHandler: [app.requirePermission('REPLACEMENT_SCHEDULE_UPLOAD')],
    schema: { tags: ['Replacement Schedule'], summary: 'Upload a replacement schedule', consumes: ['multipart/form-data'], response: { 200: uploadResultSchema, ...errorResponses } },
  }, async (req, reply) => {
    const { buffer, fileName } = await readUpload(req);
    if (!buffer || buffer.length === 0) return reply.code(400).send({ error: 'VALIDATION', message: 'A file is required' });
    const result = await processUpload(buffer, fileName, buildContext(req), { validateOnly: false });
    return { success: result.failed === 0, ...result };
  });

  // List uploaded schedules + entries (with computed status).
  app.get('/', {
    preHandler: [app.requirePermission('REPLACEMENT_SCHEDULE_VIEW')],
    schema: { tags: ['Replacement Schedule'], summary: 'List replacement schedules', response: { 200: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } } }, ...errorResponses } },
  }, async () => {
    const data = await listSchedules();
    return { data };
  });

  // Entries whose window is active right now (drives tablet tasks + dashboard).
  // 2026-06-04 (per user): replacement TASKS are open to any authenticated role
  // on the tablet — no permission rule. (Web VIEW/UPLOAD of the schedule above
  // stays role-gated; only these two task endpoints are opened.) Auth is still
  // enforced by the global onRequest hook.
  app.get('/due', {
    schema: { tags: ['Replacement Schedule'], summary: 'List currently-due replacement entries (any role)', response: { 200: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', additionalProperties: true } } } }, ...errorResponses } },
  }, async () => {
    const data = await listDueEntries();
    return { data };
  });

  // Replace one filter against a due entry (from the tablet task). Open to any
  // authenticated role (2026-06-04) but STILL requires REPLACE_FILTER reauth —
  // so the action carries the operator's 21 CFR electronic signature + audit.
  app.post('/entries/:id/execute', {
    schema: {
      tags: ['Replacement Schedule'],
      summary: 'Replace one filter against a schedule entry',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['oldFilterId'],
        properties: { oldFilterId: { type: 'string', format: 'uuid' }, remarks: { type: 'string' } },
        additionalProperties: false,
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REPLACE_FILTER', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };
    const { oldFilterId, remarks } = req.body as { oldFilterId: string; remarks?: string };
    return executeReplacement(id, oldFilterId, remarks ?? '', buildContext(req));
  });
}
