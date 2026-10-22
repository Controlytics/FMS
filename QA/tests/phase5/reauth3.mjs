// Phase 5 re-run, round 3: the offline-replay rules as they stand after 70adf40 (P5-02: the grant is
// honoured only on the six cycle-write routes in OFFLINE_REPLAY_ROUTES) and the 2026-10-22 /bypass
// rework (f745d8c). Random filter ids throughout: a request that clears every gate answers 404 and
// writes nothing, so the status says which gate (if any) stopped it.
import { randomUUID } from 'node:crypto';
import { raw, tok, save, PASSWORD } from './lib5.mjs';

const out = [];
const rid = () => randomUUID();
const show = (label, role, r, expect) => {
  const rec = { label, role, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160), expect };
  if (r.json?.results) rec.items = r.json.results.map((x) => ({ status: x.status, code: x.error?.code ?? x.code ?? x.error }));
  out.push(rec);
  console.log(label.padEnd(66), role.padEnd(12), '->', r.status, r.json?.error ?? '', rec.items ? JSON.stringify(rec.items) : String(rec.message).slice(0, 80), '| expect', expect);
};
const grant = async (role) => (await raw('POST', '/api/auth/offline-grant', { token: (await tok(role)).token, body: { _currentPassword: PASSWORD } })).json?.token;
const G = { SUPERVISOR: await grant('SUPERVISOR'), OPERATOR: await grant('OPERATOR') };
const sv = (await tok('SUPERVISOR')).token, op = (await tok('OPERATOR')).token, qa = (await tok('QA')).token, mg = (await tok('MANAGER')).token;
const replay = () => ({ offlinePerformedAt: new Date(Date.now() - 60000).toISOString(), clientOpId: rid() });
const term = { justification: 'qa p5 rerun probe terminate', tapeVersion: 1 };

// grant verification still runs on a replay route (round-2 foreign/forged cases moved here: /retire no longer reads the grant)
show('terminate (replay route), grant of ANOTHER user', 'SUPERVISOR', await raw('POST', `/api/filters/${rid()}/terminate-cycle`, { token: sv, body: { ...term, ...replay() }, headers: { 'x-offline-replay-token': G.OPERATOR } }), '401 OFFLINE_REPLAY_TOKEN_USER_MISMATCH');
show('terminate (replay route), forged grant', 'SUPERVISOR', await raw('POST', `/api/filters/${rid()}/terminate-cycle`, { token: sv, body: { ...term, ...replay() }, headers: { 'x-offline-replay-token': G.SUPERVISOR.slice(0, -4) + 'AAAA' } }), '401 OFFLINE_REPLAY_TOKEN_INVALID');
// /bypass is a replay route: a grant without the replay fields is refused before anything else
const byp = { targetState: 'WASH_OUT', justification: 'qa p5 rerun bypass probe', tapeVersion: 1 };
show('bypass, grant, NO offlinePerformedAt/clientOpId', 'OPERATOR', await raw('POST', `/api/filters/${rid()}/bypass`, { token: op, body: byp, headers: { 'x-offline-replay-token': G.OPERATOR } }), '400 OFFLINE_REPLAY_FIELDS_REQUIRED');
show('bypass, grant + replay fields', 'OPERATOR', await raw('POST', `/api/filters/${rid()}/bypass`, { token: op, body: { ...byp, ...replay() }, headers: { 'x-offline-replay-token': G.OPERATOR } }), '404 (gates passed, unknown filter)');
show('bypass with answers (A-01 carry), no grant', 'OPERATOR', await raw('POST', `/api/filters/${rid()}/bypass`, { token: op, body: { ...byp, answers: { q: 'yes' } } }), '404 (OPERATOR has no re-auth rows)');
show('advance-with-checklist, grant, NO replay fields', 'OPERATOR', await raw('POST', `/api/filters/${rid()}/advance-with-checklist`, { token: op, body: { targetState: 'WASH_OUT', answers: {}, tapeVersion: 1 }, headers: { 'x-offline-replay-token': G.OPERATOR } }), '400 OFFLINE_REPLAY_FIELDS_REQUIRED');
// bulk-operate is NOT a replay route any more: the grant header must be ignored, so an item without
// replay fields is judged like any online item (404), not 400 OFFLINE_REPLAY_FIELDS_REQUIRED
const item = { clientOpId: rid(), filterId: rid(), kind: 'advance', payload: { targetState: 'WASH_OUT', tapeVersion: 1 } };
show('bulk-operate, grant, item WITHOUT replay fields', 'OPERATOR', await raw('POST', '/api/filters/bulk-operate', { token: op, body: { items: [item] }, headers: { 'x-offline-replay-token': G.OPERATOR } }), '200, item failed NOT_FOUND (grant ignored)');
show('bulk-operate, no grant (control)', 'OPERATOR', await raw('POST', '/api/filters/bulk-operate', { token: op, body: { items: [{ ...item, clientOpId: rid() }] } }), '200, item failed NOT_FOUND');
// filter-creation decisions need remarks (e0dcb3c)
show('filter approve, no remarks', 'QA', await raw('POST', '/api/assets/instances/approve', { token: qa, body: { filterIds: [rid()] } }), '400 remarks required');
show('filter review, no remarks', 'MANAGER', await raw('POST', '/api/assets/instances/review', { token: mg, body: { filterIds: [rid()] } }), '400 remarks required');
show('filter reject, blank remarks', 'QA', await raw('POST', '/api/assets/instances/reject', { token: qa, body: { filterIds: [rid()], remarks: '   ' } }), '400 remarks required');
save('reauth3', out);
