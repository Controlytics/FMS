// Parses docs/production-readiness/03_API_ENDPOINT_INVENTORY.md into
// [{ module, method, path, gate, reauth, line }] (same parser as QA/tests/api/endpoint-sweep.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../../tests/performance/lib/http.mjs';
export function loadInventory() {
  const inv = fs.readFileSync(path.join(REPO, 'docs/production-readiness/03_API_ENDPOINT_INVENTORY.md'), 'utf8');
  const ops = [];
  let module = '';
  for (const line of inv.split('\n')) {
    const h = line.match(/^### (.+?) \(\d+\)/);
    if (h) module = h[1];
    const c = line.split('|').map((s) => s.trim());
    if (module && c.length >= 10 && /^(GET|POST|PUT|PATCH|DELETE)$/.test(c[1])) {
      ops.push({ module, method: c[1], path: c[2].replace(/`/g, ''), gate: c[3], reauth: c[4], audited: c[5], cls: c[7], line: c[8] });
    }
  }
  return ops;
}
/**
 * The inventory brought to a later commit: gates changed since it was derived are replaced and
 * added operations appended (QA/tests/phase4/gates-head.mjs). Each changed op carries `gateSrc`/`gateCommit`.
 */
export async function loadInventoryAtHead() {
  const { GATE_OVERRIDES, ADDED_OPS, REMOVED_OPS } = await import('./gates-head.mjs');
  const gone = new Set(REMOVED_OPS.map((r) => `${r.method} ${r.path}`));
  const ops = loadInventory().filter((o) => !gone.has(`${o.method} ${o.path}`)).map((o) => {
    const ov = GATE_OVERRIDES[`${o.method} ${o.path}`];
    return ov ? { ...o, inventoryGate: o.gate, gate: ov.gate, gateSrc: ov.src, gateCommit: ov.commit } : o;
  });
  for (const a of ADDED_OPS) ops.push({ ...a, gateSrc: a.src, gateCommit: a.commit, added: true });
  return ops;
}
export const hasParam = (p) => /\{[^}]+\}/.test(p);
/** Parses the gate column into { kind, perms, roles }. */
export function parseGate(g) {
  if (/^PUBLIC/i.test(g)) return { kind: 'public' };
  if (/SUPER_ADMIN only|^role: SUPER_ADMIN( \(def\.requiredRole\))?$|^role: SUPER_ADMIN(; role: SUPER_ADMIN)+$/.test(g)) return { kind: 'sa' };
  let m = g.match(/^role: (.+)$/);
  if (m) return { kind: 'role', roles: m[1].split(',').map((s) => s.trim()) };
  if (/^authenticated/.test(g)) return { kind: 'any', inHandler: /in-handler/.test(g) };
  m = g.match(/^any: (.+)$/);
  if (m) return { kind: 'perm', perms: m[1].split(',').map((s) => s.trim()) };
  if (/^[A-Z_]+$/.test(g)) return { kind: 'perm', perms: [g] };
  return { kind: 'unknown', raw: g };
}
