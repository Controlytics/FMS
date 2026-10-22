// Second pass over the sweep's INCONCLUSIVE rows (schema validation answered before the gate).
// Re-sends with a schema-valid body built from the OpenAPI spec — including DELETEs, several of
// which require a body (`_changeReason`, `reason`). Ids are random UUIDs, so a request that passes
// the gate dies in the handler. Never sent: outbound-call ops (SMS/email/send/test-url/fetch-readings).
//   MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/retry-inconclusive.mts
import fs from 'node:fs';
import { call } from '../lib/qa.mjs';
import { buildRequest, gen } from './bodygen.mjs';
import { phase4Tokens } from './accounts.mjs';

// P4_SPEC / P4_OUT as in role-sweep.mts (re-run at a later commit).
const spec = JSON.parse(fs.readFileSync(process.env.P4_SPEC ?? 'QA/results/phase4/openapi.json', 'utf8'));
const file = `${process.env.P4_OUT ?? 'QA/results/phase4'}/role-sweep-latest.json`;
const d = JSON.parse(fs.readFileSync(file, 'utf8'));
const OUTBOUND = /notification-settings\/(send|sms\/test|email\/test)|equipment-groups\/(test-url|fetch-readings)|ldap\/test-connection/;
const tokens = await phase4Tokens();
const retried: any[] = [];
for (const r of d.rows.filter((x: any) => x.verdict === 'INCONCLUSIVE')) {
  if (OUTBOUND.test(r.path)) { r.retry = 'not re-sent: outbound call'; continue; }
  const rq = buildRequest(spec, r.method === 'DELETE' ? 'POST' : r.method, r.path, { full: true }); // url only
  const p = spec.paths[r.path] ?? spec.paths[r.path.replace(/\/$/, '')];
  const schema = p?.[r.method.toLowerCase()]?.requestBody?.content?.['application/json']?.schema;
  const body = schema ? gen(schema) : undefined;
  const url = buildRequest(spec, r.method, r.path, { full: true }).url;
  const res: any = await call(r.method, url, { token: tokens[r.role].token, body });
  const j = res.json ?? {};
  let observed = 'PASS';
  if (res.status === 403 && j.error === 'FORBIDDEN' && (!j.message || /Insufficient permissions/.test(j.message))) observed = 'GATE_DENY';
  else if (res.status === 400 && j.error === 'VALIDATION_ERROR' && (!j.message || (Array.isArray(j.details) && j.details.some((x: any) => 'keyword' in x)))) observed = 'INCONCLUSIVE';
  const verdict = observed === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : r.expected === 'DENY' ? (observed === 'GATE_DENY' ? 'OK' : 'LEAK') : (observed === 'PASS' ? 'OK' : 'REFUSED_BUT_GRANTED');
  Object.assign(r, { retry: { url, body, status: res.status, error: j.error, message: String(j.message ?? '').slice(0, 200), observed }, verdict });
  retried.push(r);
  console.log(verdict.padEnd(14), r.role.padEnd(12), r.method.padEnd(6), r.path.padEnd(56), res.status, j.error ?? '', String(j.message ?? '').slice(0, 70));
}
d.tally = d.rows.reduce((m: any, x: any) => ((m[x.verdict] = (m[x.verdict] ?? 0) + 1), m), {});
d.retriedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(d, null, 1));
console.log('tally after retry', d.tally);
