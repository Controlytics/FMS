/**
 * PM Schedules — shared helpers used across the split service modules.
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';

/**
 * Throws PM_DISABLED (404) if the `pm-schedule-settings` config key is not
 * marked enabled. Every public service entry point calls this first so the
 * module can be cleanly toggled off without leaking partial behaviour.
 */
export async function checkPmEnabled() {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
  const val = cfg?.configValue as any;
  if (!val?.enabled) throw new AppError(404, 'PM_DISABLED', 'PM scheduling module is not enabled');
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
/**
 * Does a cleaning cycle count toward THIS scheduled PM occurrence?
 *
 * PM tasks STACK: an unmet August entry does not stop September's from being
 * generated, so two open entries for one AHU is normal. Crediting by date
 * window alone then lets ONE cleaning satisfy BOTH — the September clean falls
 * after August's windowStart, so the old "late cleans count" rule credited it
 * to August too, closing two PM tasks and two deviations off a single job. That
 * records a preventive maintenance that never happened (21 CFR §11).
 *
 * The rule, in one place so `pm-due-tasks.ts` (My Tasks) and `pm-deviations.ts`
 * (the overdue sweep) cannot disagree — they describe the same fact on two
 * surfaces, and an inspector must not get two different stories:
 *
 *   BOUND to this entry   (`cycle.pmScheduleEntryId === entry.id`)
 *       → counts from windowStart with NO upper bound. This is the deliberate
 *         "perform the overdue PM late" path: the operator said which task they
 *         were doing, so a late completion resolves exactly that task.
 *
 *   BOUND to another entry
 *       → never counts here, not even inside this window.
 *
 *   UNBOUND (null — a normal cleaning, or any cycle predating this column)
 *       → counts only INSIDE [windowStart, windowEnd]. A clean that happened
 *         while the task was genuinely due satisfies it; one performed after
 *         the window shut does not, because nothing says it was this PM.
 *
 * Callers must have already filtered on the PM cleaning reason.
 */
export function cycleCreditsEntry(
  cycle: { pmScheduleEntryId?: string | null },
  entry: { id: string; windowStart: Date; windowEnd: Date },
  at: Date,
): boolean {
  const bound = cycle.pmScheduleEntryId ?? null;
  if (bound !== null) return bound === entry.id && at >= entry.windowStart;
  return at >= entry.windowStart && at <= entry.windowEnd;
}

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
