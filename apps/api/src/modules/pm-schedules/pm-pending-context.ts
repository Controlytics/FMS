/**
 * PM Schedules — "what PM tasks are open for this AHU right now?"
 *
 * PM tasks STACK: an unmet August entry does not stop September's from being
 * generated, so an operator can walk up to an AHU with an older task still
 * open. Before a PM cleaning starts, both the client (to raise the right
 * dialog) and the server (to enforce it) need the same answer:
 *
 *   currentEntry    — the entry whose tolerance window contains today, if any.
 *   overdueEntries  — APPROVED entries whose window has CLOSED, not yet
 *                     satisfied and not yet written off. These are what the
 *                     operator must account for.
 *
 * An entry stops being "overdue" here once it is resolved either way:
 *   - performed late  → a cleaning BOUND to it completed (`cycleCreditsEntry`),
 *   - written off     → `skippedAt` set with a recorded justification.
 *
 * Read-only. Nothing here writes; the gate in `start-cycle.ts` does the writing.
 */
import { prisma } from '../../lib/prisma.js';
import { resolvePmReasonKeys } from './pm-shared.js';

/** How far back to look for unresolved tasks — mirrors the deviation sweep. */
const OVERDUE_HORIZON_DAYS = 90;
const DAY = 86400000;

export interface PendingPmEntry {
  entryId: string;
  ahuId: string;
  ahuName: string;
  plannedDate: Date;
  windowStart: Date;
  windowEnd: Date;
  overdueDays: number;
  deviationId: string | null;
  deviationNumber: string | null;
}

export interface AhuPendingContext {
  ahuId: string;
  ahuName: string;
  /** Entry due right now, if any — what a normal PM cleaning is performed for. */
  currentEntry: Omit<PendingPmEntry, 'overdueDays' | 'deviationId' | 'deviationNumber'> | null;
  /** Unresolved past-due entries, oldest first. */
  overdueEntries: PendingPmEntry[];
}

/** Resolve the AHU a filter hangs under. Returns null for an unparented filter. */
export async function resolveAhuForFilter(filterId: string): Promise<{ id: string; name: string } | null> {
  const filter = await prisma.assetInstance.findUnique({
    where: { id: filterId },
    select: { parent: { select: { id: true, name: true } } },
  });
  return filter?.parent ?? null;
}

