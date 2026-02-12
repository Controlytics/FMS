import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditQuerySchema } from '@digilog/shared';

export default async function auditRoutes(app: FastifyInstance) {
  // GET /api/audit — query audit trail (all authenticated users)
  app.get('/', async (req) => {
    const query = auditQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};

    if (query.startDate || query.endDate) {
      where.timestamp = {};
      if (query.startDate) (where.timestamp as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.timestamp as Record<string, unknown>).lte = new Date(query.endDate);
    }
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;

    const [records, total] = await Promise.all([
      prisma.auditTrail.findMany({
        where: where as any,
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.auditTrail.count({ where: where as any }),
    ]);

    return {
      data: records,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  });

  // GET /api/audit/:id — detail
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await prisma.auditTrail.findUnique({ where: { id: parseInt(id, 10) } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    return record;
  });
}
