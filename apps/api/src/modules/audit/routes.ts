import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { verifyAuditChecksum } from '../../lib/hash-chain.js';
import { auditLog } from '../../lib/audit.js';
import { auditQuerySchema } from '@digilog/shared';
import { errorResponses } from '../../lib/error-schemas.js';
import { verifyAuditChain } from '../../lib/audit-verify.js';
import { enforceReauth } from '../../lib/reauth-check.js';

export default async function auditRoutes(app: FastifyInstance) {
  // GET /api/audit — query audit trail (requires AUDIT_READ permission)
  app.get('/', {
    preHandler: [app.requirePermission('AUDIT_READ')],
    schema: {
      tags: ['Audit'],
      summary: 'Query audit trail',
      description: 'Retrieve paginated audit trail records with optional filtering by date period, user, action, and target type.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1, description: 'Page number' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 20, description: 'Records per page (capped at 200 to prevent unbounded table dump)' },
          period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year', 'all'], description: 'Predefined date period filter' },
          startDate: { type: 'string', description: 'Start date for custom range (ISO 8601)' },
          endDate: { type: 'string', description: 'End date for custom range (ISO 8601)' },
          search: { type: 'string', description: 'Search across userId, action, targetType, and targetId fields' },
          userId: { type: 'string', description: 'Filter by user ID' },
          action: { type: 'string', description: 'Filter by audit action type' },
          targetType: { type: 'string', description: 'Filter by target entity type' },
          targetId: { type: 'string', description: 'Filter by target entity ID' },
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
                  id: { type: 'string' },
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
        ...errorResponses,
      },
    },
  }, async (req) => {
    const query = auditQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {
      AND: [
        { OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }] },
      ],
    };

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
    if (query.targetId) where.targetId = query.targetId;

    const sortField = (req.query as any).sortBy || 'timestamp';
    const sortDir = (req.query as any).sortOrder || 'desc';
    const validSortFields = ['timestamp', 'action', 'userId', 'userRole'];
    const orderByField = validSortFields.includes(sortField) ? sortField : 'timestamp';
    const orderByDir = sortDir === 'asc' ? 'asc' : 'desc';

    // Defensive cap: even if Zod schema is bypassed, never pull more than 200 rows.
    // Audit-trail is hash-chained + monotonic — without a cap, any AUDIT_READ caller
    // can pull the entire table in one response (DoS surface).
    const effectiveLimit = Math.min(Math.max(query.limit ?? 20, 1), 200);

    const [records, total] = await Promise.all([
      prisma.auditTrail.findMany({
        where: where as any,
        orderBy: { [orderByField]: orderByDir },
        skip: (query.page - 1) * effectiveLimit,
        take: effectiveLimit,
      }),
      prisma.auditTrail.count({ where: where as any }),
    ]);

    // Verify checksum integrity for each record
    const data = records.map((record: any) => ({
      ...record,
      integrityValid: verifyAuditChecksum(record),
    }));

    return {
      data,
      total,
      page: query.page,
      limit: effectiveLimit,
      totalPages: Math.ceil(total / effectiveLimit),
    };
  });

  // GET /api/audit/:id — detail (requires AUDIT_READ permission)
  app.get('/:id', {
    preHandler: [app.requirePermission('AUDIT_READ')],
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
            id: { type: 'string' },
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
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // SUPER_ADMIN actions are excluded from the audit list by design (see line 73).
    // The detail endpoint must apply the same filter, otherwise any user with
    // AUDIT_READ who knows a UUID could fetch a SUPER_ADMIN row directly —
    // contradicting the list-level policy and leaking the very rows the policy
    // hides. Use findFirst with the same shape as the list query.
    const record = await prisma.auditTrail.findFirst({
      where: {
        id,
        OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }],
      },
    });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    return {
      ...record,
      integrityValid: verifyAuditChecksum(record),
    };
  });

  // DELETE /api/audit/:id — delete single audit record (SUPER_ADMIN only)
  app.delete('/:id', {
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Audit'],
      summary: 'Delete audit record',
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
    // Audit 2026-05-04 fix #5 (web-routes review H4): per § 11.10(e),
    // audit-record deletion must be challengeable. Distinct action key
    // (DELETE_AUDIT_RECORD vs BULK_DELETE_AUDIT_RECORDS) so the operator
    // intent is recorded in the surviving audit trail.
    const { ok } = await enforceReauth('DELETE_AUDIT_RECORD', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };

    const record = await prisma.auditTrail.findUnique({ where: { id } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });

    await auditLog({
      userId: req.user.sub, userRole: req.user.role,
      action: 'AUDIT_RECORD_DELETED',
      targetType: 'audit_trail', targetId: id,
      beforeValue: { id: record.id, action: record.action, timestamp: record.timestamp, userId: record.userId, targetType: record.targetType, targetId: record.targetId },
      reason: 'Audit record deleted by administrator',
      signatureMeaning: `Audit record ${id} permanently deleted`,
      ipAddress: req.ip, sessionId: req.user.sessionId,
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" DISABLE TRIGGER audit_trail_no_delete');
      await tx.auditTrail.delete({ where: { id } });
      await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" ENABLE TRIGGER audit_trail_no_delete');
    });

    return { success: true };
  });

  // POST /api/audit/bulk-delete — delete multiple audit records (SUPER_ADMIN only)
  app.post('/bulk-delete', {
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Audit'],
      summary: 'Delete selected audit records',
      description: 'Permanently delete multiple audit trail records by their IDs. SUPER_ADMIN only.',
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
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
  }, async (req, reply) => {
    // Audit 2026-05-04 fix #5 (web-routes review H4): bulk delete needs its
    // own action key — collapsing it into DELETE_AUDIT_RECORD would let an
    // operator wipe many rows under a single password challenge.
    const { ok } = await enforceReauth('BULK_DELETE_AUDIT_RECORDS', req, reply);
    if (!ok) return;
    const { ids } = req.body as { ids: string[] };

    const records = await prisma.auditTrail.findMany({
      where: { id: { in: ids } },
      select: { id: true, action: true, timestamp: true, userId: true, targetType: true, targetId: true },
    });

    await auditLog({
      userId: req.user.sub, userRole: req.user.role,
      action: 'AUDIT_RECORDS_BULK_DELETED',
      targetType: 'audit_trail', targetId: ids.join(','),
      beforeValue: { recordCount: records.length, records },
      reason: `${records.length} audit records deleted by administrator`,
      signatureMeaning: `${records.length} audit records permanently deleted`,
      ipAddress: req.ip, sessionId: req.user.sessionId,
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" DISABLE TRIGGER audit_trail_no_delete');
      const deleted = await tx.auditTrail.deleteMany({
        where: { id: { in: ids } },
      });
      await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" ENABLE TRIGGER audit_trail_no_delete');
      return deleted;
    });

    return { success: true, count: result.count };
  });

  // GET /api/audit/verify-chain — audit 2026-05-04 fix C3.
  //
  // Walks the audit chain in chain_position order and reports any per-row
  // checksum mismatch, chain-link mismatch, or chain_position gap. SUPER_ADMIN
  // only — exposes the full integrity surface and should not be operator-
  // accessible by default.
  //
  // The chain itself is built into the audit_trail schema; this endpoint is
  // the auditor-facing read view. See apps/api/src/lib/audit-verify.ts for
  // detection semantics.
  app.get('/verify-chain', {
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Audit'],
      summary: 'Verify audit chain integrity',
      description: 'Walk the audit_trail hash chain and report any tampering. SUPER_ADMIN only. Optional fromPosition/toPosition narrow the scope; default is the full table.',
      querystring: {
        type: 'object',
        properties: {
          fromPosition: { type: 'integer', minimum: 0 },
          toPosition: { type: 'integer', minimum: 0 },
          maxAnomalies: { type: 'integer', minimum: 1, maximum: 10000, default: 100 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            intact: { type: 'boolean' },
            totalRowsChecked: { type: 'integer' },
            preChainRows: { type: 'integer' },
            chainedRows: { type: 'integer' },
            highestPosition: { type: 'integer', nullable: true },
            anomalies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  position: { type: 'integer' },
                  id: { type: 'string' },
                  kind: { type: 'string' },
                  message: { type: 'string' },
                  expected: { type: 'string', nullable: true },
                  actual: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const q = req.query as { fromPosition?: number; toPosition?: number; maxAnomalies?: number };
    const result = await verifyAuditChain({
      fromPosition: q.fromPosition,
      toPosition: q.toPosition,
      maxAnomalies: q.maxAnomalies,
    });
    return result;
  });
}
