import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';

/**
 * Super Admin routes — SUPER_ADMIN only, cross-tenant platform management
 * Prefix: /api/super-admin
 */
export default async function superAdminRoutes(app: FastifyInstance) {
  // All routes require SUPER_ADMIN
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Super Admin access required' });
    }
  });

  // ─── LIST TENANTS ──────────────────────────────────────
  app.get('/tenants', {
    schema: {
      tags: ['Super Admin'],
      summary: 'List all tenants',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 10 },
          search: { type: 'string' },
          isActive: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const { page = 1, limit = 10, search, isActive } = req.query as any;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { organizations: true } },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    // Get user counts per tenant
    const enriched = await Promise.all(data.map(async (t) => {
      const userCount = await prisma.user.count({ where: { tenantId: t.id } });
      const deviceCount = await prisma.deviceCredential.count({ where: { tenantId: t.id } });
      return {
        ...t,
        userCount,
        deviceCount,
        organizationCount: t._count.organizations,
      };
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // ─── GET TENANT ────────────────────────────────────────
  app.get('/tenants/:id', {
    schema: {
      tags: ['Super Admin'],
      summary: 'Get tenant details',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        organizations: { where: { isActive: true }, orderBy: { name: 'asc' } },
        _count: { select: { organizations: true } },
      },
    });
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' });

    const userCount = await prisma.user.count({ where: { tenantId: id } });
    const deviceCount = await prisma.deviceCredential.count({ where: { tenantId: id } });
    return { ...tenant, userCount, deviceCount };
  });

  // ─── CREATE TENANT ─────────────────────────────────────
  app.post('/tenants', {
    schema: {
      tags: ['Super Admin'],
      summary: 'Create a new tenant',
      body: {
        type: 'object',
        required: ['name', 'slug', 'contactEmail'],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 200 },
          slug: { type: 'string', minLength: 2, maxLength: 100, pattern: '^[a-z0-9][a-z0-9-]*[a-z0-9]$' },
          contactEmail: { type: 'string', format: 'email' },
          contactPhone: { type: 'string' },
          plan: { type: 'string', enum: ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] },
          maxUsers: { type: 'integer', minimum: 1 },
          maxDevices: { type: 'integer', minimum: 1 },
          maxOrganizations: { type: 'integer', minimum: 1 },
          logoUrl: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as any;

    // Check slug uniqueness
    const existing = await prisma.tenant.findUnique({ where: { slug: body.slug } });
    if (existing) return reply.code(409).send({ error: 'CONFLICT', message: 'Tenant slug already exists' });

    const tenant = await prisma.tenant.create({ data: body });

    // Create default organization for the tenant
    await prisma.organization.create({
      data: {
        tenantId: tenant.id,
        name: 'Default Organization',
        slug: 'default',
        isActive: true,
      },
    });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'TENANT_CREATED', targetType: 'tenant', targetId: tenant.id,
      afterValue: { name: tenant.name, slug: tenant.slug, plan: tenant.plan },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return reply.code(201).send(tenant);
  });

  // ─── UPDATE TENANT ─────────────────────────────────────
  app.put('/tenants/:id', {
    schema: {
      tags: ['Super Admin'],
      summary: 'Update a tenant',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 200 },
          contactEmail: { type: 'string', format: 'email' },
          contactPhone: { type: 'string' },
          plan: { type: 'string', enum: ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] },
          maxUsers: { type: 'integer', minimum: 1 },
          maxDevices: { type: 'integer', minimum: 1 },
          maxOrganizations: { type: 'integer', minimum: 1 },
          logoUrl: { type: 'string' },
          isActive: { type: 'boolean' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;

    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Tenant not found' });

    const tenant = await prisma.tenant.update({ where: { id }, data: body });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'TENANT_UPDATED', targetType: 'tenant', targetId: tenant.id,
      beforeValue: { name: existing.name, plan: existing.plan, isActive: existing.isActive },
      afterValue: { name: tenant.name, plan: tenant.plan, isActive: tenant.isActive },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return tenant;
  });

  // ─── DELETE TENANT ─────────────────────────────────────
  app.delete('/tenants/:id', {
    schema: {
      tags: ['Super Admin'],
      summary: 'Deactivate a tenant (soft delete)',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.tenant.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Tenant not found' });

    // Soft delete — deactivate instead of destroying data
    await prisma.tenant.update({ where: { id }, data: { isActive: false } });

    await auditLog({
      userId: req.user.username, userRole: req.user.role,
      action: 'TENANT_DEACTIVATED', targetType: 'tenant', targetId: id,
      afterValue: { name: existing.name, slug: existing.slug },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, message: 'Tenant deactivated' };
  });

  // ─── TENANT STATS ──────────────────────────────────────
  app.get('/stats', {
    schema: {
      tags: ['Super Admin'],
      summary: 'Platform-wide statistics',
    },
  }, async () => {
    const [tenantCount, userCount, deviceCount, entityCount, orgCount] = await Promise.all([
      prisma.tenant.count({ where: { isActive: true } }),
      prisma.user.count(),
      prisma.deviceCredential.count(),
      prisma.assetInstance.count({ where: { isActive: true } }),
      prisma.organization.count({ where: { isActive: true } }),
    ]);
    return { tenants: tenantCount, users: userCount, devices: deviceCount, entities: entityCount, organizations: orgCount };
  });
}
