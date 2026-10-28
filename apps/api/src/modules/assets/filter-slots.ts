/**
 * Filter SLOTS: when a filter's place in its AHU began, and which filters held
 * that place before it (operator rule 2026-10-26, "Qty follows the AHU").
 *
 * A replacement schedule row and a PM visit cover the AHU's filters. Which
 * filters, once filters come and go, is ONE rule for both:
 *
 *  - a filter ADDED to the AHU (created, moved in, restored) joins it then, and
 *    counts only once APPROVED — the later of the two;
 *  - a filter made by a REPLACEMENT takes the old filter's place: it inherits the
 *    old filter's join time, so a replacement never changes a row's Qty or
 *    reopens a visit (the FILTER_REPLACED audit rows hold the old → new links,
 *    the same links `creditedFiltersByEntry` follows forward);
 *  - a filter RETIRED or DELETED is simply no longer counted.
 *
 * `settleMembers` then decides an entry's members: the slots that joined before
 * its window closed AND before it was complete. A finished entry and an overdue
 * one take no new filters; a removed filter leaves either.
 *
 * Limits (documented, not hidden): a redacted FILTER_REPLACED row has no payload,
 * so that link is lost and the new filter counts from its own creation; a
 * filter whose micron size is edited later is matched on its micron today.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/** A relationship written this long after the filter itself means it was moved in (or restored) later. */
const MOVED_IN_AFTER_MS = 60_000;
const MAX_LINEAGE_DEPTH = 100;

export interface SlotFilter { id: string; parentId: string | null; createdAt: Date; approvedAt: Date | null }

export interface FilterSlot {
  /** When this filter's place in the AHU began (see the module comment). */
  joinedAt: Date;
  /** This filter, then the filters it replaced, newest first. */
  lineage: string[];
}

const later = (a: Date, b: Date | null | undefined) => (b && b > a ? b : a);

/**
 * The slot of each filter given. `since`: links are followed back only for
 * filters created on/after it — an older filter's place began before `since`,
 * and its predecessors were retired before it, so neither the join time nor a
 * predecessor's cleaning can matter to a window or credit at/after `since`.
 */
export async function loadFilterSlots(filters: SlotFilter[], since: Date): Promise<Map<string, FilterSlot>> {
  const out = new Map<string, FilterSlot>();
  if (filters.length === 0) return out;

  // AHU → filter CONTAINS row: written when a filter is moved in or restored (and
  // by some create paths, in the same transaction as the filter).
  const withParent = filters.filter((f) => f.parentId);
  const rels = withParent.length
    ? await prisma.assetRelationship.findMany({
        where: { relationshipType: 'CONTAINS', targetAssetId: { in: withParent.map((f) => f.id) } },
        select: { sourceAssetId: true, targetAssetId: true, createdAt: true },
      })
    : [];
  const relAt = new Map<string, Date>();
  for (const r of rels) {
    const f = withParent.find((x) => x.id === r.targetAssetId);
    if (f && f.parentId === r.sourceAssetId) relAt.set(f.id, r.createdAt);
  }
  const movedInAt = (f: SlotFilter): Date | null => {
    const at = relAt.get(f.id);
    return at && at.getTime() - f.createdAt.getTime() > MOVED_IN_AFTER_MS ? at : null;
  };

  // new filter → the filter it replaced, walked back from the recent filters.
  const pred = new Map<string, string>();
  const rows = new Map<string, SlotFilter>(filters.map((f) => [f.id, f]));
  let frontier = filters.filter((f) => f.createdAt >= since && !movedInAt(f)).map((f) => f.id);
  for (let depth = 0; frontier.length > 0 && depth < MAX_LINEAGE_DEPTH; depth++) {
    const links = await prisma.$queryRaw<Array<{ old_id: string; new_id: string }>>`
      SELECT target_id AS old_id, after_value->>'newFilterId' AS new_id
      FROM audit_trail
      WHERE action = 'FILTER_REPLACED' AND target_type = 'filter'
        AND after_value->>'newFilterId' IN (${Prisma.join(frontier)})
      ORDER BY chain_position ASC`;
    const found: string[] = [];
    for (const l of links) {
      if (!l.old_id || !l.new_id || pred.has(l.new_id)) continue;
      pred.set(l.new_id, l.old_id);
      if (!rows.has(l.old_id)) found.push(l.old_id);
    }
    if (found.length === 0) break;
    const olds = await prisma.assetInstance.findMany({
      where: { id: { in: found } },
      select: { id: true, parentId: true, createdAt: true, approvedAt: true },
    });
    for (const o of olds) rows.set(o.id, o);
    frontier = olds.filter((o) => o.createdAt >= since).map((o) => o.id);
  }

  const joined = new Map<string, Date>();
  const joinedAt = (id: string, depth = 0): Date => {
    const known = joined.get(id);
    if (known) return known;
    const f = rows.get(id)!;
    const moved = movedInAt(f);
    const before = pred.get(id);
    const base = moved ?? (before && rows.has(before) && depth < MAX_LINEAGE_DEPTH ? joinedAt(before, depth + 1) : f.createdAt);
    const at = later(base, f.approvedAt);
    joined.set(id, at);
    return at;
  };
  for (const f of filters) {
    const lineage = [f.id];
    for (let id = f.id; pred.has(id) && !movedInAt(rows.get(id)!) && lineage.length <= MAX_LINEAGE_DEPTH;) {
      id = pred.get(id)!;
      if (!rows.has(id)) break;
      lineage.push(id);
    }
    out.set(f.id, { joinedAt: joinedAt(f.id), lineage });
  }
  return out;
}

/**
 * An entry's members, and when it was complete. `doneAt` is when a slot's work
 * for this entry was done (a replacement credited it; a PM cleaning since the
 * window opened), null while it is not.
 *
 *  - only slots that joined before the window CLOSED can belong to it: an
 *    overdue entry takes no new filters;
 *  - it is complete at the earliest moment every slot that had joined by then
 *    was done, and from then on its members are frozen: a filter added later does
 *    not reopen it.
 *
 * Pure. A slot that is no longer counted (retired, deleted) is simply not passed.
 */
export function settleMembers<T extends { joinedAt: Date; doneAt: Date | null }>(
  slots: T[],
  closesAt: Date,
): { members: T[]; completedAt: Date | null } {
  const eligible = slots.filter((s) => s.joinedAt < closesAt);
  // It can become complete when a slot's work is done, or when a slot whose work
  // was already done joins (a filter cleaned elsewhere, then moved in).
  const times = [...new Set(eligible.flatMap((s) => (s.doneAt ? [s.doneAt.getTime(), s.joinedAt.getTime()] : [])))].sort((a, b) => a - b);
  for (const t of times) {
    const joinedBy = eligible.filter((s) => s.joinedAt.getTime() <= t);
    if (joinedBy.length > 0 && joinedBy.every((s) => s.doneAt != null && s.doneAt.getTime() <= t)) {
      return { members: joinedBy, completedAt: new Date(t) };
    }
  }
  return { members: eligible, completedAt: null };
}
