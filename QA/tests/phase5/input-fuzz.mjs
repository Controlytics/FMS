// Phase 5 / category 5 — input abuse on every non-SUPER_ADMIN write operation, called by a role that
// HOLDS the gate and with the correct re-auth password in x-reauth-password, so the request reaches
// validation AND the handler. Path ids are random UUIDs (most handlers then 404 — no write) except in
// the path-variant probes. Expected: 4xx, never 5xx, never a Prisma/stack/path leak.
// Excluded (handled by hand or too destructive for a generic fuzz): /api/config/*, /api/ldap/*,
// /api/backup/*, /api/auth/*, sweeps, /api/notification-delivery/*, notification-rules test, guest.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { raw, tok, ROLES, save, sample, leaks, OUT, PASSWORD } from './lib5.mjs';
import { REPO } from '../../../tests/performance/lib/http.mjs';

const api = JSON.parse(fs.readFileSync(path.join(OUT, 'openapi.json'), 'utf8'));
const inv = fs.readFileSync(path.join(REPO, 'docs/production-readiness/03_API_ENDPOINT_INVENTORY.md'), 'utf8');
const ops = [];
for (const line of inv.split('\n')) {
  const m = line.match(/^\| (POST|PUT|PATCH|DELETE) \| `([^`]+)` \| ([^|]+) \|/);
  if (m && line.split('|').length >= 10) ops.push({ method: m[1], path: m[2], gate: m[3].trim() });
}
const EXCLUDE = [/^\/api\/config\//, /^\/api\/ldap\//, /^\/api\/backup\//, /^\/api\/auth\//, /sweep/, /^\/api\/notification-delivery\//, /notification-rules\/\{id\}\/test/, /^\/api\/guest\//];
const PREF = ['SUPERVISOR', 'SHIFTOFFICER', 'ADMIN', 'QA', 'MANAGER', 'OPERATOR'];
const perms = {};
for (const r of ROLES) perms[r] = (await raw('GET', '/api/auth/me', { token: (await tok(r)).token })).json.permissions;
function holder(gate) {
  if (/SUPER_ADMIN|^PUBLIC|^perm$/.test(gate)) return null;
  if (/^authenticated/.test(gate)) return 'OPERATOR';
  const list = gate.replace(/^any:\s*/, '').split(/,\s*/).filter((s) => /^[A-Z_]+$/.test(s));
  return PREF.find((r) => list.some((p) => perms[r].includes(p))) ?? null;
}
const schemaOf = (o) => api.paths[o.path]?.[o.method.toLowerCase()]?.requestBody?.content?.['application/json']?.schema;

function mutate(v, fn, depth = 0) {
  if (depth > 5) return v;
  if (Array.isArray(v)) return v.map((x) => mutate(x, fn, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mutate(x, fn, depth + 1)]));
  return fn(v);
}
const BIG = 'A'.repeat(200_000);
const bodyVariants = {
  huge: (b) => mutate(b, (x) => (typeof x === 'string' && !/^[0-9a-f-]{36}$/.test(x) ? BIG : x)),
  nullbyte: (b) => mutate(b, (x) => (typeof x === 'string' && !/^[0-9a-f-]{36}$/.test(x) ? `qa\u0000p5` : x)),
  unicode: (b) => mutate(b, (x) => (typeof x === 'string' && !/^[0-9a-f-]{36}$/.test(x) ? `<script>alert(1)</script>'"; DROP TABLE users;-- ‮😀 ́` : x)),
  wrongtype: (b) => mutate(b, (x) => (typeof x === 'string' ? 12345 : typeof x === 'number' ? 'abc' : typeof x === 'boolean' ? 'yes' : x)),
  bignum: (b) => mutate(b, (x) => (typeof x === 'number' ? 1e308 : x)),
  negnum: (b) => mutate(b, (x) => (typeof x === 'number' ? -2147483649 : x)),
  baduuid: (b) => mutate(b, (x) => (typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x) ? 'not-a-uuid' : x)),
};
const PATH_IDS = { traversal: '..%2F..%2F..%2Fetc%2Fpasswd', sqli: "'%20OR%201%3D1--", nul: '%00', longid: 'x'.repeat(5000), notuuid: 'not-a-uuid' };

const results = [];
const rec = (o, role, variant, r) => {
  const lk = leaks(r);
  const bad = r.status >= 500 || r.status === 0 || lk.length > 0;
  results.push({ method: o.method, path: o.path, role, variant, status: r.status, error: r.json?.error, message: String(r.json?.message ?? r.text ?? '').slice(0, 200), leaks: lk, bad });
  if (bad) console.log('BAD', role, o.method, o.path, variant, '->', r.status, r.json?.error ?? '', String(r.json?.message ?? r.text ?? '').slice(0, 160), lk.join(' '));
};

let probed = 0;
for (const o of ops) {
  if (EXCLUDE.some((re) => re.test(o.path))) continue;
  const role = holder(o.gate);
  if (!role) continue;
  probed++;
  const t = (await tok(role)).token;
  const H = { 'x-reauth-password': PASSWORD };
  const schema = schemaOf(o);
  const base = schema ? (sample(schema, 0, randomUUID) ?? {}) : (o.method === 'DELETE' ? undefined : {});
  const fill = (id) => o.path.replace(/\{[^}]+\}/g, () => id ?? randomUUID());
  // path-id abuse
  if (/\{[^}]+\}/.test(o.path)) for (const [k, id] of Object.entries(PATH_IDS)) rec(o, role, `path:${k}`, await raw(o.method, fill(id), { token: t, body: base, headers: H }));
  // body abuse (random-uuid path)
  if (schema) for (const [k, fn] of Object.entries(bodyVariants)) rec(o, role, `body:${k}`, await raw(o.method, fill(), { token: t, body: fn(base), headers: H }));
  if (o.method !== 'DELETE') {
    rec(o, role, 'raw:badjson', await raw(o.method, fill(), { token: t, rawBody: '{"a":', headers: { ...H, 'content-type': 'application/json' } }));
    rec(o, role, 'raw:array', await raw(o.method, fill(), { token: t, rawBody: '[1,2,3]', headers: { ...H, 'content-type': 'application/json' } }));
    rec(o, role, 'raw:textplain', await raw(o.method, fill(), { token: t, rawBody: 'hello', headers: { ...H, 'content-type': 'text/plain' } }));
    rec(o, role, 'raw:proto', await raw(o.method, fill(), { token: t, rawBody: JSON.stringify({ ...(base ?? {}) }).replace(/^\{/, '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"polluted":1}},'), headers: { ...H, 'content-type': 'application/json' } }));
  }
}
const statusHist = results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
const f = save('input-fuzz', { opsProbed: probed, requests: results.length, statusHist, bad: results.filter((r) => r.bad), results });
console.log('ops probed', probed, 'requests', results.length, 'bad', results.filter((r) => r.bad).length, statusHist, f);
