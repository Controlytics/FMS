/**
 * PM Schedules — shared helpers used across the split service modules.
 */
import { prisma } from '../../lib/prisma.js';
import { COUNTED_FILTER_WHERE } from '../assets/filter-workflow.js';
import { AppError } from '../../lib/errors.js';

/**
 * The `pm-schedule-settings` value, unwrapped. Every site stores it flat
 * (`{ enabled, ... }`), but a `{ value: {...} }` wrapper is accepted too, so
 * every reader goes through this ONE unwrap. The settings endpoint and the
 * module guard used to read it differently and could answer "enabled" and
 * "disabled" for the same row (D7, 2026-10-21). A missing row is `{}`.
 */
export async function readPmSettings(): Promise<Record<string, any>> {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
  const stored = row?.configValue as any;
  const inner = stored && typeof stored === 'object' && 'value' in stored ? stored.value : stored;
  return inner && typeof inner === 'object' ? inner : {};
}

/** The one "is PM on?" predicate. Off unless explicitly enabled — the def default is off. */
export function isPmEnabled(settings: Record<string, any>): boolean {
  return settings.enabled === true;
}

/**
 * Throws PM_DISABLED (404) if the `pm-schedule-settings` config key is not
 * marked enabled. Every public service entry point calls this first so the
 * module can be cleanly toggled off without leaking partial behaviour.
 */
export async function checkPmEnabled() {
  if (!isPmEnabled(await readPmSettings())) throw new AppError(404, 'PM_DISABLED', 'PM scheduling module is not enabled');
}

/**
 * A PM visit that is an obligation NOW: APPROVED, or an approved visit whose
 * date change is awaiting sign-off. Operator decision 2026-10-21 (D2): the
 * approved date stays in force until the change is approved, and a rejected
 * change leaves the visit approved on its original date. Before that, an edit
 * moved the entry to PENDING_* and every obligation surface (My Tasks, the
 * missed-PM gate, the sweep) silently dropped the visit.
 *
 * `pendingPlannedDate` marks the change: only editApprovedEntry sets it, and
 * only on an APPROVED entry; approve, reject and resubmit all clear it. The
 * status list keeps a REJECTED row with a stale pending date (left by review
 * rejects before D11) out.
 *
 * Use it as `AND: [PM_ENTRY_IN_FORCE]`: it carries an OR of its own, and a
 * spread would overwrite (or be overwritten by) a sibling OR such as My Tasks'
 * window filter.
 */
/**
 * The years a PM schedule may cover (P5R-01, 2026-10-22): one range for
 * POST / (route schema + service) and /visits (the year of `plannedDate`). POST /
 * took any integer, so `year: 1` made an ACTIVE schedule.
 */
export const PM_YEAR_MIN = 2000;
export const PM_YEAR_MAX = 2100;

export function assertPmYear(year: number): void {
  if (!Number.isInteger(year) || year < PM_YEAR_MIN || year > PM_YEAR_MAX) {
    throw new AppError(400, 'VALIDATION_ERROR', `The schedule year must be between ${PM_YEAR_MIN} and ${PM_YEAR_MAX}.`);
  }
}

/**
 * Only a live AHU can carry PM visits (P5R-01, 2026-10-22) — the ONE check for
 * POST / and /visits, and the same candidates the upload resolves AHU names
 * against. POST / never looked the entity up, so a random id got an ACTIVE
 * schedule. 404 NOT_FOUND for an unknown id, a non-AHU or a deactivated AHU.
 */
export async function assertLiveAhu(entityId: string): Promise<{ id: string; name: string }> {
  const ahu = await prisma.assetInstance.findFirst({
    where: { id: entityId, isActive: true, template: { templateKind: 'AHU' } },
    select: { id: true, name: true },
  });
  if (!ahu) throw new AppError(404, 'NOT_FOUND', 'AHU not found');
  return ahu;
}

export const PM_ENTRY_IN_FORCE = {
  OR: [
    { approvalStatus: 'APPROVED' as const },
    { pendingPlannedDate: { not: null }, approvalStatus: { in: ['PENDING', 'PENDING_REVIEW', 'PENDING_APPROVAL'] as ('PENDING' | 'PENDING_REVIEW' | 'PENDING_APPROVAL')[] } },
  ],
};

