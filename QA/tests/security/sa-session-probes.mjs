// SUPER_ADMIN probes for deliverable 06 (test-results/06-security-assessment.md, §9).
// Run ONCE, in the operator's SA session, against the SCRATCH API (port 3110, digilog_qa_perf).
//
//   1. Start the scratch API:   bash QA/tests/security/start-scratch-api.sh off
//   2. Check:                   node QA/tests/security/sa-session-probes.mjs --dry-run   (pre-flight only, no login)
//      Run:                     node QA/tests/security/sa-session-probes.mjs [--user superadmin] [--tamper] [--force-login]
//      Password: typed at a hidden prompt (interactive terminal). Where no terminal is available,
//      use --password-file <path> (a file holding only the password; delete it afterwards) or the
//      SA_PASSWORD environment variable. The password is never printed or written anywhere.
//   3. Stop the scratch API (the node process listening on 3110 only).
//
// What it changes on digilog_qa_perf (disposable clone): one SA login session; audit rows for the
// probe requests; ONE redaction of the SA's own newest LOGIN_SUCCESS row (chain-preserving).
// With --tamper it also UPDATEs that redacted row's user_name directly in the database, checks
// verify-chain, and puts the original value back in a finally block.
// Nothing is hard-deleted: every delete/edit probe uses a random id or an unknown name, so a probe
// that slips past the signature gate answers 404 / 400 and changes nothing.
//
// Results: printed table + QA/results/security/sa-session-probes-<timestamp>.json (QA/results is git-ignored).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BASE = 'https://localhost:3110';
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const SA_USER = arg('--user', 'superadmin');
const agent = new https.Agent({ rejectUnauthorized: false });
const rnd = () => crypto.randomUUID();
const results = [];

// ---------- safety: the scratch API must be up and on digilog_qa_perf ----------
function scratchLogRoot() {
  const la = (process.env.LOCALAPPDATA || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const a = path.join(la, 'Temp', 'digilog-sec-scratch', 'logs');
  return fs.existsSync(a) ? a : path.join(la, 'digilog-sec-scratch', 'logs');
}
function assertScratchDb() {
  const root = path.join(scratchLogRoot(), 'app');
  const files = [];
  for (const d of ['database', 'application']) {
    const dir = path.join(root, d);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) files.push(path.join(dir, f));
  }
  const lines = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('Database connected (')));
  const last = lines.sort().pop();
  if (!last || !last.includes('Database connected (digilog_qa_perf)')) {
    throw new Error(`REFUSING: no "Database connected (digilog_qa_perf)" line under ${root}. Start the API with start-scratch-api.sh.`);
  }
}

function req(method, p, { token, body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(payload); }
    if (token) h.authorization = `Bearer ${token}`;
    const r = https.request(BASE + p, { method, headers: h, agent, timeout: 60000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* not json */ } resolve({ status: res.statusCode, error: j?.error ?? null, message: String(j?.message ?? d).slice(0, 200), json: j }); });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, error: 'NETWORK', message: e.message }));
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

async function readPassword() {
  const file = arg('--password-file');
  if (file) return fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  if (process.env.SA_PASSWORD) return process.env.SA_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('No terminal for the hidden prompt: use --password-file <path> or SA_PASSWORD.');
  process.stdout.write(`Password for ${SA_USER} (hidden): `);
  return new Promise((resolve) => {
    let pw = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); resolve(pw); }
      else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
      else if (ch === '\u007f' || ch === '\b') pw = pw.slice(0, -1);
      else pw += ch;
    };
    process.stdin.on('data', onData);
  });
}

function record(group, id, what, res, expected, verdict) {
  results.push({ group, id, what, status: res.status, error: res.error, message: res.message, expected, verdict });
  console.log(`${verdict.padEnd(22)} ${id.padEnd(4)} ${what} -> ${res.status} ${res.error ?? ''}`);
}
// Part A verdict: after the OD-01 fix every one of these must ask for the password.
const signVerdict = (r) => (r.status === 401 && r.error === 'REAUTH_REQUIRED' ? 'SIGNED (fix present)'
  : [400, 404, 409].includes(r.status) ? 'UNSIGNED (SEC-01 open)' : 'CHECK');

