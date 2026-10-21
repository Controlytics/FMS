// For every live role and every gated WRITE op: does the backend let the role through (live
// roles.permissions + hasEffectivePermission) WITHOUT the role having ON any toggle that OWNS the op?
// "Owns" = a configurable PERMISSION_TREE node whose discriminating `gate` intersects the op's gate.
// Such a hit is a capability the Roles & Access page does not show as granted (cross-grant leak).
//   npx tsx QA/tests/phase4/effective-vs-toggles.mts
import fs from 'node:fs';
import { hasEffectivePermission } from '../../../packages/shared/src/types/permissions.ts';
import { sql } from '../lib/qa.mjs';
import { loadInventory, parseGate } from './inventory.mjs';
import { ROLES } from './accounts.mjs';

const { nodes } = JSON.parse(fs.readFileSync('QA/results/phase4/tree.json', 'utf8'));
const conf = nodes.filter((n: any) => n.configurable);
const live: any[] = JSON.parse(fs.readFileSync('QA/results/phase4/live-roles.json', 'utf8'));
const perms: Record<string, string[]> = JSON.parse(sql(`select json_object_agg(name, permissions) from roles`));
const ops = loadInventory().filter((o: any) => o.method !== 'GET');
const hits: any[] = [];
for (const role of ROLES) {
  const on = new Set(Object.entries(live.find((r) => r.role === role).cfgperms).filter(([, v]) => v === true).map(([k]) => k));
  for (const op of ops) {
    const g: any = parseGate(op.gate);
    if (g.kind !== 'perm') continue;
    const allowed = g.perms.some((p: string) => hasEffectivePermission(perms[role], p));
    if (!allowed) continue;
    const owners = conf.filter((n: any) => n.gate.some((p: string) => g.perms.includes(p))).map((n: any) => n.id);
    const ownedOn = owners.filter((id: string) => on.has(id));
    if (ownedOn.length === 0) {
      const via = g.perms.filter((p: string) => hasEffectivePermission(perms[role], p));
      const grantedBy = conf.filter((n: any) => on.has(n.id) && via.some((p: string) => hasEffectivePermission(n.permissions, p))).map((n: any) => n.id);
      hits.push({ role, method: op.method, path: op.path, gate: op.gate, via, owners, grantedByToggles: grantedBy });
    }
  }
}
fs.writeFileSync('QA/results/phase4/effective-vs-toggles.json', JSON.stringify(hits, null, 1));
for (const h of hits) console.log(`${h.role.padEnd(12)} ${h.method.padEnd(6)} ${h.path.padEnd(52)} via ${h.via.join('/')} <- toggles [${h.grantedByToggles.join(', ') || 'NONE: manual/unmapped perm'}]; owners [${h.owners.join(', ')}]`);
console.log('hits', hits.length);
