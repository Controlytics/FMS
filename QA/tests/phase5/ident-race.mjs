// Phase 5 re-run: concurrent RFID identifier writes (D-DB-2, df5e6a1 "one identifier per filter holds
// under concurrency"). Fixtures are created here so no shared filter is touched:
//   SUPERVISOR creates two filters QAP5-RACE-<n> under the quiet AHU-3 (filter workflow is ON on the
//   clone, so they start PENDING_REVIEW), MANAGER reviews, QA approves -> operable, untagged.
// Trials (OPERATOR: FILTER_RFID_MANAGE + ASSET_IDENTIFIER_CREATE/DELETE, no re-auth policy):
//   A  2 simultaneous assigns, different tags, F1 untagged            -> exactly one 201, F1 holds 1 tag
//   B  5 simultaneous assigns, different tags, F2 untagged            -> exactly one 201, F2 holds 1 tag
//   C  2 simultaneous replaceExisting on F1, different new tags        -> F1 holds exactly 1 tag
//   D  one NEW tag, replaceExisting, to F1 and F2 at the same moment   -> tag on exactly one filter, each <= 1
//   E  delete F2's tag while a replaceExisting on F2 runs              -> F2 holds 0 or 1 tag, never 2, no 5xx
// Every trial is checked in the database. Cleanup: both filters are retired at the end (SUPERVISOR,
// password), which keeps their history and takes them out of the tree.
import { randomBytes } from 'node:crypto';
import { raw, tok, save, sql, PASSWORD, leaks } from './lib5.mjs';

const PW = { 'x-reauth-password': PASSWORD };
const out = { trials: [] };
const tag = () => 'E2801170' + randomBytes(6).toString('hex').toUpperCase();
const tagsOf = (id) => sql(`select coalesce(string_agg(identifier_value, ',' order by identifier_value),'') from asset_identifiers where asset_id='${id}'`);
const holders = (v) => sql(`select coalesce(string_agg(asset_id::text, ','),'') from asset_identifiers where upper(identifier_value)=upper('${v}')`);
const slim = (r) => ({ status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 140), leaks: leaks(r) });

const ahu = sql(`select a.id from asset_instances a join asset_templates t on t.id=a.template_id where t.template_kind='AHU' and a.is_active and a.name='AHU-3'`);
const tpl = sql(`select id from asset_templates where template_kind='FILTER' limit 1`);
const sv = (await tok('SUPERVISOR')).token, mg = (await tok('MANAGER')).token, qa = (await tok('QA')).token, op = (await tok('OPERATOR')).token;

// fixtures
const stamp = Date.now().toString(36).toUpperCase();
const ids = [];
for (const n of [1, 2]) {
  const r = await raw('POST', '/api/assets/instances', { token: sv, body: { name: `QAP5-RACE-${stamp}-${n}`, templateId: tpl, parentId: ahu, status: 'Active' }, headers: PW });
  if (r.status !== 201) { console.log('create failed', r.status, r.text); process.exit(1); }
  ids.push(r.json.id ?? r.json.data?.id);
}
const rv = await raw('POST', '/api/assets/instances/review', { token: mg, body: { filterIds: ids, remarks: 'qa p5 race fixture review' }, headers: PW });
const ap = await raw('POST', '/api/assets/instances/approve', { token: qa, body: { filterIds: ids, remarks: 'qa p5 race fixture approve' }, headers: PW });
out.fixtures = { ids, review: slim(rv), approve: slim(ap), state: sql(`select string_agg(name||':'||approval_status, ' ') from asset_instances where id in ('${ids.join("','")}')`) };
console.log('fixtures', out.fixtures.state, 'review', rv.status, 'approve', ap.status);
const [F1, F2] = ids;

const assign = (assetId, v, extra = {}) => raw('POST', '/api/assets/identifiers', { token: op, body: { assetId, identifierType: 'RFID', identifierValue: v, ...extra } });
async function trial(name, calls, check) {
  const res = await Promise.all(calls.map((f) => f()));
  const statuses = res.map((r) => r.status);
  const verdict = check(res);
  const rec = { name, statuses, errors: res.map((r) => r.json?.error ?? null), ...verdict };
  out.trials.push(rec);
  console.log(rec.pass ? 'PASS' : 'FAIL', name, JSON.stringify(statuses), JSON.stringify(rec.errors), verdict.note);
  return res;
}
const ok = (r) => r.status === 201 || r.status === 200;

await trial('A 2x assign F1', [() => assign(F1, tag()), () => assign(F1, tag())], (res) => {
  const t = tagsOf(F1).split(',').filter(Boolean);
  return { pass: res.filter(ok).length === 1 && t.length === 1 && res.every((r) => r.status < 500), note: `F1 tags=${t.length}` };
});
await trial('B 5x assign F2', Array.from({ length: 5 }, () => () => assign(F2, tag())), (res) => {
  const t = tagsOf(F2).split(',').filter(Boolean);
  return { pass: res.filter(ok).length === 1 && t.length === 1 && res.every((r) => r.status < 500), note: `F2 tags=${t.length}` };
});
await trial('C 2x replaceExisting F1', [() => assign(F1, tag(), { replaceExisting: true }), () => assign(F1, tag(), { replaceExisting: true })], (res) => {
  const t = tagsOf(F1).split(',').filter(Boolean);
  return { pass: t.length === 1 && res.every((r) => r.status < 500), note: `F1 tags=${t.length} ok=${res.filter(ok).length}` };
});
const shared = tag();
await trial('D same new tag -> F1 and F2', [() => assign(F1, shared, { replaceExisting: true }), () => assign(F2, shared, { replaceExisting: true })], (res) => {
  const h = holders(shared).split(',').filter(Boolean);
  const t1 = tagsOf(F1).split(',').filter(Boolean).length, t2 = tagsOf(F2).split(',').filter(Boolean).length;
  return { pass: h.length === 1 && t1 <= 1 && t2 <= 1 && res.every((r) => r.status < 500), note: `holders=${h.length} F1=${t1} F2=${t2}` };
});
const f2tag = sql(`select id from asset_identifiers where asset_id='${F2}' limit 1`);
await trial('E delete F2 tag || replace F2', [
  () => (f2tag ? raw('DELETE', `/api/assets/identifiers/${f2tag}`, { token: op }) : Promise.resolve({ status: 0 })),
  () => assign(F2, tag(), { replaceExisting: true }),
], (res) => {
  const t = tagsOf(F2).split(',').filter(Boolean).length;
  return { pass: t <= 1 && res.every((r) => r.status < 500), note: `F2 tags=${t} (had tag row ${f2tag || 'none'})` };
});

// cleanup: retire both fixtures (keeps history; out of the tree)
for (const id of ids) {
  const r = await raw('POST', `/api/filters/${id}/retire`, { token: sv, body: { remarks: 'qa p5 race fixture cleanup' }, headers: PW });
  console.log('retire', id, r.status, r.json?.error ?? '');
  out.cleanup = [...(out.cleanup ?? []), { id, ...slim(r) }];
}
out.final = sql(`select string_agg(a.name||':'||a.status||':'||(select count(*) from asset_identifiers i where i.asset_id=a.id), ' ') from asset_instances a where a.id in ('${ids.join("','")}')`);
console.log('final', out.final);
save('ident-race', out);