// ---------- run ----------
const health = await req('GET', '/api/health');
if (health.status !== 200) throw new Error(`scratch API not reachable on ${BASE} (${health.status} ${health.message})`);
assertScratchDb();
if (flag('--dry-run')) { console.log('pre-flight OK: scratch API up on 3110 and connected to digilog_qa_perf (no login attempted)'); process.exit(0); }

const PW = await readPassword();
const login = await req('POST', '/api/auth/login', { body: { username: SA_USER, password: PW, force: flag('--force-login') } });
if (login.status !== 200) {
  console.error(`SA login refused: ${login.status} ${login.error} ${login.message}${login.error === 'SESSION_CONFLICT' ? ' (re-run with --force-login to end the other session on the CLONE)' : ''}`);
  process.exit(1);
}
const T = login.json.accessToken ?? login.json.token ?? login.json.data?.accessToken;
const SIGN = { 'x-reauth-password': PW };
console.log(`logged in as ${SA_USER} on the scratch API (digilog_qa_perf)\n`);

// ===== Part A — SEC-01 / OD-01: SA actions WITHOUT a password (random ids / unknown names: harmless if unsigned)
const reason = 'SA probe 06 (no password) - must be refused';
const A = [
  ['A1', 'PUT', `/api/audit/${rnd()}`, { reason, action: 'SECPROBE' }, 'audit edit (UPDATE_AUDIT_RECORD)'],
  ['A2', 'DELETE', `/api/audit/${rnd()}`, { reason }, 'audit hard delete (DELETE_AUDIT_RECORD)'],
  ['A3', 'POST', '/api/audit/bulk-delete', { ids: [rnd()], reason }, 'audit bulk delete'],
  ['A4', 'POST', `/api/audit/${rnd()}/redact`, { reason }, 'audit redact'],
  ['A5', 'POST', '/api/audit/bulk-redact', { ids: [rnd()], reason }, 'audit bulk redact'],
  ['A6', 'PUT', `/api/super-admin/data/notifications/${rnd()}`, { _changeReason: reason }, 'FDM edit (SUPER_ADMIN_DATA_EDIT)'],
  ['A7', 'DELETE', `/api/super-admin/data/notifications/${rnd()}`, { _changeReason: reason }, 'FDM delete'],
  ['A8', 'DELETE', `/api/users/${rnd()}`, undefined, 'user delete (DELETE_USER)'],
  ['A9', 'POST', '/api/users/bulk-delete', { userIds: [rnd()] }, 'user bulk delete'],
  ['A10', 'PUT', '/api/roles/SECPROBE_NO_SUCH_ROLE', { displayName: 'x', reason }, 'role update (UPDATE_ROLE)'],
  ['A11', 'DELETE', '/api/roles/SECPROBE_NO_SUCH_ROLE', undefined, 'role delete (DELETE_ROLE)'],
  ['A12', 'PUT', '/api/config/roles/SECPROBE_NO_SUCH_ROLE', { sidebarItems: [], reason }, 'role permission/sidebar save (UPDATE_ROLE_CONFIG)'],
  ['A13', 'PUT', `/api/config/users/${rnd()}`, { permissions: {}, reason }, 'user permission save (UPDATE_USER_CONFIG)'],
  ['A14', 'PUT', '/api/config/action-reauth', { SECPROBE_NOT_AN_ACTION: ['NOBODY'] }, 're-auth policy save (UPDATE_REAUTH_CONFIG; unknown name => 400 only after the gate)'],
];
console.log('Part A — expected after the OD-01 fix: 401 REAUTH_REQUIRED on every row');
for (const [id, m, p, b, what] of A) {
  const r = await req(m, p, { token: T, body: b });
  record('A', id, what, r, '401 REAUTH_REQUIRED', signVerdict(r));
}
{ // A15: always-on gate, sent with the CURRENT value so it changes nothing even if it got through
  const cur = await req('GET', '/api/super-admin/api-lock', { token: T });
  const enabled = cur.json?.enabled ?? cur.json?.data?.enabled;
  if (typeof enabled === 'boolean') {
    const r = await req('PUT', '/api/super-admin/api-lock', { token: T, body: { enabled } });
    record('A', 'A15', `SA API-lock toggle, same value (${enabled}), no password (always-on today)`, r, '401 REAUTH_REQUIRED', signVerdict(r));
  } else record('A', 'A15', 'read SA API-lock state', cur, '200 {enabled}', 'CHECK');
}

