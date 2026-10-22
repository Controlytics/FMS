// Phase 5 / category 2, round 2: the cases round 1 could not reach (validation), plus the
// offline-replay grant edge cases: grant on non-replayed /api/filters/* writes (retire / replace /
// bulk-operate), grant without offlinePerformedAt/clientOpId, grant minted by ANOTHER user.
import { randomUUID } from 'node:crypto';
import { raw, tok, save, sql, PASSWORD } from './lib5.mjs';

const target = sql(`select id from users where username='${process.env.P5_TARGET_USER ?? 'perf_user_200'}'`);
const rid = () => randomUUID();
const slim = (r) => r && { status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160) };
const grant = async (role) => (await raw('POST', '/api/auth/offline-grant', { token: (await tok(role)).token, body: { _currentPassword: PASSWORD } })).json?.token;
const G = { SUPERVISOR: await grant('SUPERVISOR'), ADMIN: await grant('ADMIN'), OPERATOR: await grant('OPERATOR'), SHIFTOFFICER: await grant('SHIFTOFFICER') };

const out = [];
async function probe(label, role, method, path, body, headers = {}) {
  const r = await raw(method, path, { token: (await tok(role)).token, body, headers });
  const rec = { label, role, method, path: path.replace(/[0-9a-f-]{36}/g, ':id'), ...slim(r) };
  out.push(rec);
  console.log(label.padEnd(58), role.padEnd(12), method, rec.path, '->', r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 110));
  return r;
}

// round-1 reachability fixes
await probe('unlock, no password', 'ADMIN', 'POST', `/api/users/${target}/unlock`, { newPassword: 'Qa@p5Probe1x' });
await probe('unlock, grant only', 'ADMIN', 'POST', `/api/users/${target}/unlock`, { newPassword: 'Qa@p5Probe1x' }, { 'x-offline-replay-token': G.ADMIN });
await probe('reset-password, no password', 'ADMIN', 'POST', `/api/users/${target}/reset-password`, { newPassword: 'Qa@p5Probe1x' });
await probe('reset-password, grant only', 'ADMIN', 'POST', `/api/users/${target}/reset-password`, { newPassword: 'Qa@p5Probe1x' }, { 'x-offline-replay-token': G.ADMIN });
await probe('field-id update (always), no password', 'ADMIN', 'PUT', '/api/config/field-ids/qa_p5_nope', { displayName: 'x' });
await probe('pm schedule create, no password', 'SUPERVISOR', 'POST', '/api/pm-schedules/', { entityId: rid(), year: 2027, entries: [{ month: 1, plannedDate: '2027-01-10' }] });
await probe('pm schedule create, grant only', 'SUPERVISOR', 'POST', '/api/pm-schedules/', { entityId: rid(), year: 2027, entries: [{ month: 1, plannedDate: '2027-01-10' }] }, { 'x-offline-replay-token': G.SUPERVISOR });
// terminate (a replayed route): no password / grant without replay fields / grant with them
const term = { justification: 'qa p5 probe terminate', tapeVersion: 1 };
await probe('terminate, no password', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/terminate-cycle`, term);
await probe('terminate, grant, NO offlinePerformedAt/clientOpId', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/terminate-cycle`, term, { 'x-offline-replay-token': G.SUPERVISOR });
await probe('terminate, grant + replay fields', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/terminate-cycle`, { ...term, offlinePerformedAt: new Date(Date.now() - 60000).toISOString(), clientOpId: rid() }, { 'x-offline-replay-token': G.SUPERVISOR });
// retire / replace: NOT replayed by sync-engine, but under /api/filters/
await probe('retire, no password', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/retire`, { remarks: 'qa p5 probe' });
await probe('retire, grant only (no replay fields)', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/retire`, { remarks: 'qa p5 probe' }, { 'x-offline-replay-token': G.SUPERVISOR });
await probe('replace, grant only (SO; REPLACE_FILTER not in SO policy)', 'SHIFTOFFICER', 'POST', `/api/filters/${rid()}/replace`, { remarks: 'qa p5 probe' }, { 'x-offline-replay-token': G.SHIFTOFFICER });
await probe('replace, no password (SUPERVISOR lacks FILTER_REPLACE)', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/replace`, { remarks: 'qa p5 probe' });
// grant bound to user: OPERATOR's grant presented with SUPERVISOR's token
await probe('retire, grant of ANOTHER user', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/retire`, { remarks: 'qa p5 probe' }, { 'x-offline-replay-token': G.OPERATOR });
await probe('retire, forged grant', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/retire`, { remarks: 'qa p5 probe' }, { 'x-offline-replay-token': G.SUPERVISOR.slice(0, -4) + 'AAAA' });
await probe('legacy x-offline-replay: true', 'SUPERVISOR', 'POST', `/api/filters/${rid()}/retire`, { remarks: 'qa p5 probe' }, { 'x-offline-replay': 'true' });
// grant on a non-filter route that is literally prefixed /api/filters? (none exist: /api/filters-* check)
await probe('cycle via /api/filter-cleaning-profiles w/ grant (not a replay route)', 'SUPERVISOR', 'PUT', `/api/filter-cleaning-profiles/${rid()}`, { name: 'x' }, { 'x-offline-replay-token': G.SUPERVISOR });
// header password variants
await probe('UPDATE_USER, password in x-reauth-password header (correct)', 'ADMIN', 'PUT', `/api/users/${target}`, { fullName: 'Perf User 200 (OPERATOR)' }, { 'x-reauth-password': PASSWORD });
await probe('UPDATE_USER, empty _currentPassword', 'ADMIN', 'PUT', `/api/users/${target}`, { fullName: 'Perf User 200 (OPERATOR)', _currentPassword: '' });
await probe('UPDATE_USER, _currentPassword as number', 'ADMIN', 'PUT', `/api/users/${target}`, { fullName: 'Perf User 200 (OPERATOR)', _currentPassword: 12345 });
await probe('UPDATE_USER, _currentPassword as object', 'ADMIN', 'PUT', `/api/users/${target}`, { fullName: 'Perf User 200 (OPERATOR)', _currentPassword: { $ne: null } });
save('reauth2', out);
