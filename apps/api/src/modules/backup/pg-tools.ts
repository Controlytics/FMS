/**
 * pg_dump / pg_restore integration — the ONLY backup format that is a true
 * physical restore of the database.
 *
 * Why this exists: the JSON/BAK/SQL/CSV exports are application-level row dumps.
 * They carry table DATA, not schema, sequences, functions or triggers, and the
 * plain .sql could not be replayed by `psql` or pgAdmin at all until the fixes
 * of 2026-08-08. A `-Fc` custom-format archive is what PostgreSQL itself
 * guarantees round-trips: enum arrays, FK ordering, sequence state and triggers
 * are all handled by pg_restore natively, so none of the manual work the plain
 * .sql needs applies here.
 *
 * It is also the only format pgAdmin's right-click "Restore" dialog accepts —
 * that dialog drives pg_restore, which cannot read a plain .sql script.
 *
 * VERSION REQUIREMENT: pg_dump's major version must be >= the server's major
 * version. pg_dump refuses to dump a server newer than itself ("server version
 * X; pg_dump version Y"), and an older archive format cannot express newer
 * catalog features. Verified at call time by assertPgDumpVersion() rather than
 * assumed, because a machine can easily have several PostgreSQL installs and a
 * stale one first on PATH.
 */
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

/** Max bytes captured from a child process's stderr (guards a runaway log). */
const MAX_STDERR = 64 * 1024;

/**
 * Candidate directories for the PostgreSQL client binaries, in priority order.
 *
 * `PG_BIN_DIR` is the operator escape hatch — set it when PostgreSQL lives
 * somewhere non-standard, or to pin a specific major version on a machine with
 * several installed. Everything after it is a best-effort guess; we never
 * ASSUME the binaries are on PATH (on Windows the PostgreSQL installer does not
 * add them by default, which is exactly the case on this deployment).
 */
function candidateBinDirs(): string[] {
  const dirs: string[] = [];
  const envDir = process.env.PG_BIN_DIR?.trim();
  if (envDir) dirs.push(envDir);
  if (process.platform === 'win32') {
    // Newest major first — pg_dump must be >= the server, never below.
    for (const major of ['18', '17', '16', '15']) {
      dirs.push(`C:\\Program Files\\PostgreSQL\\${major}\\bin`);
    }
  } else {
    dirs.push('/usr/lib/postgresql/18/bin', '/usr/local/pgsql/bin', '/usr/bin', '/usr/local/bin');
  }
  return dirs;
}

const exeName = (tool: string) => (process.platform === 'win32' ? `${tool}.exe` : tool);

/** Cache resolved paths — the filesystem probe is the same on every call. */
const resolved = new Map<string, string>();

/**
 * Absolute path to a PostgreSQL client binary.
 *
 * Falls back to the bare command name (i.e. "look on PATH") only after every
 * candidate directory has missed, so a correctly-configured PATH still works.
 */
export async function resolvePgBinary(tool: 'pg_dump' | 'pg_restore'): Promise<string> {
  const cached = resolved.get(tool);
  if (cached) return cached;

  for (const dir of candidateBinDirs()) {
    const full = join(dir, exeName(tool));
    try {
      await access(full, constants.X_OK);
      resolved.set(tool, full);
      return full;
    } catch {
      // Not in this directory — keep looking. A missing candidate is the
      // normal case (we probe several majors), not an error worth logging.
    }
  }
  // Last resort: PATH. If it isn't there either, spawn fails with ENOENT and
  // runTool() turns that into an actionable PG_TOOL_NOT_FOUND.
  resolved.set(tool, exeName(tool));
  return exeName(tool);
}

/** Test seam — clears the resolution cache. */
export function __resetPgBinaryCacheForTest(): void {
  resolved.clear();
}

