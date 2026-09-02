import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLogger, getModuleLogger, MODULE_CHANNELS } from '../logger.js';

/**
 * A log file that leaks a password is worse than no log file — unlike the audit
 * trail, these files are readable by anyone who can open the folder, and they
 * are copied wholesale into a support bundle by scripts/collect-logs.ps1.
 *
 * The redact paths are declared in lib/logger.ts. This asserts they actually
 * fire, because "we set redact paths" and "secrets are redacted" are different
 * claims and only the second one matters.
 *
 * Under vitest no files are opened (lib/logger.ts checks VITEST), so the router
 * writes to stdout only — which is exactly what we capture here.
 */

function capture(fn: () => void): string {
  const written: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return written.join('');
}

afterEach(() => vi.restoreAllMocks());

describe('logger redaction', () => {
  const log = getLogger('redaction-test', 'security');

  it.each([
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
  ])('redacts a top-level %s', (key) => {
    const out = capture(() => log.info({ [key]: 'super-secret-value' }, 'attempt'));
    expect(out).not.toContain('super-secret-value');
    expect(out).toContain('[redacted]');
  });

  it('redacts one level down, where a request body actually lives', () => {
    const out = capture(() =>
      log.info({ body: { username: 'superadmin', password: 'hunter2' } }, 'login'),
    );
    expect(out).not.toContain('hunter2');
    // The non-secret field alongside it must survive — a redaction that blanks
    // the whole object would leave the line with no diagnostic value.
    expect(out).toContain('superadmin');
  });

  it('redacts the Authorization and re-auth headers', () => {
    const out = capture(() =>
      log.warn(
        { headers: { authorization: 'Bearer eyJleUpsZWFrZWQ', 'x-reauth-password': 'Admin@123' } },
        'request',
      ),
    );
    expect(out).not.toContain('eyJleUpsZWFrZWQ');
    expect(out).not.toContain('Admin@123');
  });

  it('leaves ordinary diagnostic context untouched', () => {
    // Over-redacting is its own failure: the point of the file is to say what
    // happened to which record.
    const out = capture(() =>
      log.info({ username: 'superadmin', filterId: 'AHU-0A-F12', status: 409 }, 'blocked'),
    );
    expect(out).toContain('superadmin');
    expect(out).toContain('AHU-0A-F12');
    expect(out).toContain('status=409');
  });
});

describe('logger channels', () => {
  it('tags the module and renders it in the line', () => {
    const out = capture(() => getLogger('filter-ops', 'application').info('hello'));
    expect(out).toContain('[filter-ops]');
    expect(out).toContain('hello');
  });

  it('does NOT let a context field named `channel` or `module` hijack routing', () => {
    // REGRESSION. Routing used to be bound as plain `channel` / `module`, and
    // pino merges a call's context object OVER the child's bindings — so
    // `notify.info({ channel: 'EMAIL' }, ...)` re-routed itself out of the
    // services channel and into application. A notification genuinely carries
    // `channel: 'EMAIL' | 'SMS' | 'IN_APP'`, so this was live, not theoretical.
    // Found by generating realistic sample data; no unit test had caught it.
    const out = capture(() =>
      getLogger('notifications', 'services').info(
        { channel: 'EMAIL', module: 'something-else', to: 'qa@example.com' },
        'Notification dispatched',
      ),
    );
    // The label still comes from the logger, not the caller's `module` field.
    expect(out).toContain('[notifications]');
    expect(out).not.toContain('[something-else]');
    // ...and both survive as ordinary, readable context.
    expect(out).toContain('channel=EMAIL');
    expect(out).toContain('module=something-else');
    // The reserved keys never leak into the rendered line.
    expect(out).not.toContain('__chan');
    expect(out).not.toContain('__mod');
  });

  it('opens a channel for every declared module channel', () => {
    // MODULE_CHANNELS drives which files initFileLogging() opens. A module
    // logging to a name that is not in the list falls back to `application`, so
    // this guards against a typo silently redirecting a whole module's output.
    for (const name of MODULE_CHANNELS) {
      const out = capture(() => getModuleLogger(name).info('tick'));
      expect(out).toContain(`[${name}]`);
    }
  });
});
