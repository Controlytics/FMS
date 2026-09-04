import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { enforceReauth, enforceReauthAlways } from '../../lib/reauth-check.js';
import { readSuperAdminApiEnabledUncached, setSuperAdminApiEnabled } from '../../lib/super-admin-lock.js';
import { auditLog, type AuditTx } from '../../lib/audit.js';
import { computeChecksum } from '../filter-operations/helpers.js';
import { NotificationType, PmEntryApprovalStatus, CleaningCycleStatus, FilterEventType, BlockChangeStatus } from '@prisma/client';

// Console verification 2026-09-04: an invalid enum value (e.g. a notification
// `type` that is not a NotificationType) used to reach Prisma and come back as
// a 400 whose message was the raw `prisma.notification.create()` invocation
// dump. The dialogs only offer enum values, so this is an API-only surface -
// but the message must still be a clean validation error, not a stack.
const CONSOLE_ENUM_FIELDS: Record<string, Record<string, Record<string, string>>> = {
  cleaningCycle: { status: CleaningCycleStatus },
  filterEvent: { eventType: FilterEventType },
  notification: { type: NotificationType },
  pmScheduleEntry: { approvalStatus: PmEntryApprovalStatus },
  blockChangeRequest: { status: BlockChangeStatus },
};
function invalidEnum(model: keyof typeof CONSOLE_ENUM_FIELDS, data: Record<string, unknown>): { error: string; message: string } | null {
  for (const [field, values] of Object.entries(CONSOLE_ENUM_FIELDS[model])) {
    const v = data[field];
    if (v === undefined || v === null) continue;
    if (!(typeof v === 'string' && v in values)) {
      return { error: 'INVALID_VALUE', message: `${field} must be one of: ${Object.keys(values).join(', ')}` };
    }
  }
  return null;
}

/**
 * Super Admin routes — SUPER_ADMIN only, platform management
 * Prefix: /api/super-admin
 *
 * 2026-05-26 (PA-REAUTH-3): every mutation under this module gained a reauth
 * step via `requireDataEditReauth` — identity confirmation on each edit.
 *
 * 2026-08-27 AUDIT-TRAIL RETROFIT: the "no audit trail" era is over. Every
 * PUT / POST / DELETE below now
 *   (a) demands a `_changeReason` of at least 5 characters, and
 *   (b) writes a MANUAL_RECORD_CREATED / _UPDATED / _DELETED row through
 *       `auditManualChange()`, carrying before + after snapshots, the reason,
 *       actor, IP and session.
 * The key is `_changeReason`, not `reason`, because `reason` is a real column
 * on BlockChangeRequest — a shared key would overwrite the record's own field.
 *
 * The audit row is written AFTER the data write for creates/updates (so it can
 * carry the real result) and BEFORE it for deletes (so `beforeValue` survives
 * the row it describes). A failed audit write rolls the whole thing back only
 * where the handler runs in a transaction; see each handler.
 */
async function requireDataEditReauth(req: FastifyRequest, reply: FastifyReply) {
  const { ok } = await enforceReauth('SUPER_ADMIN_DATA_EDIT', req, reply);
  if (!ok) {
    // enforceReauth has already sent the 401 response â€” Fastify stops
    // the preHandler chain on send. Returning is sufficient.
    return;
  }
}

/**
 * Mandatory justification on every manual data change (21 CFR § 11.10(e): the
 * record must say WHY, not just who and what).
 *
 * Body key is `_changeReason` — underscore-prefixed like `_currentPassword`
 * so it never collides with a real column. `BlockChangeRequest.reason` is a
 * live field on one of the edited tables; sharing the key would silently
 * overwrite it with the operator's justification.
 */
const MIN_REASON_LEN = 5;
const MAX_REASON_LEN = 500;
/** Spread into any mutation body schema so the field is documented + bounded. */
const reasonSchemaProps = {
  _changeReason: { type: 'string', minLength: MIN_REASON_LEN, maxLength: MAX_REASON_LEN, description: 'Why this manual change is being made. Recorded on the audit row.' },
};
function readChangeReason(req: FastifyRequest, reply: FastifyReply): string | null {
  const raw = (req.body as any)?._changeReason;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < MIN_REASON_LEN) {
    reply.code(400).send({
      error: 'REASON_REQUIRED',
      message: `A reason of at least ${MIN_REASON_LEN} characters is required — manual data changes are recorded in the audit trail.`,
    });
    return null;
  }
  if (reason.length > MAX_REASON_LEN) {
    reply.code(400).send({ error: 'REASON_TOO_LONG', message: `Reason must be ${MAX_REASON_LEN} characters or fewer.` });
    return null;
  }
  return reason;
}

type ManualVerb = 'CREATED' | 'UPDATED' | 'DELETED';

/**
 * Write the audit row for one manual data change.
 *
 * `targetType` is snake_case and drives BOTH the stored row and the rendered
 * description — `audit-helpers.ts` resolves the `{recordType}` placeholder
 * from it (cleaning_cycle → "Cleaning Cycle"), which is why three generic
 * MANUAL_RECORD_* actions still read specifically on the audit page.
 *
 * Pass `tx` to join the caller's transaction so the data write and its audit
 * row commit or roll back together.
 */
async function auditManualChange(
  req: FastifyRequest,
  opts: {
    verb: ManualVerb;
    targetType: string;
    targetId: string;
    label: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    /** Extra context the row itself doesn't carry (e.g. cascaded deletes). */
    sideEffects?: Record<string, unknown>;
  },
  tx?: AuditTx,
): Promise<void> {
  const u = req.user as any;
  const verbWord = opts.verb === 'CREATED' ? 'created' : opts.verb === 'UPDATED' ? 'edited' : 'deleted';
  await auditLog({
    userId: u?.sub,
    userName: u?.username,
    userRole: u?.role,
    action: `MANUAL_RECORD_${opts.verb}`,
    targetType: opts.targetType,
    targetId: opts.targetId,
    beforeValue: opts.before ? sanitizeSnapshot(opts.before) : undefined,
    afterValue: opts.sideEffects
      ? { ...(opts.after ? sanitizeSnapshot(opts.after) as object : {}), _sideEffects: opts.sideEffects }
      : opts.after ? sanitizeSnapshot(opts.after) : undefined,
    reason: opts.reason,
    signatureMeaning: `${opts.label} manually ${verbWord} via Filter Data Management`,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId: u?.sessionId,
  }, tx);
}

/**
 * Prisma rows carry Date and BigInt values; `auditLog` JSON-stringifies the
 * snapshots and BigInt has no JSON representation (it throws). Normalise both
 * so a snapshot of any table can go into before/afterValue unchanged.
 */
function sanitizeSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    return v;
  }));
}

