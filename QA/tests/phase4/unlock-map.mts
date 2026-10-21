// Static: for every WRITE operation in the inventory, which configurable PERMISSION_TREE toggles,
// enabled ALONE, satisfy its backend gate (backend semantics: hasEffectivePermission, fallbacks included)?
// A toggle that unlocks a write belonging to a different page/action is a grant-set over-grant
// (CLAUDE.md: "a node's grant set must never contain another node's GATE").
// Also: frontend/backend gate comparison — the useCan gate of the node vs the backend gate of the op.
//   npx tsx QA/tests/phase4/unlock-map.mts
import fs from 'node:fs';
import { hasEffectivePermission } from '../../../packages/shared/src/types/permissions.ts';
import { loadInventory, parseGate } from './inventory.mjs';

const { nodes } = JSON.parse(fs.readFileSync('QA/results/phase4/tree.json', 'utf8'));
const conf = nodes.filter((n: any) => n.configurable);
const ops = loadInventory().filter((o: any) => o.method !== 'GET');
const out: any[] = [];
for (const op of ops) {
  const g: any = op.path === '/api/admin-requests/{id}/process' ? { kind: 'perm', perms: ['ADMIN_REQUEST_APPROVE', 'ADMIN_REQUEST_REJECT'] } : parseGate(op.gate);
  if (g.kind !== 'perm') continue;
  const unlockedBy = conf.filter((n: any) => g.perms.some((p: string) => hasEffectivePermission(n.permissions, p))).map((n: any) => n.id);
  out.push({ method: op.method, path: op.path, gate: op.gate, line: op.line, module: op.module, unlockedBy });
}
fs.writeFileSync('QA/results/phase4/unlock-map.json', JSON.stringify(out, null, 1));
for (const o of out) console.log(`${o.method.padEnd(6)} ${o.path.padEnd(58)} ${o.gate.padEnd(44)} <- ${o.unlockedBy.join(', ')}`);
