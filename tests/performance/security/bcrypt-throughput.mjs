// How many password checks per second can the API process do?
// Login and every re-auth (e-signature) run one bcrypt compare at the app's cost
// factor on libuv's threadpool (UV_THREADPOOL_SIZE, default 4). Run from apps/api:
//   node ../../tests/performance/security/bcrypt-throughput.mjs [rounds] [concurrent]
import bcrypt from 'bcrypt';
const rounds = Number(process.argv[2] ?? 12), n = Number(process.argv[3] ?? 40);
const hash = await bcrypt.hash('PerfTest@2026!', rounds);
let t = performance.now(); await bcrypt.compare('PerfTest@2026!', hash); const one = performance.now() - t;
t = performance.now();
const lat = await Promise.all(Array.from({ length: n }, async () => { const s = performance.now(); await bcrypt.compare('PerfTest@2026!', hash); return performance.now() - s; }));
const total = performance.now() - t; lat.sort((a, b) => a - b);
console.log(JSON.stringify({ rounds, threadpool: process.env.UV_THREADPOOL_SIZE ?? '4 (default)', singleMs: +one.toFixed(0),
  concurrent: n, totalMs: +total.toFixed(0), perSec: +(n / total * 1000).toFixed(1),
  p50: +lat[Math.floor(n * .5)].toFixed(0), p95: +lat[Math.floor(n * .95)].toFixed(0), max: +lat[n - 1].toFixed(0) }));
