// Phase 5 / category 1 — authorization on every WRITE operation.
// For each POST/PUT/PATCH/DELETE in docs/production-readiness/03_API_ENDPOINT_INVENTORY.md whose gate
// can be parsed, every non-SUPER_ADMIN role that does NOT hold the gate calls it with a body that
// satisfies the OpenAPI schema's required fields (so it reaches the preHandler gate rather than
// stopping at validation) and random UUIDs in the path. Expected: 403.
//   403 -> PASS; 400 -> INCONCLUSIVE (validation ran first; no write); 401 no-token check separately;
//   2xx -> FAIL (HIGH); anything else (404/409/401 REAUTH_REQUIRED/422) -> SUSPECT (the gate let it
//   through to the handler) — investigated by hand.
// Also: every write op with NO token -> must be 401.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { raw, tok, ROLES, save, sample, leaks, OUT } from './lib5.mjs';
import { REPO } from '../../../tests/performance/lib/http.mjs';

const api = JSON.parse(fs.readFileSync(path.join(OUT, 'openapi.json'), 'utf8'));
const inv = fs.readFileSync(path.join(REPO, 'docs/production-readiness/03_API_ENDPOINT_INVENTORY.md'), 'utf8');
const ops = [];
let mod = '';
for (const line of inv.split('\n')) {
  const h = line.match(/^### (.+?) \(\d+\)/);
  if (h) mod = h[1];
  const m = line.match(/^\| (POST|PUT|PATCH|DELETE) \| `([^`]+)` \| ([^|]+) \| ([^|]+) \|/);
  if (m && mod && line.split('|').length >= 10) ops.push({ module: mod, method: m[1], path: m[2], gate: m[3].trim(), reauth: m[4].trim() });
}

const perms = {};
for (const r of ROLES) perms[r] = (await raw('GET', '/api/auth/me', { token: (await tok(r)).token })).json.permissions;

function lacking(gate) {
  if (/SUPER_ADMIN/.test(gate)) return ROLES;
  if (/^authenticated|^PUBLIC|^perm$/.test(gate)) return null;
  const list = gate.replace(/^any:\s*/, '').split(/,\s*/).map((s) => s.trim()).filter((s) => /^[A-Z_]+$/.test(s));
  if (!list.length) return null;
  return ROLES.filter((r) => !list.some((p) => perms[r].includes(p)));
}

function bodyFor(o) {
  const op = api.paths[o.path]?.[o.method.toLowerCase()];
  const schema = op?.requestBody?.content?.['application/json']?.schema;
  if (!schema) return o.method === 'DELETE' ? undefined : {};
  return sample(schema, 0, randomUUID) ?? {};
}
const fill = (p) => p.replace(/\{[^}]+\}/g, () => randomUUID());

const results = [];
const SKIP = [/\/api\/auth\/(logout|refresh|beacon-logout)/];
for (const o of ops) {
  if (SKIP.some((r) => r.test(o.path))) continue;
  const body = bodyFor(o);
  // no token
  if (!/PUBLIC/.test(o.gate)) {
    const r = await raw(o.method, fill(o.path), { body });
    results.push({ ...o, role: 'NONE', status: r.status, error: r.json?.error, verdict: r.status === 401 ? 'PASS' : r.status === 400 ? 'INCONCLUSIVE' : 'FAIL', leaks: leaks(r) });
  }
  const roles = lacking(o.gate);
  if (!roles) { results.push({ ...o, role: '-', verdict: 'NOT-PARSED' }); continue; }
  for (const role of roles) {
    const r = await raw(o.method, fill(o.path), { token: (await tok(role)).token, body });
    const verdict = r.status === 403 ? 'PASS' : r.status === 400 ? 'INCONCLUSIVE' : r.status >= 200 && r.status < 300 ? 'FAIL' : 'SUSPECT';
    results.push({ ...o, role, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160), verdict, leaks: leaks(r), body });
  }
}
const by = results.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), {});
const f = save('authz-sweep', { ops: ops.length, by, results });
console.log('write ops parsed', ops.length, by, f);
for (const r of results.filter((x) => ['FAIL', 'SUSPECT'].includes(x.verdict) || x.leaks?.length)) console.log(r.verdict, r.role, r.method, r.path, r.gate, '->', r.status, r.error, r.message ?? '', r.leaks?.join(' ') ?? '');
