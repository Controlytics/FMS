/**
 * SEC-12 (security assessment 2026-10-22): credentials carried in a URL's query
 * string — the OAuth2 callback's `code` / `state`, and any token / key / secret
 * parameter — must never be written to a log file. These files rotate after 7
 * days but are readable by anyone with the folder open, and are copied
 * wholesale into a support bundle by scripts/collect-logs.ps1.
 *
 * The redaction is the LOGGER's (lib/logger.ts), not each call site's: a URL
 * reaches the logs as a `url` field and inside the sentence ("GET /x?code=… →
 * 200"), from request-logging.ts, the error handler and any future caller.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLogger } from '../logger.js';

function capture(fn: () => void): string {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  try { fn(); } finally { spy.mockRestore(); }
  return written.join('');
}

afterEach(() => vi.restoreAllMocks());

const log = getLogger('url-redaction-test', 'http');

describe('URL query redaction in log lines', () => {
  it.each([
    'code', 'state', 'token', 'access_token', 'refresh_token', 'id_token',
    'client_secret', 'password', 'secret', 'api_key', 'apikey',
  ])('redacts %s in the url field and in the sentence', (param) => {
    const url = `/api/x/callback?${param}=SENSITIVE-VALUE-123&page=2`;
    const out = capture(() => log.info({ url }, `GET ${url} → 200`));
    expect(out).not.toContain('SENSITIVE-VALUE-123');
    expect(out).toContain(`${param}=[redacted]`);
    expect(out).toContain('page=2');
  });

  it('matches parameter names case-insensitively, in any position, and in a fragment', () => {
    const out = capture(() => {
      log.warn({ url: '/cb?scope=a&Code=V1&STATE=V2' }, 'GET /cb?scope=a&Code=V1&STATE=V2 → 400');
      log.info('redirected to /done#access_token=V3&token_type=bearer');
    });
    for (const v of ['V1', 'V2', 'V3']) expect(out).not.toMatch(new RegExp(`=${v}\\b`));
    expect(out).toContain('scope=a');
    expect(out).toContain('token_type=bearer');
  });

  it('redacts a sentence passed on its own and printf-style arguments', () => {
    const out = capture(() => {
      log.info('GET /cb?code=ONLY-ARG → 200');
      log.info('callback %s answered', '/cb?state=FORMAT-ARG');
    });
    expect(out).not.toContain('ONLY-ARG');
    expect(out).not.toContain('FORMAT-ARG');
  });

  it('leaves URLs without credentials untouched, including look-alike names', () => {
    const url = '/api/filters/cycles?status=COMPLETED&from=2026-01-01&cycleCode=CC-1&stateKey=WASH_IN';
    const out = capture(() => log.info({ url }, `GET ${url} → 200`));
    expect(out).toContain(url);
    expect(out).not.toContain('[redacted]');
  });

  it('does not touch non-string url values', () => {
    const out = capture(() => log.info({ url: 42 }, 'numeric url'));
    expect(out).toContain('url=42');
  });
});
