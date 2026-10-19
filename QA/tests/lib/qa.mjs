// Shared helper for QA black-box probes. Reuses the load-test libraries so the
// same safety guards apply: accounts come from tests/performance/results/perf-users.json
// (refused unless it belongs to a *_perf database) and the target must be a
// localhost *_perf instance. Default target = the QA clone on :3104.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeAgent, request, REPO } from '../../../tests/performance/lib/http.mjs';
import { getTokens } from '../../../tests/performance/lib/auth.mjs';

export const TARGET = process.env.PERF_TARGET ?? 'https://localhost:3104';
export const DB = process.env.QA_DB ?? 'digilog_qa_perf';
const u = new URL(TARGET);
if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error(`QA target must be localhost, got ${u.hostname}`);
if (!/_perf$/.test(DB)) throw new Error(`QA_DB must end in _perf, got ${DB}`);

export const ctx = { target: TARGET, agent: makeAgent(TARGET) };
export const QA_RESULTS = path.join(REPO, 'QA/results');
fs.mkdirSync(QA_RESULTS, { recursive: true });

export const PASSWORD = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/performance/results/perf-users.json'), 'utf8')).users[0].password;

/** One token per requested role (first matching synthetic user). */
export async function tokenFor(role) {
  const [t] = await getTokens(TARGET, 1, { roles: [role], minRemainingSec: 600 });
  return t;
}

export const call = (method, url, opts = {}) => request(ctx, method, url, { parse: true, ...opts });

/** Logs in a QA-only account (QA/config/qa-accounts.md), caching its token per port. */
export async function loginAs(username, { client = 'web' } = {}) {
  const cacheFile = path.join(QA_RESULTS, `tokens-qa-${u.port}.json`);
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  if (cache[username]) {
    const me = await call('GET', '/api/auth/me', { token: cache[username] });
    if (me.status === 200) return { username, token: cache[username], role: me.json?.role ?? me.json?.user?.role };
  }
  const r = await call('POST', '/api/auth/login', { body: { username, password: PASSWORD, force: true, client } });
  if (r.status !== 200 || !r.json?.token) throw new Error(`login failed for ${username}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
  cache[username] = r.json.token;
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return { username, token: r.json.token, role: r.json.user?.role };
}

const PSQL = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
/** Read-only or restore SQL against the QA clone ONLY. */
export function sql(query) {
  return execFileSync(PSQL, ['-U', 'digilog', '-h', 'localhost', '-d', DB, '-tAX', '-c', query], {
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'digilog123' }, encoding: 'utf8',
  }).trim();
}

/** Records one probe result as JSON in QA/results/probes/<name>.json and prints a one-line verdict. */
export function report(name, verdict, evidence) {
  const dir = path.join(QA_RESULTS, 'probes');
  fs.mkdirSync(dir, { recursive: true });
  const out = { name, verdict, at: new Date().toISOString(), target: TARGET, db: DB, evidence };
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(out, null, 2));
  console.log(`${verdict.padEnd(10)} ${name}`);
  return out;
}
