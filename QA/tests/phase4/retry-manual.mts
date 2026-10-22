// Third pass: INCONCLUSIVE rows whose body schema bodygen.mjs cannot satisfy (if/then, untyped
// properties) are re-sent with a hand-written body. Random ids only, so a request past the gate
// dies in the handler. Updates <P4_OUT>/role-sweep-latest.json in place (row.manual = the retry).
//   PERF_TARGET=https://localhost:3111 P4_OUT=QA/results/phase4/2026-10-22 MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/retry-manual.mts
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { call } from '../lib/qa.mjs';
import { phase4Tokens } from './accounts.mjs';

const file = `${process.env.P4_OUT ?? 'QA/results/phase4'}/role-sweep-latest.json`;
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const MANUAL: Record<string, () => any> = {
  // schema: allOf if assigneeType=USER then required userId (dashboards/routes.ts, changed after 4ddd2cd)
  'POST /api/dashboards/{id}/assign': () => ({ assigneeType: 'USER', userId: randomUUID() }),
  // dataSnapshot has no type in the schema, so bodygen leaves it out
  'POST /api/report-reviews/': () => ({ reportType: 'QA_PROBE', title: 'QA phase4 probe', dataSnapshot: {} }),
};
const tokens = await phase4Tokens();
for (const r of d.rows.filter((x: any) => x.verdict === 'INCONCLUSIVE' && MANUAL[`${x.method} ${x.path}`])) {
  const url = r.path.replace(/\{[^}]+\}/g, () => randomUUID());
  const body = MANUAL[`${r.method} ${r.path}`]();
  const res: any = await call(r.method, url, { token: tokens[r.role].token, body });
  const j = res.json ?? {};
  const observed = res.status === 403 && j.error === 'FORBIDDEN' && (!j.message || /Insufficient permissions/.test(j.message)) ? 'GATE_DENY'
    : res.status === 400 && j.error === 'VALIDATION_ERROR' ? 'INCONCLUSIVE' : 'PASS';
  r.manual = { url, body, status: res.status, error: j.error, message: String(j.message ?? '').slice(0, 200), observed };
  r.verdict = observed === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : r.expected === 'DENY' ? (observed === 'GATE_DENY' ? 'OK' : 'LEAK') : (observed === 'PASS' ? 'OK' : 'REFUSED_BUT_GRANTED');
  console.log(r.verdict.padEnd(14), r.role.padEnd(12), r.method, r.path, res.status, j.error ?? '', String(j.message ?? '').slice(0, 60));
}
d.tally = d.rows.reduce((m: any, x: any) => ((m[x.verdict] = (m[x.verdict] ?? 0) + 1), m), {});
fs.writeFileSync(file, JSON.stringify(d, null, 1));
console.log('tally after manual retry', d.tally);
