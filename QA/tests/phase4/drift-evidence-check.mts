// For every matrix cell flagged as a leak vs the doc: would the evidence route ALSO have passed with the
// role's doc-baseline permissions (after-2026-09-04.json rolePermissions + the documented amendments)?
// If yes, that request does not prove the drift; it only proves a permission the role already held.
//   npx tsx QA/tests/phase4/drift-evidence-check.mts
import fs from 'node:fs';
import { hasEffectivePermission } from '../../../packages/shared/src/types/permissions.ts';
import { loadInventory, parseGate } from './inventory.mjs';

const m: any[] = JSON.parse(fs.readFileSync('QA/results/phase4/matrix.json', 'utf8'));
const after: any[] = JSON.parse(fs.readFileSync('tasks/role-privileges-baseline/after-2026-09-04.json', 'utf8'));
const AMEND_PERMS: Record<string, string[]> = { MANAGER: ['FILTER_REVIEW', 'RETIREMENT_LIST_VIEW', 'REPLACEMENT_LIST_VIEW'], QA: ['FILTER_APPROVE', 'REPLACEMENT_LIST_VIEW'],
  SUPERVISOR: ['RETIREMENT_LIST_VIEW', 'REPLACEMENT_LIST_VIEW'], SHIFTOFFICER: ['RETIREMENT_LIST_VIEW', 'REPLACEMENT_LIST_VIEW'], OPERATOR: ['REPLACEMENT_LIST_VIEW'], ADMIN: [] };
const inv = loadInventory();
const READ_GATES: Record<string, string[]> = { 'Audit Trail': ['AUDIT_READ'], 'Cleaning Record': ['CYCLE_READ', 'VERSION_HISTORY_VIEW'], 'Cleaning Lifecycle': ['CYCLE_READ'],
  'Filters': ['FILTER_OPERATE', 'ASSET_READ'], 'Retirement List': ['ASSET_READ', 'ASSET_VIEW', 'FILTER_RETIRE'], 'Replacement List': ['ASSET_READ', 'ASSET_VIEW', 'FILTER_REPLACE'] };
for (const c of m.filter((x) => x.verdict.startsWith('LEAK'))) {
  const base = [...after.find((a) => a.role === c.role).rolePermissions, ...AMEND_PERMS[c.role]];
  let gate: string[] = [];
  const ex = c.evidence.match(/reportType:'([^']+)'/);
  if (ex) gate = READ_GATES[ex[1]];
  else {
    const mm = c.evidence.match(/^(\w+) (\S+)/);
    const op = inv.find((o: any) => o.method === mm[1] && o.path === mm[2]);
    const g: any = parseGate(op.gate); gate = g.perms ?? [];
  }
  c.passedAtBaseline = gate.some((p) => hasEffectivePermission(base, p));
  console.log(c.passedAtBaseline ? 'BASELINE-ALSO' : 'NEW-BY-DRIFT ', c.role.padEnd(12), c.node.padEnd(26), c.verdict.includes('ON') ? 'D+' : 'X+', '|', c.evidence);
}
fs.writeFileSync('QA/results/phase4/matrix.json', JSON.stringify(m, null, 1));
