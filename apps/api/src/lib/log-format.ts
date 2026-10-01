/**
 * Turns one pino JSON record into one block of plain, human-readable text.
 *
 * The operator reading these files is not a developer and has no log viewer —
 * they open the file in Notepad, or grep it. So: local wall-clock time (never
 * epoch millis, never UTC-with-a-Z that reads an hour off), the level spelled
 * out, the module in brackets, then the sentence. Context goes on indented
 * continuation lines so the first line of every event stays scannable and
 * `findstr ERROR` returns something that means anything on its own.
 *
 *   2026-08-31 14:22:01.184  ERROR  [filter-operations]  Failed to advance cycle
 *       reqId=a3f9c1 user=101012 role=OPERATOR filter=AHU-0A-F12
 *       PrismaClientKnownRequestError: Unique constraint failed
 *           at advanceStage (filter-operations.service.ts:412)
 *
 * Pure function, no I/O — so it can be unit-tested against fixed records
 * (`__tests__/log-format.test.ts`).
 */

/** pino numeric levels → the word we print. */
const LEVEL_NAMES: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

/**
 * Routing/label keys, set only by `getLogger()`.
 *
 * Double-underscored on purpose. They were once plain `channel` / `module`, and
 * because pino merges a call's context object OVER the child's bindings, any
 * call site passing a field with one of those names silently re-routed its own
 * log line to a different file. That is not hypothetical here: a notification
 * carries `channel: 'EMAIL' | 'SMS' | 'IN_APP'`, and
 * `notify.info({ channel: 'EMAIL' }, ...)` landed in `application/` instead of
 * `services/`. Found by generating realistic sample data, not by a unit test.
 *
 * A call site may now use `channel` or `module` as ordinary context and it
 * renders as ordinary context.
 */
export const CHANNEL_KEY = '__chan';
export const MODULE_KEY = '__mod';

/**
 * Keys consumed by the header line or by the error block. Everything else in
 * the record becomes a `key=value` pair — an allowlist would silently drop the
 * context a future call site adds, and context is the whole point.
 */
const HEADER_KEYS = new Set([
  'level',
  'time',
  'pid',
  'hostname',
  'msg',
  CHANNEL_KEY,
  MODULE_KEY,
  'err',
  'v',
]);

/**
 * Printed first, in this order, when present. These are the fields an operator
 * reads to answer "who / which request / how bad", so they should not be buried
 * behind an alphabetical sort among a dozen domain fields.
 */
const PREFERRED_ORDER = [
  'reqId',
  'method',
  'url',
  'status',
  'errorCode',
  'errorMessage',
  'durationMs',
  'user',
  'userId',
  'username',
  'role',
  'ip',
];

const INDENT = '    ';
const MAX_VALUE_LEN = 300;

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function three(n: number): string {
  return n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n);
}

/**
 * Local time, `yyyy-MM-dd HH:mm:ss.SSS`.
 *
 * Deliberately NOT `toISOString()`: that renders UTC, and an operator in IST
 * comparing a log line against "the operator said it failed at 2pm" would be
 * reading a timestamp 5.5 hours out. The file is read on the machine that wrote
 * it, so local time is the right frame.
 */
