// Phase 5 re-run: A-03 (98c79bb) — the performer of a gated stage can neither approve NOR REJECT it.
// sod-stage.mjs covers approve; this covers reject (single and bulk). The SHIFTOFFICER actor advances
// a WASH_IN cycle into Wash Out (raises a SHIFTOFFICER approval), tries to reject it, and a second
// SHIFTOFFICER then approves so the cycle is left moving, not stuck.
// Mutations: one advance (two filter events) + one approval on the given filter.
import { raw, tok, save, sql, PASSWORD, second } from './lib5.mjs';
import { loginAs } from '../lib/qa.mjs';

const filterId = process.argv[2];
if (!filterId) throw new Error('filter id required');
const so = await tok('SHIFTOFFICER');
const so2 = await loginAs(second('SHIFTOFFICER'));
const log = [];
const show = (l, r) => { log.push({ l, status: r.status, body: r.json }); console.log(l.padEnd(44), r.status, r.json?.error ?? '', JSON.stringify(r.json?.results ?? r.json?.message ?? '').slice(0, 160)); };

const cs = await raw('GET', `/api/filters/${filterId}/current-state`, { token: so.token });
show(`advance ${cs.json?.currentState}->WASH_OUT by SO`, await raw('POST', `/api/filters/${filterId}/advance`, { token: so.token, body: { targetState: 'WASH_OUT', tapeVersion: cs.json?.tapeVersion, remarks: 'qa p5 rerun sod reject probe' } }));
const [apId, requestedBy, status] = sql(`select id||'|'||requested_by||'|'||status from cleaning_stage_approvals where filter_id='${filterId}' order by created_at desc limit 1`).split('|');
console.log('approval', apId, status, 'requested_by == actor:', requestedBy === (await raw('GET', '/api/auth/me', { token: so.token })).json.id);
if (status === 'PENDING') {
  show('self-REJECT (same SO), signed', await raw('POST', `/api/stage-approvals/${apId}/reject`, { token: so.token, body: { remarks: 'qa p5 self reject', _currentPassword: PASSWORD } }));
  show('self bulk REJECT (same SO), signed', await raw('POST', '/api/stage-approvals/bulk-decide', { token: so.token, body: { ids: [apId], action: 'reject', remarks: 'qa p5 self reject', _currentPassword: PASSWORD } }));
  show('different SO approves (cleanup)', await raw('POST', `/api/stage-approvals/${apId}/approve`, { token: so2.token, body: { remarks: 'qa p5 rerun different approver', _currentPassword: PASSWORD } }));
  console.log('final:', sql(`select status, requested_by, decided_by from cleaning_stage_approvals where id='${apId}'`));
}
save('sod-reject', { filterId, apId, log });
