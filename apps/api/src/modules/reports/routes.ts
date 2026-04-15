import type { FastifyInstance } from 'fastify';
import { buildContext } from '../../lib/build-context.js';
import { enforceReauth } from '../../lib/reauth-check.js';

let _service: any = null;
async function getService() {
  if (!_service) {
    const { ReportService } = await import('./service.js');
    _service = new ReportService();
  }
  return _service;
}

export default async function reportRoutes(app: FastifyInstance) {

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
    const service = await getService();
    const ctx = buildContext(req);
    const result = await service.generate(ctx, req.body as any);
    return reply.code(201).send(result);
  });

  app.get('/', {
    preHandler: [app.requirePermission('REPORT_VIEW')],
  }, async (req) => {
    const service = await getService();
    const ctx = buildContext(req);
    return service.list(ctx, req.query as any);
  });

  app.get('/:id', {
    preHandler: [app.requirePermission('REPORT_VIEW')],
  }, async (req) => {
    const service = await getService();
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.getById(ctx, id);
  });

  app.get('/:id/pdf', {
    preHandler: [app.requirePermission('REPORT_EXPORT')],
  }, async (req, reply) => {
    const service = await getService();
    const { id } = req.params as { id: string };
    const pdfPath = await service.getPdfPath(id);
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(pdfPath);
    const report = await service.getById(buildContext(req), id);
    const filename = `${report.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.pdf`;
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${filename}"`).header('Content-Length', buffer.length).send(buffer);
  });

  app.get('/:id/preview', {
    preHandler: [app.requirePermission('REPORT_VIEW')],
  }, async (req, reply) => {
    const service = await getService();
    const { id } = req.params as { id: string };
    const pdfPath = await service.getPdfPath(id);
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(pdfPath);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'inline').header('Content-Length', buffer.length).send(buffer);
  });

  app.delete('/:id', {
    preHandler: [app.requirePermission('REPORT_DELETE')],
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_REPORT', req, reply);
    if (!ok) return;
    const service = await getService();
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.delete(ctx, id);
  });

  app.post('/:id/sign', {
    preHandler: [app.requirePermission('REPORT_SIGN')],
    schema: { body: { type: 'object', required: ['signerRole'], properties: { signerRole: { type: 'string' }, meaning: { type: 'string' } } } },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('SIGN_REPORT', req, reply);
    if (!ok) return;
    const service = await getService();
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.sign(ctx, id, req.body as any);
  });

  app.post('/:id/reject', {
    preHandler: [app.requirePermission('REPORT_SIGN')],
    schema: { body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REJECT_REPORT', req, reply);
    if (!ok) return;
    const service = await getService();
    const ctx = buildContext(req);
    const { id } = req.params as { id: string };
    return service.reject(ctx, id, req.body as any);
  });
}
