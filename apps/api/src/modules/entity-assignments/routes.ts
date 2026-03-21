import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';

/**
 * Entity Assignment routes — assign entities to users/orgs/roles
 * Prefix: /api/entity-assignments
 */
export default async function entityAssignmentRoutes(app: FastifyInstance) {

  // ─── LIST ASSIGNMENTS FOR AN ENTITY ────────────────────
  app.get('/:entityId', {
    schema: {
      tags: ['Entity Assignments'],
      summary: 'List assignments for an entity',
      params: {
        type: 'object',
        properties: { entityId: { type: 'string', format: 'uuid' } },
        required: ['entityId'],
      },
    },
    preHandler: [app.requirePermission('ASSET_VIEW')],
  }, async (req, reply) => {
    const { entityId } = req.params as { entityId: string };
    const tenantId = req.tenantContext?.tenantId;

    const where: any = { entityId };
    if (tenantId) where.tenantId = tenantId;

    const assignments = await prisma.entityAssignment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with user/org names
    const enriched = await Promise.all(assignments.map(async (a) => {
      let assigneeName = '';
      if (a.assigneeType === 'USER' && a.userId) {
        const user = await prisma.user.findUnique({ where: { id: a.userId }, select: { fullName: true, username: true } });
        assigneeName = user ? `${user.fullName} (${user.username})` : 'Unknown User';
      } else if (a.assigneeType === 'ORGANIZATION' && a.organizationId) {
        const org = await prisma.organization.findUnique({ where: { id: a.organizationId }, select: { name: true } });
        assigneeName = org?.name || 'Unknown Org';
      } else if (a.assigneeType === 'ROLE' && a.roleValue) {
        assigneeName = `Role: ${a.roleValue}`;
      }
      return { ...a, assigneeName };
    }));

    return enriched;
  });

  // ─── CREATE ASSIGNMENT ─────────────────────────────────
  app.post('/', {
    schema: {
      tags: ['Entity Assignments'],
      summary: 'Assign entity to user/org/role',
      body: {
        type: 'object',
        required: ['entityId', 'assigneeType'],
        properties: {
          entityId: { type: 'string', format: 'uuid' },
          assigneeType: { type: 'string', enum: ['USER', 'ORGANIZATION', 'ROLE'] },
          userId: { type: 'string', format: 'uuid' },
          organizationId: { type: 'string', format: 'uuid' },
          roleValue: { type: 'string' },
          permissions: {
            type: 'object',
            properties: {
              view: { type: 'boolean' },
              control: { type: 'boolean' },
              configure: { type: 'boolean' },
            },
          },
        },
      },
    },
    preHandler: [app.requirePermission('ENTITY_ASSIGN')],
  }, async (req, reply) => {
    const body = req.body as any;
    const tenantId = req.tenantContext?.tenantId || req.user.tenantId;

    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    // Validate entity exists and belongs to tenant
    const entity = await prisma.assetInstance.findFirst({
      where: { id: body.entityId, tenantId },
      select: { id: true, name: true },
    });
    if (!entity) return reply.code(404).send({ error: 'Entity not found in this tenant' });

    // Validate assignee exists
    if (body.assigneeType === 'USER' && body.userId) {
      const user = await prisma.user.findFirst({ where: { id: body.userId, tenantId } });
      if (!user) return reply.code(404).send({ error: 'User not found in this tenant' });
    } else if (body.assigneeType === 'ORGANIZATION' && body.organizationId) {
      const org = await prisma.organization.findFirst({ where: { id: body.organizationId, tenantId } });
      if (!org) return reply.code(404).send({ error: 'Organization not found in this tenant' });
    } else if (body.assigneeType === 'ROLE' && !body.roleValue) {
      return reply.code(400).send({ error: 'roleValue required for ROLE assignee type' });
    }

    // Check for duplicate
    const existingWhere: any = { entityId: body.entityId, assigneeType: body.assigneeType };
    if (body.userId) existingWhere.userId = body.userId;
    if (body.organizationId) existingWhere.organizationId = body.organizationId;
    if (body.roleValue) existingWhere.roleValue = body.roleValue;

    const existing = await prisma.entityAssignment.findFirst({ where: existingWhere });
    if (existing) return reply.code(409).send({ error: 'Assignment already exists' });

    const assignment = await prisma.entityAssignment.create({
      data: {
        tenantId,
        entityId: body.entityId,
        assigneeType: body.assigneeType,
        userId: body.userId || null,
        organizationId: body.organizationId || null,
        roleValue: body.roleValue || null,
        permissions: body.permissions || { view: true, control: false, configure: false },
        createdBy: req.user.username,
      },
    });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'ENTITY_ASSIGNED', targetType: 'entity_assignment', targetId: assignment.id,
      afterValue: {
        entityId: body.entityId, entityName: entity.name,
        assigneeType: body.assigneeType, userId: body.userId,
        organizationId: body.organizationId, roleValue: body.roleValue,
      },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send(assignment);
  });

  // ─── BULK ASSIGN ───────────────────────────────────────
  app.post('/bulk', {
    schema: {
      tags: ['Entity Assignments'],
      summary: 'Bulk assign entities',
      body: {
        type: 'object',
        required: ['entityIds', 'assigneeType'],
        properties: {
          entityIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
          assigneeType: { type: 'string', enum: ['USER', 'ORGANIZATION', 'ROLE'] },
          userId: { type: 'string', format: 'uuid' },
          organizationId: { type: 'string', format: 'uuid' },
          roleValue: { type: 'string' },
          permissions: { type: 'object' },
        },
      },
    },
    preHandler: [app.requirePermission('ENTITY_ASSIGN')],
  }, async (req, reply) => {
    const body = req.body as any;
    const tenantId = req.tenantContext?.tenantId || req.user.tenantId;
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    const results: any[] = [];
    for (const entityId of body.entityIds) {
      try {
        const existing = await prisma.entityAssignment.findFirst({
          where: {
            entityId,
            assigneeType: body.assigneeType,
            userId: body.userId || undefined,
            organizationId: body.organizationId || undefined,
            roleValue: body.roleValue || undefined,
          },
        });
        if (existing) {
          results.push({ entityId, status: 'skipped', reason: 'already assigned' });
          continue;
        }

        await prisma.entityAssignment.create({
          data: {
            tenantId,
            entityId,
            assigneeType: body.assigneeType,
            userId: body.userId || null,
            organizationId: body.organizationId || null,
            roleValue: body.roleValue || null,
            permissions: body.permissions || { view: true, control: false, configure: false },
            createdBy: req.user.username,
          },
        });
        results.push({ entityId, status: 'assigned' });
      } catch {
        results.push({ entityId, status: 'error' });
      }
    }

    return { results, total: results.length, assigned: results.filter(r => r.status === 'assigned').length };
  });

  // ─── UPDATE ASSIGNMENT PERMISSIONS ─────────────────────
  app.put('/:id', {
    schema: {
      tags: ['Entity Assignments'],
      summary: 'Update assignment permissions',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          permissions: {
            type: 'object',
            properties: {
              view: { type: 'boolean' },
              control: { type: 'boolean' },
              configure: { type: 'boolean' },
            },
          },
        },
      },
    },
    preHandler: [app.requirePermission('ENTITY_ASSIGN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const tenantId = req.tenantContext?.tenantId;

    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;

    const existing = await prisma.entityAssignment.findFirst({ where });
    if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

    const updated = await prisma.entityAssignment.update({
      where: { id },
      data: { permissions: body.permissions },
    });

    return updated;
  });

  // ─── DELETE ASSIGNMENT ─────────────────────────────────
  app.delete('/:id', {
    schema: {
      tags: ['Entity Assignments'],
      summary: 'Remove entity assignment',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
    preHandler: [app.requirePermission('ENTITY_ASSIGN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantContext?.tenantId;

    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;

    const existing = await prisma.entityAssignment.findFirst({ where });
    if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

    await prisma.entityAssignment.delete({ where: { id } });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'ENTITY_UNASSIGNED', targetType: 'entity_assignment', targetId: id,
      afterValue: {
        entityId: existing.entityId, assigneeType: existing.assigneeType,
        userId: existing.userId, organizationId: existing.organizationId,
      },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // ─── GET ENTITIES VISIBLE TO CURRENT USER ──────────────
  app.get('/my-entities', {
    schema: {
      tags: ['Entity Assignments'],
      summary: 'List entities visible to current user',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 50 },
        },
      },
    },
  }, async (req) => {
    const { page = 1, limit = 50 } = req.query as any;
    const role = req.user.role;
    const tenantId = req.user.tenantId;
    const orgId = req.user.organizationId;
    const userId = req.user.sub;

    // SUPER_ADMIN sees all
    if (role === 'SUPER_ADMIN') {
      const impersonatedTenant = req.headers['x-tenant-id'] as string | undefined;
      const where: any = { isActive: true };
      if (impersonatedTenant) where.tenantId = impersonatedTenant;
      const [data, total] = await Promise.all([
        prisma.assetInstance.findMany({ where, skip: (page - 1) * limit, take: limit, select: { id: true, name: true, status: true, templateId: true, organizationId: true, tenantId: true } }),
        prisma.assetInstance.count({ where }),
      ]);
      return { data, total, page, limit };
    }

    // TENANT_ADMIN sees all in tenant
    if (['TENANT_ADMIN', 'ADMIN'].includes(role)) {
      const where = { tenantId: tenantId!, isActive: true };
      const [data, total] = await Promise.all([
        prisma.assetInstance.findMany({ where, skip: (page - 1) * limit, take: limit, select: { id: true, name: true, status: true, templateId: true, organizationId: true } }),
        prisma.assetInstance.count({ where }),
      ]);
      return { data, total, page, limit };
    }

    // ORG_ADMIN+ sees org entities + directly assigned
    const entityIdsFromAssignment = await prisma.entityAssignment.findMany({
      where: {
        tenantId: tenantId!,
        OR: [
          { assigneeType: 'USER', userId },
          { assigneeType: 'ORGANIZATION', organizationId: orgId },
          { assigneeType: 'ROLE', roleValue: role },
        ],
      },
      select: { entityId: true },
    });

    const assignedIds = entityIdsFromAssignment.map(a => a.entityId);

    const where: any = {
      isActive: true,
      tenantId: tenantId!,
      OR: [
        { organizationId: orgId }, // entities in user's org
        ...(assignedIds.length > 0 ? [{ id: { in: assignedIds } }] : []),
      ],
    };

    const [data, total] = await Promise.all([
      prisma.assetInstance.findMany({ where, skip: (page - 1) * limit, take: limit, select: { id: true, name: true, status: true, templateId: true, organizationId: true } }),
      prisma.assetInstance.count({ where }),
    ]);

    return { data, total, page, limit };
  });
}
