// Phase 5 / category 3 — mass assignment + privilege boundary on user/asset writes.
// Every write is checked in the DB afterwards. Mutations made here are listed in the report.
import { randomUUID } from 'node:crypto';
import { raw, tok, save, sql, PASSWORD } from './lib5.mjs';

const out = [];
const slim = (r) => ({ status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160) });
async function probe(label, role, method, path, body, headers = {}) {
  const r = await raw(method, path, { token: (await tok(role)).token, body, headers });
  const rec = { label, role, method, path, ...slim(r), json: r.json };
  out.push(rec);
  console.log(label.padEnd(64), role.padEnd(12), '->', r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 100));
  return r;
}
const q = (s) => sql(s);
const PW = { 'x-reauth-password': PASSWORD };

const op1 = q(`select id from users where username='perf_user_001'`);
const target = q(`select id from users where username='perf_user_200'`);
const sa = q(`select id from users where username='superadmin'`);
const userCols = `username, full_name, role, status, failed_login_attempts, force_password_change, is_temporary_password, auth_source, created_by, left(password_hash, 12)`;

// M1 — self profile with privileged extras
const before1 = q(`select ${userCols} from users where id='${op1}'`);
await probe('M1 PUT /auth/profile + role/status/permissions/username/passwordHash', 'OPERATOR', 'PUT', '/api/auth/profile',
  { fullName: 'Perf User 001 (OPERATOR)', role: 'SUPER_ADMIN', status: 'DISABLED', permissions: ['USER_CREATE'], username: 'pwned_p5', passwordHash: 'x', forcePasswordChange: false, failedLoginAttempts: 0, id: target, createdBy: 'p5' });
const after1 = q(`select ${userCols} from users where id='${op1}'`);
out.push({ label: 'M1 db', before: before1, after: after1, changed: before1 !== after1 });
console.log('  M1 db unchanged?', before1 === after1, after1);
// M1b — profile with someone else's email (uniqueness) and photoUrl traversal
await probe('M1b PUT /auth/profile photoUrl=../../etc', 'OPERATOR', 'PUT', '/api/auth/profile', { fullName: 'Perf User 001 (OPERATOR)', photoUrl: '../../../../Windows/win.ini' });
console.log('  photo_url now:', q(`select photo_url from users where id='${op1}'`));
await probe('M1c PUT /auth/profile photoUrl=https://evil.example/x.png', 'OPERATOR', 'PUT', '/api/auth/profile', { fullName: 'Perf User 001 (OPERATOR)', photoUrl: 'https://evil.example/x.png' });
console.log('  photo_url now:', q(`select photo_url from users where id='${op1}'`));

// M2/M3 — ADMIN updates an OPERATOR
await probe('M2 PUT /users/:op role=SUPER_ADMIN', 'ADMIN', 'PUT', `/api/users/${target}`, { role: 'SUPER_ADMIN' }, PW);
const before3 = q(`select ${userCols} from users where id='${target}'`);
await probe('M3 PUT /users/:op + passwordHash/username/failedLoginAttempts/authSource', 'ADMIN', 'PUT', `/api/users/${target}`,
  { fullName: 'Perf User 200 (OPERATOR)', passwordHash: 'x', username: 'pwned_p5b', failedLoginAttempts: 7, forcePasswordChange: false, authSource: 'ldap', createdBy: 'p5', lockoutUntil: '2099-01-01T00:00:00Z' }, PW);
const after3 = q(`select ${userCols} from users where id='${target}'`);
out.push({ label: 'M3 db', before: before3, after: after3, changed: before3 !== after3 });
console.log('  M3 db unchanged?', before3 === after3, after3);

// M4 — ADMIN against a SUPER_ADMIN account (hierarchy)
const beforeSa = q(`select ${userCols} from users where id='${sa}'`);
await probe('M4a PUT /users/:superadmin fullName', 'ADMIN', 'PUT', `/api/users/${sa}`, { fullName: 'Super Admin' }, PW);
await probe('M4b POST /users/:superadmin/disable', 'ADMIN', 'POST', `/api/users/${sa}/disable`, {}, PW);
await probe('M4c POST /users/:superadmin/reset-password', 'ADMIN', 'POST', `/api/users/${sa}/reset-password`, { newPassword: 'Qa@p5Probe1x' }, PW);
await probe('M4d POST /users/:superadmin/unlock', 'ADMIN', 'POST', `/api/users/${sa}/unlock`, { newPassword: 'Qa@p5Probe1x' }, PW);
const afterSa = q(`select ${userCols} from users where id='${sa}'`);
out.push({ label: 'M4 db', before: beforeSa, after: afterSa, changed: beforeSa !== afterSa });
console.log('  M4 SA row unchanged?', beforeSa === afterSa);