export async function getAhuPendingContext(ahuId: string, ahuName: string): Promise<AhuPendingContext> {
  const now = new Date();
  const horizon = new Date(now.getTime() - OVERDUE_HORIZON_DAYS * DAY);
  const pmReasonKeys = await resolvePmReasonKeys();

  const entries = await prisma.pmScheduleEntry.findMany({
    where: {
      schedule: { status: 'ACTIVE', entityId: ahuId },
      approvalStatus: 'APPROVED',
      // Already written off with a justification → resolved, not pending.
      skippedAt: null,
      OR: [
        { AND: [{ windowStart: { lte: now } }, { windowEnd: { gte: now } }] },       // due now
        { AND: [{ windowEnd: { lt: now } }, { windowEnd: { gte: horizon } }] },      // overdue
      ],
    },
    orderBy: { plannedDate: 'asc' },
  });
  if (entries.length === 0) {
    return { ahuId, ahuName, currentEntry: null, overdueEntries: [] };
  }

  // Which counted filters hang under this AHU decides whether a task can be
  // "satisfied" at all — mirrors pm-due-tasks / pm-deviations (an AHU set to
  // DISABLED has no PM obligation, so nothing is pending for it).
  const ahu = await prisma.assetInstance.findUnique({
    where: { id: ahuId },
    select: { customAttributes: true },
  });
  const attrs = (ahu?.customAttributes as any) ?? {};
  const mode: string = ['SET_A', 'SET_B', 'DISABLED'].includes(attrs.pmFilterSetMode) ? attrs.pmFilterSetMode : 'BOTH';
  if (mode === 'DISABLED') {
    return { ahuId, ahuName, currentEntry: null, overdueEntries: [] };
  }

  const childRaw = await prisma.assetInstance.findMany({
    where: { parentId: ahuId, isActive: true, status: { not: 'Retired' } },
    select: { id: true, filterDetails: { select: { filterSet: true } } },
  });
  const filterIds = childRaw
    .filter((f) => mode === 'BOTH' || f.filterDetails?.filterSet === mode)
    .map((f) => f.id);

  const past = entries.filter((e) => e.windowEnd < now);
  const current = entries.find((e) => e.windowStart <= now && e.windowEnd >= now) ?? null;

  // An overdue entry is resolved when every counted filter has a cleaning BOUND
  // to that entry. Unbound cleans cannot resolve a closed window (see
  // cycleCreditsEntry), so only the binding is checked here.
  const unresolved: typeof past = [];
  for (const e of past) {
    if (filterIds.length === 0) continue; // nothing to clean → nothing pending
    const done = await prisma.cleaningCycle.groupBy({
      by: ['filterId'],
      where: {
        filterId: { in: filterIds }, status: 'COMPLETED',
        pmScheduleEntryId: e.id,
        completedAt: { gte: e.windowStart },
        ...(pmReasonKeys ? { cleaningReasonKey: { in: [...pmReasonKeys] } } : {}),
      },
      _max: { completedAt: true },
    });
    const covered = new Set(done.map((d) => d.filterId));
    if (!filterIds.every((id) => covered.has(id))) unresolved.push(e);
  }

  const deviations = unresolved.length
    ? await prisma.deviation.findMany({
        where: { pmScheduleEntryId: { in: unresolved.map((e) => e.id) } },
        select: { id: true, deviationNumber: true, pmScheduleEntryId: true },
      })
    : [];
  const devByEntry = new Map(deviations.map((d) => [d.pmScheduleEntryId, d]));

  return {
    ahuId,
    ahuName,
    currentEntry: current
      ? {
          entryId: current.id, ahuId, ahuName,
          plannedDate: current.plannedDate, windowStart: current.windowStart, windowEnd: current.windowEnd,
        }
      : null,
    overdueEntries: unresolved.map((e) => ({
      entryId: e.id, ahuId, ahuName,
      plannedDate: e.plannedDate, windowStart: e.windowStart, windowEnd: e.windowEnd,
      overdueDays: Math.max(0, Math.floor((now.getTime() - e.plannedDate.getTime()) / DAY)),
      deviationId: devByEntry.get(e.id)?.id ?? null,
      deviationNumber: devByEntry.get(e.id)?.deviationNumber ?? null,
    })),
  };
}

/** Convenience for the operations surfaces, which hold a filter id, not an AHU id. */
export async function getPendingContextForFilter(filterId: string): Promise<AhuPendingContext | null> {
  const ahu = await resolveAhuForFilter(filterId);
  if (!ahu) return null;
  return getAhuPendingContext(ahu.id, ahu.name);
}

/**
 * Site-wide map of AHUs that still owe an earlier PM.
 *
 * Exists for the tablet: it caches this alongside its blocked-filter set so an
 * OFFLINE operator is still asked for a reason before cleaning. Without it the
 * gate would be online-only, and since offline replay is exempt from the
 * server-side check (the answer rides in the queued payload), an offline PM
 * cleaning would slip past unasked.
 *
 * Returns only AHUs with something outstanding, so the payload stays small.
 */
export async function getPendingTasksMap(): Promise<Record<string, PendingPmEntry[]>> {
  const now = new Date();
  const horizon = new Date(now.getTime() - OVERDUE_HORIZON_DAYS * DAY);

  // Candidate AHUs = those with an APPROVED, un-skipped entry whose window has
  // closed inside the horizon. Cheap pre-filter before the per-AHU work.
  const candidates = await prisma.pmScheduleEntry.findMany({
    where: {
      schedule: { status: 'ACTIVE' },
      approvalStatus: 'APPROVED',
      skippedAt: null,
      windowEnd: { lt: now, gte: horizon },
    },
    select: { schedule: { select: { entityId: true } } },
  });
  const ahuIds = [...new Set(candidates.map((c) => c.schedule.entityId))];
  if (ahuIds.length === 0) return {};

  const ahus = await prisma.assetInstance.findMany({
    where: { id: { in: ahuIds } },
    select: { id: true, name: true },
  });

  const out: Record<string, PendingPmEntry[]> = {};
  for (const a of ahus) {
    const ctx = await getAhuPendingContext(a.id, a.name);
    if (ctx.overdueEntries.length > 0) out[a.id] = ctx.overdueEntries;
  }
  return out;
}
