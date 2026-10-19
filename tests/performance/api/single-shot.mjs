// Times each URL ONCE, one at a time (no concurrency), so a slow endpoint's own
// cost is separated from queueing. Localhost perf instance only.
//   node tests/performance/api/single-shot.mjs [--role OPERATOR] url1 url2 ...
import { makeAgent, request } from '../lib/http.mjs';
import { getTokens } from '../lib/auth.mjs';

const args = process.argv.slice(2);
const ri = args.indexOf('--role');
const roles = ri >= 0 ? [args.splice(ri, 2)[1]] : undefined;
const target = process.env.PERF_TARGET ?? 'https://localhost:3100';
const u = new URL(target);
if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port === '3000') throw new Error(`refusing ${target}`);
const [user] = await getTokens(target, 1, { roles });
const ctx = { target, agent: makeAgent(target), token: user.token };
console.log(`as ${user.username} (${user.role})`);
for (const url of args) {
  const r = await request(ctx, 'GET', url, { timeoutMs: 120000 });
  console.log(`${String(Math.round(r.ms)).padStart(7)} ms  ${String(r.status).padStart(3)}  ${(r.bytes / 1024).toFixed(0).padStart(8)} KB  ${url}`);
}
process.exit(0);
