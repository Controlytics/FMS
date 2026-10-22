// OD-01 (1f8b8de / 8372478, operator decision 2026-10-22): listed actions ALWAYS take the password.
// From a sweep result: every row whose route carries an always-on action and whose role got PAST the
// permission gate -> did the answer come from the re-auth gate (401 REAUTH_REQUIRED)? A pass with any
// other status means something ran before the signature (validation, lookup) or the signature is missing.
//   P4_OUT=QA/results/phase4/2026-10-22 npx tsx QA/tests/phase4/od01-check.mts
import fs from 'node:fs';
import { sql } from '../lib/qa.mjs';
import { ALWAYS_REAUTH } from './gates-head.mjs';

const OUT = process.env.P4_OUT ?? 'QA/results/phase4';
const d = JSON.parse(fs.readFileSync(`${OUT}/role-sweep-latest.json`, 'utf8'));
const policy: Record<string, string[]> = JSON.parse(sql(`select config_value::text from system_config where config_key='action-reauth'`));
const eff = (r: any) => r.manual ?? r.retry ?? r;
const out: any[] = [];
for (const r of d.rows) {
  if (r.observed === 'SKIPPED') continue;
  const e = eff(r);
  if ((e.observed ?? r.observed) !== 'PASS') continue;
  const acts = String(r.reauth || '').replace(/\(.*?\)/g, '').replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter((a) => /^[A-Z_]+$/.test(a));
  const always = acts.filter((a) => ALWAYS_REAUTH.has(a));
  if (!always.length) continue;
  const inPolicy = acts.some((a) => (policy[a] ?? []).includes(r.role));
  out.push({ role: r.role, method: r.method, path: r.path, actions: acts, alwaysActions: always, policyHasRole: inPolicy,
    status: e.status, error: e.error, message: e.message, signed: e.status === 401 && e.error === 'REAUTH_REQUIRED' });
}
fs.writeFileSync(`${OUT}/od01-check.json`, JSON.stringify(out, null, 1));
for (const x of out) console.log(`${x.signed ? 'REAUTH ' : 'NO-401 '}${x.role.padEnd(12)} ${x.method.padEnd(6)} ${x.path.padEnd(52)} ${x.actions.join('/').padEnd(40)} policyHasRole=${String(x.policyHasRole).padEnd(5)} -> ${x.status} ${x.error ?? ''} ${String(x.message ?? '').slice(0, 60)}`);
console.log('rows', out.length, 'signed', out.filter((x) => x.signed).length, 'signed although the policy does not list the role', out.filter((x) => x.signed && !x.policyHasRole).length);
