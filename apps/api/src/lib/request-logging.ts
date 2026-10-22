/**
 * Log types 3 + 7: one HTTP line per request, security lines for denials.
 *
 * Moved out of app.ts unchanged (2026-10-22) so the hooks can be registered on
 * a test app and checked against the lines they actually write. app.ts calls
 * `registerRequestLogging(app)` at the point the hooks used to be declared.
 *
 * ONE onResponse hook rather than a log call at each of the ~14 places that
 * return 401/403: a hook covers every route registered anywhere, including
 * routes added later, and cannot drift out of step with the handlers. The rbac
 * plugin alone has 10 separate 403 returns.
 */
import type { FastifyInstance } from 'fastify';
import { getLogger } from './logger.js';
import { extractRefusal, type Refusal } from './refusal-log.js';
import { rateLimitKeyGenerator } from './rate-limit-key.js';

const httpLog = getLogger('http', 'http');
const securityLog = getLogger('access', 'security');

// Requests that are pure noise at info level. The tablet polls /api/health every
// 15s (connectivity.ts) — left in, that single endpoint would dominate the http
// log and push real traffic out of the 7-day window. Failures still log: the
// skip only applies while the response is 2xx.
const QUIET_PATHS = new Set(['/api/health']);

export function registerRequestLogging(app: FastifyInstance): void {
  // WHY a request was refused (2026-10-01). Captured from the response body as it
  // is sent — the one place every refusal passes through, since the auth / rbac /
  // re-auth gates answer directly and never reach the error handler. See
  // lib/refusal-log.ts. Only error responses are parsed; a 2xx costs one compare.
  const REFUSAL = Symbol('refusal');
  app.addHook('onSend', (req, reply, payload, done) => {
    if (reply.statusCode >= 400) {
      const refusal = extractRefusal(payload);
      if (refusal) (req as unknown as Record<symbol, Refusal>)[REFUSAL] = refusal;
    }
    done(null, payload);
  });

  app.addHook('onResponse', (req, reply, done) => {
    const status = reply.statusCode;
    const durationMs = Math.round(reply.elapsedTime);
    const refusal = (req as unknown as Record<symbol, Refusal | undefined>)[REFUSAL];
    // NOTE: `req.user` is DECLARED non-optional (plugins/auth.ts) but is genuinely
    // undefined on every unauthenticated request — the declaration describes the
    // post-auth state, not this hook's. The guards below are load-bearing at
    // runtime even though TypeScript thinks they are redundant. Do not remove.
    const user = req.user as typeof req.user | undefined;
    // `url` carries the query string, which is where an operator finds the actual
    // filter that produced an empty list.
    const base = {
      reqId: req.id,
      method: req.method,
      url: req.url,
      status,
      // The refusal code + sentence the client was given. Without them a 409 on
      // /start-cycle names none of the six rules that can produce it.
      ...(refusal?.errorCode ? { errorCode: refusal.errorCode } : {}),
      ...(refusal?.errorMessage ? { errorMessage: refusal.errorMessage } : {}),
      durationMs,
      ...(user ? { user: user.username, userId: user.sub, role: user.role } : {}),
      ip: req.ip,
    };
    // On the headline too, so it survives a grep for the status alone.
    const outcome = refusal?.errorCode ? `${status} ${refusal.errorCode}` : String(status);

    if (status >= 500) {
      httpLog.error(base, `${req.method} ${req.url} → ${outcome}`);
    } else if (status >= 400) {
      httpLog.warn(base, `${req.method} ${req.url} → ${outcome}`);
    } else if (!QUIET_PATHS.has(req.routeOptions?.url ?? req.url)) {
      httpLog.info(base, `${req.method} ${req.url} → ${status}`);
    }

    // Security channel: who was refused, and why. 401 = not authenticated,
    // 403 = authenticated but not permitted, 429 = rate limited (which is what a
    // credential-stuffing attempt looks like from the outside).
    //
    // /api/auth/login is EXCLUDED: it logs its own success/failure lines in
    // modules/auth/routes.ts, which are strictly better — a failed login has no
    // `req.user`, so this hook could only ever call it "anonymous", and the
    // attempted username is the one field that makes the record worth keeping.
    //
    // A 401 with NO Authorization header is also excluded. The auth hook runs
    // before routing, so every scanner probe and every mistyped URL answers 401 —
    // logging those would fill 7 days of the security channel with noise and push
    // the real denials out of the window. A 401 that DID present a token (expired,
    // tampered, terminated session) is a genuine security event and is kept. The
    // http channel records both either way.
    const isLoginRoute = req.url.startsWith('/api/auth/login');
    const presentedToken = Boolean(req.headers.authorization);
    const worthLogging =
      status === 403 || status === 429 || (status === 401 && presentedToken);

    // SEC-13 (security assessment 2026-10-22): the login exclusion above must
    // not swallow a RATE-LIMITED login. The limiter answers 429 in onRequest,
    // before the body is parsed and before the handler runs, so the handler's
    // own lines never fire for it — and a burst of 429s on /login is exactly
    // what password guessing looks like. The username cannot be read here; the
    // attempts that tripped the limit are each already in this channel as
    // "Login FAILED: <username>" lines (modules/auth/routes.ts), so this line
    // names the bucket and the limit instead. The limiter itself stays in
    // onRequest (operator decision 2026-10-22).
    if (isLoginRoute && status === 429) {
      const limit = (req.routeOptions?.config as { rateLimit?: { max?: unknown; timeWindow?: unknown } } | undefined)?.rateLimit;
      securityLog.warn(
        {
          ...base,
          rateLimitKey: rateLimitKeyGenerator(req),
          ...(limit?.max !== undefined ? { limitMax: limit.max } : {}),
          ...(limit?.timeWindow !== undefined ? { limitWindow: limit.timeWindow } : {}),
        },
        `Login RATE LIMITED from ${req.ip} → ${req.method} ${req.url} (the usernames tried are in the preceding "Login FAILED" lines)`,
      );
    }

    if (!isLoginRoute && worthLogging) {
      const label = status === 401 ? 'Rejected token' : status === 403 ? 'Permission denied' : 'Rate limited';
      securityLog.warn(
        base,
        `${label}: ${user?.username ?? 'anonymous'} → ${req.method} ${req.url}`,
      );
    }
    done();
  });
}
