import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { createTemplateSchema, updateTemplateSchema } from '@digilog/shared';

export default async function templateRoutes(app: FastifyInstance) {
  // GET /api/templates — list templates
  app.get('/', async (req) => {
    const { status, nodeType, search } = req.query as { status?: string; nodeType?: string; search?: string };

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (nodeType) where.nodeType = nodeType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const templates = await prisma.assetTemplate.findMany({
      where: where as any,
      orderBy: { name: 'asc' },
    });

    return templates;
  });

  // POST /api/templates — create template
  app.post('/', {
    preHandler: [app.requirePermission('TEMPLATE_CREATE')],
  }, async (req, reply) => {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const template = await prisma.assetTemplate.create({
      data: {
        name: parsed.data.name,
        nodeType: parsed.data.nodeType,
        description: parsed.data.description,
        attributeSchema: parsed.data.attributeSchema as any,
        telemetrySchema: parsed.data.telemetrySchema as any,
        createdBy: req.user.sub,
      },
    });

    // Create version snapshot
    await prisma.templateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        snapshot: {
          name: template.name,
          nodeType: template.nodeType,
          attributeSchema: template.attributeSchema,
          telemetrySchema: template.telemetrySchema,
        },
        changedBy: req.user.sub,
        reason: 'Initial creation',
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'TEMPLATE_CREATED',
      targetType: 'asset_template', targetId: template.id,
      afterValue: { name: template.name, nodeType: template.nodeType },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(template);
  });

  // GET /api/templates/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await prisma.assetTemplate.findUnique({
      where: { id },
      include: {
        templateVersions: { orderBy: { version: 'desc' } },
        _count: { select: { hierarchyNodes: true } },
      },
    });
    if (!template) return reply.code(404).send({ error: 'Template not found' });
    return template;
  });

  // PUT /api/templates/:id
  app.put('/:id', {
    preHandler: [app.requirePermission('TEMPLATE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Template not found' });

    const beforeValue = {
      name: existing.name, description: existing.description,
      attributeSchema: existing.attributeSchema, telemetrySchema: existing.telemetrySchema,
    };

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.attributeSchema) updateData.attributeSchema = parsed.data.attributeSchema;
    if (parsed.data.telemetrySchema) updateData.telemetrySchema = parsed.data.telemetrySchema;
    if (parsed.data.status) updateData.status = parsed.data.status;
    updateData.version = existing.version + 1;

    const template = await prisma.assetTemplate.update({
      where: { id },
      data: updateData,
    });

    // Create version snapshot
    await prisma.templateVersion.create({
      data: {
        templateId: id,
        version: template.version,
        snapshot: {
          name: template.name,
          nodeType: template.nodeType,
          attributeSchema: template.attributeSchema,
          telemetrySchema: template.telemetrySchema,
        },
        changedBy: req.user.sub,
        reason: parsed.data.reason,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'TEMPLATE_MODIFIED',
      targetType: 'asset_template', targetId: id,
      beforeValue, afterValue: updateData, reason: parsed.data.reason,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return template;
  });

  // DELETE /api/templates/:id (soft delete)
  app.delete('/:id', {
    preHandler: [app.requirePermission('TEMPLATE_DELETE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Template not found' });

    await prisma.assetTemplate.update({
      where: { id },
      data: { status: 'inactive' },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'TEMPLATE_DELETED',
      targetType: 'asset_template', targetId: id,
      beforeValue: { name: existing.name, status: existing.status },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });
}
