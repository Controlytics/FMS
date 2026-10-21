// Frontend gate (PERMISSION_TREE node.gate, useCan = exact includes, NO fallbacks) vs backend gate
// (inventory op gate, hasEffectivePermission WITH *_VIEW<-*_READ and *<-*_MANAGE fallbacks).
// A node is compared with every op whose backend gate contains the node's whole gate PLUS other perms
// (backend broader than the button). Per live role: does useCan say no while the API says yes?
//   npx tsx QA/tests/phase4/fe-be-gates.mts
import fs from 'node:fs';
import { hasEffectivePermission } from '../../../packages/shared/src/types/permissions.ts';
import { sql } from '../lib/qa.mjs';
import { loadInventory, parseGate } from './inventory.mjs';
import { ROLES } from './accounts.mjs';

const { nodes } = JSON.parse(fs.readFileSync('QA/results/phase4/tree.json', 'utf8'));
const perms: Record<string, string[]> = JSON.parse(sql(`select json_object_agg(name, permissions) from roles`));
const inv = loadInventory();
const out: any[] = [];
for (const n of nodes) {
  if (!n.gate.length) continue;
  for (const op of inv) {
    const g: any = parseGate(op.gate);
    if (g.kind !== 'perm') continue;
    if (!n.gate.every((p: string) => g.perms.includes(p))) continue;
    const extra = g.perms.filter((p: string) => !n.gate.includes(p));
    if (!extra.length) continue;
    const live = ROLES.filter((r) => !n.gate.some((p: string) => perms[r].includes(p)) && g.perms.some((p: string) => hasEffectivePermission(perms[r], p)));
    out.push({ node: n.id, configurable: !!n.configurable, enforce: n.enforce, feGate: n.gate, method: op.method, path: op.path, beGate: g.perms, extra, rolesUiNoApiYes: live });
  }
}
fs.writeFileSync('QA/results/phase4/fe-be-gates.json', JSON.stringify(out, null, 1));
for (const o of out.filter((x) => x.method !== 'GET')) console.log(`${o.node.padEnd(26)} FE[${o.feGate}]  ${o.method} ${o.path}  BE+[${o.extra}]  live roles UI-no/API-yes: ${o.rolesUiNoApiYes.join(',') || '-'}`);
console.log('--- reads');
for (const o of out.filter((x) => x.method === 'GET' && x.rolesUiNoApiYes.length)) console.log(`${o.node.padEnd(26)} FE[${o.feGate}]  GET ${o.path}  BE+[${o.extra}]  live: ${o.rolesUiNoApiYes.join(',')}`);
