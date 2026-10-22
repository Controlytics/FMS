// Fresh password login for the given users so failed_login_attempts goes back to 0 (no lockout carry-over).
import { raw, sql, PASSWORD } from './lib5.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { QA_RESULTS } from '../lib/qa.mjs';
const users = process.argv.slice(2);
const cacheFile = path.join(QA_RESULTS, `tokens-qa-${new URL(process.env.PERF_TARGET ?? 'https://localhost:3104').port}.json`);
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
for (const u of users) {
  const r = await raw('POST', '/api/auth/login', { body: { username: u, password: PASSWORD, force: true, client: 'web' } });
  if (r.json?.token) cache[u] = r.json.token;
  console.log(u, r.status, r.json?.error ?? 'ok');
}
fs.writeFileSync(cacheFile, JSON.stringify(cache));
console.log(sql(`select username, failed_login_attempts, lockout_until from users where username in (${users.map((u) => `'${u}'`).join(',')})`));
