import { describe, it, expect } from 'vitest';
import { formatRecord, formatLine, formatTime, CHANNEL_KEY, MODULE_KEY } from '../log-format.js';

/**
 * The whole point of these files is that a non-developer can read them. These
 * tests lock the shape: local time, spelled-out level, module in brackets, the
 * sentence, then indented context.
 */

// A fixed local-time instant so assertions do not depend on the clock.
const T = new Date(2026, 7, 31, 14, 22, 1, 184).getTime(); // 2026-08-31 14:22:01.184 local

describe('formatTime', () => {
  it('renders LOCAL wall-clock time, not UTC', () => {
    // toISOString() would render UTC — an operator in IST comparing "it failed
    // at 2pm" against a UTC line would be reading a timestamp 5.5h out.
    expect(formatTime(T)).toBe('2026-08-31 14:22:01.184');
  });

  it('zero-pads every component so lines align and sort', () => {
    expect(formatTime(new Date(2026, 0, 5, 9, 8, 7, 6).getTime())).toBe('2026-01-05 09:08:07.006');
  });
});

describe('formatRecord', () => {
  it('renders the header line as time, level, module, message', () => {
    const out = formatRecord({ level: 30, time: T, [MODULE_KEY]: 'auth', [CHANNEL_KEY]: 'security', msg: 'Login SUCCESS: superadmin' });
    expect(out).toBe('2026-08-31 14:22:01.184  INFO   [auth]  Login SUCCESS: superadmin\n');
  });

  it('spells out every level, padded so the columns align', () => {
    // Fixed columns: 23 chars of timestamp, two spaces, then a 5-char level.
    // Slicing (rather than splitting on the separator) is what actually checks
    // the padding — INFO/WARN must occupy the same width as ERROR/TRACE or the
    // module column jitters line to line.
    const at = (level: number) => formatRecord({ level, time: T, [MODULE_KEY]: 'm', msg: 'x' }).slice(25, 30);
    expect(at(10)).toBe('TRACE');
    expect(at(20)).toBe('DEBUG');
    expect(at(30)).toBe('INFO ');
    expect(at(40)).toBe('WARN ');
    expect(at(50)).toBe('ERROR');
    expect(at(60)).toBe('FATAL');
  });

  it('puts context on indented continuation lines, preferred fields first', () => {
    const out = formatRecord({
      level: 40, time: T, [MODULE_KEY]: 'http', [CHANNEL_KEY]: 'http', msg: 'GET /api/users → 401',
      filterId: 'abc', reqId: 'req-2', status: 401, method: 'GET', ip: '127.0.0.1',
    });
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toContain('WARN   [http]  GET /api/users → 401');
    // reqId / method / status / ip come before the alphabetical remainder.
    expect(lines[1]).toBe('    reqId=req-2 method=GET status=401 ip=127.0.0.1 filterId=abc');
  });

  it('never prints pino plumbing as context', () => {
    const out = formatRecord({ level: 30, time: T, pid: 1234, hostname: 'PLANT-PC', [MODULE_KEY]: 'm', [CHANNEL_KEY]: 'application', msg: 'hello' });
    expect(out).toBe('2026-08-31 14:22:01.184  INFO   [m]  hello\n');
  });

  it('renders an error with its type, code and indented stack', () => {
    const out = formatRecord({
      level: 50, time: T, [MODULE_KEY]: 'filter-operations', msg: 'Failed to advance cycle',
      cycleId: 8821,
      err: {
        type: 'PrismaClientKnownRequestError',
        code: 'P2002',
        message: 'Unique constraint failed',
        stack: 'PrismaClientKnownRequestError: Unique constraint failed\n    at advanceStage (service.ts:412)\n    at async run (routes.ts:88)',
      },
    });
    const lines = out.trimEnd().split('\n');
    expect(lines[0]).toContain('ERROR  [filter-operations]  Failed to advance cycle');
    expect(lines[1]).toBe('    cycleId=8821');
    expect(lines[2]).toBe('    PrismaClientKnownRequestError (P2002): Unique constraint failed');
    // The stack's own first line repeats "type: message" and is dropped.
    expect(lines[3]).toBe('        at advanceStage (service.ts:412)');
    expect(lines[4]).toBe('        at async run (routes.ts:88)');
  });

  it('quotes only values that need it', () => {
    const out = formatRecord({ level: 30, time: T, [MODULE_KEY]: 'm', msg: 'x', plain: 'abc', spaced: 'a b', empty: '' });
    expect(out).toContain('plain=abc');
    expect(out).toContain('spaced="a b"');
    expect(out).toContain('empty=""');
  });

  it('escapes embedded quotes instead of substituting them', () => {
    // A logged SQL statement is the field where quoting carries meaning:
    // Postgres identifiers are double-quoted. Replacing `"` with `'` (an earlier
    // version did) rewrites the query into something that never ran and will not
    // run if pasted into psql.
    const query = 'SELECT "public"."audit_trail"."id" FROM "public"."audit_trail"';
    const out = formatRecord({ level: 40, time: T, [MODULE_KEY]: 'prisma', msg: 'Slow query', query });
    expect(out).toContain('\\"public\\".\\"audit_trail\\"');
    expect(out).not.toContain("'public'");
  });

  it('survives a circular object instead of throwing', () => {
    // A log line must never be able to take down the caller.
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const out = formatRecord({ level: 30, time: T, [MODULE_KEY]: 'm', msg: 'x', ctx: circular });
    expect(out).toContain('ctx=[unserialisable]');
  });

  it('wraps long context rather than emitting one enormous line', () => {
    const rec: Record<string, unknown> = { level: 30, time: T, [MODULE_KEY]: 'm', msg: 'x' };
    for (let i = 0; i < 30; i++) rec[`field${i}`] = `value-${i}`;
    const lines = formatRecord(rec).trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines.slice(1)) expect(l.length).toBeLessThanOrEqual(150);
  });

  it('always ends with exactly one newline', () => {
    const out = formatRecord({ level: 30, time: T, [MODULE_KEY]: 'm', msg: 'x' });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('formatLine', () => {
  it('formats a serialised pino line', () => {
    const line = JSON.stringify({ level: 50, time: T, [MODULE_KEY]: 'db', [CHANNEL_KEY]: 'database', msg: 'boom' });
    expect(formatLine(line)).toBe('2026-08-31 14:22:01.184  ERROR  [db]  boom\n');
  });

  it('passes through a non-JSON line rather than dropping it', () => {
    // Something in a dependency writing plain text through us must still reach
    // the file — silently swallowing output is the one thing a logger must not do.
    expect(formatLine('a plain message')).toBe('a plain message\n');
  });

  it('passes through malformed JSON rather than throwing', () => {
    expect(formatLine('{"level":30,"msg":')).toBe('{"level":30,"msg":\n');
  });

  it('ignores blank lines', () => {
    expect(formatLine('   ')).toBe('');
  });
});
