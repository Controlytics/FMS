import { raw, tok, ROLES, save } from './lib5.mjs';
import { randomUUID } from 'node:crypto';
const out = [];
const body = { reportType: 'Audit Trail', title: 'QA P5 review', dataSnapshot: { x: 1 }, recordCount: 1, format: 'PDF' };
for (const role of ROLES) {
  const r = await raw('POST', '/api/report-reviews/', { token: (await tok(role)).token, body });
  out.push({ phase: 'submit', role, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0,140) });
  console.log('submit', role.padEnd(12), r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0,110));
}
for (const [act, role] of [['approve','QA'],['approve','MANAGER'],['approve','OPERATOR'],['review','QA'],['review','MANAGER'],['review','OPERATOR']]) {
  const r = await raw('POST', `/api/report-reviews/${randomUUID()}/${act}`, { token: (await tok(role)).token, body: { action: act, remarks: 'qa p5', _currentPassword: 'x' } });
  out.push({ phase: act, role, status: r.status, error: r.json?.error });
  console.log(act.padEnd(8), role.padEnd(12), r.status, r.json?.error ?? '');
}
save('report-reviews-authz', out);
