import 'dotenv/config';
import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
import fs from 'node:fs';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSwagger, isApiDocsEnabled } from './lib/swagger.js';
import { rateLimitKeyGenerator } from './lib/rate-limit-key.js';
import { rootLogger, getLogger, initFileLogging, flushLogs, LOG_PATHS } from './lib/logger.js';
import { pruneAllLogs, retentionDays, logDirSizeBytes, formatBytes } from './lib/log-retention.js';
import { JWT_MAX_EXPIRY_HOURS } from './lib/jwt.js';
import authPlugin from './plugins/auth.js';
import rbacPlugin from './plugins/rbac.js';
import superAdminRoutes from "./modules/super-admin/routes.js";
import reportReviewRoutes from "./modules/report-reviews/routes.js";
import stageApprovalRoutes from "./modules/stage-approvals/routes.js";
import debugTraceRoutes from "./modules/debug-traces/routes.js";
import ldapRoutes from "./modules/ldap/routes.js";
import dashboardRoutes from "./modules/dashboards/routes.js";
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import configRoutes from './modules/config/routes.js';
import { discoverAndRegisterConfigs } from './lib/config-discovery.js';
import dynamicConfigRoutes from './modules/config/dynamic-routes.js';
import auditRoutes from './modules/audit/routes.js';
import uploadRoutes from './modules/uploads/routes.js';
import { UPLOADS_ROOT } from './lib/uploads-dir.js';
import notificationRoutes from './modules/notifications/routes.js';
import roleRoutes from './modules/roles/routes.js';
import backupRoutes from './modules/backup/routes.js';
import assetRoutes from './modules/assets/index.js';
import helpRoutes from './modules/help/routes.js';
import systemHealthRoutes, { trackRequest } from './modules/system-health/routes.js';

// operation-tracer removed — wrote to ts_pipeline_traces which is being dropped.
// To be repurposed against filter_events / pm_executions / admin_requests in a
// dedicated TraceSource framework (see runbook Section 14).


import notificationDeliveryRoutes from './modules/notification-delivery/routes.js';
import userGroupRoutes from './modules/user-groups/routes.js';
import notificationRulesRoutes from './modules/notification-rules/routes.js';

// Scheduled maintenance now runs IN-PROCESS via node-cron (2026-07-25) — no
// Postgres job queue (graphile-worker) and no OS/Windows cron dependency. The
// former graphile-worker `notification` task was already dead (no producers
// since the 2026-05-17 rule-chain/alarm removal); notifications are dispatched
// directly in-process via dispatchNotification. We call the sweep SERVICE
// functions straight from cron ticks (the old *.worker.ts wrappers only added a
// graphile-worker `helpers.logger`, which we replace with app.log here).
//
// 2026-08-26: the `packages/queue` workspace and the `graphile-worker` dependency
// were DELETED. `startJobRunner` had no caller after the 2026-07-25 move, so the
// queue sat installed-but-never-started; its job types (ingestion, telemetry,
// device events) all belonged to the data-ingestion layer torn out in Phase 7.
// node-cron below is the ONLY in-app scheduler. The one scheduler outside the
// app is the Windows Scheduled Task the installer registers for DB backups.
import cron, { type ScheduledTask } from 'node-cron';
import { sweepOverdueDeviations } from './modules/pm-schedules/pm-deviations.js';
import { sweepExpiredSessions } from './modules/auth/session-sweep.js';
import { sweepPasswordExpiryNotifications } from './modules/auth/password-expiry-sweep.js';
import { AppError } from './lib/errors.js';
import { extractRefusal, type Refusal } from './lib/refusal-log.js';
import { OfflineTimeError } from './lib/offline-time-window.js';
import { dispatchNotification } from './modules/notification-delivery/notification-dispatcher.js';
import cleaningProfileRoutes from './modules/cleaning-profiles/routes.js';import checklistProfileRoutes from './modules/checklist-profiles/routes.js';import filterProfileRoutes from './modules/filter-profiles/routes.js';
import pmScheduleRoutes from './modules/pm-schedules/routes.js';import pmExecutionRoutes from './modules/pm-schedules/execution-routes.js';import filterOperationsRoutes from './modules/filter-operations/routes.js';import filterEventsRoutes from './modules/filter-operations/events-routes.js';
import { dateRangeGuard } from './lib/date-range-guard.js';
import replacementScheduleRoutes from './modules/replacement-schedule/routes.js';
import equipmentGroupRoutes from './modules/equipment-groups/routes.js';
import syncRoutes from './modules/sync/routes.js';
import deploymentCheckRoutes from './modules/deployment-check/routes.js';
import adminRequestRoutes from './modules/admin-requests/routes.js';
import blockChangeRoutes from './modules/block-change-requests/routes.js';
import hierarchyRoutes from './modules/hierarchy/routes.js';
// reportRoutes imported dynamically below

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Open the rolling per-channel log files FIRST — before the TLS readFileSync
// below, which is a live failure mode on a customer box (a missing or unreadable
// cert). Initialised any later, that exact failure would produce nothing in
// logs/app/error/. This depends only on LOG_DIR + dotenv, both already loaded.
// Never throws: if the directory is unwritable the app still starts and logs to
// stdout, which the Windows service captures. See lib/logger.ts.
const fileLogging = await initFileLogging();