export default async function superAdminRoutes(app: FastifyInstance) {

  // â”€â”€â”€ PLATFORM STATS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/stats', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Platform-wide statistics',
    },
  }, async () => {
    const [userCount, entityCount] = await Promise.all([
      prisma.user.count(),
      prisma.assetInstance.count({ where: { isActive: true } }),
    ]);
    // devices: 0 retained for response-shape backward compat (UI may still read it).
    return { users: userCount, devices: 0, entities: entityCount };
  });

  // ─── SUPER ADMIN API KILL-SWITCH ──────────────────────────────────
  // Global ON/OFF for "everything the SUPER_ADMIN can do". When OFF, the
  // auth plugin (plugins/auth.ts) freezes every SUPER_ADMIN request except a
  // tiny allowlist that INCLUDES these two endpoints — so the switch can
  // always be read and flipped back ON. Login is public and also unaffected.
  // Enforcement lives in auth.ts; these endpoints just persist/read the flag.

  app.get('/api-lock', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Read the Super Admin API access switch (true = APIs enabled)',
    },
  }, async () => {
    const enabled = await readSuperAdminApiEnabledUncached();
    return { enabled };
  });

  app.put('/api-lock', {
    // requireRole keeps this SUPER_ADMIN-only; enforceReauthAlways forces a
    // password step on every flip (this is a security control — see the
    // "Yes, require password" decision). Both must pass before we persist.
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Super Admin'],
      summary: 'Enable/disable Super Admin API access (password required)',
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          _currentPassword: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauthAlways('TOGGLE_SUPER_ADMIN_API_ACCESS', req, reply);
    if (!ok) return; // enforceReauthAlways already sent 401

    const { enabled } = req.body as { enabled: boolean };
    const before = await readSuperAdminApiEnabledUncached();
    await setSuperAdminApiEnabled(enabled, req.user.sub);

    await auditLog({
      userId: req.user.sub,
      userName: req.user.username,
      userRole: req.user.role,
      action: 'SUPER_ADMIN_API_ACCESS_CHANGED',
      targetType: 'config',
      targetId: 'super-admin-api-access',
      beforeValue: { enabled: before },
      afterValue: { enabled },
      signatureMeaning: `Super Admin API access ${enabled ? 'ENABLED' : 'DISABLED'}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { enabled };
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FILTER DATA MANAGEMENT - SUPER_ADMIN ONLY
  // Edit / create / delete retirement and replacement records, and restore a
  // retired filter. Every operation is audited (2026-08-27 retrofit).
  //
  // Read this before touching anything below:
  //   * a RETIREMENT record IS the filter's AssetInstance row (status Retired)
  //   * a REPLACEMENT record IS an audit_trail row (action FILTER_REPLACED) -
  //     getReplacements() reads straight from it; there is no other table.
  // So editing or deleting a replacement edits or deletes an audit row, which
  // invalidates that row's checksum and every chain link after it. That break
  // is deliberate and stays LOUD (verify-chain keeps reporting it) - the same
  // policy as the 2026-07-01 AUDIT_DELETE decision. A meta-audit row is always
  // written FIRST so the destroyed/edited content survives in beforeValue.
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // â”€â”€â”€ Edit a retired filter's fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.put('/filter-data/retirements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Edit retired filter record',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['_changeReason'],
        properties: {
          ...reasonSchemaProps,
          name: { type: 'string' },
          attributes: { type: 'object' },
          filterSet: { type: 'string', enum: ['SET_A', 'SET_B', ''] },
          updatedAt: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const filter = await prisma.assetInstance.findFirst({ where: { id, status: 'Retired' } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retired filter not found' });
    const beforeDetails = await prisma.filterDetails.findUnique({ where: { assetInstanceId: id }, select: { filterSet: true } });

    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.attributes !== undefined) data.attributes = body.attributes;
    if (body.updatedAt !== undefined) data.updatedAt = new Date(body.updatedAt);

    // filterSet now lives on FilterDetails (Step 6) â€” route to the sidecar.
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
    // filterSet lives on the sidecar, so it is captured separately on both
    // sides - otherwise a filterSet-only edit would audit as a no-op.
    await auditManualChange(req, {
      verb: 'UPDATED', targetType: 'retired_filter', targetId: id, label: 'Retired filter', reason,
      before: { ...filter, filterSet: beforeDetails?.filterSet ?? null },
      after: { ...(updated as object), filterSet: body.filterSet !== undefined ? (body.filterSet || null) : (beforeDetails?.filterSet ?? null) },
    });
    return updated;
  });

  // The 2026-07-15 removal of these two DELETEs was correct for what they did:
  // they tried to destroy audit_trail rows and could only ever 500. The
  // 2026-08-27 replacements below are different operations -
  //   * retirements DELETE removes the AssetInstance and leaves every audit row
  //     (including FILTER_RETIRED) untouched;
  //   * replacements DELETE goes through the vetted audit hard-delete path,
  //     which disables the trigger for one transaction and writes a meta-audit
  //     row first.

  // --- Create a retirement record (manual / back-dated) ---
  // A retirement record is not a free-standing row - it is an EXISTING filter
  // moved to status Retired plus the FILTER_RETIRED audit row that carries its
  // remarks, performer and date (getRetirements() joins the two, and shows
  // nulls without the audit row). So "create" here means: retire a filter that
  // is currently live, recording a retirement that happened outside the app.
  //
  // Mirrors filter-operations.service.ts retire() exactly - same cycle
  // termination, same _preRetireParentId stash, same relationship teardown - so
  // Unretire can undo it and the filter leaves the hierarchy tree properly.
  // Diverging here would produce half-retired filters that still render in the
  // Block/AHU cascade.
  app.post('/filter-data/retirements', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Retire an existing filter manually (back-dated record)',
      body: {
        type: 'object',
        required: ['_changeReason', 'filterId'],
        properties: {
          ...reasonSchemaProps,
          filterId: { type: 'string', format: 'uuid' },
          remarks: { type: 'string', maxLength: 1000 },
          retiredAt: { type: 'string' },
          performedBy: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const filter = await prisma.assetInstance.findUnique({ where: { id: body.filterId } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Filter not found.' });
    if (filter.status === 'Retired') {
      return reply.code(409).send({ error: 'ALREADY_RETIRED', message: `"${filter.name}" is already retired.` });
    }
    const retiredAt = body.retiredAt ? new Date(body.retiredAt) : new Date();
    if (Number.isNaN(retiredAt.getTime())) return reply.code(400).send({ error: 'INVALID', message: 'Retirement date is not a valid date.' });

    const details = await prisma.filterDetails.findUnique({ where: { assetInstanceId: body.filterId }, select: { currentCycleId: true, currentLifecycleState: true } });
    const existingCustom = (filter.customAttributes as any) ?? {};

    await prisma.$transaction(async (tx) => {
      if (details?.currentCycleId) {
        await tx.cleaningCycle.updateMany({
          where: { id: details.currentCycleId, status: 'IN_PROGRESS' },
          data: { status: 'TERMINATED', completedAt: retiredAt, terminatedAt: retiredAt, terminationReason: 'RETIRED' },
        });
      }
      await tx.assetInstance.update({
        where: { id: body.filterId },
        data: {
          status: 'Retired',
          isActive: false,
          parentId: null,
          customAttributes: { ...existingCustom, _preRetireParentId: filter.parentId },
        },
      });
      await tx.filterDetails.upsert({
        where: { assetInstanceId: body.filterId },
        update: { currentLifecycleState: 'RETIRED', currentCycleId: null },
        create: { assetInstanceId: body.filterId, currentLifecycleState: 'RETIRED', currentCycleId: null },
      });
      await tx.assetRelationship.deleteMany({
        where: { OR: [{ sourceAssetId: body.filterId }, { targetAssetId: body.filterId }] },
      });

      // The FILTER_RETIRED row IS the retirement record's remarks/performer/date
      // half. Written with the same action the workflow emits so the Retirement
      // List, the lifecycle report and the audit page all read it unchanged.
      await auditLog({
        userId: (req.user as any)?.sub,
        userName: body.performedBy || (req.user as any)?.username,
        userRole: (req.user as any)?.role,
        action: 'FILTER_RETIRED',
        targetType: 'filter',
        targetId: body.filterId,
        afterValue: { remarks: body.remarks ?? null, filterName: filter.name, manualEntry: true },
        reason,
        timestamp: retiredAt,
        signatureMeaning: `Retirement of "${filter.name}" recorded manually via Filter Data Management`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: (req.user as any)?.sessionId,
      }, tx);
      // Second row: the MANUAL_RECORD_CREATED marker, so the manual origin of
      // this retirement is visible without decoding the FILTER_RETIRED payload.
      await auditManualChange(req, {
        verb: 'CREATED', targetType: 'retired_filter', targetId: body.filterId, label: 'Retirement record', reason,
        after: { filterName: filter.name, remarks: body.remarks ?? null, retiredAt, previousParentId: filter.parentId, previousLifecycleState: details?.currentLifecycleState ?? null },
      }, tx);
    });
    return { success: true };
  });

  // --- Delete a retirement record (= the retired filter asset itself) ---
  // Refuses when the filter has operational history. Cascading here would let
  // one click erase cleaning cycles and filter events, which are the §11
  // evidence the retirement record exists to close out. The 409 names exactly
  // what is attached so the operator can go clear it deliberately.
  app.delete('/filter-data/retirements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Delete a retired filter record (refused when it has history)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['_changeReason'], properties: { ...reasonSchemaProps }, additionalProperties: true },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const filter = await prisma.assetInstance.findFirst({ where: { id, status: 'Retired' } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retired filter not found' });

    const [cycles, events, identifiers, children] = await Promise.all([
      prisma.cleaningCycle.count({ where: { filterId: id } }),
      prisma.filterEvent.count({ where: { filterId: id } }),
      prisma.assetIdentifier.count({ where: { assetId: id } }),
      prisma.assetInstance.count({ where: { parentId: id } }),
    ]);
    const blockers: string[] = [];
    if (cycles) blockers.push(`${cycles} cleaning cycle${cycles === 1 ? '' : 's'}`);
    if (events) blockers.push(`${events} filter event${events === 1 ? '' : 's'}`);
    if (identifiers) blockers.push(`${identifiers} RFID/identifier tag${identifiers === 1 ? '' : 's'}`);
    if (children) blockers.push(`${children} child record${children === 1 ? '' : 's'}`);
    if (blockers.length > 0) {
      return reply.code(409).send({
        error: 'HAS_HISTORY',
        message: `"${filter.name}" cannot be deleted — it still has ${blockers.join(', ')}. Delete or reassign those first, or use Unretire instead.`,
        blockers: { cycles, events, identifiers, children },
      });
    }

    // Everything that Postgres will CASCADE away with this row. Verified against
    // information_schema: the inbound FKs to asset_instances.id are
    // asset_identifiers, asset_relationships (x2), entity_assignments and
    // filter_details on CASCADE, plus asset_instances.parent_id and
    // equipment_groups.block_id on RESTRICT (the RESTRICT pair either surfaces
    // as a blocker above or as a 400 from the DB).
    //
    // Identifiers are a BLOCKER (an RFID tag is traceability evidence).
    // Relationships and entity assignments are not - a retired filter has had
    // its relationships torn down by retire() already, and an entity assignment
    // is a visibility grant, not §11 evidence. Blocking on those would make the
    // delete unusable. They are captured here instead, so nothing is destroyed
    // without a record of what it was.
    const [doomedRelationships, doomedAssignments] = await Promise.all([
      prisma.assetRelationship.findMany({
        where: { OR: [{ sourceAssetId: id }, { targetAssetId: id }] },
        select: { id: true, sourceAssetId: true, targetAssetId: true, relationshipType: true },
      }),
      prisma.entityAssignment.findMany({ where: { entityId: id } }),
    ]);

    try {
      await prisma.$transaction(async (tx) => {
        await auditManualChange(req, {
          verb: 'DELETED', targetType: 'retired_filter', targetId: id, label: 'Retired filter', reason,
          before: filter,
          sideEffects: {
            // The FILTER_RETIRED audit row is NOT touched - it is the §11 record
            // that this filter was retired, and it outlives the asset row.
            filterRetiredAuditRowKept: true,
            cascadedRelationships: doomedRelationships,
            cascadedEntityAssignments: doomedAssignments,
          },
        }, tx);
        await tx.filterDetails.deleteMany({ where: { assetInstanceId: id } });
        await tx.assetInstance.delete({ where: { id } });
      });
    } catch (e: any) {
      return reply.code(400).send({ error: 'DELETE_FAILED', message: String(e?.message ?? 'Could not delete retired filter.') });
    }
    return { success: true };
  });

  // â”€â”€â”€ Unretire a filter (restore to Active) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.post('/filter-data/retirements/:id/unretire', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Unretire a filter - restore to Active status',
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
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const filter = await prisma.assetInstance.findFirst({ where: { id, status: 'Retired' } });
    if (!filter) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retired filter not found' });

    // Everything below reads/resolves BEFORE the transaction opens, so a bad
    // input can't leave half the destruction applied.
    const customAttrs = (filter.customAttributes as any) ?? {};
    let restoreParentId = body.parentId || customAttrs._preRetireParentId || null;

    // The FILTER_RETIRED / FILTER_REPLACED audit rows are left intact — they are
    // the Â§11 record of what happened, and audit_trail is delete-protected.
    const replacementAudit = await prisma.auditTrail.findFirst({
      where: { action: 'FILTER_REPLACED', targetId: id },
      select: { afterValue: true },
      orderBy: { timestamp: 'desc' },
    });
    const replacedById = ((replacementAudit?.afterValue as any) ?? {}).newFilterId ?? null;

    // Resolve the replacement filter once: it supplies the parent fallback (the
    // new filter inherited it) and tells us whether there's anything to clean up
    // â€” it may already be gone from an earlier unretire.
    let replacementFilterId: string | null = null;
    if (replacedById) {
      const newFilter = await prisma.assetInstance.findUnique({
        where: { id: replacedById },
        select: { id: true, parentId: true },
      });
      if (newFilter) {
        replacementFilterId = newFilter.id;
        if (!restoreParentId && newFilter.parentId) restoreParentId = newFilter.parentId;
      }
    }

    // Clean up the saved pre-retirement data from customAttributes
    const cleanedCustom = { ...customAttrs };
    delete cleanedCustom._preRetireParentId;

    // The replacement filter (if any) is about to be destroyed along with its
    // cycles, events and tags. Snapshot the scale of that before it is gone -
    // an audit row saying only "filter unretired" would hide the demolition.
    const replacementCascade = replacementFilterId
      ? {
          replacementFilterId,
          deletedCleaningCycles: await prisma.cleaningCycle.count({ where: { filterId: replacementFilterId } }),
          deletedFilterEvents: await prisma.filterEvent.count({ where: { filterId: replacementFilterId } }),
          deletedIdentifiers: await prisma.assetIdentifier.count({ where: { assetId: replacementFilterId } }),
        }
      : undefined;

    await prisma.$transaction(async (tx) => {
      await auditManualChange(req, {
        verb: 'UPDATED', targetType: 'retired_filter', targetId: id, label: 'Retired filter', reason,
        before: filter,
        after: { ...filter, status: 'Active', isActive: true, parentId: restoreParentId, customAttributes: cleanedCustom },
        sideEffects: { unretired: true, ...(replacementCascade ? { replacementFilterDeleted: replacementCascade } : {}) },
      }, tx);
      await tx.assetInstance.update({
        where: { id },
        data: {
          status: 'Active',
          isActive: true,
          parentId: restoreParentId,
          customAttributes: cleanedCustom,
        },
      });
      // currentLifecycleState moved to FilterDetails (Step 6).
      await tx.filterDetails.upsert({
        where: { assetInstanceId: id },
        update: { currentLifecycleState: null },
        create: { assetInstanceId: id, currentLifecycleState: null },
      });

      // Restore parent relationship
      if (restoreParentId) {
        await tx.assetRelationship.createMany({
          data: [
            { sourceAssetId: restoreParentId, targetAssetId: id, relationshipType: 'CONTAINS' },
            { sourceAssetId: id, targetAssetId: restoreParentId, relationshipType: 'CONTAINED_IN' },
          ],
          skipDuplicates: true,
        });
      }

      // If this filter was replaced, delete the replacement filter and all its traces
      if (replacementFilterId) {
        await tx.assetRelationship.deleteMany({
          where: { OR: [{ sourceAssetId: replacementFilterId }, { targetAssetId: replacementFilterId }] },
        });
        await tx.assetIdentifier.deleteMany({ where: { assetId: replacementFilterId } });
        await tx.filterEvent.deleteMany({ where: { filterId: replacementFilterId } });
        await tx.cleaningCycle.deleteMany({ where: { filterId: replacementFilterId } });
        // Clear currentCycleId if set (FilterDetails â€” Step 6).
        await tx.filterDetails.updateMany({ where: { assetInstanceId: replacementFilterId }, data: { currentCycleId: null } });
        await tx.assetInstance.delete({ where: { id: replacementFilterId } });
      }
    });

    return { success: true };
  });

  // â”€â”€â”€ Edit a replacement record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.put('/filter-data/replacements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Edit replacement record (BREAKS the audit hash chain - see handler)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['_changeReason'],
        properties: {
          ...reasonSchemaProps,
          remarks: { type: 'string' },
          performedBy: { type: 'string' },
          replacedAt: { type: 'string' },
          oldFilterId: { type: 'string' },
          oldFilterName: { type: 'string' },
          newFilterId: { type: 'string' },
          newFilterName: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = readChangeReason(req, reply);
    if (!reason) return;
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

    // THIS EDITS AN audit_trail ROW IN PLACE.
    //
    // `timestamp`, `userName` and `afterValue` are all inside the hashed
    // canonical payload (hash-chain.ts), so the row's stored checksum stops
    // matching its contents the moment this runs and every chain link after it
    // reads as broken. That was true before the 2026-08-27 retrofit too - the
    // difference is it used to happen SILENTLY, with no record that anyone had
    // touched the row.
    //
    // We do not recompute: a row's checksum cannot be repaired without
    // recomputing every downstream row, which is exactly the rewrite the
    // tamper-evidence exists to prevent. The break stays visible in
    // GET /api/audit/verify-chain, and the meta-audit row below - written
    // FIRST, in the same transaction - preserves the original field values.
    await prisma.$transaction(async (tx) => {
      await auditLog({
        userId: (req.user as any)?.sub,
        userName: (req.user as any)?.username,
        userRole: (req.user as any)?.role,
        action: 'AUDIT_RECORD_UPDATED',
        targetType: 'audit_trail',
        targetId: id,
        beforeValue: { timestamp: record.timestamp, userName: record.userName, afterValue: record.afterValue, action: record.action },
        afterValue: { timestamp: data.timestamp ?? record.timestamp, userName: data.userName ?? record.userName, afterValue: afterChanged ? afterVal : record.afterValue },
        reason,
        signatureMeaning: `Replacement record ${id} edited in place; audit hash chain broken at this position`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: (req.user as any)?.sessionId,
      }, tx);
      await tx.auditTrail.update({ where: { id }, data });
    });
    return { success: true, chainBroken: true };
  });

  // --- Create a replacement record (manual / back-dated) ---
  // Writes a real FILTER_REPLACED audit row through auditLog(), so it is
  // chain-linked and checksummed correctly at insert - unlike the edit above,
  // this ADDS to the chain rather than invalidating it. `timestamp` carries the
  // date the replacement actually happened; `manualEntry` marks it as keyed in
  // after the fact rather than captured by the workflow.
  app.post('/filter-data/replacements', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Create a replacement record (manual / back-dated)',
      body: {
        type: 'object',
        required: ['_changeReason', 'oldFilterId', 'newFilterId'],
        properties: {
          ...reasonSchemaProps,
          oldFilterId: { type: 'string', format: 'uuid' },
          newFilterId: { type: 'string', format: 'uuid' },
          remarks: { type: 'string', maxLength: 1000 },
          replacedAt: { type: 'string' },
          performedBy: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const [oldFilter, newFilter] = await Promise.all([
      prisma.assetInstance.findUnique({ where: { id: body.oldFilterId }, select: { id: true, name: true } }),
      prisma.assetInstance.findUnique({ where: { id: body.newFilterId }, select: { id: true, name: true } }),
    ]);
    if (!oldFilter) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'The replaced (old) filter was not found.' });
    if (!newFilter) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'The replacement (new) filter was not found.' });
    if (oldFilter.id === newFilter.id) return reply.code(400).send({ error: 'INVALID', message: 'A filter cannot replace itself.' });

    const replacedAt = body.replacedAt ? new Date(body.replacedAt) : new Date();
    if (Number.isNaN(replacedAt.getTime())) return reply.code(400).send({ error: 'INVALID', message: 'Replacement date is not a valid date.' });

    // TWO rows, same as the retirement-create path. The FILTER_REPLACED row is
    // the record itself and carries the BACK-DATED timestamp; a manual entry
    // dated last March would otherwise sort to page 12 of a timestamp-desc audit
    // list and look like nothing happened. The MANUAL_RECORD_CREATED marker is
    // stamped now, so the act of keying it in is visible where the operator
    // expects to see it.
    await prisma.$transaction(async (tx) => {
    await auditLog({
      userId: (req.user as any)?.sub,
      // getReplacements() renders `performedBy` from userName, so an operator
      // recording someone else's replacement can name them here.
      userName: body.performedBy || (req.user as any)?.username,
      userRole: (req.user as any)?.role,
      action: 'FILTER_REPLACED',
      targetType: 'filter',
      // targetId IS oldFilterId - the read-side enrichment in audit/routes.ts
      // depends on that, so do not "improve" it to the new filter.
      targetId: oldFilter.id,
      afterValue: {
        oldFilterId: oldFilter.id, oldFilterName: oldFilter.name,
        newFilterId: newFilter.id, newFilterName: newFilter.name,
        remarks: body.remarks ?? null,
        manualEntry: true,
      },
      reason,
      timestamp: replacedAt,
      signatureMeaning: `Replacement of "${oldFilter.name}" with "${newFilter.name}" recorded manually via Filter Data Management`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: (req.user as any)?.sessionId,
    }, tx);
      await auditManualChange(req, {
        verb: 'CREATED', targetType: 'replacement_record', targetId: oldFilter.id, label: 'Replacement record', reason,
        after: {
          oldFilterId: oldFilter.id, oldFilterName: oldFilter.name,
          newFilterId: newFilter.id, newFilterName: newFilter.name,
          remarks: body.remarks ?? null, replacedAt,
        },
      }, tx);
    });
    return { success: true };
  });

  // --- Delete a replacement record (= physically delete its audit row) ---
  // PERMANENTLY breaks the hash chain downstream, exactly like
  // DELETE /api/audit/:id, whose mechanics this mirrors: meta-audit row first,
  // then the immutability trigger disabled for the scope of one transaction
  // (ALTER TABLE takes an ACCESS EXCLUSIVE lock, so no other connection can
  // slip an unguarded delete through the window).
  app.delete('/filter-data/replacements/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN'), requireDataEditReauth],
    schema: {
      tags: ['Super Admin'],
      summary: 'Delete a replacement record (PERMANENTLY breaks the audit hash chain)',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', required: ['_changeReason'], properties: { ...reasonSchemaProps }, additionalProperties: true },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const record = await prisma.auditTrail.findFirst({ where: { id, action: 'FILTER_REPLACED' } });
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Replacement record not found' });

    await prisma.$transaction(async (tx) => {
      await auditLog({
        userId: (req.user as any)?.sub,
        userName: (req.user as any)?.username,
        userRole: (req.user as any)?.role,
        action: 'AUDIT_RECORD_DELETED',
        targetType: 'audit_trail',
        targetId: id,
        beforeValue: { id: record.id, action: record.action, timestamp: record.timestamp, userId: record.userId, userName: record.userName, targetType: record.targetType, targetId: record.targetId, afterValue: record.afterValue },
        reason,
        signatureMeaning: `Replacement record ${id} PHYSICALLY DELETED; hash chain broken at this position`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: (req.user as any)?.sessionId,
      }, tx);
      const triggers = await tx.$queryRawUnsafe<Array<{ tgname: string }>>(
        `SELECT tgname FROM pg_trigger WHERE tgrelid = '"audit_trail"'::regclass AND tgname = 'audit_trail_no_delete'`,
      );
      for (const t of triggers) await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" DISABLE TRIGGER "${t.tgname}"`);
      await tx.auditTrail.delete({ where: { id } });
      for (const t of triggers) await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" ENABLE TRIGGER "${t.tgname}"`);
    });
    return { success: true, chainBroken: true };
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // COMPREHENSIVE DATA MANAGEMENT â€” ALL OPERATIONAL DATA
  // Generic list/edit/delete for every data table, no audit trail
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const dataPreHandler = [app.requireRole('SUPER_ADMIN')];
  // 2026-05-26 PA-REAUTH-3: separate preHandler list for mutations.
  // GETs keep the role-only gate; PUT/DELETE add the reauth step.
  const dataMutationPreHandler = [app.requireRole('SUPER_ADMIN'), requireDataEditReauth];
  // 2026-08-27: mutations here ARE audited (MANUAL_RECORD_*), so the old
  // "(no audit trail)" suffix that was stamped onto ~20 summaries is gone.
  const dataSchema = (summary: string) => ({
    tags: ['Super Admin - Data Management'],
    summary,
  });
  /** Mutation schema: params + free-form body + the mandatory reason field. */
  const mutationBody = (extra: Record<string, unknown> = {}) => ({
    type: 'object' as const,
    required: ['_changeReason'],
    additionalProperties: true,
    properties: { ...reasonSchemaProps, ...extra },
  });
  const idParam = { type: 'object' as const, required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };

  /**
   * Build a `where` from the shared list query (2026-08-27).
   *
   * The Filter Data Management tabs mirror the filters their user-facing page
   * offers, and a filter that is applied client-side on top of a server-paginated
   * list is a LIE — it would filter only the 50 rows that happened to come back,
   * so "no results" could mean "none on this page". These endpoints therefore do
   * the filtering themselves.
   *
   * `dateField` differs per model (createdAt / plannedDate / …), so it is passed
   * in rather than guessed. `to` is treated as INCLUSIVE of the whole day when a
   * bare yyyy-mm-dd is given: an operator picking "to 5 Aug" means through the
   * end of the 5th, not 00:00 on it.
   */
  const listWhere = (
    query: any,
    dateField: string,
    extra?: Record<string, unknown>,
  ): Record<string, unknown> | undefined => {
    const clauses: Record<string, unknown> = {};
    const from = typeof query?.from === 'string' && query.from ? query.from : null;
    const to = typeof query?.to === 'string' && query.to ? query.to : null;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.gte = new Date(from);
      if (to) {
        // Bare date (no time part) => include the whole of that day.
        range.lte = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999`) : new Date(to);
      }
      const valid = Object.values(range).every((d) => !Number.isNaN(d.getTime()));
      if (valid) clauses[dateField] = range;
    }
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v !== undefined && v !== null && v !== '' && v !== 'ALL' && v !== 'all') clauses[k] = v;
    }
    return Object.keys(clauses).length > 0 ? clauses : undefined;
  };

  /** Querystring shared by the filterable data lists. */
  const listQuery = (extra: Record<string, unknown> = {}) => ({
    type: 'object' as const,
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, default: 25 }, // no page-size cap (operator decision 2026-09-04): callers get the size they ask for
      from: { type: 'string', description: 'Inclusive start of the date range.' },
      to: { type: 'string', description: 'Inclusive end of the date range (a bare date covers the whole day).' },
      ...extra,
    },
  });

  // Helper: paginated list for any Prisma model
  const paginatedList = async (model: any, query: any, orderBy: any = { createdAt: 'desc' }, include?: any, where?: any) => {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 25); // no page-size cap (operator decision 2026-09-04): callers get the size they ask for
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

  // Helper: delete one row, reporting the truth. These handlers previously did
  // `.catch(() => null)` and then returned `{ success: true }` unconditionally,
  // so an FK violation, a trigger rejection or a missing row all rendered as a
  // successful deletion in the UI — the operator was told a record was gone
  // while it was still in the database. A genuinely-absent row is the one
  // tolerable case, and it is a 404 (P2025), not a success.
  //
  // 2026-08-27: also reads the row FIRST. Without it the audit row could only
  // say "something was deleted" — `beforeValue` needs the record while it still
  // exists. The read doubles as the 404 check, so a missing row never reaches
  // the delete. The audit write shares the delete's transaction: if one fails
  // neither happens, so there can be no unaudited deletion and no audit row
  // for a deletion that did not occur.
  const deleteRecord = async (
    modelName: 'notification' | 'adminRequest' | 'blockChangeRequest' | 'pmScheduleEntry' | 'filterEvent',
    id: string,
    label: string,
    targetType: string,
    reason: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const existing = await (prisma as any)[modelName].findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: `${label} not found.` });
    try {
      await prisma.$transaction(async (tx) => {
        // Audit FIRST, inside the same tx: `beforeValue` needs the row while it
        // still exists, and if the delete then fails the audit row rolls back
        // with it — no record of a deletion that never happened.
        await auditManualChange(req, { verb: 'DELETED', targetType, targetId: id, label, reason, before: existing }, tx);
        await (tx as any)[modelName].delete({ where: { id } });
      });
      return { success: true };
    } catch (e: any) {
      if (e?.code === 'P2025') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: `${label} not found.` });
      }
      return reply.code(400).send({ error: 'DELETE_FAILED', message: String(e?.message ?? `Could not delete ${label.toLowerCase()}.`) });
    }
  };

  // â”€â”€â”€ Cleaning Cycles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/data/cleaning-cycles', {
    preHandler: dataPreHandler,
    schema: { ...dataSchema('List cleaning cycles'), querystring: listQuery({ status: { type: 'string' } }) },
  }, async (req) => {
    const q = req.query as any;
    return paginatedList(
      prisma.cleaningCycle,
      req.query,
      [{ startedAt: 'desc' }],
      undefined,
      listWhere(q, 'startedAt', { status: q.status }),
    );
  });

  app.put('/data/cleaning-cycles/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Edit cleaning cycle'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const existing = await prisma.cleaningCycle.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const body = req.body as any;
    const data: any = {};
    const dateFields = ['startedAt', 'completedAt', 'terminatedAt', 'dryerStartedAt'];
    const stringFields = ['status', 'cycleCode', 'cleaningReasonKey', 'cleaningReasonLabel', 'cleaningJustification', 'terminationReason'];
    const numFields = ['sequenceNumber', 'profileVersion', 'dryerDurationMinutes'];
    const uuidFields = ['filterId', 'profileId', 'cleaningAreaId', 'equipmentGroupId'];
    for (const f of stringFields) { if (body[f] !== undefined) data[f] = body[f]; }
    for (const f of dateFields) { if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null; }
    for (const f of numFields) { if (body[f] !== undefined) data[f] = body[f] !== null ? Number(body[f]) : null; }
    for (const f of uuidFields) { if (body[f] !== undefined) data[f] = body[f] || null; }
    const badC = invalidEnum('cleaningCycle', data); if (badC) return reply.code(400).send(badC);
    // M27 (2026-09-04): when an edit moves a cycle OUT of IN_PROGRESS and the
    // filter still points at it as its current cycle, clear that pointer the
    // way terminate() does - otherwise the filter stays 'mid-cycle' forever
    // (five deleted filters + one retired one were stranded exactly so). Only
    // this transition; other field edits keep the retrofit's 'no downstream
    // writes' contract. Recorded in the audit row's sideEffects.
    const leavesInProgress = existing.status === 'IN_PROGRESS' && data.status !== undefined && data.status !== 'IN_PROGRESS';
    let clearedPointer: { assetInstanceId: string; currentLifecycleState: string | null } | null = null;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.cleaningCycle.update({ where: { id }, data });
      if (leavesInProgress) {
        const fd = await tx.filterDetails.findFirst({ where: { currentCycleId: id }, select: { assetInstanceId: true, currentLifecycleState: true } });
        if (fd) {
          await tx.filterDetails.update({ where: { assetInstanceId: fd.assetInstanceId }, data: { currentCycleId: null, currentLifecycleState: null } });
          clearedPointer = fd;
        }
      }
      return u;
    });
    await auditManualChange(req, { verb: 'UPDATED', targetType: 'cleaning_cycle', targetId: id, label: 'Cleaning cycle', reason, before: existing, after: updated,
      ...(clearedPointer ? { sideEffects: { clearedFilterCurrentCycle: clearedPointer } } : {}) });
    return updated;
  });

  // Create a cleaning cycle (manual/back-dated record — no audit trail, mirrors
  // the silent edit above). Requires the real FKs a cycle can't exist without
  // (filter + profile) and fills the remaining NOT-NULL columns with sensible
  // derived defaults so a SUPER_ADMIN only has to supply what they care about.
  app.post('/data/cleaning-cycles', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Create cleaning cycle'), body: mutationBody() } }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const data: any = {};
    const stringFields = ['status', 'cycleCode', 'cleaningReasonKey', 'cleaningReasonLabel', 'cleaningJustification', 'terminationReason'];
    const dateFields = ['startedAt', 'completedAt', 'terminatedAt', 'dryerStartedAt'];
    const numFields = ['sequenceNumber', 'profileVersion', 'dryerDurationMinutes'];
    const uuidFields = ['filterId', 'profileId', 'cleaningAreaId', 'equipmentGroupId'];
    for (const f of stringFields) { if (body[f] !== undefined && body[f] !== '') data[f] = body[f]; }
    for (const f of dateFields) { if (body[f]) data[f] = new Date(body[f]); }
    for (const f of numFields) { if (body[f] !== undefined && body[f] !== '' && body[f] !== null) data[f] = Number(body[f]); }
    for (const f of uuidFields) { if (body[f]) data[f] = body[f]; }
    if (!data.filterId) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'A filter must be selected.' });
    if (!data.profileId) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'A cleaning profile must be selected.' });
    if (!data.cleaningReasonLabel) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Cleaning reason is required.' });
    if (!data.cleaningReasonKey) data.cleaningReasonKey = String(data.cleaningReasonLabel).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'manual';
    if (data.profileVersion === undefined) {
      const prof = await prisma.filterCleaningProfile.findUnique({ where: { id: data.profileId }, select: { version: true } });
      data.profileVersion = prof?.version ?? 1;
    }
    if (data.sequenceNumber === undefined) {
      data.sequenceNumber = (await prisma.cleaningCycle.count({ where: { filterId: data.filterId } })) + 1;
    }
    if (!data.cycleCode) data.cycleCode = `MANUAL-${data.sequenceNumber}-${Date.now().toString(36).toUpperCase()}`;
    if (!data.startedAt) data.startedAt = new Date();
    data.manualEntry = true;
    const badC = invalidEnum('cleaningCycle', data); if (badC) return reply.code(400).send(badC);
    try {
      const created = await prisma.cleaningCycle.create({ data });
      await auditManualChange(req, { verb: 'CREATED', targetType: 'cleaning_cycle', targetId: created.id, label: 'Cleaning cycle', reason, after: created });
      return created;
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (e?.code === 'P2002' || msg.includes('unique') || msg.includes('23505') || msg.includes('one_in_progress')) {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Duplicate cycle code, or this filter already has an in-progress cycle. Set status to COMPLETED/TERMINATED or change the cycle code.' });
      }
      return reply.code(400).send({ error: 'CREATE_FAILED', message: msg || 'Could not create cleaning cycle.' });
    }
  });

  // Not routed through `deleteRecord` — this delete CASCADES (filter events go
  // with the cycle, and any FilterDetails pointing at it is cleared). The audit
  // row records that blast radius in `_sideEffects`; a row saying only "cycle
  // deleted" would understate what the operator actually destroyed.
  app.delete('/data/cleaning-cycles/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Delete cleaning cycle'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const existing = await prisma.cleaningCycle.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const doomedEvents = await prisma.filterEvent.findMany({
      where: { cycleId: id },
      select: { id: true, eventType: true, fromState: true, toState: true, performedAt: true },
    });
    const affectedDetails = await prisma.filterDetails.findMany({ where: { currentCycleId: id }, select: { assetInstanceId: true, currentLifecycleState: true } });
    try {
      await prisma.$transaction(async (tx) => {
        await auditManualChange(req, {
          verb: 'DELETED', targetType: 'cleaning_cycle', targetId: id, label: 'Cleaning cycle', reason,
          before: existing,
          sideEffects: {
            deletedFilterEvents: doomedEvents,
            deletedFilterEventCount: doomedEvents.length,
            clearedFilterDetails: affectedDetails,
          },
        }, tx);
        await tx.filterEvent.deleteMany({ where: { cycleId: id } });
        // Clear currentCycleId/currentLifecycleState on FilterDetails (Step 6).
        await tx.filterDetails.updateMany({ where: { currentCycleId: id }, data: { currentCycleId: null, currentLifecycleState: null } });
        await tx.cleaningCycle.delete({ where: { id } });
      });
    } catch (e: any) {
      return reply.code(400).send({ error: 'DELETE_FAILED', message: String(e?.message ?? 'Could not delete cleaning cycle.') });
    }
    return { success: true };
  });

  // â”€â”€â”€ Filter Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/data/filter-events', {
    preHandler: dataPreHandler,
    schema: { ...dataSchema('List filter events'), querystring: listQuery({ eventType: { type: 'string' } }) },
  }, async (req) => {
    const q = req.query as any;
    return paginatedList(
      prisma.filterEvent,
      req.query,
      { performedAt: 'desc' },
      undefined,
      listWhere(q, 'performedAt', { eventType: q.eventType }),
    );
  });

  app.put('/data/filter-events/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Edit filter event'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
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
    const badE = invalidEnum('filterEvent', data); if (badE) return reply.code(400).send(badE);
    const updated = await prisma.filterEvent.update({ where: { id }, data });
    await auditManualChange(req, { verb: 'UPDATED', targetType: 'filter_event', targetId: id, label: 'Filter event', reason, before: existing, after: updated });
    return updated;
  });

  // Create a filter event (manual record — no audit trail). performedBy, the
  // SHA-256 checksum and the caller IP are stamped server-side; a cycleId, if
  // given, must belong to the same filter (DB trg_filter_event_consistency).
  app.post('/data/filter-events', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Create filter event'), body: mutationBody() } }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['eventType', 'fromState', 'toState', 'remarks']) { if (body[f] !== undefined && body[f] !== '') data[f] = body[f]; }
    for (const f of ['filterId', 'cycleId', 'cleaningAreaId', 'equipmentId', 'blockId']) { if (body[f]) data[f] = body[f]; }
    if (body.attributes !== undefined) data.attributes = body.attributes;
    if (!data.filterId) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'A filter must be selected.' });
    if (!data.eventType) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Event type is required.' });
    data.performedBy = body.performedBy || (req.user as any)?.sub;
    data.performedAt = body.performedAt ? new Date(body.performedAt) : new Date();
    data.ipAddress = req.ip || '0.0.0.0';
    data.checksum = body.checksum || computeChecksum({ filterId: data.filterId, cycleId: data.cycleId ?? null, eventType: data.eventType, performedBy: data.performedBy, performedAt: data.performedAt.toISOString() });
    data.manualEntry = true;
    const badE = invalidEnum('filterEvent', data); if (badE) return reply.code(400).send(badE);
    try {
      const created = await prisma.filterEvent.create({ data });
      await auditManualChange(req, { verb: 'CREATED', targetType: 'filter_event', targetId: created.id, label: 'Filter event', reason, after: created });
      return created;
    } catch (e: any) {
      return reply.code(400).send({ error: 'CREATE_FAILED', message: String(e?.message ?? 'Could not create filter event.') });
    }
  });

  app.delete('/data/filter-events/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Delete filter event'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    return deleteRecord('filterEvent', id, 'Filter event', 'filter_event', reason, req, reply);
  });

  // â”€â”€â”€ Audit Trail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // List is allowed (read-only). PUT + DELETE were removed 2026-05-20
  // (delta-audit Â§C2 / May 16 Â§1.3) â€” they let SUPER_ADMIN rewrite or erase
  // any audit row with no reauth and no audit-of-the-audit, making the
  // hash-chain machinery decorative. Audit records are immutable by 21 CFR
  // Â§11.10(e); the DB-level audit_trail_no_delete trigger and
  // verifyAuditChain are the source of truth, and the data-mgmt UI must not
  // expose escape hatches. If a row must be redacted, do it via the
  // dedicated REDACT path (Wave 4 Â§C1 â€” preserves chain links, NULLs
  // payload, requires reauth + meta-audit).
  app.get('/data/audit-trail', { preHandler: dataPreHandler, schema: dataSchema('List audit trail entries') }, async (req) => {
    return paginatedList(prisma.auditTrail, req.query, { timestamp: 'desc' });
  });

  // â”€â”€â”€ Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/data/notifications', {
    preHandler: dataPreHandler,
    schema: { ...dataSchema('List notifications'), querystring: listQuery({ type: { type: 'string' } }) },
  }, async (req) => {
    const q = req.query as any;
    return paginatedList(
      prisma.notification,
      req.query,
      { createdAt: 'desc' },
      undefined,
      listWhere(q, 'createdAt', { type: q.type }),
    );
  });

  app.put('/data/notifications/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Edit notification'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    // Pre-fetch for the audit row's beforeValue. This handler had no read at
    // all before the retrofit, so an edit could not have recorded a "from".
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const body = req.body as any;
    const data: any = {};
    for (const f of ['type', 'title', 'message', 'forUserId', 'forRole', 'targetUserId', 'createdBy']) { if (body[f] !== undefined) data[f] = body[f]; }
    if (body.isRead !== undefined) data.isRead = body.isRead === true || body.isRead === 'true';
    if (body.readAt !== undefined) data.readAt = body.readAt ? new Date(body.readAt) : null;
    const badN = invalidEnum('notification', data); if (badN) return reply.code(400).send(badN);
    const updated = await prisma.notification.update({ where: { id }, data });
    await auditManualChange(req, { verb: 'UPDATED', targetType: 'notification', targetId: id, label: 'Notification', reason, before: existing, after: updated });
    return updated;
  });

  // Create a notification (manual record — no audit trail).
  app.post('/data/notifications', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Create notification'), body: mutationBody() } }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['type', 'title', 'message', 'forUserId', 'forRole', 'targetUserId', 'createdBy']) { if (body[f] !== undefined && body[f] !== '') data[f] = body[f]; }
    if (body.isRead !== undefined) data.isRead = body.isRead === true || body.isRead === 'true';
    if (body.readAt) data.readAt = new Date(body.readAt);
    if (body.createdAt) data.createdAt = new Date(body.createdAt);
    if (!data.type) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Type is required.' });
    if (!data.title) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Title is required.' });
    if (!data.message) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Message is required.' });
    if (!data.createdBy) data.createdBy = (req.user as any)?.sub;
    data.manualEntry = true;
    const badN = invalidEnum('notification', data); if (badN) return reply.code(400).send(badN);
    try {
      const created = await prisma.notification.create({ data });
      await auditManualChange(req, { verb: 'CREATED', targetType: 'notification', targetId: created.id, label: 'Notification', reason, after: created });
      return created;
    } catch (e: any) {
      return reply.code(400).send({ error: 'CREATE_FAILED', message: String(e?.message ?? 'Could not create notification.') });
    }
  });

  app.delete('/data/notifications/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Delete notification'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    return deleteRecord('notification', id, 'Notification', 'notification', reason, req, reply);
  });

  // â”€â”€â”€ Admin Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/data/admin-requests', { preHandler: dataPreHandler, schema: dataSchema('List admin requests') }, async (req) => {
    return paginatedList(prisma.adminRequest, req.query, { requestedAt: 'desc' });
  });

  app.put('/data/admin-requests/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Edit admin request'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const existing = await prisma.adminRequest.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const body = req.body as any;
    const data: any = {};
    for (const f of ['requestType', 'status', 'requesterName', 'requesterEmployeeId', 'requesterEmail', 'remarks', 'adminRemarks', 'processedBy']) {
      if (body[f] !== undefined) data[f] = body[f];
    }
    for (const f of ['requestedAt', 'processedAt']) {
      if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null;
    }
    if (body.requestData !== undefined) data.requestData = body.requestData;
    const updated = await prisma.adminRequest.update({ where: { id }, data });
    await auditManualChange(req, { verb: 'UPDATED', targetType: 'admin_request', targetId: id, label: 'Admin request', reason, before: existing, after: updated });
    return updated;
  });

  // Create an admin request (manual record — no audit trail).
  app.post('/data/admin-requests', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Create admin request'), body: mutationBody() } }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['requestType', 'status', 'requesterName', 'requesterEmployeeId', 'requesterEmail', 'remarks', 'adminRemarks', 'processedBy']) { if (body[f] !== undefined && body[f] !== '') data[f] = body[f]; }
    for (const f of ['requestedAt', 'processedAt']) { if (body[f]) data[f] = new Date(body[f]); }
    if (body.requestData !== undefined) data.requestData = body.requestData;
    if (!data.requestType) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Request type is required.' });
    if (!data.requesterName) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Requester name is required.' });
    data.manualEntry = true;
    try {
      const created = await prisma.adminRequest.create({ data });
      await auditManualChange(req, { verb: 'CREATED', targetType: 'admin_request', targetId: created.id, label: 'Admin request', reason, after: created });
      return created;
    } catch (e: any) {
      return reply.code(400).send({ error: 'CREATE_FAILED', message: String(e?.message ?? 'Could not create admin request.') });
    }
  });

  app.delete('/data/admin-requests/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Delete admin request'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    return deleteRecord('adminRequest', id, 'Admin request', 'admin_request', reason, req, reply);
  });

  // â”€â”€â”€ Block Change Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/data/block-change-requests', { preHandler: dataPreHandler, schema: dataSchema('List block change requests') }, async (req) => {
    return paginatedList(prisma.blockChangeRequest, req.query);
  });

  app.put('/data/block-change-requests/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Edit block change request'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    // NB: `reason` below is the operator's justification for making this edit.
    // The record's OWN `reason` column is a separate field and is still edited
    // through `body.reason` — this is exactly why the justification travels as
    // `_changeReason`.
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const existing = await prisma.blockChangeRequest.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
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
    const badB = invalidEnum('blockChangeRequest', data); if (badB) return reply.code(400).send(badB);
    const updated = await prisma.blockChangeRequest.update({ where: { id }, data });
    await auditManualChange(req, { verb: 'UPDATED', targetType: 'block_change_request', targetId: id, label: 'Block change request', reason, before: existing, after: updated });
    return updated;
  });

  // Create a block-change request (manual record — no audit trail). Needs the
  // full filter + from/to block identity a request can't exist without; the
  // requester defaults to the acting SUPER_ADMIN when not supplied.
  app.post('/data/block-change-requests', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Create block change request'), body: mutationBody() } }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['status', 'reason', 'filterName', 'fromBlockName', 'toBlockName', 'requestedByName', 'processedByName', 'processedComment']) { if (body[f] !== undefined && body[f] !== '') data[f] = body[f]; }
    for (const f of ['filterId', 'fromBlockId', 'toBlockId', 'requestedBy', 'processedBy']) { if (body[f]) data[f] = body[f]; }
    for (const f of ['processedAt', 'createdAt']) { if (body[f]) data[f] = new Date(body[f]); }
    for (const f of ['filterId', 'filterName', 'fromBlockId', 'fromBlockName', 'toBlockId', 'toBlockName']) {
      if (!data[f]) return reply.code(400).send({ error: 'MISSING_FIELD', message: `${f} is required.` });
    }
    if (!data.requestedBy) data.requestedBy = (req.user as any)?.sub;
    if (!data.requestedByName) data.requestedByName = (req.user as any)?.username ?? 'Manual Entry';
    data.manualEntry = true;
    const badB = invalidEnum('blockChangeRequest', data); if (badB) return reply.code(400).send(badB);
    try {
      const created = await prisma.blockChangeRequest.create({ data });
      await auditManualChange(req, { verb: 'CREATED', targetType: 'block_change_request', targetId: created.id, label: 'Block change request', reason, after: created });
      return created;
    } catch (e: any) {
      return reply.code(400).send({ error: 'CREATE_FAILED', message: String(e?.message ?? 'Could not create block change request.') });
    }
  });

  app.delete('/data/block-change-requests/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Delete block change request'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    return deleteRecord('blockChangeRequest', id, 'Block change request', 'block_change_request', reason, req, reply);
  });

  // â”€â”€â”€ PM Schedule Entries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Flat list of PM schedules (name-resolved via the owning entity) — powers
  // the create-PM-entry schedule picker so a new entry can be attached even
  // when no entries exist yet. Read-only; SUPER_ADMIN.
  app.get('/data/pm-schedules', { preHandler: dataPreHandler, schema: dataSchema('List PM schedules') }, async () => {
    const schedules = await prisma.pmSchedule.findMany({ orderBy: [{ year: 'desc' }, { updatedAt: 'desc' }] });
    const entityIds = [...new Set(schedules.map(s => s.entityId))];
    const entities = await prisma.assetInstance.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } });
    const nameById = new Map(entities.map(e => [e.id, e.name]));
    return { data: schedules.map(s => ({ id: s.id, entityId: s.entityId, entityName: nameById.get(s.entityId) ?? null, year: s.year, version: s.version, status: s.status })) };
  });

  app.get('/data/pm-entries', {
    preHandler: dataPreHandler,
    schema: { ...dataSchema('List PM schedule entries'), querystring: listQuery({ approvalStatus: { type: 'string' } }) },
  }, async (req) => {
    const q = req.query as any;
    return paginatedList(
      prisma.pmScheduleEntry,
      req.query,
      { plannedDate: 'desc' },
      { schedule: true },
      listWhere(q, 'plannedDate', { approvalStatus: q.approvalStatus }),
    );
  });

  app.put('/data/pm-entries/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Edit PM schedule entry'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const existing = await prisma.pmScheduleEntry.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND' });
    const data: any = {};
    for (const f of ['month', 'toleranceDays']) { if (body[f] !== undefined) data[f] = Number(body[f]); }
    for (const f of ['approvalStatus', 'approvalRemarks', 'submittedByName', 'approvedByName', 'notes']) { if (body[f] !== undefined) data[f] = body[f]; }
    for (const f of ['plannedDate', 'windowStart', 'windowEnd', 'approvedAt']) { if (body[f] !== undefined) data[f] = body[f] ? new Date(body[f]) : null; }
    const badP = invalidEnum('pmScheduleEntry', data); if (badP) return reply.code(400).send(badP);
    const updated = await prisma.pmScheduleEntry.update({ where: { id }, data });
    await auditManualChange(req, { verb: 'UPDATED', targetType: 'pm_schedule_entry', targetId: id, label: 'PM entry', reason, before: existing, after: updated });
    return updated;
  });

  // Create a PM schedule entry (manual record — no audit trail). Needs its
  // parent scheduleId (unlike edit); the coverage window defaults to the
  // planned date when not supplied. [scheduleId, month] is unique.
  app.post('/data/pm-entries', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Create PM schedule entry'), body: mutationBody() } }, async (req, reply) => {
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    const body = req.body as any;
    const data: any = {};
    for (const f of ['month', 'toleranceDays']) { if (body[f] !== undefined && body[f] !== '' && body[f] !== null) data[f] = Number(body[f]); }
    for (const f of ['approvalStatus', 'approvalRemarks', 'submittedByName', 'approvedByName', 'notes']) { if (body[f] !== undefined && body[f] !== '') data[f] = body[f]; }
    for (const f of ['plannedDate', 'windowStart', 'windowEnd', 'approvedAt']) { if (body[f]) data[f] = new Date(body[f]); }
    if (body.scheduleId) data.scheduleId = body.scheduleId;
    if (!data.scheduleId) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'A PM schedule must be selected.' });
    if (data.month === undefined) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Month (1–12) is required.' });
    if (!data.plannedDate) return reply.code(400).send({ error: 'MISSING_FIELD', message: 'Planned date is required.' });
    if (!data.windowStart) data.windowStart = data.plannedDate;
    if (!data.windowEnd) data.windowEnd = data.plannedDate;
    data.manualEntry = true;
    const badP = invalidEnum('pmScheduleEntry', data); if (badP) return reply.code(400).send(badP);
    try {
      const created = await prisma.pmScheduleEntry.create({ data });
      await auditManualChange(req, { verb: 'CREATED', targetType: 'pm_schedule_entry', targetId: created.id, label: 'PM entry', reason, after: created });
      return created;
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      if (e?.code === 'P2002' || msg.includes('unique') || msg.includes('23505')) {
        return reply.code(409).send({ error: 'CONFLICT', message: 'A PM entry for this schedule and month already exists.' });
      }
      return reply.code(400).send({ error: 'CREATE_FAILED', message: msg || 'Could not create PM entry.' });
    }
  });

  app.delete('/data/pm-entries/:id', { preHandler: dataMutationPreHandler, schema: { ...dataSchema('Delete PM schedule entry'), params: idParam, body: mutationBody() } }, async (req, reply) => {
    const { id } = req.params as any;
    const reason = readChangeReason(req, reply);
    if (!reason) return;
    return deleteRecord('pmScheduleEntry', id, 'PM entry', 'pm_schedule_entry', reason, req, reply);
  });
}
