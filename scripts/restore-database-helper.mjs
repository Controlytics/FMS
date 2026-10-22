/**
 * Node half of scripts/restore-database.ps1 (D-DB-6, 2026-10-22). Run ONLY by that
 * script - it validates paths, builds the SQL and decides what happens next.
 *
 * Why Node at all:
 *   - PowerShell 5.1 cannot pipe bytes between two native programs (it re-encodes
 *     every line as a string), and the dump has to stream into ONE psql session.
 *   - The audit-trail steps must run the APP'S OWN code, not a copy of it:
 *     preserveUnbackedAuditRows + resyncSequencesAfterRestore (what the in-app
 *     restore does after pg_restore), verifyAuditChain, and auditLog (the keyed
 *     HMAC chain - AUDIT_CHAIN_KEY lives in digilog.env, never in the database).
 *
 * Commands (each prints ONE result line on stdout: "@@restore-result@@" + JSON;
 * progress goes to stderr):
 *   inspect-sql <file>                     plain-SQL dump: header, trailer, schemas, COPY targets
 *   load --psql P --prelude F --postlude F (--sql FILE | --pg-restore R --archive A --list L)
 *                                          stream the dump into ONE psql transaction
 *   carry-over --keep-table T [...]        app's preserveUnbackedAuditRows for each keep
 *                                          table, then resyncSequencesAfterRestore
 *   verify-chain [--from-position N] [--window N]
 *                                          app's verifyAuditChain, windowed (overlap by one)
 *   chain-tip                              highest chain_position + its checksum
 *   write-restored-row --payload FILE      app's auditLog(BACKUP_RESTORED)
 *
 * App-code commands take: --api-src DIR (apps/api/src, dev, run under tsx) or
 * --api-dist DIR (runtime\api\dist, installed), --env-file FILE and --expect-db NAME.
 * DATABASE_URL must already be set in the environment by the caller; dotenv never
 * overrides it, and the connected database is checked against --expect-db before
 * anything is read or written.
 */
import { createReadStream, readFileSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , command, ...rest] = process.argv;

function arg(name) {
  const i = rest.indexOf(name);
  return i >= 0 && i + 1 < rest.length ? rest[i + 1] : undefined;
}
function args(name) {
  const out = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === name && i + 1 < rest.length) out.push(rest[i + 1]);
  return out;
}
const RESULT_MARK = '@@restore-result@@';
function progress(msg) {
  process.stderr.write(`[helper] ${msg}\n`);
}
function done(obj) {
  // Marked: the app's logger also writes to stdout (lib/logger.ts never drops it),
  // so the caller looks for this prefix, not for "a line starting with {".
  process.stdout.write(RESULT_MARK + JSON.stringify(obj) + '\n');
}

// Statements a dump carries that must NOT run against an existing database:
//   - the public schema already exists (it is never dropped here), and on an
//     installed server it belongs to pg_database_owner;
//   - the extensions belong to the cluster superuser on an installed server
//     (provision-db.ps1 creates them as `postgres`), so the app role may not
//     COMMENT on them. CREATE EXTENSION IF NOT EXISTS is harmless and is kept.
// pg_dump writes each of these on ONE line, outside any COPY block.
const SKIP_LINE = [
  /^CREATE SCHEMA public;$/,
  /^ALTER SCHEMA public OWNER TO .*;$/,
  /^COMMENT ON SCHEMA public IS .*;$/,
  /^COMMENT ON EXTENSION .*;$/,
];
const DUMP_COMPLETE = '-- PostgreSQL database dump complete';

/**
 * Walk a SQL dump stream (a plain .sql file, or pg_restore's output for an archive)
 * line by line, tracking COPY blocks so data rows are never mistaken for statements,
 * and write every kept line to `out` (a writable stream, or null to only inspect).
 * Lines are split on the LF BYTE and data lines are passed through as raw bytes:
 * decoding chunk by chunk could split a multi-byte UTF-8 character across two chunks.
 * Counts the data rows of every COPY block (one line per row in COPY text format -
 * embedded newlines are escaped), so the caller can check that each table holds
 * exactly the rows the backup carried.
 */
