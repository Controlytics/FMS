// POST /api/report-reviews/ with a schema-valid body ({} dataSnapshot) for each non-SA role.
// Gate REPORT_REVIEW_SUBMIT is held by no non-SA role, so every role must get 403.
import { call } from '../lib/qa.mjs';
import { phase4Tokens } from './accounts.mjs';
const t = await phase4Tokens();
for (const [role, { token }] of Object.entries(t)) {
  const r = await call('POST', '/api/report-reviews/', { token, body: { reportType: 'QA_PROBE', title: 'QA phase4 probe', dataSnapshot: {} } });
  console.log(role.padEnd(12), r.status, JSON.stringify(r.json).slice(0, 120));
}
