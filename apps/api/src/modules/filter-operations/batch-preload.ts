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
 */
import { prisma } from '../../lib/prisma.js';
import type { BatchReadCache } from './batch-cache.js';

function seed(cache: BatchReadCache, key: string, value: unknown): void {
  void cache.memo(key, () => Promise.resolve(value));
}

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
