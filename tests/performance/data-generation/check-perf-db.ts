/**
 * Post-seed sanity report for digilog_perf: row counts per table, synthetic
 * share, DB size, and invariant checks that the live perf API depends on.
 *
 *   cd apps/api && npx tsx ../../tests/performance/data-generation/check-perf-db.ts
 */
import { bootstrapPerfEnv, assertConnectedToPerf } from './perf-env.js';

bootstrapPerfEnv();
const { prisma } = await import('../../../apps/api/src/lib/prisma.js');
const { getPendingEarlierPmTasks } = await import('../../../apps/api/src/modules/pm-schedules/pm-pending-tasks.js');

const q = async (sql: string) => (await prisma.$queryRawUnsafe(sql)) as any[];
try {
  await assertConnectedToPerf(prisma);
  const tables = ['users', 'password_history', 'asset_instances', 'blocks', 'areas', 'ahus', 'filters', 'filter_details', 'asset_relationships',
    'asset_identifiers', 'equipment_groups', 'equipment_group_instruments', 'cleaning_cycles', 'filter_events', 'cleaning_stage_approvals',
    'pm_schedules', 'pm_schedule_entries', 'deviations', 'audit_trail', 'sessions', 'notifications'];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = Number((await q(`SELECT count(*)::bigint AS n FROM "${t}"`))[0].n);

  const synthetic = (await q(`
    SELECT (SELECT count(*) FROM users WHERE username LIKE 'perf_user_%')::int AS users,
           (SELECT count(*) FROM filters WHERE name LIKE 'PF-%')::int AS filters,
           (SELECT count(*) FROM ahus WHERE name LIKE 'PF-%')::int AS ahus,
           (SELECT count(*) FROM cleaning_cycles c JOIN filters f ON f.id = c.filter_id WHERE f.name LIKE 'PF-%')::int AS cycles,
           (SELECT count(*) FROM filter_events e JOIN filters f ON f.id = e.filter_id WHERE f.name LIKE 'PF-%')::int AS events,
           (SELECT min(c.started_at) FROM cleaning_cycles c JOIN filters f ON f.id = c.filter_id WHERE f.name LIKE 'PF-%') AS first_cycle,
           (SELECT max(c.started_at) FROM cleaning_cycles c JOIN filters f ON f.id = c.filter_id WHERE f.name LIKE 'PF-%') AS last_cycle`))[0];

  const checks: Record<string, unknown> = {};
  checks.inProgressPerFilterMax = (await q(`SELECT coalesce(max(n),0)::int AS m FROM (SELECT count(*) n FROM cleaning_cycles WHERE status='IN_PROGRESS' GROUP BY filter_id) x`))[0].m;
  checks.syntheticFilterStateMismatch = (await q(`
    SELECT count(*)::int AS n FROM filters f JOIN filter_details fd ON fd.asset_instance_id = f.id
    WHERE f.name LIKE 'PF-%' AND (fd.current_cycle_id IS NOT NULL OR fd.current_lifecycle_state IS DISTINCT FROM 'CLEANING_CYCLE_COMPLETED'
      OR f.attributes->>'lastCleaningDate' IS DISTINCT FROM (SELECT to_char(max(c.completed_at), 'YYYY-MM-DD') FROM cleaning_cycles c WHERE c.filter_id = f.id))
      AND EXISTS (SELECT 1 FROM cleaning_cycles c WHERE c.filter_id = f.id)`))[0].n;
  checks.typedMirrorMismatch = (await q(`SELECT count(*)::int AS n FROM filters f JOIN asset_instances a ON a.id = f.id WHERE f.name LIKE 'PF-%' AND (a.parent_id IS DISTINCT FROM f.ahu_id OR a.attributes IS DISTINCT FROM f.attributes)`))[0].n;
  checks.cyclesWithoutStartEvent = (await q(`SELECT count(*)::int AS n FROM cleaning_cycles c JOIN filters f ON f.id=c.filter_id WHERE f.name LIKE 'PF-%' AND NOT EXISTS (SELECT 1 FROM filter_events e WHERE e.cycle_id=c.id AND e.event_type='CYCLE_STARTED')`))[0].n;
  checks.dryInWithoutDryer = (await q(`SELECT count(*)::int AS n FROM cleaning_cycles c WHERE EXISTS (SELECT 1 FROM filter_events e WHERE e.cycle_id=c.id AND e.to_state='DRY_IN') AND (c.dryer_started_at IS NULL OR c.dryer_duration_minutes IS NULL)`))[0].n;
  checks.overlappingCyclesSameFilter = (await q(`
    SELECT count(*)::int AS n FROM (SELECT filter_id, started_at, completed_at, lag(completed_at) OVER (PARTITION BY filter_id ORDER BY started_at) AS prev_end
      FROM cleaning_cycles WHERE completed_at IS NOT NULL) x WHERE prev_end > started_at`))[0].n;
  checks.overlappingPmWindows = (await q(`
    SELECT count(*)::int AS n FROM (SELECT s.entity_id, e.window_start, lag(e.window_end) OVER (PARTITION BY s.entity_id ORDER BY e.planned_date) AS prev_end
      FROM pm_schedule_entries e JOIN pm_schedules s ON s.id = e.schedule_id JOIN ahus h ON h.id = s.entity_id WHERE h.name LIKE 'PF-%') x WHERE window_start <= prev_end`))[0].n;
  checks.deviations = await q(`SELECT status::text, closure_kind::text, count(*)::int AS n FROM deviations GROUP BY 1,2 ORDER BY 1,2`);

  // The app's own missed-PM gate on one filter per synthetic AHU: any hit would 409
  // a PM-reason start (PM_PREVIOUS_TASK_PENDING) and make the 03:00 sweep open deviations.
  const sample = await q(`SELECT DISTINCT ON (f.ahu_id) f.id FROM filters f WHERE f.name LIKE 'PF-%' ORDER BY f.ahu_id, f.name`);
  let pendingAhus = 0; const examples: unknown[] = [];
  for (const r of sample) {
    const p = await getPendingEarlierPmTasks(r.id);
    if (p.length) { pendingAhus++; if (examples.length < 3) examples.push(p.map(x => ({ ahu: x.ahuName, planned: x.plannedDate, overdueDays: x.overdueDays }))); }
  }
  checks.pmPendingEarlierTasks = { ahusChecked: sample.length, ahusWithPending: pendingAhus, examples };

  const size = (await q(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s, pg_database_size(current_database())::bigint AS b`))[0];
  const big = await q(`SELECT relname AS t, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`);
  console.log(JSON.stringify({ counts, synthetic, checks, dbSize: size.s, dbBytes: Number(size.b), largestTables: big }, null, 2));
} finally {
  await prisma.$disconnect();
}