function walkSqlStream(stream, out) {
  return new Promise((resolve, reject) => {
    const seen = { header: false, complete: false, schemas: [], copyTargets: [], copyRows: {}, skipped: [], bytes: 0, lines: 0 };
    let inCopy = false;
    let copyTarget = null;
    let carry = Buffer.alloc(0);
    let firstLine = true;
    const handle = (buf) => {
      seen.lines++;
      // Data lines are passed through as raw bytes; only statement lines are decoded.
      if (inCopy) {
        if (buf.length <= 3 && buf.toString('latin1').replace(/\r$/, '') === '\\.') inCopy = false;
        else seen.copyRows[copyTarget]++;
        return buf;
      }
      const bare = buf.toString('utf8').replace(/\r$/, '');
      if (firstLine) { firstLine = false; seen.header = bare.startsWith('--'); }
      if (bare === DUMP_COMPLETE) seen.complete = true;
      const copy = /^COPY ([^ (]+) .*FROM stdin;$/.exec(bare);
      if (copy) {
        inCopy = true;
        copyTarget = copy[1];
        seen.copyTargets.push(copyTarget);
        seen.copyRows[copyTarget] = seen.copyRows[copyTarget] ?? 0;
        return buf;
      }
      const schema = /^CREATE SCHEMA ([^ ;]+);$/.exec(bare);
      if (schema && schema[1] !== 'public') seen.schemas.push(schema[1].replace(/^"|"$/g, ''));
      if (SKIP_LINE.some((re) => re.test(bare))) { seen.skipped.push(bare); return null; }
      return buf;
    };
    const NL = Buffer.from('\n');
    let finished = false;
    const finish = (aborted) => {
      if (finished) return;
      finished = true;
      seen.endedInCopy = inCopy;
      seen.aborted = aborted;
      resolve(seen);
    };
    // psql stopped (an SQL error): stop reading instead of waiting for a 'drain'
    // that will never come.
    if (out) {
      out.once('close', () => { stream.destroy(); finish(true); });
      out.once('error', () => { stream.destroy(); finish(true); });
    }
    stream.on('data', (chunk) => {
      seen.bytes += chunk.length;
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const parts = [];
      let start = 0;
      let nl;
      while ((nl = data.indexOf(10, start)) !== -1) {
        const r = handle(data.subarray(start, nl));
        if (r != null) parts.push(r, NL);
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
      if (parts.length && out) {
        if (!out.write(Buffer.concat(parts))) { stream.pause(); out.once('drain', () => stream.resume()); }
      }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      if (carry.length) {
        const r = handle(carry);
        if (r != null && out) out.write(r);
      }
      finish(false);
    });
  });
}

function walkSqlFile(file, out) {
  return walkSqlStream(createReadStream(file, { highWaterMark: 1 << 20 }), out);
}

function summarizeSeen(seen) {
  return {
    header: seen.header,
    complete: seen.complete && !seen.endedInCopy && !seen.aborted,
    endedInCopy: seen.endedInCopy,
    schemas: [...new Set(seen.schemas)],
    copyTargets: seen.copyTargets,
    copyRows: seen.copyRows,
    skippedStatements: seen.skipped,
    bytes: seen.bytes,
    lines: seen.lines,
  };
}

async function inspectSql(file) {
  // Version line, from the head only.
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(Math.min(fstatSync(fd).size, 16384));
  readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  const m = /-- Dumped from database version (\S+)/.exec(head.toString('utf8'));
  const seen = await walkSqlFile(file, null);
  done({ ...summarizeSeen(seen), dumpedFromVersion: m ? m[1] : null });
}

/**
 * Stream the dump into ONE psql transaction: `psql -1 -f prelude -f - -f postlude`.
 * The postlude refuses to commit unless the stream's last statement - written HERE,
 * only after the source finished cleanly - set `digilog.stream_complete`. Without
 * that, a pg_restore that died half-way (truncated archive) would hand psql a short
 * script, and psql -1 would COMMIT whatever it had received.
 */
async function load() {
  const psqlExe = arg('--psql');
  const prelude = arg('--prelude');
  const postlude = arg('--postlude');
  const sqlFile = arg('--sql');
  const archive = arg('--archive');
  const pgRestore = arg('--pg-restore');
  const list = arg('--list');
  if (!psqlExe || !prelude || !postlude || (!sqlFile && !(archive && pgRestore && list))) {
    throw new Error('load: missing arguments');
  }

  // Connection settings come from PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD set by
  // the caller. Query results (set_config, setval rows) go to NUL; errors and
  // notices stay on stderr. stdout is reserved for this helper's JSON result.
  const psql = spawn(psqlExe, [
    '-X', '-q', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
    '-v', 'ON_ERROR_STOP=1', '--single-transaction',
    '-f', prelude, '-f', '-', '-f', postlude,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const psqlExit = new Promise((resolve) => psql.on('close', (code, signal) => resolve({ code, signal })));
  let psqlGone = false;
  psql.on('close', () => { psqlGone = true; });
  psql.stdin.on('error', (err) => progress(`psql stdin closed early (${err.code ?? err.message}) - psql stopped on an error`));

  const SENTINEL = "SELECT pg_catalog.set_config('digilog.stream_complete', 'yes', true);\n";
  let source = { ok: false };

  if (sqlFile) {
    progress(`streaming plain SQL ${sqlFile}`);
    const seen = await walkSqlFile(sqlFile, psql.stdin);
    const s = summarizeSeen(seen);
    source = { ok: s.header && s.complete, kind: 'plain', ...s };
    if (!source.ok) progress(`plain SQL stream is NOT complete (header=${s.header}, trailer=${s.complete}, endedInCopy=${s.endedInCopy}) - refusing to commit`);
  } else {
    progress(`streaming ${archive} through pg_restore`);
    const pr = spawn(pgRestore, ['--no-owner', '--no-privileges', '-L', list, '-f', '-', archive], { stdio: ['ignore', 'pipe', 'inherit'] });
    // psql stopped on an error: pg_restore would block on a full pipe forever.
    psql.on('close', () => { if (pr.exitCode === null) pr.kill(); });
    const prExit = new Promise((resolve) => pr.on('close', (c) => resolve(c)));
    // Through the same walker as a plain file, for the per-table row counts.
    const seen = await walkSqlStream(pr.stdout, psql.stdin);
    const code = await prExit;
    const s = summarizeSeen(seen);
    source = { ok: code === 0 && !seen.aborted, kind: 'custom', pgRestoreExit: code, ...s };
    if (!source.ok) progress(`pg_restore exited ${code}${seen.aborted ? ' (psql stopped first)' : ''} - refusing to commit`);
  }

  if (source.ok && !psqlGone) {
    psql.stdin.write(SENTINEL);
    psql.stdin.end();
  } else if (!psqlGone) {
    // Kill the session mid-transaction: the server rolls the whole thing back.
    psql.kill();
  }
  const exit = await psqlExit;
  const committed = source.ok && exit.code === 0;
  done({ committed, psqlExit: exit.code, psqlSignal: exit.signal, source });
  process.exitCode = committed ? 0 : 1;
}

// ─── App-code commands ──────────────────────────────────────────────────────

async function loadApp() {
  const src = arg('--api-src');
  const dist = arg('--api-dist');
  const envFile = arg('--env-file');
  const expectDb = arg('--expect-db');
  if (!src === !dist) throw new Error('give exactly one of --api-src / --api-dist');
  if (!expectDb) throw new Error('--expect-db is required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set by the caller');

  const urlDb = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ''));
  if (urlDb !== expectDb) throw new Error(`DATABASE_URL names "${urlDb}", expected "${expectDb}" - refusing.`);

  const root = src ?? dist;
  const ext = src ? '.ts' : '.js';
  const apiDir = path.resolve(root, '..');
  // dotenv never overrides a variable that is already set, so DATABASE_URL (set by
  // the caller) wins; AUDIT_CHAIN_KEY / AUDIT_CHAIN_KEYED_FROM / LOG_DIR come from here.
  if (envFile) {
    const req = createRequire(path.join(apiDir, 'package.json'));
    req('dotenv').config({ path: envFile, quiet: true });
  }
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  if (process.env.DATABASE_URL.split('/').pop().split('?')[0] !== expectDb) {
    throw new Error('DATABASE_URL changed while loading the env file - refusing.');
  }

  const mod = (rel) => import(pathToFileURL(path.join(root, rel + ext)).href);
  const { prisma } = await mod('lib/prisma');
  const rows = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (rows[0]?.db !== expectDb) {
    await prisma.$disconnect();
    throw new Error(`connected to "${rows[0]?.db}", expected "${expectDb}" - refusing.`);
  }
  return { prisma, mod };
}

async function carryOver() {
  const keepTables = args('--keep-table');
  const { prisma, mod } = await loadApp();
  try {
    const repo = await mod('modules/backup/backup.repository');
    if (typeof repo.preserveUnbackedAuditRows !== 'function' || typeof repo.resyncSequencesAfterRestore !== 'function') {
      throw new Error('backup.repository no longer exports preserveUnbackedAuditRows / resyncSequencesAfterRestore');
    }
    const perTable = {};
    let total = 0;
    await prisma.$transaction(async (tx) => {
      for (const t of keepTables) {
        progress(`carrying over audit rows from ${t}`);
        const n = await repo.preserveUnbackedAuditRows(tx, t);
        perTable[t] = n;
        total += n;
      }
      // Same as restoreDump (D1, 2026-10-21): pg_restore set the chain-position
      // sequence back to its value at dump time; the carried rows sit above it.
      await repo.resyncSequencesAfterRestore(tx, ['audit_trail']);
    }, { timeout: 60 * 60_000, maxWait: 60_000 });
    done({ ok: true, total, perTable });
  } finally {
    await prisma.$disconnect();
  }
}

async function chainTip() {
  const { prisma } = await loadApp();
  try {
    const r = await prisma.$queryRawUnsafe(
      'SELECT chain_position::text AS p, checksum, id::text AS id FROM audit_trail WHERE chain_position IS NOT NULL ORDER BY chain_position DESC LIMIT 1');
    const c = await prisma.$queryRawUnsafe('SELECT count(*)::text AS n FROM audit_trail');
    done({ position: r[0] ? Number(r[0].p) : null, checksum: r[0]?.checksum ?? null, id: r[0]?.id ?? null, rows: Number(c[0].n) });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * The app's verifyAuditChain loads every requested row at once, which does not fit
 * at production volume (7.4 M rows at one year). Walk it in row windows that OVERLAP
 * BY ONE ROW: the verifier treats the first row of each call as a genesis (no link
 * or gap check), so window k+1 starts AT the last row of window k and that row's
 * successor link is checked inside window k+1. Same technique as
 * tests/performance/data-generation/verify-perf-chain.ts.
 */
// PowerShell 5.1's ConvertFrom-Json refuses JSON over 2 MB, so at most this many
// anomalies are listed (the counts per kind are always complete).
const MAX_LISTED_ANOMALIES = 10000;

async function verifyChain() {
  const windowSize = Number(arg('--window') ?? 200000);
  const fromPosition = arg('--from-position') != null ? Number(arg('--from-position')) : 0;
  const { prisma, mod } = await loadApp();
  try {
    const { verifyAuditChain } = await mod('lib/audit-verify');
    const t0 = Date.now();
    const bounds = await prisma.$queryRawUnsafe(
      'SELECT min(chain_position)::text AS lo, max(chain_position)::text AS hi FROM audit_trail WHERE chain_position >= $1', BigInt(fromPosition));
    let lo = bounds[0]?.lo == null ? null : Number(bounds[0].lo);
    const last = bounds[0]?.hi == null ? null : Number(bounds[0].hi);
    const first = lo;
    const anomaliesByKind = {};
    const anomalies = [];
    const seen = new Set();
    let tamperingCount = 0;
    let totalRows = 0;
    let windows = 0;
    let highest = null;
    while (lo != null) {
      const hiRow = await prisma.$queryRawUnsafe(
        'SELECT chain_position::text AS p FROM audit_trail WHERE chain_position >= $1 ORDER BY chain_position OFFSET $2 LIMIT 1',
        BigInt(lo), windowSize - 1);
      const hi = hiRow[0] ? Number(hiRow[0].p) : last;
      const r = await verifyAuditChain({ fromPosition: lo, toPosition: hi });
      windows++;
      totalRows += r.totalRowsChecked - (windows > 1 ? 1 : 0);
      if (r.highestPosition != null) highest = r.highestPosition;
      for (const a of r.anomalies) {
        const key = `${a.id}:${a.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        anomaliesByKind[a.kind] = (anomaliesByKind[a.kind] ?? 0) + 1;
        if (!a.informational && !a.kind.startsWith('LEGACY_')) tamperingCount++;
        if (anomalies.length < MAX_LISTED_ANOMALIES) {
          anomalies.push({ id: a.id, position: a.position, kind: a.kind, informational: !!a.informational });
        }
      }
      progress(`chain: ${totalRows} rows checked (window ${windows}, up to position ${hi})`);
      if (hi >= last) break;
      lo = hi;
    }
    // Rows with no chain_position are outside every window above; count them so a
    // NULL position is reported rather than silently skipped.
    const nulls = await prisma.$queryRawUnsafe('SELECT count(*)::text AS n FROM audit_trail WHERE chain_position IS NULL');
    done({
      ok: true,
      fromPosition: first,
      highestPosition: highest,
      totalRows,
      nullPositionRows: Number(nulls[0].n),
      windows,
      intact: tamperingCount === 0,
      tamperingCount,
      anomalyCount: seen.size,
      anomaliesTruncated: seen.size > anomalies.length,
      anomaliesByKind,
      anomalies,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function writeRestoredRow() {
  const payload = JSON.parse(readFileSync(arg('--payload'), 'utf8'));
  const { prisma, mod } = await loadApp();
  try {
    const { auditLog } = await mod('lib/audit');
    const id = await auditLog({
      userId: payload.userId,
      userName: payload.userName,
      action: 'BACKUP_RESTORED',
      targetType: 'system',
      targetId: 'database_restore',
      afterValue: payload.afterValue,
      reason: payload.reason,
      signatureMeaning: payload.signatureMeaning,
    });
    const r = await prisma.$queryRawUnsafe('SELECT chain_position::text AS p FROM audit_trail WHERE id = $1::uuid', id);
    done({ ok: true, id, chainPosition: r[0] ? Number(r[0].p) : null });
  } finally {
    await prisma.$disconnect();
  }
}

const commands = {
  'inspect-sql': () => inspectSql(rest[0]),
  load,
  'carry-over': carryOver,
  'chain-tip': chainTip,
  'verify-chain': verifyChain,
  'write-restored-row': writeRestoredRow,
};

const fn = commands[command];
if (!fn) {
  progress(`unknown command "${command}"`);
  process.exit(2);
}
try {
  await fn();
} catch (err) {
  progress(`FAILED: ${err?.stack ?? err}`);
  done({ ok: false, error: String(err?.message ?? err) });
  process.exitCode = 1;
}
