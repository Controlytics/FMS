import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { hashPassword } from '../../lib/password.js';

/**
 * Organization Detail routes — manage users, entities, templates within an org
 * Prefix: /api/tenant/organizations/:orgId
 */
export default async function orgDetailRoutes(app: FastifyInstance) {

  // Access control: TENANT_ADMIN+, or ORG_ADMIN of this org
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.user?.role;
    if (!role) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    if (role === 'SUPER_ADMIN') return;
    if (['TENANT_ADMIN', 'ADMIN'].includes(role)) return;
    if (role === 'ORG_ADMIN') {
      const { orgId } = req.params as { orgId?: string };
      if (orgId && req.user.organizationId === orgId) return;
    }
    return reply.code(403).send({ error: 'FORBIDDEN', message: 'Organization access required' });
  });

  function getTenantId(req: FastifyRequest): string | null {
    if (req.user.role === 'SUPER_ADMIN') return (req.headers['x-tenant-id'] as string) || null;
    return req.user.tenantId || null;
  }

  // ═══════════════════════════════════════════════════════
  // USERS IN ORG
  // ═══════════════════════════════════════════════════════

  // List users in org
  app.get('/:orgId/users', {
    schema: {
      tags: ['Organization Management'],
      summary: 'List users in organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' } }, required: ['orgId'] },
      querystring: {
        type: 'object',
        properties: { page: { type: 'integer', default: 1 }, limit: { type: 'integer', default: 20 }, search: { type: 'string' }, role: { type: 'string' }, status: { type: 'string' } },
      },
    },
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { page = 1, limit = 20, search, role, status } = req.query as any;

    const where: any = { organizationId: orgId };
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where, skip: (page - 1) * limit, take: limit,
        select: { id: true, username: true, fullName: true, email: true, department: true, role: true, status: true, lastLogin: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // Create user in org
  app.post('/:orgId/users', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Create user in organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' } }, required: ['orgId'] },
      body: {
        type: 'object',
        required: ['username', 'fullName', 'email', 'password', 'role'],
        properties: {
          username: { type: 'string', minLength: 6, maxLength: 50 },
          fullName: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          department: { type: 'string', maxLength: 50 },
          role: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as any;
    const tenantId = getTenantId(req);

    // Verify org exists and belongs to tenant
    const org = await prisma.organization.findFirst({ where: { id: orgId, ...(tenantId ? { tenantId } : {}) } });
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: body.username }, { email: body.email }] },
    });
    if (existing) {
      const field = existing.username === body.username ? 'username' : 'email';
      return reply.code(409).send({ error: 'CONFLICT', message: `${field} already exists` });
    }

    const passwordHash = await hashPassword(body.password);

    const user = await prisma.user.create({
      data: {
        username: body.username,
        fullName: body.fullName,
        email: body.email,
        department: body.department,
        role: body.role,
        passwordHash,
        status: 'ENABLED',
        forcePasswordChange: true,
        isTemporaryPassword: true,
        tenantId: org.tenantId,
        organizationId: orgId,
        createdBy: req.user.username,
      },
      select: { id: true, username: true, fullName: true, email: true, role: true, status: true, createdAt: true },
    });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'USER_CREATED', targetType: 'user', targetId: user.id,
      afterValue: { username: body.username, role: body.role, organization: org.name },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(user);
  });

  // Update user in org
  app.put('/:orgId/users/:userId', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Update user in organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId'] },
      body: {
        type: 'object',
        properties: {
          fullName: { type: 'string', maxLength: 100 },
          email: { type: 'string', format: 'email' },
          department: { type: 'string', maxLength: 50 },
          role: { type: 'string' },
          status: { type: 'string', enum: ['ENABLED', 'DISABLED'] },
        },
      },
    },
  }, async (req, reply) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const body = req.body as any;

    const user = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId } });
    if (!user) return reply.code(404).send({ error: 'User not found in this organization' });

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { ...body, updatedBy: req.user.username },
      select: { id: true, username: true, fullName: true, email: true, role: true, status: true },
    });

    return updated;
  });

  // Delete user from org
  app.delete('/:orgId/users/:userId', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Remove user from organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId'] },
    },
  }, async (req, reply) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };

    const user = await prisma.user.findFirst({ where: { id: userId, organizationId: orgId } });
    if (!user) return reply.code(404).send({ error: 'User not found in this organization' });

    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' as any, updatedBy: req.user.username } });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'USER_DISABLED', targetType: 'user', targetId: userId,
      afterValue: { username: user.username, organization: orgId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════
  // ENTITY ASSIGNMENT TO ORG
  // ═══════════════════════════════════════════════════════

  // List entities assigned to org
  app.get('/:orgId/entities', {
    schema: {
      tags: ['Organization Management'],
      summary: 'List entities assigned to organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' } }, required: ['orgId'] },
    },
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const tenantId = getTenantId(req);

    // Direct org assignments
    const directAssignments = await prisma.entityAssignment.findMany({
      where: { organizationId: orgId, assigneeType: 'ORGANIZATION', ...(tenantId ? { tenantId } : {}) },
      select: { id: true, entityId: true, permissions: true, createdAt: true },
    });

    // Get entity details
    const entityIds = directAssignments.map(a => a.entityId);
    const entities = await prisma.assetInstance.findMany({
      where: { id: { in: entityIds }, isActive: true },
      select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
    });

    // Also get entities whose org matches directly (organizationId on asset_instances)
    const orgEntities = await prisma.assetInstance.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
    });

    // Merge unique
    const allMap = new Map<string, any>();
    for (const e of entities) allMap.set(e.id, { ...e, source: 'assigned' });
    for (const e of orgEntities) if (!allMap.has(e.id)) allMap.set(e.id, { ...e, source: 'org_owned' });

    return { data: Array.from(allMap.values()), total: allMap.size };
  });

  // Assign entity to org
  app.post('/:orgId/entities', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Assign entity to organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' } }, required: ['orgId'] },
      body: {
        type: 'object',
        required: ['entityId'],
        properties: { entityId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { entityId } = req.body as { entityId: string };
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    // Check entity exists
    const entity = await prisma.assetInstance.findFirst({ where: { id: entityId, ...(tenantId ? { tenantId } : {}) } });
    if (!entity) return reply.code(404).send({ error: 'Entity not found' });

    // Check not already assigned
    const existing = await prisma.entityAssignment.findFirst({
      where: { entityId, assigneeType: 'ORGANIZATION', organizationId: orgId },
    });
    if (existing) return reply.code(409).send({ error: 'Already assigned' });

    const assignment = await prisma.entityAssignment.create({
      data: { tenantId, entityId, assigneeType: 'ORGANIZATION', organizationId: orgId, createdBy: req.user.username },
    });

    // Also set organizationId on the entity itself
    await prisma.assetInstance.update({ where: { id: entityId }, data: { organizationId: orgId } });

    return reply.code(201).send(assignment);
  });

  // Unassign entity from org
  app.delete('/:orgId/entities/:entityId', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Unassign entity from organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, entityId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'entityId'] },
    },
  }, async (req) => {
    const { orgId, entityId } = req.params as { orgId: string; entityId: string };

    await prisma.entityAssignment.deleteMany({ where: { entityId, assigneeType: 'ORGANIZATION', organizationId: orgId } });
    await prisma.assetInstance.update({ where: { id: entityId }, data: { organizationId: null } });

    return { success: true };
  });

  // ═══════════════════════════════════════════════════════
  // TEMPLATE ASSIGNMENT TO ORG
  // ═══════════════════════════════════════════════════════

  // List templates assigned to org
  app.get('/:orgId/templates', {
    schema: {
      tags: ['Organization Management'],
      summary: 'List entity templates assigned to organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' } }, required: ['orgId'] },
    },
  }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const tenantId = getTenantId(req);

    const assignments = await prisma.templateAssignment.findMany({
      where: { organizationId: orgId, assigneeType: 'ORGANIZATION', ...(tenantId ? { tenantId } : {}) },
    });

    const templateIds = assignments.map(a => a.templateId);
    const templates = await prisma.assetTemplate.findMany({
      where: { id: { in: templateIds }, isActive: true },
      select: {
        id: true, name: true, category: true, description: true,
        _count: { select: { instances: { where: { isActive: true } } } },
      },
    });

    return {
      data: templates.map(t => ({
        ...t,
        instanceCount: t._count.instances,
        assignmentId: assignments.find(a => a.templateId === t.id)?.id,
      })),
      total: templates.length,
    };
  });

  // Assign template to org
  app.post('/:orgId/templates', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Assign entity template to organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' } }, required: ['orgId'] },
      body: {
        type: 'object',
        required: ['templateId'],
        properties: { templateId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { templateId } = req.body as { templateId: string };
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    const template = await prisma.assetTemplate.findFirst({ where: { id: templateId, ...(tenantId ? { tenantId } : {}) } });
    if (!template) return reply.code(404).send({ error: 'Template not found' });

    const existing = await prisma.templateAssignment.findFirst({
      where: { templateId, assigneeType: 'ORGANIZATION', organizationId: orgId },
    });
    if (existing) return reply.code(409).send({ error: 'Template already assigned' });

    const assignment = await prisma.templateAssignment.create({
      data: { tenantId, templateId, assigneeType: 'ORGANIZATION', organizationId: orgId, createdBy: req.user.username },
    });

    return reply.code(201).send(assignment);
  });

  // Unassign template from org
  app.delete('/:orgId/templates/:templateId', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Unassign template from organization',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, templateId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'templateId'] },
    },
  }, async (req) => {
    const { orgId, templateId } = req.params as { orgId: string; templateId: string };
    await prisma.templateAssignment.deleteMany({ where: { templateId, assigneeType: 'ORGANIZATION', organizationId: orgId } });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════
  // INDIVIDUAL USER ENTITY ASSIGNMENT
  // ═══════════════════════════════════════════════════════

  // List entities assigned to a specific user
  app.get('/:orgId/users/:userId/entities', {
    schema: {
      tags: ['Organization Management'],
      summary: 'List entities assigned to a specific user',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId'] },
    },
  }, async (req) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const tenantId = getTenantId(req);

    // Direct entity assignments
    const entityAssignments = await prisma.entityAssignment.findMany({
      where: { userId, assigneeType: 'USER', ...(tenantId ? { tenantId } : {}) },
    });

    // Direct template assignments
    const templateAssignments = await prisma.templateAssignment.findMany({
      where: { userId, assigneeType: 'USER', ...(tenantId ? { tenantId } : {}) },
    });

    // Get entity details
    const entityIds = entityAssignments.map(a => a.entityId);
    const directEntities = entityIds.length > 0 ? await prisma.assetInstance.findMany({
      where: { id: { in: entityIds }, isActive: true },
      select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
    }) : [];

    // Get entities from template assignments
    const templateIds = templateAssignments.map(a => a.templateId);
    const templateEntities = templateIds.length > 0 ? await prisma.assetInstance.findMany({
      where: { templateId: { in: templateIds }, isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
    }) : [];

    const allMap = new Map<string, any>();
    for (const e of directEntities) allMap.set(e.id, { ...e, source: 'direct' });
    for (const e of templateEntities) if (!allMap.has(e.id)) allMap.set(e.id, { ...e, source: 'template' });

    return {
      entities: Array.from(allMap.values()),
      templates: templateAssignments.map(a => ({ assignmentId: a.id, templateId: a.templateId })),
    };
  });

  // Assign entity to individual user
  app.post('/:orgId/users/:userId/entities', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Assign entity to individual user',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId'] },
      body: {
        type: 'object',
        required: ['entityId'],
        properties: { entityId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { orgId: string; userId: string };
    const { entityId } = req.body as { entityId: string };
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    const existing = await prisma.entityAssignment.findFirst({ where: { entityId, userId, assigneeType: 'USER' } });
    if (existing) return reply.code(409).send({ error: 'Already assigned' });

    const assignment = await prisma.entityAssignment.create({
      data: { tenantId, entityId, assigneeType: 'USER', userId, createdBy: req.user.username },
    });
    return reply.code(201).send(assignment);
  });

  // Assign template to individual user
  app.post('/:orgId/users/:userId/templates', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Assign entity template to individual user',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId'] },
      body: {
        type: 'object',
        required: ['templateId'],
        properties: { templateId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { orgId: string; userId: string };
    const { templateId } = req.body as { templateId: string };
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    const existing = await prisma.templateAssignment.findFirst({ where: { templateId, userId, assigneeType: 'USER' } });
    if (existing) return reply.code(409).send({ error: 'Already assigned' });

    const assignment = await prisma.templateAssignment.create({
      data: { tenantId, templateId, assigneeType: 'USER', userId, createdBy: req.user.username },
    });
    return reply.code(201).send(assignment);
  });

  // Remove entity assignment from user
  app.delete('/:orgId/users/:userId/entities/:assignmentId', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Remove entity assignment from user',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, assignmentId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId', 'assignmentId'] },
    },
  }, async (req) => {
    const { assignmentId } = req.params as { assignmentId: string };
    await prisma.entityAssignment.delete({ where: { id: assignmentId } }).catch(() => {});
    await prisma.templateAssignment.delete({ where: { id: assignmentId } }).catch(() => {});
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════
  // WHAT A USER CAN SEE (combines org + template + individual)
  // ═══════════════════════════════════════════════════════

  app.get('/:orgId/users/:userId/visible-entities', {
    schema: {
      tags: ['Organization Management'],
      summary: 'Get all entities visible to a user (org + template + individual)',
      params: { type: 'object', properties: { orgId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } }, required: ['orgId', 'userId'] },
    },
  }, async (req) => {
    const { orgId, userId } = req.params as { orgId: string; userId: string };
    const tenantId = getTenantId(req);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });

    const allEntities = new Map<string, any>();

    // 1. Entities assigned to org (via entity_assignments)
    const orgEntityAssignments = await prisma.entityAssignment.findMany({
      where: { organizationId: orgId, assigneeType: 'ORGANIZATION', ...(tenantId ? { tenantId } : {}) },
      select: { entityId: true },
    });
    if (orgEntityAssignments.length > 0) {
      const entities = await prisma.assetInstance.findMany({
        where: { id: { in: orgEntityAssignments.map(a => a.entityId) }, isActive: true },
        select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
      });
      for (const e of entities) allEntities.set(e.id, { ...e, source: 'org_entity' });
    }

    // 2. Entities in org (organizationId field)
    const orgOwned = await prisma.assetInstance.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
    });
    for (const e of orgOwned) if (!allEntities.has(e.id)) allEntities.set(e.id, { ...e, source: 'org_owned' });

    // 3. Entities from templates assigned to org
    const orgTemplateAssignments = await prisma.templateAssignment.findMany({
      where: { organizationId: orgId, assigneeType: 'ORGANIZATION', ...(tenantId ? { tenantId } : {}) },
      select: { templateId: true },
    });
    if (orgTemplateAssignments.length > 0) {
      const tplEntities = await prisma.assetInstance.findMany({
        where: { templateId: { in: orgTemplateAssignments.map(a => a.templateId) }, isActive: true, ...(tenantId ? { tenantId } : {}) },
        select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
      });
      for (const e of tplEntities) if (!allEntities.has(e.id)) allEntities.set(e.id, { ...e, source: 'org_template' });
    }

    // 4. Entities individually assigned to user
    const userEntityAssignments = await prisma.entityAssignment.findMany({
      where: { userId, assigneeType: 'USER', ...(tenantId ? { tenantId } : {}) },
      select: { entityId: true },
    });
    if (userEntityAssignments.length > 0) {
      const entities = await prisma.assetInstance.findMany({
        where: { id: { in: userEntityAssignments.map(a => a.entityId) }, isActive: true },
        select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
      });
      for (const e of entities) if (!allEntities.has(e.id)) allEntities.set(e.id, { ...e, source: 'user_entity' });
    }

    // 5. Entities from templates individually assigned to user
    const userTemplateAssignments = await prisma.templateAssignment.findMany({
      where: { userId, assigneeType: 'USER', ...(tenantId ? { tenantId } : {}) },
      select: { templateId: true },
    });
    if (userTemplateAssignments.length > 0) {
      const tplEntities = await prisma.assetInstance.findMany({
        where: { templateId: { in: userTemplateAssignments.map(a => a.templateId) }, isActive: true, ...(tenantId ? { tenantId } : {}) },
        select: { id: true, name: true, status: true, templateId: true, template: { select: { name: true } } },
      });
      for (const e of tplEntities) if (!allEntities.has(e.id)) allEntities.set(e.id, { ...e, source: 'user_template' });
    }

    return { data: Array.from(allEntities.values()), total: allEntities.size };
  });
}
