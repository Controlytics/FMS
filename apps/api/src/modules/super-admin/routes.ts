import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';

/**
 * Super Admin routes — SUPER_ADMIN only, platform management
 * Prefix: /api/super-admin
 */
export default async function superAdminRoutes(app: FastifyInstance) {

  // ─── PLATFORM STATS ────────────────────────────────────
  app.get('/stats', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Platform-wide statistics',
    },
  }, async () => {
    const [userCount, deviceCount, entityCount] = await Promise.all([
      prisma.user.count(),
      prisma.deviceCredential.count(),
      prisma.assetInstance.count({ where: { isActive: true } }),
    ]);
    return { users: userCount, devices: deviceCount, entities: entityCount };
  });

  // ═══════════════════════════════════════════════════════════
  // FILTER DATA MANAGEMENT — SUPER_ADMIN ONLY, NO AUDIT TRAIL
  // Allows silent editing/deletion of retirement and replacement
  // records. These operations leave no trace in the application.
  // ═══════════════════════════════════════════════════════════

  // ─── Edit a retired filter's fields ────────────────────
  app.put('/filter-data/retirements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Edit retired filter record (no audit trail)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          attributes: { type: 'object' },
          filterSet: { type: 'string', enum: ['SET_A', 'SET_B', ''] },
          updatedAt: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const filter = await prisma.assetInstance.findFirst({ where: { id, status: 'Retired' } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retired filter not found' });

    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.attributes !== undefined) data.attributes = body.attributes;
    if (body.updatedAt !== undefined) data.updatedAt = new Date(body.updatedAt);

    // filterSet now lives on FilterDetails (Step 6) — route to the sidecar.
    if (body.filterSet !== undefined) {
      await prisma.filterDetails.upsert({
        where: { assetInstanceId: id },
        update: { filterSet: body.filterSet || null },
        create: { assetInstanceId: id, filterSet: body.filterSet || null },
      });
    }
    const updated = Object.keys(data).length > 0
      ? await prisma.assetInstance.update({ where: { id }, data })
      : await prisma.assetInstance.findUnique({ where: { id } });
    return updated;
  });

  // ─── Delete a retirement record (hard delete) ──────────
  app.delete('/filter-data/retirements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Delete retired filter record permanently (no audit trail)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const filter = await prisma.assetInstance.findFirst({ where: { id, status: 'Retired' } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retired filter not found' });

    // Also delete any related audit trail entries for this filter
    await prisma.auditTrail.deleteMany({
      where: { targetId: id, action: { in: ['FILTER_RETIRED', 'FILTER_REPLACED'] } },
    });

    await prisma.assetInstance.delete({ where: { id } });
    return { success: true };
  });

  // ─── Unretire a filter (restore to Active) ─────────────
  app.post('/filter-data/retirements/:id/unretire', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Unretire a filter — restore to Active status (no audit trail)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          parentId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const filter = await prisma.assetInstance.findFirst({ where: { id, status: 'Retired' } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retired filter not found' });

    // Use provided parentId, or restore from saved pre-retirement parent,
    // or look up from replacement record (new filter's parent)
    const customAttrs = (filter.customAttributes as any) ?? {};
    let restoreParentId = body.parentId || customAttrs._preRetireParentId || null;

    // Fallback: find parent from replacement record (new filter inherits the parent)
    if (!restoreParentId) {
      const replacementAudits = await prisma.auditTrail.findMany({
        where: { action: 'FILTER_REPLACED', targetId: id },
        select: { afterValue: true },
        orderBy: { timestamp: 'desc' },
        take: 1,
      });
      const val = (replacementAudits[0]?.afterValue as any) ?? {};
      if (val.newFilterId) {
        const newFilter = await prisma.assetInstance.findUnique({
          where: { id: val.newFilterId },
          select: { parentId: true },
        });
        if (newFilter?.parentId) restoreParentId = newFilter.parentId;
      }
    }

    // Clean up the saved pre-retirement data from customAttributes
    const cleanedCustom = { ...customAttrs };
    delete cleanedCustom._preRetireParentId;

    await prisma.assetInstance.update({
      where: { id },
      data: {
        status: 'Active',
        isActive: true,
        parentId: restoreParentId,
        customAttributes: cleanedCustom,
      },
    });
    // currentLifecycleState moved to FilterDetails (Step 6).
    await prisma.filterDetails.upsert({
      where: { assetInstanceId: id },
      update: { currentLifecycleState: null },
      create: { assetInstanceId: id, currentLifecycleState: null },
    });

    // Restore parent relationship
    if (restoreParentId) {
      await prisma.assetRelationship.createMany({
        data: [
          { sourceAssetId: restoreParentId, targetAssetId: id, relationshipType: 'CONTAINS' },
          { sourceAssetId: id, targetAssetId: restoreParentId, relationshipType: 'CONTAINED_IN' },
        ],
        skipDuplicates: true,
      });
    }

    // If this filter was replaced, delete the replacement filter and all its traces
    const replacementAudit = await prisma.auditTrail.findFirst({
      where: { action: 'FILTER_REPLACED', targetId: id },
      select: { id: true, afterValue: true },
    });
    if (replacementAudit) {
      const rv = (replacementAudit.afterValue as any) ?? {};
      const newFilterId = rv.newFilterId;
      if (newFilterId) {
        // Delete the replacement filter's relationships
        await prisma.assetRelationship.deleteMany({
          where: { OR: [{ sourceAssetId: newFilterId }, { targetAssetId: newFilterId }] },
        });
        // Delete the replacement filter's identifiers
        await prisma.assetIdentifier.deleteMany({ where: { assetId: newFilterId } });
        // Terminate and delete any cleaning cycles on the replacement filter
        await prisma.filterEvent.deleteMany({ where: { filterId: newFilterId } });
        await prisma.cleaningCycle.deleteMany({ where: { filterId: newFilterId } });
        // Clear currentCycleId if set (FilterDetails — Step 6).
        await prisma.filterDetails.updateMany({ where: { assetInstanceId: newFilterId }, data: { currentCycleId: null } });
        // Delete the replacement filter itself
        await prisma.assetInstance.delete({ where: { id: newFilterId } }).catch(() => null);
      }
      // Delete the replacement audit record
      await prisma.auditTrail.delete({ where: { id: replacementAudit.id } }).catch(() => null);
    }

    // Remove the retirement audit trail entry silently
    await prisma.auditTrail.deleteMany({
      where: { targetId: id, action: 'FILTER_RETIRED' },
    });

    return { success: true };
  });

  // ─── Edit a replacement record ─────────────────────────
  app.put('/filter-data/replacements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Edit replacement record (no audit trail)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          remarks: { type: 'string' },
          performedBy: { type: 'string' },
          replacedAt: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const record = await prisma.auditTrail.findFirst({ where: { id, action: 'FILTER_REPLACED' } });
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Replacement record not found' });

    const data: any = {};
    if (body.performedBy !== undefined) data.userName = body.performedBy;
    if (body.replacedAt !== undefined) data.timestamp = new Date(body.replacedAt);

    // Update fields stored in afterValue JSON
    const afterVal = (record.afterValue as any) ?? {};
    let afterChanged = false;
    for (const key of ['remarks', 'oldFilterId', 'oldFilterName', 'newFilterId', 'newFilterName']) {
      if (body[key] !== undefined) { afterVal[key] = body[key]; afterChanged = true; }
    }
    if (afterChanged) data.afterValue = afterVal;

    await prisma.auditTrail.update({ where: { id }, data });
    return { success: true };
  });

  // ─── Delete a replacement record ───────────────────────
  app.delete('/filter-data/replacements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Delete replacement record permanently (no audit trail)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await prisma.auditTrail.findFirst({ where: { id, action: 'FILTER_REPLACED' } });
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Replacement record not found' });

    await prisma.auditTrail.delete({ where: { id } });
    return { success: true };
  });

  // ═══════════════════════════════════════════════════════════
  // COMPREHENSIVE DATA MANAGEMENT — ALL OPERATIONAL DATA
  // Generic list/edit/delete for every data table, no audit trail
  // ═══════════════════════════════════════════════════════════

  const dataPreHandler = [app.requireRole('SUPER_ADMIN')];
  const dataSchema = (summary: string) => ({
    tags: ['Super Admin - Data Management'],
    summary: `${summary} (no audit trail)`,
  });

  // Helper: paginated list for any Prisma model
  const paginatedList = async (model: any, query: any, orderBy: any = { createdAt: 'desc' }, include?: any, where?: any) => {
    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 25), 100);
    const findArgs: any = { orderBy, skip: (page - 1) * limit, take: limit };
    if (include) findArgs.include = include;
    if (where) findArgs.where = where;
    const countArgs: any = where ? { where } : {};
    const [data, total] = await Promise.all([
      model.findMany(findArgs),
      model.count(countArgs),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  };

  // ─── Cleaning Cycles ──────────────────────────────────
  app.get('/data/cleaning-cycles', { preHandler: dataPreHandler, schema: dataSchema('List cleaning cycles') }, async (req) => {
    return paginatedList(prisma.cleaningCycle, req.query, [{ startedAt: 'desc' }]);
  });

  app.put('/data/cleaning-cycles/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Edit cleaning cycle'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: true } } }, async (req, reply) => {
    const { id } = req.params as any;
    const existing = await prisma.cleaningCycle.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const body = req.body as any;
    const data: any = {};
    const dateFields = ['startedAt', 'completedAt', 'terminatedAt', 'dryerStartedAt'];
    const stringFields = ['status', 'cycleCode', 'cleaningReasonKey', 'cleaningReasonLabel', 'cleaningJustification', 'terminationReason'];
    const numFields = ['sequenceNumber', 'profileVersion', 'dryerDurationMinutes'];
    const uuidFields = ['filterId', 'ahuId', 'profileId', 'cleaningAreaId', 'equipmentGroupId'];
    for (const f of stringFields) { if (body[f] !== undefined) data[f] = body[f]; }
    for (const f of dateFields) { if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null; }
    for (const f of numFields) { if (body[f] !== undefined) data[f] = body[f] !== null ? Number(body[f]) : null; }
    for (const f of uuidFields) { if (body[f] !== undefined) data[f] = body[f] || null; }
    return prisma.cleaningCycle.update({ where: { id }, data });
  });

  app.delete('/data/cleaning-cycles/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Delete cleaning cycle'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req, reply) => {
    const { id } = req.params as any;
    const existing = await prisma.cleaningCycle.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    await prisma.filterEvent.deleteMany({ where: { cycleId: id } });
    // Clear currentCycleId/currentLifecycleState on FilterDetails (Step 6).
    await prisma.filterDetails.updateMany({ where: { currentCycleId: id }, data: { currentCycleId: null, currentLifecycleState: null } });
    await prisma.cleaningCycle.delete({ where: { id } });
    return { success: true };
  });

  // ─── Filter Events ────────────────────────────────────
  app.get('/data/filter-events', { preHandler: dataPreHandler, schema: dataSchema('List filter events') }, async (req) => {
    return paginatedList(prisma.filterEvent, req.query, { performedAt: 'desc' });
  });

  app.put('/data/filter-events/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Edit filter event'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: true } } }, async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const existing = await prisma.filterEvent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const data: any = {};
    for (const f of ['eventType', 'fromState', 'toState', 'remarks', 'checksum']) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    for (const f of ['filterId', 'cycleId', 'performedBy', 'cleaningAreaId', 'equipmentId', 'blockId']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    if (body.performedAt !== undefined) data.performedAt = new Date(body.performedAt);
    if (body.attributes !== undefined) data.attributes = body.attributes;
    return prisma.filterEvent.update({ where: { id }, data });
  });

  app.delete('/data/filter-events/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Delete filter event'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req, reply) => {
    const { id } = req.params as any;
    await prisma.filterEvent.delete({ where: { id } }).catch(() => null);
    return { success: true };
  });

  // ─── Audit Trail ──────────────────────────────────────
  // List is allowed (read-only). PUT + DELETE were removed 2026-05-20
  // (delta-audit §C2 / May 16 §1.3) — they let SUPER_ADMIN rewrite or erase
  // any audit row with no reauth and no audit-of-the-audit, making the
  // hash-chain machinery decorative. Audit records are immutable by 21 CFR
  // §11.10(e); the DB-level audit_trail_no_delete trigger and
  // verifyAuditChain are the source of truth, and the data-mgmt UI must not
  // expose escape hatches. If a row must be redacted, do it via the
  // dedicated REDACT path (Wave 4 §C1 — preserves chain links, NULLs
  // payload, requires reauth + meta-audit).
  app.get('/data/audit-trail', { preHandler: dataPreHandler, schema: dataSchema('List audit trail entries') }, async (req) => {
    return paginatedList(prisma.auditTrail, req.query, { timestamp: 'desc' });
  });

  // ─── Notifications ────────────────────────────────────
  app.get('/data/notifications', { preHandler: dataPreHandler, schema: dataSchema('List notifications') }, async (req) => {
    return paginatedList(prisma.notification, req.query, { createdAt: 'desc' });
  });

  app.put('/data/notifications/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Edit notification'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: true } } }, async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['type', 'title', 'message', 'forUserId', 'forRole', 'targetUserId', 'createdBy']) { if (body[f] !== undefined) data[f] = body[f]; }
    if (body.isRead !== undefined) data.isRead = body.isRead === true || body.isRead === 'true';
    if (body.readAt !== undefined) data.readAt = body.readAt ? new Date(body.readAt) : null;
    return prisma.notification.update({ where: { id }, data });
  });

  app.delete('/data/notifications/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Delete notification'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req) => {
    const { id } = req.params as any;
    await prisma.notification.delete({ where: { id } }).catch(() => null);
    return { success: true };
  });

  // ─── Admin Requests ───────────────────────────────────
  app.get('/data/admin-requests', { preHandler: dataPreHandler, schema: dataSchema('List admin requests') }, async (req) => {
    return paginatedList(prisma.adminRequest, req.query, { requestedAt: 'desc' });
  });

  app.put('/data/admin-requests/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Edit admin request'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: true } } }, async (req) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['requestType', 'status', 'requesterName', 'requesterEmployeeId', 'requesterEmail', 'remarks', 'adminRemarks', 'processedBy']) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    for (const f of ['requestedAt', 'processedAt']) {
      if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null;
    }
    if (body.requestData !== undefined) data.requestData = body.requestData;
    return prisma.adminRequest.update({ where: { id }, data });
  });

  app.delete('/data/admin-requests/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Delete admin request'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req) => {
    const { id } = req.params as any;
    await prisma.adminRequest.delete({ where: { id } }).catch(() => null);
    return { success: true };
  });

  // ─── Block Change Requests ────────────────────────────
  app.get('/data/block-change-requests', { preHandler: dataPreHandler, schema: dataSchema('List block change requests') }, async (req) => {
    return paginatedList(prisma.blockChangeRequest, req.query);
  });

  app.put('/data/block-change-requests/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Edit block change request'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: true } } }, async (req) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['status', 'reason', 'filterName', 'fromBlockName', 'toBlockName', 'requestedByName', 'processedByName', 'processedComment']) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    for (const f of ['filterId', 'fromBlockId', 'toBlockId', 'requestedBy', 'processedBy']) {
      if (body[f] !== undefined) data[f] = body[f] || null;
    }
    for (const f of ['processedAt', 'createdAt']) {
      if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null;
    }
    return prisma.blockChangeRequest.update({ where: { id }, data });
  });

  app.delete('/data/block-change-requests/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Delete block change request'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req) => {
    const { id } = req.params as any;
    await prisma.blockChangeRequest.delete({ where: { id } }).catch(() => null);
    return { success: true };
  });

  // ─── PM Schedule Entries ──────────────────────────────
  app.get('/data/pm-entries', { preHandler: dataPreHandler, schema: dataSchema('List PM schedule entries') }, async (req) => {
    return paginatedList(prisma.pmScheduleEntry, req.query, { plannedDate: 'desc' }, { schedule: true });
  });

  app.put('/data/pm-entries/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Edit PM schedule entry'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } }, body: { type: 'object', additionalProperties: true } } }, async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const existing = await prisma.pmScheduleEntry.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const data: any = {};
    for (const f of ['month', 'toleranceDays']) { if (body[f] !== undefined) data[f] = Number(body[f]); }
    for (const f of ['approvalStatus', 'approvalRemarks', 'submittedByName', 'approvedByName', 'notes']) { if (body[f] !== undefined) data[f] = body[f]; }
    for (const f of ['plannedDate', 'windowStart', 'windowEnd', 'approvedAt']) { if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null; }
    return prisma.pmScheduleEntry.update({ where: { id }, data });
  });

  app.delete('/data/pm-entries/:id', { preHandler: dataPreHandler, schema: { ...dataSchema('Delete PM schedule entry'), params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } }, async (req) => {
    const { id } = req.params as any;
    await prisma.pmScheduleEntry.delete({ where: { id } }).catch(() => null);
    return { success: true };
  });
}
