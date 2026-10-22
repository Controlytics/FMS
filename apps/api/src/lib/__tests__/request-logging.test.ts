/**
 * lib/request-logging.ts — the http and security lines, read back as written.
 *
 * Security assessment 2026-10-22:
 *  - SEC-12: the public OAuth2 callback's `code` and `state` were written to the
 *    7-day http log in clear (`url: req.url` and the headline).
 *  - SEC-13: a login refused by the rate limiter (429) never reached the
 *    security channel. The hook skips /api/auth/login because the login handler
 *    logs its own lines — but a 429 is answered before the handler runs, so the
 *    one event that marks password guessing was only in http/ and error/.
 *
 * A real Fastify app with the real hooks and the real @fastify/rate-limit; the
 * stand-in routes only answer. Under vitest the logger writes formatted lines
 * to stdout (no files), which is captured here. The `[http]` / `[access]`
 * labels are the two loggers of request-logging.ts — the http and the security
 * channel respectively.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerRequestLogging } from '../request-logging.js';
import { rateLimitKeyGenerator } from '../rate-limit-key.js';

let app: FastifyInstance;

async function captured(fn: () => Promise<unknown>): Promise<string[]> {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  try {
    await fn();
    // onResponse runs after the reply is flushed; let it finish.
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    spy.mockRestore();
  }
  // One record per write; each record is a headline plus indented context lines.
  return written;
}

beforeAll(async () => {
  app = Fastify();
  await app.register(rateLimit, { global: false, keyGenerator: rateLimitKeyGenerator });
  registerRequestLogging(app);
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 2, timeWindow: '1 minute', keyGenerator: rateLimitKeyGenerator } },
  }, async (_req, reply) => reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' }));
  app.get('/api/notification-settings/email/oauth2/code', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q.state === 'reject') return reply.code(400).send({ error: 'OAUTH2_STATE_MISMATCH', message: 'State mismatch' });
    return reply.type('text/html').send('<html>ok</html>');
  });
  app.get('/api/pm-schedules/entries', async () => ({ data: [] }));
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('SEC-12 — auth-bearing query parameters never reach the http log', () => {
  it('redacts the OAuth2 callback code and state on the line and in its url field, keeping the rest', async () => {
    const out = await captured(() => app.inject({
      method: 'GET',
      url: '/api/notification-settings/email/oauth2/code?code=MARKER-CODE-4f1a&state=MARKER-STATE-9c2e&scope=mail.send',
    }));
    const line = out.find((l) => l.includes('/api/notification-settings/email/oauth2/code'));
    expect(line, out.join('')).toBeTruthy();
    expect(line).toContain('[http]');
    expect(out.join('')).not.toContain('MARKER-CODE-4f1a');
    expect(out.join('')).not.toContain('MARKER-STATE-9c2e');
    expect(line).toContain('code=[redacted]');
    expect(line).toContain('state=[redacted]');
    expect(line).toContain('scope=mail.send');
    expect(line).toContain('→ 200');
  });

  it('a refused callback (4xx, also copied to the error channel) is redacted too', async () => {
    const out = await captured(() => app.inject({
      method: 'GET', url: '/api/notification-settings/email/oauth2/code?code=MARKER-CODE-77&state=reject',
    }));
    expect(out.join('')).not.toContain('MARKER-CODE-77');
    expect(out.join('')).toContain('→ 400 OAUTH2_STATE_MISMATCH');
  });

  it('ordinary filter parameters stay readable — they are what an operator debugs with', async () => {
    const out = await captured(() => app.inject({ method: 'GET', url: '/api/pm-schedules/entries?year=2026&approvalStatus=PENDING_REVIEW&page=2' }));
    expect(out.join('')).toContain('/api/pm-schedules/entries?year=2026&approvalStatus=PENDING_REVIEW&page=2');
  });
});

describe('SEC-13 — a rate-limited login reaches the security channel', () => {
  it('the 429 is written to the security channel with the client IP; ordinary failed logins are left to the login handler', async () => {
    const send = () => app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: '10.9.8.7',
      payload: { username: 'victim-account', password: 'guess' },
    });
    const first = await captured(async () => { await send(); await send(); });
    // Two 401s: the http channel has them, the security channel does not (the
    // real login handler writes "Login FAILED" with the username instead).
    expect(first.filter((l) => l.includes('[access]'))).toEqual([]);

    const res: { statusCode?: number } = {};
    const out = await captured(async () => { res.statusCode = (await send()).statusCode; });
    expect(res.statusCode).toBe(429);
    const security = out.filter((l) => l.includes('[access]'));
    expect(security, out.join('')).toHaveLength(1);
    expect(security[0]).toMatch(/WARN/);
    expect(security[0]).toContain('POST /api/auth/login');
    expect(security[0]).toMatch(/rate.limited/i);
    expect(security[0]).toContain('ip=10.9.8.7');
    expect(security[0]).toContain('status=429');
    // The limiter refuses before the body is parsed, so no username here — the
    // line names the bucket and the limit, and points at the failed-login lines.
    expect(security[0]).toContain('rateLimitKey=10.9.8.7');
    expect(security[0]).toContain('limitMax=2');
    expect(security[0]).toContain('limitWindow="1 minute"');
    expect(security[0]).toContain('the usernames tried are in the preceding "Login FAILED" lines');
    expect(security[0]).not.toContain('victim-account');
    // The password never appears anywhere.
    expect(out.join('')).not.toContain('guess');
  });
});
