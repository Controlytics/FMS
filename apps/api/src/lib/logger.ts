import pino, { type Logger } from 'pino';
import pinoRoll from 'pino-roll';
import path from 'node:path';
import type SonicBoom from 'sonic-boom';
import { formatLine, CHANNEL_KEY, MODULE_KEY } from './log-format.js';
import { channelBaseName, channelDir, APP_LOG_ROOT, LOG_ROOT } from './log-dir.js';

/**
 * The application's one logger.
 *
 * ## Why this owns pino rather than Fastify
 *
 * Five of the call sites that need logging are in `lib/` (config-discovery,
 * jwt, reauth-check, offline-replay-token, config-registry) and have no Fastify
 * instance to reach for. If Fastify owned the logger those files could never
 * join the tree and we would end up with two logging systems. So the root pino
 * is built HERE and handed to Fastify via `loggerInstance` (Fastify 5's option
 * name — `logger` only accepts an options object).
 *
 * ## Channels
 *
 * Every record carries a `channel` deciding which file it lands in, and a
 * `module` naming the code that wrote it. A record at WARN or above is written
 * to its own channel AND duplicated into the `error` channel, so "something
 * broke — what?" is answered by one file rather than seven.
 *
 * ## stdout is never removed
 *
 * WinSW captures stdout into the service log, and that is the ONLY thing that
 * catches a crash occurring before this module finishes loading (e.g. the
 * `readFileSync` of the TLS cert at the top of app.ts). File output is an
 * addition to stdout, never a replacement for it.
 */

/** Channels an application module may write to. */
export type LogChannel =
  | 'application'
  | 'http'
  | 'database'
  | 'services'
  | 'security';

/** The fan-in channel every warn+ record is duplicated into. */
const ERROR_CHANNEL = 'error';

/**
 * Business modules that get their own file (log type 8). Kept to a short,
 * explicit list: a file per module would mean 33 files, and the questions an
 * operator actually asks ("did it start?", "is the DB up?") are cross-cutting.
 *
 * Declared up front rather than created on demand because opening a pino-roll
 * stream is async and the write path must stay synchronous. A `mod:` channel
 * not in this list falls back to `application` (with a one-time warning) rather
 * than dropping the record.
 */
export const MODULE_CHANNELS = [
  'filter-operations',
  'sync',
  'pm-schedules',
  'backup',
] as const;

export type ModuleChannel = (typeof MODULE_CHANNELS)[number];

const CORE_CHANNELS: readonly string[] = [
  ERROR_CHANNEL,
  'application',
  'http',
  'database',
  'services',
  'security',
];

/**
 * Files are not opened when running under vitest.
 *
 * The suite runs `--pool=forks --poolOptions.forks.singleFork=true`; a file
 * handle opened at import time is inherited across the whole run and the
 * rolling timer keeps the fork alive. Tests get stdout only.
 */
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

/**
 * A single day's file is split once it passes this, producing `.2.log`, `.3.log`
 * … for the same date. Retention groups by DATE, so a busy day never evicts a
 * quiet one.
 */
const MAX_FILE_SIZE = process.env.LOG_MAX_FILE_SIZE ?? '50m';

interface BufferedRecord {
  rec: Record<string, unknown>;
  text: string;
}

/**
 * Routes each formatted record to stdout + the right file(s).
 *
 * Buffers until `initFileLogging()` has opened the streams, so a module that
 * logs at import time (before app.ts can await anything) is not lost — that is
 * exactly the window in which a fatal misconfiguration surfaces.
 */
class ChannelRouter {
  private streams = new Map<string, SonicBoom>();
  private buffer: BufferedRecord[] = [];
  private ready = false;
  private warnedChannels = new Set<string>();

  /** Bounded so a boot that never reaches initFileLogging cannot grow forever. */
  private static readonly MAX_BUFFER = 1000;

  write(line: string): void {
    let text: string;
    let rec: Record<string, unknown>;
    try {
      text = formatLine(line);
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Not a pino record (or unparseable). Still show it — never swallow.
      process.stdout.write(line.endsWith('\n') ? line : `${line}\n`);
      return;
    }

    // stdout, so WinSW and the dev terminal keep working.
    //
    // The ONE exception is the http firehose once file logging is up. WinSW's
    // capture is a 10 MB x 8 window and it is the only artifact that holds a
    // crash occurring before this logger exists — letting request traffic churn
    // it means last night's start failure has already rotated out by morning.
    // The `ready` guard keeps the fallback intact: if the files never opened,
    // http still goes to stdout, because then stdout is all there is.
    const isHttp = rec[CHANNEL_KEY] === 'http';
    if (!isHttp || !this.ready) process.stdout.write(text);

    if (!this.ready) {
      if (this.buffer.length < ChannelRouter.MAX_BUFFER) this.buffer.push({ rec, text });
      return;
    }
    this.route(rec, text);
  }

  private route(rec: Record<string, unknown>, text: string): void {
    const level = typeof rec.level === 'number' ? rec.level : 30;
    let channel = typeof rec[CHANNEL_KEY] === 'string' ? (rec[CHANNEL_KEY] as string) : 'application';

    if (!this.streams.has(channel)) {
      // Unknown module channel — keep the record, tell someone once.
      if (!this.warnedChannels.has(channel)) {
        this.warnedChannels.add(channel);
        process.stdout.write(
          `[logger] no file stream for channel "${channel}" — writing to application. ` +
            `Add it to MODULE_CHANNELS in lib/logger.ts.\n`,
        );
      }
      channel = 'application';
    }

    this.writeTo(channel, text);

    // Fan-in: every warning and above is duplicated into the error channel.
    if (level >= 40 && channel !== ERROR_CHANNEL) {
      this.writeTo(ERROR_CHANNEL, text);
    }
  }

