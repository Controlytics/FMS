// Phase 5 / category 6 — segregation of duties on stage approvals.
// SHIFTOFFICER holds FILTER_OPERATE and STAGE_APPROVAL_DECIDE. They advance a cycle into Wash Out
// (which requests a SHIFTOFFICER approval), then try to approve it themselves: expected 403
// SELF_APPROVAL_FORBIDDEN (stage-interlock.requireDifferentApprover = true on the clone).
// A different SHIFTOFFICER then approves (positive control). Mutations: one advance + one approval.
import { raw, tok, save, sql, PASSWORD } from './lib5.mjs';
import { loginAs } from '../lib/qa.mjs';

const filterId = process.argv[2] ?? '1c48b9c6-bacb-4e68-b696-1cdca83895b8';
const so = await tok('SHIFTOFFICER');
const so2 = await loginAs('perf_user_222');
const log = [];
const show = (l, r) => { log.push({ l, status: r.status, body: r.json }); console.log(l, r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 140)); };

const cs = await raw('GET', `/api/filters/${filterId}/current-state`, { token: so.token });
console.log('state', cs.json?.currentState, 'tape', cs.json?.tapeVersion, 'next', JSON.stringify(cs.json?.nextActions ?? cs.json?.nextBlocks)?.slice(0, 300));
const adv = await raw('POST', `/api/filters/${filterId}/advance`, { token: so.token, body: { targetState: 'WASH_OUT', tapeVersion: cs.json?.tapeVersion, remarks: 'qa p5 sod probe' } });
show('advance WASH_IN->WASH_OUT by SO', adv);
const pending = sql(`select id||'|'||requested_by||'|'||status from cleaning_stage_approvals where filter_id='${filterId}' order by created_at desc limit 1`);
console.log('latest approval:', pending, 'SO userId', (await raw('GET', '/api/auth/me', { token: so.token })).json.id);
const [apId, requestedBy, status] = pending.split('|');
if (status === 'PENDING') {
  show('self-approve (same SO), correct password', await raw('POST', `/api/stage-approvals/${apId}/approve`, { token: so.token, body: { remarks: 'qa p5 self', _currentPassword: PASSWORD } }));
  show('self bulk-decide (same SO)', await raw('POST', '/api/stage-approvals/bulk-decide', { token: so.token, body: { ids: [apId], action: 'approve', remarks: 'qa p5 self', _currentPassword: PASSWORD } }));
  show('OPERATOR approve (wrong role, lacks perm)', await raw('POST', `/api/stage-approvals/${apId}/approve`, { token: (await tok('OPERATOR')).token, body: { remarks: 'x', _currentPassword: PASSWORD } }));
  show('different SO approves', await raw('POST', `/api/stage-approvals/${apId}/approve`, { token: so2.token, body: { remarks: 'qa p5 different approver', _currentPassword: PASSWORD } }));
  show('second approval of same row (replay)', await raw('POST', `/api/stage-approvals/${apId}/approve`, { token: so2.token, body: { remarks: 'qa p5 replay', _currentPassword: PASSWORD } }));
  console.log('final:', sql(`select status, requested_by, decided_by from cleaning_stage_approvals where id='${apId}'`));
}
save('sod-stage', { filterId, pending, log });
