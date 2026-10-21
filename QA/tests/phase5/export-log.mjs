import { raw, tok, save } from './lib5.mjs';
const out = [];
const show = (label, r) => { out.push({ label, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160) }); console.log(label.padEnd(56), '->', r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 100)); };
const opTok = (await tok('OPERATOR')).token;   // holds ASSET_READ, PM_READ; lacks AUDIT_READ, CYCLE_READ? op has CYCLE_READ
for (const rpt of ['Audit Trail', 'PM Schedule', 'Quality Notifications', 'Filters', 'RFID Track Record', 'Replacement Schedule', 'Deviations']) {
  show(`OP export-log "${rpt}"`, await raw('POST', '/api/audit/report-export-log', { token: opTok, body: { reportType: rpt, format: 'PDF', recordCount: 1 } }));
}
save('export-log', out);
