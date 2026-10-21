// Static check (CLAUDE.md rule): "A node's grant set must never contain another node's GATE."
// Only configurable nodes grant anything, so only their grant sets matter. A cross-node hit is
// reported when perm P is in node A's grant set and P is (part of) node B's gate, B != A, and B's
// capability is not a plain read already implied by A (we list every hit; classification is manual).
import fs from 'node:fs';
const { nodes } = JSON.parse(fs.readFileSync('QA/results/phase4/tree.json', 'utf8'));
const gateOwners = new Map();
for (const n of nodes) for (const g of n.gate) { if (!gateOwners.has(g)) gateOwners.set(g, []); gateOwners.get(g).push(n.id); }
const hits = [];
for (const a of nodes.filter((n) => n.configurable)) {
  for (const p of a.permissions) {
    if (a.gate.includes(p)) continue;
    const owners = (gateOwners.get(p) ?? []).filter((id) => id !== a.id);
    if (owners.length) hits.push({ node: a.id, grants: p, isGateOf: owners });
  }
}
fs.writeFileSync('QA/results/phase4/grant-contains-gate.json', JSON.stringify(hits, null, 1));
for (const h of hits) console.log(`${h.node.padEnd(34)} grants ${h.grants.padEnd(28)} = gate of ${h.isGateOf.join(', ')}`);
console.log('hits', hits.length);