  private writeTo(channel: string, text: string): void {
    const stream = this.streams.get(channel);
    if (!stream) return;
    try {
      stream.write(text);
    } catch {
      // A failing log file must never take down a request. stdout already has it.
    }
  }

  attach(channel: string, stream: SonicBoom): void {
    this.streams.set(channel, stream);
  }

  /** Flush the pre-init buffer once the files exist. */
  markReady(): void {
    this.ready = true;
    const pending = this.buffer;
    this.buffer = [];
    for (const { rec, text } of pending) this.route(rec, text);
  }

  /**
   * pino calls this on `process.exit` paths. Without it, the last few lines
   * before a crash — the most important ones — are lost in the OS buffer.
   */
  flushSync(): void {
    for (const stream of this.streams.values()) {
      try {
        stream.flushSync();
      } catch {
        /* stream already closed */
      }
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}

const router = new ChannelRouter();

function defaultLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Explicit redaction paths.
 *
 * NOT `lib/mask-secrets.ts` — that is an allowlist built for audit config
 * payloads, and applied to a request body it would redact every field, leaving
 * a log with no diagnostic value. Here we name what must never be written.
 *
 * A log file that leaks a password is worse than no log file, and unlike the
 * audit trail these files are readable by anyone with the folder open.
 */
const REDACT_PATHS = [
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'authorization',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.secret',
  'req.headers.authorization',
  'req.headers["x-reauth-password"]',
  'headers.authorization',
  'headers["x-reauth-password"]',
];

/**
 * The root logger. Available synchronously at import time so modules can build
 * their child loggers at module scope; records written before
 * `initFileLogging()` are buffered and flushed to the files afterwards.
 */
export const rootLogger: Logger = pino(
  {
    level: defaultLevel(),
    // Drop pid/hostname: single process, single host — they are noise in every
    // record and we never print them.
    base: undefined,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { err: pino.stdSerializers.err },
  },
  router as unknown as NodeJS.WritableStream,
);

/**
 * Open the per-channel rolling files and flush anything buffered during boot.
 * Call once, as early in app.ts as possible.
 *
 * Never throws: if the log directory cannot be created (permissions on a
 * customer box), the app must still start and log to stdout, where WinSW picks
 * it up. Losing file logging is a degradation, not an outage.
 */
export async function initFileLogging(): Promise<{ enabled: boolean; root: string; error?: string }> {
  if (IS_TEST) return { enabled: false, root: APP_LOG_ROOT };
  if (router.isReady()) return { enabled: true, root: APP_LOG_ROOT };

  try {
    const channels = [
      ...CORE_CHANNELS.map((c) => ({ channel: c, dir: channelDir(c), base: channelBaseName(c) })),
      ...MODULE_CHANNELS.map((m) => ({
        channel: `mod:${m}`,
        dir: channelDir(`mod:${m}`),
        base: m,
      })),
    ];

    for (const { channel, dir, base } of channels) {
      const stream = await pinoRoll({
        file: path.join(dir, base),
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        extension: '.log',
        size: MAX_FILE_SIZE,
        mkdir: true,
        // Buffered, NOT sync. SonicBoom's `sync:true` turns every write into a
        // blocking `writeSync` — and `security` fires on every 401 while
        // `database` fires on every slow query, so that would put a synchronous
        // disk write on the request path of a plant PC.
        //
        // Crash-safety comes from flushSync() instead, which is wired into all
        // four ways this process can die: uncaughtException, SIGTERM/SIGINT,
        // the shutdown timeout, and a failed listen(). Those give the same
        // guarantee at no per-request cost. The remaining exposure is a hard
        // kill (SIGKILL / power loss), where the buffer is a few milliseconds
        // of writes.
        sync: false,
      });
      // A file-system error must not become an unhandled 'error' event.
      stream.on('error', (err: Error) => {
        process.stdout.write(`[logger] write failed on channel ${channel}: ${err.message}\n`);
      });
      router.attach(channel, stream);
    }

    router.markReady();
    return { enabled: true, root: APP_LOG_ROOT };
  } catch (err) {
    // stdout still works; say so loudly rather than failing silently.
    const message = (err as Error).message;
    process.stdout.write(
      `[logger] FILE LOGGING DISABLED — could not open ${APP_LOG_ROOT}: ${message}\n` +
        `[logger] continuing with console output only (captured by the Windows service log)\n`,
    );
    return { enabled: false, root: APP_LOG_ROOT, error: message };
  }
}

/** Flush every channel — used by the graceful-shutdown path. */
export function flushLogs(): void {
  router.flushSync();
}

/**
 * A logger for one module, writing to one channel.
 *
 * @param module  Name shown in brackets on every line. Use the module folder
 *                name (`'filter-operations'`, `'auth'`) so a line can be traced
 *                back to a directory without guessing.
 * @param channel Which file it lands in. Defaults to `application`.
 */
export function getLogger(module: string, channel: LogChannel = 'application'): Logger {
  return rootLogger.child({ [CHANNEL_KEY]: channel, [MODULE_KEY]: module });
}

/**
 * A logger for a business module that has its OWN file (log type 8).
 * Only the modules in {@link MODULE_CHANNELS} have one.
 */
export function getModuleLogger(module: ModuleChannel): Logger {
  return rootLogger.child({ [CHANNEL_KEY]: `mod:${module}`, [MODULE_KEY]: module });
}

/** Where logs are being written — reported at boot and by collect-logs.ps1. */
export const LOG_PATHS = { root: LOG_ROOT, app: APP_LOG_ROOT };
