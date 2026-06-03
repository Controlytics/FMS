import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { NotFoundError, ValidationError } from '../../../lib/errors.js';
import { instanceRepository } from '../repositories/instance.repository.js';
import { relationshipRepository } from '../repositories/relationship.repository.js';
import { identifierRepository } from '../repositories/identifier.repository.js';
import { templateRepository } from '../repositories/template.repository.js';
import { validateAttributeValues } from '../helpers/attribute-validator.js';
import { hasContainsCycle } from '../helpers/cycle-detection.js';
import { collectDescendantIds } from '../helpers/descendant-collector.js';
import { prisma } from '../../../lib/prisma.js';
import { upsertFilterDetails } from '../../../lib/filter-details.js';
// Pure SHA-256 helper (node:crypto only) — used to checksum the synthetic
// CYCLE_COMPLETED event when a manual "Cleaning Cycle Completed" force-completes
// an active cycle. No circular dependency (helpers.ts imports only prisma + crypto).
import { computeChecksum } from '../../filter-operations/helpers.js';
import { getFilterStageRules, classifyMove, moveStartsCycle, INVALID_STAGE_MOVE_MESSAGE } from '../../filter-operations/stage-rules.js';
import { resolveManualCycleReason, breakActiveCycleTx, startManualCycleTx } from '../../filter-operations/manual-cycle.js';
import { randomBytes } from 'node:crypto';
import { provisionUnsMapping } from '../../uns/uns.service.js';
import { getEntityUnsPath } from '../../../lib/uns-path.js';

async function validateParent(parentId: string, childTemplateId: string, childId?: string) {
  const parent = await instanceRepository.findByIdSimple(parentId);
  if (!parent) throw new ValidationError('Parent entity instance not found');

  if (childId && parentId === childId) {
    throw new ValidationError('Cannot set self as parent');
  }

  const template = await templateRepository.findById(childTemplateId);
  const maxParent = (template as any)?.maxParentConnections ?? 1;
  if (maxParent === 0) {
    throw new ValidationError('This template does not allow parent connections (Number of Parent Connections = 0). Create this entity without a parent.');
  }

  const parentTemplate = await templateRepository.findById(parent.templateId);
  const parentMax = (parentTemplate as any)?.maxConnections ?? 10;
  if (parentMax > 0) {
    const parentUsed = await relationshipRepository.countBySourceAsset(parentId);
    if (parentUsed >= parentMax) {
      throw new ValidationError(`Parent entity has reached max connections (${parentUsed}/${parentMax})`);
    }
  }

  return parent;
}

