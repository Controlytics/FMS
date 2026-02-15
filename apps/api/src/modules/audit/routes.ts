import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { auditQuerySchema, auditParamsSchema, auditVerifyQuerySchema } from '@digilog/shared';
import { computeChecksum } from '../../lib/hash-chain.js';

export default async function auditRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/audit — query audit trail (all authenticated users)
  app.get('/', {
    schema: { tags: ['Audit'], summary: 'Query audit trail', description: 'Query audit trail with pagination and filters', querystring: auditQuerySchema },
  }, async (req) => {
    const where: Record<string, unknown> = {};

    if (req.query.startDate || req.query.endDate) {
      where.timestamp = {};
      if (req.query.startDate) (where.timestamp as Record<string, unknown>).gte = new Date(req.query.startDate);
      if (req.query.endDate) (where.timestamp as Record<string, unknown>).lte = new Date(req.query.endDate);
    }
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.action) where.action = req.query.action;
    if (req.query.targetType) where.targetType = req.query.targetType;

    const [records, total] = await Promise.all([
      prisma.auditTrail.findMany({
        where: where as any,
        orderBy: { timestamp: 'desc' },
        skip: (req.query.page - 1) * req.query.limit,
        take: req.query.limit,
      }),
      prisma.auditTrail.count({ where: where as any }),
    ]);

    return {
      data: records,
      total,
      page: req.query.page,
      limit: req.query.limit,
      totalPages: total > 0 ? Math.ceil(total / req.query.limit) : 0,
    };
  });

  // GET /api/audit/verify — bulk verify checksums
  app.get('/verify', {
    schema: { tags: ['Audit'], summary: 'Bulk verify checksums', description: 'Verify audit trail integrity across a date range', querystring: auditVerifyQuerySchema },
  }, async (req) => {
    const where: Record<string, unknown> = {};

    if (req.query.startDate || req.query.endDate) {
      where.timestamp = {};
      if (req.query.startDate) (where.timestamp as Record<string, unknown>).gte = new Date(req.query.startDate);
      if (req.query.endDate) (where.timestamp as Record<string, unknown>).lte = new Date(req.query.endDate);
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
    schema: { tags: ['Audit'], summary: 'Get audit record', description: 'Get a single audit trail record by ID', params: auditParamsSchema },
  }, async (req, reply) => {
    const { id } = req.params;
    const record = await prisma.auditTrail.findUnique({ where: { id } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    return record;
  });

  // GET /api/audit/:id/verify — verify single record checksum
  app.get('/:id/verify', {
    schema: { tags: ['Audit'], summary: 'Verify checksum', description: 'Verify the integrity of a single audit record by recomputing its checksum', params: auditParamsSchema },
  }, async (req, reply) => {
    const { id } = req.params;
    const record = await prisma.auditTrail.findUnique({ where: { id } });
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
