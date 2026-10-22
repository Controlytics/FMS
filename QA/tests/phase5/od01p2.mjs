// Phase 5 re-run on e7312ca: write paths changed by OD-01 part 2 (8372478) and SEC-03 (4eeb864).
// OD-01 part 2 moved these to enforceReauthAlways. For the non-SA roles that can reach them, the
// clone's re-auth policy ALREADY lists the role (ADMIN: UPDATE_USER, RESTORE_BACKUP, UPDATE_LDAP_CONFIG,
// APPROVE_ADMIN_REQUEST; SUPERVISOR: UPDATE_FILTER_LIFECYCLE), so a non-SA probe proves the password
// is asked, not WHY (policy vs always) — the "always" half needs an SA session (sa-meta-redact.mjs).
// Every probe is unsigned and uses a random id or a junk file, so a missing gate shows up as
// 404 / 400, never as a write.
import { randomUUID } from 'node:crypto';
import { raw, tok, save, sql } from './lib5.mjs';

const out = [];
const show = (label, role, r, expect) => {
  const pass = expect(r);
  out.push({ label, role, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160), pass });
  console.log(pass ? 'PASS ' : 'CHECK', label.padEnd(56), role.padEnd(11), '->', r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 90));
};
const reauth401 = (r) => r.status === 401 && r.json?.error === 'REAUTH_REQUIRED';
const ad = (await tok('ADMIN')).token, sv = (await tok('SUPERVISOR')).token;
const target = sql(`select id from users where username='perf_user_200'`);

show('user edit, unsigned', 'ADMIN', await raw('PUT', `/api/users/${target}`, { token: ad, body: { fullName: 'Perf User 200 (OPERATOR)' } }), reauth401);
const B = '----qap5od01';
const junk = Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="x.json"\r\nContent-Type: application/json\r\n\r\n{"not":"a backup"}\r\n--${B}--\r\n`);
show('backup restore (junk file), unsigned', 'ADMIN', await raw('POST', '/api/backup/restore', { token: ad, rawBody: junk, headers: { 'content-type': `multipart/form-data; boundary=${B}` } }), reauth401);
show('LDAP config (role mapping) save, unsigned', 'ADMIN', await raw('PUT', '/api/ldap/config', { token: ad, body: { roleMapping: {} } }), reauth401);
show('admin request approve (random id), unsigned', 'ADMIN', await raw('POST', `/api/admin-requests/${randomUUID()}/process`, { token: ad, body: { action: 'approve', adminRemarks: 'qa p5 od01' } }), (r) => [401, 404].includes(r.status));
show('manual lifecycle move (random id), unsigned', 'SUPERVISOR', await raw('PATCH', `/api/assets/instances/${randomUUID()}/lifecycle-state`, { token: sv, body: { lifecycleState: 'WASH_IN', remarks: 'qa p5 od01 probe' } }), reauth401);
// SEC-03
show('POST /notification-settings/send (removed)', 'ADMIN', await raw('POST', '/api/notification-settings/send', { token: ad, body: { channel: 'EMAIL', recipient: 'qa-p5@example.com', subject: 'x', body: 'x' } }), (r) => r.status === 404);
const before = Number(sql(`select count(*) from audit_trail where action='NOTIFICATION_TEST_SENT'`));
show('email test-send (email disabled on the clone)', 'ADMIN', await raw('POST', '/api/notification-settings/email/test', { token: ad, body: { recipient: 'qa-p5@example.com' } }), (r) => r.status < 500);
show('sms test-send (sms disabled on the clone)', 'ADMIN', await raw('POST', '/api/notification-settings/sms/test', { token: ad, body: { recipient: '0000000000' } }), (r) => r.status < 500);
const rows = sql(`select action||' '||coalesce(target_id,'')||' '||coalesce(after_value::text,'') from audit_trail where action='NOTIFICATION_TEST_SENT' order by chain_position desc limit 2`);
out.push({ label: 'NOTIFICATION_TEST_SENT rows written', before, after: Number(sql(`select count(*) from audit_trail where action='NOTIFICATION_TEST_SENT'`)), rows });
console.log('NOTIFICATION_TEST_SENT rows', before, '->', out.at(-1).after, '\n ', rows.replace(/\n/g, '\n  '));
save('od01p2', out);