// TLS cert location is env-overridable so the customer install can point it at
// C:\ProgramData\DigiLog\certs (data dir → survives upgrades; regenerating the CA
// on upgrade would re-break the tablet's trust). Defaults to the dev repo's
// certs/server.{key,crt} so local dev is unchanged. See EXE-PACKAGING-PLAN.md §13.
const defaultCertDir = path.resolve(__dirname, '../../../certs');
const tlsKeyPath  = process.env.TLS_KEY_PATH  ?? path.join(defaultCertDir, 'server.key');
const tlsCertPath = process.env.TLS_CERT_PATH ?? path.join(defaultCertDir, 'server.crt');
// F-05 (security assessment 2026-08-17): pin the TLS floor in code rather than
// inheriting whatever the Node build defaults to. The scan found TLS 1.2/1.3
// already in effect here, but only because that is the current default — a Node
// upgrade, an OpenSSL config, or a different host could silently move it. On a
// validated system the floor must be an explicit, reviewable property of the
// app. TLS 1.0/1.1 are deprecated (RFC 8996); 1.2 is the floor, 1.3 is used
// whenever the client supports it.
const httpsOptions = process.env.API_HTTPS === 'true'
  ? {
      key: fs.readFileSync(tlsKeyPath),
      cert: fs.readFileSync(tlsCertPath),
      minVersion: 'TLSv1.2' as const,
      maxVersion: 'TLSv1.3' as const,
    }
  : null;

// May 16 H2 fix (2026-05-20): trustProxy was unconditionally 1. When the
// API serves browsers DIRECTLY (no reverse proxy in front — the local
// Windows dev setup; some appliance deployments), the "first hop" is the
// attacker's browser, and X-Forwarded-For becomes attacker-controlled.
// Result: audit-trail IP + rate-limit keys both spoofable.
//
// Only trust the X-Forwarded-* family when explicitly behind a known
// reverse proxy (set TRUST_PROXY=1 or TRUST_PROXY=<hop-count> in env).
// Default false → req.ip uses the raw socket address, attacker can't lie.
const trustProxyEnv = process.env.TRUST_PROXY;
// fastify 5.12 (npm audit fix 2026-09-24, GHSA X-Forwarded-* spoofing under
// trustProxy hop-count) dropped the numeric form from the option's type. A
// hop-count is expressed as the equivalent function instead — "trust the first
// N hops" — so TRUST_PROXY=<n> keeps its meaning.
const trustProxy: boolean | ((address: string, hop: number) => boolean) = trustProxyEnv
  ? (Number.isFinite(Number(trustProxyEnv))
      ? ((_address: string, hop: number) => hop < Number(trustProxyEnv))
      : trustProxyEnv === 'true')
  : false;

const app = Fastify({
  // Fastify 5 takes a ready-made logger under `loggerInstance` (`logger` only
  // accepts an options object). The root pino lives in lib/logger.ts so that
  // modules under lib/ — which have no Fastify instance to reach for — write to
  // the same files as everything else.
  // Annotated as FastifyBaseLogger so Fastify keeps its DEFAULT logger generic.
  // Handing it a concrete pino `Logger` narrows the instance type to
  // `Logger<never, boolean>`, and every plugin typed against the default
  // FastifyInstance (registerSwagger, the route modules) then fails to compile.
  loggerInstance: rootLogger.child({ module: 'api', channel: 'application' }) as FastifyBaseLogger,
  // We emit exactly ONE line per request from the onResponse hook below, into
  // the dedicated http channel. Fastify's built-in pair ("incoming request" +
  // "request completed") would double every request in the application log and
  // carries neither the user nor the duration.
  //
  // Via a LogController INSTANCE, not the top-level `disableRequestLogging` —
  // that spelling is deprecated in Fastify 5 (FSTDEP023) and removed in 6. A
  // plain object is rejected at runtime (FST_ERR_LOG_INVALID_LOG_CONTROLLER):
  // createLogController() accepts only `instanceof LogController`.
  logController: new LogController({ disableRequestLogging: true }),
  trustProxy,
  bodyLimit: 10 * 1024 * 1024, // 10 MB for base64 image uploads in checklists
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
  ...(httpsOptions ? { https: httpsOptions } : {}),
});

// Block dangerous HTTP methods early — before any route or plugin (audit S-11)
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'TRACE' || req.method === 'CONNECT') {
    return reply.code(405).send({ error: 'METHOD_NOT_ALLOWED' });
  }
});

