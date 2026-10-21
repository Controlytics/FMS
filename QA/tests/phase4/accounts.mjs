// One synthetic account per role for Phase 4. Uses the LAST perf user of each role so the
// sessions do not collide with other QA agents (which take the first user of a role via tokenFor()).
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../../../tests/performance/lib/http.mjs';
import { loginAs } from '../lib/qa.mjs';
export const ROLES = ['ADMIN', 'SUPERVISOR', 'MANAGER', 'QA', 'SHIFTOFFICER', 'OPERATOR'];
export async function phase4Tokens() {
  const users = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/performance/results/perf-users.json'), 'utf8')).users;
  const out = {};
  for (const role of ROLES) {
    const u = users.filter((x) => x.role === role).at(-1);
    const r = await loginAs(u.username);
    if (r.role && r.role !== role) throw new Error(`${u.username} is ${r.role} in the DB, expected ${role}`);
    out[role] = { username: u.username, token: r.token };
  }
  return out;
}
