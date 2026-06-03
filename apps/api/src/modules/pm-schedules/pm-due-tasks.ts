/**
 * PM Schedules — My Tasks "due now / overdue" computation.
 *
 * Pure read path: pulls every PM schedule entry whose tolerance window
 * contains `now` (active) or whose window closed in the last 30 days
 * (overdue), groups them by AHU, and decorates each AHU with its child
 * filters and per-filter cleaning status. Used by the My Tasks page.
 *
 * Logic and behaviour are intentionally untouched during the module split
 * — this file is a verbatim move of `PmScheduleService.getDueTasks`.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { checkPmEnabled } from './pm-shared.js';
import { getDeviationContextForEntries } from './pm-deviations.js';
import type { DueFilterRow, DueFilterStatus, DueOverallStatus, DueTaskRow } from './pm-types.js';

export async function getDueTasks(_ctx: RequestContext) {
  await checkPmEnabled();

  // Load the PM schedule settings (default tolerance isn't relevant here —
  // only visibility mode and the overdue-section toggle).
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
  const settings = (cfg?.configValue as any) ?? {};
  const taskVisibility: string = settings.taskVisibility ?? 'GLOBAL';
  const showOverdueSeparately: boolean = settings.showOverdueSeparately ?? true;

  // Only GLOBAL is wired up in v1. PER_USER and ROLE_GATED are config
  // slots that we return a clear 501 for until they're built.
  if (taskVisibility !== 'GLOBAL') {
    throw new AppError(
      501,
      'NOT_IMPLEMENTED',
      `Task visibility mode "${taskVisibility}" is not yet implemented — only GLOBAL is supported in v1`,
    );
  }

  const now = new Date();
  // Overdue horizon: don't return entries whose window closed more than
  // 30 days ago — avoids serving years of stale history on every request.
  const overdueHorizon = new Date(now.getTime() - 30 * 86400000);

  // Fetch candidate entries (in window OR recently overdue) — only APPROVED entries
  const entries = await prisma.pmScheduleEntry.findMany({
    where: {
      schedule: { status: 'ACTIVE' },
      approvalStatus: 'APPROVED',
      OR: [
        { AND: [{ windowStart: { lte: now } }, { windowEnd: { gte: now } }] },
        { AND: [{ windowEnd: { lt: now } }, { windowEnd: { gte: overdueHorizon } }] },
      ],
    },
    include: { schedule: true },
    orderBy: { plannedDate: 'asc' },
  });

  if (entries.length === 0) {
    return { tasks: [], overdue: [], settings: { showOverdueSeparately } };
  }

  // Deduplicate AHU lookups — multiple entries can share the same AHU.
  // customAttributes.pmFilterSetMode is the per-AHU knob added in the
  // filter-set config UI: BOTH / SET_A / SET_B / DISABLED (default BOTH).
  const ahuIds = Array.from(new Set(entries.map(e => e.schedule.entityId)));
  const ahus = await prisma.assetInstance.findMany({
    where: { id: { in: ahuIds } },
    select: { id: true, name: true, customAttributes: true, parentId: true },
  });
  const ahuById = new Map(ahus.map(a => [a.id, a]));

  // Resolve the AHU → Area → Block hierarchy for the My Tasks block/area
  // filters. Depth VARIES — some AHUs sit directly under a BLOCK (no AREA),
  // others under an AREA under a BLOCK — so walk the full parent chain and
  // classify each ancestor by template kind rather than assuming a fixed depth.
  // (A fixed 2-level walk dropped the block for every directly-parented AHU,
  // which is why some blocks were missing from the filter.) BLOCK entities are
  // always top-level; AREA sits between.
  type Anc = { id: string; name: string; parentId: string | null; kind: string | null };
  const ancestors = new Map<string, Anc>();
  let frontier = ahus.map(a => a.parentId).filter((p): p is string => !!p);
  let guard = 0;
  while (frontier.length && guard++ < 10) {
    const ids = [...new Set(frontier.filter(id => !ancestors.has(id)))];
    if (ids.length === 0) break;
    const rows = await prisma.assetInstance.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, parentId: true, template: { select: { templateKind: true } } },
    });
    for (const r of rows) {
      ancestors.set(r.id, { id: r.id, name: r.name, parentId: r.parentId, kind: r.template?.templateKind ?? null });
    }
    frontier = rows.map(r => r.parentId).filter((p): p is string => !!p);
  }

  const resolveBlockArea = (ahuParentId: string | null) => {
    let block: { id: string; name: string } | null = null;
    let area: { id: string; name: string } | null = null;
    let topmost: Anc | null = null;
    let cur = ahuParentId ? ancestors.get(ahuParentId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      topmost = cur;
      if (cur.kind === 'BLOCK' && !block) block = { id: cur.id, name: cur.name };
      else if (cur.kind === 'AREA' && !area) area = { id: cur.id, name: cur.name };
      cur = cur.parentId ? ancestors.get(cur.parentId) : undefined;
    }
    // Fallback: no explicit BLOCK kind in the chain → treat the topmost ancestor
    // as the block so every task still groups under something.
    if (!block && topmost) block = { id: topmost.id, name: topmost.name };
    return { block, area };
  };

  // Bulk-fetch all child filters for all AHUs in one query.
  // filterSet lives on FilterDetails (Step 6) — include + flatten.
  const allChildFiltersRaw = await prisma.assetInstance.findMany({
    where: {
      parentId: { in: ahus.map(a => a.id) },
      isActive: true,
      status: { not: 'Retired' },
    },
    select: { id: true, name: true, parentId: true, filterDetails: { select: { filterSet: true } } },
  });
  const allChildFilters = allChildFiltersRaw.map(f => ({
    id: f.id, name: f.name, parentId: f.parentId,
    filterSet: f.filterDetails?.filterSet ?? null,
  }));
  const filtersByAhu = new Map<string, typeof allChildFilters>();
  for (const f of allChildFilters) {
    if (!f.parentId) continue;
    if (!filtersByAhu.has(f.parentId)) filtersByAhu.set(f.parentId, []);
    filtersByAhu.get(f.parentId)!.push(f);
  }

  // Bulk-fetch the latest cleaning cycle for every involved filter
  // (we take the 5 most recent per filter to also catch "in window"
  // cycles that aren't strictly the latest).
  const filterIds = allChildFilters.map(f => f.id);
  const recentCycles = filterIds.length
    ? await prisma.cleaningCycle.findMany({
        where: { filterId: { in: filterIds } },
        orderBy: [{ filterId: 'asc' }, { startedAt: 'desc' }],
      })
    : [];
  const cyclesByFilter = new Map<string, typeof recentCycles>();
  for (const c of recentCycles) {
    if (!cyclesByFilter.has(c.filterId)) cyclesByFilter.set(c.filterId, []);
    cyclesByFilter.get(c.filterId)!.push(c);
  }

  // Build result rows (types live in pm-types.ts)
  const active: DueTaskRow[] = [];
  const overdue: DueTaskRow[] = [];

  for (const entry of entries) {
    const ahu = ahuById.get(entry.schedule.entityId);
    if (!ahu) continue;

    // Read the per-AHU filter-set mode. Default is BOTH (count everything).
    const ahuAttrs = (ahu.customAttributes as any) ?? {};
    const mode: 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED' = (
      ahuAttrs.pmFilterSetMode === 'SET_A' || ahuAttrs.pmFilterSetMode === 'SET_B' || ahuAttrs.pmFilterSetMode === 'DISABLED'
        ? ahuAttrs.pmFilterSetMode
        : 'BOTH'
    );

    // DISABLED: skip this AHU entirely — the task does not appear in My Tasks
    // or in the Overdue section, even if its window is open.
    if (mode === 'DISABLED') continue;

    let childFilters = filtersByAhu.get(ahu.id) ?? [];

    // SET_A / SET_B: narrow the filter list to that set. Filters with a null
    // filterSet are excluded in this mode — they explicitly belong to no set.
    if (mode === 'SET_A') {
      childFilters = childFilters.filter(f => f.filterSet === 'SET_A');
    } else if (mode === 'SET_B') {
      childFilters = childFilters.filter(f => f.filterSet === 'SET_B');
    }

    const inWindow = now >= entry.windowStart && now <= entry.windowEnd;

    const filterStatuses: DueFilterRow[] = childFilters.map(f => {
      const cycles = cyclesByFilter.get(f.id) ?? [];
      // Prefer an IN_PROGRESS cycle started before or during the window
      const inProgress = cycles.find(c =>
        c.status === 'IN_PROGRESS' && c.startedAt <= entry.windowEnd,
      );
      // Otherwise the most recent cycle that completed within the window
      const cleanedInWindow = cycles.find(c =>
        c.completedAt != null
        && c.completedAt >= entry.windowStart
        && c.completedAt <= entry.windowEnd,
      );

      let status: DueFilterStatus = 'pending';
      if (cleanedInWindow) status = 'cleaned_in_window';
      else if (inProgress) status = 'in_progress';

      return {
        filterId: f.id,
        filterName: f.name,
        status,
        lastCycleCompletedAt: cleanedInWindow?.completedAt ?? cycles[0]?.completedAt ?? null,
      };
    });

    const cleanedCount = filterStatuses.filter(s => s.status === 'cleaned_in_window').length;
    const inProgressCount = filterStatuses.filter(s => s.status === 'in_progress').length;
    const totalFilters = filterStatuses.length;

    let overallStatus: DueOverallStatus;
    if (inWindow) {
      if (totalFilters > 0 && cleanedCount === totalFilters) overallStatus = 'complete';
      else if (cleanedCount + inProgressCount > 0) overallStatus = 'in_progress';
      else overallStatus = 'pending';
    } else {
      // Window already closed
      if (totalFilters > 0 && cleanedCount === totalFilters) continue; // hide — all done
      overallStatus = 'overdue';
    }

    const { block, area } = resolveBlockArea(ahu.parentId);

    const row: DueTaskRow = {
      entryId: entry.id,
      ahuId: ahu.id,
      ahuName: ahu.name,
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      blockId: block?.id ?? null,
      blockName: block?.name ?? null,
      plannedDate: entry.plannedDate,
      toleranceDays: entry.toleranceDays,
      windowStart: entry.windowStart,
      windowEnd: entry.windowEnd,
      totalFilters,
      cleanedCount,
      overallStatus,
      filters: filterStatuses,
    };

    if (overallStatus === 'overdue') overdue.push(row);
    else active.push(row);
  }

  // Read-only join: attach the open deviation (if any) for each entry so My
  // Tasks can render "overdue by N days" + the acknowledged state + the
  // deviation id to acknowledge against. No writes here — the sweep (cron /
  // manual endpoint) is the only thing that creates/mutates deviations.
  const allRows = [...active, ...overdue];
  if (allRows.length) {
    const ctxMap = await getDeviationContextForEntries(allRows.map((r) => r.entryId));
    for (const r of allRows) r.deviation = ctxMap.get(r.entryId) ?? null;
  }

  return {
    tasks: active,
    overdue: showOverdueSeparately ? overdue : [],
    settings: { showOverdueSeparately },
  };
}
