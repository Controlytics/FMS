import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { getTenantId } from "../../lib/tenant-utils.js";

/**
 * Tenant Admin routes — TENANT_ADMIN+ within their tenant
 * Prefix: /api/tenant
 */
export default async function tenantAdminRoutes(app: FastifyInstance) {
  // All routes require at least TENANT_ADMIN (or SUPER_ADMIN)
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const role = req.user?.role;
    if (!role) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    if (role === 'SUPER_ADMIN') return; // SUPER_ADMIN can access with X-Tenant-Id
    if (!['TENANT_ADMIN', 'ADMIN'].includes(role)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Tenant Admin access required' });
    }
    if (!req.user?.tenantId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'No tenant context' });
    }
  });

  // Helper: get effective tenantId (from JWT or X-Tenant-Id header for SUPER_ADMIN)

  // ═══════════════════════════════════════════════════════
  // ORGANIZATION MANAGEMENT
  // ═══════════════════════════════════════════════════════

  // ─── LIST ORGANIZATIONS ────────────────────────────────
  app.get('/organizations', {
    schema: {
      tags: ['Tenant Admin'],
      summary: 'List organizations in tenant',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 10 },
          search: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { page = 1, limit = 10, search } = req.query as any;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: "asc" },
        include: { tenant: { select: { name: true } } },
      }),
      prisma.organization.count({ where }),
    ]);

    // Enrich with user counts
    const enriched = await Promise.all(data.map(async (org) => {
      const userCount = await prisma.user.count({ where: { organizationId: org.id } });
      const entityCount = await prisma.assetInstance.count({ where: { organizationId: org.id, isActive: true } });
      return { ...org, userCount, entityCount };
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // ─── GET ORGANIZATION ──────────────────────────────────
  app.get('/organizations/:id', {
    schema: {
      tags: ['Tenant Admin'],
      summary: 'Get organization details',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    const userCount = await prisma.user.count({ where: { organizationId: id } });
    const entityCount = await prisma.assetInstance.count({ where: { organizationId: id, isActive: true } });
    return { ...org, userCount, entityCount };
  });

  // ─── CREATE ORGANIZATION ───────────────────────────────
  app.post('/organizations', {
    schema: {
      tags: ['Tenant Admin'],
      summary: 'Create organization',
      body: {
        type: 'object',
        required: ['name', 'slug'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 200 },
          slug: { type: 'string', minLength: 2, maxLength: 100, pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$' },
          description: { type: 'string', maxLength: 500 },
          parentOrgId: { type: 'string', format: 'uuid' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'Tenant context required' });

    const body = req.body as any;

    // Check tenant org limit
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });
    const orgCount = await prisma.organization.count({ where: { tenantId } });
    if (orgCount >= tenant.maxOrganizations) {
      return reply.code(400).send({ error: 'ORG_LIMIT', message: `Organization limit (${tenant.maxOrganizations}) reached for this tenant` });
    }

    // Check slug uniqueness within tenant
    const existing = await prisma.organization.findFirst({ where: { tenantId, slug: body.slug } });
    if (existing) return reply.code(409).send({ error: 'CONFLICT', message: 'Organization slug already exists in this tenant' });

    const org = await prisma.organization.create({
      data: { ...body, tenantId, createdBy: req.user.username },
    });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'ORGANIZATION_CREATED', targetType: 'organization', targetId: org.id,
      afterValue: { name: org.name, slug: org.slug },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send(org);
  });

  // ─── UPDATE ORGANIZATION ───────────────────────────────
  app.put('/organizations/:id', {
    schema: {
      tags: ['Tenant Admin'],
      summary: 'Update organization',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 200 },
          description: { type: 'string', maxLength: 500 },
          isActive: { type: 'boolean' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Organization not found' });

    const org = await prisma.organization.update({ where: { id }, data: body });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'ORGANIZATION_UPDATED', targetType: 'organization', targetId: org.id,
      beforeValue: { name: existing.name, isActive: existing.isActive },
      afterValue: { name: org.name, isActive: org.isActive },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return org;
  });

  // ─── DELETE ORGANIZATION ───────────────────────────────
  app.delete('/organizations/:id', {
    schema: {
      tags: ['Tenant Admin'],
      summary: 'Deactivate or delete organization',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      querystring: { type: 'object', properties: { permanent: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { permanent } = req.query as { permanent?: string };

    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Organization not found' });

    if (permanent === 'true') {
      // Unassign all users from this organization
      const unassignedUsers = await prisma.user.updateMany({ where: { organizationId: id }, data: { organizationId: null } });

      // Unassign all entity instances from this organization
      const unassignedEntities = await prisma.assetInstance.updateMany({ where: { organizationId: id }, data: { organizationId: null } });

      // Unassign all entity templates from this organization
      const unassignedTemplates = await prisma.assetTemplate.updateMany({ where: { organizationId: id }, data: { organizationId: null } });

      // Delete entity assignments for this organization
      await prisma.entityAssignment.deleteMany({ where: { organizationId: id } });

      // Delete template assignments for this organization
      await prisma.templateAssignment.deleteMany({ where: { organizationId: id } });

      // Delete dashboard assignments for this organization
      await prisma.dashboardAssignment.deleteMany({ where: { organizationId: id } });

      // Delete the organization
      await prisma.organization.delete({ where: { id } });

      await auditLog({
        userId: req.user.username, userRole: req.user.role,
        action: 'ORGANIZATION_DELETED', targetType: 'organization', targetId: id,
        afterValue: {
          name: existing.name, slug: existing.slug, permanent: true,
          unassignedUsers: unassignedUsers.count,
          unassignedEntities: unassignedEntities.count,
          unassignedTemplates: unassignedTemplates.count,
        },
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });
      return {
        success: true,
        message: 'Organization permanently deleted',
        unassigned: {
          users: unassignedUsers.count,
          entities: unassignedEntities.count,
          templates: unassignedTemplates.count,
        },
      };
    }

    await prisma.organization.update({ where: { id }, data: { isActive: false } });
    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'ORGANIZATION_DEACTIVATED', targetType: 'organization', targetId: id,
      afterValue: { name: existing.name, slug: existing.slug },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });
    return { success: true, message: 'Organization deactivated' };
  });

  // ═══════════════════════════════════════════════════════
  // TENANT INFO
  // ═══════════════════════════════════════════════════════

  // ─── GET MY TENANT ─────────────────────────────────────
  app.get('/info', {
    schema: {
      tags: ['Tenant Admin'],
      summary: 'Get current tenant info',
    },
  }, async (req, reply) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return reply.code(400).send({ error: 'No tenant context' });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const [userCount, orgCount, deviceCount, entityCount] = await Promise.all([
      prisma.user.count({ where: { tenantId } }),
      prisma.organization.count({ where: { tenantId, isActive: true } }),
      prisma.deviceCredential.count({ where: { tenantId } }),
      prisma.assetInstance.count({ where: { tenantId, isActive: true } }),
    ]);

    return {
      ...tenant,
      usage: { users: userCount, organizations: orgCount, devices: deviceCount, entities: entityCount },
      limits: { maxUsers: tenant.maxUsers, maxDevices: tenant.maxDevices, maxOrganizations: tenant.maxOrganizations },
    };
  });
}
