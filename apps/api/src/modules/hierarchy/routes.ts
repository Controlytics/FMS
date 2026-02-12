import { type FastifyInstance } from 'fastify';
import { type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { createNodeSchema, updateNodeSchema, createIdentifierSchema } from '@digilog/shared';

function toUnsPath(segments: string[]): string {
  return segments.map(s => s.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()).join('.');
}

export default async function hierarchyRoutes(app: FastifyInstance) {
  // GET /api/hierarchy — root nodes
  app.get('/', async (req) => {
    const parentId = (req.query as { parentId?: string }).parentId;

    const nodes = await prisma.hierarchyNode.findMany({
      where: parentId ? { parentId } : { parentId: null },
      include: {
        template: { select: { id: true, name: true, nodeType: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });

    return nodes;
  });

  // GET /api/hierarchy/tree — full tree (for small datasets)
  app.get('/tree', async () => {
    const nodes = await prisma.hierarchyNode.findMany({
      include: {
        template: { select: { id: true, name: true, nodeType: true } },
        _count: { select: { children: true } },
      },
      orderBy: { unsPath: 'asc' },
    });
    return nodes;
  });

  // POST /api/hierarchy — create node
  app.post('/', {
    preHandler: [app.requirePermission('NODE_CREATE')],
  }, async (req, reply) => {
    const parsed = createNodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { parentId, name, nodeType, templateId, attributes, status } = parsed.data;

    // Build uns_path
    let unsPath: string;
    if (parentId) {
      const parent = await prisma.hierarchyNode.findUnique({ where: { id: parentId } });
      if (!parent) return reply.code(404).send({ error: 'Parent node not found' });
      unsPath = `${parent.unsPath}.${toUnsPath([name])}`;
    } else {
      unsPath = toUnsPath([name]);
    }

    // If template specified, merge template attributes
    let mergedAttributes = attributes;
    if (templateId) {
      const template = await prisma.assetTemplate.findUnique({ where: { id: templateId } });
      if (!template) return reply.code(404).send({ error: 'Template not found' });

      // Initialize attribute values from template schema
      const templateAttrs: Record<string, unknown> = {};
      const attrSchema = template.attributeSchema as Array<{ name: string; defaultValue?: unknown }>;
      for (const field of attrSchema) {
        if (field.defaultValue !== undefined) {
          templateAttrs[field.name] = field.defaultValue;
        }
      }
      mergedAttributes = { ...templateAttrs, ...attributes };
    }

    const node = await prisma.hierarchyNode.create({
      data: {
        parentId: parentId ?? null,
        name,
        nodeType,
        unsPath,
        templateId: templateId ?? null,
        attributes: mergedAttributes as Prisma.InputJsonValue,
        status,
        createdBy: req.user.sub,
      },
      include: {
        template: { select: { id: true, name: true, nodeType: true } },
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'NODE_CREATED',
      targetType: 'hierarchy_node', targetId: node.id,
      afterValue: { name, nodeType, parentId, templateId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(node);
  });

  // GET /api/hierarchy/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = await prisma.hierarchyNode.findUnique({
      where: { id },
      include: {
        template: true,
        children: {
          include: {
            template: { select: { id: true, name: true, nodeType: true } },
            _count: { select: { children: true } },
          },
          orderBy: { name: 'asc' },
        },
        parent: { select: { id: true, name: true, nodeType: true, unsPath: true } },
        identifiers: true,
        sourceLinks: { include: { target: { select: { id: true, name: true, nodeType: true } } } },
        targetLinks: { include: { source: { select: { id: true, name: true, nodeType: true } } } },
      },
    });

    if (!node) return reply.code(404).send({ error: 'Node not found' });
    return node;
  });

  // GET /api/hierarchy/:id/ancestors — breadcrumb path
  app.get('/:id/ancestors', async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = await prisma.hierarchyNode.findUnique({ where: { id } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    // Walk up the tree
    const ancestors: Array<{ id: string; name: string; nodeType: string }> = [];
    let current = node;
    while (current.parentId) {
      const parent = await prisma.hierarchyNode.findUnique({
        where: { id: current.parentId },
        select: { id: true, name: true, nodeType: true, parentId: true, unsPath: true },
      });
      if (!parent) break;
      ancestors.unshift({ id: parent.id, name: parent.name, nodeType: parent.nodeType });
      current = parent as any;
    }

    return ancestors;
  });

  // PUT /api/hierarchy/:id
  app.put('/:id', {
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateNodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.hierarchyNode.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Node not found' });

    const beforeValue = { name: existing.name, attributes: existing.attributes, status: existing.status };

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.attributes) updateData.attributes = { ...(existing.attributes as object), ...parsed.data.attributes };
    if (parsed.data.status) updateData.status = parsed.data.status;

    const node = await prisma.hierarchyNode.update({
      where: { id },
      data: updateData,
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'NODE_MODIFIED',
      targetType: 'hierarchy_node', targetId: id,
      beforeValue, afterValue: updateData, reason: parsed.data.reason,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return node;
  });

  // DELETE /api/hierarchy/:id
  app.delete('/:id', {
    preHandler: [app.requirePermission('NODE_DELETE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.hierarchyNode.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    });
    if (!existing) return reply.code(404).send({ error: 'Node not found' });

    if (existing._count.children > 0) {
      return reply.code(400).send({ error: 'Cannot delete node with children. Remove children first.' });
    }

    const { reason } = (req.body as { reason?: string }) ?? {};

    await prisma.hierarchyNode.update({
      where: { id },
      data: { status: 'decommissioned' },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'NODE_DELETED',
      targetType: 'hierarchy_node', targetId: id,
      beforeValue: { name: existing.name, status: existing.status },
      reason: reason ?? 'Node decommissioned',
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/hierarchy/:id/identifiers — add physical identifier
  app.post('/:id/identifiers', {
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = { ...(req.body as object), nodeId: id };
    const parsed = createIdentifierSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const node = await prisma.hierarchyNode.findUnique({ where: { id } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    const identifier = await prisma.physicalIdentifier.create({
      data: { nodeId: id, type: parsed.data.type, value: parsed.data.value, createdBy: req.user.sub },
    });

    return reply.code(201).send(identifier);
  });
}