// Swagger API docs (register before routes)
await registerSwagger(app);

// Core middleware
const corsOrigins = process.env.ALLOWED_ORIGINS;
if (!corsOrigins && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: ALLOWED_ORIGINS env var must be set in production');
}
await app.register(cors, {
  origin: (corsOrigins ?? 'http://localhost:5173,http://localhost:5175,https://localhost,capacitor://localhost,http://localhost').split(','),
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-reauth-password'],
});
// F-04 (security assessment 2026-08-17): `'unsafe-inline'` in script-src
// substantially weakens the XSS defence — it is what lets an injected inline
// <script> actually execute. It was there for ONE reason: Swagger UI's inline
// bootstrap. Now that /docs is opt-in and off by default (see lib/swagger.ts),
// the relaxation can be scoped to the only configuration that needs it, so a
// customer install — where API_DOCS is never set — gets the strict policy.
//
// Both script-src and style-src are strict unless Swagger UI is actually being
// served. Verified in a real headless Chromium against the built SPA and against
// /docs, reading the browser's own `securitypolicyviolation` events:
//
//   The SPA needs NEITHER relaxation. With `script-src 'self'; style-src 'self'`
//   it renders fully — React mounts, the 10-theme system applies (it uses
//   `root.style.setProperty()`, i.e. CSSOM, which CSP does not govern), the
//   external stylesheets load, and the page reports ZERO <style> elements and
//   ZERO violations. Vite emits external hashed modules, so there are no inline
//   scripts either; the bundle's `createElement("script")` sites are React's
//   resource hoisting, which sets `src`.
//
//   Swagger UI DOES need both. Serving /docs under the strict policy produces a
//   `style-src-elem blocked=inline` violation from its bootstrap. So the
//   relaxation is scoped to exactly that case — and because API_DOCS is never set
//   on a customer install, a customer install is always strict.
//
// An earlier revision kept style-src relaxed unconditionally on the theory that
// React 19's stylesheet `precedence` feature and html2canvas inject <style>
// elements. Both turned out to be inert here: nothing in this app renders a
// `precedence` style, and html2canvas is only reachable through jsPDF's `.html()`,
// which pdf-report.ts never calls (it draws with text/rect/line/addImage).
//
// `'unsafe-eval'` was never granted and still isn't.
const docsNeedsInlineCsp = isApiDocsEnabled();
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Only relaxed while Swagger UI is actually being served.
      scriptSrc: ["'self'", ...(docsNeedsInlineCsp ? ["'unsafe-inline'"] : [])],
      // Swagger UI's bootstrap needs this; the SPA does not (verified in-browser).
      styleSrc: ["'self'", ...(docsNeedsInlineCsp ? ["'unsafe-inline'"] : [])],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],       // stop an injected <base> retargeting relative URLs
      formAction: ["'self'"],    // stop an injected form exfiltrating to another origin
    },
  },
  // F-11: `preload` asks the browser-vendor HSTS preload list to hard-pin this
  // host. That list only accepts public registrable domains — this deployment is
  // a LAN host / localhost, so the flag can never be honoured and advertising it
  // is noise that misleads a reviewer. Keep the 1-year max-age, drop the claim.
  strictTransportSecurity: {
    maxAge: 31536000,        // 1 year in seconds
    includeSubDomains: true,
  },
  // F-12: two headers stated different framing rules — CSP said frame-ancestors
  // 'none' while helmet's default X-Frame-Options said SAMEORIGIN. Modern
  // browsers prefer frame-ancestors, but a reviewer reading the headers saw a
  // contradiction. Align X-Frame-Options with the CSP rather than leave both.
  xFrameOptions: { action: 'deny' },
});
// Permissions-Policy — restrict browser feature APIs (audit S-10)
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  return payload;
});
// History: global limit was 500/min, raised to 5000/min 2026-07-03 (tablet SWR
// bursts hit 500 → 429s read as "offline" → retry storm → WebView OOM).
// DEP-5 (security assessment 2026-08-17): key on the /64 for IPv6 so an
// attacker rotating the host portion of their prefix cannot mint a fresh
// budget per request. IPv4 stays exact. See lib/rate-limit-key.ts.
// 2026-10-10 (operator decision): NO global limit and no per-route limits,
// EXCEPT the three password endpoints (/api/auth/login, /verify,
// /change-password), which keep their own `config.rateLimit`. `global: false`
// makes the plugin enforce only routes that declare one. Those three are the
// only brake on guessing the SUPER_ADMIN password — it is exempt from account
// lockout — so do not remove them without that decision being made again.
await app.register(rateLimit, {
  global: false,
  keyGenerator: rateLimitKeyGenerator,
});
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1,
  },
});