export const instanceService = {
  async list(query: { search?: string; templateId?: string; status?: string; parentId?: string | null; isActive?: string; page: number; limit?: number }, visibilityFilter?: Record<string, unknown>) {
    const where: Record<string, unknown> = { ...visibilityFilter };
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };
    if (query.templateId) where.templateId = query.templateId;
    if (query.status) where.status = query.status;
    if (query.parentId !== undefined) where.parentId = query.parentId === 'null' ? null : query.parentId;
    // Default to active entities only; pass isActive=false explicitly to include inactive
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';
    else where.isActive = true;

    const { instances, total } = await instanceRepository.findMany(where, query.page, query.limit);
    return {
      data: instances, total, page: query.page, limit: query.limit ?? total,
      totalPages: query.limit ? Math.ceil(total / query.limit) : 1,
    };
  },

  async getTree(filter?: Record<string, unknown>) {
    return instanceRepository.findTree(filter);
  },

  async getById(id: string) {
    const instance = await instanceRepository.findById(id);
    if (!instance) throw new NotFoundError('Entity instance not found');
    return instance;
  },

  async create(data: Record<string, any>, ctx: RequestContext) {
    const template = await templateRepository.findById(data.templateId);
    if (!template) throw new ValidationError('Template not found');

    // Check for duplicate entity name (case-insensitive)
    const existingByName = await prisma.assetInstance.findFirst({
      where: { name: { equals: data.name.trim(), mode: 'insensitive' }, isActive: true },
    });
    if (existingByName) throw new ValidationError(`An entity with the name "${data.name.trim()}" already exists`);

    const attrSchema = (template as any).attributeSchema as any[] | undefined;
    if (attrSchema && attrSchema.length > 0 && data.attributes) {
      const attrErrors = validateAttributeValues(data.attributes, attrSchema);
      if (attrErrors.length > 0) throw new ValidationError('ATTRIBUTE_VALIDATION_ERROR', attrErrors);
    }

    if (data.parentId) {
      await validateParent(data.parentId, data.templateId);
    }

    // Atomic: create instance + parent relationship in one transaction.
    // For filter-kind templates, also eagerly create the FilterDetails 1:1 sidecar
    // (Step 6 — keeps cycle-state writes from needing a "row exists?" check downstream).
    const isFilterKind = (template as any).templateKind === 'FILTER';
    const { instance, containsRel, containedInRel } = await prisma.$transaction(async (tx) => {
      const inst = await tx.assetInstance.create({
        data: {
          name: data.name,
          description: data.description,
          templateId: data.templateId,
          templateVersion: template.version,
          status: data.status,
          attributes: data.attributes as any,
          telemetryConfig: data.telemetryConfig as any,
          customAttributes: data.customAttributes as any,
          parentId: data.parentId ?? null,
          createdBy: ctx.userId,
        } as any,
      });

      if (isFilterKind) {
        // Audit 2026-05-05 fix #1 (data loss): the single-filter create
        // dialog (CreateFilterDialog.tsx:826) sends filterSet + filterProfileId
        // but the previous code created an empty FilterDetails sidecar and
        // silently dropped both. Operators picked Set A + a profile in the
        // dialog, hit save, success toast → reopened the filter and both
        // fields were empty. Bulk upload (bulk-upload-filter.service.ts:240)
        // already persisted them; single-create now matches.
        //
        // Validation: filterSet must be 'A' or 'B' if supplied; bad values
        // return 400 from the schema validator before reaching here. If
        // filterProfileId supplied, FK constraint catches a bad UUID.
        //
        // FE/DB enum mismatch: the create dialog (CreateFilterDialog.tsx)
        // and the Zod schema (`createAssetInstanceSchema`) use 'A'/'B' as
        // the wire format, but the Prisma `FilterSetLabel` enum values are
        // `SET_A`/`SET_B`. Bulk upload translates at parse time
        // (bulk-upload-filter.service.ts:114-115); the single-create path
        // was passing the raw 'A' through to Prisma, which threw
        // `PrismaClientValidationError: Invalid value for argument
        // filterSet. Expected FilterSetLabel.` Translate here.
        const filterSetEnum: 'SET_A' | 'SET_B' | undefined =
          data.filterSet === 'A' ? 'SET_A' : data.filterSet === 'B' ? 'SET_B' : undefined;
        await tx.filterDetails.create({
          data: {
            assetInstanceId: inst.id,
            ...(filterSetEnum ? { filterSet: filterSetEnum } : {}),
            ...(data.filterProfileId ? { filterProfileId: data.filterProfileId } : {}),
          },
        });
      }

      let cRel, ciRel;
      if (data.parentId) {
        [cRel, ciRel] = await Promise.all([
          tx.assetRelationship.create({ data: { sourceAssetId: data.parentId, targetAssetId: inst.id, relationshipType: 'CONTAINS', createdBy: ctx.userId } }),
          tx.assetRelationship.create({ data: { sourceAssetId: inst.id, targetAssetId: data.parentId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId } }),
        ]);
      }

      return { instance: inst, containsRel: cRel, containedInRel: ciRel };
    });

    if (data.parentId && containsRel) {
      const parentEntity = await instanceRepository.findByIdWithName(data.parentId);

      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole,
        action: 'ASSET_RELATIONSHIP_CREATED',
        targetType: 'asset_relationship',
        targetId: containsRel.id,
        afterValue: { sourceName: parentEntity?.name || data.parentId, name: instance.name, relationship: containsRel, inverse: containedInRel },
        reason: `Auto-created: "${parentEntity?.name || data.parentId}" CONTAINS "${instance.name}"`,
        signatureMeaning: `CONTAINS relationship auto-created between parent "${parentEntity?.name}" and new child "${instance.name}"`,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_CREATED',
      targetType: 'asset_instance',
      targetId: instance.id,
      afterValue: instance,
      reason: data.parentId ? `Entity created as child of parent ${data.parentId}` : 'Entity created',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    // Auto-provision connectivity for data-ingestion-enabled templates
    if ((template as any).dataIngestionEnabled) {
      try {
        await provisionUnsMapping(instance.id);
        const token = randomBytes(32).toString('hex');
        const updatedEntity = await instanceRepository.findByIdSimple(instance.id);
        const unsPath = (updatedEntity as any)?.unsPath ?? `${template.name}/${instance.name}`;
        const allowedTopics = [
          `${unsPath}/telemetry`,
          `${unsPath}/attributes`,
          `${unsPath}/events`,
          `${unsPath}/rpc/request`,
          `${unsPath}/rpc/response`,
        ];
        await prisma.$transaction(async (tx) => {
          await tx.deviceCredential.create({
            data: {
              entityId: instance.id,
              accessToken: token,
              status: 'ACTIVE',
              isActive: true,
              credentialData: { allowedTopics },
            },
          });
          await tx.connectivityStatus.create({
            data: {
              entityId: instance.id,
              status: 'OFFLINE',
            },
          });
        });
      } catch (err) {
        // Non-fatal — log but don't fail entity creation
        console.error('Auto-provision connectivity failed:', err);
      }
    }

    return instance;
  },

  async update(id: string, data: Record<string, any>, ctx: RequestContext) {
    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');

    if (data.attributes) {
      const template = await templateRepository.findById(existing.templateId);
      if (template) {
        const attrSchema = (template as any).attributeSchema as any[] | undefined;
        if (attrSchema && attrSchema.length > 0) {
          const attrErrors = validateAttributeValues(data.attributes, attrSchema);
          if (attrErrors.length > 0) throw new ValidationError('ATTRIBUTE_VALIDATION_ERROR', attrErrors);
        }
      }
    }

    const beforeValue = {
      name: existing.name, description: existing.description, status: existing.status,
      parentId: existing.parentId, attributes: existing.attributes,
      telemetryConfig: existing.telemetryConfig, customAttributes: existing.customAttributes,
    };

    const parentIdChanging = data.parentId !== undefined && data.parentId !== existing.parentId;

    if (parentIdChanging && data.parentId) {
      await validateParent(data.parentId, existing.templateId, id);

      const childCount = await relationshipRepository.countContainsChildren(id);
      if (childCount > 0) {
        throw new ValidationError('This entity is already a parent node with children and cannot be connected as a child node');
      }

      const wouldCycle = await hasContainsCycle(data.parentId, id);
      if (wouldCycle) throw new ValidationError('Cannot set parent: would create a cycle in the hierarchy');
    }

    // Check for duplicate entity name on rename (case-insensitive)
    if (data.name !== undefined && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const existingByName = await prisma.assetInstance.findFirst({
        where: { name: { equals: data.name.trim(), mode: 'insensitive' }, isActive: true, id: { not: id } },
      });
      if (existingByName) throw new ValidationError(`An entity with the name "${data.name.trim()}" already exists`);
    }

    const updateData: Record<string, unknown> = { updatedBy: ctx.userId };
    for (const key of ['name', 'description', 'status', 'parentId']) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    for (const key of ['attributes', 'telemetryConfig', 'customAttributes']) {
      if (data[key] !== undefined) updateData[key] = data[key] as any;
    }

    // Atomic: update instance + parent relationship changes in one transaction
    const { instance, newContains, newContainedIn } = await prisma.$transaction(async (tx) => {
      const inst = await tx.assetInstance.update({ where: { id }, data: updateData as any });

      let cRel, ciRel;
      if (parentIdChanging) {
        if (existing.parentId) {
          await tx.assetRelationship.deleteMany({
            where: {
              OR: [
                { sourceAssetId: existing.parentId, targetAssetId: id, relationshipType: 'CONTAINS' },
                { sourceAssetId: id, targetAssetId: existing.parentId, relationshipType: 'CONTAINED_IN' },
              ],
            },
          });
        }
        if (data.parentId) {
          [cRel, ciRel] = await Promise.all([
            tx.assetRelationship.create({ data: { sourceAssetId: data.parentId, targetAssetId: id, relationshipType: 'CONTAINS', createdBy: ctx.userId } }),
            tx.assetRelationship.create({ data: { sourceAssetId: id, targetAssetId: data.parentId, relationshipType: 'CONTAINED_IN', createdBy: ctx.userId } }),
          ]);
        }
      }

      return { instance: inst, newContains: cRel, newContainedIn: ciRel };
    });

    // FilterDetails write-through for the edit path. Mirrors the create
    // path's A→SET_A / B→SET_B translation. Without this the EditFilterDialog
    // (filter-list.tsx EditFilterDialog) would silently drop filterSet on
    // save — operator picks Set B, hits Save, success toast, reopens dialog
    // and sees the old value. updateAssetInstanceSchema accepts both fields;
    // they're applied here for FILTER-kind templates only.
    if (data.filterSet !== undefined || data.filterProfileId !== undefined) {
      const template = await templateRepository.findById(existing.templateId);
      const isFilterKind = (template as any)?.templateKind === 'FILTER';
      if (isFilterKind) {
        const patch: Record<string, unknown> = {};
        if (data.filterSet !== undefined) {
          patch.filterSet = data.filterSet === 'A' ? 'SET_A' : data.filterSet === 'B' ? 'SET_B' : null;
        }
        if (data.filterProfileId !== undefined) {
          patch.filterProfileId = data.filterProfileId ?? null;
        }
        if (Object.keys(patch).length > 0) {
          await upsertFilterDetails(id, patch as any);
        }
      }
    }

    if (parentIdChanging) {
      if (existing.parentId) {
        const oldParent = await instanceRepository.findByIdWithName(existing.parentId);
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'ASSET_RELATIONSHIP_DELETED',
          targetType: 'asset_relationship', targetId: id,
          beforeValue: { sourceAssetId: existing.parentId, targetAssetId: id, relationshipType: 'CONTAINS', sourceName: oldParent?.name || existing.parentId, name: existing.name },
          afterValue: { deleted: true },
          reason: `Parent changed: removed CONTAINS from "${oldParent?.name || existing.parentId}"`,
          signatureMeaning: `CONTAINS relationship removed: "${oldParent?.name || existing.parentId}" → "${existing.name}"`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        });
      }

      if (data.parentId && newContains) {
        const newParent = await instanceRepository.findByIdWithName(data.parentId);
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'ASSET_RELATIONSHIP_CREATED',
          targetType: 'asset_relationship', targetId: newContains.id,
          afterValue: { sourceName: newParent?.name || data.parentId, name: instance.name, relationship: newContains, inverse: newContainedIn },
          reason: `Parent changed: "${newParent?.name || data.parentId}" now CONTAINS "${instance.name}"`,
          signatureMeaning: `Parent changed: "${newParent?.name || data.parentId}" now CONTAINS "${instance.name}"`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        });
      }
    }

    const instanceChanges = buildInstanceChangeSummary(existing, data, parentIdChanging);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_UPDATED',
      targetType: 'asset_instance', targetId: id,
      beforeValue, afterValue: instance,
      reason: instanceChanges.length > 0 ? instanceChanges.join('; ') : 'Entity updated',
      signatureMeaning: `Entity "${instance.name}" updated: ${instanceChanges.length > 0 ? instanceChanges.join(', ') : 'updated'}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return instance;
  },

  async changeStatus(id: string, status: string, ctx: RequestContext, remarks?: string) {
    if (!status || typeof status !== 'string' || status.trim() === '') {
      throw new ValidationError('Status is required and must be a non-empty string');
    }

    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');

    const instance = await instanceRepository.update(id, {
      status: status.trim(),
      updatedBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_STATUS_CHANGED',
      targetType: 'asset_instance', targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: instance.status },
      reason: `Status: "${existing.status}" → "${instance.status}"${remarks ? ` — ${remarks}` : ''}`,
      signatureMeaning: `Entity "${instance.name}" status changed from "${existing.status}" to "${instance.status}"`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return instance;
  },

  async changeLifecycleState(
    id: string,
    lifecycleState: string,
    ctx: RequestContext,
    remarks: string,
    cycleOpts: { cleaningReasonKey?: string | null; cleaningJustification?: string | null } = {},
  ) {
    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');
    const beforeState = (existing as any).currentLifecycleState ?? null;
    const newState = lifecycleState.trim();

    // P1 (2026-06-03): manual web moves obey the SAME cleaning-profile sequence
    // the tablet enforces. classifyMove() reuses the shared findReachable() so
    // the rules are identical. Block a forward SKIP (e.g. Dirty → Storage Out).
    // NON_CLEANING operational states (INSTALLED / IN_USE) and COMPLETE carry no
    // sequence rule. Only enforced when the filter resolves to a profile.
    const stageRules = await getFilterStageRules(id);
    if (stageRules.hasProfile && classifyMove(stageRules, newState) === 'SKIP') {
      throw new ValidationError(INVALID_STAGE_MOVE_MESSAGE);
    }

    // P3 (2026-06-03): does this move start/restart a cleaning cycle? A BACKWARD
    // move with an active cycle breaks it and starts fresh; a cleaning-stage move
    // with no active cycle starts a new cycle. Both need a cleaning reason —
    // validate it against the profile up-front so we fail before the transaction.
    const willStartCycle = stageRules.hasProfile && stageRules.profileId != null && moveStartsCycle(stageRules, newState);
    const resolvedReason = willStartCycle
      ? await resolveManualCycleReason(stageRules.profileId as string, cycleOpts)
      : null;

    let forceCompletedCycle = false;
    let restartedCycle = false;
    const isCompletion = newState === 'CLEANING_CYCLE_COMPLETED';
    // Single timestamp for the whole change — the manual event's performedAt and
    // any force-completed cycle's completedAt share it so the records agree to
    // the millisecond. The manual STATE_TRANSITION event (written below) is what
    // moves "Last Cleaned" for a manually-staged filter (so a filter shown in a
    // cleaning stage always has a date — see hierarchy.service.zipLastCleaned).
    // It does NOT write the user-editable lastCleaningDate seed — that field is
    // only set from the Create/Edit Filter dialog.
    const changedAt = new Date();

    // Manual status changes are recorded as a STATE_TRANSITION FilterEvent with
    // attributes.manual=true. SYNC RULE (2026-06-03): when the filter has an
    // active in-progress cleaning cycle, the change is attached to THAT cycle
    // (cycleId set) so it lands in the cycle's stage columns on the Cleaning
    // Cycles page — manual Filters-page edits and tablet cleaning now drive the
    // same cycle record. attributes.manual stays true so the audit trail shows
    // the stage was set by a manual override (no checklist/readings enforcement
    // like advance() does) rather than a normal advance. When there is NO active
    // cycle the event keeps cycleId=null and surfaces in the "Manual Status
    // Updates" tab — a queryable, checksum'd record without fabricating a fake
    // cleaning_cycles row (per the 2026-06-02 21 CFR decision). This event's
    // performedAt is what "Last Cleaned" reads (hierarchy.service.zipLastCleaned);
    // it does NOT write the user-editable lastCleaningDate seed.
    await prisma.$transaction(async (tx) => {
      // Look up the active in-progress cycle once (all target states need it):
      // it's both the cycle to force-complete on completion AND the cycle the
      // manual stage event attaches to so it shows in the cycle's stage data.
      const fd = await tx.filterDetails.findUnique({ where: { assetInstanceId: id }, select: { currentCycleId: true } });
      const activeCycle = fd?.currentCycleId
        ? await tx.cleaningCycle.findFirst({ where: { id: fd.currentCycleId, status: 'IN_PROGRESS' }, select: { id: true, sequenceNumber: true } })
        : null;

      // The cycle the manual STATE_TRANSITION event attaches to (so the target
      // stage populates that cycle's column on the Cleaning Cycles page).
      let eventCycleId: string | null = activeCycle?.id ?? null;

      if (willStartCycle && resolvedReason) {
        // P3: BACKWARD with an active cycle → break (TERMINATED) it first;
        // then (or, with no active cycle, directly) start a fresh manual cycle
        // from the target stage. Maintains full history: Cycle 1 broken,
        // Cycle 2 begins here.
        if (activeCycle) {
          restartedCycle = true;
          await breakActiveCycleTx(tx, {
            filterId: id, cycleId: activeCycle.id, sequenceNumber: activeCycle.sequenceNumber,
            performedBy: ctx.userSub, ipAddress: ctx.ipAddress, at: changedAt,
            reason: `Interrupted by backward manual move to ${newState}`,
          });
        }
        const newCycleId = await startManualCycleTx(tx, {
          filterId: id, filterName: (existing as any).name ?? null, profileId: stageRules.profileId as string,
          reason: resolvedReason, performedBy: ctx.userSub, ipAddress: ctx.ipAddress, at: changedAt,
        });
        eventCycleId = newCycleId;
        await tx.filterDetails.upsert({
          where: { assetInstanceId: id },
          update: { currentCycleId: newCycleId, currentLifecycleState: newState },
          create: { assetInstanceId: id, currentCycleId: newCycleId, currentLifecycleState: newState },
        });
      } else {
        if (isCompletion && activeCycle) {
          // Force-complete (2026-06-02, per user decision): manually setting
          // "Cleaning Cycle Completed" also FINISHES the active in-progress cycle,
          // so the Cleaning Cycles view + the filter status no longer disagree.
          forceCompletedCycle = true;
          await tx.cleaningCycle.update({ where: { id: activeCycle.id }, data: { status: 'COMPLETED', completedAt: changedAt } });
          const completeEvent = {
            filterId: id, cycleId: activeCycle.id, eventType: 'CYCLE_COMPLETED' as const,
            performedBy: ctx.userSub,
            attributes: { sequenceNumber: activeCycle.sequenceNumber, manualForceComplete: true, remarks: remarks?.trim() ?? '' },
          };
          await tx.filterEvent.create({
            data: { ...completeEvent, performedAt: changedAt, checksum: computeChecksum(completeEvent), ipAddress: ctx.ipAddress, telemetrySnapshot: {} },
          });
        }

        await tx.filterDetails.upsert({
          where: { assetInstanceId: id },
          update: { currentLifecycleState: newState, ...(isCompletion ? { currentCycleId: null } : {}) },
          create: { assetInstanceId: id, currentLifecycleState: newState },
        });
      }

      // Record the manual status change as a filter event (all states), attached
      // to the active/new cycle when one exists. performedAt = changedAt is the
      // EXACT date+time, and it's what the "Last Cleaned" derivation reads — so a
      // manual change to ANY cleaning stage moves Last Cleaned and populates that
      // stage's column in Cleaning Cycles.
      const manualEvent = {
        filterId: id, cycleId: eventCycleId, eventType: 'STATE_TRANSITION' as const,
        fromState: beforeState, toState: newState,
        performedBy: ctx.userSub,
        attributes: { manual: true, source: 'MANUAL', remarks: remarks?.trim() ?? '' },
      };
      await tx.filterEvent.create({
        data: {
          ...manualEvent,
          performedAt: changedAt,
          remarks: remarks?.trim() || null,
          checksum: computeChecksum(manualEvent),
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
        },
      });

      await tx.assetInstance.update({ where: { id }, data: { updatedBy: ctx.userId } });
    });

    const instance = await instanceRepository.findByIdSimple(id);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'FILTER_LIFECYCLE_STATE_CHANGED',
      targetType: 'asset_instance', targetId: id,
      beforeValue: { currentLifecycleState: beforeState },
      afterValue: {
        currentLifecycleState: newState,
        ...(forceCompletedCycle ? { cycleForceCompleted: true } : {}),
        ...(restartedCycle ? { cycleBrokenAndRestarted: true } : {}),
        ...(resolvedReason ? { newCycleReason: resolvedReason.key } : {}),
      },
      reason: `Lifecycle state: "${beforeState ?? 'None'}" → "${newState}"${forceCompletedCycle ? ' (active cleaning cycle force-completed)' : ''}${restartedCycle ? ' (active cleaning cycle interrupted/broken; new cycle started)' : resolvedReason ? ' (new cleaning cycle started)' : ''} — ${remarks}`,
      signatureMeaning: `Filter "${(instance as any)?.name}" lifecycle state manually changed from "${beforeState ?? 'None'}" to "${newState}"${forceCompletedCycle ? ' and its active cleaning cycle was force-completed' : ''}${restartedCycle ? ' — its in-progress cleaning cycle was interrupted (broken) and a new cycle was started' : resolvedReason ? ' — a new cleaning cycle was started' : ''}`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return instance;
  },

  async delete(id: string, ctx: RequestContext) {
    const existing = await instanceRepository.findByIdSimple(id);
    if (!existing) throw new NotFoundError('Entity instance not found');

    const descendantIds = await collectDescendantIds(id);
    const allIds = [id, ...descendantIds];

    // All deletes in one atomic transaction
    await prisma.$transaction(async (tx) => {
      await tx.assetInstance.updateMany({ where: { id: { in: allIds } }, data: { isActive: false, unsPath: null, updatedBy: ctx.userId } });
      await tx.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: { in: allIds } }, { targetAssetId: { in: allIds } }] } });
      await tx.assetIdentifier.deleteMany({ where: { assetId: { in: allIds } } });
      await tx.deviceCredential.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.connectivityStatus.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.unsMapping.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.qrCode.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.latestTelemetry.deleteMany({ where: { entityId: { in: allIds } } });
      await tx.dataStream.deleteMany({ where: { entityId: { in: allIds } } });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_DELETED',
      targetType: 'asset_instance', targetId: id,
      beforeValue: { name: existing.name, status: existing.status, isActive: existing.isActive },
      afterValue: { isActive: false, cascadeDeactivated: descendantIds.length },
      signatureMeaning: `Entity "${existing.name}" and ${descendantIds.length} children deactivated`,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return allIds.length;
  },

  async getChildren(id: string) {
    const parent = await instanceRepository.findByIdSimple(id);
    if (!parent) throw new NotFoundError('Entity instance not found');
    return instanceRepository.findChildren(id);
  },
};

function buildInstanceChangeSummary(existing: any, data: Record<string, any>, parentIdChanging: boolean): string[] {
  const changes: string[] = [];
  if (data.name !== undefined && data.name !== existing.name) changes.push(`Name: "${existing.name}" → "${data.name}"`);
  if (data.description !== undefined && data.description !== existing.description) changes.push('Description updated');
  if (data.status !== undefined && data.status !== existing.status) changes.push(`Status: "${existing.status}" → "${data.status}"`);
  if (data.attributes !== undefined) {
    const oldAttrs = (existing.attributes as Record<string, any>) || {};
    const newAttrs = (data.attributes as Record<string, any>) || {};
    const allKeys = new Set([...Object.keys(oldAttrs), ...Object.keys(newAttrs)]);
    const attrDiffs: string[] = [];
    for (const key of allKeys) {
      if (JSON.stringify(oldAttrs[key]) !== JSON.stringify(newAttrs[key])) {
        attrDiffs.push(`${key}: ${JSON.stringify(oldAttrs[key] ?? null)} → ${JSON.stringify(newAttrs[key] ?? null)}`);
      }
    }
    changes.push(attrDiffs.length > 0 ? `Attributes changed: ${attrDiffs.join(', ')}` : 'Attributes updated (no value changes)');
  }
  if (data.telemetryConfig !== undefined) changes.push('Telemetry config updated');
  if (data.customAttributes !== undefined) changes.push('Custom attributes updated');
  if (parentIdChanging) changes.push(`Parent: "${existing.parentId || 'none'}" → "${data.parentId || 'none'}"`);
  return changes;
}
