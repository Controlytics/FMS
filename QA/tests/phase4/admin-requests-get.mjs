// GET /api/admin-requests/ per role (missed by the sweep's skip regex). Gate per inventory.
import { call } from '../lib/qa.mjs';
import { phase4Tokens } from './accounts.mjs';
const t = await phase4Tokens();
for (const [role, { token }] of Object.entries(t)) { const r = await call('GET', '/api/admin-requests/', { token }); console.log(role.padEnd(12), r.status, JSON.stringify(r.json).slice(0, 90)); }