// ===== Part B — signed SA paths, chain integrity, SEC-02
console.log('\nPart B — signed paths and the audit chain');
const vc1 = await req('GET', '/api/audit/verify-chain', { token: T });
record('B', 'B1', `verify-chain before (intact=${vc1.json?.intact}, rows=${vc1.json?.totalRowsChecked}, anomalies=${vc1.json?.anomalies?.length})`, vc1, '200 intact=true', vc1.status === 200 && vc1.json?.intact === true ? 'PASS' : 'CHECK');

const list = await req('GET', '/api/audit/?action=LOGIN_SUCCESS&limit=20&sortBy=timestamp&sortOrder=desc', { token: T });
const rows = list.json?.data ?? list.json?.items ?? (Array.isArray(list.json) ? list.json : []);
const own = rows.find((x) => (x.userId === SA_USER || x.userName === SA_USER) && !x.redactedAt);
let target = own?.id ?? null;
if (!target) record('B', 'B2', 'find the SA\'s own LOGIN_SUCCESS row to redact', list, 'a row', 'CHECK');
else {
  const red = await req('POST', `/api/audit/${target}/redact`, { token: T, headers: SIGN, body: { reason: 'SA probe 06: signed redaction of own login row', _currentPassword: PW } });
  record('B', 'B2', `signed redact of own LOGIN_SUCCESS ${target}`, red, '200', red.status === 200 ? 'PASS' : 'CHECK');
  const meta = await req('GET', `/api/audit/?action=AUDIT_RECORD_REDACTED&targetId=${target}&limit=5`, { token: T });
  const m = (meta.json?.data ?? meta.json?.items ?? [])[0];
  const sig = m?.signatureAuditId ?? m?.signature_audit_id ?? null;
  record('B', 'B3', `AUDIT_RECORD_REDACTED row carries signatureAuditId (${sig ? 'yes' : 'no'})`, meta, 'signatureAuditId set', sig ? 'PASS' : 'CHECK');
  const vc2 = await req('GET', '/api/audit/verify-chain', { token: T });
  record('B', 'B4', `verify-chain after redaction (intact=${vc2.json?.intact})`, vc2, 'intact=true (redaction preserves the chain)', vc2.json?.intact === true ? 'PASS' : 'CHECK');

  if (flag('--tamper')) { // SEC-02: a DB-level rewrite of a REDACTED row must be detected
    if (!/^[0-9a-f-]{36}$/.test(target)) throw new Error('unexpected id');
    const psql = 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
    const base = fs.readFileSync(path.join(REPO, 'apps/api/.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].replace(/["\r]/g, '').replace(/\?.*$/, '');
    const url = base.replace(/\/[A-Za-z0-9_]+$/, '/digilog_qa_perf');
    if (!url.endsWith('/digilog_qa_perf')) throw new Error('REFUSING: tamper target is not digilog_qa_perf');
    const sql = (q) => execFileSync(psql, [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
    const original = sql(`select coalesce(user_name,'<<NULL>>') from audit_trail where id='${target}'`);
    try {
      sql(`update audit_trail set user_name='SECPROBE-TAMPERED' where id='${target}'`);
      const vc3 = await req('GET', '/api/audit/verify-chain', { token: T });
      record('B', 'B5', `verify-chain after a DB-level rewrite of the redacted row (intact=${vc3.json?.intact})`, vc3, 'intact=false (SEC-02 fixed); intact=true = SEC-02 open',
        vc3.json?.intact === false ? 'PASS (SEC-02 fixed)' : 'FAIL (SEC-02 open)');
    } finally {
      sql(original === '<<NULL>>' ? `update audit_trail set user_name=null where id='${target}'` : `update audit_trail set user_name='${original.replace(/'/g, "''")}' where id='${target}'`);
      const vc4 = await req('GET', '/api/audit/verify-chain', { token: T });
      record('B', 'B6', `verify-chain after restoring the row (intact=${vc4.json?.intact})`, vc4, 'intact=true', vc4.json?.intact === true ? 'PASS' : 'CHECK');
    }
  }
}
{
  const r = await req('DELETE', `/api/audit/${rnd()}`, { token: T, headers: SIGN, body: { reason: 'SA probe 06: signed delete of a random id', _currentPassword: PW } });
  record('B', 'B7', 'signed hard delete of a RANDOM id (path works when signed; nothing deleted)', r, '404', r.status === 404 ? 'PASS' : 'CHECK');
}
for (const [id, p] of [['B8', '/api/super-admin/api-lock'], ['B9', '/api/deployment-check/'], ['B10', '/api/debug/traces/?limit=1'], ['B11', '/api/super-admin/data/audit-trail?limit=1'], ['B12', '/api/super-admin/data/cleaning-cycles?limit=1']]) {
  const r = await req('GET', p, { token: T });
  record('B', id, `SA read ${p}`, r, '200', r.status === 200 ? 'PASS' : 'CHECK');
}

// ===== Part C — the same SA-only routes refuse a non-SA role (perf ADMIN on the clone)
const perf = path.join(REPO, 'tests/performance/results/perf-users.json');
if (fs.existsSync(perf)) {
  const pu = JSON.parse(fs.readFileSync(perf, 'utf8'));
  if (!/_perf$/.test(pu.database)) throw new Error('perf users are not for a _perf database');
  let AT = null;
  for (const u of pu.users.filter((x) => x.role === 'ADMIN').map((x) => x.username).reverse()) {
    const r = await req('POST', '/api/auth/login', { body: { username: u, password: pu.users.find((x) => x.username === u).password ?? pu.password } });
    if (r.status === 200) { AT = r.json.accessToken ?? r.json.token; break; }
  }
  console.log('\nPart C — SA-only routes as ADMIN: expected 403');
  if (AT) {
    for (const [id, m, p, b] of [
      ['C1', 'GET', '/api/audit/verify-chain'], ['C2', 'POST', `/api/audit/${rnd()}/redact`, { reason }], ['C3', 'PUT', `/api/audit/${rnd()}`, { reason }],
      ['C4', 'DELETE', `/api/audit/${rnd()}`, { reason }], ['C5', 'GET', '/api/deployment-check/'], ['C6', 'GET', '/api/super-admin/api-lock'],
      ['C7', 'GET', '/api/super-admin/data/cleaning-cycles?limit=1'], ['C8', 'PUT', `/api/super-admin/data/notifications/${rnd()}`, { _changeReason: reason }],
    ]) {
      const r = await req(m, p, { token: AT, body: b });
      record('C', id, `ADMIN ${m} ${p.replace(/[0-9a-f-]{36}/, ':id')}`, r, '403', r.status === 403 ? 'PASS' : 'CHECK');
    }
  } else console.log('no ADMIN perf user could log in (SESSION_CONFLICT?) — Part C skipped');
}

const outDir = path.join(REPO, 'QA/results/security');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `sa-session-probes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), target: BASE, database: 'digilog_qa_perf', saUser: SA_USER, tamper: flag('--tamper'), results }, null, 1));
const tally = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
console.log(`\nverdicts: ${JSON.stringify(tally)}\nresults: ${out}`);
