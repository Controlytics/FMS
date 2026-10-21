// Export permissions: frontend gate (PERMISSION_TREE *.export node, useCan = exact match) vs backend
// gate (POST /api/audit/report-export-log -> REPORT_READ_GATES, audit/routes.ts:30-43, which checks READ
// permissions) vs the target doc (target-matrix.json `on`).
// MUTATES the clone: a passing probe writes one REPORT_GENERATED audit row (search = 'QA-PHASE4-PROBE',
// recordCount 0) — no EXPORT_* action requires re-auth in digilog_qa_perf, so there is no earlier stop.
//   MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/export-gate-probe.mts
import fs from 'node:fs';
import { call, sql } from '../lib/qa.mjs';
import { phase4Tokens, ROLES } from './accounts.mjs';
const target = JSON.parse(fs.readFileSync('tasks/role-privileges-baseline/target-matrix.json', 'utf8'));
const { nodes } = JSON.parse(fs.readFileSync('QA/results/phase4/tree.json', 'utf8'));
const perms: Record<string, string[]> = JSON.parse(sql(`select json_object_agg(name, permissions) from roles`));
const FE: Record<string, string | null> = {
  'Audit Trail': 'audit.export', 'Cleaning Record': 'cleaning_record.export', 'Cleaning Cycle Detail': 'cleaning_record.export',
  'Cleaning Lifecycle': 'lifecycle.export', 'Deviations': 'deviations.export', 'Filters': 'filters.export',
  'RFID Track Record': 'rfid_track.export', 'Replacement List': 'replacement_list.export', 'Retirement List': 'retirement_list.export',
  'PM Schedule': null, 'Replacement Schedule': null, 'Quality Notifications': null,
};
const t = await phase4Tokens();
const rows: any[] = [];
for (const [report, nodeId] of Object.entries(FE)) {
  const node = nodeId ? nodes.find((n: any) => n.id === nodeId) : null;
  for (const role of ROLES) {
    const fe = node ? node.gate.some((p: string) => perms[role].includes(p)) : null;
    const doc = nodeId ? target[role].on.includes(nodeId) : null;
    const r: any = await call('POST', '/api/audit/report-export-log', { token: t[role].token,
      body: { reportType: report, format: 'PDF', recordCount: 0, search: 'QA-PHASE4-PROBE' } });
    const be = r.status === 200 || r.json?.error === 'REAUTH_REQUIRED' ? true : r.status === 403 ? false : `?${r.status}`;
    rows.push({ report, node: nodeId, role, docExport: doc, frontendShows: fe, backendAllows: be, status: r.status, msg: r.json?.message });
  }
}
fs.writeFileSync('QA/results/phase4/export-gate-probe.json', JSON.stringify(rows, null, 1));
for (const x of rows) {
  const flag = x.backendAllows === true && x.docExport === false ? 'DOC-DENIED BUT API ALLOWS' : x.backendAllows !== x.frontendShows && x.frontendShows !== null ? 'FE/BE DISAGREE' : '';
  console.log(x.report.padEnd(22), x.role.padEnd(12), 'doc', String(x.docExport).padEnd(5), 'FE', String(x.frontendShows).padEnd(5), 'BE', String(x.backendAllows).padEnd(5), x.status, flag);
}
