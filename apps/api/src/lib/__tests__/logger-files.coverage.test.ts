/**
 * The file half of lib/logger.ts, plus log-dir.ts / uploads-dir.ts resolution
 * and the formatter fallbacks in log-format.ts.
 *
 * Under vitest the logger never opens files (IS_TEST), so to exercise the real
 * routing this file imports a FRESH copy of the module with the test markers
 * cleared and LOG_DIR pointed at a private temp folder, then reads back what
 * landed in each channel's file. Every env var touched is restored right after
 * the import, and the opened streams are closed before the folder is removed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, type MockInstance } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { formatRecord, formatTime, formatLine, CHANNEL_KEY, MODULE_KEY } from '../log-format.js';

const ENV_KEYS = ['LOG_DIR', 'NODE_ENV', 'VITEST', 'LOG_LEVEL', 'UPLOAD_DIR', 'LOG_MAX_FILE_SIZE'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
function restoreEnv() {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'cvl-logs-'));
type LoggerModule = typeof import('../logger.js');

/** Import logger.js (and log-dir.js) fresh, with the given environment. */
async function freshLogger(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): Promise<LoggerModule> {
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
  try { return await import('../logger.js'); } finally { restoreEnv(); }
}

const routerOf = (m: LoggerModule) => (m.rootLogger as any)[pino.symbols.streamSym];
/** The streams open their files asynchronously (sync:false); flushSync only
 *  reaches the disk once each has its descriptor. */
const streamsReady = (m: LoggerModule) => Promise.all([...(routerOf(m) as any).streams.values()].map((s: any) =>
  (s.fd >= 0 ? Promise.resolve() : new Promise((r) => s.once('ready', r)))));

function channelText(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).filter((f) => f.endsWith('.log')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}

let stdout: MockInstance<typeof process.stdout.write>;
const printed = () => stdout.mock.calls.map((c) => String(c[0])).join('');
const opened: LoggerModule[] = [];