export class PgToolError extends Error {
  code: string;
  exitCode: number | null;
  stderr: string;
  constructor(code: string, message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = 'PgToolError';
    this.code = code;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Run a PostgreSQL client binary to completion.
 *
 * The connection string is passed via `--dbname=<url>` rather than PGPASSWORD so
 * the password never becomes a separate environment variable that could be
 * inherited by anything else this process spawns. It IS still visible in the
 * child's argv (unavoidable with libpq URIs), so callers must never log argv.
 */
async function runTool(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (err: any) {
      reject(new PgToolError('PG_TOOL_NOT_FOUND', `Could not start ${bin}: ${err.message}`, null, ''));
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', d => { if (stdout.length < MAX_STDERR) stdout += d.toString(); });
    child.stderr?.on('data', d => { if (stderr.length < MAX_STDERR) stderr += d.toString(); });

    child.on('error', (err: any) => {
      clearTimeout(timer);
      const notFound = err?.code === 'ENOENT';
      reject(new PgToolError(
        notFound ? 'PG_TOOL_NOT_FOUND' : 'PG_TOOL_FAILED',
        notFound
          ? `${bin} was not found. Install the PostgreSQL client tools, or set PG_BIN_DIR to the directory containing them (e.g. C:\\Program Files\\PostgreSQL\\18\\bin).`
          : `${bin} failed to run: ${err.message}`,
        null,
        stderr,
      ));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PgToolError('PG_TOOL_TIMEOUT', `${bin} exceeded the ${Math.round(timeoutMs / 60000)} minute time limit and was terminated.`, code, stderr));
        return;
      }
      if (code !== 0) {
        reject(new PgToolError('PG_TOOL_FAILED', `${bin} exited with code ${code}. ${stderr.trim().slice(0, 2000)}`, code, stderr));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Parse "pg_dump (PostgreSQL) 18.3" → 18. Returns null when unrecognisable. */
export function parseMajorVersion(versionOutput: string): number | null {
  const m = versionOutput.match(/(\d+)(?:\.\d+)*\s*$/m) ?? versionOutput.match(/\)\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Query parameters libpq understands in a connection URI.
 *
 * pg_dump/pg_restore reject an UNKNOWN parameter outright — `pg_dump: error:
 * invalid URI query parameter: "schema"` — so anything not on this list must be
 * stripped rather than passed through and hoped for.
 */
const LIBPQ_URI_PARAMS = new Set([
  'host', 'hostaddr', 'port', 'dbname', 'user', 'password', 'passfile', 'channel_binding',
  'connect_timeout', 'client_encoding', 'options', 'application_name', 'fallback_application_name',
  'keepalives', 'keepalives_idle', 'keepalives_interval', 'keepalives_count', 'tcp_user_timeout',
  'replication', 'gssencmode', 'sslmode', 'sslcompression', 'sslcert', 'sslkey', 'sslpassword',
  'sslrootcert', 'sslcrl', 'sslcrldir', 'sslsni', 'requirepeer', 'ssl_min_protocol_version',
  'ssl_max_protocol_version', 'krbsrvname', 'gsslib', 'service', 'target_session_attrs',
  'load_balance_hosts',
]);

/**
 * Convert Prisma's `DATABASE_URL` into a URI libpq will accept.
 *
 * Prisma's connection string carries driver-specific parameters that libpq has
 * never heard of — `?schema=public` on every install here, plus
 * `connection_limit`, `pool_timeout`, `pgbouncer` and friends on tuned ones.
 * pg_dump treats an unrecognised parameter as a fatal error, so the FIRST dump
 * on a real deployment failed with `invalid URI query parameter: "schema"`
 * (2026-08-08) even though the tooling and permissions were all correct.
 *
 * Dropping `schema` does not narrow the dump: pg_dump defaults to every schema,
 * and this database only uses `public` anyway.
 *
 * Exported for testing — this is exactly the kind of string-munging that should
 * be pinned by cases rather than eyeballed.
 */
export function toLibpqUrl(raw: string): string {
  // Non-URI forms (libpq keyword/value strings like "host=... dbname=...") are
  // passed through untouched — they have no query string to clean.
  if (!/^postgres(ql)?:\/\//i.test(raw)) return raw;
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return raw;

  const base = raw.slice(0, qIndex);
  const kept: string[] = [];
  for (const pair of raw.slice(qIndex + 1).split('&')) {
    if (!pair) continue;
    const key = decodeURIComponent(pair.split('=')[0] ?? '').toLowerCase();
    if (LIBPQ_URI_PARAMS.has(key)) kept.push(pair);
  }
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new PgToolError('PG_TOOL_FAILED', 'DATABASE_URL is not set; cannot run pg_dump/pg_restore.', null, '');
  }
  return toLibpqUrl(url);
}

/**
 * Assert the local pg_dump is at least as new as the server it will dump.
 *
 * Checked every time rather than at boot: the operator can install or change a
 * PostgreSQL version underneath a long-running service, and failing here with a
 * clear message beats failing inside pg_dump with a bare exit code.
 */
export async function assertPgDumpVersion(serverMajor: number): Promise<{ toolMajor: number; serverMajor: number }> {
  const bin = await resolvePgBinary('pg_dump');
  const { stdout } = await runTool(bin, ['--version'], { timeoutMs: 30_000 });
  const toolMajor = parseMajorVersion(stdout.trim());
  if (toolMajor == null) {
    throw new PgToolError('PG_TOOL_FAILED', `Could not determine the pg_dump version from "${stdout.trim()}".`, null, '');
  }
  if (toolMajor < serverMajor) {
    throw new PgToolError(
      'PG_TOOL_VERSION',
      `pg_dump is version ${toolMajor} but the database server is version ${serverMajor}. `
      + `pg_dump must be the same major version or newer. Point PG_BIN_DIR at a PostgreSQL ${serverMajor}+ bin directory.`,
      null, '',
    );
  }
  return { toolMajor, serverMajor };
}

/**
 * Write a custom-format (-Fc) archive to `outPath`.
 *
 * -Fc is compressed and, unlike a plain script, is what pg_restore and pgAdmin's
 * Restore dialog consume. --no-owner/--no-privileges keep the archive portable
 * onto an install whose role names differ from this one (the customer installer
 * creates its own `digilog` role, and a restore should not fail because an owner
 * name does not exist on the target).
 */
export async function runPgDump(outPath: string, opts: { serverMajor: number }): Promise<void> {
  await assertPgDumpVersion(opts.serverMajor);
  const bin = await resolvePgBinary('pg_dump');
  await runTool(bin, [
    `--dbname=${databaseUrl()}`,
    '-Fc',
    '--no-owner',
    '--no-privileges',
    '-f', outPath,
  ]);
}

/**
 * Restore a custom-format archive over the CURRENT database.
 *
 * --clean --if-exists drops each object before recreating it (so this is a true
 * replace, not a merge); --disable-triggers suppresses the mirror + audit
 * immutability triggers during the data load, exactly as the application-level
 * restore does for its own path.
 *
 * pg_restore reports non-fatal problems by exiting non-zero WITH output on
 * stderr; `--exit-on-error` makes it stop at the first one instead of pressing
 * on and leaving a half-restored database that looks like a success.
 */
export async function runPgRestore(filePath: string): Promise<{ stderr: string }> {
  const bin = await resolvePgBinary('pg_restore');
  const { stderr } = await runTool(bin, [
    `--dbname=${databaseUrl()}`,
    '--clean',
    '--if-exists',
    '--disable-triggers',
    '--exit-on-error',
    '--single-transaction',
    filePath,
  ]);
  return { stderr };
}
