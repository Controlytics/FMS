import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { verifyAuditChecksum } from '../../lib/hash-chain.js';
import { auditQuerySchema } from '@digilog/shared';
import { errorResponses } from '../../lib/error-schemas.js';

export default async function auditRoutes(app: FastifyInstance) {
  // GET /api/audit — query audit trail (all authenticated users)
  app.get('/', {
    schema: {
      tags: ['Audit'],
      summary: 'Query audit trail',
      description: 'Retrieve paginated audit trail records with optional filtering by date period, user, action, and target type.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1, description: 'Page number' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Records per page' },
          period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year', 'all'], description: 'Predefined date period filter' },
          startDate: { type: 'string', description: 'Start date for custom range (ISO 8601)' },
          endDate: { type: 'string', description: 'End date for custom range (ISO 8601)' },
          search: { type: 'string', description: 'Search across userId, action, targetType, and targetId fields' },
          userId: { type: 'string', description: 'Filter by user ID' },
          action: { type: 'string', description: 'Filter by audit action type' },
          targetType: { type: 'string', description: 'Filter by target entity type' },
          sortBy: { type: 'string', enum: ['timestamp', 'action', 'userId', 'userRole'], default: 'timestamp', description: 'Field to sort by' },
          sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc', description: 'Sort direction' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  userId: { type: 'string', nullable: true },
                  userRole: { type: 'string', nullable: true },
                  action: { type: 'string' },
                  targetType: { type: 'string', nullable: true },
                  targetId: { type: 'string', nullable: true },
                  beforeValue: { type: 'object', additionalProperties: true, nullable: true },
                  afterValue: { type: 'object', additionalProperties: true, nullable: true },
                  reason: { type: 'string', nullable: true },
                  signatureMeaning: { type: 'string', nullable: true },
                  ipAddress: { type: 'string', nullable: true },
                  timestamp: { type: 'string', format: 'date-time' },
                  integrityValid: { type: 'boolean', description: 'Whether the checksum integrity verification passed' },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const query = auditQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};

    // Date filtering by period
    if (query.period && query.period !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (query.period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'quarter':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = new Date(0);
      }

      where.timestamp = { gte: startDate };
    } else if (query.startDate || query.endDate) {
      where.timestamp = {};
      if (query.startDate) (where.timestamp as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.timestamp as Record<string, unknown>).lte = new Date(query.endDate);
    }
    if (query.search) {
      const term = query.search;
      where.OR = [
        { userId: { contains: term, mode: 'insensitive' } },
        { action: { contains: term, mode: 'insensitive' } },
        { targetType: { contains: term, mode: 'insensitive' } },
        { targetId: { contains: term, mode: 'insensitive' } },
        { userRole: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;

    const sortField = (req.query as any).sortBy || 'timestamp';
    const sortDir = (req.query as any).sortOrder || 'desc';
    const validSortFields = ['timestamp', 'action', 'userId', 'userRole'];
    const orderByField = validSortFields.includes(sortField) ? sortField : 'timestamp';
    const orderByDir = sortDir === 'asc' ? 'asc' : 'desc';

    const [records, total] = await Promise.all([
      prisma.auditTrail.findMany({
        where: where as any,
        orderBy: { [orderByField]: orderByDir },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.auditTrail.count({ where: where as any }),
    ]);

    // Verify checksum integrity for each record
    const data = records.map((record) => ({
      ...record,
      integrityValid: verifyAuditChecksum(record),
    }));

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  });

  // GET /api/audit/:id — detail
  app.get('/:id', {
    schema: {
      tags: ['Audit'],
      summary: 'Get audit record by ID',
      description: 'Retrieve a single audit trail record with full details including before/after values.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Audit record ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'string' },
            userRole: { type: 'string' },
            action: { type: 'string' },
            targetType: { type: 'string', nullable: true },
            targetId: { type: 'string', nullable: true },
            beforeValue: { type: 'object', additionalProperties: true, nullable: true },
            afterValue: { type: 'object', additionalProperties: true, nullable: true },
            reason: { type: 'string', nullable: true },
            ipAddress: { type: 'string', nullable: true },
            userAgent: { type: 'string', nullable: true },
            sessionId: { type: 'string', nullable: true },
            checksum: { type: 'string' },
            signatureMeaning: { type: 'string', nullable: true },
            previousChecksum: { type: 'string', nullable: true },
            timestamp: { type: 'string', format: 'date-time' },
            integrityValid: { type: 'boolean', description: 'Whether the checksum integrity verification passed' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await prisma.auditTrail.findUnique({ where: { id: parseInt(id, 10) } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    return {
      ...record,
      integrityValid: verifyAuditChecksum(record),
    };
  });

  // DELETE /api/audit/:id — delete single audit record (SUPER_ADMIN only)
  app.delete('/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Audit'],
      summary: 'Delete audit record (SUPER_ADMIN)',
      description: 'Permanently delete a single audit trail record. SUPER_ADMIN only.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Audit record ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const numId = parseInt(id, 10);
    const record = await prisma.auditTrail.findUnique({ where: { id: numId } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });

    // Must disable the 21 CFR Part 11 delete trigger temporarily
    await prisma.$executeRawUnsafe('ALTER TABLE "audit_trail" DISABLE TRIGGER audit_trail_no_delete');
    try {
      await prisma.auditTrail.delete({ where: { id: numId } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "audit_trail" ENABLE TRIGGER audit_trail_no_delete');
    }
    return { success: true };
  });

  // POST /api/audit/bulk-delete — delete multiple audit records (SUPER_ADMIN only)
  app.post('/bulk-delete', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Audit'],
      summary: 'Delete selected audit records (SUPER_ADMIN)',
      description: 'Permanently delete multiple audit trail records by their IDs. SUPER_ADMIN only.',
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { ids } = req.body as { ids: number[] };

    // Must disable the 21 CFR Part 11 delete trigger temporarily
    await prisma.$executeRawUnsafe('ALTER TABLE "audit_trail" DISABLE TRIGGER audit_trail_no_delete');
    let count = 0;
    try {
      const result = await prisma.auditTrail.deleteMany({
        where: { id: { in: ids } },
      });
      count = result.count;
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "audit_trail" ENABLE TRIGGER audit_trail_no_delete');
    }

    return { success: true, count };
  });
}
