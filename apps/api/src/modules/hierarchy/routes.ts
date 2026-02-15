import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { createNodeSchema, updateNodeSchema, createIdentifierSchema } from '@digilog/shared';

function toUnsPath(segments: string[]): string {
  return segments.map(s => s.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()).join('.');
}

export default async function hierarchyRoutes(app: FastifyInstance) {
  // GET /api/hierarchy — root nodes
  app.get('/', {
    schema: { tags: ['Hierarchy'], summary: 'List nodes', description: 'List hierarchy nodes (root or by parentId)' },
  }, async (req) => {
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

  // GET /api/hierarchy/tree — paginated tree
  app.get('/tree', {
    schema: { tags: ['Hierarchy'], summary: 'Get tree', description: 'Get hierarchy tree with pagination (default 500 nodes)' },
  }, async (req) => {
    const query = req.query as { page?: string; limit?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(query.limit ?? '500', 10) || 500));

    const [nodes, total] = await Promise.all([
      prisma.hierarchyNode.findMany({
        include: {
          template: { select: { id: true, name: true, nodeType: true } },
          _count: { select: { children: true } },
        },
        orderBy: { unsPath: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.hierarchyNode.count(),
    ]);

    return { data: nodes, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // POST /api/hierarchy — create node
  app.post('/', {
    schema: { tags: ['Hierarchy'], summary: 'Create node', description: 'Create a new hierarchy node. May require re-authentication.' },
    preHandler: [app.requirePermission('NODE_CREATE'), app.requireReauth('node:create')],
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
        attributes: mergedAttributes as any,
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
  app.get('/:id', {
    schema: { tags: ['Hierarchy'], summary: 'Get node', description: 'Get node detail with children, links, and identifiers' },
  }, async (req, reply) => {
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

  // GET /api/hierarchy/:id/ancestors — breadcrumb path (single query via unsPath)
  app.get('/:id/ancestors', {
    schema: { tags: ['Hierarchy'], summary: 'Get ancestors', description: 'Get ancestor chain for breadcrumb navigation' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = await prisma.hierarchyNode.findUnique({ where: { id }, select: { id: true, unsPath: true, parentId: true } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    if (!node.parentId) return []; // Root node, no ancestors

    // Build all ancestor unsPath prefixes from the node's unsPath
    const segments = node.unsPath.split('.');
    const ancestorPaths: string[] = [];
    for (let i = 1; i < segments.length; i++) {
      ancestorPaths.push(segments.slice(0, i).join('.'));
    }

    if (ancestorPaths.length === 0) return [];

    const ancestors = await prisma.hierarchyNode.findMany({
      where: { unsPath: { in: ancestorPaths } },
      select: { id: true, name: true, nodeType: true, unsPath: true },
      orderBy: { unsPath: 'asc' },
    });

    return ancestors.map((a: { id: string; name: string; nodeType: string }) => ({ id: a.id, name: a.name, nodeType: a.nodeType }));
  });

  // PUT /api/hierarchy/:id
  app.put('/:id', {
    schema: { tags: ['Hierarchy'], summary: 'Update node', description: 'Update hierarchy node attributes or status' },
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
    schema: { tags: ['Hierarchy'], summary: 'Delete node', description: 'Soft-delete (decommission) a hierarchy node. May require re-authentication.' },
    preHandler: [app.requirePermission('NODE_DELETE'), app.requireReauth('node:delete')],
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
    schema: { tags: ['Hierarchy'], summary: 'Add identifier', description: 'Add a physical identifier (barcode, QR code, etc.) to a node' },
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

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'NODE_IDENTIFIER_ADDED',
      targetType: 'physical_identifier', targetId: identifier.id,
      afterValue: { nodeId: id, type: parsed.data.type, value: parsed.data.value },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(identifier);
  });
}