// Serve uploaded files. UPLOADS_ROOT honors UPLOAD_DIR (customer install points
// it at C:\ProgramData\DigiLog\uploads) — must match the photo writer in
// modules/uploads/routes.ts or served photos 404.
await app.register(fastifyStatic, {
  root: UPLOADS_ROOT,
  prefix: '/uploads/',
  decorateReply: false,
});

// Plugins
await app.register(authPlugin);
await app.register(rbacPlugin);

// Rate limiter for error notifications (max 1 per minute)
let lastErrorNotification = 0;

// Global error handler — maps AppError to HTTP responses
app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  // Audit 2026-05-04 fix C2: bounded offlinePerformedAt validator. Map the
  // dedicated error class to a clean 400 with a stable error code so the
  // client knows whether to retry, re-perform the action, or contact admin.
  if (err instanceof OfflineTimeError) {
    return reply.code(400).send({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  // Rate limit errors from @fastify/rate-limit
  if (err.statusCode === 429) {
    return reply.code(429).send({ error: 'TOO_MANY_REQUESTS', message: err.message });
  }
  // Body too large (e.g. base64 images in checklist submissions)
  if ((err as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    const contentLength = _req.headers['content-length'];
    const sizeMB = contentLength ? (parseInt(contentLength as string) / 1024 / 1024).toFixed(1) : 'unknown';
    app.log.warn({ url: _req.url, contentLength, sizeMB }, 'Request body too large');
    return reply.code(413).send({
      error: 'BODY_TOO_LARGE',
      message: `Request body too large (${sizeMB} MB). Maximum allowed is 10 MB. Try reducing image size or quality.`,
    });
  }
  // Fastify validation errors (body/query/params schema validation)
  if ((err as any).code === 'FST_ERR_VALIDATION' || (err as any).validation) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: err.message,
      ...(err as any).validation ? { details: (err as any).validation } : {},
    });
  }
  // Zod validation errors — 400, NOT 500.
  //
  // Four routes validate with zod directly rather than a Fastify JSON schema
  // (`<schema>.parse(req.query)` in users / audit / assets instance + template
  // routes). A ZodError has no `statusCode` and no `.validation`, so it fell
  // past every branch above into the "Genuine internal errors" block below:
  // any bad query param answered **500 INTERNAL_ERROR** and additionally fired
  // a SYSTEM_ERROR notification dispatch — an operator typo paged the system as
  // if the server had crashed. Surfaced 2026-08-08 as an error toast on the
  // Notification Rules config page, whose user picker requested `?limit=500`
  // against a schema capped at 100.
  //
  // Placed BEFORE the SYSTEM_ERROR dispatch precisely so client-side validation
  // failures never generate that notification.
  if ((err as any).name === 'ZodError' && Array.isArray((err as any).issues)) {
    const issues = (err as any).issues as Array<{ path: (string | number)[]; message: string }>;
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: issues
        .map(i => (i.path?.length ? `${i.path.join('.')}: ${i.message}` : i.message))
        .join('; ') || 'Request validation failed',
      details: issues,
    });
  }
  // Unsupported Media Type — 415 (audit API-3)
  if ((err as any).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return reply.code(415).send({
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: err.message || 'Unsupported Media Type',
    });
  }
  // JSON parse errors — 400 (audit API-3)
  if (
    (err as any).code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    (err as any).code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
  ) {
    return reply.code(400).send({
      error: 'PARSE_ERROR',
      message: 'Request body is not valid JSON',
    });
  }
  // Prisma unique-constraint violation → 409 (not 500). #low-batch: the four
  // version sidecars (equipment-groups / checklist-profiles / cleaning-profiles /
  // filter-profiles) read the live version unlocked then INSERT
  // (id, versionNumber); two concurrent edits to the same record collide on the
  // unique index and the loser raises P2002. Surface it as a clean, retryable
  // conflict instead of a 500 + a spurious SYSTEM_ERROR notification. Systemic —
  // covers every current + future unique constraint.
  if ((err as any).code === 'P2002') {
    return reply.code(409).send({
      error: 'CONFLICT',
      message: 'This record was modified concurrently. Please reload and try again.',
    });
  }
  // Prisma "value too long for the column" → 400, not 500 (VAPT-5, 2026-08-18).
  // Discovered when an input that passed the schema's max-length check overflowed
  // a column AFTER server-side sanitization *escaped* the HTML (e.g. `<script>`
  // → `&lt;script&gt;`, +12 chars), so a schema-valid string became too long.
  // A rejected-input constraint is a client error, and the raw Prisma error text
  // (source path + code snippet) must never reach the caller.
  if ((err as any).code === 'P2000') {
    return reply.code(400).send({
      error: 'VALUE_TOO_LONG',
      message: 'One or more fields exceed the maximum allowed length.',
    });
  }
  // Any other Prisma known-request error: return a generic 400 and log the detail
  // server-side. Without this, an unmapped P-code fell to the catch-all, which
  // echoes err.message when NODE_ENV=development — and a Prisma message embeds the
  // absolute source-file path, line, and a code snippet (CWE-209). Never leak that,
  // in any environment; the full error is still on app.log for diagnosis.
  if (
    (err as any).name === 'PrismaClientKnownRequestError' ||
    (typeof (err as any).code === 'string' && /^P\d{4}$/.test((err as any).code))
  ) {
    app.log.error({ err, url: _req.url, prismaCode: (err as any).code }, 'Unmapped Prisma error');
    return reply.code(400).send({
      error: 'DATA_CONSTRAINT',
      message: 'The request could not be completed due to a data constraint.',
    });
  }

  // Genuine internal errors
  //
  // This is the single most important line in the error log, so it carries the
  // context needed to act on it without a developer: which request, which user,
  // and the full stack. Previously `app.log.error(err)` alone — a stack with no
  // idea who hit it or what they were doing.
  app.log.error(
    {
      err,
      reqId: _req.id,
      method: _req.method,
      url: _req.url,
      user: _req.user?.username,
      userId: _req.user?.sub,
      role: _req.user?.role,
      ip: _req.ip,
    },
    `Unhandled error on ${_req.method} ${_req.url}`,
  );
  // Dispatch SYSTEM_ERROR notification (fire-and-forget, rate-limited to 1 per minute)
  const now = Date.now();
  if (now - lastErrorNotification > 60000) {
    lastErrorNotification = now;
    dispatchNotification({
      eventType: 'SYSTEM_ERROR',
      context: {},
      variables: {
        errorType: err.constructor?.name ?? 'Error',
        errorMessage: err.message ?? 'Unknown error',
        url: _req.url ?? 'N/A',
        timestamp: new Date().toISOString(),
      },
    }).catch((dispatchErr) => {
      // Log but do not rethrow — rethrowing would re-enter the error handler
      // and cause an infinite loop (the SYSTEM_ERROR notification itself
      // failing would generate another SYSTEM_ERROR notification).
      app.log.warn(
        { dispatchErr, originalErr: err.message, url: _req.url },
        'Failed to dispatch SYSTEM_ERROR notification — original error is still returned to the caller.',
      );
    });
  }
  return reply.code(err.statusCode ?? 500).send({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'development' ? (err.message || 'Internal server error').substring(0, 500) : 'Internal server error',
  });
});

