import type { RequestContext } from '../../../types/context.js';
import { auditLog } from '../../../lib/audit.js';
import { AppError, NotFoundError, ValidationError, ConflictError } from '../../../lib/errors.js';
import { assertFilterOperable } from '../filter-workflow.js';
import { identifierRepository } from '../repositories/identifier.repository.js';
import { instanceRepository } from '../repositories/instance.repository.js';
import { prisma } from '../../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { canonicalRfidValue, sameRfidValue } from '../../../lib/rfid-canonical.js';
import { lockIdentifierScope } from './identifier-locks.js';
import { rangeStartOrThrow, rangeEndOrThrow } from '../../../lib/date-range-guard.js';


export const identifierService = {
  async list(query: { assetId?: string; type?: string }) {
    const where: Record<string, unknown> = {};
    if (query.assetId) where.assetId = query.assetId;
    if (query.type) where.identifierType = query.type;
    return identifierRepository.findMany(where);
  },

  async lookupByValue(value: string) {
    let identifier = await identifierRepository.findByValue(value);
    // C-07: scans arrive normalised (upper-case, stutter collapsed). A row
    // stored before canonical writes may differ only in casing — resolve it
    // rather than answering "not found" for a tag that IS assigned.
    if (!identifier) {
      const alt = await identifierRepository.findByIdentifierValueInsensitive(canonicalRfidValue(value));
      if (alt) identifier = await identifierRepository.findByValue(alt.identifierValue);
    }
    if (!identifier) throw new NotFoundError('Identifier not found');
    return identifier;
  },

  async create(rawData: { assetId: string; identifierType: string; identifierValue: string; label?: string; isPrimary?: boolean; replaceExisting?: boolean }, ctx: RequestContext) {
    // C-07 (2026-10-19): an RFID value is stored in its CANONICAL form — the
    // same rule every scan lookup applies (lib/rfid-canonical.ts mirrors
    // web lib/rfid-scan.ts). One place for every client (tablet assign, web
    // assign, typed filter create via filter.service). Other identifier types
    // are left exactly as sent: a barcode / QR payload may be case-sensitive.
    const isRfid = rawData.identifierType === 'RFID';
    const data = isRfid ? { ...rawData, identifierValue: canonicalRfidValue(rawData.identifierValue) } : rawData;
    if (isRfid && !data.identifierValue) throw new ValidationError('RFID tag value is empty');
    const sameValue = (a: string, b: string) => (isRfid ? sameRfidValue(a, b) : a === b);
    const asset = await instanceRepository.findByIdSimple(data.assetId);
    if (!asset) throw new ValidationError('Entity instance not found');
    // 2026-10-08 (operator): a filter that has not passed review + approval
    // cannot be tagged — the web Filters page hid the control, but the tablet
    // RFID-assign page and the API did not. Non-filter assets carry APPROVED.
    assertFilterOperable((asset as any).approvalStatus, asset.name);

    const identifier = await prisma.$transaction(async (tx) => {
      // D-DB-2 (2026-10-22): every check below used to run OUTSIDE this
      // transaction, so two assigns arriving together (two tablets, a double
      // submit) both saw a filter with no tag and both inserted — 10 of 10
      // filters ended with two tags in test-results/05 §2.4. Nothing in the
      // schema stops it (asset_identifiers is unique on the value only). The
      // checks now run here, behind two transaction-scoped advisory locks:
      //   1. the FILTER — serialises assigns to one filter, so the second one
      //      reads the first one's committed tag (READ COMMITTED re-snapshots
      //      per statement) and is refused, or with `replaceExisting` replaces it;
      //   2. the TAG value, lower-cased because the RFID duplicate check is
      //      case-insensitive — serialises two filters claiming one tag (e.g. a
      //      retired filter's, below), so the loser reads the winner's binding
      //      and gets DUPLICATE_IDENTIFIER_VALUE, not a 404 for deleting a row
      //      the winner already released.
      // Advisory, not a row lock on asset_instances: a row lock would also stall
      // every other write to the filter, and would deadlock against a
      // transaction that audited (global chain lock) before updating the filter.
      // Lock order and key space: identifier-locks.ts, the one rule every
      // asset_identifiers writer follows.
      await lockIdentifierScope(tx, { assetIds: [data.assetId], tagValues: [data.identifierValue] });

      // Only one identifier per entity. 2026-10-05: re-tagging is a real field
      // operation (a damaged or lost tag, or a tag scanned onto the wrong filter
      // during commissioning). The operator used to be refused with "already has
      // an identifier" and had to find the Remove button first — on 2026-10-05
      // four refusals in 15 s on one filter. With `replaceExisting` the tag the
      // filter holds is released in the SAME transaction as the new binding,
      // audited as ASSET_IDENTIFIER_DELETED whose reason names the new tag, so
      // the RFID Track Record shows REMOVE then ASSIGN. Without the flag the
      // refusal stands: both UIs send it only after a confirm step.
      const existingForAsset = await tx.assetIdentifier.findMany({ where: { assetId: data.assetId }, orderBy: { createdAt: 'desc' } });
      const sameTagAlreadyHere = existingForAsset.find((i) => sameValue(i.identifierValue, data.identifierValue));
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

      // C-07: an RFID duplicate is found case-insensitively, so a lower-case row
      // stored before canonical writes still conflicts with its upper-case scan.
      const existingIdent = isRfid
        ? await tx.assetIdentifier.findFirst({ where: { identifierValue: { equals: data.identifierValue, mode: 'insensitive' } } })
        : await tx.assetIdentifier.findUnique({ where: { identifierValue: data.identifierValue } });
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
        const holder = await tx.assetInstance.findUnique({ where: { id: existingIdent.assetId }, select: { name: true, status: true, isActive: true } });
        const holderGone = !holder || holder.status === 'Retired' || holder.isActive === false;
        if (!holderGone) throw new ConflictError('Identifier value already exists on another entity', 'DUPLICATE_IDENTIFIER_VALUE');
        released = { id: existingIdent.id, assetId: existingIdent.assetId, identifierType: existingIdent.identifierType, identifierValue: existingIdent.identifierValue, holderName: holder?.name ?? null };
      }

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
      const row = await tx.assetIdentifier.create({
        data: {
          assetId: data.assetId,
          identifierType: data.identifierType,
          identifierValue: data.identifierValue,
          label: data.label,
          isPrimary: data.isPrimary,
          createdBy: ctx.userId,
        },
      });

      // Inside the transaction (D-DB-2, 2026-10-22): written after commit, a
      // failed audit write left a binding with no ASSET_IDENTIFIER_CREATED row.
      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole,
        action: 'ASSET_IDENTIFIER_CREATED',
        targetType: 'asset_identifier',
        targetId: row.id,
        // Store the filter name alongside the identifier so the audit row is
        // self-describing (targetId is the identifier UUID, not the filter, so the
        // audit UI cannot resolve the filter name at render time). identifierValue
        // is already on `identifier` — the template renders it as the RFID tag.
        afterValue: { ...row, filterName: asset.name },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      }, tx);
      return row;
    });

    return identifier;
  },

  async delete(id: string, ctx: RequestContext, reason?: string | null) {
    const found = await identifierRepository.findById(id);
    if (!found) throw new NotFoundError('Identifier not found');

    // Resolve the filter name for a self-describing audit row (targetId is the
    // identifier UUID, so the audit UI can't look up the filter at render time).
    const asset = await instanceRepository.findByIdSimple(found.assetId);

    // P4 (2026-06-03): capture an optional removal reason so the RFID Track
    // Record report can show WHY a tag was removed (audit_trail.reason).
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';

    // D-DB-2 (2026-10-22): the same filter-then-tag locks as create(), so a
    // removal and a concurrent replace / re-assignment of this tag run one after
    // the other instead of both deleting the row (the loser answered 404). The
    // row is re-read under the lock; the audit row commits with the delete.
    await prisma.$transaction(async (tx) => {
      await lockIdentifierScope(tx, { assetIds: [found.assetId], tagValues: [found.identifierValue] });
      const existing = await tx.assetIdentifier.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Identifier not found');
      await tx.assetIdentifier.delete({ where: { id } });
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
      }, tx);
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
    // Audit 2026-09-24 (A-F1): an unparsable date became `Invalid Date` → Prisma
    // validation error → 500 + a SYSTEM_ERROR notification, for every role. A
    // bare date is the local day at both ends (lib/date-range-guard.ts); the page
    // sends a bare `from`, which was UTC midnight (2026-10-23).
    const fromD = query.from ? rangeStartOrThrow(query.from, 'from') : undefined;
    const toD = query.to ? rangeEndOrThrow(query.to, 'to') : undefined;

    // M10 (QA 2026-10-19): this used to read EVERY assign/remove audit row (full
    // width, incl. before/after JSON) into memory on each request and filter /
    // page in Node, so a page of 25 cost the whole history. The same filters now
    // run in SQL, which returns the total and only the ids of the requested page;
    // the enrichment below is unchanged and runs for that page only. Semantics
    // kept exactly: RFID-type rows with a value; case-insensitive "contains" on
    // RFID / filter name / AHU name / user (user = audit userName, else the
    // username of a UUID userId, else the raw userId); newest first; an omitted
    // limit still returns ALL rows (2026-07-03 user decision).
    const like = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const conds: Prisma.Sql[] = [];
    if (query.rfid) conds.push(Prisma.sql`lower(coalesce(x.rfid, '')) LIKE ${like(query.rfid)}`);
    if (query.filterName) conds.push(Prisma.sql`lower(coalesce(x.filter_name, '')) LIKE ${like(query.filterName)}`);
    if (query.ahu) conds.push(Prisma.sql`lower(coalesce(x.ahu_name, '')) LIKE ${like(query.ahu)}`);
    if (query.user) conds.push(Prisma.sql`lower(coalesce(x.uname, '')) LIKE ${like(query.user)}`);
    const filterSql = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const base = Prisma.sql`
      WITH ev AS (
        SELECT a.id, a.timestamp, a.user_id, a.user_name,
               CASE WHEN a.action = 'ASSET_IDENTIFIER_CREATED' THEN a.after_value ELSE a.before_value END AS v
          FROM audit_trail a
         WHERE a.action IN ('ASSET_IDENTIFIER_CREATED', 'ASSET_IDENTIFIER_DELETED')
           ${fromD ? Prisma.sql`AND a.timestamp >= ${fromD}` : Prisma.empty}
           ${toD ? Prisma.sql`AND a.timestamp <= ${toD}` : Prisma.empty}
      ), x AS (
        SELECT ev.id, ev.timestamp, ev.v->>'identifierValue' AS rfid, f.name AS filter_name, p.name AS ahu_name,
               coalesce(nullif(ev.user_name, ''), u.username, ev.user_id) AS uname
          FROM ev
          LEFT JOIN asset_instances f ON f.id::text = ev.v->>'assetId'
          LEFT JOIN asset_instances p ON p.id = f.parent_id
          LEFT JOIN users u ON u.id::text = ev.user_id
         WHERE ev.v->>'identifierType' = 'RFID' AND coalesce(ev.v->>'identifierValue', '') <> ''
      )`;
    const [{ total: totalBig }] = await prisma.$queryRaw<Array<{ total: bigint }>>`${base} SELECT count(*)::bigint AS total FROM x ${filterSql}`;
    const page = query.page ?? 1;
    const limit = query.limit;
    const idRows = await prisma.$queryRaw<Array<{ id: string }>>`${base}
      SELECT x.id FROM x ${filterSql} ORDER BY x.timestamp DESC, x.id DESC
      ${limit ? Prisma.sql`LIMIT ${limit} OFFSET ${(page - 1) * limit}` : Prisma.empty}`;
    const pageIds = idRows.map((r) => r.id);
    const order = new Map(pageIds.map((id, i) => [id, i]));
    const rows = pageIds.length
      ? (await prisma.auditTrail.findMany({ where: { id: { in: pageIds } } })).sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      : [];

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

    const enriched = events.map((e) => {
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

    // Filtering and paging happened in SQL (M10). 2026-07-03: RFID identifier
    // list uncapped per user request — an omitted limit returns ALL rows.
    const total = Number(totalBig);
    return { data: enriched, total, page, limit: limit ?? total, totalPages: limit ? Math.ceil(total / limit) : 1 };
  },
};
