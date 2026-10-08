import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { AppError, NotFoundError, ValidationError, ConflictError } from '../../../lib/errors.js';
import { assertFilterOperable } from '../filter-workflow.js';
import { identifierRepository } from '../repositories/identifier.repository.js';
import { instanceRepository } from '../repositories/instance.repository.js';
import { prisma } from '../../../lib/prisma.js';

export const identifierService = {
  async list(query: { assetId?: string; type?: string }) {
    const where: Record<string, unknown> = {};
    if (query.assetId) where.assetId = query.assetId;
    if (query.type) where.identifierType = query.type;
    return identifierRepository.findMany(where);
  },

  async lookupByValue(value: string) {
    const identifier = await identifierRepository.findByValue(value);
    if (!identifier) throw new NotFoundError('Identifier not found');
    return identifier;
  },

  async create(data: { assetId: string; identifierType: string; identifierValue: string; label?: string; isPrimary?: boolean; replaceExisting?: boolean }, ctx: RequestContext) {
    const asset = await instanceRepository.findByIdSimple(data.assetId);
    if (!asset) throw new ValidationError('Entity instance not found');
    // 2026-10-08 (operator): a filter that has not passed review + approval
    // cannot be tagged — the web Filters page hid the control, but the tablet
    // RFID-assign page and the API did not. Non-filter assets carry APPROVED.
    assertFilterOperable((asset as any).approvalStatus, asset.name);

    // Only one identifier per entity. 2026-10-05: re-tagging is a real field
    // operation (a damaged or lost tag, or a tag scanned onto the wrong filter
    // during commissioning). The operator used to be refused with "already has
    // an identifier" and had to find the Remove button first — on 2026-10-05
    // four refusals in 15 s on one filter. With `replaceExisting` the tag the
    // filter holds is released in the SAME transaction as the new binding,
    // audited as ASSET_IDENTIFIER_DELETED whose reason names the new tag, so
    // the RFID Track Record shows REMOVE then ASSIGN. Without the flag the
    // refusal stands: both UIs send it only after a confirm step.
    const existingForAsset = await identifierRepository.findMany({ assetId: data.assetId });
    const sameTagAlreadyHere = existingForAsset.find((i) => i.identifierValue === data.identifierValue);
    if (sameTagAlreadyHere) {
      throw new ConflictError(`Tag ${data.identifierValue} is already assigned to "${asset.name}".`, 'IDENTIFIER_ALREADY_ON_ENTITY');
    }
    if (existingForAsset.length > 0 && !data.replaceExisting) {
      throw new ConflictError(
        `"${asset.name}" already has tag ${existingForAsset[0].identifierValue}. Remove it first, or confirm the replacement.`,
        'ENTITY_HAS_IDENTIFIER',
      );
    }
    const replaced = data.replaceExisting ? existingForAsset : [];

    const existingIdent = await identifierRepository.findByIdentifierValue(data.identifierValue);
    // Audit 2026-09-24 DB finding (closed 2026-09-25): a tag stays bound to a
    // retired filter on purpose (§11 evidence; replace()/unretire depend on it —
    // see e2e/retire-replace-identifier-invariant.test.ts), but a retired or
    // deactivated filter is hidden from every RFID surface, so its tag could
    // never be freed and the physical tag became unusable. Re-assignment is the
    // documented place to free it: when the current holder is retired or
    // inactive, release the old binding (audited, so the Track Record shows the
    // REMOVE) in the same transaction as the new one. A tag on a LIVE filter is
    // still a conflict.
    let released: { id: string; assetId: string; identifierType: string; identifierValue: string; holderName: string | null } | null = null;
    if (existingIdent) {
      const holder = await prisma.assetInstance.findUnique({ where: { id: existingIdent.assetId }, select: { name: true, status: true, isActive: true } });
      const holderGone = !holder || holder.status === 'Retired' || holder.isActive === false;
      if (!holderGone) throw new ConflictError('Identifier value already exists on another entity', 'DUPLICATE_IDENTIFIER_VALUE');
      released = { id: existingIdent.id, assetId: existingIdent.assetId, identifierType: existingIdent.identifierType, identifierValue: existingIdent.identifierValue, holderName: holder?.name ?? null };
    }

    const identifier = await prisma.$transaction(async (tx) => {
      for (const old of replaced) {
        await tx.assetIdentifier.delete({ where: { id: old.id } });
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'ASSET_IDENTIFIER_DELETED',
          targetType: 'asset_identifier', targetId: old.id,
          beforeValue: { assetId: old.assetId, identifierType: old.identifierType, identifierValue: old.identifierValue, filterName: asset.name },
          afterValue: { deleted: true, replacedBy: data.identifierValue },
          reason: `Replaced by tag ${data.identifierValue} on "${asset.name}"`,
          signatureMeaning: `Identifier "${old.identifierValue}" released from "${asset.name}" — replaced by "${data.identifierValue}"`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        }, tx);
      }
      if (released) {
        await tx.assetIdentifier.delete({ where: { id: released.id } });
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'ASSET_IDENTIFIER_DELETED',
          targetType: 'asset_identifier', targetId: released.id,
          beforeValue: { assetId: released.assetId, identifierType: released.identifierType, identifierValue: released.identifierValue, filterName: released.holderName },
          afterValue: { deleted: true, reassignedTo: data.assetId },
          reason: `Reassigned to "${asset.name}": previous holder "${released.holderName ?? released.assetId}" is retired or deactivated`,
          signatureMeaning: `Identifier "${released.identifierValue}" released from retired/deactivated "${released.holderName ?? released.assetId}" on reassignment`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        }, tx);
      }
      return tx.assetIdentifier.create({
        data: {
          assetId: data.assetId,
          identifierType: data.identifierType,
          identifierValue: data.identifierValue,
          label: data.label,
          isPrimary: data.isPrimary,
          createdBy: ctx.userId,
        },
      });
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_IDENTIFIER_CREATED',
      targetType: 'asset_identifier',
      targetId: identifier.id,
      // Store the filter name alongside the identifier so the audit row is
      // self-describing (targetId is the identifier UUID, not the filter, so the
      // audit UI cannot resolve the filter name at render time). identifierValue
      // is already on `identifier` — the template renders it as the RFID tag.
      afterValue: { ...identifier, filterName: asset.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return identifier;
  },

  async delete(id: string, ctx: RequestContext, reason?: string | null) {
    const existing = await identifierRepository.findById(id);
    if (!existing) throw new NotFoundError('Identifier not found');

    // Resolve the filter name for a self-describing audit row (targetId is the
    // identifier UUID, so the audit UI can't look up the filter at render time).
    const asset = await instanceRepository.findByIdSimple(existing.assetId);

    await identifierRepository.delete(id);

    // P4 (2026-06-03): capture an optional removal reason so the RFID Track
    // Record report can show WHY a tag was removed (audit_trail.reason).
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'ASSET_IDENTIFIER_DELETED',
      targetType: 'asset_identifier',
      targetId: id,
      beforeValue: {
        assetId: existing.assetId,
        identifierType: existing.identifierType,
        identifierValue: existing.identifierValue,
        filterName: asset?.name ?? null,
      },
      afterValue: { deleted: true },
      reason: trimmedReason || undefined,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
  },

  /**
   * P4 (2026-06-03): RFID Track Record — full lifecycle history of RFID tags,
   * reconstructed from audit_trail (ASSET_IDENTIFIER_CREATED = assign,
   * ASSET_IDENTIFIER_DELETED = remove). Each row is one assign/remove event with
   * RFID number, filter + AHU, the acting user, timestamp, and (for removals) a
   * reason. The flat time-ordered list IS the assignment / removal / reassignment
   * timeline. Filters: date range, RFID, filter name, AHU, user. RFID-type only.
   */
  async getRfidTrackRecord(query: {
    from?: string; to?: string; rfid?: string; filterName?: string; ahu?: string; user?: string;
    page?: number; limit?: number;
  }) {
    const where: any = { action: { in: ['ASSET_IDENTIFIER_CREATED', 'ASSET_IDENTIFIER_DELETED'] } };
    if (query.from || query.to) {
      // Audit 2026-09-24 (A-F1): an unparsable date became `Invalid Date` → Prisma
      // validation error → 500 + a SYSTEM_ERROR notification, for every role.
      const parse = (v: string, label: string) => {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_DATE', `"${label}" is not a valid date.`);
        return d;
      };
      where.timestamp = {};
      if (query.from) where.timestamp.gte = parse(query.from, 'from');
      if (query.to) where.timestamp.lte = parse(query.to, 'to');
    }
    const rows = await prisma.auditTrail.findMany({ where, orderBy: { timestamp: 'desc' } });

    const events = rows.map((r) => {
      const isAssign = r.action === 'ASSET_IDENTIFIER_CREATED';
      const v = ((isAssign ? r.afterValue : r.beforeValue) as any) ?? {};
      return {
        // The audit row id. The SUPER_ADMIN edit on the RFID Track Record page
        // (2026-09-05) addresses a row by it; every other reader ignores it.
        id: r.id,
        timestamp: r.timestamp,
        event: isAssign ? 'ASSIGN' : 'REMOVE',
        rfidNumber: v.identifierValue ?? null,
        identifierType: v.identifierType ?? null,
        assetId: v.assetId ?? null,
        reason: r.reason ?? null,
        userId: r.userId ?? null,
        userName: r.userName ?? null,
      };
    }).filter((e) => e.identifierType === 'RFID' && e.rfidNumber);

    // Resolve filter + AHU (parent) names and acting-user display names.
    const assetIds = [...new Set(events.map((e) => e.assetId).filter(Boolean))] as string[];
    const filters = assetIds.length
      ? await prisma.assetInstance.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true, parentId: true } })
      : [];
    const fmap = new Map(filters.map((f) => [f.id, f]));
    const parentIds = [...new Set(filters.map((f) => f.parentId).filter(Boolean))] as string[];
    const parents = parentIds.length
      ? await prisma.assetInstance.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } })
      : [];
    const pmap = new Map(parents.map((p) => [p.id, p.name]));
    // audit_trail.userId is varchar(100) — historically it can hold a UUID OR a
    // bare username/'SYSTEM'. Only query User by the UUID-shaped ones (User.id is
    // a uuid column; passing a non-UUID throws); non-UUID ids fall back to the
    // raw value (already a display name) below.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userIds = [...new Set(events.map((e) => e.userId).filter(Boolean))] as string[];
    const uuidUserIds = userIds.filter((u) => UUID_RE.test(u));
    const users = uuidUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: uuidUserIds } }, select: { id: true, username: true, fullName: true } })
      : [];
    // Show the user ID (username), not the full name, as the performer.
    const umap = new Map(users.map((u) => [u.id, u.username]));

    let enriched = events.map((e) => {
      const f = e.assetId ? fmap.get(e.assetId) : null;
      return {
        id: e.id,
        timestamp: e.timestamp,
        event: e.event,
        rfidNumber: e.rfidNumber as string,
        // Ids ride along with the names so an edit dialog can pre-select the
        // filter / AHU / user without a reverse lookup by display text.
        filterId: e.assetId,
        filterName: f?.name ?? null,
        ahuId: f?.parentId ?? null,
        ahuName: f?.parentId ? (pmap.get(f.parentId) ?? null) : null,
        userId: e.userId,
        user: e.userName || (e.userId ? (umap.get(e.userId) ?? e.userId) : null),
        reason: e.reason,
      };
    });

    const lc = (s?: string | null) => (s ?? '').toLowerCase();
    if (query.rfid) enriched = enriched.filter((e) => lc(e.rfidNumber).includes(query.rfid!.toLowerCase()));
    if (query.filterName) enriched = enriched.filter((e) => lc(e.filterName).includes(query.filterName!.toLowerCase()));
    if (query.ahu) enriched = enriched.filter((e) => lc(e.ahuName).includes(query.ahu!.toLowerCase()));
    if (query.user) enriched = enriched.filter((e) => lc(e.user).includes(query.user!.toLowerCase()));

    const total = enriched.length;
    const page = query.page ?? 1;
    // 2026-07-03: RFID identifier list uncapped per user request. An omitted
    // limit returns ALL rows; a provided value still paginates the in-memory set.
    const limit = query.limit;
    const data = limit ? enriched.slice((page - 1) * limit, (page - 1) * limit + limit) : enriched;
    return { data, total, page, limit: limit ?? total, totalPages: limit ? Math.ceil(total / limit) : 1 };
  },
};
