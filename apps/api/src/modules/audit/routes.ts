import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditQuerySchema } from '@digilog/shared';
import { computeChecksum } from '../../lib/hash-chain.js';

export default async function auditRoutes(app: FastifyInstance) {
  // GET /api/audit — query audit trail (all authenticated users)
  app.get('/', {
    schema: { tags: ['Audit'], summary: 'Query audit trail', description: 'Query audit trail with pagination and filters' },
  }, async (req) => {
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
      totalPages: total > 0 ? Math.ceil(total / query.limit) : 0,
    };
  });

  // GET /api/audit/verify — bulk verify checksums
  app.get('/verify', {
    schema: { tags: ['Audit'], summary: 'Bulk verify checksums', description: 'Verify audit trail integrity across a date range' },
  }, async (req) => {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const where: Record<string, unknown> = {};

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) (where.timestamp as Record<string, unknown>).gte = new Date(startDate);
      if (endDate) (where.timestamp as Record<string, unknown>).lte = new Date(endDate);
    }

    const records = await prisma.auditTrail.findMany({ where: where as any, orderBy: { timestamp: 'asc' } });

    let validCount = 0;
    let invalidCount = 0;
    const results: Array<{ id: number; valid: boolean; storedChecksum: string; computedChecksum: string }> = [];

    for (const record of records) {
      const computed = computeChecksum({
        timestamp: record.timestamp.toISOString(),
        userId: record.userId,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        afterValue: record.afterValue,
      } as Record<string, unknown>);

      const valid = computed === record.checksum;
      if (valid) validCount++; else invalidCount++;
      if (!valid) {
        results.push({ id: record.id, valid, storedChecksum: record.checksum ?? '', computedChecksum: computed });
      }
    }

    return { total: records.length, valid: validCount, invalid: invalidCount, invalidRecords: results };
  });

  // GET /api/audit/:id — detail
  app.get('/:id', {
    schema: { tags: ['Audit'], summary: 'Get audit record', description: 'Get a single audit trail record by ID' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await prisma.auditTrail.findUnique({ where: { id: parseInt(id, 10) } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    return record;
  });

  // GET /api/audit/:id/verify — verify single record checksum
  app.get('/:id/verify', {
    schema: { tags: ['Audit'], summary: 'Verify checksum', description: 'Verify the integrity of a single audit record by recomputing its checksum' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await prisma.auditTrail.findUnique({ where: { id: parseInt(id, 10) } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });

    const computedChecksum = computeChecksum({
      timestamp: record.timestamp.toISOString(),
      userId: record.userId,
      action: record.action,
      targetType: record.targetType,
      targetId: record.targetId,
      afterValue: record.afterValue,
    } as Record<string, unknown>);

    return {
      valid: computedChecksum === record.checksum,
      storedChecksum: record.checksum,
      computedChecksum,
    };
  });
}