// M5 — ADMIN creates a SUPER_ADMIN
await probe('M5 POST /users role=SUPER_ADMIN', 'ADMIN', 'POST', '/api/users/', { username: 'qap5sa', fullName: 'QA P5 SA', role: 'SUPER_ADMIN', password: 'Qa@p5Probe1x', confirmPassword: 'Qa@p5Probe1x' }, PW);
console.log('  qap5sa exists:', q(`select count(*) from users where username='qap5sa'`));

// M6 — SUPERVISOR creates a filter with workflow / attribution extras (workflow is enabled on the clone)
const tplFilter = q(`select id from asset_templates where template_kind='FILTER' limit 1`);
const ahu = q(`select a.id from asset_instances a join asset_templates t on t.id=a.template_id where t.template_kind='AHU' and a.is_active order by a.name limit 1`);
const forcedId = randomUUID();
const r6 = await probe('M6 POST /assets/instances (filter) + approvalStatus=APPROVED etc', 'SUPERVISOR', 'POST', '/api/assets/instances',
  { name: 'QAP5-MA-FILTER-1', templateId: tplFilter, parentId: ahu, status: 'Active', approvalStatus: 'APPROVED', approvedBy: 'p5', approvedAt: '2026-01-01T00:00:00Z', reviewedBy: 'p5', isActive: true, createdBy: 'p5-hacker', id: forcedId, submittedBy: target }, PW);
const m6 = q(`select id, name, approval_status, created_by, submitted_by_name, approved_by, is_active, (id='${forcedId}') from asset_instances where name='QAP5-MA-FILTER-1'`);
out.push({ label: 'M6 db', row: m6 });
console.log('  M6 row:', m6);

// M7 — SHIFTOFFICER (FILTER_EDIT) flips a RETIRED filter's status through the generic edit
const retired = q(`select a.id from asset_instances a join asset_templates t on t.id=a.template_id where t.template_kind='FILTER' and a.status='Retired' order by a.name limit 1`);
const b7 = q(`select a.status, a.is_active, fd.current_lifecycle_state from asset_instances a left join filter_details fd on fd.asset_instance_id=a.id where a.id='${retired}'`);
await probe('M7 PUT /assets/instances/:retired status=Active', 'SHIFTOFFICER', 'PUT', `/api/assets/instances/${retired}`, { status: 'Active', isActive: true, approvalStatus: 'PENDING_REVIEW' });
const a7 = q(`select a.status, a.is_active, fd.current_lifecycle_state from asset_instances a left join filter_details fd on fd.asset_instance_id=a.id where a.id='${retired}'`);
out.push({ label: 'M7 db', id: retired, before: b7, after: a7 });
console.log('  M7 retired filter', retired, b7, '->', a7);

// M8 — status on an ACTIVE filter via generic edit (bypasses /retire: no cycle termination, no FILTER_RETIRED row)
const active = q(`select a.id from asset_instances a join asset_templates t on t.id=a.template_id where t.template_kind='FILTER' and a.status='Active' and a.is_active order by a.name desc limit 1`);
const b8 = q(`select a.status, a.is_active from asset_instances a where a.id='${active}'`);
await probe('M8 PUT /assets/instances/:active status=Retired', 'SHIFTOFFICER', 'PUT', `/api/assets/instances/${active}`, { status: 'Retired' });
const a8 = q(`select a.status, a.is_active from asset_instances a where a.id='${active}'`);
out.push({ label: 'M8 db', id: active, before: b8, after: a8 });
console.log('  M8 active filter', active, b8, '->', a8);
await probe('M8b PUT /assets/instances/:active status=<script>', 'SHIFTOFFICER', 'PUT', `/api/assets/instances/${active}`, { status: '<img src=x onerror=alert(1)>' });
console.log('  M8b status now:', q(`select status from asset_instances where id='${active}'`));

save('mass-assign', { ids: { op1, target, sa, retired, active, forcedId }, out });
