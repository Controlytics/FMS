// QA Phase 5 — generated sweep over every operation in
// docs/production-readiness/03_API_ENDPOINT_INVENTORY.md, against the QA clone (:3104).
//
//   Phase A  (all operations, NO token):  expect 401 unless the route is PUBLIC.
//            Public writes and logout/refresh are skipped (a public write could create data;
//            the guest request writes an audit row by design).
//   Phase B  (GET operations that take a path id, ADMIN + OPERATOR tokens):
//            id = "not-a-uuid"  -> expect 400/404/403, never 5xx
//            id = random uuid   -> expect 404 (or 403), never 5xx; 400 DATA_CONSTRAINT is reported as a
//                                   finding (a missing record should be a 404)
//   Every response body is checked for leaked internals (stack frames, file paths, Prisma text).
//
// No write is sent with a real token. Results: QA/results/sweep/endpoint-sweep-<ts>.json
//   PERF_TARGET=https://localhost:3104 node QA/tests/api/endpoint-sweep.mjs   (Git Bash: export MSYS_NO_PATHCONV=1)
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { call, tokenFor, QA_RESULTS, TARGET } from '../lib/qa.mjs';
import { REPO } from '../../../tests/performance/lib/http.mjs';

const inv = fs.readFileSync(path.join(REPO, 'docs/production-readiness/03_API_ENDPOINT_INVENTORY.md'), 'utf8');
const ops = [];
let module = '';
for (const line of inv.split('\n')) {
  const h = line.match(/^### (.+?) \(\d+\)/);
  if (h) module = h[1];
  const m = line.match(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \| ([^|]+) \|/);
  if (m && module && line.split('|').length >= 10) ops.push({ module, method: m[1], path: m[2], gate: m[3].trim() });
}

const SKIP_ALWAYS = [/\/api\/auth\/logout/, /\/api\/auth\/refresh/, /\/api\/auth\/beacon-logout/];
const LEAK = [/node_modules/i, /\bat [A-Za-z_.$]+ \(/, /[A-Z]:\\\\/, /\.ts:\d+/, /prisma\.[a-z]+\.[a-z]+\(/i, /Invalid `prisma/i, /PrismaClient/i];
const leaks = (json) => { const s = JSON.stringify(json ?? ''); return LEAK.filter((r) => r.test(s)).map(String); };
const fill = (p, id) => p.replace(/\{[^}]+\}/g, id).replace(/:[A-Za-z]+/g, id);
const hasParam = (p) => /\{[^}]+\}|\/:[A-Za-z]+/.test(p);

const results = [];
const finding = (o, phase, note, res) => results.push({ phase, module: o.module, method: o.method, path: o.path, gate: o.gate, note, status: res.status, error: res.json?.error, message: res.json?.message?.toString().slice(0, 160), leaks: leaks(res.json) });

// Phase A — no token
for (const o of ops) {
  if (SKIP_ALWAYS.some((r) => r.test(o.path))) continue;
  const isPublic = /PUBLIC/i.test(o.gate);
  if (isPublic && o.method !== 'GET') continue;
  const url = fill(o.path, randomUUID());
  const res = await call(o.method, url, { token: '', body: o.method === 'GET' || o.method === 'DELETE' ? undefined : {} });
  const ok = isPublic ? res.status < 500 : res.status === 401;
  if (!ok || leaks(res.json).length) finding(o, 'A-no-token', isPublic ? 'public route errored' : 'expected 401 without a token', res);
}

// Phase B — GET with a bad id, two roles
const roles = ['ADMIN', 'OPERATOR'];
const tokens = {};
for (const r of roles) tokens[r] = (await tokenFor(r)).token;
for (const o of ops.filter((x) => x.method === 'GET' && hasParam(x.path))) {
  for (const r of roles) {
    for (const [label, id] of [['malformed', 'not-a-uuid'], ['unknown', randomUUID()]]) {
      const res = await call('GET', fill(o.path, id), { token: tokens[r] });
      const lk = leaks(res.json);
      if (res.status >= 500 || res.status === 0) finding(o, `B-${label}-${r}`, 'server error on a bad id', res);
      else if (lk.length) finding(o, `B-${label}-${r}`, 'response leaks internals', res);
      else if (label === 'unknown' && res.status === 400 && res.json?.error === 'DATA_CONSTRAINT') finding(o, `B-${label}-${r}`, 'missing record answered 400 DATA_CONSTRAINT, not 404', res);
      else if (label === 'unknown' && res.status === 200) finding(o, `B-${label}-${r}`, 'unknown id answered 200 (check: empty result or wrong lookup?)', res);
    }
  }
}

const dir = path.join(QA_RESULTS, 'sweep');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `endpoint-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const byNote = results.reduce((m, r) => ((m[r.note] = (m[r.note] ?? 0) + 1), m), {});
fs.writeFileSync(file, JSON.stringify({ target: TARGET, operations: ops.length, findings: results.length, byNote, results }, null, 2));
console.log(`operations parsed: ${ops.length}; findings: ${results.length}`);
for (const [k, v] of Object.entries(byNote)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`results: ${file}`);
