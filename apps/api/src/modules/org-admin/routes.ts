import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';

/**
 * Organization Admin routes — ORG_ADMIN+ within their organization
 * Prefix: /api/org
 */
export default async function orgAdminRoutes(app: FastifyInstance) {

  // Helper: get effective orgId
  function getOrgId(req: FastifyRequest): string | null {
    return req.user.organizationId || null;
  }


  // ─── LIST ORG MEMBERS ──────────────────────────────────
  app.get('/users', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN')],
    schema: {
      tags: ['Org Admin'],
      summary: 'List users in organization',
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
    const orgId = getOrgId(req);
    const { page = 1, limit = 10, search } = req.query as any;

    const where: any = {};
    // ADMIN sees all users; ORG_ADMIN sees only their org
    if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
      where.organizationId = orgId;
    }
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, username: true, fullName: true, email: true,
          department: true, role: true, status: true, lastLogin: true,
          organizationId: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // ─── LIST ORG ENTITIES ─────────────────────────────────
  app.get('/entities', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN')],
    schema: {
      tags: ['Org Admin'],
      summary: 'List entities in organization',
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
    const orgId = getOrgId(req);
    const { page = 1, limit = 10, search } = req.query as any;

    const where: any = { isActive: true };
    // ORG_ADMIN sees only their org's entities
    if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
      where.organizationId = orgId;
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      prisma.assetInstance.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, name: true, description: true, status: true,
          templateId: true, organizationId: true,
          createdAt: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.assetInstance.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  });

  // ─── GET MY ORG INFO ───────────────────────────────────
  app.get('/info', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN')],
    schema: {
      tags: ['Org Admin'],
      summary: 'Get current organization info',
    },
  }, async (req, reply) => {
    const orgId = getOrgId(req);
    if (!orgId) return reply.code(400).send({ error: 'No organization context' });

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    const [userCount, entityCount] = await Promise.all([
      prisma.user.count({ where: { organizationId: orgId } }),
      prisma.assetInstance.count({ where: { organizationId: orgId, isActive: true } }),
    ]);

    return { ...org, userCount, entityCount };
  });
}
