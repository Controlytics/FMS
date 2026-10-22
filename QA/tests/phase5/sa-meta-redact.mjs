// Phase 5 re-run: the SUPER_ADMIN-only write cases (no non-SA role can reach them). OPERATOR-RUN ONLY:
// it needs the superadmin password, which is never printed, logged or written to a report.
//   1. Start the scratch API from the HEAD worktree:  bash QA/tests/phase5/start-scratch-head.sh <worktree>
//   2. Run:  node QA/tests/phase5/sa-meta-redact.mjs            (hidden prompt)
//            node QA/tests/phase5/sa-meta-redact.mjs --password-file <path>   (no terminal, e.g. via `!`:
//            a file holding only the password; delete it afterwards). Never put the password on a command line.
// Target is fixed: https://localhost:3112 + digilog_qa_perf (refuses anything else).
// Cases:
//   S1-S3  destructive SA writes sent WITHOUT the password -> 401 REAUTH_REQUIRED (OD-01: always-on, SA included).
//          Random ids, so a write that slipped past the gate answers 404 and changes nothing.
//   S4     signed redaction of the SA's own newest LOGIN_SUCCESS row -> 200 (creates ONE meta row,
//          AUDIT_RECORD_REDACTED; chain-preserving) — the fixture for S5-S7
//   S5-S7  that meta row: signed redact / bulk-redact / edit -> 409 META_AUDIT_IMMUTABLE (54f23fc), row unchanged
// Mutations: one SA login session, one redacted LOGIN_SUCCESS row (its payload NULLed by design), audit rows.
// If the S7 refusal were MISSING, S7 would be a real edit of the meta row (user_name -> qa-p5-tamper) on the
// clone — that is the defect it looks for; S8 then reports CHECK.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sql, save } from './lib5.mjs';

const BASE = 'https://localhost:3112';
if (process.env.PERF_TARGET && process.env.PERF_TARGET !== BASE) throw new Error(`REFUSING: PERF_TARGET must be ${BASE}`);
const agent = new https.Agent({ rejectUnauthorized: false });
const SA_USER = 'superadmin';
const rnd = () => crypto.randomUUID();
const req = (method, p, { token, body, headers = {} } = {}) => new Promise((resolve) => {
  const h = { accept: 'application/json', ...headers };
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (payload) { h['content-type'] = 'application/json'; h['content-length'] = payload.length; }
  if (token) h.authorization = `Bearer ${token}`;
  const r = https.request(new URL(p, BASE), { method, headers: h, agent }, (res) => {
    let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let j; try { j = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
  });
  r.on('error', (e) => resolve({ status: 0, json: { error: String(e) } }));
  if (payload) r.write(payload); r.end();
});
const argv = process.argv.slice(2);
const pwFile = argv.includes('--password-file') ? argv[argv.indexOf('--password-file') + 1] : null;
async function readPassword() {
  if (pwFile) return fs.readFileSync(pwFile, 'utf8').replace(/\r?\n$/, '');
  if (!process.stdin.isTTY) throw new Error('No terminal for the hidden prompt: use --password-file <path>.');
  process.stdout.write(`Password for ${SA_USER} (hidden): `);
  return new Promise((resolve) => {
    let pw = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); resolve(pw); }
      else if (ch === '\u0003') process.exit(130);
      else if (ch === '\u007f' || ch === '\b') pw = pw.slice(0, -1);
      else pw += ch;
    };
    process.stdin.on('data', onData);
  });
}
const results = [];
const rec = (id, what, r, expect, pass) => { results.push({ id, what, status: r.status, error: r.json?.error, expect, verdict: pass ? 'PASS' : 'CHECK' }); console.log(`${pass ? 'PASS ' : 'CHECK'} ${id} ${what} -> ${r.status} ${r.json?.error ?? ''} (expect ${expect})`); };

