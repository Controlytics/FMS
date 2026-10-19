// Probe R2: does a config PUT validate the body against the declared rules or
// store whatever arrives?
//
// Two write paths exist (apps/api/src/modules/config):
//  - PUT /api/config/:key (routes.ts configEndpoint) -> configService.updateConfig with a Zod
//    schema from @digilog/shared. Used by custom-page defs (session, password-policy, ...).
//  - PUT /api/config/dynamic/:key (dynamic-routes.ts) -> validates only if the def has
//    zodSchema / hooks.validate; 0 of 38 defs do. Used by the 12 defs without a custom page,
//    ALL requiredRole SUPER_ADMIN (not probed here: no usable SUPER_ADMIN on the clone).
//
// This probe exercises the first path with an ADMIN (session def: idleTimeoutMinutes
// declared min 5 / max 60 "for 21 CFR Part 11"). Verdict:
//  PASS = 400 and nothing stored; FAIL = 2xx and the bad value stored; else INCONCLUSIVE.
// Restores the original value through the same audited PUT if anything changed.
import { call, tokenFor, PASSWORD, sql, report } from '../lib/qa.mjs';

const key = 'session';
const url = `/api/config/${key}`;
const admin = await tokenFor('ADMIN');
const read = () => JSON.parse(sql(`select config_value from system_config where config_key = '${key}'`) || '{}');
const original = read();

const cases = [
  { name: 'idle-out-of-range', body: { idleTimeoutMinutes: 100000 } },
  { name: 'idle-below-min', body: { idleTimeoutMinutes: 0 } },
  { name: 'duration-wrong-type', body: { sessionDurationHours: 'forever' } },
  { name: 'unknown-key', body: { injectedKey: { nested: '<b>x</b>' } }, strippedIsPass: true },
];

const results = [];
for (const c of cases) {
  const put = await call('PUT', url, { token: admin.token, body: { ...c.body, _currentPassword: PASSWORD } });
  const stored = read();
  const changed = JSON.stringify(stored) !== JSON.stringify(original);
  let verdict = 'INCONCLUSIVE';
  if (put.status === 400 && !changed) verdict = 'PASS';
  else if (c.strippedIsPass && put.status === 200 && !changed) verdict = 'PASS'; // Zod strips unknown keys
  else if (put.status >= 200 && put.status < 300 && changed) verdict = 'FAIL';
  results.push({ case: c.name, sent: c.body, status: put.status, response: put.json, storedAfter: stored, changed, verdict });
  if (changed) {
    const restore = await call('PUT', url, { token: admin.token, body: { ...original, _currentPassword: PASSWORD } });
    const ok = JSON.stringify(read()) === JSON.stringify(original);
    results.at(-1).restore = { status: restore.status, ok };
    if (!ok) {
      // the audited path refused to put it back (e.g. it now rejects a stray key) — restore at DB level on the clone
      sql(`update system_config set config_value = '${JSON.stringify(original).replace(/'/g, "''")}'::jsonb where config_key = '${key}'`);
      results.at(-1).restore.sqlFallback = JSON.stringify(read()) === JSON.stringify(original);
    }
  }
}

const overall = results.some((r) => r.verdict === 'FAIL') ? 'FAIL'
  : results.every((r) => r.verdict === 'PASS') ? 'PASS' : 'INCONCLUSIVE';
report('R2-config-put-validation-session', overall, { user: admin.username, role: admin.role, url, original, results, finalStored: read() });
for (const r of results) console.log(`  ${r.verdict.padEnd(12)} ${r.case.padEnd(22)} HTTP ${r.status} ${r.response?.error ?? ''} changed=${r.changed}`);
