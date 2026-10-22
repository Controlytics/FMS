/**
 * Bulk pre-load for getBatchStates (2026-10-17 load test).
 *
 * M39 (batch-cache.ts) collapsed the SHARED reads of the per-filter fan-out to
 * one apiece, but six reads stayed per-filter — all primary-key lookups on
 * asset_instances / filter_details: getFilter's row, the `hb:` home-block walk
 * (filter + each ancestor, with template kind), the `parent:` and `attrs:`
 * projections the profile-assignment resolver walks. Measured on 3,038 filters:
 * 17,299 Prisma queries and ~7 s of main-thread CPU per batch call, 59 % of it
 * inside the Prisma client building and parsing those queries — while Postgres
 * itself needed under 1.4 s. Every tablet makes that call every 30 s.
 *
 * This loads the same rows for ALL filters (and their ancestor chain) in a
 * handful of findMany calls and seeds the batch memo under the exact keys and
 * projections getCurrentState already uses, so getCurrentState is unchanged and
 * its output byte-identical (D5 parity test). A row that is not found is simply
 * not seeded, so the memo misses and the original per-filter read runs as
 * before (404 semantics untouched).
 *
 * Projection rule (same as batch-cache.ts): a seeded value must have EXACTLY the
 * keys the memoised read's `select` would return — nothing extra — because two
 * call sites reading the same row with different selects use different keys.
 *
 * P-1 (2026-10-22): the reads of a filter that is IN A CYCLE are preloaded too.
 * The one-year copy had 2,928 of 3,038 filters mid-cycle and the call still made
 * 17,934 queries (6–7 s): per in-cycle filter the cycle row, its checklist/entry
 * events, an event count and the stage approval. Those keys encode every input
 * of the per-filter WHERE (filter, cycle, position), so a filter whose state
 * moved since the preload misses and reads as before. Unlike the rows above, an
 * empty answer IS seeded ([] / 0 / null): absence there means "none", and an
 * unseeded key would fall back to the per-filter query. (The equipment-group,
 * checklist-question and profile-name reads are shared rows; current-state.ts
 * memoises them per id.)
 */
import { prisma } from '../../lib/prisma.js';
import { PM_ENTRY_IN_FORCE } from '../pm-schedules/pm-shared.js';
import type { BatchReadCache } from './batch-cache.js';
import { getInterlockConfig, isInterlockStage } from './stage-interlock.js';

function seed(cache: BatchReadCache, key: string, value: unknown): void {
  void cache.memo(key, () => Promise.resolve(value));
}

/** current-state's cycle checklist/entry rows: CHECKLIST_COMPLETED, or entries into `position`. */
export const checklistRowsKey = (filterId: string, cycleId: string, position: string | null) =>
  `checklist-rows:${filterId}:${cycleId}:${JSON.stringify(position)}`;
/** current-state's event count for (filter, cycle) — the tapeVersion input. */
export const eventCountKey = (filterId: string, cycleId: string) => `event-count:${filterId}:${cycleId}`;
/** stage-interlock getLatestApproval(cycleId, stageKey). */
export const latestApprovalKey = (cycleId: string, stageKey: string) => `latest-approval:${cycleId}:${stageKey}`;

export async function preloadBatchReads(filterIds: string[], cache: BatchReadCache): Promise<void> {
  if (filterIds.length === 0) return;

  // getFilter() projection — `filter:<id>` (filter-resolver.ts).
  const filterRows = await prisma.assetInstance.findMany({
    where: { id: { in: filterIds } },
    select: {
      id: true, name: true, parentId: true,
      filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
    },
  });
  for (const row of filterRows) seed(cache, `filter:${row.id}`, row);

  await preloadCycleReads(filterRows, cache);
  await preloadPmDue(filterRows.filter((r) => !r.filterDetails?.currentCycleId).map((r) => r.parentId), cache);

  // The filters plus every ancestor (AHU → area → block), one level per query.
  // Superset select; projected down per key below.
  const nodes = new Map<string, { id: string; name: string; parentId: string | null; attributes: unknown; template: { templateKind: string } | null }>();
  let ids = filterIds;
  for (let depth = 0; ids.length > 0 && depth < 10; depth++) {
    const rows = await prisma.assetInstance.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, parentId: true, attributes: true, template: { select: { templateKind: true } } },
    });
    const next = new Set<string>();
    for (const r of rows) {
      nodes.set(r.id, r);
      if (r.parentId && !nodes.has(r.parentId)) next.add(r.parentId);
    }
    ids = [...next].filter((id) => !nodes.has(id));
  }
  for (const r of nodes.values()) {
    seed(cache, `hb:${r.id}`, { id: r.id, name: r.name, parentId: r.parentId, template: r.template });
    seed(cache, `parent:${r.id}`, { parentId: r.parentId });
    seed(cache, `attrs:${r.id}`, { attributes: r.attributes, parentId: r.parentId });
  }
}

type FilterRow = { id: string; filterDetails: { currentLifecycleState: string | null; currentCycleId: string | null } | null };

