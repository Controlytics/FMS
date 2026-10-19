// QA-D003 pre-flight: every config value ALREADY STORED for the 12 defs served by
// PUT /api/config/dynamic/:key must pass the new validateAgainstSettings(), or the
// new server check would refuse an unchanged re-save and lock the page.
// Imports only the def files + the pure validator (no Prisma client, so it can
// never reach digilog_db); stored values come from psql on the named *_perf / test DB.
//   npx tsx QA/tests/probes/config-stored-values-check.mts digilog_qa_perf digilog_test_db
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateAgainstSettings } from '../../../apps/api/src/lib/config-settings-validate.ts';

const dbs = process.argv.slice(2);
if (!dbs.length || dbs.some((d) => d === 'digilog_db')) throw new Error('name test/clone databases only (never digilog_db)');

const defsDir = path.resolve('apps/api/src/modules/config/defs');
const defs: any[] = [];
for (const f of fs.readdirSync(defsDir).filter((f) => f.endsWith('.def.ts'))) {
  const mod = await import(pathToFileURL(path.join(defsDir, f)).href);
  for (const v of Object.values(mod)) if (v && typeof v === 'object' && 'moduleKey' in (v as any)) defs.push(v);
}
const dynamic = defs.filter((d) => !d.hasCustomPage);

const PSQL = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
let failures = 0;
for (const db of dbs) {
  for (const d of dynamic) {
    const raw = execFileSync(PSQL, ['-U', 'digilog', '-h', 'localhost', '-d', db, '-tAX', '-c',
      `select config_value from system_config where config_key = '${d.moduleKey}'`],
      { env: { ...process.env, PGPASSWORD: 'digilog123' }, encoding: 'utf8' }).trim();
    if (!raw) { console.log(`${db.padEnd(16)} ${d.moduleKey.padEnd(30)} (not stored)`); continue; }
    const value = JSON.parse(raw);
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const errs = Array.isArray(value) ? ['stored value is an array (not an object)'] : validateAgainstSettings(d.settings, body);
    if (errs.length) failures++;
    console.log(`${db.padEnd(16)} ${d.moduleKey.padEnd(30)} ${errs.length ? 'FAIL ' + errs.join('; ') : 'ok'}`);
  }
}
console.log(`dynamic defs: ${dynamic.length}; failures: ${failures}`);
process.exitCode = failures ? 1 : 0;