// Request tracking hook for system health metrics
app.addHook('onRequest', (_req, _reply, done) => {
  trackRequest();
  done();
});

// ─── Log types 3 + 7: one HTTP line per request, security lines for denials ───
//
// ONE onResponse hook rather than a log call at each of the ~14 places that
// return 401/403: a hook covers every route registered anywhere, including
// routes added later, and cannot drift out of step with the handlers. The rbac
// plugin alone has 10 separate 403 returns.
const httpLog = getLogger('http', 'http');
const securityLog = getLogger('access', 'security');

// Requests that are pure noise at info level. The tablet polls /api/health every
// 15s (connectivity.ts) — left in, that single endpoint would dominate the http
// log and push real traffic out of the 7-day window. Failures still log: the
// skip only applies while the response is 2xx.
const QUIET_PATHS = new Set(['/api/health']);

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

  if (!isLoginRoute && worthLogging) {
    const label = status === 401 ? 'Rejected token' : status === 403 ? 'Permission denied' : 'Rate limited';
    securityLog.warn(
      base,
      `${label}: ${user?.username ?? 'anonymous'} → ${req.method} ${req.url}`,
    );
  }
  done();
});

// (operation-tracer onResponse/onError hooks removed — see import comment above)

// Health check
// Job-runner state, reported by /api/health. Set once at boot (below). Without
// this the runner could die at startup and the API still reported itself
// healthy, so the notification / PM-overdue / password-expiry / session sweeps
// stopped with nothing to notice it — the session sweep writes the LOGOUT audit
// rows, so its silent death is a §11 gap.
let jobRunnerStatus: 'starting' | 'running' | 'failed' = 'starting';
// In-process node-cron scheduled tasks; stopped on graceful shutdown.
const cronTasks: ScheduledTask[] = [];

app.get('/api/health', {
  schema: {
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns API health status',
    security: [],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          timestamp: { type: 'string', format: 'date-time' },
          // `db` was already being returned by the handler but was silently
          // dropped by fast-json-stringify because it wasn't declared here.
          db: { type: 'string', example: 'connected' },
          jobRunner: { type: 'string', example: 'running' },
        },
      },
    },
  },
}, async (_req, reply) => {
  try {
    const { prisma } = await import('./lib/prisma.js');
    await prisma.$queryRaw`SELECT 1`;
    // Deliberately still 200 when the job runner is down: the HTTP surface is
    // fine, and the tablet treats a non-2xx /api/health as "server unreachable"
    // (apps/web/src/lib/connectivity.ts probeServer) — a 503 here would flip
    // every tablet into offline mode over a background-job fault.
    return { status: 'ok', db: 'connected', jobRunner: jobRunnerStatus };
  } catch (err) {
    return reply.code(503 as any).send({ status: 'error', db: 'disconnected' });
  }
});

