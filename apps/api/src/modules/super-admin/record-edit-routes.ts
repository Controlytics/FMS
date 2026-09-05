/**
 * SUPER_ADMIN record edits launched from the USER-FACING pages (2026-09-05,
 * operator request): RFID Track Record and the Filters page. Registered inside
 * the super-admin plugin, so everything here is /api/super-admin/filter-data/*
 * and runs under the Filter Data Management console's rules - SUPER_ADMIN role,
 * SUPER_ADMIN_DATA_EDIT re-authentication, a mandatory `_changeReason`, and an
 * audit row per change (see manual-change.ts).
 *
 * Retirement / Replacement / Admin Request / Notification edits reuse the
 * console's existing PUT handlers in routes.ts; only these two records had no
 * write path at all.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { buildContext } from '../../lib/build-context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { filterService } from '../assets/services/filter.service.js';
import { identifierService } from '../assets/services/identifier.service.js';
import { instanceService } from '../assets/services/instance.service.js';
import { requireDataEditReauth, reasonSchemaProps, readChangeReason, auditManualChange, sanitizeSnapshot } from './manual-change.js';
import { RFID_EVENT_ACTIONS, decideLiveTag, planRfidEventEdit, type RfidEventRow } from './rfid-event-edit.js';

const LIFECYCLE_STATES = ['INSTALLED', 'WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT', 'IN_USE', 'CLEANING_CYCLE_COMPLETED'] as const;

const idParam = { type: 'object' as const, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };

export default async function recordEditRoutes(app: FastifyInstance) {
  const guarded = [app.requireRole('SUPER_ADMIN'), requireDataEditReauth];

  // ── RFID Track Record row ───────────────────────────────────────────────
  app.put('/filter-data/rfid-events/:id', {
    preHandler: guarded,
    schema: {
      tags: ['Super Admin'],
      summary: 'Edit one RFID Track Record row (an audit row - BREAKS the hash chain) and, when it is the tag\'s latest event, the live tag',
      params: idParam,
      body: {
        type: 'object',
        required: ['_changeReason'],
        properties: {
          ...reasonSchemaProps,
          timestamp: { type: 'string' },
          event: { type: 'string', enum: ['ASSIGN', 'REMOVE'] },
          rfidNumber: { type: 'string', minLength: 1, maxLength: 255 },
          filterId: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          remarks: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as { timestamp?: string; event?: 'ASSIGN' | 'REMOVE'; rfidNumber?: string; filterId?: string; userId?: string; remarks?: string };

    const row = await prisma.auditTrail.findFirst({ where: { id, action: { in: [...RFID_EVENT_ACTIONS] } } });
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'RFID track record row not found' });

    let timestamp: Date | undefined;
    if (body.timestamp !== undefined) {
      timestamp = new Date(body.timestamp);
      if (Number.isNaN(timestamp.getTime())) return reply.code(400).send({ error: 'INVALID_VALUE', message: 'timestamp must be a valid date-time' });
    }
    let filterName: string | null | undefined;
    if (body.filterId !== undefined) {
      const f = await prisma.assetInstance.findUnique({ where: { id: body.filterId }, select: { id: true, name: true } });
      if (!f) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Filter not found' });
      filterName = f.name;
    }
    let userId: string | undefined; let userName: string | undefined;
    if (body.userId !== undefined) {
      const u = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, username: true } });
      if (!u) return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found' });
      userId = u.id; userName = u.username;
    }

    const plan = planRfidEventEdit(row as unknown as RfidEventRow, {
      timestamp, event: body.event, rfidNumber: body.rfidNumber, filterId: body.filterId, filterName,
      userId, userName, remarks: body.remarks,
    });

    // "Latest event for this tag number" = no other Assigned/Removed row with a
    // later timestamp mentions it, on either side. Only that row describes the
    // tag's present state, so only that row may touch asset_identifiers.
    const latestFor = async (value: string) => {
      if (!value) return false;
      const later = await prisma.auditTrail.count({
        where: {
          id: { not: row.id },
          action: { in: [...RFID_EVENT_ACTIONS] },
          timestamp: { gt: plan.data.timestamp },
          OR: [
            { afterValue: { path: ['identifierValue'], equals: value } },
            { beforeValue: { path: ['identifierValue'], equals: value } },
          ],
        },
      });
      return later === 0;
    };
    const [latestForNew, latestForOld, existingByNew, existingByOld] = await Promise.all([
      latestFor(plan.newValue),
      plan.oldValue === plan.newValue ? Promise.resolve(true) : latestFor(plan.oldValue),
      prisma.assetIdentifier.findUnique({ where: { identifierValue: plan.newValue }, select: { id: true, assetId: true } }),
      plan.oldValue && plan.oldValue !== plan.newValue
        ? prisma.assetIdentifier.findUnique({ where: { identifierValue: plan.oldValue }, select: { id: true, assetId: true } })
        : Promise.resolve(null),
    ]);
    const targetOtherTag = plan.newAssetId
      ? await prisma.assetIdentifier.findFirst({
          where: { assetId: plan.newAssetId, identifierValue: { notIn: [plan.newValue, plan.oldValue].filter(Boolean) } },
          select: { id: true, identifierValue: true },
        })
      : null;
    const targetFilterName = plan.newAssetId
      ? (await prisma.assetInstance.findUnique({ where: { id: plan.newAssetId }, select: { name: true } }))?.name ?? null
      : null;

    // Decide BEFORE writing anything, so a conflict leaves the row untouched.
    const live = decideLiveTag(plan, {
      latestForNew, latestForOld: plan.oldValue === plan.newValue ? latestForNew : latestForOld,
      existingByNew,
      existingByOld: plan.oldValue === plan.newValue ? existingByNew : existingByOld,
      targetOtherTag, targetFilterName,
    });

    const u = req.user as any;
    await prisma.$transaction(async (tx) => {
      // Meta-audit row FIRST, inside the same transaction: it preserves the
      // original values and says, in the chain itself, that this row was
      // rewritten - the chain break that follows is then explained, not hidden.
      await auditLog({
        userId: u?.sub, userName: u?.username, userRole: u?.role,
        action: 'AUDIT_RECORD_UPDATED',
        targetType: 'audit_trail',
        targetId: id,
        beforeValue: sanitizeSnapshot({ action: row.action, timestamp: row.timestamp, userId: row.userId, userName: row.userName, reason: row.reason, beforeValue: row.beforeValue, afterValue: row.afterValue }),
        afterValue: sanitizeSnapshot({ ...plan.data, _liveTag: live.kind, _liveTagNote: live.note }),
        reason,
        signatureMeaning: `RFID track record ${id} edited in place from the RFID Track Record page; audit hash chain broken at this position`,
        ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: u?.sessionId,
      }, tx);
      await tx.auditTrail.update({ where: { id }, data: plan.data as any });

      // Live tag correction. Written directly (no ASSET_IDENTIFIER_* row): the
      // edited row IS the record of this assignment; a fresh Assigned/Removed
      // row would show up as a second, phantom event on the very page being
      // corrected. The meta-audit row above carries `_liveTag` for the trail.
      if (live.kind === 'update') {
        await tx.assetIdentifier.update({ where: { id: live.identifierId }, data: { identifierValue: live.identifierValue, assetId: live.assetId, updatedBy: u?.sub } });
      } else if (live.kind === 'create') {
        await tx.assetIdentifier.create({ data: { assetId: live.assetId, identifierType: 'RFID', identifierValue: live.identifierValue, isPrimary: true, createdBy: u?.sub } });
      } else if (live.kind === 'delete') {
        await tx.assetIdentifier.deleteMany({ where: { id: { in: live.identifierIds } } });
      }
    });

    return { success: true, chainBroken: true, liveTag: live.kind, liveTagNote: live.note };
  });

  // ── Filters page: every column ──────────────────────────────────────────
  app.put('/filter-data/filters/:id', {
    preHandler: guarded,
    schema: {
      tags: ['Super Admin'],
      summary: 'Edit any field of a filter from the Filters page (name, Area/AHU, field values, set, last cleaning date, status, RFID)',
      params: idParam,
      body: {
        type: 'object',
        required: ['_changeReason'],
        properties: {
          ...reasonSchemaProps,
          name: { type: 'string', minLength: 1, maxLength: 255 },
          ahuId: { type: 'string', format: 'uuid' },
          ahuType: { type: 'string' },
          filterType: { type: 'string' },
          micronSize: { type: 'string' },
          filterSize: { type: 'string' },
          lastCleaningDate: { type: 'string' },
          filterSet: { type: 'string', enum: ['A', 'B', ''] },
          lifecycleState: { type: 'string', enum: [...LIFECYCLE_STATES] },
          cleaningReasonKey: { type: 'string' },
          cleaningJustification: { type: 'string' },
          /** '' removes the tag; a value assigns it (replacing any current tag). */
          rfidNumber: { type: 'string', maxLength: 255 },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as Record<string, any>;
    const ctx = buildContext(req);

    const snapshot = async () => {
      const [typed, inst, details, tags] = await Promise.all([
        prisma.filter.findUnique({ where: { id }, select: { name: true, ahuId: true, status: true, attributes: true, isActive: true } }),
        prisma.assetInstance.findUnique({ where: { id }, select: { parentId: true, status: true, name: true } }),
        prisma.filterDetails.findUnique({ where: { assetInstanceId: id }, select: { filterSet: true, currentLifecycleState: true } }),
        prisma.assetIdentifier.findMany({ where: { assetId: id, identifierType: 'RFID' }, select: { id: true, identifierValue: true } }),
      ]);
      if (!typed || !inst) return null;
      return {
        name: typed.name, ahuId: typed.ahuId, parentId: inst.parentId, status: typed.status, attributes: typed.attributes,
        filterSet: details?.filterSet ?? null, currentLifecycleState: details?.currentLifecycleState ?? null,
        rfid: tags.map(t => t.identifierValue),
      };
    };
    const before = await snapshot();
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Filter not found' });

    // Validate everything that CAN be validated up front, so the later
    // sequential writes (each service owns its own transaction) fail before
    // anything is changed rather than half-way through.
    if (body.ahuId !== undefined && body.ahuId !== before.ahuId) {
      const ahu = await prisma.ahu.findFirst({ where: { id: body.ahuId, isActive: true }, select: { id: true } });
      if (!ahu) throw new ValidationError('Target AHU not found or inactive');
    }
    const rfidNext: string | undefined = body.rfidNumber !== undefined ? String(body.rfidNumber).trim() : undefined;
    if (rfidNext) {
      const holder = await prisma.assetIdentifier.findUnique({ where: { identifierValue: rfidNext }, select: { assetId: true } });
      if (holder && holder.assetId !== id) throw new ConflictError(`Tag ${rfidNext} is live on another filter - remove it there first.`, 'DUPLICATE_IDENTIFIER_VALUE');
    }

    const applied: string[] = [];

    // 1. Lifecycle state - through the same service as the Filters page's own
    //    "Update Status" so the cleaning-profile sequence rule, cycle start /
    //    force-complete and the FILTER_LIFECYCLE audit all behave identically.
    if (body.lifecycleState !== undefined && body.lifecycleState !== before.currentLifecycleState) {
      await instanceService.changeLifecycleState(id, body.lifecycleState, ctx, reason, {
        cleaningReasonKey: body.cleaningReasonKey ?? null,
        cleaningJustification: body.cleaningJustification ?? null,
      });
      applied.push('lifecycleState');
    }

    // 2. Name / field values / set - the typed filter service (validates the
    //    configured option lists, keeps the asset_instances mirror in step).
    const fieldInput: Record<string, unknown> = {};
    for (const k of ['name', 'ahuType', 'filterType', 'micronSize', 'filterSize', 'lastCleaningDate']) {
      if (body[k] !== undefined) fieldInput[k] = body[k];
    }
    if (body.filterSet === 'A' || body.filterSet === 'B') fieldInput.filterSet = body.filterSet;
    if (Object.keys(fieldInput).length > 0) {
      await filterService.update(id, fieldInput as any, ctx);
      applied.push(...Object.keys(fieldInput));
    }
    if (body.filterSet === '' && before.filterSet !== null) {
      await prisma.filterDetails.update({ where: { assetInstanceId: id }, data: { filterSet: null } });
      applied.push('filterSet');
    }

    // 3. AHU move. `filters.ahu_id` is the source of truth; the reverse-mirror
    //    trigger copies it to asset_instances.parent_id. The CONTAINS /
    //    CONTAINED_IN relationship pair is what the tree and the retire path
    //    use, so it is swapped in the same transaction.
    if (body.ahuId !== undefined && body.ahuId !== before.ahuId) {
      await prisma.$transaction(async (tx) => {
        await tx.filter.update({ where: { id }, data: { ahuId: body.ahuId, updatedBy: ctx.userId } });
        await tx.assetRelationship.deleteMany({
          where: { OR: [
            { sourceAssetId: id, relationshipType: 'CONTAINED_IN' },
            { targetAssetId: id, relationshipType: 'CONTAINS' },
          ] },
        });
        await tx.assetRelationship.createMany({
          data: [
            { sourceAssetId: body.ahuId, targetAssetId: id, relationshipType: 'CONTAINS', createdBy: ctx.userId },
            { sourceAssetId: id, targetAssetId: body.ahuId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId },
          ],
          skipDuplicates: true,
        });
      });
      applied.push('ahuId');
    }

    // 4. RFID - through identifierService so the Assigned / Removed audit rows
    //    are written and the RFID Track Record shows the change.
    if (rfidNext !== undefined) {
      const current = await prisma.assetIdentifier.findMany({ where: { assetId: id, identifierType: 'RFID' } });
      const already = current.some(t => t.identifierValue === rfidNext);
      if (rfidNext === '' || !already) {
        for (const t of current) await identifierService.delete(t.id, ctx, reason);
        if (rfidNext !== '') {
          await identifierService.create({ assetId: id, identifierType: 'RFID', identifierValue: rfidNext, isPrimary: true }, ctx);
        }
        applied.push('rfid');
      }
    }

    const after = await snapshot();
    if (!after) throw new NotFoundError('Filter disappeared during edit');
    await auditManualChange(req, {
      verb: 'UPDATED', targetType: 'filter', targetId: id, label: `Filter "${after.name}"`, reason,
      before, after, sideEffects: { applied },
    });
    return { success: true, applied, data: after };
  });
}
