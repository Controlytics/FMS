// Row-by-row diff of two role-sweep results (role x method x path).
//   node QA/tests/phase4/diff-runs.mjs <old role-sweep json> <new role-sweep json> [out.json]
// Reports: added/removed rows, gate-outcome changes (GATE_DENY <-> PASS, the thing that matters),
// verdict changes, expectation changes (route gate moved) and status-only changes (same outcome).
import fs from 'node:fs';

const [oldF, newF, outF] = process.argv.slice(2);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).rows;
const eff = (r) => {
  const x = r.manual ?? r.retry ?? r;
  return { observed: x.observed ?? r.observed, status: x.status ?? r.status, error: x.error ?? r.error, message: x.message ?? r.message };
};
const key = (r) => `${r.role}|${r.method}|${r.path}`;
const O = new Map(load(oldF).map((r) => [key(r), r]));
const N = new Map(load(newF).map((r) => [key(r), r]));
const out = { added: [], removed: [], outcome: [], verdict: [], expectation: [], statusOnly: [], skipChange: [] };
for (const [k, n] of N) {
  const o = O.get(k);
  if (!o) { out.added.push({ k, new: { ...eff(n), verdict: n.verdict, expected: n.expected } }); continue; }
  const eo = eff(o), en = eff(n);
  const rec = { k, gateOld: o.gate, gateNew: n.gate, gateSrc: n.gateSrc, gateCommit: n.gateCommit,
    old: { ...eo, verdict: o.verdict, expected: o.expected }, new: { ...en, verdict: n.verdict, expected: n.expected } };
  if ((o.observed === 'SKIPPED') !== (n.observed === 'SKIPPED')) out.skipChange.push(rec);
  if (o.expected !== n.expected) out.expectation.push(rec);
  const cls = (x) => (x === 'GATE_DENY' ? 'DENY' : x === 'PASS' ? 'PASS' : x);
  if (cls(eo.observed) !== cls(en.observed) && !(o.observed === 'SKIPPED' || n.observed === 'SKIPPED')) out.outcome.push(rec);
  else if (o.verdict !== n.verdict) out.verdict.push(rec);
  else if (eo.status !== en.status || eo.error !== en.error) out.statusOnly.push(rec);
}
for (const k of O.keys()) if (!N.has(k)) out.removed.push({ k });
if (outF) fs.writeFileSync(outF, JSON.stringify(out, null, 1));
for (const [name, list] of Object.entries(out)) console.log(name.padEnd(12), list.length);
const show = (r) => `${r.k.padEnd(70)} ${String(r.old?.observed).padEnd(10)}${String(r.old?.status ?? '').padEnd(4)} ${String(r.old?.error ?? '').padEnd(22)} -> ${String(r.new?.observed).padEnd(10)}${String(r.new?.status ?? '').padEnd(4)} ${String(r.new?.error ?? '').padEnd(22)} ${r.gateCommit ? `[gate ${r.gateOld} -> ${r.gateNew} @${r.gateCommit}]` : ''}`;
for (const name of ['outcome', 'verdict', 'expectation', 'skipChange', 'added', 'removed']) {
  if (!out[name].length) continue;
  console.log(`\n== ${name}`);
  for (const r of out[name]) console.log(show(r));
}
