// Export permissions: frontend gate (PERMISSION_TREE *.export node, useCan = exact match) vs backend
// gate (POST /api/audit/report-export-log) vs the target doc (target-matrix.json `on`).
//   10-21 (pre-70adf40): backend checked REPORT_READ_GATES (read permissions) -> finding P4-02.
//   At HEAD (70adf40+):  backend checks REPORT_EXPORT_GATES (audit/routes.ts:45-58) = the Export button's
//                        permission; `expectedBackend` is computed from gates-head.mjs with hasEffectivePermission.
// MUTATES the clone: a passing probe writes one REPORT_GENERATED audit row (search = 'QA-PHASE4-PROBE',
// recordCount 0) unless the role must re-authenticate for that EXPORT_* action.
//   MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/export-gate-probe.mts            (10-21 layout)
//   PERF_TARGET=https://localhost:3111 P4_OUT=QA/results/phase4/2026-10-22 P4_TARGET_MATRIX=<file> \
//     MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/export-gate-probe.mts         (re-run at a commit)
import fs from 'node:fs';
import path from 'node:path';
import { hasEffectivePermission } from '../../../packages/shared/src/types/permissions.ts';
import { call, sql } from '../lib/qa.mjs';
import { phase4Tokens, ROLES } from './accounts.mjs';
import { REPORT_EXPORT_GATES } from './gates-head.mjs';
const OUT = process.env.P4_OUT ?? 'QA/results/phase4';
const target = JSON.parse(fs.readFileSync(process.env.P4_TARGET_MATRIX ?? 'tasks/role-privileges-baseline/target-matrix.json', 'utf8'));
const { nodes } = JSON.parse(fs.readFileSync(path.join(OUT, 'tree.json'), 'utf8'));
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
    const gate = (REPORT_EXPORT_GATES as Record<string, string[]>)[report];
    const expectedBackend = gate.length === 0 || gate.some((p) => hasEffectivePermission(perms[role], p));
    const r: any = await call('POST', '/api/audit/report-export-log', { token: t[role].token,
      body: { reportType: report, format: 'PDF', recordCount: 0, search: 'QA-PHASE4-PROBE' } });
    const be = r.status === 200 || r.json?.error === 'REAUTH_REQUIRED' ? true : r.status === 403 ? false : `?${r.status}`;
    rows.push({ report, node: nodeId, role, docExport: doc, frontendShows: fe, expectedBackend, backendAllows: be, status: r.status, error: r.json?.error, msg: r.json?.message });
  }
}
fs.writeFileSync(path.join(OUT, 'export-gate-probe.json'), JSON.stringify(rows, null, 1));
for (const x of rows) {
  const flag = x.backendAllows !== x.expectedBackend ? 'BACKEND != ITS OWN GATE'
    : x.backendAllows === true && x.docExport === false ? 'DOC-DENIED BUT API ALLOWS'
      : x.backendAllows !== x.frontendShows && x.frontendShows !== null ? 'FE/BE DISAGREE' : '';
  console.log(x.report.padEnd(22), x.role.padEnd(12), 'doc', String(x.docExport).padEnd(5), 'FE', String(x.frontendShows).padEnd(5), 'BE', String(x.backendAllows).padEnd(5), x.status, x.error ?? '', flag);
}