async function preloadCycleReads(filterRows: FilterRow[], cache: BatchReadCache): Promise<void> {
  const cycleIds = [...new Set(filterRows.map((r) => r.filterDetails?.currentCycleId).filter((id): id is string => !!id))];
  if (cycleIds.length === 0) return;

  // `cycle:<id>` — the full row, as current-state's findUnique returns it.
  const cycles = await prisma.cleaningCycle.findMany({ where: { id: { in: cycleIds } } });
  for (const c of cycles) seed(cache, `cycle:${c.id}`, c);
  const found = new Set(cycles.map((c) => c.id));

  // current-state reads these only when the cycle row exists.
  const pairs = filterRows
    .filter((r) => r.filterDetails?.currentCycleId && found.has(r.filterDetails.currentCycleId))
    .map((r) => ({ filterId: r.id, cycleId: r.filterDetails!.currentCycleId!, position: r.filterDetails!.currentLifecycleState ?? null }));
  if (pairs.length === 0) return;

  // Every event of each (filter, cycle) pair, probed per pair through the
  // (filter_id, cycle_id, …) index. An in-progress cycle holds a handful of
  // events (5,971 for 2,928 cycles on the one-year copy), and the two per-filter
  // reads are both answered from them: the count, and the checklist/entry rows.
  // NOT `cycle_id IN (…)`: with thousands of ids the planner sequential-scans all
  // of filter_events (6.2 M rows, 41–92 s measured — the P-4/P-5 shape); the
  // LATERAL probe is a nested loop of index scans (1.2 s cold, 50 ms warm).
  // `OFFSET 0` keeps the subquery from being flattened into a join the planner
  // could turn back into that scan.
  const events = await prisma.$queryRaw<Array<{
    filterId: string; cycleId: string; eventType: string; toState: string | null; performedAt: Date; attributes: unknown;
  }>>`
    SELECT p.filter_id AS "filterId", p.cycle_id AS "cycleId", e.event_type::text AS "eventType",
           e.to_state AS "toState", e.performed_at AS "performedAt", e.attributes
    FROM unnest(${pairs.map((p) => p.filterId)}::uuid[], ${pairs.map((p) => p.cycleId)}::uuid[]) AS p(filter_id, cycle_id)
    CROSS JOIN LATERAL (
      SELECT x.event_type, x.to_state, x.performed_at, x.attributes FROM filter_events x
      WHERE x.filter_id = p.filter_id AND x.cycle_id = p.cycle_id
      OFFSET 0
    ) e`;
  const eventsByPair = new Map<string, typeof events>();
  for (const e of events) {
    const k = `${e.filterId}:${e.cycleId}`;
    const list = eventsByPair.get(k);
    if (list) list.push(e); else eventsByPair.set(k, [e]);
  }
  for (const p of pairs) {
    const all = eventsByPair.get(`${p.filterId}:${p.cycleId}`) ?? [];
    // = count({ where: { filterId, cycleId } })
    seed(cache, eventCountKey(p.filterId, p.cycleId), all.length);
    // = findMany({ where: { filterId, cycleId, OR: [CHECKLIST_COMPLETED, toState = position] } }),
    // projected to its select. Order is irrelevant: every consumer is a set test.
    const rows = all
      .filter((e) => e.eventType === 'CHECKLIST_COMPLETED' || (!!p.position && e.toState === p.position))
      .map((e) => ({ eventType: e.eventType, toState: e.toState, performedAt: e.performedAt, attributes: e.attributes }));
    seed(cache, checklistRowsKey(p.filterId, p.cycleId, p.position), rows);
  }

  // Latest stage approval for a filter parked at a gated stage, in getLatestApproval's order.
  const interlock = await getInterlockConfig(cache);
  const gated = interlock.enabled ? pairs.filter((p) => isInterlockStage(p.position)) : [];
  if (gated.length > 0) {
    const approvals = await prisma.cleaningStageApproval.findMany({
      where: { cycleId: { in: [...new Set(gated.map((p) => p.cycleId))] } },
      orderBy: [{ attemptSeq: 'desc' }, { requestedAt: 'desc' }],
    });
    const latestByStage = new Map<string, (typeof approvals)[number]>();
    for (const a of approvals) {
      const k = latestApprovalKey(a.cycleId, a.stageKey);
      if (!latestByStage.has(k)) latestByStage.set(k, a); // rows arrive newest first
    }
    for (const p of gated) {
      const k = latestApprovalKey(p.cycleId, p.position as string);
      seed(cache, k, latestByStage.get(k) ?? null);
    }
  }
}

/** `pm-due:<ahuId>` — the AHU has a visit in force whose window holds now (current-state reads only presence). */
async function preloadPmDue(parentIds: Array<string | null>, cache: BatchReadCache): Promise<void> {
  const ahuIds = [...new Set(parentIds.filter((id): id is string => !!id))];
  if (ahuIds.length === 0) return;
  const now = new Date();
  const due = await prisma.pmScheduleEntry.findMany({
    where: {
      schedule: { entityId: { in: ahuIds }, status: 'ACTIVE' },
      AND: [PM_ENTRY_IN_FORCE],
      windowStart: { lte: now },
      windowEnd: { gte: now },
    },
    orderBy: { plannedDate: 'asc' },
    select: { id: true, schedule: { select: { entityId: true } } },
  });
  const firstByAhu = new Map<string, { id: string }>();
  for (const e of due) if (!firstByAhu.has(e.schedule.entityId)) firstByAhu.set(e.schedule.entityId, { id: e.id });
  for (const ahuId of ahuIds) seed(cache, `pm-due:${ahuId}`, firstByAhu.get(ahuId) ?? null);
}
