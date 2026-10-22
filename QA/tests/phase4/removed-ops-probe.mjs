// Operations removed since the inventory (gates-head.mjs REMOVED_OPS) must be gone for every role:
// 404 from Fastify's not-found handler, never a 2xx / 400 / 403 from a surviving handler.
//   PERF_TARGET=https://localhost:3111 P4_OUT=QA/results/phase4/2026-10-22 MSYS_NO_PATHCONV=1 node QA/tests/phase4/removed-ops-probe.mjs
import fs from 'node:fs';
import { call } from '../lib/qa.mjs';
import { phase4Tokens } from './accounts.mjs';
import { REMOVED_OPS } from './gates-head.mjs';

const OUT = process.env.P4_OUT ?? 'QA/results/phase4';
const t = await phase4Tokens();
const rows = [];
for (const op of REMOVED_OPS) {
  for (const [role, { token }] of Object.entries(t)) {
    const r = await call(op.method, op.path, { token, body: { channel: 'EMAIL', to: 'qa-probe@example.invalid', subject: 'QA probe', body: 'QA probe' } });
    rows.push({ ...op, role, status: r.status, error: r.json?.error, message: r.json?.message, gone: r.status === 404 });
    console.log(r.status === 404 ? 'GONE   ' : 'PRESENT', role.padEnd(12), op.method, op.path, r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 60));
  }
}
fs.writeFileSync(`${OUT}/removed-ops-probe.json`, JSON.stringify(rows, null, 1));