// Auto-discover config module definitions
await discoverAndRegisterConfigs();

// Routes
// Reject any date range whose end precedes its start, on every route.
//
// The UI stopped allowing it (components/ui/date-range-filter.tsx), but the API
// answered `from > to` with an empty list — a silent wrong answer that reads as
// "no matching records". One global hook rather than a check in each of the 13
// range-accepting endpoints, so routes added later are covered by default.
// Registered HERE, before the route plugins, because a Fastify hook only applies
// to routes registered after it.
app.addHook('preHandler', dateRangeGuard);

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(configRoutes, { prefix: '/api/config' });
await app.register(dynamicConfigRoutes, { prefix: '/api/config' });
await app.register(auditRoutes, { prefix: '/api/audit' });
await app.register(uploadRoutes, { prefix: '/api/uploads' });
await app.register(notificationRoutes, { prefix: '/api/notifications' });
await app.register((await import('./modules/guest/routes.js')).default, { prefix: '/api/guest' });
await app.register(roleRoutes, { prefix: '/api/roles' });
await app.register(backupRoutes, { prefix: '/api/backup' });
await app.register(assetRoutes, { prefix: '/api/assets' });

// (Data-ingestion / MQTT / transport routes were removed in Phase 7.)




await app.register(helpRoutes, { prefix: '/api/help' });
await app.register(systemHealthRoutes, { prefix: '/api/system-health' });

await app.register(notificationDeliveryRoutes, { prefix: '/api/notification-settings' });
await app.register(userGroupRoutes, { prefix: '/api/user-groups' });
await app.register(notificationRulesRoutes, { prefix: '/api/notification-rules' });

// Admin + assignment routes
await app.register(superAdminRoutes, { prefix: "/api/super-admin" });
await app.register(reportReviewRoutes, { prefix: "/api/report-reviews" });
await app.register(stageApprovalRoutes, { prefix: "/api/stage-approvals" });
await app.register(debugTraceRoutes, { prefix: "/api/debug/traces" });
await app.register(ldapRoutes, { prefix: "/api/ldap" });
await app.register(dashboardRoutes, { prefix: "/api/dashboards" });
await app.register(cleaningProfileRoutes, { prefix: '/api/filter-cleaning-profiles' });await app.register(checklistProfileRoutes, { prefix: '/api/checklist-profiles' });await app.register(filterProfileRoutes, { prefix: '/api/filter-profiles' });
await app.register(pmScheduleRoutes, { prefix: '/api/pm-schedules' });await app.register(pmExecutionRoutes, { prefix: '/api/pm-executions' });await app.register(filterOperationsRoutes, { prefix: '/api/filters' });await app.register(filterEventsRoutes, { prefix: '/api/filters' });
await app.register(equipmentGroupRoutes, { prefix: '/api/equipment-groups' });
await app.register(replacementScheduleRoutes, { prefix: '/api/replacement-schedules' });
await app.register(syncRoutes, { prefix: '/api/sync' });
await app.register(deploymentCheckRoutes, { prefix: '/api/deployment-check' });
await app.register(adminRequestRoutes, { prefix: '/api/admin-requests' });
await app.register(blockChangeRoutes, { prefix: '/api/block-change-requests' });
await app.register(hierarchyRoutes, { prefix: '/api/hierarchy' });


// ─── M1: serve the built web UI from the API (single-process bundle) ─────────
// Behind SERVE_WEB so the normal dev loop (Vite on :5175) is unaffected. When
// enabled, the API serves apps/web/dist at '/', with an SPA fallback to
// index.html for client-side (React Router) routes. This is what the packaged
// Setup.exe uses at runtime — no Vite, one `node dist/app.js` process.
// Override the build location with WEB_DIST_DIR (the installer stages it under
// the program dir). See tasks/EXE-PACKAGING-PLAN.md §5.
if (process.env.SERVE_WEB === 'true') {
  const webDir = process.env.WEB_DIST_DIR
    ? path.resolve(process.env.WEB_DIST_DIR)
    : path.resolve(__dirname, '../../web/dist');

  if (!fs.existsSync(path.join(webDir, 'index.html'))) {
    app.log.warn(
      `SERVE_WEB=true but no web build found at ${webDir} ` +
      `(run 'vite build' or set WEB_DIST_DIR). The UI will not be served.`,
    );
  } else {
    // Second @fastify/static instance — this one OWNS reply.sendFile (the
    // uploads instance above set decorateReply:false precisely so this can).
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      wildcard: false,       // serve real files; unmatched paths fall to notFound
      index: ['index.html'],
    });

    // SPA fallback: a GET that didn't match an API/docs/uploads/health route and
    // isn't a real static file returns index.html so React Router can resolve
    // the client-side path. Anything else gets a clean JSON 404 (API contract
    // preserved — unknown /api routes must NOT receive HTML).
    app.setNotFoundHandler((req, reply) => {
      const isServerRoute =
        req.url.startsWith('/api') ||
        req.url.startsWith('/uploads') ||
        // Only a server route while the docs are actually served; otherwise
        // /docs must fall through to the SPA like any other unknown path so it
        // stays indistinguishable. See the matching gate in plugins/auth.ts.
        (isApiDocsEnabled() && req.url.startsWith('/docs')) ||
        req.url.startsWith('/health');
      const wantsHtml = (req.headers.accept ?? '').includes('text/html');
      if (req.method === 'GET' && !isServerRoute && wantsHtml) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({
        error: 'NOT_FOUND',
        message: `Route ${req.method}:${req.url} not found`,
      });
    });

    app.log.info(`SERVE_WEB enabled — serving web UI from ${webDir}`);
  }
}

