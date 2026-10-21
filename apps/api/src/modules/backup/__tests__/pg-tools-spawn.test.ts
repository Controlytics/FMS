/**
 * pg-tools process handling (coverage campaign 2026-10-21). The child-process
 * boundary is mocked — `spawn` returns a scripted fake child — and so is the
 * filesystem probe (`access`). Nothing here starts a real pg_dump/pg_restore.
 *
 * Pinned:
 *   - binary resolution order (PG_BIN_DIR → newest installed major → PATH) and
 *     its cache, on win32 and elsewhere;
 *   - the exact argv for pg_dump / pg_restore, and that the password travels in
 *     PGPASSWORD on the child's env, never in argv (B-F2);
 *   - version gating, exit-code / ENOENT / spawn-throw / timeout mapping, and
 *     stderr surfacing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

const { spawnMock, accessMock } = vi.hoisted(() => ({ spawnMock: vi.fn(), accessMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<object>()), access: accessMock }));

import {
  resolvePgBinary, __resetPgBinaryCacheForTest, runPgDump, runPgRestore, assertPgDumpVersion, PgToolError,
} from '../pg-tools.js';

type Script = (child: FakeChild) => void;
interface FakeChild extends EventEmitter { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }

const scripts: Script[] = [];
function fakeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.kill = vi.fn();
  return c;
}
/** Queue the behaviour of the next spawned child (run on the next tick). */
const next = (s: Script) => scripts.push(s);
const ok = (stdout = '', stderr = ''): Script => (c) => {
  if (stdout) c.stdout.emit('data', Buffer.from(stdout));
  if (stderr) c.stderr.emit('data', Buffer.from(stderr));
  c.emit('close', 0);
};
const version = (v: string) => ok(`pg_dump (PostgreSQL) ${v}\n`);
/** Poll on setImmediate: unlike vi.waitFor it never advances the fake clock. */
async function until(cond: () => boolean) {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error('condition never became true');
}

const ENV_KEYS = ['DATABASE_URL', 'PG_BIN_DIR'] as const;
const saved: Record<string, string | undefined> = {};
const realPlatform = process.platform;

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.PG_BIN_DIR = 'C:\\pgbin';
  process.env.DATABASE_URL = 'postgresql://digi:s3cr%40t@db.local:5432/dfms?schema=public&connection_limit=5&sslmode=prefer';
  __resetPgBinaryCacheForTest();
  scripts.length = 0;
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    const child = fakeChild();
    const s = scripts.shift();
    if (s) setImmediate(() => s(child));
    return child;
  });
  accessMock.mockReset();
  accessMock.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  Object.defineProperty(process, 'platform', { value: realPlatform });
  vi.useRealTimers();
});

describe('resolvePgBinary', () => {
  it('prefers PG_BIN_DIR and caches the result', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(await resolvePgBinary('pg_dump')).toBe(join('C:\\pgbin', 'pg_dump.exe'));
    expect(await resolvePgBinary('pg_dump')).toBe(join('C:\\pgbin', 'pg_dump.exe'));
    expect(accessMock).toHaveBeenCalledTimes(1);
  });

  it('walks the installed majors newest-first when PG_BIN_DIR misses (or is blank)', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.PG_BIN_DIR = '   ';
    accessMock.mockImplementation(async (p: string) => {
      if (!p.includes('\\17\\')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(await resolvePgBinary('pg_restore')).toBe(join('C:\\Program Files\\PostgreSQL\\17\\bin', 'pg_restore.exe'));
    const probed = accessMock.mock.calls.map((c) => c[0]);
    expect(probed).toEqual([
      join('C:\\Program Files\\PostgreSQL\\18\\bin', 'pg_restore.exe'),
      join('C:\\Program Files\\PostgreSQL\\17\\bin', 'pg_restore.exe'),
    ]);
  });

  it('falls back to the bare name (PATH) when no candidate exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    accessMock.mockRejectedValue(new Error('ENOENT'));
    expect(await resolvePgBinary('pg_dump')).toBe('pg_dump.exe');
    expect(accessMock).toHaveBeenCalledTimes(5); // PG_BIN_DIR + 18/17/16/15
  });

  it('uses Unix locations and no .exe suffix off Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env.PG_BIN_DIR;
    accessMock.mockRejectedValue(new Error('ENOENT'));
    expect(await resolvePgBinary('pg_dump')).toBe('pg_dump');
    expect(accessMock.mock.calls.map((c) => c[0])).toEqual(
      ['/usr/lib/postgresql/18/bin', '/usr/local/pgsql/bin', '/usr/bin', '/usr/local/bin'].map((d) => join(d, 'pg_dump')),
    );
  });
});

