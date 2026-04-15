import type { FastifyInstance } from 'fastify';
import { ReportService } from './report.service.js';
import { buildContext } from '../../lib/build-context.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import fs from 'fs/promises';

export default async function reportRoutes(app: FastifyInstance) {
  const service = new ReportService();

  // POST /api/reports/generate — Generate report from template
  app.post('/generate', {
    preHandler: [app.requirePermission('REPORT_GENERATE')],
    schema: {
      body: {
        type: 'object',
        required: ['templateId'],
        properties: {
          templateId: { type: 'string' },
          entitySlots: { type: 'object', additionalProperties: { type: 'string' } },
          timeRangeStart: { type: 'string' },
          timeRangeEnd: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('GENERATE_REPORT', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const result = await service.generate(ctx, req.body as any);
    return reply.code(201).send(result);
  });

  // GET /api/reports — List generated reports
  app.get('/', {
    preHandler: [app.requirePermission('REPORT_VIEW')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number' },
          limit: { type: 'number' },
          status: { type: 'string' },
          templateId: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    return service.list(ctx, req.query as any);
  });

  // GET /api/reports/:id — Get report details
  app.get('/:id', {
    preHandler: [app.requirePermission('REPORT_VIEW')],
  }, async (req) => {
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getById(ctx, id);
  });

  // GET /api/reports/:id/pdf — Download PDF
  app.get('/:id/pdf', {
    preHandler: [app.requirePermission('REPORT_EXPORT')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const pdfPath = await service.getPdfPath(id);
    const buffer = await fs.readFile(pdfPath);

    const report = await service.getById(buildContext(req), id);
    const filename = `${report.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pdf`;

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', buffer.length)
      .send(buffer);
  });

  // GET /api/reports/:id/preview — Inline PDF preview
  app.get('/:id/preview', {
    preHandler: [app.requirePermission('REPORT_VIEW')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const pdfPath = await service.getPdfPath(id);
    const buffer = await fs.readFile(pdfPath);

    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'inline')
      .header('Content-Length', buffer.length)
      .send(buffer);
  });

  // DELETE /api/reports/:id — Delete report
  app.delete('/:id', {
    preHandler: [app.requirePermission('REPORT_DELETE')],
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_REPORT', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });
}