/** The same rule for an entry already in memory. */
export function isPmEntryInForce(e: { approvalStatus: string; pendingPlannedDate: Date | null }): boolean {
  return e.approvalStatus === 'APPROVED'
    || (e.pendingPlannedDate != null && ['PENDING', 'PENDING_REVIEW', 'PENDING_APPROVAL'].includes(e.approvalStatus));
}

export interface CountedAhu {
  ahuId: string;
  ahuName: string;
  mode: 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED';
  filters: { id: string; name: string }[];
}

/**
 * For the given AHU ids, resolve the per-AHU filter-set mode
 * (customAttributes.pmFilterSetMode) and the CHILD filters that count toward PM
 * completion. Mirrors pm-due-tasks.ts. Shared by the deviation sweep and the
 * missed-PM gate so the two cannot count different filters (D4a, 2026-10-21:
 * the gate used every sibling and ignored the mode).
 */
export async function loadCountedFilters(ahuIds: string[]): Promise<Map<string, CountedAhu>> {
  if (!ahuIds.length) return new Map();
  const [ahus, childRaw] = await Promise.all([
    prisma.assetInstance.findMany({
      where: { id: { in: ahuIds } },
      select: { id: true, name: true, customAttributes: true },
    }),
    prisma.assetInstance.findMany({
      // The one counted-filter predicate (filter-workflow.ts), shared with the AHU gate.
      where: { parentId: { in: ahuIds }, ...COUNTED_FILTER_WHERE },
      select: { id: true, name: true, parentId: true, filterDetails: { select: { filterSet: true } } },
    }),
  ]);
  const byAhu = new Map<string, { id: string; name: string; filterSet: string | null }[]>();
  for (const f of childRaw) {
    if (!f.parentId) continue;
    if (!byAhu.has(f.parentId)) byAhu.set(f.parentId, []);
    byAhu.get(f.parentId)!.push({ id: f.id, name: f.name, filterSet: f.filterDetails?.filterSet ?? null });
  }
  const out = new Map<string, CountedAhu>();
  for (const a of ahus) {
    const attrs = (a.customAttributes as any) ?? {};
    const mode: CountedAhu['mode'] =
      attrs.pmFilterSetMode === 'SET_A' || attrs.pmFilterSetMode === 'SET_B' || attrs.pmFilterSetMode === 'DISABLED'
        ? attrs.pmFilterSetMode
        : 'BOTH';
    let filters = byAhu.get(a.id) ?? [];
    if (mode === 'SET_A') filters = filters.filter((f) => f.filterSet === 'SET_A');
    else if (mode === 'SET_B') filters = filters.filter((f) => f.filterSet === 'SET_B');
    out.set(a.id, { ahuId: a.id, ahuName: a.name, mode, filters: filters.map((f) => ({ id: f.id, name: f.name })) });
  }
  return out;
}

/**
 * Resolve the configured PM cleaning-reason key(s) from
 * `system_config['filter-cleaning-reasons']`: any ACTIVE reason whose key or name
 * is "PM" (case-insensitive).
 *
 * Returns `null` when no PM reason is configured — there is then nothing that
 * distinguishes a scheduled PM from any other cleaning, so callers fall back to
 * the legacy "any completed cleaning counts" predicate rather than leaving every
 * PM task and deviation stuck forever. A non-null Set means "only a cleaning
 * performed with one of THESE reasons satisfies a scheduled PM".
 *
 * Single source of truth for both consumers — My Tasks (`pm-due-tasks.ts`) and
 * the overdue-deviation sweep (`pm-deviations.ts`). The two MUST agree: they
 * describe the same fact (did the scheduled PM happen?) on two surfaces, and
 * when they disagree the deviation record and the operator's task list tell an
 * inspector different stories. The sweep previously omitted this filter, so any
 * unrelated cleaning silently suppressed/closed an overdue-PM deviation.
 */
export async function resolvePmReasonKeys(): Promise<Set<string> | null> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
  const raw = cfg?.configValue as any;
  const list: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.value) ? raw.value : []);
  const keys = new Set<string>(
    list
      .filter((r: any) => r && r.isActive !== false && (
        (typeof r.key === 'string' && r.key.toUpperCase() === 'PM') ||
        (typeof r.name === 'string' && r.name.toUpperCase() === 'PM')
      ))
      .map((r: any) => r.key),
  );
  return keys.size > 0 ? keys : null;
}
