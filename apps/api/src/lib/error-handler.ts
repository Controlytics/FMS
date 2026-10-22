/**
 * The ONE global error handler (A-05, 2026-10-21).
 *
 * app.ts and the e2e harness (e2e/test-helper.ts) each carried their own copy,
 * and the copies had drifted: the harness lacked five branches (offline-time
 * window, body too large, schema validation -> VALIDATION_ERROR, 415, bad JSON)
 * and its 500 echoed the raw error text. Tests of the error mapping ran against
 * the copy, so a route could pass in tests and answer differently in
 * production. Both now install this function; only the reaction to a genuine
 * internal error differs (app.ts dispatches the SYSTEM_ERROR notification, the
 * harness records it so a test can assert none happened).
 *
 * The branches below were moved verbatim from app.ts.
 */
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, isClientDataPrismaError, fastifyClientError } from './errors.js';
import { OfflineTimeError } from './offline-time-window.js';

export interface ErrorHandlerOptions {
  log: FastifyBaseLogger;
  /** A genuine internal error (the 500 path, after it is logged). Must not throw. */
  onInternalError?: (err: Error, req: FastifyRequest) => void;
  /** Echo the internal message in the 500 body (development only, never on a customer machine). */
  exposeInternalMessage?: boolean;
}

export function buildErrorHandler(opts: ErrorHandlerOptions) {
  return (err: Error & { statusCode?: number }, _req: FastifyRequest, reply: FastifyReply) => {
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
      opts.log.warn({ url: _req.url, contentLength, sizeMB }, 'Request body too large');
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
    // M29 residual (QA 2026-10-19): "record to update/delete not found" is a 404,
    // not a data constraint. Same generic message class as the other Prisma
    // branches — no Prisma text reaches the client.
    if ((err as any).code === 'P2025') {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'The record was not found. It may have been deleted.' });
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
    // 2026-10-17 load test: a connection-pool timeout (P2024) or an interactive-
    // transaction timeout (P2028) means the SERVER is busy, not that the client's
    // data is wrong. Reported as 400 DATA_CONSTRAINT, the tablet's sync engine
    // treated it as the operation's own failure and could mark queued operator
    // work permanently failed after five busy minutes (sync-engine.ts). 503 with
    // the same generic wording (nothing from Prisma leaks) tells clients to wait.
    if ((err as any).code === 'P2024' || (err as any).code === 'P2028') {
      opts.log.warn({ url: _req.url, prismaCode: (err as any).code }, 'Database busy (pool or transaction timeout) — capacity, not data');
      return reply.code(503).send({
        error: 'SERVICE_BUSY',
        message: 'The server is busy. Please try again in a moment.',
      });
    }
    // Any other Prisma known-request error: return a generic 400 and log the detail
    // server-side. Without this, an unmapped P-code fell to the catch-all, which
    // echoes err.message when NODE_ENV=development — and a Prisma message embeds the
    // absolute source-file path, line, and a code snippet (CWE-209). Never leak that,
    // in any environment; the full error is still on app.log for diagnosis.
    //
    // EXCEPT a server fault (D-DB-9, 2026-10-22): a statement the database refused
    // for its own limits — P2035 "assertion violation on the database" (e.g. "too
    // many bind variables in prepared statement"), P2029 the parameter limit — or a
    // lost / unreachable database (P1xxx). None says the request was wrong; as 400
    // DATA_CONSTRAINT the tablet's sync engine took it for the operation's own
    // failure. They fall through to the genuine-internal-error path below: logged
    // with the request's context, a generic 500, and the SYSTEM_ERROR page.
    const prismaCode = typeof (err as any).code === 'string' ? (err as any).code as string : '';
    const prismaServerFault = prismaCode === 'P2035' || prismaCode === 'P2029' || /^P1\d{3}$/.test(prismaCode);
    if (
      !prismaServerFault && (
        (err as any).name === 'PrismaClientKnownRequestError' ||
        /^P\d{4}$/.test(prismaCode)
      )
    ) {
      opts.log.error({ err, url: _req.url, prismaCode: (err as any).code }, 'Unmapped Prisma error');
      return reply.code(400).send({
        error: 'DATA_CONSTRAINT',
        message: 'The request could not be completed due to a data constraint.',
      });
    }
    // QA 2026-10-19 (M15/M50 class): a PrismaClientValidationError carries NO
    // code, so it skipped the branch above and fell to the 500 + SYSTEM_ERROR
    // notification path — every invalid date / unknown enum value that slipped past
    // a route schema paged the admins as a system failure. It means the query
    // ARGUMENTS were invalid (input reached Prisma unchecked): a 400, still logged
    // at error level with the full detail so the missing route validation is found.
    if ((err as any).name === 'PrismaClientValidationError') {
      opts.log.error({ err, url: _req.url }, 'Prisma validation error — input reached the database unvalidated');
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'One or more values are not valid.',
      });
    }

    // P5-03 (2026-10-21): bad client data that reached Postgres as an "unknown"
    // request error (NUL byte, out-of-range integer) - see isClientDataPrismaError.
    if (isClientDataPrismaError(err)) {
      opts.log.error({ err, url: _req.url }, 'Invalid value reached the database (NUL byte / out-of-range number) - input unvalidated');
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'One or more values are not valid.',
      });
    }

    // P4-09 (2026-10-21): an unmapped Fastify/plugin 4xx (FST_*) is a client
    // error, not an internal one - no "Unhandled error" line, no SYSTEM_ERROR page.
    const clientErr = fastifyClientError(err);
    if (clientErr) {
      opts.log.warn({ url: _req.url, code: (err as any).code, statusCode: clientErr.status }, 'Client request error');
      return reply.code(clientErr.status).send(clientErr.body);
    }

    // Genuine internal errors
    //
    // This is the single most important line in the error log, so it carries the
    // context needed to act on it without a developer: which request, which user,
    // and the full stack. Previously `app.log.error(err)` alone — a stack with no
    // idea who hit it or what they were doing.
    opts.log.error(
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
    opts.onInternalError?.(err, _req);
    return reply.code(err.statusCode ?? 500).send({
      error: 'INTERNAL_ERROR',
      message: opts.exposeInternalMessage ? (err.message || 'Internal server error').substring(0, 500) : 'Internal server error',
    });
  };
}
