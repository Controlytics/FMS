// Probe R6a (CS-140): POST /api/pm-executions does findFirst(IN_PROGRESS) then create,
// with no unique key and no transaction (pm-schedules/pm-executions.ts). Ten concurrent
// starts for one APPROVED entry should yield exactly ONE IN_PROGRESS execution and nine
// 409 CONFLICT. PASS = exactly one row; FAIL = more than one.
// Leaves the created rows in place (disposable clone) and records their ids.
import { call, tokenFor, PASSWORD, sql, report } from '../lib/qa.mjs';

const N = Number(process.env.QA_RACE_N ?? 10);
const op = await tokenFor('OPERATOR');

const pick = sql(`select e.id || '|' || s.entity_id from pm_schedule_entries e join pm_schedules s on s.id = e.schedule_id
  where e.approval_status = 'APPROVED'
    and not exists (select 1 from pm_executions x where x.schedule_entry_id = e.id)
  order by e.planned_date limit 1`);
if (!pick) throw new Error('no APPROVED entry without executions on the clone');
const [scheduleEntryId, entityId] = pick.split('|');

const body = { scheduleEntryId, entityId, _currentPassword: PASSWORD };
const started = Date.now();
const responses = await Promise.all(Array.from({ length: N }, () => call('POST', '/api/pm-executions', { token: op.token, body })));
const ms = Date.now() - started;

const rows = sql(`select id || '|' || status || '|' || started_at from pm_executions where schedule_entry_id = '${scheduleEntryId}' order by started_at`)
  .split('\n').filter(Boolean).map((l) => { const [id, status, at] = l.split('|'); return { id, status, at }; });
const inProgress = rows.filter((r) => r.status === 'IN_PROGRESS').length;
const auditRows = Number(sql(`select count(*) from audit_trail where action = 'PM_STARTED' and after_value::text like '%${entityId}%' and timestamp > now() - interval '5 minutes'`));
const statusCounts = responses.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});

const verdict = inProgress === 1 ? 'PASS' : inProgress > 1 ? 'FAIL' : 'INCONCLUSIVE';
report('R6a-pm-execution-race', verdict, {
  user: op.username, role: op.role, N, ms, scheduleEntryId, entityId, statusCounts,
  sampleRefusal: responses.find((r) => r.status !== 201)?.json,
  inProgressRows: inProgress, rows, auditRowsPmStarted: auditRows,
});
console.log(`  ${N} concurrent starts in ${ms} ms -> HTTP ${JSON.stringify(statusCounts)}; IN_PROGRESS rows = ${inProgress}; PM_STARTED audit rows = ${auditRows}`);
