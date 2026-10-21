// Phase 5 / categories 4 (scope/IDOR), 5 (SSRF + upload), 6 (admin-request subject).
// A notification row addressed to user "121216"; a row addressed to the SUPER_ADMIN role.
import { raw, tok, save, sql, PASSWORD, leaks } from './lib5.mjs';
const out = [];
const show = (label, r, extra = '') => {
  out.push({ label, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 200), leaks: leaks(r) });
  console.log(label.padEnd(66), '->', r.status, r.json?.error ?? '', String(r.json?.message ?? r.text ?? '').slice(0, 100), extra, leaks(r).join(' '));
};
const foreignNotif = sql(`select id from notifications where type='STAGE_APPROVAL_APPROVED' and for_user_id is not null and for_user_id not in (select username from users where username like 'perf_user_00%') limit 1`);
const saNotif = sql(`select id from notifications where for_role='SUPER_ADMIN' limit 1`);
const opTok = await (async () => (await tok('OPERATOR')).token)();
const adminTok = (await tok('ADMIN')).token;

// 4a. OPERATOR marks a notification addressed to a different user read
const wasRead = sql(`select is_read from notifications where id='${foreignNotif}'`);
show(`OP PUT /notifications/foreign/read (addressed to other user)`, await raw('PUT', `/api/notifications/${foreignNotif}/read`, { token: opTok }));
show(`OP PUT /notifications/foreign/unread`, await raw('PUT', `/api/notifications/${foreignNotif}/unread`, { token: opTok }));
out.push({ note: 'foreignNotif is_read before/after', before: wasRead, after: sql(`select is_read from notifications where id='${foreignNotif}'`) });
// 4b. ADMIN marks a SUPER_ADMIN-addressed notification read
show(`ADMIN PUT /notifications/SA-addressed/read`, await raw('PUT', `/api/notifications/${saNotif}/read`, { token: adminTok }));
// 4c. OPERATOR deletes a foreign notification (needs NOTIFICATION_DELETE — OPERATOR lacks it)
show(`OP DELETE /notifications/foreign`, await raw('DELETE', `/api/notifications/${foreignNotif}`, { token: opTok }));

// 6. admin-request process on a request whose subject is a SUPER_ADMIN account (ADMIN approver)
const forgotSa = await raw('POST', '/api/admin-requests/', { body: { requestType: 'FORGOT_PASSWORD', requesterName: 'QA P5', requesterEmployeeId: 'qap5', requestData: { username: 'superadmin' } } });
show('submit FORGOT_PASSWORD for superadmin (public)', forgotSa);
const reqId = forgotSa.json?.requestId ?? sql(`select id from admin_requests where request_type='FORGOT_PASSWORD' order by requested_at desc limit 1`);
show('ADMIN approve FORGOT_PASSWORD(superadmin)', await raw('POST', `/api/admin-requests/${reqId}/process`, { token: adminTok, body: { action: 'approve', adminRemarks: 'qa p5' }, headers: { 'x-reauth-password': PASSWORD } }));
out.push({ note: 'superadmin hash unchanged?', hash: sql(`select left(password_hash,16) from users where username='superadmin'`) });
// MODIFY_USER asking to make an account SUPER_ADMIN
show('submit MODIFY_USER ->SUPER_ADMIN (public)', await raw('POST', '/api/admin-requests/', { body: { requestType: 'MODIFY_USER', requesterName: 'QA P5', requesterEmployeeId: 'qap5', requestData: { username: '121011', modifyField: 'role', newValue: 'SUPER_ADMIN' } } }));

// 5. SSRF — instrument URL tester (SUPERVISOR has EG_EDIT)
const sv = (await tok('SUPERVISOR')).token;
for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:3104/api/health', 'http://127.0.0.1:5432', 'file:///C:/Windows/win.ini', 'http://[::1]:3104/api/health', 'gopher://127.0.0.1:6379/_INFO']) {
  show(`SSRF test-url ${url}`, await raw('POST', '/api/equipment-groups/test-url', { token: sv, body: { url } }));
}
// 5. photo upload — path traversal filename + wrong magic bytes + oversized
const boundary = '----qap5';
const mk = (filename, type, content) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`);
const H = { 'content-type': `multipart/form-data; boundary=${boundary}` };
show('upload traversal filename, text content as image/png', await raw('POST', '/api/uploads/photo', { token: opTok, rawBody: mk('../../../../evil.png', 'image/png', 'not a real png'), headers: H }));
show('upload declared png, no PNG magic', await raw('POST', '/api/uploads/photo', { token: opTok, rawBody: mk('x.png', 'image/png', 'GIF89a fake'), headers: H }));
show('upload text/html', await raw('POST', '/api/uploads/photo', { token: opTok, rawBody: mk('x.html', 'text/html', '<script>alert(1)</script>'), headers: H }));
const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('rest')]);
show('upload real PNG magic (control)', await raw('POST', '/api/uploads/photo', { token: opTok, rawBody: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="good.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: H }));

// 5. report-export-log gating (authenticated, in-handler role logic): OPERATOR logging an Audit Trail export
show('OP report-export-log Audit Trail (lacks AUDIT_READ)', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportName: 'Audit Trail', format: 'pdf', filters: {} } }));
show('OP report-export-log Quality Notifications (no gate)', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportName: 'Quality Notifications', format: 'pdf', filters: {} } }));
show('OP report-export-log bogus report name', await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportName: 'Nope', format: 'pdf', filters: {} } }));

save('scope-probes', { foreignNotif, saNotif, out });
