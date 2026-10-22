// Builds the role x configurable-privilege matrix:
//   doc      = target-matrix.json `on` + the documented amendments after 2026-09-04
//              (filters.review MANAGER / filters.approve QA — filter-approval workflow 2026-09-04;
//               retirement.view / replacement.view — the 2026-10-01 table in ROLE-PRIVILEGES-DOC-ALIGNMENT.md)
//   toggle   = live role_configs.permissions[node] in digilog_qa_perf
//   frontend = useCan semantics: node.gate.some(p => rolePerms.includes(p))
//   observed = live API result from the role sweep (role-sweep-latest.json) on the op(s) whose backend gate
//              matches the node's gate; export nodes use export-gate-probe.json
//   npx tsx QA/tests/phase4/matrix.mts
import fs from 'node:fs';
import { loadInventory, loadInventoryAtHead, parseGate } from './inventory.mjs';
import { ROLES } from './accounts.mjs';
const OUT = process.env.P4_OUT ?? 'QA/results/phase4'; // re-run at a later commit: P4_OUT, P4_HEAD=1, P4_TARGET_MATRIX

const target = JSON.parse(fs.readFileSync(process.env.P4_TARGET_MATRIX ?? 'tasks/role-privileges-baseline/target-matrix.json', 'utf8'));
const { nodes } = JSON.parse(fs.readFileSync(`${OUT}/tree.json`, 'utf8'));
const live: any[] = JSON.parse(fs.readFileSync(`${OUT}/live-roles.json`, 'utf8'));
const sweep = JSON.parse(fs.readFileSync(`${OUT}/role-sweep-latest.json`, 'utf8'));
const exportProbe: any[] = JSON.parse(fs.readFileSync(`${OUT}/export-gate-probe.json`, 'utf8'));
const inv = (process.env.P4_HEAD === '1' ? await loadInventoryAtHead() : loadInventory());

const AMEND: Record<string, string[]> = {
  MANAGER: ['filters.review', 'retirement.view', 'replacement.view'],
  QA: ['filters.approve', 'replacement.view'],
  SUPERVISOR: ['retirement.view', 'replacement.view'],
  SHIFTOFFICER: ['retirement.view', 'replacement.view'],
  OPERATOR: ['replacement.view'],
  ADMIN: [],
};
const EXPORT_REPORT: Record<string, string> = { 'audit.export': 'Audit Trail', 'cleaning_record.export': 'Cleaning Record', 'lifecycle.export': 'Cleaning Lifecycle',
  'filters.export': 'Filters', 'retirement_list.export': 'Retirement List', 'replacement_list.export': 'Replacement List' };

const conf = nodes.filter((n: any) => n.configurable);
const out: any[] = [];
for (const n of conf) {
  // ops whose backend gate is exactly this node's gate set (preferred), else any op sharing a gate perm
  const gateOf = (o: any) => { const g: any = o.path === '/api/admin-requests/{id}/process' ? { kind: 'perm', perms: ['ADMIN_REQUEST_APPROVE'] } : parseGate(o.gate); return g.kind === 'perm' ? g.perms : []; };
  let opsFor = inv.filter((o: any) => { const g = gateOf(o); return g.length && g.every((p: string) => n.gate.includes(p)); });
  let exact = true;
  if (!opsFor.length) { opsFor = inv.filter((o: any) => gateOf(o).some((p: string) => n.gate.includes(p))); exact = false; }
  // An action node (not a View) is measured on its WRITE routes when it has any — a shared read
  // route (e.g. track-record for filters.rfid_manage) says nothing about the action.
  if (!/view/i.test(n.action)) { const w = opsFor.filter((o: any) => o.method !== 'GET'); if (w.length) opsFor = w; }
  for (const role of ROLES) {
    const lr = live.find((r) => r.role === role);
    const doc = target[role].on.includes(n.id) || AMEND[role].includes(n.id);
    const toggle = lr.cfgperms[n.id] === true;
    const frontend = n.gate.length ? n.gate.some((p: string) => lr.perms.includes(p)) : false;
    let observed = 'not probed';
    let evidence = '';
    if (EXPORT_REPORT[n.id]) {
      const e = exportProbe.find((x) => x.report === EXPORT_REPORT[n.id] && x.role === role);
      observed = e.backendAllows === true ? 'allowed' : e.backendAllows === false ? 'denied' : String(e.backendAllows);
      evidence = `POST /api/audit/report-export-log {reportType:'${EXPORT_REPORT[n.id]}'} -> ${e.status}`;
    } else {
      const rows = sweep.rows.filter((r: any) => r.role === role && opsFor.some((o: any) => o.method === r.method && o.path === r.path) && ['OK', 'LEAK', 'REFUSED_BUT_GRANTED'].includes(r.verdict));
      const obsOf = (r: any) => (r.retry?.observed ?? r.observed);
      if (rows.length) {
        const pass = rows.filter((r: any) => obsOf(r) === 'PASS');
        observed = pass.length ? 'allowed' : 'denied';
        const r = pass[0] ?? rows[0];
        evidence = `${r.method} ${r.path} -> ${r.retry?.status ?? r.status}${(r.retry?.error ?? r.error) ? ' ' + (r.retry?.error ?? r.error) : ''}${exact ? '' : ' (op gate is broader than node gate)'}`;
      } else if (!opsFor.length) observed = 'no backend route (UI-only)';
      else observed = 'not probed (allowed-role write skipped / inconclusive)';
    }
    let verdict = 'OK';
    if (observed === 'allowed' && !doc) verdict = toggle ? 'LEAK vs doc (live toggle ON — config drift)' : 'LEAK vs doc (toggle OFF — granted by another toggle / fallback)';
    else if (observed === 'denied' && doc) verdict = 'REFUSED but doc grants';
    else if (observed.startsWith('not probed') || observed.startsWith('no backend')) verdict = doc === toggle ? 'n/a (config matches doc)' : `CONFIG DRIFT (doc ${doc ? 'on' : 'off'}, toggle ${toggle ? 'on' : 'off'})`;
    if (verdict === 'OK' && frontend !== (observed === 'allowed') && (observed === 'allowed' || observed === 'denied')) verdict = `FE/BE DISAGREE (useCan ${frontend}, API ${observed})`;
    out.push({ node: n.id, role, doc, toggle, frontend, observed, verdict, evidence });
  }
}
fs.writeFileSync(`${OUT}/matrix.json`, JSON.stringify(out, null, 1));
const tally = out.reduce((m: any, r) => ((m[r.verdict.split(' (')[0]] = (m[r.verdict.split(' (')[0]] ?? 0) + 1), m), {});
console.log(tally);
for (const r of out.filter((x) => !/^OK$|^n\/a/.test(x.verdict))) console.log(r.role.padEnd(12), r.node.padEnd(28), 'doc', String(r.doc).padEnd(5), 'tog', String(r.toggle).padEnd(5), 'FE', String(r.frontend).padEnd(5), r.observed.padEnd(10), r.verdict, '|', r.evidence);
