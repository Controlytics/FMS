// Saves the JSON body of GET urls from a localhost perf instance, to diff an
// old build against a new one (key order kept; volatile fields stripped by --drop).
//   node tests/performance/equivalence/capture.mjs <outDir> --role SUPERVISOR url...
import fs from 'node:fs';
import path from 'node:path';
import { makeAgent, request } from '../lib/http.mjs';
import { getTokens } from '../lib/auth.mjs';
const args = process.argv.slice(2);
const outDir = args.shift();
const ri = args.indexOf('--role');
const roles = ri >= 0 ? [args.splice(ri, 2)[1]] : undefined;
const target = process.env.PERF_TARGET ?? 'https://localhost:3100';
const u = new URL(target);
if (!['localhost', '127.0.0.1'].includes(u.hostname) || u.port === '3000') throw new Error(`refusing ${target}`);
const [user] = await getTokens(target, 1, { roles });
const ctx = { target, agent: makeAgent(target), token: user.token };
fs.mkdirSync(outDir, { recursive: true });
for (const url of args) {
  const r = await request(ctx, 'GET', url, { timeoutMs: 120000, parse: true });
  const f = path.join(outDir, url.replace(/[^a-z0-9]+/gi, '_') + '.json');
  fs.writeFileSync(f, JSON.stringify(r.json));
  console.log(`${r.status} ${Math.round(r.ms)} ms ${(r.bytes / 1024).toFixed(0)} KB -> ${f}`);
}
process.exit(0);