if ((await req('GET', '/api/health')).status !== 200) throw new Error(`scratch API not reachable on ${BASE}`);
// The API on :3112 must be the Phase 5 scratch API on digilog_qa_perf: its own log says which DB it opened.
const logRoot = path.join(process.env.LOCALAPPDATA ?? '', 'Temp', 'digilog-p5-scratch', 'logs', 'app');
const dbLines = ['database', 'application'].flatMap((d) => { const dir = path.join(logRoot, d); return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []; })
  .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('Database connected (')));
const lastDb = dbLines.sort().pop() ?? '';
if (!lastDb.includes('Database connected (digilog_qa_perf)')) throw new Error(`REFUSING: no "Database connected (digilog_qa_perf)" line under ${logRoot} (start-scratch-head.sh)`);
const PW = await readPassword();
const login = await req('POST', '/api/auth/login', { body: { username: SA_USER, password: PW } });
if (login.status !== 200) throw new Error(`SA login failed: ${login.status} ${login.json?.error}`);
const T = login.json.token;
const SIGN = { 'x-reauth-password': PW };
const reason = 'QA Phase 5 re-run: SA write probe';
const unsigned = (r) => r.status === 401 && r.json?.error === 'REAUTH_REQUIRED';

for (const [id, m, p, b] of [
  ['S1', 'DELETE', `/api/users/${rnd()}`, undefined],
  ['S2', 'POST', `/api/audit/${rnd()}/redact`, { reason }],
  ['S3', 'PUT', '/api/config/action-reauth', { NOT_AN_ACTION: ['NOBODY'] }],
]) { const r = await req(m, p, { token: T, body: b }); rec(id, `${m} ${p.replace(/[0-9a-f-]{36}/, '<random>')} unsigned`, r, '401 REAUTH_REQUIRED', unsigned(r)); }

// fixture: redact the SA's own newest LOGIN_SUCCESS row (signed)
const own = sql(`select id from audit_trail where action='LOGIN_SUCCESS' and user_id='${SA_USER}' and redacted_at is null order by chain_position desc limit 1`);
const red = await req('POST', `/api/audit/${own}/redact`, { token: T, headers: SIGN, body: { reason } });
rec('S4', 'signed redact of own LOGIN_SUCCESS (fixture)', red, '200', red.status === 200);
const meta = sql(`select id from audit_trail where action in ('AUDIT_RECORD_REDACTED') and target_id='${own}' order by chain_position desc limit 1`);
const before = sql(`select coalesce(redacted_at::text,'')||'|'||coalesce(checksum,'') from audit_trail where id='${meta}'`);
if (meta) {
  let r = await req('POST', `/api/audit/${meta}/redact`, { token: T, headers: SIGN, body: { reason } });
  rec('S5', 'signed redact of the META row', r, '409 META_AUDIT_IMMUTABLE', r.status === 409 && r.json?.error === 'META_AUDIT_IMMUTABLE');
  r = await req('POST', '/api/audit/bulk-redact', { token: T, headers: SIGN, body: { ids: [meta], reason } });
  rec('S6', 'signed bulk-redact including the META row', r, '409 META_AUDIT_IMMUTABLE', r.status === 409);
  r = await req('PUT', `/api/audit/${meta}`, { token: T, headers: SIGN, body: { reason, userName: 'qa-p5-tamper' } });
  rec('S7', 'signed edit of the META row', r, '409 META_AUDIT_IMMUTABLE', r.status === 409);
  const after = sql(`select coalesce(redacted_at::text,'')||'|'||coalesce(checksum,'') from audit_trail where id='${meta}'`);
  results.push({ id: 'S8', what: 'meta row unchanged after S5-S7', verdict: before === after ? 'PASS' : 'CHECK' });
  console.log(before === after ? 'PASS ' : 'CHECK', 'S8 meta row unchanged');
}
await req('POST', '/api/auth/logout', { token: T });
save('sa-meta-redact', { at: new Date().toISOString(), redactedFixture: own, metaRow: meta, results });