beforeAll(() => { stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true); });
afterEach(() => { stdout.mockClear(); });
afterAll(async () => {
  stdout.mockRestore();
  for (const m of opened) {
    for (const s of (routerOf(m) as any).streams.values()) { try { s.end(); } catch { /* fake stream */ } }
  }
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('initFileLogging + channel routing', () => {
  let m: LoggerModule;
  const dir = path.join(ROOT, 'live');

  beforeAll(async () => {
    m = await freshLogger({ LOG_DIR: dir, NODE_ENV: 'development', VITEST: 'false', LOG_LEVEL: 'debug', LOG_MAX_FILE_SIZE: '5m' });
    opened.push(m);
  });

  it('buffers records written before the files exist and still prints them', async () => {
    m.getLogger('cvl-boot', 'http').info({ reqId: 'r-0' }, 'pre-init http line');
    expect(printed()).toContain('pre-init http line');
  });

  it('opens one directory per channel (module channels under modules/) and flushes the buffer', async () => {
    const res = await m.initFileLogging();
    expect(res).toEqual({ enabled: true, root: path.join(dir, 'app') });
    for (const c of ['error', 'application', 'http', 'database', 'services', 'security']) {
      expect(fs.existsSync(path.join(dir, 'app', c)), c).toBe(true);
    }
    for (const mod of m.MODULE_CHANNELS) expect(fs.existsSync(path.join(dir, 'app', 'modules', mod)), mod).toBe(true);
    expect(m.LOG_PATHS).toEqual({ root: dir, app: path.join(dir, 'app') });
    // A second call is a no-op that reports the files as enabled.
    expect(await m.initFileLogging()).toEqual({ enabled: true, root: path.join(dir, 'app') });
    await streamsReady(m);
    m.flushLogs();
    expect(channelText(path.join(dir, 'app', 'http'))).toContain('pre-init http line');
  });

  it('keeps http traffic off stdout once the files are up, but not other channels', () => {
    stdout.mockClear();
    m.getLogger('cvl-http', 'http').info('post-init http line');
    m.getLogger('cvl-app').info('post-init application line');
    expect(printed()).not.toContain('post-init http line');
    expect(printed()).toContain('post-init application line');
    m.flushLogs();
    expect(channelText(path.join(dir, 'app', 'http'))).toContain('post-init http line');
    expect(channelText(path.join(dir, 'app', 'application'))).toContain('[cvl-app]  post-init application line');
  });

  it('duplicates warn+ into the error channel, and only warn+', () => {
    m.getLogger('cvl-sec', 'security').warn({ username: 'cvl_x' }, 'security warning line');
    m.getLogger('cvl-sec', 'security').info('security info line');
    m.flushLogs();
    const sec = channelText(path.join(dir, 'app', 'security'));
    const err = channelText(path.join(dir, 'app', 'error'));
    expect(sec).toContain('security warning line');
    expect(sec).toContain('security info line');
    expect(err).toContain('security warning line');
    expect(err).not.toContain('security info line');
  });

  it('routes a module logger to its own file', () => {
    m.getModuleLogger('sync').info('sync module line');
    m.flushLogs();
    expect(channelText(path.join(dir, 'app', 'modules', 'sync'))).toContain('[sync]  sync module line');
  });

  it('sends an unknown module channel to application, warning once', () => {
    stdout.mockClear();
    const stray = m.rootLogger.child({ [CHANNEL_KEY]: 'mod:not-listed', [MODULE_KEY]: 'stray' });
    stray.info('first stray line');
    stray.info('second stray line');
    const warnings = printed().split('\n').filter((l) => l.includes('no file stream for channel "mod:not-listed"'));
    expect(warnings).toHaveLength(1);
    m.flushLogs();
    const app = channelText(path.join(dir, 'app', 'application'));
    expect(app).toContain('first stray line');
    expect(app).toContain('second stray line');
  });

  it('redacts secrets before they reach a file', () => {
    m.getLogger('cvl-red', 'security').info({ password: 'hunter2', headers: { authorization: 'Bearer abc' } }, 'redaction line');
    m.flushLogs();
    const sec = channelText(path.join(dir, 'app', 'security'));
    expect(sec).toContain('redaction line');
    expect(sec).not.toContain('hunter2');
    expect(sec).not.toContain('Bearer abc');
    expect(sec).toContain('[redacted]');
  });

  it('passes a non-pino write through to stdout instead of dropping it', () => {
    stdout.mockClear();
    routerOf(m).write('not a pino record');
    routerOf(m).write('{"broken json\n');
    expect(printed()).toContain('not a pino record\n');
    expect(printed()).toContain('{"broken json\n');
  });

  it('files a record with no level or channel as an INFO line in application', () => {
    routerOf(m).write('{"msg":"bare record from a dependency"}\n');
    m.flushLogs();
    expect(channelText(path.join(dir, 'app', 'application'))).toMatch(/INFO {3}\[app\] {2}bare record from a dependency/);
  });

  it('never lets a failing file stream break the caller', () => {
    const failing = { write: () => { throw new Error('disk full'); }, flushSync: () => { throw new Error('closed'); } };
    routerOf(m).attach('services', failing);
    expect(() => m.getLogger('cvl-svc', 'services').error('services error line')).not.toThrow();
    expect(() => m.flushLogs()).not.toThrow();
    // The fan-in copy still reached the healthy error stream.
    expect(channelText(path.join(dir, 'app', 'error'))).toContain('services error line');
  });

  it('reports a stream error on stdout rather than crashing', () => {
    stdout.mockClear();
    const httpStream = (routerOf(m) as any).streams.get('http');
    httpStream.emit('error', new Error('EACCES simulated'));
    expect(printed()).toContain('[logger] write failed on channel http: EACCES simulated');
  });
});

describe('logger configuration', () => {
  it('stays on stdout only under the test runner', async () => {
    const m = await freshLogger({ LOG_DIR: path.join(ROOT, 'never') });
    expect(await m.initFileLogging()).toEqual({ enabled: false, root: path.join(ROOT, 'never', 'app') });
    expect(fs.existsSync(path.join(ROOT, 'never'))).toBe(false);
  });

  it('degrades to stdout, without throwing, when the rolling files cannot be opened', async () => {
    // An unparseable LOG_MAX_FILE_SIZE makes pino-roll reject while opening the
    // first channel - the same path a permissions failure takes.
    const m = await freshLogger({ LOG_DIR: path.join(ROOT, 'bad-size'), NODE_ENV: 'development', VITEST: 'false', LOG_MAX_FILE_SIZE: 'enormous' });
    opened.push(m);
    stdout.mockClear();
    const res = await m.initFileLogging();
    expect(res).toEqual({ enabled: false, root: path.join(ROOT, 'bad-size', 'app'), error: expect.stringContaining('enormous') });
    expect(printed()).toContain('[logger] FILE LOGGING DISABLED');
    expect(printed()).toContain('continuing with console output only');
    // Still logs (to stdout) afterwards.
    m.getLogger('cvl-degraded').info('still printed');
    expect(printed()).toContain('still printed');
  });

  it('caps the pre-init buffer at 1000 records', async () => {
    const dir = path.join(ROOT, 'capped');
    const m = await freshLogger({ LOG_DIR: dir, NODE_ENV: 'development', VITEST: 'false', LOG_LEVEL: 'info' });
    opened.push(m);
    const l = m.getLogger('cvl-cap', 'services');
    for (let i = 0; i < 1005; i++) l.info({ i }, `cap line ${i}`);
    await m.initFileLogging();
    await streamsReady(m);
    m.flushLogs();
    const text = channelText(path.join(dir, 'app', 'services'));
    expect(text).toContain('cap line 999');
    expect(text).not.toContain('cap line 1000');
  });

  it('takes the level from LOG_LEVEL, else info in production and debug elsewhere', async () => {
    expect((await freshLogger({ LOG_LEVEL: 'warn' })).rootLogger.level).toBe('warn');
    expect((await freshLogger({ LOG_LEVEL: undefined, NODE_ENV: 'production' })).rootLogger.level).toBe('info');
    expect((await freshLogger({ LOG_LEVEL: undefined, NODE_ENV: 'development' })).rootLogger.level).toBe('debug');
  });
});

describe('log-dir / uploads-dir resolution', () => {
  async function fresh<T>(spec: string, env: Record<string, string | undefined>): Promise<T> {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    vi.resetModules();
    try { return await import(spec) as T; } finally { restoreEnv(); }
  }

  it('LOG_DIR moves every channel folder; module channels nest under modules/', async () => {
    const d = await fresh<typeof import('../log-dir.js')>('../log-dir.js', { LOG_DIR: path.join(ROOT, 'x', '..', 'ld') });
    expect(d.LOG_ROOT).toBe(path.join(ROOT, 'ld'));
    expect(d.APP_LOG_ROOT).toBe(path.join(ROOT, 'ld', 'app'));
    expect(d.channelDir('security')).toBe(path.join(ROOT, 'ld', 'app', 'security'));
    expect(d.channelDir('mod:backup')).toBe(path.join(ROOT, 'ld', 'app', 'modules', 'backup'));
    expect(d.channelBaseName('mod:backup')).toBe('backup');
    expect(d.channelBaseName('http')).toBe('http');
  });

  it('without LOG_DIR, logs live in apps/api/logs', async () => {
    const d = await fresh<typeof import('../log-dir.js')>('../log-dir.js', { LOG_DIR: undefined });
    expect(d.LOG_ROOT).toBe(path.resolve(__dirname, '..', '..', '..', 'logs'));
  });

  it('UPLOAD_DIR moves uploads; unset, they live in apps/api/uploads', async () => {
    const custom = await fresh<typeof import('../uploads-dir.js')>('../uploads-dir.js', { UPLOAD_DIR: path.join(ROOT, 'up') });
    expect(custom.UPLOADS_ROOT).toBe(path.join(ROOT, 'up'));
    const dflt = await fresh<typeof import('../uploads-dir.js')>('../uploads-dir.js', { UPLOAD_DIR: undefined });
    expect(dflt.UPLOADS_ROOT).toBe(path.resolve(__dirname, '..', '..', '..', 'uploads'));
  });
});

describe('log-format fallbacks', () => {
  it('formats time defensively', () => {
    expect(formatTime('not-a-time')).toBe('not-a-time');
    expect(formatTime(undefined)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    // Two- and three-digit milliseconds pad differently.
    expect(formatTime(new Date(2026, 0, 2, 3, 4, 5, 45).getTime())).toBe('2026-01-02 03:04:05.045');
    expect(formatTime(new Date(2026, 10, 12, 13, 14, 15, 678).getTime())).toBe('2026-11-12 13:14:15.678');
  });

  it('renders odd records without throwing', () => {
    const out = formatRecord({ level: 'loud', [CHANNEL_KEY]: 'http', msg: 42, n: 7, ok: true, big: BigInt(9), nul: null, und: undefined, fn: () => 1, long: 'z'.repeat(400) });
    const [header] = out.split('\n');
    expect(header).toMatch(/ INFO {3}\[http\] {2}$/); // non-numeric level -> INFO, channel as label, non-string msg -> ''
    expect(out).toContain('n=7');
    expect(out).toContain('ok=true');
    expect(out).toContain('big=9');
    expect(out).toContain('nul=null');
    expect(out).toContain('und=undefined');
    expect(out).toContain(`fn=${String(() => 1)}`.slice(0, 10));
    expect(out).toContain(`long=${'z'.repeat(300)}…`);
    expect(formatRecord({ level: 99, msg: 'x' })).toMatch(/ INFO {3}\[app\] {2}x\n$/);
  });

  it('renders an error with no type, message or code', () => {
    const out = formatRecord({ level: 50, msg: 'boom', err: { stack: '' } });
    expect(out).toContain('    Error: ');
    expect(formatRecord({ level: 50, msg: 'boom', err: { type: 7, message: 8 } })).toContain('    Error: ');
  });

  it('keeps a multi-line message, dropping blank lines', () => {
    expect(formatRecord({ level: 30, msg: 'first\n\n  second  ' }).split('\n').slice(0, 2)).toEqual([expect.stringContaining('first'), '    second']);
    expect(formatLine('   ')).toBe('');
  });
});
