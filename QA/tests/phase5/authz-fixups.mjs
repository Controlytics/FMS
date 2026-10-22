// Phase 5 re-run: authorization cases the generic sweep cannot reach.
//  - POST /api/dashboards/{id}/assign: its schema now has if/then (06fc578), which sample() does not
//    model, so the sweep stopped at 400 validation — send a valid USER assignment instead.
//  - POST /api/pm-schedules/visits: new on 2026-10-22 (5e7f488), gate PM_CREATE + re-auth
//    CREATE_PM_SCHEDULE. Random entityId, so a request that passes every gate answers 404 and writes nothing.
import { randomUUID } from 'node:crypto';
import { raw, tok, ROLES, save } from './lib5.mjs';

const out = [];
const show = (label, role, r) => {
  out.push({ label, role, status: r.status, error: r.json?.error, message: String(r.json?.message ?? '').slice(0, 160) });
  console.log(label.padEnd(44), role.padEnd(12), '->', r.status, r.json?.error ?? '', String(r.json?.message ?? '').slice(0, 100));
};
const me = {};
for (const role of ROLES) me[role] = (await raw('GET', '/api/auth/me', { token: (await tok(role)).token })).json;

for (const role of ROLES) {
  const t = (await tok(role)).token;
  show('dashboards/{id}/assign (USER)', role, await raw('POST', `/api/dashboards/${randomUUID()}/assign`, { token: t, body: { assigneeType: 'USER', userId: me[role].id } }));
  show('dashboards/{id}/assign (ROLE)', role, await raw('POST', `/api/dashboards/${randomUUID()}/assign`, { token: t, body: { assigneeType: 'ROLE', roleValue: role } }));
}
for (const role of ROLES) {
  const t = (await tok(role)).token;
  const perms = me[role].permissions;
  const r = await raw('POST', '/api/pm-schedules/visits', { token: t, body: { entityId: randomUUID(), plannedDate: '2027-03-10', toleranceDays: 5 } });
  show(`pm-schedules/visits (holds PM_CREATE: ${perms.includes('PM_CREATE')})`, role, r);
}
save('authz-fixups', out);
