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
        // A SUPER_ADMIN viewer sees SUPER_ADMIN actions too (incl. their own
        // login/logout) — a complete 21 CFR §11 audit trail. Lower roles still
        // never see SUPER_ADMIN rows. (Previously unconditional → SUPER_ADMIN
        // actions were hidden from everyone, so superadmin's own logout looked
        // "unrecorded" even though it was. Same pattern fixed in the single-row
        // fetch below.)
        ...(req.user.role === 'SUPER_ADMIN'
          ? []
          : [{ OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }] }]),
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

    // 2026-05-20 enrichment fix: many older audit rows stored only IDs in
    // afterValue (e.g. CYCLE_STARTED had {cycleCode, cleaningReasonKey,
    // filterId} but no filterName). The audit-templates substitution on the
    // FE looks for `name` / `filterName` / `equipmentName` and falls through
    // to "" when none are present — so the rendered row reads
    //   `cycle started for filter "" with reason "FILTER" by 101114`
    // Backfilling stored payloads is impossible without a chain-breaking
    // UPDATE. Instead, enrich at read time by batch-looking up filters and
    // cycles that the audit row references, then attaching `_enriched`
    // fields to afterValue (NOT modifying the original — the checksum still
    // verifies). FE merges these in for rendering.
    // Common shapes for asset-instance ID across audit row variants:
    //   - afterValue.filterId           (cycle-write events)
    //   - afterValue.assetId            (identifier service)
    //   - afterValue.assetInstanceId    (legacy)
    //   - afterValue.entityId           (legacy + some queries)
    //   - targetId when targetType='filter' OR 'asset_instance'
    const filterIds = new Set<string>();
    const cycleIds = new Set<string>();
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const r of records as any[]) {
      const af = (r.afterValue ?? {}) as Record<string, unknown>;
      const bf = (r.beforeValue ?? {}) as Record<string, unknown>;
      for (const key of ['filterId', 'assetId', 'assetInstanceId', 'entityId']) {
        const v = af[key] || bf[key];
        if (typeof v === 'string' && UUID_RE.test(v)) filterIds.add(v);
      }
      if (typeof r.targetId === 'string' && UUID_RE.test(r.targetId)) {
        if (r.targetType === 'filter' || r.targetType === 'asset_instance') {
          filterIds.add(r.targetId);
        }
        if (r.targetType === 'cleaning_cycle') cycleIds.add(r.targetId);
      }
    }
    const [filters, cycles] = await Promise.all([
      filterIds.size > 0
        ? prisma.assetInstance.findMany({
            where: { id: { in: Array.from(filterIds) } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      cycleIds.size > 0
        ? prisma.cleaningCycle.findMany({
            where: { id: { in: Array.from(cycleIds) } },
            select: { id: true, cycleCode: true, filterId: true, cleaningReasonLabel: true },
          })
        : Promise.resolve([] as Array<{ id: string; cycleCode: string; filterId: string; cleaningReasonLabel: string | null }>),
    ]);
    const filterNameById = new Map(filters.map((f) => [f.id, f.name]));
    const cycleById = new Map(cycles.map((c) => [c.id, c]));
    // Second-pass filter lookup for cycles → their referenced filterIds
    const extraFilterIds = new Set<string>();
    for (const c of cycles) if (c.filterId && !filterNameById.has(c.filterId)) extraFilterIds.add(c.filterId);
    if (extraFilterIds.size > 0) {
      const extra = await prisma.assetInstance.findMany({
        where: { id: { in: Array.from(extraFilterIds) } },
        select: { id: true, name: true },
      });
      for (const f of extra) filterNameById.set(f.id, f.name);
    }

    const data = records.map((record: any) => {
      const af = (record.afterValue ?? {}) as Record<string, unknown>;
      const bf = (record.beforeValue ?? {}) as Record<string, unknown>;
      const enriched: Record<string, unknown> = { ...af };

      // Any of the common ID-keys map to the same asset_instances row;
      // stamp filterName on the enriched payload so the FE's targetName
      // resolver (after.name || filterName || ...) picks it up.
      const fid = (af.filterId as string)
        || (bf.filterId as string)
        || (af.assetId as string)
        || (bf.assetId as string)
        || (af.assetInstanceId as string)
        || (bf.assetInstanceId as string)
        || (af.entityId as string)
        || (bf.entityId as string)
        || ((record.targetType === 'filter' || record.targetType === 'asset_instance')
            ? record.targetId
            : null);
      if (fid && filterNameById.has(fid)) {
        enriched.filterName = enriched.filterName ?? filterNameById.get(fid);
      }
      if (record.targetType === 'cleaning_cycle' && typeof record.targetId === 'string') {
        const c = cycleById.get(record.targetId);
        if (c) {
          if (c.filterId && filterNameById.has(c.filterId)) {
            enriched.filterName = enriched.filterName ?? filterNameById.get(c.filterId);
          }
          if (c.cleaningReasonLabel) {
            enriched.cleaningReasonLabel = enriched.cleaningReasonLabel ?? c.cleaningReasonLabel;
          }
          if (c.cycleCode) {
            enriched.cycleCode = enriched.cycleCode ?? c.cycleCode;
          }
        }
      }

      return {
        ...record,
        // Override afterValue with enriched fields so the FE template
        // substitution picks them up without any FE-side fetches. Original
        // checksum is computed against ORIGINAL afterValue — recompute
        // verification against THAT, not the enriched copy.
        afterValue: enriched,
        integrityValid: verifyAuditChecksum({ ...record, afterValue: af }),
      };
    });

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
    // Mirror the list policy: a SUPER_ADMIN viewer may fetch SUPER_ADMIN rows;
    // lower roles cannot (so a non-SUPER_ADMIN with AUDIT_READ who knows a UUID
    // still can't pull a SUPER_ADMIN row directly).
    const record = await prisma.auditTrail.findFirst({
      where: {
        id,
        ...(req.user.role === 'SUPER_ADMIN'
          ? {}
          : { OR: [{ userRole: { not: 'SUPER_ADMIN' } }, { userRole: null }] }),
      },
    });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    return {
      ...record,
      integrityValid: verifyAuditChecksum(record),
    };
  });

  // DELETE /api/audit/:id — delete single audit record (SUPER_ADMIN only)
  // POST /api/audit/:id/redact — redact a single audit record (SUPER_ADMIN only).
  // Replaces DELETE per delta-audit §C1 / May 16 §1.2: physical deletion broke
  // the hash chain at the gap point. REDACT preserves checksum + chain link,
  // NULLs the beforeValue/afterValue payload, and stamps redactedAt/redactedBy.
  // verifyAuditChecksum() treats redactedAt != null rows as "valid (redacted)"
  // — chain integrity preserved, payload contents withheld.
  app.post('/:id/redact', {
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Audit'],
      summary: 'Redact audit record',
      description: 'Redact the payload of a single audit trail record while preserving the chain link. SUPER_ADMIN only. Replaces the prior DELETE endpoint per 21 CFR §11.10(e).',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Audit record ID' } },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string', minLength: 5, maxLength: 500 } },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, redactedAt: { type: 'string' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REDACT_AUDIT_RECORD', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason: string };

    const record = await prisma.auditTrail.findUnique({ where: { id } });
    if (!record) return reply.code(404).send({ error: 'Audit record not found' });
    // redactedAt accessed via raw SQL because the Prisma client may not yet
    // be regenerated against the 20260520140000 migration on dev machines
    // with tsx watch holding the engine DLL (per LOCAL_SETUP_WINDOWS notes).
    const priorRedact = await prisma.$queryRaw<Array<{ redacted_at: Date | null }>>`
      SELECT redacted_at FROM audit_trail WHERE id = ${id}::uuid
    `;
    if (priorRedact[0]?.redacted_at) return reply.code(409).send({ error: 'ALREADY_REDACTED', message: 'Record was already redacted' });

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE audit_trail
        SET before_value = NULL,
            after_value = NULL,
            redacted_at = ${now},
            redacted_by = ${req.user.sub},
            redaction_reason = ${reason}
        WHERE id = ${id}::uuid
      `;
      // Meta-audit row records the redaction itself (within the same tx so
      // it cannot be lost if anything else fails).
      await auditLog({
        userId: req.user.sub, userRole: req.user.role,
        action: 'AUDIT_RECORD_REDACTED',
        targetType: 'audit_trail', targetId: id,
        beforeValue: { id: record.id, action: record.action, timestamp: record.timestamp, userId: record.userId, targetType: record.targetType, targetId: record.targetId },
        reason,
        signatureMeaning: `Audit record ${id} payload redacted; chain link preserved`,
        ipAddress: req.ip, sessionId: req.user.sessionId,
      }, tx);
    });

    return { success: true, redactedAt: now.toISOString() };
  });

  // POST /api/audit/bulk-redact — redact multiple audit records (SUPER_ADMIN only).
  app.post('/bulk-redact', {
    preHandler: [app.requireSuperAdmin()],
    schema: {
      tags: ['Audit'],
      summary: 'Redact selected audit records',
      description: 'Redact the payloads of multiple audit trail records by ID. SUPER_ADMIN only. Replaces bulk-delete per 21 CFR §11.10(e).',
      body: {
        type: 'object',
        required: ['ids', 'reason'],
        properties: {
          ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 1000 },
          reason: { type: 'string', minLength: 5, maxLength: 500 },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, count: { type: 'integer' }, redactedAt: { type: 'string' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('BULK_REDACT_AUDIT_RECORDS', req, reply);
    if (!ok) return;
    const { ids, reason } = req.body as { ids: string[]; reason: string };

    // Pull un-redacted matching ids via raw SQL (Prisma client regen-pending
    // on dev). The redacted_at filter ensures we never re-redact (which
    // would overwrite the prior redactor's name + reason).
    const unredacted = await prisma.$queryRaw<Array<{ id: string; action: string; timestamp: Date; user_id: string | null; target_type: string | null; target_id: string | null }>>`
      SELECT id, action, timestamp, user_id, target_type, target_id
      FROM audit_trail
      WHERE id = ANY(${ids}::uuid[]) AND redacted_at IS NULL
    `;
    if (unredacted.length === 0) return reply.code(409).send({ error: 'ALREADY_REDACTED_OR_MISSING', message: 'No matching un-redacted records' });
    const matchedIds = unredacted.map((r) => r.id);

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE audit_trail
        SET before_value = NULL,
            after_value = NULL,
            redacted_at = ${now},
            redacted_by = ${req.user.sub},
            redaction_reason = ${reason}
        WHERE id = ANY(${matchedIds}::uuid[])
      `;
      await auditLog({
        userId: req.user.sub, userRole: req.user.role,
        action: 'AUDIT_RECORDS_BULK_REDACTED',
        targetType: 'audit_trail', targetId: matchedIds.join(','),
        beforeValue: { recordCount: unredacted.length, records: unredacted.map((r) => ({
          id: r.id, action: r.action, timestamp: r.timestamp, userId: r.user_id,
          targetType: r.target_type, targetId: r.target_id,
        })) },
        reason,
        signatureMeaning: `${unredacted.length} audit record payloads redacted; chain links preserved`,
        ipAddress: req.ip, sessionId: req.user.sessionId,
      }, tx);
      return updated;
    });

    return { success: true, count: result, redactedAt: now.toISOString() };
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