describe('runPgDump', () => {
  const BIN = join('C:\\pgbin', process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');

  it('checks the version, then dumps -Fc with the password in PGPASSWORD and never in argv', async () => {
    next(version('18.3'));
    next(ok());
    await runPgDump('C:\\tmp\\out.dump', { serverMajor: 18 });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [vBin, vArgs, vOpts] = spawnMock.mock.calls[0];
    expect([vBin, vArgs]).toEqual([BIN, ['--version']]);
    expect(vOpts.windowsHide).toBe(true);

    const [bin, args, opts] = spawnMock.mock.calls[1];
    expect(bin).toBe(BIN);
    // Prisma-only parameters stripped (schema, connection_limit), libpq ones kept
    expect(args).toEqual([
      '--dbname=postgresql://digi@db.local:5432/dfms?sslmode=prefer',
      '-Fc', '--no-owner', '--no-privileges', '-f', 'C:\\tmp\\out.dump',
    ]);
    expect(opts.env.PGPASSWORD).toBe('s3cr@t'); // percent-decoded
    expect(JSON.stringify(args)).not.toContain('s3cr');
    expect(opts.windowsHide).toBe(true);
  });

  it('a newer pg_dump than the server is fine; with no password in the URL the child inherits the env unchanged', async () => {
    process.env.DATABASE_URL = 'postgresql://digi@db.local/dfms';
    next(version('18.1'));
    next(ok());
    await runPgDump('o.dump', { serverMajor: 17 });
    const [, args, opts] = spawnMock.mock.calls[1];
    expect(args[0]).toBe('--dbname=postgresql://digi@db.local/dfms');
    expect(opts.env).toBe(process.env);
  });

  it('refuses a pg_dump older than the server before dumping anything', async () => {
    next(version('16.4'));
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err).toBeInstanceOf(PgToolError);
    expect(err.code).toBe('PG_TOOL_VERSION');
    expect(err.message).toMatch(/pg_dump is version 16 but the database server is version 18/);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('refuses when the version output is unrecognisable', async () => {
    next(ok('who knows'));
    const err = await assertPgDumpVersion(18).catch((e) => e);
    expect(err).toMatchObject({ name: 'PgToolError', code: 'PG_TOOL_FAILED' });
    expect(err.message).toBe('Could not determine the pg_dump version from "who knows".');
  });

  it('refuses without DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    next(version('18.0'));
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PG_TOOL_FAILED', message: 'DATABASE_URL is not set; cannot run pg_dump/pg_restore.' });
  });

  it('a non-zero exit becomes PG_TOOL_FAILED carrying the exit code and stderr', async () => {
    next(version('18.0'));
    next((c) => {
      c.stderr.emit('data', Buffer.from('pg_dump: error: connection to server failed\n'));
      c.emit('close', 1);
    });
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PG_TOOL_FAILED', exitCode: 1, stderr: 'pg_dump: error: connection to server failed\n' });
    expect(err.message).toBe(`${BIN} exited with code 1. pg_dump: error: connection to server failed`);
  });

  it('a missing binary (ENOENT) says how to fix it', async () => {
    next((c) => c.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PG_TOOL_NOT_FOUND', exitCode: null });
    expect(err.message).toMatch(/was not found\. Install the PostgreSQL client tools, or set PG_BIN_DIR/);
  });

  it('any other spawn error is PG_TOOL_FAILED', async () => {
    next((c) => c.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })));
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PG_TOOL_FAILED' });
    expect(err.message).toBe(`${BIN} failed to run: spawn EACCES`);
  });

  it('spawn throwing synchronously is reported as PG_TOOL_NOT_FOUND', async () => {
    spawnMock.mockImplementationOnce(() => { throw new Error('EINVAL bad path'); });
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'PG_TOOL_NOT_FOUND', stderr: '' });
    expect(err.message).toBe(`Could not start ${BIN}: EINVAL bad path`);
  });

  it('a hung --version is killed at 30 s and reported as a timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let child!: FakeChild;
    next((c) => { child = c; });
    const p = runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    await until(() => child !== undefined);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('close', null);
    const err = await p;
    expect(err).toMatchObject({ code: 'PG_TOOL_TIMEOUT', exitCode: null });
    expect(err.message).toBe(`${BIN} exceeded the 1 minute time limit and was terminated.`);
  });

  it('the dump itself gets 30 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    next(version('18.0'));
    let child!: FakeChild;
    next((c) => { child = c; });
    const p = runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    await until(() => child !== undefined);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(child.kill).toHaveBeenCalled();
    child.emit('close', 143);
    expect((await p).message).toMatch(/exceeded the 30 minute time limit/);
  });

  it('caps captured stderr (checked before each append) and trims it to 2000 chars in the message', async () => {
    next(version('18.0'));
    const chunk = 'E'.repeat(40 * 1024);
    next((c) => {
      for (let i = 0; i < 3; i++) c.stderr.emit('data', Buffer.from(chunk));
      for (let i = 0; i < 3; i++) c.stdout.emit('data', Buffer.from(chunk));
      c.emit('close', 2);
    });
    const err = await runPgDump('o.dump', { serverMajor: 18 }).catch((e) => e);
    expect(err.stderr.length).toBe(80 * 1024); // the third chunk arrived past the 64 KB cap
    expect(err.message.length).toBe(`${BIN} exited with code 2. `.length + 2000);
  });
});