// Start
const port = parseInt(process.env.PORT ?? '3000', 10);
try {
  await app.listen({ port, host: '0.0.0.0' });
  const proto = httpsOptions ? 'https' : 'http';
  app.log.info(`DigiLog API running on ${proto}://localhost:${port}`);

  // ─── Log type 2: what this process actually resolved at boot ──────────────
  //
  // The point of these lines is that "it isn't working" is usually a config
  // question — wrong port, TLS off, the tablet's origin not in ALLOWED_ORIGINS,
  // uploads pointing somewhere the installer didn't create. Printing the
  // RESOLVED values (not the env vars) means the log answers that without
  // anyone opening digilog.env.
  app.log.info(
    {
      port,
      protocol: proto,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      nodeVersion: process.version,
      pid: process.pid,
      trustProxy,
      tlsCert: httpsOptions ? tlsCertPath : 'disabled',
      allowedOrigins: corsOrigins ?? '(defaults)',
      uploadsDir: UPLOADS_ROOT,
      serveWeb: process.env.SERVE_WEB === 'true',
      apiDocs: isApiDocsEnabled(),
    },
    'Startup configuration',
  );

  // Probe + record the DB connection at boot (log type 4). Non-fatal: DigiLogDB
  // and DigiLogAPI start together and the API must be able to come up and retry.
  const { logDatabaseConnection } = await import('./lib/prisma.js');
  await logDatabaseConnection();

  if (fileLogging.enabled) {
    const size = await logDirSizeBytes();
    app.log.info(
      { logDir: LOG_PATHS.app, retentionDays: retentionDays(), currentSize: formatBytes(size) },
      `Logging to ${LOG_PATHS.app} — keeping ${retentionDays()} days per channel`,
    );
  } else {
    app.log.warn(
      { logDir: LOG_PATHS.app, reason: fileLogging.error },
      'File logging is DISABLED — console output only',
    );
  }
  // API-15: state the real token ceiling at boot. The Session Settings page
  // can show a larger 'Session Duration'; this is what actually applies.
  app.log.info(`JWT lifetime ceiling: ${JWT_MAX_EXPIRY_HOURS}h (JWT_EXPIRY_HOURS)`);
  if (isApiDocsEnabled()) {
    app.log.info(`Swagger UI: ${proto}://localhost:${port}/docs`);
  }

  // In-process scheduler (node-cron). Runs inside this Node process — no
  // Postgres job queue and no OS/Windows cron. Each tick runs a sweep guarded so
  // it can't overlap itself (mirrors the old `max=1`) and swallows nothing (a
  // failure is logged, per CLAUDE.md). Cron fields use the server's LOCAL time
  // (set process.env.TZ to change). Missed runs while the process is down are
  // NOT backfilled — same as the old `fill=0s`.
  try {
    // Log type 6 — background work goes to its own file, so "did the nightly
    // job run?" is one short file rather than a search through request traffic.
    const servicesLog = getLogger('cron', 'services');
    const inFlight = new Set<string>();
    const runSweep = async (name: string, fn: () => Promise<unknown>) => {
      if (inFlight.has(name)) { servicesLog.warn({ job: name }, `${name} still running — skipping this tick`); return; }
      inFlight.add(name);
      const startedAt = Date.now();
      servicesLog.info({ job: name }, `${name} started`);
      try {
        const r = await fn();
        servicesLog.info(
          { job: name, durationMs: Date.now() - startedAt, result: r },
          `${name} completed`,
        );
      } catch (e) {
        servicesLog.error(
          { job: name, durationMs: Date.now() - startedAt, err: e },
          `${name} FAILED`,
        );
      } finally {
        inFlight.delete(name);
      }
    };

    // ─── Retention: keep the newest N days per channel ────────────────────────
    //
    // Runs at BOOT and daily at 00:05. Both are needed:
    //   - boot covers the machine that is powered off overnight, where the
    //     00:05 tick never fires while the process is alive. Without it, logs
    //     would accumulate forever on exactly the deployment we ship to.
    //   - the daily tick covers the server that stays up for months.
    // pino-roll's own `limit` does neither reliably — see lib/log-retention.ts.
    const pruneLogs = async () => {
      const r = await pruneAllLogs();
      if (r.errors.length > 0) {
        servicesLog.warn(
          { deleted: r.deleted, failed: r.errors.length, firstError: r.errors[0]?.message },
          `Log retention: deleted ${r.deleted} file(s), ${r.errors.length} could not be removed`,
        );
      }
      return {
        deletedFiles: r.deleted,
        removedDates: r.removedDates,
        keptDays: retentionDays(),
      };
    };
    if (fileLogging.enabled) {
      await runSweep('log_retention', pruneLogs);
      cronTasks.push(cron.schedule('5 0 * * *', () => runSweep('log_retention', pruneLogs)));
    }

    // Session reaper — every 5 min (terminates idle/expired sessions + LOGOUT audit)
    cronTasks.push(cron.schedule('*/5 * * * *', () => runSweep('session_sweep', sweepExpiredSessions)));
    // Password-expiry notifications — daily 00:00
    cronTasks.push(cron.schedule('0 0 * * *', () => runSweep('password_expiry_check', sweepPasswordExpiryNotifications)));
    // PM overdue deviation sweep — daily 03:00
    cronTasks.push(cron.schedule('0 3 * * *', () => runSweep('pm_overdue_check', sweepOverdueDeviations)));

    jobRunnerStatus = 'running';
    servicesLog.info(
      { jobs: ['session_sweep (*/5m)', 'password_expiry_check (00:00)', 'pm_overdue_check (03:00)', 'log_retention (00:05)'] },
      'in-process node-cron scheduler started',
    );
  } catch (runnerErr) {
    // Not fatal — the HTTP surface is still usable. But every scheduled job (the
    // PM-overdue sweep, password-expiry warnings, the LOGOUT-writing session
    // sweep) is dead until this is fixed. /api/health reports `jobRunner`.
    jobRunnerStatus = 'failed';
    app.log.error(
      { err: runnerErr },
      'node-cron scheduler FAILED to start — scheduled jobs (PM overdue, password expiry, session sweep) will not run. Server continuing.',
    );
  }
} catch (err) {
  // The server could not bind. This is the "application not starting" case the
  // logs exist for — flush before exiting or the reason never reaches disk.
  app.log.fatal({ err, port }, `FAILED TO START — could not listen on port ${port}`);
  flushLogs();
  process.exit(1);
}

