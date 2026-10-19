// Where does an endpoint's time go? Builds the app IN-PROCESS (the e2e
// test-helper) against a _perf database, calls each URL once via inject, and
// records every Prisma query it ran with its duration. Read-only apart from the
// login (one audit row on the perf DB).
//
//   cd apps/api
//   DATABASE_URL=postgresql://digilog:...@localhost:5432/digilog_perf \
//     npx tsx ../../tests/performance/profile/profile-endpoints.mts --user perf_user_296 /api/assets/instances ...
process.env.NODE_ENV = 'development';      // lib/prisma only emits query events outside production
process.env.SLOW_QUERY_MS = '100000000';   // keep its own slow-query log quiet; we collect events below
process.env.LOG_DIR ??= new URL('../results/logs/profile', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const dbName = new URL(process.env.DATABASE_URL ?? 'x://h/none').pathname.slice(1);
if (!/_perf\d*$/.test(dbName)) { console.error(`refusing database "${dbName}" - only *_perf`); process.exit(2); }

const args = process.argv.slice(2);
const ui = args.indexOf('--user');
const username = ui >= 0 ? args.splice(ui, 2)[1] : 'perf_user_296';
const { buildApp } = await import('../../../apps/api/src/e2e/test-helper.js');
const { prisma } = await import('../../../apps/api/src/lib/prisma.js');

let current: Array<{ ms: number; q: string }> | null = null;
prisma.$on('query' as never, (e: any) => { current?.push({ ms: e.duration, q: e.query }); });

const app = await buildApp();
await app.ready();
const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'PerfTest@2026!', force: true, client: 'web' } });
const token = login.json().token;
if (!token) { console.error('login failed', login.statusCode, login.body.slice(0, 200)); process.exit(1); }
console.log(`as ${username}`);

for (const url of args) {
  current = [];
  const t0 = performance.now();
  const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const total = performance.now() - t0;
  const qs = current; current = null;
  const dbMs = qs.reduce((a, x) => a + x.ms, 0);
  console.log(`\n${url}  status ${r.statusCode}  ${(r.rawPayload.length / 1024).toFixed(0)} KB  total ${total.toFixed(0)} ms  db ${dbMs} ms in ${qs.length} queries  => node ${(total - dbMs).toFixed(0)} ms`);
  for (const x of [...qs].sort((a, b) => b.ms - a.ms).slice(0, 4)) {
    console.log(`   ${String(x.ms).padStart(6)} ms  ${x.q.replace(/\s+/g, ' ').replace(/"public"\./g, '').slice(0, 230)}`);
  }
}
await app.close();
await prisma.$disconnect();
process.exit(0);