export function formatTime(time: number | string | undefined): string {
  const d = time === undefined ? new Date() : new Date(time);
  if (Number.isNaN(d.getTime())) return String(time);
  return (
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ` +
    `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${three(d.getMilliseconds())}`
  );
}

/** Render one context value compactly, without ever throwing on a cycle. */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    // Quote only when needed, so the common case stays uncluttered.
    const needsQuotes = value === '' || /[\s="]/.test(value);
    const v = value.length > MAX_VALUE_LEN ? `${value.slice(0, MAX_VALUE_LEN)}…` : value;
    // ESCAPE embedded quotes, never substitute them. An earlier version replaced
    // `"` with `'`, which silently rewrote the one field where quoting carries
    // meaning: a logged SQL statement. Postgres identifiers are double-quoted,
    // so `SELECT "public"."audit_trail"` came out as `SELECT 'public'.'audit_trail'`
    // — no longer the query that ran, and not runnable if pasted into psql.
    return needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  let json: string;
  try {
    json = JSON.stringify(value) ?? String(value);
  } catch {
    // Circular structure, or a BigInt nested inside — never let a log line
    // formatting failure take down the caller.
    json = '[unserialisable]';
  }
  return json.length > MAX_VALUE_LEN ? `${json.slice(0, MAX_VALUE_LEN)}…` : json;
}

/**
 * Format the `err` object pino's standard serializer produces
 * (`{ type, message, stack }`), plus any extra fields carried on it such as a
 * Prisma error `code`.
 */
function formatError(err: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const type = typeof err.type === 'string' ? err.type : 'Error';
  const message = typeof err.message === 'string' ? err.message : '';
  const code = err.code !== undefined ? ` (${formatValue(err.code)})` : '';
  lines.push(`${INDENT}${type}${code}: ${message}`);

  if (typeof err.stack === 'string' && err.stack.length > 0) {
    // Drop the first stack line — it repeats "Type: message" we just printed.
    const frames = err.stack.split('\n').slice(1);
    for (const frame of frames) {
      const trimmed = frame.trim();
      if (trimmed) lines.push(`${INDENT}${INDENT}${trimmed}`);
    }
  }
  return lines;
}

/**
 * Render a parsed pino record as plain text. Always ends with exactly one
 * newline so writers can concatenate without bookkeeping.
 */
export function formatRecord(rec: Record<string, unknown>): string {
  const level = typeof rec.level === 'number' ? rec.level : 30;
  const levelName = (LEVEL_NAMES[level] ?? 'INFO').padEnd(5);
  const time = formatTime(rec.time as number | string | undefined);

  // The module is what the developer tagged the call site with; the channel is
  // which file it lands in. Show the module — it is the more specific of the
  // two, and the file name already tells you the channel.
  const label = (rec[MODULE_KEY] as string) ?? (rec[CHANNEL_KEY] as string) ?? 'app';
  const rawMsg = typeof rec.msg === 'string' ? rec.msg : '';

  const [firstMsgLine, ...restMsgLines] = rawMsg.split('\n');
  const lines: string[] = [`${time}  ${levelName}  [${label}]  ${firstMsgLine}`];

  for (const extra of restMsgLines) {
    if (extra.trim()) lines.push(`${INDENT}${extra.trim()}`);
  }

  // Context pairs — preferred fields first, then the rest alphabetically so the
  // same event always renders its fields in the same order (diffable, greppable).
  const contextKeys = Object.keys(rec).filter((k) => !HEADER_KEYS.has(k));
  const preferred = PREFERRED_ORDER.filter((k) => contextKeys.includes(k));
  const remaining = contextKeys.filter((k) => !PREFERRED_ORDER.includes(k)).sort();

  const pairs = [...preferred, ...remaining].map((k) => `${k}=${formatValue(rec[k])}`);
  if (pairs.length > 0) {
    // Wrap at a readable width rather than emitting one enormous line.
    let current = '';
    for (const pair of pairs) {
      if (current && current.length + pair.length + 1 > 140) {
        lines.push(`${INDENT}${current}`);
        current = pair;
      } else {
        current = current ? `${current} ${pair}` : pair;
      }
    }
    if (current) lines.push(`${INDENT}${current}`);
  }

  if (rec.err && typeof rec.err === 'object') {
    lines.push(...formatError(rec.err as Record<string, unknown>));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Parse one serialised pino line and format it. Returns the raw line unchanged
 * if it is not JSON — a non-pino write (something in a dependency calling
 * `process.stdout.write` through us) must still reach the file rather than
 * vanish.
 */
export function formatLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (trimmed[0] !== '{') return `${trimmed}\n`;
  try {
    return formatRecord(JSON.parse(trimmed) as Record<string, unknown>);
  } catch {
    return `${trimmed}\n`;
  }
}

/** Exported for tests. */
export { LEVEL_NAMES };
