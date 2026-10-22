// P5R-01 severity check (read-only): do the orphan PM schedules (entity that does not exist, year 1,
// no visits — created through POST /api/pm-schedules) break any PM read other users depend on?
// A 5xx anywhere here would raise P5R-01 from P3 to P2 (one PM_CREATE holder breaking a page for all).
import { raw, tok, save, sql } from './lib5.mjs';

const orphans = sql(`select entity_id||'|'||year from pm_schedules p where not exists (select 1 from asset_instances a where a.id=p.entity_id)`).split(/\r?\n/).filter(Boolean);
console.log('orphan schedules on the clone:', orphans.length, orphans.join(' '));
const ent = orphans[0]?.split('|')[0];
const paths = ['/api/pm-schedules/entries', '/api/pm-schedules/entries?year=1', '/api/pm-schedules/entries/pending-counts',
  '/api/pm-schedules/entries/export.xlsx', '/api/pm-schedules/entries/export.xlsx?year=1', '/api/pm-schedules/pending-tasks-map',
  '/api/pm-schedules/due', '/api/pm-schedules/ahu-configs', '/api/pm-schedules/deviations', '/api/pm-schedules/qnn',
  ...(ent ? [`/api/pm-schedules/${ent}`, `/api/pm-schedules/${ent}/history`] : [])];
const out = [];
for (const role of ['SUPERVISOR', 'OPERATOR', 'QA', 'MANAGER']) {
  const t = (await tok(role)).token;
  for (const p of paths) {
    const r = await raw('GET', p, { token: t });
    out.push({ role, path: p, status: r.status, error: r.json?.error });
    if (r.status >= 500 || r.status === 0) console.log('5XX', role, p, r.status, r.json?.error);
  }
}
const hist = out.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
console.log('requests', out.length, 'status histogram', JSON.stringify(hist));
save('pm-orphan-impact', { orphans, out, hist });
