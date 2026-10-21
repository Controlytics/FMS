import { raw, tok, save, sql, PASSWORD, leaks } from './lib5.mjs';
const out = [];
const show = (label, r) => { out.push({ label, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 200), leaks: leaks(r) }); console.log(label.padEnd(60), '->', r.status, r.json?.error ?? '', String(r.json?.message ?? r.text ?? '').slice(0, 110)); };
const adminTok = (await tok('ADMIN')).token;
const opTok = (await tok('OPERATOR')).token;
// trailing-slash behaviour on the public submit
show('POST /api/admin-requests (no slash, no token)', await raw('POST', '/api/admin-requests', { body: { requestType: 'FORGOT_PASSWORD', requesterName: 'QA P5', requesterEmployeeId: 'qap5', requestData: { username: 'superadmin' } } }));
show('POST /api/admin-requests/ (slash, no token)', await raw('POST', '/api/admin-requests/', { body: { requestType: 'FORGOT_PASSWORD', requesterName: 'QA P5', requesterEmployeeId: 'qap5', requestData: { username: 'superadmin' } } }));
const reqId = sql(`select id from admin_requests where request_type='FORGOT_PASSWORD' and request_data->>'username'='superadmin' order by requested_at desc limit 1`);
console.log('forgot-superadmin request id:', reqId);
if (reqId) show('ADMIN approve FORGOT_PASSWORD(superadmin)', await raw('POST', `/api/admin-requests/${reqId}/process`, { token: adminTok, body: { action: 'approve', adminRemarks: 'qa p5' }, headers: { 'x-reauth-password': PASSWORD } }));
out.push({ note: 'superadmin hash after', hash: sql(`select left(password_hash,16)||'|'||status from users where username='superadmin'`) });
show('POST MODIFY_USER ->SUPER_ADMIN (no slash)', await raw('POST', '/api/admin-requests', { body: { requestType: 'MODIFY_USER', requesterName: 'QA P5', requesterEmployeeId: 'qap5', requestData: { username: '121011', modifyField: 'role', newValue: 'SUPER_ADMIN' } } }));
// report-export-log, correct schema
show('OP report-export-log Audit Trail (lacks AUDIT_READ)', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportType: 'Audit Trail', format: 'pdf', recordCount: 1 } }));
show('OP report-export-log PM Schedule (lacks PM gates? has PM_READ)', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportType: 'PM Schedule', format: 'pdf', recordCount: 1 } }));
show('OP report-export-log Quality Notifications (no gate)', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportType: 'Quality Notifications', format: 'pdf', recordCount: 1 } }));
show('OP report-export-log Filters (has ASSET_READ)', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportType: 'Filters', format: 'pdf', recordCount: 1 } }));
save('scope-probes2', out);
