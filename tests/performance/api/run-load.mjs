#!/usr/bin/env node
// Load runner for the DigiLog/FMS API. Dependency-free (Node >= 20).
//
//   node tests/performance/api/run-load.mjs --scenario web-users --profile normal
//   node tests/performance/api/run-load.mjs --scenario web-users --vus 120 --duration 600 --ramp 60
//
// Safety (refuses to start otherwise):
//   - target must be localhost / 127.0.0.1 and NOT port 3000 (the dev API) unless --allow-target
//   - /api/health on the target must answer 200
//   - PERF_CONFIRM=yes must be set for anything above the smoke profile
// Stop: Ctrl-C (writes partial results), or the automatic abort guard below.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Metrics, makeAgent, request, RESULTS, sleep } from '../lib/http.mjs';
import { getTokens } from '../lib/auth.mjs';

const PROFILES = {
  smoke:    { vus: 5,   duration: 120,  ramp: 10 },
  baseline: { vus: 25,  duration: 300,  ramp: 30 },
  normal:   { vus: 50,  duration: 600,  ramp: 60 },
  high:     { vus: 100, duration: 600,  ramp: 60 },
  peak:     { vus: 300, duration: 600,  ramp: 120 },
  stress:   { vus: 200, duration: 600,  ramp: 60, speed: 3 },
  spike:    { vus: 200, duration: 300,  ramp: 10 },
  soak30:   { vus: 100, duration: 1800, ramp: 60 },
  soak2h:   { vus: 100, duration: 7200, ramp: 60 },
};

function args() {
  const a = process.argv.slice(2); const o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) {
    const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'; o[k] = v;
  }
  return o;
}

const opt = args();
const profile = { ...(PROFILES[opt.profile ?? 'smoke'] ?? {}), };
for (const k of ['vus', 'duration', 'ramp', 'speed']) if (opt[k]) profile[k] = Number(opt[k]);
profile.speed ??= 1;
const target = opt.target ?? process.env.PERF_TARGET ?? 'https://localhost:3100';
const scenarioName = opt.scenario ?? 'web-users';
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${scenarioName}_${opt.profile ?? 'custom'}_${profile.vus}vu`;

// ---- safety ---------------------------------------------------------------
const tu = new URL(target);
if (!opt['allow-target'] && (!['localhost', '127.0.0.1'].includes(tu.hostname) || tu.port === '3000')) {
  console.error(`Refusing target ${target}: only a local perf instance (not :3000) is allowed. Pass --allow-target to override deliberately.`);
  process.exit(2);
}
if ((opt.profile ?? 'smoke') !== 'smoke' && process.env.PERF_CONFIRM !== 'yes') {
  console.error('Set PERF_CONFIRM=yes to run anything heavier than the smoke profile.');
  process.exit(2);
}
const agent0 = makeAgent(target);
const health = await request({ target, agent: agent0 }, 'GET', '/api/health');
if (health.status !== 200) { console.error(`Target health check failed (${health.status}). Is the perf API running?`); process.exit(2); }

// ---- run ------------------------------------------------------------------
const scenario = await import(pathToFileURL(path.join(import.meta.dirname, 'scenarios', `${scenarioName}.mjs`)).href);
const users = await getTokens(target, profile.vus, { roles: scenario.roles, minRemainingSec: profile.ramp + profile.duration + 180 });
const metrics = new Metrics();
const state = { stopped: false, abortReason: null };
const shared = scenario.setup ? await scenario.setup({ target, agent: agent0, token: users[0].token, users }) : {};

const stopAt = Date.now() + profile.duration * 1000;
process.on('SIGINT', () => { state.stopped = true; state.abortReason = 'manual stop (Ctrl-C)'; });

// Abort guard: three consecutive 10 s windows with >10 % errors or p95 > 10 s.
const guard = setInterval(() => {
  const w = metrics.lastWindows(4).slice(0, 3);
  if (w.length < 3) return;
  const bad = w.every((x) => {
    const s = [...x.lat].sort((a, b) => a - b); const p95 = s[Math.floor(s.length * 0.95)] ?? 0;
    return x.err / x.n > 0.10 || p95 > 10_000;
  });
  if (bad) { state.stopped = true; state.abortReason = 'abort guard: >10% errors or p95 > 10s for 30s'; }
}, 5000);

const progress = setInterval(() => {
  const w = metrics.lastWindows(2)[0];
  if (w) process.stdout.write(`t=${w.t}s rps=${(w.n / 10).toFixed(1)} err=${w.err} active=${active}\n`);
}, 10_000);

let active = 0;
const vuPromises = users.map(async (u, i) => {
  await sleep((profile.ramp * 1000 * i) / users.length);
  if (state.stopped) return;
  active++;
  const ctx = { target, agent: makeAgent(target), token: u.token, user: u, metrics, speed: profile.speed, index: i, shared,
    get stopped() { return state.stopped || Date.now() >= stopAt; } };
  try { await scenario.vu(ctx); } catch (e) { metrics.record('vu-crash', 0, 0, 0, { error: String(e?.stack ?? e) }); }
  active--;
});
await Promise.all(vuPromises);
clearInterval(guard); clearInterval(progress);

const summary = metrics.summary();
const out = { runId, target, scenario: scenarioName, profile: { name: opt.profile ?? 'custom', ...profile },
  abortReason: state.abortReason, startedAt: new Date(metrics.t0).toISOString(), ...summary };
fs.mkdirSync(path.join(RESULTS, 'runs'), { recursive: true });
const file = path.join(RESULTS, 'runs', `${runId}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
fs.writeFileSync(file.replace(/\.json$/, '.csv'),
  'label,n,p50,p95,p99,max,avgKB,errors,status\n' +
  summary.endpoints.map((r) => [JSON.stringify(r.label), r.n, r.p50, r.p95, r.p99, r.max, r.avgKB, r.errors, JSON.stringify(JSON.stringify(r.status))].join(',')).join('\n'));

console.log(`\n== ${runId}`);
console.log(`requests ${summary.requests}  rps ${summary.rps}  errors ${summary.errorRatePct}%  p50 ${summary.p50}  p95 ${summary.p95}  p99 ${summary.p99} ms`);
if (state.abortReason) console.log(`STOPPED: ${state.abortReason}`);
console.log('slowest endpoints (p95):');
for (const r of summary.endpoints.slice(0, 12)) console.log(`  ${String(r.p95).padStart(8)} ms  n=${String(r.n).padStart(6)}  ${r.label}  ${JSON.stringify(r.status)}`);
console.log(`results: ${file}`);
process.exit(0);