describe('runPgRestore', () => {
  it('restores with --clean --if-exists --disable-triggers --exit-on-error --single-transaction and returns warnings', async () => {
    next(ok('', 'pg_restore: warning: errors ignored on restore: 0\n'));
    const r = await runPgRestore('C:\\tmp\\in.dump');
    expect(r).toEqual({ stderr: 'pg_restore: warning: errors ignored on restore: 0\n' });
    expect(spawnMock).toHaveBeenCalledTimes(1); // no version gate for restore
    const [bin, args, opts] = spawnMock.mock.calls[0];
    expect(bin).toBe(join('C:\\pgbin', process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore'));
    expect(args).toEqual([
      '--dbname=postgresql://digi@db.local:5432/dfms?sslmode=prefer',
      '--clean', '--if-exists', '--disable-triggers', '--exit-on-error', '--single-transaction', 'C:\\tmp\\in.dump',
    ]);
    expect(opts.env.PGPASSWORD).toBe('s3cr@t');
  });

  it('passes a libpq keyword/value connection string through untouched', async () => {
    process.env.DATABASE_URL = 'host=localhost dbname=dfms user=digi';
    next(ok());
    await runPgRestore('in.dump');
    const [, args, opts] = spawnMock.mock.calls[0];
    expect(args[0]).toBe('--dbname=host=localhost dbname=dfms user=digi');
    expect(opts.env).toBe(process.env);
  });

  it('surfaces a failed restore', async () => {
    next((c) => { c.stderr.emit('data', Buffer.from('pg_restore: error: input file is not a valid archive')); c.emit('close', 1); });
    const err = await runPgRestore('bad.dump').catch((e) => e);
    expect(err).toMatchObject({ code: 'PG_TOOL_FAILED', exitCode: 1 });
    expect(err.message).toContain('input file is not a valid archive');
  });
});
