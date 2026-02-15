import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { createTemplateSchema, updateTemplateSchema, templateQuerySchema, templateParamsSchema } from '@digilog/shared';

export default async function templateRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/templates — list templates
  app.get('/', {
    schema: { tags: ['Templates'], summary: 'List templates', description: 'List asset templates with optional filters', querystring: templateQuerySchema },
  }, async (req) => {
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.nodeType) where.nodeType = req.query.nodeType;
    if (req.query.search) {
      where.OR = [
        { name: { contains: req.query.search, mode: 'insensitive' } },
        { description: { contains: req.query.search, mode: 'insensitive' } },
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
    schema: { tags: ['Templates'], summary: 'Create template', description: 'Create a new asset template', body: createTemplateSchema },
    preHandler: [app.requirePermission('TEMPLATE_CREATE')],
  }, async (req, reply) => {
    const template = await prisma.assetTemplate.create({
      data: {
        name: req.body.name,
        nodeType: req.body.nodeType,
        description: req.body.description,
        attributeSchema: req.body.attributeSchema as any,
        telemetrySchema: req.body.telemetrySchema as any,
        checklistSchemas: req.body.checklistSchemas as any,
        expectedIdentifiers: req.body.expectedIdentifiers as any,
        expectedRelationships: req.body.expectedRelationships as any,
        defaultSchedules: req.body.defaultSchedules as any,
        statusLifecycle: req.body.statusLifecycle as any,
        iconUrl: req.body.iconUrl || null,
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
          checklistSchemas: template.checklistSchemas,
          expectedIdentifiers: template.expectedIdentifiers,
          expectedRelationships: template.expectedRelationships,
          defaultSchedules: template.defaultSchedules,
          statusLifecycle: template.statusLifecycle,
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
  app.get('/:id', {
    schema: { tags: ['Templates'], summary: 'Get template', description: 'Get template detail with version history', params: templateParamsSchema },
  }, async (req, reply) => {
    const { id } = req.params;
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
    schema: { tags: ['Templates'], summary: 'Update template', description: 'Update an asset template (creates new version)', params: templateParamsSchema, body: updateTemplateSchema },
    preHandler: [app.requirePermission('TEMPLATE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.assetTemplate.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Template not found' });

    const beforeValue = {
      name: existing.name, description: existing.description,
      attributeSchema: existing.attributeSchema, telemetrySchema: existing.telemetrySchema,
    };

    const updateData: Record<string, unknown> = {};
    if (req.body.name) updateData.name = req.body.name;
    if (req.body.description !== undefined) updateData.description = req.body.description;
    if (req.body.attributeSchema) updateData.attributeSchema = req.body.attributeSchema;
    if (req.body.telemetrySchema) updateData.telemetrySchema = req.body.telemetrySchema;
    if (req.body.checklistSchemas) updateData.checklistSchemas = req.body.checklistSchemas;
    if (req.body.expectedIdentifiers) updateData.expectedIdentifiers = req.body.expectedIdentifiers;
    if (req.body.expectedRelationships) updateData.expectedRelationships = req.body.expectedRelationships;
    if (req.body.defaultSchedules) updateData.defaultSchedules = req.body.defaultSchedules;
    if (req.body.statusLifecycle) updateData.statusLifecycle = req.body.statusLifecycle;
    if (req.body.iconUrl !== undefined) updateData.iconUrl = req.body.iconUrl || null;
    if (req.body.status) updateData.status = req.body.status;
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
          checklistSchemas: template.checklistSchemas,
          expectedIdentifiers: template.expectedIdentifiers,
          expectedRelationships: template.expectedRelationships,
          defaultSchedules: template.defaultSchedules,
          statusLifecycle: template.statusLifecycle,
        },
        changedBy: req.user.sub,
        reason: req.body.reason,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'TEMPLATE_MODIFIED',
      targetType: 'asset_template', targetId: id,
      beforeValue, afterValue: updateData, reason: req.body.reason,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return template;
  });

  // DELETE /api/templates/:id (soft delete)
  app.delete('/:id', {
    schema: { tags: ['Templates'], summary: 'Delete template', description: 'Soft-delete (deactivate) a template', params: templateParamsSchema },
    preHandler: [app.requirePermission('TEMPLATE_DELETE')],
  }, async (req, reply) => {
    const { id } = req.params;
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
