// CPU profile of ONE getBatchStates() call, in-process (no HTTP), against a _perf
// database: where does the time go — Postgres, or Node building the response?
// Read-only. Run from apps/api:
//   DATABASE_URL=postgresql://digilog:...@localhost:5432/digilog_day1_perf npx tsx ../../tests/performance/profile/cpu-profile-batch-states.mts
import { Session } from 'node:inspector/promises';
process.env.NODE_ENV = 'development';   // lib/prisma emits query events only outside production
process.env.SLOW_QUERY_MS = '100000000';
const dbName = new URL(process.env.DATABASE_URL ?? 'x://h/none').pathname.slice(1);
if (!/_perf\d*$/.test(dbName)) { console.error(`refusing database "${dbName}" - only *_perf`); process.exit(2); }

const { prisma } = await import('../../../apps/api/src/lib/prisma.js');
const mod: any = await import('../../../apps/api/src/modules/filter-operations/filter-operations.service.js');
const svc = mod.filterOperationsService ?? new mod.FilterOperationsService();
const ctx = { userId: 'perf_user_001', userSub: '00000000-0000-0000-0000-000000000000', userRole: 'OPERATOR', ipAddress: '127.0.0.1', sessionId: 'profile' };

let queries = 0, dbMs = 0;
const shapes = new Map<string, { n: number; ms: number }>();
prisma.$on('query' as never, (e: any) => {
  queries++; dbMs += e.duration;
  const k = String(e.query).replace(/"public"\./g, '').replace(/\$\d+/g, '?').replace(/\s+/g, ' ').slice(0, 220);
  const g = shapes.get(k) ?? { n: 0, ms: 0 }; g.n++; g.ms += e.duration; shapes.set(k, g);
});

await svc.getBatchStates(ctx);                 // warm-up (Prisma engine, caches)
queries = 0; dbMs = 0; shapes.clear();
const session = new Session(); session.connect();
await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 500 });
await session.post('Profiler.start');
const t0 = performance.now();
const result = await svc.getBatchStates(ctx);
const wall = performance.now() - t0;
const t1 = performance.now(); const body = JSON.stringify(result); const serMs = performance.now() - t1;
const { profile } = await session.post('Profiler.stop');

console.log(`filters ${Object.keys(result.states).length}  wall ${wall.toFixed(0)} ms  prisma ${queries} queries, ${dbMs} ms summed  JSON.stringify ${serMs.toFixed(0)} ms -> ${(body.length / 1048576).toFixed(1)} MB`);
// self time per function (sampling profile: node id -> samples)
const byNode = new Map<number, number>();
for (let i = 0; i < profile.samples.length; i++) byNode.set(profile.samples[i], (byNode.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
const self = new Map<string, number>();
for (const n of profile.nodes) {
  const cf = n.callFrame; const url = cf.url.replace(/.*21cfrlogbook-DigitalFMS[\/]/, '').replace(/\?.*$/, '');
  const key = `${cf.functionName || '(anonymous)'}  ${url}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (byNode.get(n.id) ?? 0) / 1000);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`\nsampled ${total.toFixed(0)} ms; top self-time:`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${v.toFixed(0).padStart(7)} ms ${(100 * v / total).toFixed(0).padStart(3)}%  ${k}`);
// group by file
const byFile = new Map<string, number>();
for (const [k, v] of self) { const f = k.split('  ')[1].replace(/:\d+$/, ''); byFile.set(f, (byFile.get(f) ?? 0) + v); }
console.log('\nby file:');
for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${v.toFixed(0).padStart(7)} ms ${(100 * v / total).toFixed(0).padStart(3)}%  ${k}`);
console.log('\nquery shapes (count, summed ms):');
for (const [k, g] of [...shapes].sort((a, b) => b[1].n - a[1].n).slice(0, 14)) console.log(`${String(g.n).padStart(6)} x ${String(g.ms).padStart(6)} ms  ${k}`);
await prisma.$disconnect();
process.exit(0);