// ─── Crash capture (log type 2) ──────────────────────────────────────────────
//
// Without these, a crash leaves NOTHING in the app log — the process is gone
// before any handler runs, and the operator sees only that the service
// restarted. flushSync is essential here: the default buffered write would lose
// the very line that explains the crash.
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'UNCAUGHT EXCEPTION — process is exiting');
  flushLogs();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  app.log.fatal(
    { err: reason instanceof Error ? reason : new Error(String(reason)) },
    'UNHANDLED PROMISE REJECTION — process is exiting',
  );
  flushLogs();
  // EXIT, do not swallow. Node's default since v15 is
  // `--unhandled-rejections=throw`, so before this handler existed an unhandled
  // rejection already killed the process and WinSW restarted it clean
  // (onfailure restart, 10s). Merely REGISTERING a handler suppresses that
  // default — the process would limp on in whatever broken state produced the
  // rejection. Changing crash semantics is not a logging task's business, so we
  // add the evidence and keep the old outcome.
  process.exit(1);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  const shutdownTimeout = setTimeout(() => {
    // A hung shutdown is a real fault (an open handle, a stuck DB call) and the
    // service manager will just restart us — so this must land on disk, not
    // only on a console nobody is watching. flushLogs() before exit is what
    // makes that true.
    app.log.fatal({ signal }, 'Shutdown timed out after 15s — forcing exit');
    flushLogs();
    process.exit(1);
  }, 15000);
  shutdownTimeout.unref();

  try {
    // Stop the in-process node-cron schedules.
    for (const t of cronTasks) {
      try { await t.stop(); } catch (cErr) { app.log.error({ err: cErr }, 'Shutdown: stopping a cron task failed'); }
    }

    await app.close();
    // Close the DB pool explicitly and record it. Without this line the database
    // log shows a connect with no matching disconnect, so a clean stop and a
    // process that was killed look identical in the file.
    const { disconnectDatabase } = await import('./lib/prisma.js');
    await disconnectDatabase();
    app.log.info(`Shutdown complete (${signal})`);
  } catch (err) {
    app.log.error(err as Error, 'Error during shutdown');
  }
  // Last act: push every buffered line to disk. Without this the shutdown lines
  // themselves — the record of WHY the service stopped — are lost.
  flushLogs();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
