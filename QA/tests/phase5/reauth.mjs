// Phase 5 / category 2 — re-auth bypass.
// For gated actions that the clone's action-reauth policy (or an always-on gate) requires for the
// calling role, send: (a) no password, (b) a wrong password in the body, (c) a wrong password in
// x-reauth-password (b/c from a SECOND user of the role, max 2 wrong attempts per user — lockout is 3),
// (d) a real offline-replay grant minted by the caller (x-offline-replay-token) and no password.
// Expected: (a)-(c) refused 401 REAUTH_REQUIRED / INVALID_PASSWORD-like; (d) refused everywhere
// except /api/filters/* (the only replay routes).
// All bodies target random ids where the re-auth gate precedes the record lookup, so a refusal
// writes nothing and a bypass shows up as a 404 (gate passed, record missing) — no mutation.
import { randomUUID } from 'node:crypto';
import { raw, tok, save, sql, PASSWORD, second, ROLES } from './lib5.mjs';
import { loginAs } from '../lib/qa.mjs';

const SECOND = Object.fromEntries(ROLES.map((r) => [r, second(r)]));
const target = sql(`select id from users where username='${process.env.P5_TARGET_USER ?? 'perf_user_200'}'`);
const rid = () => randomUUID();

const cases = [
  // role, method, path, body, action, note
  ['ADMIN', 'PUT', `/api/users/${target}`, { fullName: 'Perf User 200 (OPERATOR)' }, 'UPDATE_USER'],
  ['ADMIN', 'POST', `/api/users/${target}/unlock`, {}, 'UNLOCK_USER'],
  ['ADMIN', 'POST', `/api/users/${target}/disable`, { reason: 'qa probe p5' }, 'DISABLE_USER'],
  ['ADMIN', 'POST', `/api/users/${target}/reset-password`, {}, 'RESET_PASSWORD'],
  ['ADMIN', 'POST', '/api/users/', { username: 'qap5x', fullName: 'QA P5', role: 'OPERATOR', password: 'Qa@p5Probe1', confirmPassword: 'Qa@p5Probe1' }, 'CREATE_USER'],
  ['ADMIN', 'PUT', '/api/config/pagination', { defaultPageSize: 25 }, 'UPDATE_CONFIG_PAGE'],
  ['ADMIN', 'PUT', '/api/config/password-policy', { minLength: 8 }, 'UPDATE_PASSWORD_POLICY'],
  ['ADMIN', 'PUT', '/api/config/session', { idleTimeoutMinutes: 10 }, 'UPDATE_SESSION_CONFIG'],
  ['ADMIN', 'PUT', '/api/config/tablet-access', {}, 'UPDATE_TABLET_ACCESS (always)'],
  ['ADMIN', 'PUT', '/api/config/field-ids', {}, 'UPDATE_FIELD_ID (always)'],
  ['SUPERVISOR', 'POST', '/api/assets/instances', { name: 'QAP5-NOPE', templateId: rid() }, 'CREATE_FILTER'],
  ['SUPERVISOR', 'POST', `/api/filters/${rid()}/retire`, { remarks: 'qa p5 probe' }, 'RETIRE_FILTER'],
  ['SUPERVISOR', 'POST', `/api/filters/${rid()}/terminate-cycle`, { reason: 'qa p5 probe' }, 'TERMINATE_CLEANING_CYCLE'],
  ['SUPERVISOR', 'POST', '/api/pm-schedules/', { ahuId: rid(), year: 2027 }, 'CREATE_PM_SCHEDULE'],
  ['QA', 'POST', '/api/pm-schedules/entries/approve', { entryIds: [rid()], comment: 'qa p5' }, 'APPROVE_PM_SCHEDULE'],
  ['QA', 'POST', '/api/pm-schedules/entries/reject', { entryIds: [rid()], comment: 'qa p5', remarks: 'qa p5 probe' }, 'REJECT_PM_SCHEDULE'],
  ['MANAGER', 'POST', '/api/pm-schedules/entries/review', { entryIds: [rid()], action: 'approve', remarks: 'qa p5' }, 'REVIEW_PM_SCHEDULE'],
  ['SHIFTOFFICER', 'POST', `/api/stage-approvals/${rid()}/approve`, { remarks: 'qa p5' }, 'APPROVE_CLEANING_STAGE (always)'],
  ['SHIFTOFFICER', 'POST', `/api/stage-approvals/${rid()}/reject`, { remarks: 'qa p5' }, 'REJECT_CLEANING_STAGE (always)'],
  ['SHIFTOFFICER', 'POST', '/api/stage-approvals/bulk-decide', { ids: [rid()], action: 'approve', remarks: 'qa p5' }, 'APPROVE_CLEANING_STAGE bulk (always)'],
  ['OPERATOR', 'POST', `/api/pm-schedules/deviations/${rid()}/acknowledge`, { remarks: 'qa p5' }, 'ACKNOWLEDGE_PM_OVERDUE (always)'],
];

// grants, one per role (caller's own password; this is the tablet's normal flow)
const grants = {};
for (const role of new Set(cases.map((c) => c[0]))) {
  const t = await tok(role);
  const g = await raw('POST', '/api/auth/offline-grant', { token: t.token, body: { _currentPassword: PASSWORD } });
  grants[role] = g.json?.token;
  if (!grants[role]) console.log('grant failed', role, g.status, g.text);
}

const out = [];
const wrongUsed = {};
for (const [role, method, path, body, action] of cases) {
  const t = (await tok(role)).token;
  const row = { role, method, path, action };
  row.noPw = await raw(method, path, { token: t, body });
  row.grant = await raw(method, path, { token: t, body, headers: { 'x-offline-replay-token': grants[role] } });
  // wrong password (2nd user of the role, at most 2 wrong attempts each, then reset with a good login)
  wrongUsed[role] = (wrongUsed[role] ?? 0);
  if (wrongUsed[role] < 2) {
    const s = await loginAs(SECOND[role]);
    row.wrongBody = await raw(method, path, { token: s.token, body: { ...body, _currentPassword: 'Wrong@Pass1' } });
    wrongUsed[role]++;
  }
  const slim = (r) => r && { status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 140) };
  const rec = { role, method, path, action, noPw: slim(row.noPw), wrongBody: slim(row.wrongBody), grant: slim(row.grant) };
  const refused = (r) => r && [401, 403].includes(r.status);
  rec.verdict = refused(row.noPw) && (!row.wrongBody || refused(row.wrongBody)) && (path.startsWith('/api/filters/') || refused(row.grant)) ? 'PASS' : 'CHECK';
  if (path.startsWith('/api/filters/') && !refused(row.grant)) rec.grantNote = 'grant accepted in place of the password on a /api/filters/* route';
  out.push(rec);
  console.log(rec.verdict, role, method, path.replace(/[0-9a-f-]{36}/g, ':id'), action, '| noPw', rec.noPw.status, rec.noPw.error, '| wrong', rec.wrongBody?.status, rec.wrongBody?.error, '| grant', rec.grant.status, rec.grant.error);
}
// lockout state of the second users after the wrong attempts
const locks = sql(`select username, failed_login_attempts, lockout_until from users where username in (${Object.values(SECOND).map((u) => `'${u}'`).join(',')})`);
console.log(locks);
// clear the failed counters with one good login each (login resets them)
for (const u of Object.values(SECOND)) await loginAs(u).catch((e) => console.log('relogin', u, e.message));
console.log(sql(`select username, failed_login_attempts, lockout_until from users where username in (${Object.values(SECOND).map((u) => `'${u}'`).join(',')})`));
save('reauth', { cases: out, locksAfterWrong: locks });
